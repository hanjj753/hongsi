-- Distinguish classes that meet on the same weekday at different times of day.
begin;

alter table public.classes
  add column day_part text
  constraint classes_day_part_check check (day_part in ('오전', '오후', '저녁'));

comment on column public.classes.day_part
  is '수업 이름에 표시할 시간대. 기존 수업은 관리 화면에서 지정할 때까지 비어 있다.';

create function public.save_managed_class_with_day_part(
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
  target_staff_ids bigint[],
  target_day_part text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_id text;
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if target_day_part is null or target_day_part not in ('오전', '오후', '저녁') then
    raise exception 'Select morning, afternoon, or evening' using errcode = '23514';
  end if;

  select public.save_managed_class_with_staff(
    target_class_id, target_term_label, target_school, target_subject,
    target_location_id, target_weekdays, target_start_time, target_end_time,
    target_hourly_rate_krw, target_is_active, target_staff_ids
  ) into resolved_id;

  update public.classes set day_part = target_day_part where id = resolved_id::bigint;
  return resolved_id;
end;
$$;

revoke all on function public.save_managed_class_with_day_part(
  bigint,text,text,text,bigint,smallint[],time,time,integer,boolean,bigint[],text
) from public, anon, authenticated;
grant execute on function public.save_managed_class_with_day_part(
  bigint,text,text,text,bigint,smallint[],time,time,integer,boolean,bigint[],text
) to authenticated;

notify pgrst, 'reload schema';
commit;
