-- Atomic student enrollment and per-student session record writes.
-- Run after 20260923000300_remove_class_code.sql.
begin;

create function public.register_student_and_enroll(
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
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_student_id bigint;
  existing_name text;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.classes where id = target_class_id) then
    raise exception 'Class not found' using errcode = 'P0002';
  end if;
  new_student_code := btrim(coalesce(new_student_code, ''));
  new_full_name := btrim(coalesce(new_full_name, ''));
  if new_student_code = '' or new_full_name = '' then
    raise exception 'Student code and name are required' using errcode = '23514';
  end if;
  if new_default_message_recipients not in ('parent', 'both') then
    raise exception 'Invalid message recipient preference' using errcode = '23514';
  end if;
  if new_default_message_recipients = 'both' and nullif(btrim(coalesce(new_student_phone, '')), '') is null then
    raise exception 'Student phone is required when both recipients are selected' using errcode = '23514';
  end if;

  if target_student_id is null then
    select id, full_name into resolved_student_id, existing_name
      from public.students where student_code = new_student_code for update;
    if resolved_student_id is not null and existing_name <> new_full_name then
      raise exception 'Student code already belongs to another name' using errcode = '23514';
    end if;
    if resolved_student_id is null then
      insert into public.students(student_code, full_name, student_phone, parent_phone, email, default_message_recipients)
      values (new_student_code, new_full_name,
        nullif(btrim(coalesce(new_student_phone, '')), ''),
        nullif(btrim(coalesce(new_parent_phone, '')), ''),
        nullif(lower(btrim(coalesce(new_email, ''))), ''),
        new_default_message_recipients)
      returning id into resolved_student_id;
    else
      update public.students set
        student_phone = nullif(btrim(coalesce(new_student_phone, '')), ''),
        parent_phone = nullif(btrim(coalesce(new_parent_phone, '')), ''),
        email = nullif(lower(btrim(coalesce(new_email, ''))), ''),
        default_message_recipients = new_default_message_recipients
      where id = resolved_student_id;
    end if;
  else
    update public.students set
      student_code = new_student_code,
      full_name = new_full_name,
      student_phone = nullif(btrim(coalesce(new_student_phone, '')), ''),
      parent_phone = nullif(btrim(coalesce(new_parent_phone, '')), ''),
      email = nullif(lower(btrim(coalesce(new_email, ''))), ''),
      default_message_recipients = new_default_message_recipients
    where id = target_student_id
    returning id into resolved_student_id;
    if resolved_student_id is null then
      raise exception 'Student not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.enrollments(class_id, student_id, joined_on, ended_on)
    values (target_class_id, resolved_student_id, coalesce(new_joined_on, current_date), null)
    on conflict (class_id, student_id) do update set
      joined_on = least(public.enrollments.joined_on, excluded.joined_on),
      ended_on = null;
  return resolved_student_id::text;
end;
$$;

revoke all on function public.register_student_and_enroll(bigint,bigint,text,text,text,text,text,text,date)
  from public, anon, authenticated;
grant execute on function public.register_student_and_enroll(bigint,bigint,text,text,text,text,text,text,date)
  to authenticated;

create function public.save_student_session_draft(
  target_class_id bigint,
  target_session_id bigint,
  target_student_id bigint,
  attendance jsonb,
  homework_results jsonb,
  test_results jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  item_id bigint;
  attendance_status text;
  grade_value text;
  score_value numeric;
  status_value text;
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.class_sessions
    where id = target_session_id and class_id = target_class_id
  ) then
    raise exception 'Session does not belong to class' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.enrollments
    where class_id = target_class_id and student_id = target_student_id
  ) then
    raise exception 'Student is not enrolled in class' using errcode = '23503';
  end if;

  if attendance is not null then
    attendance_status := nullif(attendance->>'status', '');
    if attendance_status is null
      and nullif(attendance->>'makeup_date', '') is null
      and nullif(attendance->>'makeup_time', '') is null
      and nullif(attendance->>'makeup_note', '') is null
      and nullif(attendance->>'notes', '') is null then
      delete from public.student_session_records
        where session_id = target_session_id and student_id = target_student_id;
    else
      insert into public.student_session_records(
        class_id, session_id, student_id, attendance_status,
        makeup_date, makeup_time, makeup_note, notes
      ) values (
        target_class_id, target_session_id, target_student_id, attendance_status,
        case when attendance_status = '보강' then nullif(attendance->>'makeup_date', '')::date else null end,
        case when attendance_status = '보강' then nullif(attendance->>'makeup_time', '')::time else null end,
        case when attendance_status = '보강' then nullif(btrim(attendance->>'makeup_note'), '') else null end,
        nullif(btrim(attendance->>'notes'), '')
      )
      on conflict (session_id, student_id) do update set
        attendance_status = excluded.attendance_status,
        makeup_date = excluded.makeup_date,
        makeup_time = excluded.makeup_time,
        makeup_note = excluded.makeup_note,
        notes = excluded.notes;
    end if;
  end if;

  for item in select value from jsonb_array_elements(coalesce(homework_results, '[]'::jsonb)) loop
    item_id := (item->>'homework_id')::bigint;
    if not exists (select 1 from public.session_homeworks where id = item_id and class_id = target_class_id and session_id = target_session_id) then
      raise exception 'Homework does not belong to session' using errcode = '23503';
    end if;
    grade_value := nullif(item->>'grade', '');
    if grade_value is null then
      delete from public.student_homework_results where homework_id = item_id and student_id = target_student_id;
    else
      insert into public.student_homework_results(class_id, homework_id, student_id, grade, notes)
      values (target_class_id, item_id, target_student_id, grade_value, nullif(btrim(item->>'notes'), ''))
      on conflict (homework_id, student_id) do update set grade = excluded.grade, notes = excluded.notes;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(test_results, '[]'::jsonb)) loop
    item_id := (item->>'test_id')::bigint;
    if not exists (select 1 from public.session_tests where id = item_id and class_id = target_class_id and session_id = target_session_id) then
      raise exception 'Test does not belong to session' using errcode = '23503';
    end if;
    status_value := nullif(item->>'status', '');
    score_value := case when item->>'score' is null then null else (item->>'score')::numeric end;
    if status_value is null and score_value is null then
      delete from public.student_test_results where test_id = item_id and student_id = target_student_id;
    else
      insert into public.student_test_results(class_id, test_id, student_id, score, status, notes)
      values (target_class_id, item_id, target_student_id,
        case when status_value = '결시' then null else score_value end,
        status_value, nullif(btrim(item->>'notes'), ''))
      on conflict (test_id, student_id) do update set
        score = excluded.score, status = excluded.status, notes = excluded.notes;
    end if;
  end loop;
end;
$$;

revoke all on function public.save_student_session_draft(bigint,bigint,bigint,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_student_session_draft(bigint,bigint,bigint,jsonb,jsonb,jsonb)
  to authenticated;

comment on function public.register_student_and_enroll(bigint,bigint,text,text,text,text,text,text,date)
  is '매니저·관리자가 학생 생성/갱신과 수업 배정을 한 트랜잭션으로 처리.';
comment on function public.save_student_session_draft(bigint,bigint,bigint,jsonb,jsonb,jsonb)
  is '승인된 조교가 학생 한 명의 출석·숙제·시험 변경분을 원자적으로 저장. 빈 결과는 미입력으로 복원.';

notify pgrst, 'reload schema';
commit;
