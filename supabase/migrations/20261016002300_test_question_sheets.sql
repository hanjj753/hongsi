-- Per-test question mistake matrix, independent of scores and attendance.
begin;

create table public.test_question_sheets (
  test_id bigint primary key references public.session_tests(id) on delete cascade,
  objective_count smallint not null check (objective_count between 0 and 100),
  essay_count smallint not null check (essay_count between 0 and 100),
  updated_by bigint references public.staff(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint test_question_sheets_total_check check (objective_count + essay_count between 1 and 100)
);

create table public.test_question_mistakes (
  test_id bigint not null references public.test_question_sheets(test_id) on delete cascade,
  student_id bigint not null references public.students(id) on delete cascade,
  wrong_numbers smallint[] not null default '{}'::smallint[],
  updated_at timestamptz not null default now(),
  primary key (test_id, student_id)
);
create index test_question_mistakes_student_idx on public.test_question_mistakes(student_id);

alter table public.test_question_sheets enable row level security;
alter table public.test_question_mistakes enable row level security;
grant select on public.test_question_sheets, public.test_question_mistakes to authenticated;
create policy approved_question_sheets_read on public.test_question_sheets for select to authenticated
  using ((select app_private.current_app_role()) is not null);
create policy approved_question_mistakes_read on public.test_question_mistakes for select to authenticated
  using ((select app_private.current_app_role()) is not null);

create function public.save_test_question_sheet(
  target_class_id bigint,
  target_session_id bigint,
  target_test_id bigint,
  new_objective_count integer,
  new_essay_count integer,
  student_rows jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry jsonb;
  token text;
  selected_student_id bigint;
  number_value integer;
  wrongs smallint[];
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  if new_objective_count is null or new_essay_count is null
    or new_objective_count < 0 or new_essay_count < 0
    or new_objective_count + new_essay_count not between 1 and 100 then
    raise exception 'Question count must be between 1 and 100' using errcode = '23514';
  end if;
  if student_rows is null or pg_catalog.jsonb_typeof(student_rows) <> 'array'
    or pg_catalog.jsonb_array_length(student_rows) > 500 then
    raise exception 'Invalid student rows' using errcode = '23514';
  end if;
  perform 1 from public.session_tests
    where id = target_test_id and class_id = target_class_id and session_id = target_session_id
    for update;
  if not found then
    raise exception 'Test not found in this session' using errcode = 'P0002';
  end if;

  insert into public.test_question_sheets(test_id,objective_count,essay_count,updated_by,updated_at)
    values (target_test_id,new_objective_count,new_essay_count,app_private.current_staff_id(),now())
    on conflict (test_id) do update set
      objective_count=excluded.objective_count,
      essay_count=excluded.essay_count,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at;
  delete from public.test_question_mistakes where test_id = target_test_id;

  for entry in select value from pg_catalog.jsonb_array_elements(student_rows) loop
    if pg_catalog.jsonb_typeof(entry) <> 'object'
      or coalesce(entry->>'student_id','') !~ '^[1-9][0-9]*$'
      or pg_catalog.jsonb_typeof(entry->'wrong_numbers') <> 'array' then
      raise exception 'Invalid student question row' using errcode = '23514';
    end if;
    selected_student_id := (entry->>'student_id')::bigint;
    if not app_private.student_can_record(target_class_id,target_session_id,selected_student_id) then
      raise exception 'Student is not in this session' using errcode = '23514';
    end if;
    wrongs := '{}'::smallint[];
    for token in select value from pg_catalog.jsonb_array_elements_text(entry->'wrong_numbers') loop
      if token !~ '^[0-9]+$' or length(token) > 3 then
        raise exception 'Invalid question number' using errcode = '23514';
      end if;
      number_value := token::integer;
      if number_value < 1 or number_value > new_objective_count + new_essay_count
        or number_value::smallint = any(wrongs) then
        raise exception 'Question number out of range or duplicated' using errcode = '23514';
      end if;
      wrongs := pg_catalog.array_append(wrongs, number_value::smallint);
    end loop;
    insert into public.test_question_mistakes(test_id,student_id,wrong_numbers)
      values (target_test_id,selected_student_id,wrongs);
  end loop;
end;
$$;
revoke all on function public.save_test_question_sheet(bigint,bigint,bigint,integer,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_test_question_sheet(bigint,bigint,bigint,integer,integer,jsonb)
  to authenticated;

-- Permanent enrollment/temporary-participant deletion removes the matching sheet cells.
create function app_private.clear_removed_question_student()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'enrollments' then
    delete from public.test_question_mistakes m using public.session_tests t
      where m.test_id = t.id and t.class_id = old.class_id and m.student_id = old.student_id;
  elsif tg_table_name = 'session_participants' then
    delete from public.test_question_mistakes m using public.session_tests t
      where m.test_id = t.id and t.class_id = old.host_class_id
        and t.session_id = old.session_id and m.student_id = old.student_id;
  end if;
  return old;
end;
$$;
create trigger clear_enrollment_question_student before delete on public.enrollments
  for each row execute function app_private.clear_removed_question_student();
create trigger clear_participant_question_student before delete on public.session_participants
  for each row execute function app_private.clear_removed_question_student();

notify pgrst, 'reload schema';
commit;
