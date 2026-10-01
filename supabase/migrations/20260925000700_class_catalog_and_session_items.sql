-- In-app term/class/session management and safe session-item deletion.
-- Run after 20260925000600_bulk_records_and_student_validation.sql.
begin;

create table public.class_terms (
  label text primary key check (label = btrim(label) and label <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.class_terms(label)
select distinct btrim(term_label) from public.classes;

alter table public.classes
  add constraint classes_term_label_fkey
  foreign key (term_label) references public.class_terms(label)
  on update cascade on delete restrict;

alter table public.class_terms enable row level security;
create policy approved_read on public.class_terms for select to authenticated
  using ((select app_private.current_app_role()) is not null);
create policy management_insert on public.class_terms for insert to authenticated
  with check ((select app_private.can_manage()));
create policy management_update on public.class_terms for update to authenticated
  using ((select app_private.can_manage())) with check ((select app_private.can_manage()));

grant select on public.class_terms to authenticated;
grant insert (label,is_active), update (label,is_active) on public.class_terms to authenticated;
create trigger touch_updated_at before update on public.class_terms
  for each row execute function app_private.touch_updated_at();

create function public.save_class_term(original_label text, new_label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_label text := nullif(btrim(coalesce(original_label, '')), '');
  clean_label text := nullif(btrim(coalesce(new_label, '')), '');
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if clean_label is null then
    raise exception 'Term label is required' using errcode = '23514';
  end if;

  if old_label is null then
    insert into public.class_terms(label,is_active) values (clean_label,true)
      on conflict (label) do update set is_active = true;
  elsif old_label = clean_label then
    update public.class_terms set is_active = true where label = old_label;
    if not found then raise exception 'Term not found' using errcode = 'P0002'; end if;
  else
    if exists (select 1 from public.class_terms where label = clean_label) then
      raise exception 'Term label already exists' using errcode = '23505';
    end if;
    update public.class_terms set label = clean_label, is_active = true where label = old_label;
    if not found then raise exception 'Term not found' using errcode = 'P0002'; end if;
  end if;
  return clean_label;
end;
$$;

create function public.archive_class_term(target_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  update public.classes set is_active = false where term_label = target_label and is_active;
  update public.class_terms set is_active = false where label = target_label;
  if not found then raise exception 'Term not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.save_managed_class(
  target_class_id bigint,
  target_term_label text,
  target_school text,
  target_subject text,
  target_location_id bigint,
  target_weekdays smallint[],
  target_start_time time,
  target_end_time time,
  target_hourly_rate_krw integer,
  target_is_active boolean
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

  if target_class_id is null then
    insert into public.classes(
      term_label,school,subject,location_id,weekdays,
      default_start_time,default_end_time,default_hourly_rate_krw,is_active
    ) values (
      clean_term,clean_school,clean_subject,target_location_id,coalesce(target_weekdays,'{}'::smallint[]),
      target_start_time,target_end_time,target_hourly_rate_krw,coalesce(target_is_active,true)
    ) returning id into resolved_id;
  else
    update public.classes set
      term_label = clean_term,
      school = clean_school,
      subject = clean_subject,
      location_id = target_location_id,
      weekdays = coalesce(target_weekdays,'{}'::smallint[]),
      default_start_time = target_start_time,
      default_end_time = target_end_time,
      default_hourly_rate_krw = target_hourly_rate_krw,
      is_active = coalesce(target_is_active,true)
    where id = target_class_id returning id into resolved_id;
    if resolved_id is null then raise exception 'Class not found' using errcode = 'P0002'; end if;
  end if;
  return resolved_id::text;
end;
$$;

create function public.archive_managed_class(target_class_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  update public.classes set is_active = false where id = target_class_id;
  if not found then raise exception 'Class not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.create_class_sessions(target_class_id bigint, session_drafts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  new_session_id bigint;
  created_count integer := 0;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.classes where id = target_class_id and is_active) then
    raise exception 'Active class not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(session_drafts) <> 'array' or jsonb_array_length(session_drafts) < 1
    or jsonb_array_length(session_drafts) > 60 then
    raise exception 'One to sixty sessions are required' using errcode = '23514';
  end if;
  if (select count(*) from jsonb_array_elements(session_drafts)) <>
     (select count(distinct value->>'session_number') from jsonb_array_elements(session_drafts)) then
    raise exception 'Duplicate session number' using errcode = '23514';
  end if;

  for item in select value from jsonb_array_elements(session_drafts) loop
    insert into public.class_sessions(class_id,session_number,session_date,notes)
    values (
      target_class_id,
      (item->>'session_number')::integer,
      (item->>'session_date')::date,
      nullif(btrim(coalesce(item->>'notes','')), '')
    ) returning id into new_session_id;

    insert into public.session_staff(session_id,staff_id)
    select new_session_id,staff_id from public.class_staff where class_id = target_class_id;
    created_count := created_count + 1;
  end loop;
  return created_count;
end;
$$;

create function public.delete_session_item(
  target_class_id bigint,
  target_session_id bigint,
  target_item_kind text,
  target_item_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  if target_item_kind = 'homework' then
    if not exists (select 1 from public.session_homeworks
      where id = target_item_id and class_id = target_class_id and session_id = target_session_id) then
      raise exception 'Homework not found' using errcode = 'P0002';
    end if;
    delete from public.student_homework_results where homework_id = target_item_id;
    delete from public.session_homeworks where id = target_item_id;
  elsif target_item_kind = 'test' then
    if not exists (select 1 from public.session_tests
      where id = target_item_id and class_id = target_class_id and session_id = target_session_id) then
      raise exception 'Test not found' using errcode = 'P0002';
    end if;
    delete from public.student_test_results where test_id = target_item_id;
    delete from public.session_tests where id = target_item_id;
  else
    raise exception 'Invalid session item kind' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.save_class_term(text,text), public.archive_class_term(text),
  public.save_managed_class(bigint,text,text,text,bigint,smallint[],time,time,integer,boolean),
  public.archive_managed_class(bigint), public.create_class_sessions(bigint,jsonb),
  public.delete_session_item(bigint,bigint,text,bigint)
  from public, anon, authenticated;
grant execute on function public.save_class_term(text,text), public.archive_class_term(text),
  public.save_managed_class(bigint,text,text,text,bigint,smallint[],time,time,integer,boolean),
  public.archive_managed_class(bigint), public.create_class_sessions(bigint,jsonb),
  public.delete_session_item(bigint,bigint,text,bigint)
  to authenticated;

comment on table public.class_terms is '수업 목록에서 관리하는 분기. 수업과 기록은 삭제 대신 비활성 보관.';
comment on function public.delete_session_item(bigint,bigint,text,bigint)
  is '확인된 숙제/시험 항목과 해당 학생 결과를 한 트랜잭션으로 삭제.';

notify pgrst, 'reload schema';
commit;
