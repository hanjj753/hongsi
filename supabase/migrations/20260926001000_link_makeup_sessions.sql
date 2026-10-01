-- Link an original class session directly to the session where the student makes it up.
-- There is intentionally no chronological constraint between the two sessions.
begin;

alter table public.session_participants
  add column home_session_id bigint;

alter table public.session_participants
  add constraint session_participants_home_session_fkey
    foreign key (home_class_id, home_session_id)
    references public.class_sessions(class_id, id) on delete restrict;

create unique index session_participants_home_session_student_idx
  on public.session_participants(home_session_id, student_id)
  where home_session_id is not null;

alter table public.student_session_records
  add column makeup_host_session_id bigint references public.class_sessions(id) on delete restrict,
  add constraint student_records_linked_makeup_status_check
    check (makeup_host_session_id is null or attendance_status = '보강');

create index student_records_makeup_host_idx
  on public.student_session_records(makeup_host_session_id, student_id)
  where makeup_host_session_id is not null;

create function app_private.protect_linked_makeup_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.makeup_host_session_id is not null and exists (
    select 1
    from public.session_participants sp
    where sp.student_id = old.student_id
      and sp.home_session_id = old.session_id
      and sp.session_id = old.makeup_host_session_id
  ) then
    if tg_op = 'DELETE' then
      raise exception 'Linked makeup attendance must be removed from the host session'
        using errcode = '23514';
    end if;
    if new.session_id is distinct from old.session_id
      or new.student_id is distinct from old.student_id
      or new.class_id is distinct from old.class_id
      or new.makeup_host_session_id is distinct from old.makeup_host_session_id
      or new.attendance_status is distinct from old.attendance_status
      or new.makeup_date is distinct from old.makeup_date
      or new.makeup_time is distinct from old.makeup_time
      or new.makeup_note is distinct from old.makeup_note then
      raise exception 'Linked makeup attendance must be changed from the host session'
        using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function app_private.protect_linked_makeup_record()
  from public, anon, authenticated;

create trigger protect_linked_makeup_record
before update or delete on public.student_session_records
for each row execute function app_private.protect_linked_makeup_record();

revoke all on function public.add_makeup_participant(bigint,bigint,bigint,bigint,text)
  from public, anon, authenticated;
-- Keep the legacy signature only as an inaccessible migration artifact. New clients
-- can execute only the six-argument version that requires an original session.

create function public.add_makeup_participant(
  target_host_class_id bigint,
  target_session_id bigint,
  target_student_id bigint,
  target_home_class_id bigint,
  target_home_session_id bigint,
  new_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  host_date date;
  host_time time;
  host_session_number integer;
  host_term text;
  host_name text;
  home_date date;
  home_term text;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;

  select
    cs.session_date,
    coalesce(cs.start_time, c.default_start_time),
    cs.session_number,
    c.term_label,
    coalesce(nullif(concat_ws(' ', nullif(c.school, ''), nullif(c.subject, '')), ''), '수업 ' || c.id)
  into host_date, host_time, host_session_number, host_term, host_name
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = target_session_id and cs.class_id = target_host_class_id;
  if not found then
    raise exception 'Host session not found' using errcode = 'P0002';
  end if;

  select cs.session_date, c.term_label
  into home_date, home_term
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = target_home_session_id and cs.class_id = target_home_class_id;
  if not found then
    raise exception 'Original session not found' using errcode = 'P0002';
  end if;

  if target_home_class_id = target_host_class_id or home_term <> host_term then
    raise exception 'Makeup class must be a different class in the same term' using errcode = '23514';
  end if;

  -- The original session date determines whether the student belonged to class A.
  -- The host session may happen before or after it.
  if not exists (
    select 1
    from public.enrollments e
    where e.class_id = target_home_class_id
      and e.student_id = target_student_id
      and (e.joined_on is null or e.joined_on <= home_date)
      and (e.ended_on is null or e.ended_on >= home_date)
  ) then
    raise exception 'Student was not enrolled in the original class for that session'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.enrollments e
    where e.class_id = target_host_class_id
      and e.student_id = target_student_id
      and (e.joined_on is null or e.joined_on <= host_date)
      and (e.ended_on is null or e.ended_on >= host_date)
  ) then
    raise exception 'Student is already enrolled in host class for this date'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.session_participants sp
    where sp.session_id = target_session_id and sp.student_id = target_student_id
  ) then
    raise exception 'Student is already a makeup participant in the host session'
      using errcode = '23505';
  end if;
  if exists (
    select 1 from public.session_participants sp
    where sp.home_session_id = target_home_session_id and sp.student_id = target_student_id
  ) then
    raise exception 'Original session is already linked to another makeup session'
      using errcode = '23505';
  end if;

  insert into public.session_participants(
    session_id, student_id, host_class_id, home_class_id, home_session_id, notes, created_by
  ) values (
    target_session_id, target_student_id, target_host_class_id, target_home_class_id,
    target_home_session_id, nullif(btrim(coalesce(new_notes, '')), ''),
    app_private.current_staff_id()
  );

  insert into public.student_session_records(
    class_id, session_id, student_id, attendance_status,
    makeup_date, makeup_time, makeup_note, makeup_host_session_id, updated_by
  ) values (
    target_home_class_id, target_home_session_id, target_student_id, '보강',
    host_date, host_time, host_name || ' ' || host_session_number || '차시에서 보강',
    target_session_id, app_private.current_staff_id()
  )
  on conflict (session_id, student_id) do update set
    class_id = excluded.class_id,
    attendance_status = excluded.attendance_status,
    makeup_date = excluded.makeup_date,
    makeup_time = excluded.makeup_time,
    makeup_note = excluded.makeup_note,
    makeup_host_session_id = excluded.makeup_host_session_id,
    updated_by = excluded.updated_by,
    updated_at = now();
end;
$$;

create or replace function public.remove_makeup_participant(
  target_host_class_id bigint,
  target_session_id bigint,
  target_student_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_session_id bigint;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;

  select sp.home_session_id into original_session_id
  from public.session_participants sp
  where sp.host_class_id = target_host_class_id
    and sp.session_id = target_session_id
    and sp.student_id = target_student_id
  for update;
  if not found then
    raise exception 'Makeup participant not found' using errcode = 'P0002';
  end if;

  delete from public.student_homework_results r using public.session_homeworks h
    where r.homework_id = h.id and r.student_id = target_student_id
      and h.class_id = target_host_class_id and h.session_id = target_session_id;
  delete from public.student_test_results r using public.session_tests t
    where r.test_id = t.id and r.student_id = target_student_id
      and t.class_id = target_host_class_id and t.session_id = target_session_id;
  delete from public.student_session_records
    where class_id = target_host_class_id
      and session_id = target_session_id
      and student_id = target_student_id;

  -- Delete the relationship before clearing A's protected linked attendance row.
  delete from public.session_participants
    where host_class_id = target_host_class_id
      and session_id = target_session_id
      and student_id = target_student_id;

  if original_session_id is not null then
    delete from public.student_session_records
    where session_id = original_session_id
      and student_id = target_student_id
      and makeup_host_session_id = target_session_id
      and nullif(btrim(coalesce(notes, '')), '') is null;

    update public.student_session_records set
      attendance_status = null,
      makeup_date = null,
      makeup_time = null,
      makeup_note = null,
      makeup_host_session_id = null,
      updated_by = app_private.current_staff_id(),
      updated_at = now()
    where session_id = original_session_id
      and student_id = target_student_id
      and makeup_host_session_id = target_session_id;
  end if;
end;
$$;

revoke all on function public.add_makeup_participant(bigint,bigint,bigint,bigint,bigint,text),
  public.remove_makeup_participant(bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.add_makeup_participant(bigint,bigint,bigint,bigint,bigint,text),
  public.remove_makeup_participant(bigint,bigint,bigint)
  to authenticated;

comment on column public.enrollments.enrollment_status
  is 'active=수강 중, transferred=전반, withdrawn=퇴원.';
comment on column public.session_participants.home_session_id
  is '보강을 대신하는 원래 수업 A의 차시. B 차시와 날짜 순서 제약은 없다.';
comment on column public.student_session_records.makeup_host_session_id
  is '원래 차시 A의 보강 상태와 실제 기록을 입력할 B 차시를 연결.';
comment on function public.add_makeup_participant(bigint,bigint,bigint,bigint,bigint,text)
  is 'A의 원래 차시와 B의 보강 차시를 연결하고 A에 보강 출석 기록을 자동 생성.';
comment on function public.remove_makeup_participant(bigint,bigint,bigint)
  is 'B의 임시 보강 참여와 B 기록을 삭제하고 A에 자동 생성한 연결 상태도 정리.';

notify pgrst, 'reload schema';
commit;
