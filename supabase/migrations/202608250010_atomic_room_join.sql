begin;

create or replace function public.join_room_snapshot(
  p_code text,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  joined_room public.rooms;
begin
  select * into joined_room
  from public.join_room(p_code, p_nickname);

  if joined_room.id is null then
    raise exception 'room_not_found';
  end if;

  return public.get_room_snapshot(joined_room.id);
end;
$$;

revoke all on function public.join_room_snapshot(text, text) from public;
grant execute on function public.join_room_snapshot(text, text) to authenticated;

commit;
