begin;

alter table public.room_players
add column if not exists duration_ms integer check (duration_ms >= 0);

alter table public.room_players
add column if not exists completion_id uuid;

create unique index if not exists room_players_completion_id_idx
on public.room_players (completion_id)
where completion_id is not null;

create or replace function public.sync_match_progress(
  p_room_id uuid,
  p_round integer,
  p_matched_pair_ids uuid[],
  p_mistakes integer
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
  submitted_progress integer := coalesce(cardinality(p_matched_pair_ids), 0);
  distinct_progress integer;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if p_round is null or p_mistakes is null or p_mistakes < 0 or p_mistakes > 10000 then
    raise exception 'invalid_progress';
  end if;

  select * into target_room from public.rooms where id = p_room_id;
  if target_room.id is null or not public.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;
  if target_room.round <> p_round then raise exception 'round_mismatch'; end if;
  if target_room.expires_at <= clock_timestamp() then raise exception 'room_expired'; end if;

  select count(distinct pair_id) into distinct_progress
  from unnest(coalesce(p_matched_pair_ids, '{}'::uuid[])) as pair_id;

  if submitted_progress >= cardinality(target_room.selected_pair_ids)
    or distinct_progress <> submitted_progress
    or not coalesce(p_matched_pair_ids, '{}'::uuid[]) <@ target_room.selected_pair_ids
  then
    raise exception 'invalid_progress';
  end if;

  select * into current_player
  from public.room_players
  where room_id = p_room_id and user_id = current_user_id
  for update;
  if current_player.room_id is null then raise exception 'room_not_found'; end if;

  if target_room.status <> 'playing' or current_player.finished_at is not null then
    return jsonb_build_object(
      'accepted', false,
      'progress', current_player.progress,
      'mistakes', current_player.mistakes
    );
  end if;

  update public.room_players
  set matched_pair_ids = case
        when submitted_progress > progress then coalesce(p_matched_pair_ids, '{}'::uuid[])
        else matched_pair_ids
      end,
      progress = greatest(progress, submitted_progress),
      mistakes = greatest(mistakes, p_mistakes)
  where room_id = p_room_id and user_id = current_user_id
  returning * into current_player;

  return jsonb_build_object(
    'accepted', true,
    'progress', current_player.progress,
    'mistakes', current_player.mistakes
  );
end;
$$;

create or replace function public.finish_local_round(
  p_room_id uuid,
  p_round integer,
  p_matched_pair_ids uuid[],
  p_mistakes integer,
  p_duration_ms integer,
  p_completion_id uuid
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
  submitted_progress integer := coalesce(cardinality(p_matched_pair_ids), 0);
  distinct_progress integer;
  server_elapsed_ms integer;
  completed_at timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if p_round is null or p_completion_id is null then raise exception 'invalid_completion'; end if;
  if p_mistakes is null or p_mistakes < 0 or p_mistakes > 10000 then raise exception 'invalid_completion'; end if;
  if p_duration_ms is null or p_duration_ms < 250 or p_duration_ms > 300000 then
    raise exception 'invalid_duration';
  end if;

  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or not public.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;
  if target_room.round <> p_round then raise exception 'round_mismatch'; end if;
  if target_room.expires_at + interval '5 seconds' <= completed_at then raise exception 'room_expired'; end if;

  select * into current_player
  from public.room_players
  where room_id = p_room_id and user_id = current_user_id
  for update;
  if current_player.room_id is null then raise exception 'room_not_found'; end if;

  if current_player.completion_id = p_completion_id and current_player.duration_ms is not null then
    return jsonb_build_object(
      'accepted', true,
      'duration_ms', current_player.duration_ms,
      'mistakes', current_player.mistakes,
      'finished_at', current_player.finished_at,
      'completion_id', current_player.completion_id
    );
  end if;

  if target_room.status <> 'playing' then raise exception 'room_not_playing'; end if;
  if target_room.started_at is null then raise exception 'room_not_playing'; end if;
  if current_player.finished_at is not null then raise exception 'player_already_finished'; end if;

  select count(distinct pair_id) into distinct_progress
  from unnest(coalesce(p_matched_pair_ids, '{}'::uuid[])) as pair_id;

  if submitted_progress <> cardinality(target_room.selected_pair_ids)
    or distinct_progress <> submitted_progress
    or not coalesce(p_matched_pair_ids, '{}'::uuid[]) @> target_room.selected_pair_ids
    or not coalesce(p_matched_pair_ids, '{}'::uuid[]) <@ target_room.selected_pair_ids
  then
    raise exception 'incomplete_round';
  end if;

  server_elapsed_ms := greatest(
    0,
    round(extract(epoch from (completed_at - target_room.started_at)) * 1000)::integer
  );

  if p_duration_ms > server_elapsed_ms + 5000 then raise exception 'invalid_duration'; end if;
  if target_room.mode = 'race' and p_duration_ms + 15000 < server_elapsed_ms then
    raise exception 'invalid_duration';
  end if;
  if target_room.mode = 'practice' and p_duration_ms + 30000 < server_elapsed_ms then
    raise exception 'invalid_duration';
  end if;

  update public.room_players
  set matched_pair_ids = p_matched_pair_ids,
      progress = submitted_progress,
      mistakes = p_mistakes,
      duration_ms = p_duration_ms,
      completion_id = p_completion_id,
      finished_at = completed_at
  where room_id = p_room_id and user_id = current_user_id
  returning * into current_player;

  update public.rooms
  set status = 'finished', finished_at = completed_at
  where id = p_room_id;

  if target_room.mode = 'practice' then
    insert into public.solo_records (
      question_set_id, user_id, nickname, duration_ms, mistakes, completed_at
    ) values (
      target_room.question_set_id, current_user_id, current_player.nickname,
      p_duration_ms, p_mistakes, completed_at
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

  return jsonb_build_object(
    'accepted', true,
    'duration_ms', current_player.duration_ms,
    'mistakes', current_player.mistakes,
    'finished_at', current_player.finished_at,
    'completion_id', current_player.completion_id
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
      matched_pair_ids = '{}', finished_at = null, duration_ms = null, completion_id = null
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

revoke all on function public.sync_match_progress(uuid, integer, uuid[], integer) from public;
revoke all on function public.finish_local_round(uuid, integer, uuid[], integer, integer, uuid) from public;
grant execute on function public.sync_match_progress(uuid, integer, uuid[], integer) to authenticated;
grant execute on function public.finish_local_round(uuid, integer, uuid[], integer, integer, uuid) to authenticated;

commit;
