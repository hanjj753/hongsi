-- Optional per-question explanations for the mistake matrix.
begin;

alter table public.test_question_sheets
  add column question_notes jsonb not null default '{}'::jsonb;

create function public.save_test_question_sheet_with_notes(
  target_class_id bigint,
  target_session_id bigint,
  target_test_id bigint,
  new_objective_count integer,
  new_essay_count integer,
  student_rows jsonb,
  new_question_notes jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  note_entry record;
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  if new_question_notes is null or pg_catalog.jsonb_typeof(new_question_notes) <> 'object'
    or (select count(*) from pg_catalog.jsonb_each(new_question_notes)) > 100 then
    raise exception 'Invalid question notes' using errcode = '23514';
  end if;
  for note_entry in select key, value from pg_catalog.jsonb_each(new_question_notes) loop
    if note_entry.key !~ '^[1-9][0-9]*$'
      or length(note_entry.key) > 3
      or note_entry.key::integer > new_objective_count + new_essay_count
      or pg_catalog.jsonb_typeof(note_entry.value) <> 'string'
      or pg_catalog.char_length(note_entry.value #>> '{}') > 60 then
      raise exception 'Invalid question note' using errcode = '23514';
    end if;
  end loop;

  perform public.save_test_question_sheet(
    target_class_id, target_session_id, target_test_id,
    new_objective_count, new_essay_count, student_rows
  );
  update public.test_question_sheets set question_notes = new_question_notes
    where test_id = target_test_id;
end;
$$;
revoke all on function public.save_test_question_sheet_with_notes(bigint,bigint,bigint,integer,integer,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_test_question_sheet_with_notes(bigint,bigint,bigint,integer,integer,jsonb,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
commit;
