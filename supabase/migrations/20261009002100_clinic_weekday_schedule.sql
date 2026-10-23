-- Clinic classes, weekday-specific defaults, and chronological session numbering.
begin;

alter table public.classes add column class_kind text not null default 'regular'
  constraint classes_kind_check check (class_kind in ('regular', 'clinic'));
alter table public.classes drop constraint classes_name_present;
alter table public.classes add constraint classes_name_present check (
  (class_kind = 'clinic' and school is null and subject is null)
  or (class_kind = 'regular' and (coalesce(btrim(school), '') <> '' or coalesce(btrim(subject), '') <> ''))
);
create unique index classes_one_clinic_per_term on public.classes(term_label)
  where class_kind = 'clinic';

create table public.class_weekday_times (
  class_id bigint not null references public.classes(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  day_part text not null check (day_part in ('오전', '오후', '저녁')),
  start_time time,
  end_time time,
  primary key (class_id, weekday),
  constraint class_weekday_times_pair check ((start_time is null) = (end_time is null)),
  constraint class_weekday_times_order check (start_time is null or start_time < end_time)
);
insert into public.class_weekday_times(class_id, weekday, day_part, start_time, end_time)
select c.id, d.weekday, coalesce(c.day_part, '오후'), c.default_start_time, c.default_end_time
from public.classes c cross join lateral unnest(c.weekdays) d(weekday);
alter table public.class_weekday_times enable row level security;
revoke all on public.class_weekday_times from public, anon, authenticated;
grant select on public.class_weekday_times to authenticated;
create policy approved_read on public.class_weekday_times for select to authenticated
  using ((select app_private.current_app_role()) is not null);

create function public.save_managed_class_v2(
  target_class_id bigint, target_term_label text, target_kind text,
  target_school text, target_subject text, target_location_id bigint,
  target_weekday_schedule jsonb, target_hourly_rate_krw integer,
  target_is_active boolean, target_staff_ids bigint[]
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  resolved_id bigint;
  item jsonb;
  selected_weekdays smallint[];
  first_part text;
  first_start time;
  first_end time;
  requested_staff_count integer;
  inserted_staff_count integer;
  existing_kind text;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if target_kind not in ('regular', 'clinic') or target_kind is null then
    raise exception 'Invalid class kind' using errcode = '23514';
  end if;
  if not exists (select 1 from public.class_terms
    where label = btrim(coalesce(target_term_label, '')) and is_active) then
    raise exception 'Active term not found' using errcode = '23514';
  end if;
  if target_kind = 'regular' and nullif(btrim(coalesce(target_school, '')), '') is null
    and nullif(btrim(coalesce(target_subject, '')), '') is null then
    raise exception 'School or subject is required' using errcode = '23514';
  end if;
  if target_hourly_rate_krw is not null and target_hourly_rate_krw < 0 then
    raise exception 'Hourly rate cannot be negative' using errcode = '23514';
  end if;
  if jsonb_typeof(target_weekday_schedule) <> 'array'
    or jsonb_array_length(target_weekday_schedule) < 1
    or jsonb_array_length(target_weekday_schedule) > 7 then
    raise exception 'Select one to seven weekdays' using errcode = '23514';
  end if;
  if (select count(distinct value->>'weekday') from jsonb_array_elements(target_weekday_schedule))
    <> jsonb_array_length(target_weekday_schedule) then
    raise exception 'Duplicate weekday' using errcode = '23514';
  end if;
  for item in select value from jsonb_array_elements(target_weekday_schedule) loop
    if coalesce(item->>'weekday','') !~ '^[0-6]$'
      or item->>'day_part' not in ('오전','오후','저녁')
      or (nullif(item->>'start_time','') is null) <> (nullif(item->>'end_time','') is null)
      or (nullif(item->>'start_time','') is not null
        and (item->>'start_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or item->>'end_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or (item->>'start_time')::time >= (item->>'end_time')::time)) then
      raise exception 'Invalid weekday schedule' using errcode = '23514';
    end if;
  end loop;
  select array_agg((value->>'weekday')::smallint order by (value->>'weekday')::integer)
    into selected_weekdays from jsonb_array_elements(target_weekday_schedule);
  select value->>'day_part', nullif(value->>'start_time','')::time,
    nullif(value->>'end_time','')::time
    into first_part, first_start, first_end
  from jsonb_array_elements(target_weekday_schedule)
  order by (value->>'weekday')::integer limit 1;

  if target_class_id is not null then
    select class_kind into existing_kind from public.classes where id = target_class_id for update;
    if not found then raise exception 'Class not found' using errcode = 'P0002'; end if;
    if existing_kind <> target_kind then
      raise exception 'Existing class kind cannot be changed' using errcode = '23514';
    end if;
  end if;

  if target_kind = 'regular' then
    resolved_id := public.save_managed_class_with_staff(
      target_class_id, btrim(target_term_label), target_school, target_subject,
      target_location_id, selected_weekdays, first_start, first_end,
      target_hourly_rate_krw, target_is_active, target_staff_ids
    )::bigint;
  else
    select count(distinct staff_id) into requested_staff_count
      from unnest(coalesce(target_staff_ids, '{}'::bigint[])) requested(staff_id);
    if requested_staff_count <> cardinality(coalesce(target_staff_ids, '{}'::bigint[])) then
      raise exception 'Scheduled worker IDs must be unique' using errcode = '23514';
    end if;
    if target_class_id is null then
      insert into public.classes(term_label,class_kind,school,subject,location_id,weekdays,
        day_part,default_start_time,default_end_time,default_hourly_rate_krw,is_active)
      values (btrim(target_term_label),'clinic',null,null,target_location_id,selected_weekdays,
        first_part,first_start,first_end,target_hourly_rate_krw,coalesce(target_is_active,true))
      returning id into resolved_id;
    else
      update public.classes set term_label=btrim(target_term_label), school=null, subject=null,
        location_id=target_location_id, weekdays=selected_weekdays, day_part=first_part,
        default_start_time=first_start, default_end_time=first_end,
        default_hourly_rate_krw=target_hourly_rate_krw,
        is_active=coalesce(target_is_active,true)
      where id=target_class_id returning id into resolved_id;
    end if;
    delete from public.class_staff where class_id=resolved_id;
    insert into public.class_staff(class_id,staff_id)
    select resolved_id,s.id from public.staff s
    join unnest(coalesce(target_staff_ids, '{}'::bigint[])) requested(staff_id) on s.id=requested.staff_id
    where s.employment_status='active';
    get diagnostics inserted_staff_count = row_count;
    if inserted_staff_count <> requested_staff_count then
      raise exception 'Every default worker must be active' using errcode = '23514';
    end if;
  end if;

  update public.classes set day_part=first_part where id=resolved_id;
  delete from public.class_weekday_times where class_id=resolved_id;
  insert into public.class_weekday_times(class_id,weekday,day_part,start_time,end_time)
  select resolved_id,(value->>'weekday')::smallint,value->>'day_part',
    nullif(value->>'start_time','')::time,nullif(value->>'end_time','')::time
  from jsonb_array_elements(target_weekday_schedule);
  return resolved_id::text;
end;
$$;
revoke all on function public.save_managed_class_v2(bigint,text,text,text,text,bigint,jsonb,integer,boolean,bigint[])
  from public,anon,authenticated;
grant execute on function public.save_managed_class_v2(bigint,text,text,text,text,bigint,jsonb,integer,boolean,bigint[])
  to authenticated;

create function app_private.assert_regular_class_enrollment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.classes where id=new.class_id and class_kind='clinic') then
    raise exception 'Clinic classes use session participants, not enrollments' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger regular_class_enrollment_before_write
before insert or update of class_id on public.enrollments
for each row execute function app_private.assert_regular_class_enrollment();

alter table public.session_participants drop constraint session_participants_participation_type_check;
alter table public.session_participants add constraint session_participants_participation_type_check
  check (participation_type in ('makeup','clinic'));
alter table public.session_participants add constraint clinic_participant_has_no_home_session
  check (participation_type <> 'clinic' or home_session_id is null);

create function public.add_clinic_participant(
  target_host_class_id bigint, target_session_id bigint,
  target_student_id bigint, target_home_class_id bigint, new_notes text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  target_date date;
  host_term text;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  select cs.session_date,c.term_label into target_date,host_term
  from public.class_sessions cs join public.classes c on c.id=cs.class_id
  where cs.id=target_session_id and cs.class_id=target_host_class_id
    and c.class_kind='clinic' and c.is_active;
  if not found then raise exception 'Active clinic session not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.enrollments e join public.classes c on c.id=e.class_id
    where e.class_id=target_home_class_id and e.student_id=target_student_id
      and c.term_label=host_term and c.class_kind='regular' and c.is_active
      and (e.joined_on is null or e.joined_on<=target_date)
      and (e.ended_on is null or e.ended_on>=target_date)
  ) then
    raise exception 'Student must belong to an active class in this term on the clinic date'
      using errcode = '23514';
  end if;
  insert into public.session_participants(session_id,student_id,host_class_id,
    home_class_id,participation_type,notes,created_by)
  values (target_session_id,target_student_id,target_host_class_id,target_home_class_id,
    'clinic',nullif(btrim(coalesce(new_notes,'')),''),app_private.current_staff_id());
end;
$$;
revoke all on function public.add_clinic_participant(bigint,bigint,bigint,bigint,text)
  from public,anon,authenticated;
grant execute on function public.add_clinic_participant(bigint,bigint,bigint,bigint,text)
  to authenticated;

create function app_private.assert_clinic_participant()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.participation_type = 'clinic' and not exists (
    select 1 from public.class_sessions cs
    join public.classes host on host.id=cs.class_id
    join public.enrollments e on e.class_id=new.home_class_id and e.student_id=new.student_id
    join public.classes home on home.id=e.class_id
    where cs.id=new.session_id and cs.class_id=new.host_class_id
      and host.class_kind='clinic' and host.term_label=home.term_label
      and home.class_kind='regular' and home.is_active
      and (e.joined_on is null or e.joined_on<=cs.session_date)
      and (e.ended_on is null or e.ended_on>=cs.session_date)
  ) then
    raise exception 'Invalid clinic participant or enrollment date' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger validate_clinic_participant_before_write
before insert or update on public.session_participants
for each row execute function app_private.assert_clinic_participant();

create function app_private.apply_weekday_time_to_session()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.session_date is distinct from old.session_date then
    select coalesce(w.start_time,c.default_start_time),
      coalesce(w.end_time,c.default_end_time)
      into new.start_time,new.end_time
    from public.classes c left join public.class_weekday_times w
      on w.class_id=c.id and w.weekday=extract(dow from new.session_date)::smallint
    where c.id=new.class_id;
  end if;
  return new;
end;
$$;
create trigger apply_weekday_time_before_session_date_change
before update of session_date on public.class_sessions
for each row execute function app_private.apply_weekday_time_to_session();

create function app_private.renumber_class_sessions(target_class_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  offset_number integer;
begin
  perform 1 from public.classes where id=target_class_id for update;
  select coalesce(max(session_number),0)+count(*)+1 into offset_number
    from public.class_sessions where class_id=target_class_id;
  with ordered as (
    select id,row_number() over (order by session_date,start_time nulls last,id)::integer as ordinal
    from public.class_sessions where class_id=target_class_id
  )
  update public.class_sessions cs set session_number=offset_number+ordered.ordinal
  from ordered where cs.id=ordered.id;
  with ordered as (
    select id,row_number() over (order by session_date,start_time nulls last,id)::integer as ordinal
    from public.class_sessions where class_id=target_class_id
  )
  update public.class_sessions cs set session_number=ordered.ordinal
  from ordered where cs.id=ordered.id;
end;
$$;
revoke all on function app_private.renumber_class_sessions(bigint) from public,anon,authenticated;

create function app_private.renumber_class_sessions_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app_private.renumber_class_sessions(old.class_id);
  else
    perform app_private.renumber_class_sessions(new.class_id);
  end if;
  return null;
end;
$$;
create trigger renumber_class_sessions_after_change
after insert or update of session_date,start_time or delete on public.class_sessions
for each row execute function app_private.renumber_class_sessions_trigger();

do $$
declare class_row record;
begin
  for class_row in select distinct class_id from public.class_sessions loop
    perform app_private.renumber_class_sessions(class_row.class_id);
  end loop;
end;
$$;

create or replace function public.create_class_sessions(target_class_id bigint, session_drafts jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
  new_session_id bigint;
  created_count integer := 0;
  requested_staff_count integer;
  inserted_staff_count integer;
  resolved_date date;
  default_start time;
  default_end time;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode='42501';
  end if;
  perform 1 from public.classes where id=target_class_id and is_active for update;
  if not found then raise exception 'Active class not found' using errcode='P0002'; end if;
  if jsonb_typeof(session_drafts)<>'array' or jsonb_array_length(session_drafts)<1
    or jsonb_array_length(session_drafts)>60 then
    raise exception 'One to sixty sessions are required' using errcode='23514';
  end if;
  for item in select value from jsonb_array_elements(session_drafts) loop
    resolved_date := (item->>'session_date')::date;
    if resolved_date is null then raise exception 'Session date is required' using errcode='23514'; end if;
    select case when w.class_id is null then c.default_start_time else w.start_time end,
      case when w.class_id is null then c.default_end_time else w.end_time end
      into default_start,default_end
    from public.classes c left join public.class_weekday_times w
      on w.class_id=c.id and w.weekday=extract(dow from resolved_date)::smallint
    where c.id=target_class_id;
    insert into public.class_sessions(class_id,session_number,session_date,start_time,end_time,notes)
    values (target_class_id,
      (select coalesce(max(session_number),0)+1 from public.class_sessions where class_id=target_class_id),
      resolved_date,default_start,default_end,
      nullif(btrim(coalesce(item->>'notes','')),''))
    returning id into new_session_id;
    if item ? 'staff_ids' then
      if jsonb_typeof(item->'staff_ids')<>'array' then
        raise exception 'Staff IDs must be an array' using errcode='23514';
      end if;
      requested_staff_count := jsonb_array_length(item->'staff_ids');
      insert into public.session_staff(session_id,staff_id)
      select new_session_id,s.id from public.staff s
      join (select distinct value::text::bigint as staff_id
        from jsonb_array_elements_text(item->'staff_ids')) requested on requested.staff_id=s.id
      where s.employment_status='active';
      get diagnostics inserted_staff_count = row_count;
      if inserted_staff_count<>requested_staff_count then
        raise exception 'Every scheduled worker must be active' using errcode='23514';
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
notify pgrst, 'reload schema';
commit;
