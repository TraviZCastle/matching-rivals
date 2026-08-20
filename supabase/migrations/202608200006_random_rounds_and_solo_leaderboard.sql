begin;

alter table public.rooms add column if not exists selected_pair_ids uuid[];

update public.rooms as room_row
set selected_pair_ids = (
  select array_agg(selected_pair.id)
  from (
    select pair_row.id
    from public.question_pairs as pair_row
    where pair_row.question_set_id = room_row.question_set_id
    order by random()
    limit 6
  ) as selected_pair
)
where selected_pair_ids is null or cardinality(selected_pair_ids) <> 6;

alter table public.rooms alter column selected_pair_ids set default '{}';
alter table public.rooms alter column selected_pair_ids set not null;
alter table public.rooms drop constraint if exists rooms_six_selected_pairs_check;
alter table public.rooms add constraint rooms_six_selected_pairs_check
check (cardinality(selected_pair_ids) = 6);

create table public.solo_records (
  id uuid primary key default gen_random_uuid(),
  question_set_id uuid not null references public.question_sets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname varchar(24) not null check (char_length(trim(nickname)) between 1 and 24),
  duration_ms integer not null check (duration_ms >= 0),
  mistakes integer not null check (mistakes >= 0),
  completed_at timestamptz not null default clock_timestamp()
);

create index solo_records_set_rank_idx
on public.solo_records (question_set_id, duration_ms, mistakes, completed_at);

alter table public.solo_records enable row level security;
revoke all on public.solo_records from anon, authenticated;

create or replace function public.random_question_pair_ids(p_question_set_id uuid)
returns uuid[]
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(selected_pair.id), '{}'::uuid[])
  from (
    select pair_row.id
    from public.question_pairs as pair_row
    where pair_row.question_set_id = p_question_set_id
    order by random()
    limit 6
  ) as selected_pair;
$$;

create or replace function public.create_room(
  p_nickname text,
  p_question_set_slug text default 'cet4'
)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  selected_set_id uuid;
  selected_pair_ids uuid[];
  generated_code text;
  created_room public.rooms;
  attempt_number integer;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(trim(p_nickname)) not between 1 and 24 then raise exception 'invalid_nickname'; end if;

  select id into selected_set_id
  from public.question_sets
  where slug = p_question_set_slug and is_active
  order by version desc limit 1;
  if selected_set_id is null then raise exception 'question_set_not_found'; end if;

  selected_pair_ids := public.random_question_pair_ids(selected_set_id);
  if cardinality(selected_pair_ids) <> 6 then raise exception 'question_set_not_ready'; end if;

  insert into public.profiles (id, nickname)
  values (current_user_id, trim(p_nickname))
  on conflict (id) do update set nickname = excluded.nickname, updated_at = now();

  for attempt_number in 1..25 loop
    generated_code := lpad((floor(random() * 900000) + 100000)::integer::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, question_set_id, selected_pair_ids, mode, expires_at)
      values (
        generated_code, current_user_id, selected_set_id, selected_pair_ids,
        'race', clock_timestamp() + interval '5 minutes'
      )
      returning * into created_room;
      exit;
    exception when unique_violation then
      if attempt_number = 25 then raise exception 'room_code_exhausted'; end if;
    end;
  end loop;

  insert into public.room_players (room_id, user_id, seat, nickname)
  values (created_room.id, current_user_id, 1, trim(p_nickname));
  return created_room;
end;
$$;

create or replace function public.create_practice_room(
  p_nickname text,
  p_question_set_slug text default 'cet4'
)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  selected_set_id uuid;
  selected_pair_ids uuid[];
  generated_code text;
  created_room public.rooms;
  attempt_number integer;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(trim(p_nickname)) not between 1 and 24 then raise exception 'invalid_nickname'; end if;

  select id into selected_set_id
  from public.question_sets
  where slug = p_question_set_slug and is_active
  order by version desc limit 1;
  if selected_set_id is null then raise exception 'question_set_not_found'; end if;

  selected_pair_ids := public.random_question_pair_ids(selected_set_id);
  if cardinality(selected_pair_ids) <> 6 then raise exception 'question_set_not_ready'; end if;

  insert into public.profiles (id, nickname)
  values (current_user_id, trim(p_nickname))
  on conflict (id) do update set nickname = excluded.nickname, updated_at = now();

  for attempt_number in 1..25 loop
    generated_code := lpad((floor(random() * 900000) + 100000)::integer::text, 6, '0');
    begin
      insert into public.rooms (
        code, host_id, question_set_id, selected_pair_ids, mode, status,
        started_at, expires_at
      ) values (
        generated_code, current_user_id, selected_set_id, selected_pair_ids,
        'practice', 'playing', clock_timestamp(), clock_timestamp() + interval '5 minutes'
      ) returning * into created_room;
      exit;
    exception when unique_violation then
      if attempt_number = 25 then raise exception 'room_code_exhausted'; end if;
    end;
  end loop;

  insert into public.room_players (room_id, user_id, seat, nickname, ready)
  values (created_room.id, current_user_id, 1, trim(p_nickname), true);
  return created_room;
end;
$$;

create or replace function public.submit_match(
  p_room_id uuid,
  p_zh_pair_id uuid,
  p_en_pair_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms;
  current_player public.room_players;
  correct_match boolean := p_zh_pair_id = p_en_pair_id;
  pair_count integer;
  elapsed_ms integer;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or not public.is_room_member(p_room_id) then raise exception 'room_not_found'; end if;
  if target_room.expires_at <= clock_timestamp() then raise exception 'room_expired'; end if;
  if target_room.status = 'countdown' and target_room.countdown_at <= clock_timestamp() then
    update public.rooms set status = 'playing', started_at = countdown_at
    where id = p_room_id returning * into target_room;
  end if;
  if target_room.status <> 'playing' then raise exception 'room_not_playing'; end if;

  if not (p_zh_pair_id = any(target_room.selected_pair_ids))
    or not (p_en_pair_id = any(target_room.selected_pair_ids))
  then raise exception 'pair_not_in_question_set'; end if;

  select * into current_player from public.room_players
  where room_id = p_room_id and user_id = current_user_id for update;
  if current_player.finished_at is not null then raise exception 'player_already_finished'; end if;

  insert into public.attempts (room_id, user_id, selected_zh_pair_id, selected_en_pair_id, is_correct)
  values (p_room_id, current_user_id, p_zh_pair_id, p_en_pair_id, correct_match);

  if not correct_match then
    update public.room_players set mistakes = mistakes + 1
    where room_id = p_room_id and user_id = current_user_id returning * into current_player;
  elsif not (p_zh_pair_id = any(current_player.matched_pair_ids)) then
    pair_count := cardinality(target_room.selected_pair_ids);
    update public.room_players
    set matched_pair_ids = array_append(matched_pair_ids, p_zh_pair_id),
        progress = progress + 1,
        finished_at = case when progress + 1 >= pair_count then clock_timestamp() else finished_at end
    where room_id = p_room_id and user_id = current_user_id returning * into current_player;
  end if;

  if current_player.finished_at is not null then
    update public.rooms set status = 'finished', finished_at = current_player.finished_at
    where id = p_room_id;

    if target_room.mode = 'practice' then
      elapsed_ms := greatest(
        0,
        round(extract(epoch from (current_player.finished_at - target_room.started_at)) * 1000)::integer
      );
      insert into public.solo_records (
        question_set_id, user_id, nickname, duration_ms, mistakes, completed_at
      ) values (
        target_room.question_set_id, current_user_id, current_player.nickname,
        elapsed_ms, current_player.mistakes, current_player.finished_at
      );

      delete from public.solo_records as record_row
      where record_row.question_set_id = target_room.question_set_id
        and record_row.id not in (
          select ranked_row.id
          from public.solo_records as ranked_row
          where ranked_row.question_set_id = target_room.question_set_id
          order by ranked_row.duration_ms, ranked_row.mistakes, ranked_row.completed_at, ranked_row.id
          limit 10
        );
    end if;
  end if;

  return jsonb_build_object(
    'correct', correct_match,
    'progress', current_player.progress,
    'mistakes', current_player.mistakes,
    'finished_at', current_player.finished_at
  );
end;
$$;

create or replace function public.start_rematch(p_room_id uuid)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_room public.rooms;
  rematch_started_at timestamptz := clock_timestamp();
  next_pair_ids uuid[];
begin
  if auth.uid() is null or not public.is_room_member(p_room_id) then raise exception 'room_not_found'; end if;
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.status <> 'finished' then raise exception 'room_not_finished'; end if;

  next_pair_ids := public.random_question_pair_ids(target_room.question_set_id);
  if cardinality(next_pair_ids) <> 6 then raise exception 'question_set_not_ready'; end if;

  update public.room_players
  set ready = (target_room.mode = 'practice'), progress = 0, mistakes = 0,
      matched_pair_ids = '{}', finished_at = null
  where room_id = p_room_id;

  update public.rooms
  set status = case when mode = 'practice' then 'playing' else 'waiting' end,
      round = round + 1,
      selected_pair_ids = next_pair_ids,
      countdown_at = null,
      started_at = case when mode = 'practice' then rematch_started_at else null end,
      finished_at = null,
      expires_at = rematch_started_at + interval '5 minutes'
  where id = p_room_id returning * into target_room;
  return target_room;
end;
$$;

create or replace function public.get_room_snapshot(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_room public.rooms;
  snapshot_set_slug text;
  snapshot_players jsonb;
  snapshot_questions jsonb;
begin
  if auth.uid() is null or not public.is_room_member(p_room_id) then raise exception 'room_not_found'; end if;
  update public.rooms set status = 'expired', finished_at = expires_at
  where id = p_room_id and status not in ('finished', 'expired') and expires_at <= clock_timestamp();
  select * into target_room from public.rooms where id = p_room_id;
  if target_room.id is null then raise exception 'room_not_found'; end if;
  select slug into snapshot_set_slug
  from public.question_sets
  where id = target_room.question_set_id;
  select coalesce(jsonb_agg(to_jsonb(player_row) order by player_row.seat), '[]'::jsonb)
  into snapshot_players from public.room_players as player_row where player_row.room_id = p_room_id;
  select coalesce(
    jsonb_agg(
      to_jsonb(question_row)
      order by array_position(target_room.selected_pair_ids, question_row.id)
    ),
    '[]'::jsonb
  )
  into snapshot_questions from public.question_pairs as question_row
  where question_row.id = any(target_room.selected_pair_ids);
  return jsonb_build_object(
    'room', to_jsonb(target_room) || jsonb_build_object('question_set_slug', snapshot_set_slug),
    'players', snapshot_players,
    'questions', snapshot_questions,
    'server_now', clock_timestamp()
  );
end;
$$;

create or replace function public.get_solo_leaderboard(p_question_set_slug text)
returns table (
  id uuid,
  nickname varchar(24),
  duration_ms integer,
  mistakes integer,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select record_row.id, record_row.nickname, record_row.duration_ms,
    record_row.mistakes, record_row.completed_at
  from public.solo_records as record_row
  join public.question_sets as set_row on set_row.id = record_row.question_set_id
  where set_row.slug = p_question_set_slug and set_row.is_active
  order by record_row.duration_ms, record_row.mistakes, record_row.completed_at, record_row.id
  limit 10;
$$;

revoke all on function public.random_question_pair_ids(uuid) from public;
revoke all on function public.get_solo_leaderboard(text) from public;
grant execute on function public.get_solo_leaderboard(text) to authenticated;

commit;
