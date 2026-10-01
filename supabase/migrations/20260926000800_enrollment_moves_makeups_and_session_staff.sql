-- Enrollment lifecycle, one-session makeup participants, and selectable session staff.
-- Run after 20260925000700_class_catalog_and_session_items.sql.
begin;

alter table public.enrollments
  add column enrollment_status text not null default 'active',
  add column transferred_to_class_id bigint references public.classes(id) on delete restrict,
  add column status_changed_on date;

update public.enrollments
set enrollment_status = 'withdrawn', status_changed_on = ended_on
where ended_on is not null;

alter table public.enrollments
  add constraint enrollments_status_check
    check (enrollment_status in ('active', 'transferred', 'withdrawn')),
  add constraint enrollments_status_details_check check (
    (enrollment_status = 'active' and ended_on is null and transferred_to_class_id is null)
    or (enrollment_status = 'transferred' and ended_on is not null and transferred_to_class_id is not null
      and transferred_to_class_id <> class_id)
    or (enrollment_status = 'withdrawn' and ended_on is not null and transferred_to_class_id is null)
  );
create index enrollments_status_idx on public.enrollments(class_id, enrollment_status, joined_on, ended_on);
create index enrollments_transfer_target_idx on public.enrollments(transferred_to_class_id)
  where transferred_to_class_id is not null;

create table public.session_participants (
  session_id bigint not null,
  student_id bigint not null references public.students(id) on delete restrict,
  host_class_id bigint not null,
  home_class_id bigint not null,
  participation_type text not null default 'makeup' check (participation_type = 'makeup'),
  notes text,
  created_by bigint not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (session_id, student_id),
  foreign key (host_class_id, session_id) references public.class_sessions(class_id, id) on delete restrict,
  foreign key (home_class_id, student_id) references public.enrollments(class_id, student_id) on delete restrict,
  check (host_class_id <> home_class_id)
);
create index session_participants_student_idx on public.session_participants(student_id, session_id);
create index session_participants_home_idx on public.session_participants(home_class_id, student_id);

alter table public.session_participants enable row level security;
revoke all on table public.session_participants from public, anon, authenticated;
grant select on table public.session_participants to authenticated;
create policy approved_read on public.session_participants for select to authenticated
  using ((select app_private.current_app_role()) is not null);

grant update (joined_on,ended_on,enrollment_status,transferred_to_class_id,status_changed_on)
  on public.enrollments to authenticated;

alter table public.student_session_records
  drop constraint if exists student_session_records_class_id_student_id_fkey;
alter table public.student_homework_results
  drop constraint if exists student_homework_results_class_id_student_id_fkey;
alter table public.student_test_results
  drop constraint if exists student_test_results_class_id_student_id_fkey;

create function app_private.student_can_record(
  target_class_id bigint,
  target_session_id bigint,
  target_student_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_sessions cs
    join public.enrollments e
      on e.class_id = cs.class_id and e.student_id = target_student_id
    where cs.id = target_session_id
      and cs.class_id = target_class_id
      and (e.joined_on is null or e.joined_on <= cs.session_date)
      and (e.ended_on is null or e.ended_on >= cs.session_date)
  ) or exists (
    select 1 from public.session_participants sp
    where sp.session_id = target_session_id
      and sp.host_class_id = target_class_id
      and sp.student_id = target_student_id
  );
$$;
revoke all on function app_private.student_can_record(bigint,bigint,bigint)
  from public, anon, authenticated;

create function app_private.assert_record_student_eligible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_session_id bigint;
begin
  if tg_table_name = 'student_session_records' then
    resolved_session_id := new.session_id;
  elsif tg_table_name = 'student_homework_results' then
    select h.session_id into resolved_session_id
    from public.session_homeworks h
    where h.id = new.homework_id and h.class_id = new.class_id;
  elsif tg_table_name = 'student_test_results' then
    select t.session_id into resolved_session_id
    from public.session_tests t
    where t.id = new.test_id and t.class_id = new.class_id;
  end if;

  if resolved_session_id is null
    or not app_private.student_can_record(new.class_id, resolved_session_id, new.student_id) then
    raise exception 'Student is not eligible for this session' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function app_private.assert_record_student_eligible()
  from public, anon, authenticated;

create trigger check_record_student_eligible
before insert or update of class_id, session_id, student_id on public.student_session_records
for each row execute function app_private.assert_record_student_eligible();
create trigger check_homework_student_eligible
before insert or update of class_id, homework_id, student_id on public.student_homework_results
for each row execute function app_private.assert_record_student_eligible();
create trigger check_test_student_eligible
before insert or update of class_id, test_id, student_id on public.student_test_results
for each row execute function app_private.assert_record_student_eligible();

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
  if not exists (select 1 from public.classes where id = target_class_id and is_active) then
    raise exception 'Active class not found' using errcode = 'P0002';
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
      insert into public.students(student_code,full_name,student_phone,parent_phone,email,default_message_recipients)
      values (new_student_code,new_full_name,new_student_phone,new_parent_phone,new_email,new_default_message_recipients)
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
    where id = target_student_id returning id into resolved_student_id;
    if resolved_student_id is null then
      raise exception 'Student not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.enrollments(
    class_id,student_id,joined_on,ended_on,enrollment_status,transferred_to_class_id,status_changed_on
  ) values (
    target_class_id,resolved_student_id,coalesce(new_joined_on,current_date),null,'active',null,current_date
  ) on conflict (class_id,student_id) do update set
    joined_on = case
      when public.enrollments.enrollment_status = 'active'
        then least(public.enrollments.joined_on, excluded.joined_on)
      else excluded.joined_on
    end,
    ended_on = null,
    enrollment_status = 'active',
    transferred_to_class_id = null,
    status_changed_on = current_date;
  return resolved_student_id::text;
end;
$$;

create function public.transfer_student(
  source_class_id bigint,
  target_class_id bigint,
  target_student_id bigint,
  effective_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_term text;
  target_term text;
  source_joined_on date;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if source_class_id = target_class_id or effective_on is null then
    raise exception 'A different class and effective date are required' using errcode = '23514';
  end if;
  select term_label into source_term from public.classes where id = source_class_id and is_active;
  select term_label into target_term from public.classes where id = target_class_id and is_active;
  if source_term is null or target_term is null then
    raise exception 'Active source and target classes are required' using errcode = 'P0002';
  end if;
  if source_term <> target_term then
    raise exception 'Students can only transfer within the same term' using errcode = '23514';
  end if;
  select joined_on into source_joined_on from public.enrollments
    where class_id = source_class_id and student_id = target_student_id
      and enrollment_status = 'active' for update;
  if not found then
    raise exception 'Active source enrollment not found' using errcode = 'P0002';
  end if;
  if source_joined_on is not null and effective_on <= source_joined_on then
    raise exception 'Transfer date must be after the source start date' using errcode = '23514';
  end if;
  if exists (select 1 from public.enrollments
    where class_id = target_class_id and student_id = target_student_id and enrollment_status = 'active') then
    raise exception 'Student is already active in target class' using errcode = '23514';
  end if;

  update public.enrollments set
    enrollment_status = 'transferred',
    ended_on = effective_on - 1,
    transferred_to_class_id = target_class_id,
    status_changed_on = effective_on
  where class_id = source_class_id and student_id = target_student_id;

  insert into public.enrollments(
    class_id,student_id,joined_on,ended_on,enrollment_status,transferred_to_class_id,status_changed_on
  ) values (target_class_id,target_student_id,effective_on,null,'active',null,effective_on)
  on conflict (class_id,student_id) do update set
    joined_on = excluded.joined_on,
    ended_on = null,
    enrollment_status = 'active',
    transferred_to_class_id = null,
    status_changed_on = excluded.status_changed_on;
end;
$$;

create function public.withdraw_student(
  target_class_id bigint,
  target_student_id bigint,
  last_attendance_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare start_on date;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  select joined_on into start_on from public.enrollments
    where class_id = target_class_id and student_id = target_student_id
      and enrollment_status = 'active' for update;
  if not found then raise exception 'Active enrollment not found' using errcode = 'P0002'; end if;
  if last_attendance_on is null or (start_on is not null and last_attendance_on < start_on) then
    raise exception 'Invalid last attendance date' using errcode = '23514';
  end if;
  update public.enrollments set
    enrollment_status = 'withdrawn', ended_on = last_attendance_on,
    transferred_to_class_id = null, status_changed_on = last_attendance_on
  where class_id = target_class_id and student_id = target_student_id;
end;
$$;

create function public.reactivate_student(
  target_class_id bigint,
  target_student_id bigint,
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
  if new_joined_on is null then
    raise exception 'Start date is required' using errcode = '23514';
  end if;
  update public.enrollments set
    enrollment_status = 'active', joined_on = new_joined_on, ended_on = null,
    transferred_to_class_id = null, status_changed_on = new_joined_on
  where class_id = target_class_id and student_id = target_student_id
    and enrollment_status <> 'active';
  if not found then raise exception 'Inactive enrollment not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.add_makeup_participant(
  target_host_class_id bigint,
  target_session_id bigint,
  target_student_id bigint,
  target_home_class_id bigint,
  new_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_date date;
  host_term text;
  home_term text;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  select cs.session_date,c.term_label into target_date,host_term
  from public.class_sessions cs join public.classes c on c.id = cs.class_id
  where cs.id = target_session_id and cs.class_id = target_host_class_id;
  if target_date is null then raise exception 'Host session not found' using errcode = 'P0002'; end if;
  select term_label into home_term from public.classes where id = target_home_class_id;
  if home_term is null or host_term <> home_term or target_home_class_id = target_host_class_id then
    raise exception 'Makeup class must be a different class in the same term' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.class_id = target_home_class_id and e.student_id = target_student_id
      and e.enrollment_status = 'active'
      and (e.joined_on is null or e.joined_on <= target_date)
  ) then
    raise exception 'Student has no active home-class enrollment for this date' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.enrollments e
    where e.class_id = target_host_class_id and e.student_id = target_student_id
      and (e.joined_on is null or e.joined_on <= target_date)
      and (e.ended_on is null or e.ended_on >= target_date)
  ) then
    raise exception 'Student is already enrolled in host class for this date' using errcode = '23514';
  end if;
  insert into public.session_participants(
    session_id,student_id,host_class_id,home_class_id,notes,created_by
  ) values (
    target_session_id,target_student_id,target_host_class_id,target_home_class_id,
    nullif(btrim(coalesce(new_notes,'')),''),app_private.current_staff_id()
  ) on conflict (session_id,student_id) do update set
    home_class_id = excluded.home_class_id,
    notes = excluded.notes,
    created_by = excluded.created_by;
end;
$$;

create function public.remove_makeup_participant(
  target_host_class_id bigint,
  target_session_id bigint,
  target_student_id bigint
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
  if not exists (select 1 from public.session_participants
    where host_class_id = target_host_class_id and session_id = target_session_id and student_id = target_student_id) then
    raise exception 'Makeup participant not found' using errcode = 'P0002';
  end if;
  delete from public.student_homework_results r using public.session_homeworks h
    where r.homework_id = h.id and r.student_id = target_student_id
      and h.class_id = target_host_class_id and h.session_id = target_session_id;
  delete from public.student_test_results r using public.session_tests t
    where r.test_id = t.id and r.student_id = target_student_id
      and t.class_id = target_host_class_id and t.session_id = target_session_id;
  delete from public.student_session_records
    where class_id = target_host_class_id and session_id = target_session_id and student_id = target_student_id;
  delete from public.session_participants
    where host_class_id = target_host_class_id and session_id = target_session_id and student_id = target_student_id;
end;
$$;

create or replace function public.save_student_session_draft(
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
  if not app_private.student_can_record(target_class_id,target_session_id,target_student_id) then
    raise exception 'Student is not eligible for this session' using errcode = '23503';
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
        class_id,session_id,student_id,attendance_status,makeup_date,makeup_time,makeup_note,notes
      ) values (
        target_class_id,target_session_id,target_student_id,attendance_status,
        case when attendance_status = '보강' then nullif(attendance->>'makeup_date','')::date else null end,
        case when attendance_status = '보강' then nullif(attendance->>'makeup_time','')::time else null end,
        case when attendance_status = '보강' then nullif(btrim(attendance->>'makeup_note'),'') else null end,
        nullif(btrim(attendance->>'notes'),'')
      ) on conflict (session_id,student_id) do update set
        attendance_status=excluded.attendance_status,makeup_date=excluded.makeup_date,
        makeup_time=excluded.makeup_time,makeup_note=excluded.makeup_note,notes=excluded.notes;
    end if;
  end if;

  for item in select value from jsonb_array_elements(coalesce(homework_results,'[]'::jsonb)) loop
    item_id := (item->>'homework_id')::bigint;
    if not exists (select 1 from public.session_homeworks
      where id=item_id and class_id=target_class_id and session_id=target_session_id) then
      raise exception 'Homework does not belong to session' using errcode = '23503';
    end if;
    grade_value := nullif(item->>'grade','');
    if grade_value is null then
      delete from public.student_homework_results where homework_id=item_id and student_id=target_student_id;
    else
      insert into public.student_homework_results(class_id,homework_id,student_id,grade,notes)
      values (target_class_id,item_id,target_student_id,grade_value,nullif(btrim(item->>'notes'),''))
      on conflict (homework_id,student_id) do update set grade=excluded.grade,notes=excluded.notes;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(test_results,'[]'::jsonb)) loop
    item_id := (item->>'test_id')::bigint;
    if not exists (select 1 from public.session_tests
      where id=item_id and class_id=target_class_id and session_id=target_session_id) then
      raise exception 'Test does not belong to session' using errcode = '23503';
    end if;
    status_value := nullif(item->>'status','');
    score_value := case when item->>'score' is null then null else (item->>'score')::numeric end;
    if status_value is null and score_value is null then
      delete from public.student_test_results where test_id=item_id and student_id=target_student_id;
    else
      insert into public.student_test_results(class_id,test_id,student_id,score,status,notes)
      values (target_class_id,item_id,target_student_id,
        case when status_value='결시' then null else score_value end,status_value,nullif(btrim(item->>'notes'),''))
      on conflict (test_id,student_id) do update set score=excluded.score,status=excluded.status,notes=excluded.notes;
    end if;
  end loop;
end;
$$;

create or replace function public.create_class_sessions(target_class_id bigint, session_drafts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  new_session_id bigint;
  created_count integer := 0;
  requested_staff_count integer;
  inserted_staff_count integer;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.classes where id=target_class_id and is_active) then
    raise exception 'Active class not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(session_drafts)<>'array' or jsonb_array_length(session_drafts)<1
    or jsonb_array_length(session_drafts)>60 then
    raise exception 'One to sixty sessions are required' using errcode = '23514';
  end if;
  if (select count(*) from jsonb_array_elements(session_drafts)) <>
     (select count(distinct value->>'session_number') from jsonb_array_elements(session_drafts)) then
    raise exception 'Duplicate session number' using errcode = '23514';
  end if;

  for item in select value from jsonb_array_elements(session_drafts) loop
    insert into public.class_sessions(class_id,session_number,session_date,notes)
    values (target_class_id,(item->>'session_number')::integer,(item->>'session_date')::date,
      nullif(btrim(coalesce(item->>'notes','')),'')) returning id into new_session_id;

    if item ? 'staff_ids' then
      if jsonb_typeof(item->'staff_ids') <> 'array' then
        raise exception 'Staff IDs must be an array' using errcode = '23514';
      end if;
      requested_staff_count := jsonb_array_length(item->'staff_ids');
      insert into public.session_staff(session_id,staff_id)
      select new_session_id,s.id
      from public.staff s
      join (
        select distinct value::text::bigint as staff_id
        from jsonb_array_elements_text(item->'staff_ids')
      ) requested on requested.staff_id=s.id
      where s.employment_status='active';
      get diagnostics inserted_staff_count = row_count;
      if inserted_staff_count <> requested_staff_count then
        raise exception 'Every scheduled worker must be an active staff member' using errcode = '23514';
      end if;
    else
      insert into public.session_staff(session_id,staff_id)
      select new_session_id,staff_id from public.class_staff where class_id=target_class_id;
    end if;
    created_count := created_count+1;
  end loop;
  return created_count;
end;
$$;

revoke all on function public.transfer_student(bigint,bigint,bigint,date),
  public.withdraw_student(bigint,bigint,date), public.reactivate_student(bigint,bigint,date),
  public.add_makeup_participant(bigint,bigint,bigint,bigint,text),
  public.remove_makeup_participant(bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.transfer_student(bigint,bigint,bigint,date),
  public.withdraw_student(bigint,bigint,date), public.reactivate_student(bigint,bigint,date),
  public.add_makeup_participant(bigint,bigint,bigint,bigint,text),
  public.remove_makeup_participant(bigint,bigint,bigint)
  to authenticated;

comment on column public.enrollments.enrollment_status is 'active=수강 중, transferred=전반, withdrawn=그만둠.';
comment on table public.session_participants is '정식 수강 변경 없이 다른 반의 한 차시에만 참여하는 보강 학생.';
comment on function public.transfer_student(bigint,bigint,bigint,date)
  is '같은 분기 내 전반. 이전 반 종료 후 새 반 수강을 시작하며 이전 기록은 보존.';
comment on function public.remove_makeup_participant(bigint,bigint,bigint)
  is '해당 차시의 임시 보강 참여와 그 차시에 입력한 결과를 함께 삭제.';

notify pgrst, 'reload schema';
commit;
