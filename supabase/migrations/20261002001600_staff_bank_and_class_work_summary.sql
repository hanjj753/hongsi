-- Managers may read bank accounts; only administrators may edit them.
-- Approved staff can view class shift times without seeing rates or bank details.
begin;

drop policy admin_bank_read on public.staff_private_details;
create policy management_bank_read on public.staff_private_details for select to authenticated
  using ((select app_private.can_manage()));

create function public.get_class_work_summary(target_class_id bigint)
returns table(
  work_log_id text,
  staff_name text,
  work_date date,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  return query
    select w.id::text, s.full_name, w.work_date, w.started_at, w.ended_at, w.duration_minutes
      from public.work_logs w
      join public.staff s on s.id = w.staff_id
      where w.class_id = target_class_id
      order by w.started_at desc, w.id desc;
end;
$$;
revoke all on function public.get_class_work_summary(bigint) from public, anon, authenticated;
grant execute on function public.get_class_work_summary(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
