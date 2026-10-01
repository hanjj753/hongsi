-- Add score and free-text result formats for session tests.
begin;

alter table public.session_tests
  add column result_type text not null default 'score'
    constraint session_tests_result_type_check check (result_type in ('score', 'memo'));
alter table public.session_tests alter column max_score drop not null;
alter table public.session_tests
  add constraint session_tests_result_type_maximum check (
    (result_type = 'score' and max_score is not null)
    or (result_type = 'memo' and max_score is null)
  );

alter table public.student_test_results
  add column result_text text
    constraint student_test_results_result_text_check check (
      result_text is null or (
        result_text = btrim(result_text)
        and result_text <> ''
        and char_length(result_text) <= 200
      )
    );
alter table public.student_test_results drop constraint test_result_score_or_absent;
alter table public.student_test_results
  add constraint test_result_value check (
    (score is not null and status is null and result_text is null)
    or (score is null and status = '결시' and result_text is null)
    or (score is null and status is null and result_text is not null)
  );

create or replace function app_private.check_test_score()
returns trigger language plpgsql set search_path = '' as $$
declare
  test_max numeric;
  test_format text;
begin
  select t.max_score, t.result_type into test_max, test_format
    from public.session_tests t
    where t.id = new.test_id and t.class_id = new.class_id for no key update;
  if new.score is not null and test_format <> 'score'
    or new.result_text is not null and test_format <> 'memo' then
    raise exception 'Test result does not match its format' using errcode = '23514';
  end if;
  if new.score > test_max then
    raise exception 'Test score cannot exceed its maximum' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app_private.check_test_score() from public, anon, authenticated;
drop trigger test_result_maximum on public.student_test_results;
create trigger test_result_maximum
  before insert or update of test_id, class_id, score, status, result_text
  on public.student_test_results for each row execute function app_private.check_test_score();

create or replace function app_private.check_test_maximum_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.result_type is distinct from old.result_type and exists (
    select 1 from public.student_test_results r where r.test_id = old.id
  ) then
    raise exception 'Test format cannot change after results are entered' using errcode = '23514';
  end if;
  if new.max_score < old.max_score and exists (
    select 1 from public.student_test_results r where r.test_id = old.id and r.score > new.max_score
  ) then
    raise exception 'Test maximum cannot be lower than an existing score' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app_private.check_test_maximum_change() from public, anon, authenticated;
drop trigger test_maximum_change on public.session_tests;
create trigger test_maximum_change
  before update of max_score, result_type on public.session_tests
  for each row execute function app_private.check_test_maximum_change();

grant insert (result_type), update (result_type) on public.session_tests to authenticated;
grant insert (result_text), update (result_text) on public.student_test_results to authenticated;

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
  result_text_value text;
  test_result_type text;
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
    select result_type into test_result_type from public.session_tests
      where id=item_id and class_id=target_class_id and session_id=target_session_id;
    if not found then
      raise exception 'Test does not belong to session' using errcode = '23503';
    end if;
    status_value := nullif(item->>'status','');
    score_value := case when item->>'score' is null then null else (item->>'score')::numeric end;
    result_text_value := nullif(btrim(item->>'result_text'), '');
    if status_value is null and score_value is null and result_text_value is null then
      delete from public.student_test_results where test_id=item_id and student_id=target_student_id;
    else
      if test_result_type = 'score' and result_text_value is not null
        or test_result_type = 'memo' and score_value is not null then
        raise exception 'Test result does not match its format' using errcode = '23514';
      end if;
      insert into public.student_test_results(class_id,test_id,student_id,score,status,result_text,notes)
      values (target_class_id,item_id,target_student_id,
        case when status_value='결시' then null else score_value end,
        status_value,
        case when status_value='결시' then null else result_text_value end,
        nullif(btrim(item->>'notes'),''))
      on conflict (test_id,student_id) do update set
        score=excluded.score,status=excluded.status,
        result_text=excluded.result_text,notes=excluded.notes;
    end if;
  end loop;
end;
$$;

revoke all on function public.save_student_session_draft(bigint,bigint,bigint,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_student_session_draft(bigint,bigint,bigint,jsonb,jsonb,jsonb)
  to authenticated;

comment on table public.session_tests is '차시별 시험 항목. 점수형은 만점 필수, 결과 메모형은 만점 없음.';
comment on table public.student_test_results is '학생 × 시험 항목 1행. 점수·결시 또는 간단한 결과 메모를 저장.';

notify pgrst, 'reload schema';
commit;
