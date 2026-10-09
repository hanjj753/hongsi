-- Save bank accounts atomically without granting updates to the staff_id key.
-- Calculate work duration from displayed minute boundaries, ignoring seconds.
begin;

create function public.admin_save_staff_bank_account(target_staff_id bigint, target_bank_account text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_admin() then
    raise exception 'Administrator account required' using errcode = '42501';
  end if;

  insert into public.staff_private_details(staff_id, bank_account)
  values (target_staff_id, nullif(btrim(target_bank_account), ''))
  on conflict (staff_id) do update
    set bank_account = excluded.bank_account;
end;
$$;
revoke all on function public.admin_save_staff_bank_account(bigint,text) from public, anon, authenticated;
grant execute on function public.admin_save_staff_bank_account(bigint,text) to authenticated;

alter table public.work_logs drop column duration_minutes;
alter table public.work_logs add column duration_minutes integer generated always as (
  (extract(epoch from (
    date_trunc('minute', ended_at at time zone 'UTC')
    - date_trunc('minute', started_at at time zone 'UTC')
  )) / 60)::integer
) stored;

notify pgrst, 'reload schema';
commit;

