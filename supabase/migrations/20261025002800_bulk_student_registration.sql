-- Register a class roster in one transaction; existing student identities follow the single-entry rules.
begin;

create function public.register_students_and_enroll(target_class_id bigint, student_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  entry jsonb;
  row_count integer;
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  if student_rows is null or pg_catalog.jsonb_typeof(student_rows) <> 'array' then
    raise exception 'Student rows must be an array' using errcode = '23514';
  end if;
  row_count := pg_catalog.jsonb_array_length(student_rows);
  if row_count < 1 or row_count > 100 then
    raise exception 'Register 1 to 100 students at once' using errcode = '23514';
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(student_rows) e
      where pg_catalog.jsonb_typeof(e.value) <> 'object') > 0 then
    raise exception 'Invalid student row' using errcode = '23514';
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(student_rows) e
      where nullif(pg_catalog.btrim(e.value->>'student_code'), '') is not null)
    <> (select count(distinct pg_catalog.upper(pg_catalog.btrim(e.value->>'student_code')))
      from pg_catalog.jsonb_array_elements(student_rows) e
      where nullif(pg_catalog.btrim(e.value->>'student_code'), '') is not null) then
    raise exception 'Duplicate student code in batch' using errcode = '23514';
  end if;

  for entry in select value from pg_catalog.jsonb_array_elements(student_rows) loop
    perform public.register_student_and_enroll(
      target_class_id, null,
      entry->>'student_code', entry->>'full_name',
      entry->>'student_phone', entry->>'parent_phone', entry->>'email',
      coalesce(entry->>'default_message_recipients', 'parent'),
      nullif(entry->>'joined_on', '')::date
    );
  end loop;
  return row_count;
end;
$$;
revoke all on function public.register_students_and_enroll(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.register_students_and_enroll(bigint,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
