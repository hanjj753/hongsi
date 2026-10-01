-- Firebase identity and staff authorization. Run after 001 on the development DB.
-- Only signed JWTs from the configured Firebase project reach these policies.
-- No account is provisioned or approved, and no sending credential is created here.
begin;

create function app_private.is_hongsi_firebase_user()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    auth.jwt()->>'iss' = 'https://securetoken.google.com/hongsi-assistant'
    and auth.jwt()->>'aud' = 'hongsi-assistant'
    and auth.jwt()->>'role' = 'authenticated'
    and auth.jwt()->>'email_verified' = 'true'
    and coalesce(auth.jwt()->>'sub', '') <> '', false
  );
$$;

-- SECURITY DEFINER prevents recursive RLS checks on staff and app_access.
-- Identity always comes from the verified token's subject, never request email.
create function app_private.current_staff_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s
  where (select app_private.is_hongsi_firebase_user())
    and s.firebase_uid = (select auth.jwt()->>'sub');
$$;

create function app_private.current_app_role()
returns text language sql stable security definer set search_path = '' as $$
  select a.app_role from public.app_access a join public.staff s on s.id = a.staff_id
  where s.id = (select app_private.current_staff_id())
    and s.employment_status = 'active' and a.access_status = 'approved';
$$;

create function app_private.can_manage()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select app_private.current_app_role()) in ('manager', 'admin'), false);
$$;

create function app_private.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select app_private.current_app_role()) = 'admin', false);
$$;

create function app_private.can_access_class_messages(target_class bigint, target_session bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select app_private.can_manage()) or (
    (select app_private.current_app_role()) = 'assistant' and (
      exists (select 1 from public.class_staff c where c.class_id = target_class
        and c.staff_id = (select app_private.current_staff_id()))
      or exists (select 1 from public.session_staff s join public.class_sessions c on c.id = s.session_id
        where s.session_id = target_session and c.class_id = target_class
          and s.staff_id = (select app_private.current_staff_id()))
    )
  );
$$;

revoke all on function app_private.is_hongsi_firebase_user() from public, anon, authenticated;
revoke all on function app_private.current_staff_id() from public, anon, authenticated;
revoke all on function app_private.current_app_role() from public, anon, authenticated;
revoke all on function app_private.can_manage() from public, anon, authenticated;
revoke all on function app_private.is_admin() from public, anon, authenticated;
revoke all on function app_private.can_access_class_messages(bigint, bigint) from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_hongsi_firebase_user(), app_private.current_staff_id(),
  app_private.current_app_role(), app_private.can_manage(), app_private.is_admin(),
  app_private.can_access_class_messages(bigint, bigint) to authenticated;

-- Returned IDs are text to avoid bigint precision loss in JavaScript.
create function public.get_my_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('staff_id', s.id::text, 'full_name', s.full_name,
    'app_role', a.app_role, 'access_status', coalesce(a.access_status, 'pending'),
    'employment_status', s.employment_status,
    'can_manage_devices', (select app_private.can_manage()),
    'can_manage_accounts', (select app_private.is_admin()))
  from public.staff s left join public.app_access a on a.staff_id = s.id
  where s.id = (select app_private.current_staff_id());
$$;
revoke all on function public.get_my_access() from public, anon, authenticated;
grant execute on function public.get_my_access() to authenticated;

-- Role/status changes are admin-only and cannot be made to the caller's own row.
-- A global lock serializes account management; recheck authority after acquiring it.
create function public.admin_set_access(target_staff_id bigint, new_role text, new_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(804211566696::bigint);
  if not app_private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if target_staff_id = app_private.current_staff_id() then
    raise exception 'Cannot change your own access' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff where id = target_staff_id and firebase_uid is not null) then
    raise exception 'Link a verified Firebase account before changing access' using errcode = '23514';
  end if;
  insert into public.app_access(staff_id, app_role, access_status)
    values (target_staff_id, new_role, new_status)
    on conflict (staff_id) do update set app_role = excluded.app_role, access_status = excluded.access_status;
end;
$$;
revoke all on function public.admin_set_access(bigint, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_access(bigint, text, text) to authenticated;

-- Client role cannot set audit actors, primary IDs, created_at, Firebase UID,
-- or access roles directly. Column grants below are deliberately narrow.
create function app_private.set_record_actor()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select app_private.is_hongsi_firebase_user()) then
    new.updated_by := app_private.current_staff_id();
  end if;
  return new;
end;
$$;
revoke all on function app_private.set_record_actor() from public, anon, authenticated;

create function app_private.set_device_registrar()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select app_private.is_hongsi_firebase_user()) then
    new.registered_by := app_private.current_staff_id();
  end if;
  return new;
end;
$$;
revoke all on function app_private.set_device_registrar() from public, anon, authenticated;
create trigger device_registrar before insert on public.sending_devices
  for each row execute function app_private.set_device_registrar();

create function app_private.set_inquiry_resolution()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select app_private.is_hongsi_firebase_user()) and new.status is distinct from old.status then
    new.resolved_at := case when new.status = 'resolved' then statement_timestamp() else null end;
    new.resolved_by := case when new.status = 'resolved' then app_private.current_staff_id() else null end;
  end if;
  return new;
end;
$$;
revoke all on function app_private.set_inquiry_resolution() from public, anon, authenticated;
create trigger inquiry_resolution before update on public.inquiries
  for each row execute function app_private.set_inquiry_resolution();

-- Employment status participates in login authorization. Managers must not
-- bypass admin-only suspension/approval by changing this field instead.
create function app_private.guard_employment_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select app_private.is_hongsi_firebase_user())
    and new.employment_status is distinct from old.employment_status
    and not (select app_private.is_admin()) then
    raise exception 'Only an administrator can change employment access status' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_employment_status() from public, anon, authenticated;
create trigger guard_employment_status before update on public.staff
  for each row execute function app_private.guard_employment_status();

do $$
declare t text; seq text;
begin
  -- Approved staff can read the working directory and all classes' student data.
  foreach t in array array['staff','locations','classes','class_staff','class_sessions',
    'session_staff','students','enrollments','student_session_records','session_homeworks',
    'student_homework_results','session_tests','student_test_results'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy approved_read on public.%I for select to authenticated '
      'using ((select app_private.current_app_role()) is not null)', t);
  end loop;
  foreach t in array array['staff','locations','classes','class_staff','class_sessions','session_staff','enrollments'] loop
    execute format('create policy management_insert on public.%I for insert to authenticated '
      'with check ((select app_private.can_manage()))', t);
    execute format('create policy management_update on public.%I for update to authenticated '
      'using ((select app_private.can_manage())) with check ((select app_private.can_manage()))', t);
  end loop;
  foreach t in array array['students','student_session_records','session_homeworks',
    'student_homework_results','session_tests','student_test_results'] loop
    execute format('create policy approved_insert on public.%I for insert to authenticated '
      'with check ((select app_private.current_app_role()) is not null)', t);
    execute format('create policy approved_update on public.%I for update to authenticated '
      'using ((select app_private.current_app_role()) is not null) '
      'with check ((select app_private.current_app_role()) is not null)', t);
    if t <> 'students' then
      execute format('create trigger set_record_actor before insert or update on public.%I '
        'for each row execute function app_private.set_record_actor()', t);
    end if;
  end loop;
  foreach t in array array['staff','locations','classes','class_sessions','students',
    'session_homeworks','session_tests','work_logs','inquiries'] loop
    seq := pg_get_serial_sequence(format('public.%I', t), 'id');
    execute format('grant usage on sequence %s to authenticated', seq);
  end loop;
end;
$$;

grant insert (full_name,email,phone,positions,duties,employment_status,started_on,notes),
  update (full_name,email,phone,positions,duties,employment_status,started_on,notes) on public.staff to authenticated;
grant insert (name,latitude,longitude,notes), update (name,latitude,longitude,notes) on public.locations to authenticated;
grant insert (class_code,term_label,school,subject,location_id,weekdays,default_start_time,default_end_time,default_hourly_rate_krw,is_active),
  update (class_code,term_label,school,subject,location_id,weekdays,default_start_time,default_end_time,default_hourly_rate_krw,is_active)
  on public.classes to authenticated;
grant insert (class_id,staff_id) on public.class_staff to authenticated;
grant insert (class_id,session_number,session_date,start_time,end_time,location_id,notes),
  update (session_number,session_date,start_time,end_time,location_id,notes) on public.class_sessions to authenticated;
grant insert (session_id,staff_id) on public.session_staff to authenticated;
grant insert (class_id,student_id,joined_on,ended_on), update (joined_on,ended_on) on public.enrollments to authenticated;
grant insert (student_code,full_name,student_phone,parent_phone,email,default_message_recipients),
  update (student_code,full_name,student_phone,parent_phone,email,default_message_recipients) on public.students to authenticated;
grant insert (session_id,student_id,class_id,attendance_status,makeup_date,makeup_time,makeup_note,notes),
  update (attendance_status,makeup_date,makeup_time,makeup_note,notes) on public.student_session_records to authenticated;
grant insert (class_id,session_id,title,sort_order,notes), update (title,sort_order,notes) on public.session_homeworks to authenticated;
grant insert (homework_id,student_id,class_id,grade,notes), update (grade,notes) on public.student_homework_results to authenticated;
grant insert (class_id,session_id,title,max_score,sort_order,notes), update (title,max_score,sort_order,notes) on public.session_tests to authenticated;
grant insert (test_id,student_id,class_id,score,status,notes), update (score,status,notes) on public.student_test_results to authenticated;

grant select on public.app_access to authenticated;
create policy own_or_admin_access_read on public.app_access for select to authenticated
  using (staff_id = (select app_private.current_staff_id()) or (select app_private.is_admin()));

grant select, insert (staff_id,bank_account), update (bank_account) on public.staff_private_details to authenticated;
create policy admin_bank_read on public.staff_private_details for select to authenticated using ((select app_private.is_admin()));
create policy admin_bank_insert on public.staff_private_details for insert to authenticated with check ((select app_private.is_admin()));
create policy admin_bank_update on public.staff_private_details for update to authenticated
  using ((select app_private.is_admin())) with check ((select app_private.is_admin()));

grant select, insert (label,legacy_device_id,is_enabled), update (label,legacy_device_id,is_enabled)
  on public.sending_devices to authenticated;
create policy management_devices_read on public.sending_devices for select to authenticated using ((select app_private.can_manage()));
create policy management_devices_insert on public.sending_devices for insert to authenticated with check ((select app_private.can_manage()));
create policy management_devices_update on public.sending_devices for update to authenticated
  using ((select app_private.can_manage())) with check ((select app_private.can_manage()));

grant select, insert (staff_id,class_id,session_id,work_label,started_at,ended_at,hourly_rate_krw,checkin_location,notes),
  update (staff_id,class_id,session_id,work_label,started_at,ended_at,hourly_rate_krw,checkin_location,notes)
  on public.work_logs to authenticated;
create policy work_read on public.work_logs for select to authenticated using (
  (select app_private.can_manage()) or
  ((select app_private.current_app_role()) is not null and staff_id = (select app_private.current_staff_id()))
);
create policy work_management_insert on public.work_logs for insert to authenticated with check ((select app_private.can_manage()));
create policy work_management_update on public.work_logs for update to authenticated
  using ((select app_private.can_manage())) with check ((select app_private.can_manage()));

grant select, insert (requester_staff_id,content), update (status) on public.inquiries to authenticated;
create policy inquiry_read on public.inquiries for select to authenticated using (
  (select app_private.can_manage()) or
  ((select app_private.current_app_role()) is not null and requester_staff_id = (select app_private.current_staff_id()))
);
create policy inquiry_insert on public.inquiries for insert to authenticated with check (
  (select app_private.current_app_role()) is not null and requester_staff_id = (select app_private.current_staff_id())
  and status = 'open' and resolved_by is null and resolved_at is null
);
create policy inquiry_resolve on public.inquiries for update to authenticated
  using ((select app_private.can_manage())) with check ((select app_private.can_manage()));

-- Read access only for messages. Creation, claims and delivery transitions must
-- go through dedicated RPCs once device authentication is implemented.
grant select on public.messages, public.message_deliveries to authenticated;
create policy class_messages_read on public.messages for select to authenticated
  using (app_private.can_access_class_messages(class_id, session_id));
create policy class_deliveries_read on public.message_deliveries for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

comment on table public.sending_devices is '매니저·관리자가 등록/허용/차단. 등록 목록과 실제 발송 기기 인증은 별개이며 발송 RPC는 아직 닫혀 있음.';
comment on function public.get_my_access() is '검증된 Firebase UID의 연결/승인 상태. 미등록이면 NULL. 계정 자동 생성/승인은 하지 않음.';
notify pgrst, 'reload schema';
commit;
