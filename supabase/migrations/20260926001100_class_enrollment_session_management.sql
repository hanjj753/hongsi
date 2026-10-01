-- Permanent cleanup, class-level default staff, enrollment dates, and session editing.
-- Run after 20260926001000_link_makeup_sessions.sql.
begin;

create function public.save_managed_class_with_staff(
  target_class_id bigint,
  target_term_label text,
  target_school text,
  target_subject text,
  target_location_id bigint,
  target_weekdays smallint[],
  target_start_time time,
  target_end_time time,
  target_hourly_rate_krw integer,
  target_is_active boolean,
  target_staff_ids bigint[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_id bigint;
  clean_term text := btrim(coalesce(target_term_label, ''));
  clean_school text := nullif(btrim(coalesce(target_school, '')), '');
  clean_subject text := nullif(btrim(coalesce(target_subject, '')), '');
  requested_staff_count integer;
  inserted_staff_count integer;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if clean_term = '' or not exists (
    select 1 from public.class_terms where label = clean_term and is_active
  ) then
    raise exception 'Active term not found' using errcode = '23514';
  end if;
  if clean_school is null and clean_subject is null then
    raise exception 'School or subject is required' using errcode = '23514';
  end if;
  if (target_start_time is null) <> (target_end_time is null) then
    raise exception 'Start and end time must be entered together' using errcode = '23514';
  end if;
  if target_hourly_rate_krw is not null and target_hourly_rate_krw < 0 then
    raise exception 'Hourly rate cannot be negative' using errcode = '23514';
  end if;
  select count(distinct staff_id) into requested_staff_count
  from unnest(coalesce(target_staff_ids, '{}'::bigint[])) requested(staff_id);
  if requested_staff_count <> cardinality(coalesce(target_staff_ids, '{}'::bigint[])) then
    raise exception 'Scheduled worker IDs must be unique' using errcode = '23514';
  end if;

  if target_class_id is null then
    insert into public.classes(
      term_label, school, subject, location_id, weekdays,
      default_start_time, default_end_time, default_hourly_rate_krw, is_active
    ) values (
      clean_term, clean_school, clean_subject, target_location_id,
      coalesce(target_weekdays, '{}'::smallint[]), target_start_time, target_end_time,
      target_hourly_rate_krw, coalesce(target_is_active, true)
    ) returning id into resolved_id;
  else
    update public.classes set
      term_label = clean_term,
      school = clean_school,
      subject = clean_subject,
      location_id = target_location_id,
      weekdays = coalesce(target_weekdays, '{}'::smallint[]),
      default_start_time = target_start_time,
      default_end_time = target_end_time,
      default_hourly_rate_krw = target_hourly_rate_krw,
      is_active = coalesce(target_is_active, true)
    where id = target_class_id
    returning id into resolved_id;
    if resolved_id is null then
      raise exception 'Class not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.class_staff where class_id = resolved_id;
  insert into public.class_staff(class_id, staff_id)
  select resolved_id, s.id
  from public.staff s
  join unnest(coalesce(target_staff_ids, '{}'::bigint[])) requested(staff_id)
    on requested.staff_id = s.id
  where s.employment_status = 'active';
  get diagnostics inserted_staff_count = row_count;
  if inserted_staff_count <> requested_staff_count then
    raise exception 'Every default worker must be an active staff member' using errcode = '23514';
  end if;
  return resolved_id::text;
end;
$$;

create function public.update_enrollment_start_date(
  target_class_id bigint,
  target_student_id bigint,
  new_joined_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_ended_on date;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if new_joined_on is null then
    raise exception 'Start date is required' using errcode = '23514';
  end if;
  select ended_on into resolved_ended_on
  from public.enrollments
  where class_id = target_class_id and student_id = target_student_id
  for update;
  if not found then
    raise exception 'Enrollment not found' using errcode = 'P0002';
  end if;
  if resolved_ended_on is not null and new_joined_on > resolved_ended_on then
    raise exception 'Start date cannot be after the enrollment end date' using errcode = '23514';
  end if;
  if exists (
    select 1
    from (
      select r.session_id from public.student_session_records r
        where r.class_id = target_class_id and r.student_id = target_student_id
      union
      select h.session_id from public.student_homework_results r
        join public.session_homeworks h on h.id = r.homework_id
        where r.class_id = target_class_id and r.student_id = target_student_id
      union
      select t.session_id from public.student_test_results r
        join public.session_tests t on t.id = r.test_id
        where r.class_id = target_class_id and r.student_id = target_student_id
      union
      select sp.home_session_id from public.session_participants sp
        where sp.home_class_id = target_class_id and sp.student_id = target_student_id
          and sp.home_session_id is not null
    ) saved
    join public.class_sessions cs on cs.id = saved.session_id
    where cs.session_date < new_joined_on
  ) then
    raise exception 'Start date cannot be later than an existing student record' using errcode = '23514';
  end if;
  update public.enrollments set joined_on = new_joined_on
  where class_id = target_class_id and student_id = target_student_id;
end;
$$;

create function public.update_class_session(
  target_class_id bigint,
  target_session_id bigint,
  new_session_date date,
  new_notes text,
  target_staff_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  relation public.session_participants%rowtype;
  resolved_start_time time;
  requested_staff_count integer;
  inserted_staff_count integer;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if new_session_date is null then
    raise exception 'Session date is required' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.class_sessions
    where id = target_session_id and class_id = target_class_id
    for update
  ) then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  select count(distinct staff_id) into requested_staff_count
  from unnest(coalesce(target_staff_ids, '{}'::bigint[])) requested(staff_id);
  if requested_staff_count <> cardinality(coalesce(target_staff_ids, '{}'::bigint[])) then
    raise exception 'Scheduled worker IDs must be unique' using errcode = '23514';
  end if;

  update public.class_sessions
  set session_date = new_session_date,
      notes = nullif(btrim(coalesce(new_notes, '')), '')
  where id = target_session_id and class_id = target_class_id;

  if exists (
    select 1
    from (
      select student_id from public.student_session_records where session_id = target_session_id
      union
      select r.student_id from public.student_homework_results r
        join public.session_homeworks h on h.id = r.homework_id
        where h.session_id = target_session_id
      union
      select r.student_id from public.student_test_results r
        join public.session_tests t on t.id = r.test_id
        where t.session_id = target_session_id
    ) saved
    where not app_private.student_can_record(target_class_id, target_session_id, saved.student_id)
  ) then
    raise exception 'New session date falls outside an existing student enrollment' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.session_participants sp
    join public.enrollments e
      on e.class_id = sp.home_class_id and e.student_id = sp.student_id
    where sp.home_session_id = target_session_id
      and (e.joined_on is not null and e.joined_on > new_session_date
        or e.ended_on is not null and e.ended_on < new_session_date)
  ) then
    raise exception 'New session date falls outside a makeup student enrollment' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.session_participants sp
    join public.enrollments e
      on e.class_id = sp.host_class_id and e.student_id = sp.student_id
    where sp.session_id = target_session_id
      and (e.joined_on is null or e.joined_on <= new_session_date)
      and (e.ended_on is null or e.ended_on >= new_session_date)
  ) then
    raise exception 'A makeup student is enrolled in the host class on the new date' using errcode = '23514';
  end if;

  select coalesce(cs.start_time, c.default_start_time) into resolved_start_time
  from public.class_sessions cs join public.classes c on c.id = cs.class_id
  where cs.id = target_session_id and cs.class_id = target_class_id;
  for relation in
    select * from public.session_participants where session_id = target_session_id for update
  loop
    delete from public.session_participants
    where session_id = relation.session_id and student_id = relation.student_id;
    update public.student_session_records set
      makeup_date = new_session_date,
      makeup_time = resolved_start_time,
      updated_by = app_private.current_staff_id(),
      updated_at = now()
    where session_id = relation.home_session_id
      and student_id = relation.student_id
      and makeup_host_session_id = target_session_id;
    insert into public.session_participants(
      session_id, student_id, host_class_id, home_class_id, participation_type,
      notes, created_by, created_at, home_session_id
    ) values (
      relation.session_id, relation.student_id, relation.host_class_id, relation.home_class_id,
      relation.participation_type, relation.notes, relation.created_by, relation.created_at,
      relation.home_session_id
    );
  end loop;

  delete from public.session_staff where session_id = target_session_id;
  insert into public.session_staff(session_id, staff_id)
  select target_session_id, s.id
  from public.staff s
  join unnest(coalesce(target_staff_ids, '{}'::bigint[])) requested(staff_id)
    on requested.staff_id = s.id
  where s.employment_status = 'active';
  get diagnostics inserted_staff_count = row_count;
  if inserted_staff_count <> requested_staff_count then
    raise exception 'Every scheduled worker must be an active staff member' using errcode = '23514';
  end if;
end;
$$;

create function public.delete_class_session(
  target_class_id bigint,
  target_session_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  relation record;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.class_sessions
    where id = target_session_id and class_id = target_class_id
    for update
  ) then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;

  for relation in
    select host_class_id, session_id, student_id
    from public.session_participants
    where session_id = target_session_id or home_session_id = target_session_id
  loop
    perform public.remove_makeup_participant(
      relation.host_class_id, relation.session_id, relation.student_id
    );
  end loop;

  delete from public.messages where class_id = target_class_id and session_id = target_session_id;
  update public.work_logs set session_id = null
  where class_id = target_class_id and session_id = target_session_id;
  delete from public.student_homework_results r using public.session_homeworks h
  where r.homework_id = h.id and h.class_id = target_class_id and h.session_id = target_session_id;
  delete from public.student_test_results r using public.session_tests t
  where r.test_id = t.id and t.class_id = target_class_id and t.session_id = target_session_id;
  delete from public.student_session_records
  where class_id = target_class_id and session_id = target_session_id;
  delete from public.session_homeworks
  where class_id = target_class_id and session_id = target_session_id;
  delete from public.session_tests
  where class_id = target_class_id and session_id = target_session_id;
  delete from public.session_staff where session_id = target_session_id;
  delete from public.class_sessions
  where id = target_session_id and class_id = target_class_id;
end;
$$;

create function public.delete_class_enrollment(
  target_class_id bigint,
  target_student_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  relation record;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.enrollments
    where class_id = target_class_id and student_id = target_student_id
    for update
  ) then
    raise exception 'Enrollment not found' using errcode = 'P0002';
  end if;

  for relation in
    select host_class_id, session_id, student_id
    from public.session_participants
    where home_class_id = target_class_id and student_id = target_student_id
  loop
    perform public.remove_makeup_participant(
      relation.host_class_id, relation.session_id, relation.student_id
    );
  end loop;

  delete from public.messages
  where class_id = target_class_id and student_id = target_student_id;
  delete from public.student_homework_results
  where class_id = target_class_id and student_id = target_student_id;
  delete from public.student_test_results
  where class_id = target_class_id and student_id = target_student_id;
  delete from public.student_session_records
  where class_id = target_class_id and student_id = target_student_id;
  update public.enrollments set
    enrollment_status = 'withdrawn',
    transferred_to_class_id = null,
    status_changed_on = coalesce(status_changed_on, ended_on)
  where student_id = target_student_id
    and transferred_to_class_id = target_class_id;
  delete from public.enrollments
  where class_id = target_class_id and student_id = target_student_id;
end;
$$;

create function public.delete_managed_class(target_class_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  relation record;
  target_session record;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.classes where id = target_class_id and not is_active for update
  ) then
    raise exception 'Archived class not found' using errcode = 'P0002';
  end if;

  for relation in
    select host_class_id, session_id, student_id
    from public.session_participants
    where host_class_id = target_class_id or home_class_id = target_class_id
  loop
    perform public.remove_makeup_participant(
      relation.host_class_id, relation.session_id, relation.student_id
    );
  end loop;
  for target_session in
    select id from public.class_sessions where class_id = target_class_id order by id
  loop
    perform public.delete_class_session(target_class_id, target_session.id);
  end loop;

  delete from public.messages where class_id = target_class_id;
  update public.work_logs set class_id = null, session_id = null
  where class_id = target_class_id;
  update public.enrollments set
    enrollment_status = 'withdrawn',
    transferred_to_class_id = null,
    status_changed_on = coalesce(status_changed_on, ended_on)
  where transferred_to_class_id = target_class_id;
  delete from public.student_homework_results where class_id = target_class_id;
  delete from public.student_test_results where class_id = target_class_id;
  delete from public.student_session_records where class_id = target_class_id;
  delete from public.enrollments where class_id = target_class_id;
  delete from public.class_staff where class_id = target_class_id;
  delete from public.classes where id = target_class_id;
end;
$$;

create function public.update_student_and_enrollment(
  target_class_id bigint,
  target_student_id bigint,
  new_student_code text,
  new_full_name text,
  new_student_phone text,
  new_parent_phone text,
  new_email text,
  new_default_message_recipients text,
  new_joined_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(new_student_code, '')), '') is null
    or nullif(btrim(coalesce(new_full_name, '')), '') is null then
    raise exception 'Student code and name are required' using errcode = '23514';
  end if;
  update public.students set
    student_code = btrim(new_student_code),
    full_name = btrim(new_full_name),
    student_phone = nullif(btrim(coalesce(new_student_phone, '')), ''),
    parent_phone = nullif(btrim(coalesce(new_parent_phone, '')), ''),
    email = nullif(lower(btrim(coalesce(new_email, ''))), ''),
    default_message_recipients = new_default_message_recipients
  where id = target_student_id;
  if not found then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;
  perform public.update_enrollment_start_date(
    target_class_id, target_student_id, new_joined_on
  );
end;
$$;

revoke all on function public.save_managed_class_with_staff(bigint,text,text,text,bigint,smallint[],time,time,integer,boolean,bigint[]),
  public.update_enrollment_start_date(bigint,bigint,date),
  public.update_class_session(bigint,bigint,date,text,bigint[]),
  public.delete_class_session(bigint,bigint),
  public.delete_class_enrollment(bigint,bigint),
  public.delete_managed_class(bigint),
  public.update_student_and_enrollment(bigint,bigint,text,text,text,text,text,text,date)
  from public, anon, authenticated;
grant execute on function public.save_managed_class_with_staff(bigint,text,text,text,bigint,smallint[],time,time,integer,boolean,bigint[]),
  public.update_enrollment_start_date(bigint,bigint,date),
  public.update_class_session(bigint,bigint,date,text,bigint[]),
  public.delete_class_session(bigint,bigint),
  public.delete_class_enrollment(bigint,bigint),
  public.delete_managed_class(bigint),
  public.update_student_and_enrollment(bigint,bigint,text,text,text,text,text,text,date)
  to authenticated;

comment on function public.delete_managed_class(bigint)
  is '보관 처리된 수업의 학생·차시·성적·문자·보강 연결을 영구 삭제. 근무 기록은 수업 연결만 해제해 보존.';
comment on function public.delete_class_enrollment(bigint,bigint)
  is '한 수업에서 학생의 수강과 해당 수업 기록을 영구 삭제. 전역 학생 정보와 다른 수업 기록은 보존.';

notify pgrst, 'reload schema';
commit;
