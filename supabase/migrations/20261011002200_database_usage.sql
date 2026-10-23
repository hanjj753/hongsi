-- Approved managers can inspect current database size.
begin;

create function public.get_database_usage_bytes()
returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare
  total_bytes bigint;
begin
  if not app_private.can_manage() then
    raise exception 'Management account required' using errcode = '42501';
  end if;

  select pg_catalog.pg_database_size(pg_catalog.current_database())::bigint
    into total_bytes;
  return total_bytes;
end;
$$;
revoke all on function public.get_database_usage_bytes() from public, anon, authenticated;
grant execute on function public.get_database_usage_bytes() to authenticated;

notify pgrst, 'reload schema';
commit;
