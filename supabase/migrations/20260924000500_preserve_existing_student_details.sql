-- Keep the global student profile intact when an existing student is enrolled
-- in another class through the "new student" form.
-- Run after 20260924000400_student_records_rpc.sql.
begin;

create or replace function public.register_student_and_enroll(
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

  if target_student_id is null then
    select id, full_name into resolved_student_id, existing_name
      from public.students where student_code = new_student_code for update;
    if resolved_student_id is not null and existing_name <> new_full_name then
      raise exception 'Student code already belongs to another name' using errcode = '23514';
    end if;
    if resolved_student_id is null then
      if new_default_message_recipients = 'both'
        and nullif(btrim(coalesce(new_student_phone, '')), '') is null then
        raise exception 'Student phone is required when both recipients are selected' using errcode = '23514';
      end if;
      insert into public.students(student_code, full_name, student_phone, parent_phone, email, default_message_recipients)
      values (new_student_code, new_full_name,
        nullif(btrim(coalesce(new_student_phone, '')), ''),
        nullif(btrim(coalesce(new_parent_phone, '')), ''),
        nullif(lower(btrim(coalesce(new_email, ''))), ''),
        new_default_message_recipients)
      returning id into resolved_student_id;
    end if;
  else
    if new_default_message_recipients = 'both'
      and nullif(btrim(coalesce(new_student_phone, '')), '') is null then
      raise exception 'Student phone is required when both recipients are selected' using errcode = '23514';
    end if;
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

comment on function public.register_student_and_enroll(bigint,bigint,text,text,text,text,text,text,date)
  is '매니저·관리자가 학생 생성/수정과 수업 배정을 원자적으로 처리. 기존 학생 코드를 새 수업에 배정할 때 전역 학생 정보는 보존.';

notify pgrst, 'reload schema';
commit;
