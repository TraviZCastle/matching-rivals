begin;

create or replace function public.get_room_snapshot(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_room public.rooms;
  snapshot_players jsonb;
  snapshot_questions jsonb;
begin
  if auth.uid() is null or not public.is_room_member(p_room_id) then
    raise exception 'room_not_found';
  end if;

  select * into target_room
  from public.rooms
  where id = p_room_id;

  if target_room.id is null then
    raise exception 'room_not_found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(player_row) order by player_row.seat), '[]'::jsonb)
  into snapshot_players
  from public.room_players as player_row
  where player_row.room_id = p_room_id;

  select coalesce(jsonb_agg(to_jsonb(question_row) order by question_row.ordinal), '[]'::jsonb)
  into snapshot_questions
  from public.question_pairs as question_row
  where question_row.question_set_id = target_room.question_set_id;

  return jsonb_build_object(
    'room', to_jsonb(target_room),
    'players', snapshot_players,
    'questions', snapshot_questions,
    'server_now', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_room_snapshot(uuid) from public;
grant execute on function public.get_room_snapshot(uuid) to authenticated;

commit;
