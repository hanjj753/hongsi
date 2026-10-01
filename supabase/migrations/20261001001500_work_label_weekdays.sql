-- Include the class weekday in the immutable work label shown in past shifts.
begin;

create or replace function public.start_my_work_shift(target_class_id bigint)
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
  select concat_ws(' ',
      nullif(btrim(c.school),''),
      nullif(btrim(c.subject),''),
      nullif((select string_agg(
        case d.day when 0 then '일' when 1 then '월' when 2 then '화'
          when 3 then '수' when 4 then '목' when 5 then '금' when 6 then '토' end,
        '·' order by d.position)
        from unnest(c.weekdays) with ordinality as d(day, position)), ''),
      c.day_part),
    c.default_hourly_rate_krw into target_label,target_rate
    from public.classes c where c.id=target_class_id and c.is_active;
  if not found then
    raise exception 'Active class not found' using errcode = 'P0002';
  end if;
  insert into public.work_logs(staff_id,class_id,work_label,started_at,hourly_rate_krw)
    values (worker_id,target_class_id,target_label,statement_timestamp(),target_rate)
    returning id into existing_id;
  return existing_id;
end;
$$;

notify pgrst, 'reload schema';
commit;
