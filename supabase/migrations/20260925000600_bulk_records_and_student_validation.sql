-- Bulk session entry, automatic student codes, and contact validation.
-- Run after 20260924000500_preserve_existing_student_details.sql.
begin;

create function app_private.normalize_student_contacts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_phone text;
begin
  new.student_code := btrim(coalesce(new.student_code, ''));
  new.full_name := btrim(coalesce(new.full_name, ''));
  if new.student_code = '' or new.full_name = '' then
    raise exception 'Student code and name are required' using errcode = '23514';
  end if;

  if nullif(btrim(coalesce(new.student_phone, '')), '') is null then
    new.student_phone := null;
  else
    if new.student_phone !~ '^[0-9()+ -]+$' then
      raise exception 'Invalid student phone format' using errcode = '23514';
    end if;
    normalized_phone := regexp_replace(new.student_phone, '[^0-9]', '', 'g');
    if normalized_phone !~ '^01[016789][0-9]{7,8}$' then
      raise exception 'Invalid student phone format' using errcode = '23514';
    end if;
    new.student_phone := normalized_phone;
  end if;

  if nullif(btrim(coalesce(new.parent_phone, '')), '') is null then
    new.parent_phone := null;
  else
    if new.parent_phone !~ '^[0-9()+ -]+$' then
      raise exception 'Invalid parent phone format' using errcode = '23514';
    end if;
    normalized_phone := regexp_replace(new.parent_phone, '[^0-9]', '', 'g');
    if normalized_phone !~ '^01[016789][0-9]{7,8}$' then
      raise exception 'Invalid parent phone format' using errcode = '23514';
    end if;
    new.parent_phone := normalized_phone;
  end if;

  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  if new.email is not null and new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid student email format' using errcode = '23514';
  end if;
  if new.default_message_recipients = 'both' and new.student_phone is null then
    raise exception 'Student phone is required when both recipients are selected' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger normalize_student_contacts_on_write
before insert or update of student_code, full_name, student_phone, parent_phone, email, default_message_recipients
on public.students
for each row execute function app_private.normalize_student_contacts();

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
  if new_full_name = '' then
    raise exception 'Student name is required' using errcode = '23514';
  end if;
  if new_default_message_recipients not in ('parent', 'both') then
    raise exception 'Invalid message recipient preference' using errcode = '23514';
  end if;

  if target_student_id is null then
    if new_student_code = '' then
      loop
        new_student_code := 'S' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
        exit when not exists (select 1 from public.students where student_code = new_student_code);
      end loop;
    end if;

    select id, full_name into resolved_student_id, existing_name
      from public.students where student_code = new_student_code for update;
    if resolved_student_id is not null and existing_name <> new_full_name then
      raise exception 'Student code already belongs to another name' using errcode = '23514';
    end if;
    if resolved_student_id is null then
      insert into public.students(student_code, full_name, student_phone, parent_phone, email, default_message_recipients)
      values (new_student_code, new_full_name, new_student_phone, new_parent_phone, new_email, new_default_message_recipients)
      returning id into resolved_student_id;
    end if;
  else
    update public.students set
      student_code = new_student_code,
      full_name = new_full_name,
      student_phone = new_student_phone,
      parent_phone = new_parent_phone,
      email = new_email,
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

create function public.save_session_roster_draft(
  target_class_id bigint,
  target_session_id bigint,
  student_drafts jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  student_id bigint;
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  if jsonb_typeof(student_drafts) <> 'array' then
    raise exception 'Student drafts must be an array' using errcode = '23514';
  end if;
  if jsonb_array_length(student_drafts) > 500 then
    raise exception 'Too many student drafts' using errcode = '23514';
  end if;
  if (
    select count(*) from jsonb_array_elements(student_drafts)
  ) <> (
    select count(distinct value->>'student_id') from jsonb_array_elements(student_drafts)
  ) then
    raise exception 'Duplicate student draft' using errcode = '23514';
  end if;

  for item in select value from jsonb_array_elements(student_drafts) loop
    student_id := (item->>'student_id')::bigint;
    perform public.save_student_session_draft(
      target_class_id,
      target_session_id,
      student_id,
      item->'attendance',
      coalesce(item->'homework_results', '[]'::jsonb),
      coalesce(item->'test_results', '[]'::jsonb)
    );
  end loop;
end;
$$;

revoke all on function public.save_session_roster_draft(bigint,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_session_roster_draft(bigint,bigint,jsonb)
  to authenticated;

comment on function public.save_session_roster_draft(bigint,bigint,jsonb)
  is '한 차시의 여러 학생 출석·숙제·시험 표를 하나의 트랜잭션으로 저장.';
comment on trigger normalize_student_contacts_on_write on public.students
  is '학생 연락처를 숫자로 정규화하고 국내 휴대전화·이메일 형식을 검증.';

notify pgrst, 'reload schema';
commit;
