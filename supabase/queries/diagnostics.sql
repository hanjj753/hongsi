-- READ-ONLY examples for SQL Editor. Example IDs/dates must be selected for your DB.
-- This file never deletes records, changes permissions, or sends messages.

-- 1. One row per student, including all homework/tests and missing results.
-- Aggregate each item family separately to avoid homework x test duplication.
-- Registration dates affect the roster; any historical result keeps it visible.
with selected_session as (
  select * from public.class_sessions where class_id = 1 and session_number = 1
), roster as (
  select s.id as session_id, st.id as student_id, st.student_code, st.full_name,
         st.default_message_recipients
  from selected_session s
  join public.enrollments e on e.class_id = s.class_id
  join public.students st on st.id = e.student_id
  where ((e.joined_on is null or e.joined_on <= s.session_date)
    and (e.ended_on is null or e.ended_on >= s.session_date))
    or exists (select 1 from public.student_session_records r
      where r.session_id = s.id and r.student_id = st.id)
    or exists (select 1 from public.student_homework_results r
      join public.session_homeworks h on h.id = r.homework_id
      where h.session_id = s.id and r.student_id = st.id)
    or exists (select 1 from public.student_test_results r
      join public.session_tests t on t.id = r.test_id
      where t.session_id = s.id and r.student_id = st.id)
), homework as (
  select ro.student_id, jsonb_agg(jsonb_build_object(
    'id', h.id::text, 'title', h.title, 'grade', r.grade
  ) order by h.sort_order, h.id) as items
  from roster ro join public.session_homeworks h on h.session_id = ro.session_id
  left join public.student_homework_results r on r.homework_id = h.id and r.student_id = ro.student_id
  group by ro.student_id
), tests as (
  select ro.student_id, jsonb_agg(jsonb_build_object(
    'id', t.id::text, 'title', t.title, 'max_score', t.max_score,
    'score', r.score, 'status', r.status
  ) order by t.sort_order, t.id) as items
  from roster ro join public.session_tests t on t.session_id = ro.session_id
  left join public.student_test_results r on r.test_id = t.id and r.student_id = ro.student_id
  group by ro.student_id
)
select ro.student_code, ro.full_name, ro.default_message_recipients,
       r.attendance_status, r.makeup_date, r.makeup_time, r.makeup_note,
       coalesce(h.items, '[]'::jsonb) as homework,
       coalesce(t.items, '[]'::jsonb) as tests
from roster ro
left join public.student_session_records r on r.session_id = ro.session_id and r.student_id = ro.student_id
left join homework h on h.student_id = ro.student_id
left join tests t on t.student_id = ro.student_id
order by ro.student_code;

-- 2. Monthly work totals for one staff member (Korean work dates).
select staff_id, sum(duration_minutes) as completed_minutes,
       count(*) filter (where ended_at is null) as open_shifts
from public.work_logs
where staff_id = 1 and work_date >= date '2026-09-01' and work_date < date '2026-10-01'
group by staff_id;

-- 3. Pending messages for one class: one row per selected recipient.
select m.id as message_id, d.recipient_type, m.student_name_snapshot,
       case d.recipient_type when 'student' then m.student_phone_snapshot
         else m.parent_phone_snapshot end as destination_phone,
       m.content, d.status
from public.messages m join public.message_deliveries d on d.message_id = m.id
where m.class_id = 1 and d.status = 'pending'
order by m.created_at, m.id, d.recipient_type
limit 100;

-- 4. Retention PREVIEW ONLY: no DELETE, no background schedule.
with cutoff as (
  select ((now() at time zone 'Asia/Seoul')::date - interval '3 years')::date as before_date
), candidates as (
  select 'attendance' as record_type, s.session_date from public.student_session_records r
    join public.class_sessions s on s.id = r.session_id
  union all
  select 'homework', s.session_date from public.student_homework_results r
    join public.session_homeworks h on h.id = r.homework_id
    join public.class_sessions s on s.id = h.session_id
  union all
  select 'test', s.session_date from public.student_test_results r
    join public.session_tests t on t.id = r.test_id
    join public.class_sessions s on s.id = t.session_id
)
select c.before_date, count(r.session_date) as candidate_records,
       count(*) filter (where r.record_type = 'attendance') as attendance_records,
       count(*) filter (where r.record_type = 'homework') as homework_results,
       count(*) filter (where r.record_type = 'test') as test_results,
       min(r.session_date) as oldest_session, max(r.session_date) as newest_candidate
from cutoff c
left join candidates r on r.session_date < c.before_date
group by c.before_date;

-- 5. Actual table and index storage (includes allocated/free space, not only live rows).
select relname as table_name,
       pg_size_pretty(pg_table_size(relid)) as table_size,
       pg_size_pretty(pg_indexes_size(relid)) as index_size,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_catalog.pg_statio_user_tables
where schemaname = 'public'
order by pg_total_relation_size(relid) desc;

-- 6. Combined student-record and assessment-definition storage. Still excludes
-- students, enrollments, classes, sessions, staff, messages, and other DB space.
with sizes as (
  select sum(pg_total_relation_size(t::regclass)) as table_and_index_bytes
  from unnest(array['public.student_session_records', 'public.session_homeworks',
    'public.student_homework_results', 'public.session_tests', 'public.student_test_results']) t
), counts as (
  select (select count(*) from public.student_session_records) as attendance_records,
    (select count(*) from public.student_homework_results) as homework_results,
    (select count(*) from public.student_test_results) as test_results
)
select c.*, s.table_and_index_bytes from counts c cross join sizes s;

-- 7. Each test has its own average; zero counts, absence/missing data does not.
-- Numeric rounding happens after AVG. The text form always has two decimals.
select t.id as test_id, t.title, t.max_score, count(r.score) as scored_students,
       count(*) filter (where r.status = '결시') as absent_students,
       round(avg(r.score), 2) as average_score,
       to_char(round(avg(r.score), 2), 'FM999990.00') as average_for_message,
       max(r.score) as highest_score
from public.session_tests t
left join public.student_test_results r on r.test_id = t.id
where t.class_id = 1 and t.session_id = 1
group by t.id
order by t.sort_order, t.id;
