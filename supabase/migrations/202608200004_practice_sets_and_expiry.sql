begin;

alter table public.rooms add column if not exists mode text;
update public.rooms set mode = 'race' where mode is null;
alter table public.rooms alter column mode set default 'race';
alter table public.rooms alter column mode set not null;
alter table public.rooms drop constraint if exists rooms_mode_check;
alter table public.rooms add constraint rooms_mode_check check (mode in ('race', 'practice'));

alter table public.rooms add column if not exists expires_at timestamptz;
update public.rooms set expires_at = created_at + interval '5 minutes' where expires_at is null;
alter table public.rooms alter column expires_at set default (clock_timestamp() + interval '5 minutes');
alter table public.rooms alter column expires_at set not null;

alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check
check (status in ('waiting', 'countdown', 'playing', 'finished', 'expired'));

insert into public.question_sets (id, slug, version, title, is_active)
values
  ('11000000-0000-4000-8000-000000000001', 'cet4', 1, 'CET-4', true),
  ('11000000-0000-4000-8000-000000000002', 'cet6', 1, 'CET-6', true),
  ('11000000-0000-4000-8000-000000000003', 'tem8', 1, 'TEM-8', true),
  ('11000000-0000-4000-8000-000000000004', 'ielts', 1, 'IELTS', true),
  ('11000000-0000-4000-8000-000000000005', 'toefl', 1, 'TOEFL', true)
on conflict (slug, version) do update
set title = excluded.title, is_active = excluded.is_active;

insert into public.question_pairs (id, question_set_id, ordinal, zh, en, part_of_speech)
values
  ('21000000-0000-4000-8000-000000000101', '11000000-0000-4000-8000-000000000001', 1, '环境', 'environment', 'noun'),
  ('21000000-0000-4000-8000-000000000102', '11000000-0000-4000-8000-000000000001', 2, '选择', 'choice', 'noun'),
  ('21000000-0000-4000-8000-000000000103', '11000000-0000-4000-8000-000000000001', 3, '影响', 'influence', 'noun'),
  ('21000000-0000-4000-8000-000000000104', '11000000-0000-4000-8000-000000000001', 4, '责任', 'responsibility', 'noun'),
  ('21000000-0000-4000-8000-000000000105', '11000000-0000-4000-8000-000000000001', 5, '改善', 'improve', 'verb'),
  ('21000000-0000-4000-8000-000000000106', '11000000-0000-4000-8000-000000000001', 6, '可能的', 'possible', 'adjective'),
  ('21000000-0000-4000-8000-000000000201', '11000000-0000-4000-8000-000000000002', 1, '现象', 'phenomenon', 'noun'),
  ('21000000-0000-4000-8000-000000000202', '11000000-0000-4000-8000-000000000002', 2, '趋势', 'tendency', 'noun'),
  ('21000000-0000-4000-8000-000000000203', '11000000-0000-4000-8000-000000000002', 3, '显著的', 'significant', 'adjective'),
  ('21000000-0000-4000-8000-000000000204', '11000000-0000-4000-8000-000000000002', 4, '促进', 'facilitate', 'verb'),
  ('21000000-0000-4000-8000-000000000205', '11000000-0000-4000-8000-000000000002', 5, '不可避免的', 'inevitable', 'adjective'),
  ('21000000-0000-4000-8000-000000000206', '11000000-0000-4000-8000-000000000002', 6, '分配', 'allocate', 'verb'),
  ('21000000-0000-4000-8000-000000000301', '11000000-0000-4000-8000-000000000003', 1, '模棱两可的', 'ambiguous', 'adjective'),
  ('21000000-0000-4000-8000-000000000302', '11000000-0000-4000-8000-000000000003', 2, '缓解', 'alleviate', 'verb'),
  ('21000000-0000-4000-8000-000000000303', '11000000-0000-4000-8000-000000000003', 3, '连贯的', 'coherent', 'adjective'),
  ('21000000-0000-4000-8000-000000000304', '11000000-0000-4000-8000-000000000003', 4, '脆弱的', 'vulnerable', 'adjective'),
  ('21000000-0000-4000-8000-000000000305', '11000000-0000-4000-8000-000000000003', 5, '推断', 'infer', 'verb'),
  ('21000000-0000-4000-8000-000000000306', '11000000-0000-4000-8000-000000000003', 6, '异常', 'anomaly', 'noun'),
  ('21000000-0000-4000-8000-000000000401', '11000000-0000-4000-8000-000000000004', 1, '可持续的', 'sustainable', 'adjective'),
  ('21000000-0000-4000-8000-000000000402', '11000000-0000-4000-8000-000000000004', 2, '基础设施', 'infrastructure', 'noun'),
  ('21000000-0000-4000-8000-000000000403', '11000000-0000-4000-8000-000000000004', 3, '多样性', 'diversity', 'noun'),
  ('21000000-0000-4000-8000-000000000404', '11000000-0000-4000-8000-000000000004', 4, '排放', 'emission', 'noun'),
  ('21000000-0000-4000-8000-000000000405', '11000000-0000-4000-8000-000000000004', 5, '城市化', 'urbanization', 'noun'),
  ('21000000-0000-4000-8000-000000000406', '11000000-0000-4000-8000-000000000004', 6, '评估', 'assess', 'verb'),
  ('21000000-0000-4000-8000-000000000501', '11000000-0000-4000-8000-000000000005', 1, '假设', 'hypothesis', 'noun'),
  ('21000000-0000-4000-8000-000000000502', '11000000-0000-4000-8000-000000000005', 2, '光合作用', 'photosynthesis', 'noun'),
  ('21000000-0000-4000-8000-000000000503', '11000000-0000-4000-8000-000000000005', 3, '沉积物', 'sediment', 'noun'),
  ('21000000-0000-4000-8000-000000000504', '11000000-0000-4000-8000-000000000005', 4, '迁徙', 'migration', 'noun'),
  ('21000000-0000-4000-8000-000000000505', '11000000-0000-4000-8000-000000000005', 5, '侵蚀', 'erosion', 'noun'),
  ('21000000-0000-4000-8000-000000000506', '11000000-0000-4000-8000-000000000005', 6, '使适应', 'adapt', 'verb')
on conflict (question_set_id, ordinal) do update
set zh = excluded.zh, en = excluded.en, part_of_speech = excluded.part_of_speech;

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

  insert into public.profiles (id, nickname)
  values (current_user_id, trim(p_nickname))
  on conflict (id) do update set nickname = excluded.nickname, updated_at = now();

  for attempt_number in 1..25 loop
    generated_code := lpad((floor(random() * 900000) + 100000)::integer::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, question_set_id, mode, expires_at)
      values (generated_code, current_user_id, selected_set_id, 'race', clock_timestamp() + interval '5 minutes')
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

  insert into public.profiles (id, nickname)
  values (current_user_id, trim(p_nickname))
  on conflict (id) do update set nickname = excluded.nickname, updated_at = now();

  for attempt_number in 1..25 loop
    generated_code := lpad((floor(random() * 900000) + 100000)::integer::text, 6, '0');
    begin
      insert into public.rooms (
        code, host_id, question_set_id, mode, status, started_at, expires_at
      ) values (
        generated_code, current_user_id, selected_set_id, 'practice', 'playing',
        clock_timestamp(), clock_timestamp() + interval '5 minutes'
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
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(trim(p_nickname)) not between 1 and 24 then raise exception 'invalid_nickname'; end if;

  select * into target_room from public.rooms where code = p_code for update;
  if target_room.id is null then raise exception 'room_not_found'; end if;
  if target_room.expires_at <= clock_timestamp() then raise exception 'room_expired'; end if;
  if target_room.mode <> 'race' or target_room.status <> 'waiting' then raise exception 'room_not_joinable'; end if;

  if exists (select 1 from public.room_players where room_id = target_room.id and user_id = current_user_id) then
    update public.room_players set nickname = trim(p_nickname)
    where room_id = target_room.id and user_id = current_user_id;
    return target_room;
  end if;

  select count(*) into player_count from public.room_players where room_id = target_room.id;
  if player_count >= 2 then raise exception 'room_full'; end if;

  insert into public.profiles (id, nickname)
  values (current_user_id, trim(p_nickname))
  on conflict (id) do update set nickname = excluded.nickname, updated_at = now();
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
  if target_room.id is null or not public.is_room_member(p_room_id) then raise exception 'room_not_found'; end if;
  if target_room.expires_at <= clock_timestamp() then
    update public.rooms set status = 'expired', finished_at = target_room.expires_at where id = p_room_id returning * into target_room;
    return target_room;
  end if;
  if target_room.mode <> 'race' or target_room.status <> 'waiting' then raise exception 'room_not_waiting'; end if;

  update public.room_players set ready = p_ready where room_id = p_room_id and user_id = current_user_id;
  select count(*), count(*) filter (where ready) into player_count, ready_count
  from public.room_players where room_id = p_room_id;
  if player_count = 2 and ready_count = 2 then
    update public.rooms set status = 'countdown', countdown_at = clock_timestamp() + interval '3 seconds'
    where id = p_room_id returning * into target_room;
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
  if auth.uid() is null or not public.is_room_member(p_room_id) then raise exception 'room_not_found'; end if;
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.expires_at <= clock_timestamp() and target_room.status not in ('finished', 'expired') then
    update public.rooms set status = 'expired', finished_at = target_room.expires_at where id = p_room_id returning * into target_room;
    return target_room;
  end if;
  if target_room.status = 'countdown' and target_room.countdown_at <= clock_timestamp() then
    update public.rooms set status = 'playing', started_at = countdown_at
    where id = p_room_id returning * into target_room;
  end if;
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
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or not public.is_room_member(p_room_id) then raise exception 'room_not_found'; end if;
  if target_room.expires_at <= clock_timestamp() then raise exception 'room_expired'; end if;
  if target_room.status = 'countdown' and target_room.countdown_at <= clock_timestamp() then
    update public.rooms set status = 'playing', started_at = countdown_at where id = p_room_id returning * into target_room;
  end if;
  if target_room.status <> 'playing' then raise exception 'room_not_playing'; end if;

  if not exists (select 1 from public.question_pairs where id = p_zh_pair_id and question_set_id = target_room.question_set_id)
    or not exists (select 1 from public.question_pairs where id = p_en_pair_id and question_set_id = target_room.question_set_id)
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
    select count(*) into pair_count from public.question_pairs where question_set_id = target_room.question_set_id;
    update public.room_players
    set matched_pair_ids = array_append(matched_pair_ids, p_zh_pair_id),
        progress = progress + 1,
        finished_at = case when progress + 1 >= pair_count then clock_timestamp() else finished_at end
    where room_id = p_room_id and user_id = current_user_id returning * into current_player;
  end if;

  if current_player.finished_at is not null then
    update public.rooms set status = 'finished', finished_at = current_player.finished_at where id = p_room_id;
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
begin
  if auth.uid() is null or not public.is_room_member(p_room_id) then raise exception 'room_not_found'; end if;
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.status <> 'finished' then raise exception 'room_not_finished'; end if;

  update public.room_players
  set ready = (target_room.mode = 'practice'), progress = 0, mistakes = 0,
      matched_pair_ids = '{}', finished_at = null
  where room_id = p_room_id;

  update public.rooms
  set status = case when mode = 'practice' then 'playing' else 'waiting' end,
      round = round + 1,
      countdown_at = null,
      started_at = case when mode = 'practice' then rematch_started_at else null end,
      finished_at = null,
      expires_at = rematch_started_at + interval '5 minutes'
  where id = p_room_id returning * into target_room;
  return target_room;
end;
$$;

create or replace function public.expire_room_if_due(p_room_id uuid)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_room public.rooms;
begin
  if auth.uid() is null or not public.is_room_member(p_room_id) then raise exception 'room_not_found'; end if;
  update public.rooms
  set status = 'expired', finished_at = expires_at
  where id = p_room_id and status not in ('finished', 'expired') and expires_at <= clock_timestamp();
  select * into target_room from public.rooms where id = p_room_id;
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
  select coalesce(jsonb_agg(to_jsonb(question_row) order by question_row.ordinal), '[]'::jsonb)
  into snapshot_questions from public.question_pairs as question_row
  where question_row.question_set_id = target_room.question_set_id;
  return jsonb_build_object(
    'room', to_jsonb(target_room) || jsonb_build_object('question_set_slug', snapshot_set_slug),
    'players', snapshot_players,
    'questions', snapshot_questions, 'server_now', clock_timestamp()
  );
end;
$$;

revoke all on function public.create_practice_room(text, text) from public;
revoke all on function public.expire_room_if_due(uuid) from public;
grant execute on function public.create_practice_room(text, text) to authenticated;
grant execute on function public.expire_room_if_due(uuid) to authenticated;

commit;
