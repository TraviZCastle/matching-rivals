begin;

create or replace function public.server_now()
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select clock_timestamp();
$$;

revoke all on function public.server_now() from public;
grant execute on function public.server_now() to authenticated;

commit;
