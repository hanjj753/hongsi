import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// In-memory PostgreSQL only. Never connects to Supabase or sends messages.
const db = new PGlite();
let passed = 0;
async function test(name, action) {
  await action();
  passed++;
  console.log(`PASS ${name}`);
}
async function rejected(sql, code, params = []) {
  const acceptedCodes = Array.isArray(code) ? code : [code];
  await assert.rejects(db.query(sql, params), error => acceptedCodes.includes(error.code));
}
async function first(sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  const initialMigration = await readFile(new URL('../migrations/20260913000100_initial_schema.sql', import.meta.url), 'utf8');
  const removeClassCodeMigration = await readFile(new URL('../migrations/20260923000300_remove_class_code.sql', import.meta.url), 'utf8');
  await test('schema migrations execute on PostgreSQL and remove class_code', async () => {
    await db.exec(initialMigration);
    await db.exec(removeClassCodeMigration);
    assert.equal((await first("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='classes' and column_name='class_code'")).n, 0);
  });
  await db.exec(`
    insert into staff(id, full_name, email, firebase_uid) values
      (1, '테스트 조교', 'assistant@example.invalid', 'firebase-subject-not-a-uuid'),
      (2, '테스트 관리자', 'manager@example.invalid', null);
    insert into app_access(staff_id) values (1);
    insert into app_access(staff_id,app_role,access_status) values (2,'admin','approved');
    insert into locations(id, name, latitude, longitude) values (1, '테스트 장소', 37, 127);
    insert into classes(id, term_label, school, subject, location_id) values
      (1, '2026-3', '가상 학교', '과학', 1),
      (2, '2026-3', '가상 학교', '물리', 1);
    insert into class_sessions(id, class_id, session_number, session_date) values
      (1, 1, 1, '2026-09-13'), (2, 1, 2, '2026-09-20'), (3, 2, 1, '2026-09-13');
    insert into students(id, student_code, full_name, student_phone, parent_phone) values
      (1, '0001', '가상 학생', '01000000001', '01000000002'),
      (2, '0002', '가상 학생 2', null, '01000000003'),
      (3, '0003', '가상 학생 3', null, null), (4, '0004', '가상 학생 4', null, null),
      (5, '0005', '가상 학생 5', null, null), (6, '0006', '가상 학생 6', null, null);
    insert into enrollments(class_id, student_id) values (1,1), (2,1), (2,2), (1,3), (1,4), (1,5), (1,6);
    insert into student_session_records(session_id, student_id, class_id, attendance_status)
      values (1,1,1,'출석');
    insert into session_homeworks(id,class_id,session_id,title,sort_order) values
      (1,1,1,'교재 숙제',0),(2,1,1,'프린트 숙제',1),(3,1,2,'교재 숙제',0);
    insert into student_homework_results(homework_id,student_id,class_id,grade) values
      (1,1,1,'A'),(2,1,1,'B'),(3,1,1,'미제출');
    insert into session_tests(id,class_id,session_id,title,max_score,sort_order) values
      (1,1,1,'단원 시험',30.50,0),(2,1,1,'단어 시험',10,1),(3,1,2,'단원 시험',50,0);
    insert into student_test_results(test_id,student_id,class_id,score,status) values
      (1,1,1,0,null),(1,3,1,25.50,null),(1,4,1,25.52,null),(1,5,1,null,'결시'),
      (2,1,1,8,null);
    select setval(pg_get_serial_sequence('staff','id'),2);
    select setval(pg_get_serial_sequence('locations','id'),1);
    select setval(pg_get_serial_sequence('classes','id'),2);
    select setval(pg_get_serial_sequence('class_sessions','id'),3);
    select setval(pg_get_serial_sequence('students','id'),6);
    select setval(pg_get_serial_sequence('session_homeworks','id'),3);
    select setval(pg_get_serial_sequence('session_tests','id'),3);
  `);
  await test('global student identity is shared across classes and keeps leading zeroes', async () => {
    assert.equal((await first('select count(*)::int n from enrollments where student_id=1')).n, 2);
    assert.equal((await first('select student_code from students where id=1')).student_code, '0001');
    await rejected("insert into students(student_code,full_name) values ('0001','중복')", '23505');
  });
  await test('Firebase subject is text and newly provisioned access defaults to pending', async () => {
    assert.equal((await first('select firebase_uid from staff where id=1')).firebase_uid, 'firebase-subject-not-a-uuid');
    assert.equal((await first('select access_status from app_access where staff_id=1')).access_status, 'pending');
    await rejected("insert into staff(full_name,email) values ('duplicate','assistant@example.invalid')", '23505');
  });
  await test('one record per student/session and one number per class/session', async () => {
    await rejected('insert into student_session_records(session_id,student_id,class_id) values (1,1,1)', '23505');
    await rejected("insert into class_sessions(class_id,session_number,session_date) values (1,1,'2026-09-14')", '23505');
  });
  await test('cross-class session references and unenrolled students are rejected', async () => {
    await rejected('insert into student_session_records(session_id,student_id,class_id) values (2,1,2)', '23503');
    await rejected('insert into student_session_records(session_id,student_id,class_id) values (2,2,1)', '23503');
  });
  await test('attendance accepts only the four confirmed values and preserves missing input', async () => {
    for (const status of ['출석', '영상', '보강', '결석', null]) {
      await db.query('update student_session_records set attendance_status=$1 where session_id=1', [status]);
      assert.equal((await first('select attendance_status from student_session_records where session_id=1')).attendance_status, status);
    }
    await rejected("update student_session_records set attendance_status='지각' where session_id=1", '23514');
    await rejected("update student_session_records set attendance_status='일 보강' where session_id=1", '23514');
    await db.exec("update student_session_records set attendance_status='출석' where session_id=1");
  });
  await test('makeup supports a date/time or a note until the date is known', async () => {
    await db.exec(`insert into student_session_records(session_id,student_id,class_id,attendance_status,makeup_note)
      values (2,1,1,'보강','일요일 예정, 날짜 미정')`);
    await db.exec("update student_session_records set makeup_date='2026-09-27',makeup_time='14:30' where session_id=2");
    assert.deepEqual(await first('select makeup_date::text,makeup_time::text,makeup_note from student_session_records where session_id=2'),
      { makeup_date: '2026-09-27', makeup_time: '14:30:00', makeup_note: '일요일 예정, 날짜 미정' });
    await rejected("update student_session_records set attendance_status='출석' where session_id=2", '23514');
    await rejected('update student_session_records set attendance_status=null where session_id=2', '23514');
    await rejected('update student_session_records set makeup_date=null where session_id=2', '23514');
  });
  await test('sessions have zero or multiple independently named homework and test items', async () => {
    assert.equal((await first('select count(*)::int n from session_homeworks where session_id=1')).n, 2);
    assert.equal((await first('select count(*)::int n from session_tests where session_id=1')).n, 2);
    assert.equal((await first('select count(*)::int n from session_homeworks where session_id=3')).n, 0);
    await rejected("insert into session_homeworks(class_id,session_id,title) values (1,1,'교재 숙제')", '23505');
    await rejected("insert into session_tests(class_id,session_id,title,max_score) values (1,1,'단원 시험',30)", '23505');
    // The same title in another session is valid, as fixture session 2 demonstrates.
    await rejected("insert into session_homeworks(class_id,session_id,title) values (2,1,'잘못된 연결')", '23503');
  });
  await test('homework has A/B/C/missing submission, while no result means not entered', async () => {
    assert.equal((await first('select grade from student_homework_results where homework_id=3')).grade, '미제출');
    assert.equal((await first('select count(*)::int n from student_homework_results where student_id=6')).n, 0);
    await db.exec("update student_homework_results set grade='C' where homework_id=2");
    await rejected("update student_homework_results set grade='O' where homework_id=1", '23514');
    await rejected('update student_homework_results set grade=null where homework_id=1', '23502');
  });
  await test('assessment results reject duplicate, unenrolled, and cross-class references', async () => {
    await rejected("insert into student_homework_results(homework_id,student_id,class_id,grade) values (1,1,1,'A')", '23505');
    await rejected("insert into student_homework_results(homework_id,student_id,class_id,grade) values (1,2,1,'A')", '23503');
    await rejected("insert into student_homework_results(homework_id,student_id,class_id,grade) values (1,2,2,'A')", '23503');
    await rejected('insert into student_test_results(test_id,student_id,class_id,score) values (1,1,1,10)', '23505');
    await rejected('insert into student_test_results(test_id,student_id,class_id,score) values (1,2,1,10)', '23503');
    await rejected('insert into student_test_results(test_id,student_id,class_id,score) values (1,2,2,10)', '23503');
  });
  await test('test zero, absence, and unentered results remain distinct', async () => {
    assert.equal(Number((await first('select score from student_test_results where test_id=1 and student_id=1')).score), 0);
    assert.deepEqual(await first('select score,status from student_test_results where test_id=1 and student_id=5'), { score: null, status: '결시' });
    assert.equal((await first('select count(*)::int n from student_test_results where test_id=1 and student_id=6')).n, 0);
    await rejected('insert into student_test_results(test_id,student_id,class_id) values (1,6,1)', '23514');
    await rejected("update student_test_results set score=0 where test_id=1 and student_id=5", '23514');
    await rejected("update student_test_results set status='미응시' where test_id=1 and student_id=5", '23514');
  });
  await test('test scores and maxima preserve hundredths and reject excess decimals or non-finite values', async () => {
    assert.equal(Number((await first('select score from student_test_results where test_id=1 and student_id=4')).score), 25.52);
    for (const value of ['-1', '0.001', '30.51', "'NaN'::numeric", "'Infinity'::numeric", "'-Infinity'::numeric"]) {
      await rejected(`update student_test_results set score=${value} where test_id=1 and student_id=1`, '23514');
    }
    for (const value of ['0', '-1', '50.001', "'NaN'::numeric", "'Infinity'::numeric"]) {
      await rejected(`update session_tests set max_score=${value} where id=3`, '23514');
    }
    await rejected('insert into session_tests(class_id,session_id,title) values (1,2,\'만점 없음\')', '23502');
    await db.exec('update session_tests set max_score=50.25 where id=3');
  });
  await test('maximum edits cannot invalidate scores already entered', async () => {
    await rejected('update session_tests set max_score=25.51 where id=1', '23514');
    await db.exec('update session_tests set max_score=25.52 where id=1');
    await db.exec('update session_tests set max_score=30.50 where id=1');
  });
  await test('message preference is student-wide, parent-only by default, and never auto-queues delivery', async () => {
    assert.equal((await first('select default_message_recipients from students where id=1')).default_message_recipients, 'parent');
    await db.exec("update students set default_message_recipients='both' where id=1");
    const rows = (await db.query('select s.default_message_recipients from enrollments e join students s on s.id=e.student_id where s.id=1')).rows;
    assert.deepEqual(rows.map(r => r.default_message_recipients), ['both', 'both']);
    assert.equal((await first('select count(*)::int n from message_deliveries')).n, 0);
    await rejected("update students set default_message_recipients='student' where id=1", '23514');
  });
  await test('coordinates must be a valid pair', async () => {
    await rejected("insert into locations(name,latitude) values ('invalid',37)", '23514');
    await rejected("insert into locations(name,latitude,longitude) values ('invalid',91,127)", '23514');
  });
  await test('a class can retain a school-only or subject-only legacy name', async () => {
    await db.exec("insert into classes(id,term_label,school) values (90,'2026-3','가상 학교')");
    await rejected("insert into classes(term_label) values ('2026-3')", '23514');
  });
  await test('non-class work and overnight work preserve KST date and duration', async () => {
    await db.exec(`insert into work_logs(staff_id,work_label,started_at,ended_at) values
      (1,'자료 작업','2026-09-13 23:30+09','2026-09-14 01:00+09')`);
    const log = await first('select class_id,work_date::text,duration_minutes from work_logs');
    assert.equal(log.class_id, null);
    assert.equal(log.work_date, '2026-09-13');
    assert.equal(log.duration_minutes, 90);
    await rejected("insert into work_logs(staff_id,work_label,started_at,ended_at) values (1,'invalid','2026-09-13 20:00+09','2026-09-13 19:00+09')", '23514');
  });
  await test('a staff member cannot check in to two open shifts', async () => {
    await db.exec("insert into work_logs(staff_id,class_id,work_label,started_at) values (1,1,'수업','2026-09-15 10:00+09')");
    await rejected("insert into work_logs(staff_id,class_id,work_label,started_at) values (1,2,'다른 수업','2026-09-15 10:01+09')", '23505');
  });
  await db.exec(`insert into messages(id,class_id,student_id,session_id,student_name_snapshot,student_phone_snapshot,parent_phone_snapshot,content,request_id)
    values (1,1,1,1,'가상 학생','01000000001','01000000002','가상 메시지','00000000-0000-0000-0000-000000000001')`);
  await test('student and parent delivery results are independent', async () => {
    await db.exec("insert into message_deliveries(message_id,recipient_type) values (1,'student'),(1,'parent')");
    await db.exec("update message_deliveries set status='submitted',submitted_at=now() where message_id=1 and recipient_type='student'");
    assert.equal((await first("select status from message_deliveries where message_id=1 and recipient_type='parent'")).status, 'pending');
    await rejected("insert into message_deliveries(message_id,recipient_type) values (1,'student')", '23505');
  });
  await test('sending device registry is distinct from account roles and preserves the sending device reference', async () => {
    const device = await first("insert into sending_devices(label,registered_by) values ('가상 발송 기기',2) returning id,is_enabled");
    assert.equal(device.is_enabled, false);
    await db.query('update sending_devices set is_enabled=true where id=$1', [device.id]);
    await db.query("update message_deliveries set sending_device_id=$1 where message_id=1 and recipient_type='student'", [device.id]);
    await rejected('delete from sending_devices where id=$1', ['23001', '23503'], [device.id]);
    // Device authentication/authorization is intentionally not implemented by this registry.
  });
  await test('contact changes do not rewrite historical message snapshots', async () => {
    await db.exec("update students set student_phone='01000000009' where id=1");
    assert.equal((await first('select student_phone_snapshot from messages where id=1')).student_phone_snapshot, '01000000001');
    await rejected("update messages set student_phone_snapshot='01000000009' where id=1", '23514');
  });
  await test('missing phones and unconfirmed submitted states are rejected', async () => {
    await db.exec("insert into messages(id,class_id,student_id,student_name_snapshot,parent_phone_snapshot,content) values (2,2,2,'가상 학생 2','01000000003','테스트')");
    await db.exec("select setval(pg_get_serial_sequence('messages','id'),2)");
    await rejected("insert into message_deliveries(message_id,recipient_type) values (2,'student')", '23514');
    await rejected("insert into message_deliveries(message_id,recipient_type,status) values (2,'parent','submitted')", '23514');
    await db.exec("insert into message_deliveries(message_id,recipient_type) values (2,'parent')");
    assert.equal((await first('select count(*)::int n from message_deliveries where message_id=2')).n, 1);
  });
  await test('messages cannot associate a student or session with the wrong class', async () => {
    await rejected("insert into messages(class_id,student_id,student_name_snapshot,content) values (1,2,'가상 학생 2','잘못된 수강생')", '23503');
    await rejected("insert into messages(class_id,student_id,session_id,student_name_snapshot,content) values (1,1,3,'가상 학생','잘못된 차시')", '23503');
  });
  await test('retrying the same message creation is deduplicated', async () => {
    await rejected("insert into messages(class_id,student_id,student_name_snapshot,content,request_id) values (1,1,'가상 학생','중복','00000000-0000-0000-0000-000000000001')", '23505');
  });
  await test('referenced records cannot be deleted accidentally', async () => {
    // PostgreSQL versions distinguish restrict_violation from foreign_key_violation.
    await rejected('delete from classes where id=1', ['23001', '23503']);
    await rejected('delete from students where id=1', ['23001', '23503']);
    await rejected('delete from class_sessions where id=1', ['23001', '23503']);
  });
  await test('inquiry resolution can preserve unknown legacy resolver/time', async () => {
    await db.exec("insert into inquiries(requester_staff_id,content,status) values (1,'가상 문의','resolved')");
    await rejected("insert into inquiries(requester_staff_id,content,status,resolved_by) values (1,'invalid','open',2)", '23514');
  });
  await test('all 20 tables have RLS enabled and no client grants', async () => {
    const tables = (await db.query("select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'")).rows;
    assert.equal(tables.length, 20);
    for (const table of tables) {
      assert.equal(table.relrowsecurity, true, table.relname);
      for (const role of ['anon', 'authenticated']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          assert.equal((await first('select has_table_privilege($1,$2,$3) allowed', [role, `public.${table.relname}`, privilege])).allowed, false);
        }
      }
    }
  });
  await test('RLS still denies access if SELECT privilege is accidentally granted', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`grant select on students to ${role}; set role ${role};`);
      try {
        assert.equal((await db.query('select * from students')).rows.length, 0);
      } finally {
        await db.exec(`reset role; revoke select on students from ${role};`);
      }
    }
  });

  // Synthetic sample: 100 students x 100 sessions x (attendance + 2 homework + 2 tests).
  // This is NOT a capacity guarantee or a production latency benchmark.
  await db.exec(`
    insert into classes(id,term_label,school,subject) values (100,'sample','가상 학교','과학');
    insert into students(id,student_code,full_name)
      select 1000+n,'SAMPLE-'||n,'가상 학생 '||n from generate_series(1,100) n;
    insert into enrollments(class_id,student_id) select 100,id from students where id between 1001 and 1100;
    insert into class_sessions(id,class_id,session_number,session_date)
      select 1000+n,100,n,date '2023-01-01'+n from generate_series(1,100) n;
    insert into student_session_records(session_id,student_id,class_id,attendance_status,updated_by)
      select s.id,e.student_id,100,'출석',1
      from class_sessions s join enrollments e on e.class_id=s.class_id where s.class_id=100;
    insert into session_homeworks(class_id,session_id,title,sort_order,updated_by)
      select 100,s.id,'숙제 '||n,n,1 from class_sessions s cross join generate_series(1,2) n where s.class_id=100;
    insert into student_homework_results(homework_id,student_id,class_id,grade,updated_by)
      select h.id,e.student_id,100,'A',1 from session_homeworks h join enrollments e on e.class_id=h.class_id where h.class_id=100;
    insert into session_tests(class_id,session_id,title,max_score,sort_order,updated_by)
      select 100,s.id,'시험 '||n,30*n,n,1 from class_sessions s cross join generate_series(1,2) n where s.class_id=100;
    insert into student_test_results(test_id,student_id,class_id,score,updated_by)
      select t.id,e.student_id,100,25.50,1 from session_tests t join enrollments e on e.class_id=t.class_id where t.class_id=100;
    analyze student_session_records;
    analyze student_homework_results;
    analyze student_test_results;
  `);
  const sizing = await first(`select
    (select count(*)::int from student_session_records) as attendance_rows,
    (select count(*)::int from student_homework_results) as homework_rows,
    (select count(*)::int from student_test_results) as test_rows,
    sum(pg_table_size(t::regclass))::text as table_bytes,
    sum(pg_indexes_size(t::regclass))::text as index_bytes,
    sum(pg_total_relation_size(t::regclass))::text as total_bytes
    from unnest(array['public.student_session_records','public.session_homeworks',
      'public.student_homework_results','public.session_tests','public.student_test_results']) t`);
  console.log('SYNTHETIC_SIZE', JSON.stringify(sizing));
  await test('three-year retention selects records by session date without deleting work/message data', async () => {
    const old = await first(`select count(*)::int n from student_session_records r
      join class_sessions s on s.id=r.session_id
      where s.session_date < date '2026-09-13' - interval '3 years'`);
    assert.equal(old.n, 10000);
    const resultCounts = await first(`select
      (select count(*)::int from student_homework_results where class_id=100) h,
      (select count(*)::int from student_test_results where class_id=100) t`);
    assert.deepEqual(resultCounts, { h: 20000, t: 20000 });
    const before = await first('select (select count(*)::int from messages) m, (select count(*)::int from work_logs) w');
    await db.exec('begin');
    try {
      await db.exec(`delete from student_session_records r using class_sessions s
        where s.id=r.session_id and s.session_date < date '2026-09-13' - interval '3 years'`);
      await db.exec(`delete from student_homework_results r using session_homeworks h,class_sessions s
        where r.homework_id=h.id and h.session_id=s.id and s.session_date < date '2026-09-13' - interval '3 years'`);
      await db.exec(`delete from student_test_results r using session_tests t,class_sessions s
        where r.test_id=t.id and t.session_id=s.id and s.session_date < date '2026-09-13' - interval '3 years'`);
      assert.equal((await first('select count(*)::int n from student_homework_results where class_id=100')).n, 0);
      assert.equal((await first('select count(*)::int n from student_test_results where class_id=100')).n, 0);
      assert.equal((await first('select count(*)::int n from session_tests where class_id=100')).n, 200);
      const after = await first('select (select count(*)::int from messages) m, (select count(*)::int from work_logs) w');
      assert.deepEqual(after, before);
    } finally {
      await db.exec('rollback');
    }
  });
  await test('documented read-only SQL examples execute on the schema', async () => {
    const sql = await readFile(new URL('../queries/diagnostics.sql', import.meta.url), 'utf8');
    const results = await db.exec(sql);
    assert.equal(results.length, 7);
    assert.equal((await first('select count(*)::int n from student_session_records')).n, 10002);
    const roster = results[0].rows;
    assert.equal(roster.length, 5);
    const student = roster.find(r => r.student_code === '0001');
    assert.equal(student.homework.length, 2);
    assert.equal(student.tests.length, 2);
    assert.equal(student.homework[0].grade, 'A');
    assert.equal(student.tests[0].score, 0);
    assert.equal(roster.find(r => r.student_code === '0006').homework[0].grade, null);
    const average = results[6].rows.find(r => Number(r.test_id) === 1);
    assert.equal(Number(average.scored_students), 3);
    assert.equal(Number(average.absent_students), 1);
    assert.equal(average.average_for_message, '17.01');
    assert.equal(results[6].rows.find(r => Number(r.test_id) === 2).average_for_message, '8.00');
  });
  console.log(`Completed ${passed} tests. No production database was accessed.`);
} finally {
  await db.close();
}
