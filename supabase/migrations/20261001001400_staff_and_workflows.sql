-- Link a pre-registered staff email to its verified Firebase user and enable
-- self-service shifts. Account approval and bank details remain admin-only.
begin;

create function public.link_my_staff_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  matched_staff_id bigint;
  verified_email text;
begin
  if not app_private.is_hongsi_firebase_user() then
    raise exception 'Verified Firebase account required' using errcode = '42501';
  end if;
  verified_email := lower(btrim(auth.jwt()->>'email'));
  if verified_email is null or verified_email = '' then
    return null;
  end if;

  select id into matched_staff_id from public.staff
    where firebase_uid = auth.jwt()->>'sub';
  if matched_staff_id is null then
    update public.staff set firebase_uid = auth.jwt()->>'sub'
      where email = verified_email and firebase_uid is null
      returning id into matched_staff_id;
    if matched_staff_id is null then return null; end if;
  end if;

  insert into public.app_access(staff_id,app_role,access_status)
    values (matched_staff_id,'assistant','pending')
    on conflict (staff_id) do nothing;
  return public.get_my_access();
end;
$$;
revoke all on function public.link_my_staff_account() from public, anon, authenticated;
grant execute on function public.link_my_staff_account() to authenticated;

create function public.start_my_work_shift(target_class_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  worker_id bigint;
  existing_id bigint;
  existing_class_id bigint;
  target_label text;
  target_rate integer;
begin
  worker_id := app_private.current_staff_id();
  if worker_id is null or app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(worker_id);
  select id,class_id into existing_id,existing_class_id from public.work_logs
    where staff_id=worker_id and ended_at is null for update;
  if existing_id is not null then
    if existing_class_id = target_class_id then return existing_id; end if;
    raise exception 'Already working in another class' using errcode = '23514';
  end if;
  select concat_ws(' ',nullif(btrim(school),''),nullif(btrim(subject),''),day_part),
    default_hourly_rate_krw into target_label,target_rate
    from public.classes where id=target_class_id and is_active;
  if not found then
    raise exception 'Active class not found' using errcode = 'P0002';
  end if;
  insert into public.work_logs(staff_id,class_id,work_label,started_at,hourly_rate_krw)
    values (worker_id,target_class_id,target_label,statement_timestamp(),target_rate)
    returning id into existing_id;
  return existing_id;
end;
$$;
revoke all on function public.start_my_work_shift(bigint) from public, anon, authenticated;
grant execute on function public.start_my_work_shift(bigint) to authenticated;

create function public.finish_my_work_shift()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  worker_id bigint;
  finished_id bigint;
begin
  worker_id := app_private.current_staff_id();
  if worker_id is null or app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  update public.work_logs set ended_at=greatest(statement_timestamp(),started_at)
    where staff_id=worker_id and ended_at is null returning id into finished_id;
  if finished_id is null then
    raise exception 'No open shift found' using errcode = 'P0002';
  end if;
  return finished_id;
end;
$$;
revoke all on function public.finish_my_work_shift() from public, anon, authenticated;
grant execute on function public.finish_my_work_shift() to authenticated;

-- Managers can correct/remove recorded shifts; assistants only see their own.
grant delete on public.work_logs to authenticated;
create policy work_management_delete on public.work_logs for delete to authenticated
  using ((select app_private.can_manage()));

notify pgrst, 'reload schema';
commit;
