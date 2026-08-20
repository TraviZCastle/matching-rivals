begin;

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname varchar(24) not null check (char_length(trim(nickname)) between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.question_sets (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  version integer not null default 1 check (version > 0),
  title text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (slug, version)
);

create table public.question_pairs (
  id uuid primary key default gen_random_uuid(),
  question_set_id uuid not null references public.question_sets(id) on delete cascade,
  ordinal smallint not null check (ordinal > 0),
  zh text not null check (char_length(trim(zh)) > 0),
  en text not null check (char_length(trim(en)) > 0),
  part_of_speech text not null check (part_of_speech in ('noun', 'verb', 'adjective', 'adverb', 'phrase')),
  created_at timestamptz not null default now(),
  unique (question_set_id, ordinal)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  question_set_id uuid not null references public.question_sets(id),
  status text not null default 'waiting' check (status in ('waiting', 'countdown', 'playing', 'finished')),
  round integer not null default 1 check (round > 0),
  countdown_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.room_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seat smallint not null check (seat in (1, 2)),
  nickname varchar(24) not null check (char_length(trim(nickname)) between 1 and 24),
  ready boolean not null default false,
  progress smallint not null default 0 check (progress >= 0),
  mistakes integer not null default 0 check (mistakes >= 0),
  matched_pair_ids uuid[] not null default '{}',
  finished_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);

create table public.attempts (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_zh_pair_id uuid not null references public.question_pairs(id),
  selected_en_pair_id uuid not null references public.question_pairs(id),
  is_correct boolean not null,
  created_at timestamptz not null default clock_timestamp()
);

create index rooms_status_created_at_idx on public.rooms (status, created_at desc);
create index room_players_user_id_idx on public.room_players (user_id, joined_at desc);
create index attempts_room_user_idx on public.attempts (room_id, user_id, created_at);

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.room_players
    where room_id = target_room_id
      and user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.question_sets enable row level security;
alter table public.question_pairs enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.attempts enable row level security;

create policy profiles_read_self
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy question_sets_read_active
on public.question_sets for select
to authenticated
using (is_active);

create policy question_pairs_read_active
on public.question_pairs for select
to authenticated
using (
  exists (
    select 1
    from public.question_sets
    where question_sets.id = question_pairs.question_set_id
      and question_sets.is_active
  )
);

create policy rooms_read_members
on public.rooms for select
to authenticated
using (public.is_room_member(id));

create policy room_players_read_members
on public.room_players for select
to authenticated
using (public.is_room_member(room_id));

create policy attempts_read_self
on public.attempts for select
to authenticated
using (user_id = auth.uid());

create policy room_members_receive_broadcast
on realtime.messages for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.room_players
    where room_players.user_id = auth.uid()
      and 'room:' || room_players.room_id::text = (select realtime.topic())
  )
);

create or replace function public.broadcast_room_changes()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
begin
  perform realtime.broadcast_changes(
    'room:' || coalesce(new.id, old.id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

create or replace function public.broadcast_room_player_changes()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
begin
  perform realtime.broadcast_changes(
    'room:' || coalesce(new.room_id, old.room_id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

create trigger broadcast_rooms_after_change
after insert or update or delete on public.rooms
for each row execute function public.broadcast_room_changes();

create trigger broadcast_room_players_after_change
after insert or update or delete on public.room_players
for each row execute function public.broadcast_room_player_changes();

create or replace function public.create_room(
  p_nickname text,
  p_question_set_slug text default 'starter'
)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  selected_set_id uuid;
  generated_code text;
  created_room public.rooms;
  attempt_number integer;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;
  if char_length(trim(p_nickname)) not between 1 and 24 then
    raise exception 'invalid_nickname';
  end if;

  select id into selected_set_id
  from public.question_sets
  where slug = p_question_set_slug and is_active
  order by version desc
  limit 1;

  if selected_set_id is null then
    raise exception 'question_set_not_found';
  end if;

  insert into public.profiles (id, nickname)
  values (current_user_id, trim(p_nickname))
  on conflict (id) do update
    set nickname = excluded.nickname, updated_at = now();

  for attempt_number in 1..25 loop
    generated_code := lpad((floor(random() * 900000) + 100000)::integer::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, question_set_id)
      values (generated_code, current_user_id, selected_set_id)
      returning * into created_room;
      exit;
    exception when unique_violation then
      if attempt_number = 25 then
        raise exception 'room_code_exhausted';
      end if;
    end;
  end loop;

  insert into public.room_players (room_id, user_id, seat, nickname)
  values (created_room.id, current_user_id, 1, trim(p_nickname));

  return created_room;
end;
$$;

create or replace function public.join_room(p_code text, p_nickname text)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms;
  player_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;
  if char_length(trim(p_nickname)) not between 1 and 24 then
    raise exception 'invalid_nickname';
  end if;

  select * into target_room
  from public.rooms
  where code = p_code
  for update;

  if target_room.id is null then raise exception 'room_not_found'; end if;
  if target_room.status <> 'waiting' then raise exception 'room_not_joinable'; end if;

  if exists (
    select 1 from public.room_players
    where room_id = target_room.id and user_id = current_user_id
  ) then
    update public.room_players
    set nickname = trim(p_nickname)
    where room_id = target_room.id and user_id = current_user_id;
    return target_room;
  end if;

  select count(*) into player_count
  from public.room_players
  where room_id = target_room.id;
  if player_count >= 2 then raise exception 'room_full'; end if;

  insert into public.profiles (id, nickname)
  values (current_user_id, trim(p_nickname))
  on conflict (id) do update
    set nickname = excluded.nickname, updated_at = now();

  insert into public.room_players (room_id, user_id, seat, nickname)
  values (target_room.id, current_user_id, 2, trim(p_nickname));

  return target_room;
end;
$$;

create or replace function public.set_player_ready(p_room_id uuid, p_ready boolean)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms;
  player_count integer;
  ready_count integer;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;

  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or not public.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;
  if target_room.status <> 'waiting' then raise exception 'room_not_waiting'; end if;

  update public.room_players
  set ready = p_ready
  where room_id = p_room_id and user_id = current_user_id;

  select count(*), count(*) filter (where ready)
  into player_count, ready_count
  from public.room_players
  where room_id = p_room_id;

  if player_count = 2 and ready_count = 2 then
    update public.rooms
    set status = 'countdown', countdown_at = clock_timestamp() + interval '3 seconds'
    where id = p_room_id
    returning * into target_room;
  end if;

  return target_room;
end;
$$;

create or replace function public.open_round_if_due(p_room_id uuid)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_room public.rooms;
begin
  if auth.uid() is null or not public.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;

  update public.rooms
  set status = 'playing', started_at = countdown_at
  where id = p_room_id
    and status = 'countdown'
    and countdown_at <= clock_timestamp();

  select * into target_room from public.rooms where id = p_room_id;
  return target_room;
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
  all_finished boolean;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;

  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or not public.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;

  if target_room.status = 'countdown' and target_room.countdown_at <= clock_timestamp() then
    update public.rooms
    set status = 'playing', started_at = countdown_at
    where id = p_room_id
    returning * into target_room;
  end if;
  if target_room.status <> 'playing' then raise exception 'room_not_playing'; end if;

  if not exists (
    select 1 from public.question_pairs
    where id = p_zh_pair_id and question_set_id = target_room.question_set_id
  ) or not exists (
    select 1 from public.question_pairs
    where id = p_en_pair_id and question_set_id = target_room.question_set_id
  ) then
    raise exception 'pair_not_in_question_set';
  end if;

  select * into current_player
  from public.room_players
  where room_id = p_room_id and user_id = current_user_id
  for update;

  if current_player.finished_at is not null then raise exception 'player_already_finished'; end if;

  insert into public.attempts (
    room_id, user_id, selected_zh_pair_id, selected_en_pair_id, is_correct
  ) values (
    p_room_id, current_user_id, p_zh_pair_id, p_en_pair_id, correct_match
  );

  if not correct_match then
    update public.room_players
    set mistakes = mistakes + 1
    where room_id = p_room_id and user_id = current_user_id
    returning * into current_player;
  elsif not (p_zh_pair_id = any(current_player.matched_pair_ids)) then
    select count(*) into pair_count
    from public.question_pairs
    where question_set_id = target_room.question_set_id;

    update public.room_players
    set matched_pair_ids = array_append(matched_pair_ids, p_zh_pair_id),
        progress = progress + 1,
        finished_at = case when progress + 1 >= pair_count then clock_timestamp() else finished_at end
    where room_id = p_room_id and user_id = current_user_id
    returning * into current_player;
  end if;

  select count(*) = 2 and count(*) filter (where finished_at is not null) = 2
  into all_finished
  from public.room_players
  where room_id = p_room_id;

  if all_finished then
    update public.rooms
    set status = 'finished', finished_at = clock_timestamp()
    where id = p_room_id;
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
begin
  if auth.uid() is null or not public.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;

  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.status <> 'finished' then raise exception 'room_not_finished'; end if;

  update public.room_players
  set ready = false,
      progress = 0,
      mistakes = 0,
      matched_pair_ids = '{}',
      finished_at = null
  where room_id = p_room_id;

  update public.rooms
  set status = 'waiting',
      round = round + 1,
      countdown_at = null,
      started_at = null,
      finished_at = null
  where id = p_room_id
  returning * into target_room;

  return target_room;
end;
$$;

revoke all on public.profiles, public.question_sets, public.question_pairs,
  public.rooms, public.room_players, public.attempts from anon, authenticated;

revoke all on function public.is_room_member(uuid) from public;
revoke all on function public.create_room(text, text) from public;
revoke all on function public.join_room(text, text) from public;
revoke all on function public.set_player_ready(uuid, boolean) from public;
revoke all on function public.open_round_if_due(uuid) from public;
revoke all on function public.submit_match(uuid, uuid, uuid) from public;
revoke all on function public.start_rematch(uuid) from public;

grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.create_room(text, text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.set_player_ready(uuid, boolean) to authenticated;
grant execute on function public.open_round_if_due(uuid) to authenticated;
grant execute on function public.submit_match(uuid, uuid, uuid) to authenticated;
grant execute on function public.start_rematch(uuid) to authenticated;

grant select on public.profiles, public.question_sets, public.question_pairs,
  public.rooms, public.room_players, public.attempts to authenticated;

insert into public.question_sets (id, slug, version, title, is_active)
values ('10000000-0000-4000-8000-000000000001', 'starter', 1, 'Starter Six', true)
on conflict (slug, version) do update
set title = excluded.title, is_active = excluded.is_active;

insert into public.question_pairs (id, question_set_id, ordinal, zh, en, part_of_speech)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, '灵感', 'inspiration', 'noun'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 2, '勇气', 'courage', 'noun'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 3, '瞬间', 'moment', 'noun'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 4, '边界', 'boundary', 'noun'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 5, '探索', 'explore', 'verb'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 6, '精准', 'precise', 'adjective')
on conflict (question_set_id, ordinal) do update
set zh = excluded.zh, en = excluded.en, part_of_speech = excluded.part_of_speech;

commit;
