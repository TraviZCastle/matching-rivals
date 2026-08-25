begin;

create table if not exists public.race_records (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round integer not null check (round > 0),
  question_set_id uuid not null references public.question_sets(id) on delete cascade,
  player_one_nickname varchar(24) not null,
  player_two_nickname varchar(24) not null,
  winner_seat smallint not null check (winner_seat in (1, 2)),
  duration_ms integer not null check (duration_ms >= 250),
  completed_at timestamptz not null default clock_timestamp(),
  unique (room_id, round)
);

create index if not exists race_records_set_rank_idx
on public.race_records (question_set_id, duration_ms, completed_at, id);

alter table public.race_records enable row level security;
revoke all on public.race_records from anon, authenticated;

create or replace function public.capture_race_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_room public.rooms;
  player_one_name varchar(24);
  player_two_name varchar(24);
begin
  if new.finished_at is null or new.duration_ms is null
    or old.finished_at is not null
  then
    return new;
  end if;

  select * into target_room
  from public.rooms
  where id = new.room_id;

  if target_room.id is null or target_room.mode <> 'race' then
    return new;
  end if;

  select
    max(player_row.nickname) filter (where player_row.seat = 1),
    max(player_row.nickname) filter (where player_row.seat = 2)
  into player_one_name, player_two_name
  from public.room_players as player_row
  where player_row.room_id = new.room_id;

  if player_one_name is null or player_two_name is null then
    return new;
  end if;

  insert into public.race_records (
    room_id,
    round,
    question_set_id,
    player_one_nickname,
    player_two_nickname,
    winner_seat,
    duration_ms,
    completed_at
  ) values (
    new.room_id,
    target_room.round,
    target_room.question_set_id,
    player_one_name,
    player_two_name,
    new.seat,
    new.duration_ms,
    new.finished_at
  )
  on conflict (room_id, round) do nothing;

  delete from public.race_records as record_row
  where record_row.question_set_id = target_room.question_set_id
    and record_row.id not in (
      select ranked_row.id
      from public.race_records as ranked_row
      where ranked_row.question_set_id = target_room.question_set_id
      order by ranked_row.duration_ms, ranked_row.completed_at, ranked_row.id
      limit 10
    );

  return new;
end;
$$;

drop trigger if exists capture_race_record_after_finish on public.room_players;
create trigger capture_race_record_after_finish
after update of finished_at on public.room_players
for each row
execute function public.capture_race_record();

create or replace function public.get_race_leaderboard(p_question_set_slug text)
returns table (
  id uuid,
  player_one_nickname varchar(24),
  player_two_nickname varchar(24),
  winner_seat smallint,
  duration_ms integer,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    record_row.id,
    record_row.player_one_nickname,
    record_row.player_two_nickname,
    record_row.winner_seat,
    record_row.duration_ms,
    record_row.completed_at
  from public.race_records as record_row
  join public.question_sets as set_row on set_row.id = record_row.question_set_id
  where set_row.slug = p_question_set_slug and set_row.is_active
  order by record_row.duration_ms, record_row.completed_at, record_row.id
  limit 10;
$$;

revoke all on function public.capture_race_record() from public;
revoke all on function public.get_race_leaderboard(text) from public;
grant execute on function public.get_race_leaderboard(text) to authenticated;

commit;
