import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Simulates upgrading a populated development database; no external connection.
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public, auth to anon,authenticated;
    grant execute on function auth.jwt() to anon,authenticated;`);
  const migrationDir = new URL('../migrations/', import.meta.url);
  const files = (await readdir(migrationDir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  const apply = async (migration) => db.exec(await readFile(new URL(migration, migrationDir), 'utf8'));
  for (const file of files.filter((name) => name < '20261009002100')) await apply(file);

  await db.exec(`
    insert into staff(id,full_name,email,firebase_uid,employment_status)
      values (1,'가상 관리자','admin@example.invalid','test-admin','active');
    insert into app_access(staff_id,app_role,access_status) values (1,'admin','approved');
    insert into class_terms(label) values ('2026-3');
    insert into classes(id,term_label,school,subject,weekdays,day_part,default_start_time,default_end_time)
      values (1,'2026-3','가상 학교','과학',array[0]::smallint[],'오후','14:00','16:00');
    insert into class_sessions(id,class_id,session_number,session_date) values
      (101,1,1,'2026-09-20'),(102,1,2,'2026-09-13');
    insert into students(id,student_code,full_name,student_phone,parent_phone)
      values (1,'S1','가상 학생','01000000001','01000000002');
    insert into enrollments(class_id,student_id) values (1,1);
    insert into student_session_records(session_id,student_id,class_id,attendance_status)
      values (101,1,1,'출석');
    insert into session_homeworks(id,class_id,session_id,title) values (201,1,101,'교재 숙제');
    insert into student_homework_results(homework_id,student_id,class_id,grade)
      values (201,1,1,'A');
    insert into session_tests(id,class_id,session_id,title,max_score)
      values (301,1,101,'단원 시험',30);
    insert into student_test_results(test_id,student_id,class_id,score)
      values (301,1,1,25.50);
    insert into work_logs(staff_id,class_id,work_label,started_at,ended_at)
      values (1,1,'가상 근무','2026-09-20 14:00+09','2026-09-20 16:00+09');
    insert into messages(class_id,student_id,session_id,student_name_snapshot,parent_phone_snapshot,content)
      values (1,1,101,'가상 학생','01000000002','가상 메시지');
    insert into message_deliveries(message_id,recipient_type) values (1,'parent');
  `);
  const before = (await db.query(`select
    (select count(*)::int from students) students,
    (select count(*)::int from enrollments) enrollments,
    (select count(*)::int from student_session_records) attendance,
    (select count(*)::int from student_homework_results) homework,
    (select count(*)::int from student_test_results) tests,
    (select count(*)::int from work_logs) work_logs,
    (select count(*)::int from messages) messages,
    (select count(*)::int from message_deliveries) deliveries`)).rows[0];

  for (const file of files.filter((name) => name >= '20261009002100')) await apply(file);
  const after = (await db.query(`select
    (select count(*)::int from students) students,
    (select count(*)::int from enrollments) enrollments,
    (select count(*)::int from student_session_records) attendance,
    (select count(*)::int from student_homework_results) homework,
    (select count(*)::int from student_test_results) tests,
    (select count(*)::int from work_logs) work_logs,
    (select count(*)::int from messages) messages,
    (select count(*)::int from message_deliveries) deliveries`)).rows[0];
  assert.deepEqual(after, before);
  assert.deepEqual((await db.query(`select id,session_number,session_date::text
    from class_sessions where class_id=1 order by id`)).rows, [
    { id: 101, session_number: 2, session_date: '2026-09-20' },
    { id: 102, session_number: 1, session_date: '2026-09-13' },
  ]);
  assert.deepEqual((await db.query(`select
    (select attendance_status from student_session_records where session_id=101) attendance,
    (select grade from student_homework_results where homework_id=201) grade,
    (select score::text from student_test_results where test_id=301) score,
    (select content from messages where id=1) message`)).rows[0], {
    attendance: '출석', grade: 'A', score: '25.50', message: '가상 메시지',
  });
  assert.deepEqual((await db.query(`select c.class_kind,w.weekday,w.day_part,w.start_time::text,w.end_time::text
    from classes c join class_weekday_times w on w.class_id=c.id where c.id=1`)).rows[0], {
    class_kind: 'regular', weekday: 0, day_part: '오후', start_time: '14:00:00', end_time: '16:00:00',
  });
  console.log('PASS populated database upgrades through migrations 21-23 without losing existing records');
} finally {
  await db.close();
}
