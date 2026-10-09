-- Match the legacy location delete action without orphaning classes or sessions.
begin;

create function public.delete_managed_location(target_location_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.can_manage() then
    raise exception 'Manager account required' using errcode = '42501';
  end if;
  if exists (select 1 from public.classes c where c.location_id = target_location_id)
    or exists (select 1 from public.class_sessions s where s.location_id = target_location_id) then
    raise exception 'Location is used by a class or session' using errcode = '23503';
  end if;
  delete from public.locations where id = target_location_id;
  if not found then raise exception 'Location not found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.delete_managed_location(bigint) from public, anon, authenticated;
grant execute on function public.delete_managed_location(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;