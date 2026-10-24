-- Keep historical work, class, and message references while removing a staff member from the directory.
begin;

alter table public.staff add column archived_at timestamptz;

create function public.archive_staff_profile(target_staff_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_admin() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if target_staff_id = app_private.current_staff_id() then
    raise exception 'Cannot remove your own account' using errcode = '23514';
  end if;
  perform 1 from public.staff where id = target_staff_id and archived_at is null for update;
  if not found then
    raise exception 'Staff member not found' using errcode = 'P0002';
  end if;
  update public.staff set employment_status = 'inactive', archived_at = now()
    where id = target_staff_id;
  update public.app_access set access_status = 'suspended' where staff_id = target_staff_id;
end;
$$;
revoke all on function public.archive_staff_profile(bigint) from public, anon, authenticated;
grant execute on function public.archive_staff_profile(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
