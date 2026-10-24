import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Simulates verified claims inside PostgreSQL; NOT a test of JWT signatures,
// Firebase revocation, PostgREST, or actual device authentication.
const db = new PGlite();
let passed = 0;
async function test(name, fn) { await fn(); console.log(`PASS ${name}`); passed++; }
async function first(sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function denied(sql) {
  await assert.rejects(db.query(sql), e => e.code === '42501');
}
async function actor(uid, fn, overrides = {}) {
  const emailByUid = {
    'admin-uid': 'admin@example.invalid', 'manager-uid': 'manager@example.invalid',
    'assistant-uid': 'assistant@example.invalid', 'pending-uid': 'pending@example.invalid',
    'suspended-uid': 'suspended@example.invalid', 'inactive-uid': 'inactive@example.invalid',
  };
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
    sub: uid, iss: 'https://securetoken.google.com/hongsi-assistant', aud: 'hongsi-assistant',
    role: 'authenticated', email_verified: true, email: emailByUid[uid] ?? '', ...overrides,
  })]);
  await db.exec('set role authenticated');
  try { await fn(); } finally { await db.exec("reset role; reset request.jwt.claims"); }
}
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public, auth to anon,authenticated;
    grant execute on function auth.jwt() to anon,authenticated;`);
  const migrationDir = new URL('../migrations/', import.meta.url);
  const staffEmailLoginMigration = '20261025003000_staff_email_login.sql';
  for (const file of (await readdir(migrationDir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    if (file === staffEmailLoginMigration) continue;
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  // The live development database may already have this permission change when migrations are replayed.
  await db.exec(await readFile(new URL('../migrations/20261024002400_assistant_student_editor.sql', import.meta.url), 'utf8'));
  await db.exec(`
    insert into staff(id,full_name,email,firebase_uid,employment_status) values
      (1,'관리자','admin@example.invalid','admin-uid','active'),
      (2,'매니저','manager@example.invalid','manager-uid','active'),
      (3,'조교','assistant@example.invalid','assistant-uid','active'),
      (4,'승인 대기','pending@example.invalid','pending-uid','active'),
      (5,'중지','suspended@example.invalid','suspended-uid','active'),
      (6,'퇴사','inactive@example.invalid','inactive-uid','inactive');
    insert into app_access(staff_id,app_role,access_status) values
      (1,'admin','approved'),(2,'manager','approved'),(3,'assistant','approved'),
      (4,'assistant','pending'),(5,'admin','suspended'),(6,'admin','approved');
    insert into staff_private_details(staff_id,bank_account) values (1,'TEST-ACCOUNT'),(3,'TEST-OWN-ACCOUNT');
    insert into class_terms(label) values ('TEST');
    insert into classes(id,term_label,subject) values (1,'TEST','과학'),(2,'TEST','과학');
    insert into class_staff(class_id,staff_id) values (1,3);
    insert into class_sessions(id,class_id,session_number,session_date) values (1,1,1,'2026-09-13'),(2,2,1,'2026-09-13');
    insert into students(id,student_code,full_name) values (1,'S1','가상 학생');
    insert into enrollments(class_id,student_id) values (1,1),(2,1);
    insert into session_homeworks(id,class_id,session_id,title) values (1,2,2,'배정 안 된 수업 숙제');
    insert into session_tests(id,class_id,session_id,title,max_score) values (1,2,2,'배정 안 된 수업 시험',30);
    insert into work_logs(staff_id,work_label,started_at,ended_at) values
      (1,'테스트','2026-09-13 10:00+09','2026-09-13 11:00+09'),
      (3,'테스트','2026-09-13 10:00+09','2026-09-13 11:00+09');
    insert into messages(class_id,student_id,session_id,student_name_snapshot,parent_phone_snapshot,content) values
      (1,1,1,'가상 학생','01000000000','TEST 1'),(2,1,2,'가상 학생','01000000000','TEST 2');
    insert into message_deliveries(message_id,recipient_type) values (1,'parent'),(2,'parent');
    select setval(pg_get_serial_sequence('classes','id'),2);
    select setval(pg_get_serial_sequence('class_sessions','id'),2);
  `);
  await db.exec(await readFile(new URL(`../migrations/${staffEmailLoginMigration}`, import.meta.url), 'utf8'));
  await test('all migrations execute and retain RLS on all 25 tables', async () => {
    assert.equal((await first("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and relrowsecurity")).n, 25);
  });
  await test('anonymous users have no table access or public privileged RPC', async () => {
    await db.exec('set role anon');
    try {
      await denied('select * from students');
      await denied('select public.get_my_access()');
      await denied('select public.link_my_staff_account()');
      await denied('select public.start_my_work_shift(1)');
      await denied('select public.finish_my_work_shift()');
      await denied('select * from public.get_class_work_summary(1)');
      await denied('select public.get_database_usage_bytes()');
      await denied("select public.save_test_question_sheet(1,1,1,3,1,'[]'::jsonb)");
      await denied('select * from public.test_question_sheets');
      await denied("select public.save_student_session_draft(2,2,1,'{}','[]','[]')");
      await denied("select public.save_session_roster_draft(2,2,'[]')");
      await denied("select public.save_class_term(null,'2026-TEST')");
      await denied("select public.create_class_sessions(1,'[{\"session_number\":2,\"session_date\":\"2026-09-20\"}]')");
      await denied("select public.delete_session_item(2,2,'test',1)");
      await denied("select public.transfer_student(1,2,1,'2026-09-20')");
      await denied("select public.add_makeup_participant(2,2,1,1,1,'')");
      await denied("select public.save_managed_class_with_staff(null,'TEST','학교','과학',null,array[1]::smallint[],null,null,null,true,array[2]::bigint[])");
      await denied("select public.save_managed_class_with_day_part(null,'TEST','학교','과학',null,array[1]::smallint[],null,null,null,true,array[2]::bigint[],'저녁')");
      await denied("select public.update_enrollment_start_date(1,1,'2026-09-01')");
      await denied("select public.update_class_session(1,1,'2026-09-13','',array[]::bigint[])");
      await denied("select public.delete_class_session(1,1)");
      await denied("select public.delete_class_enrollment(1,1)");
      await denied("select public.delete_managed_class(1)");
    }
    finally { await db.exec('reset role'); }
  });
  await test('unregistered, inactive, and foreign-project users cannot access student data', async () => {
    for (const uid of ['unknown','inactive-uid']) {
      await actor(uid, async () => {
        assert.equal((await db.query('select * from students')).rows.length, 0);
        await denied("insert into students(student_code,full_name) values ('INVALID','불가')");
      });
    }
    for (const overrides of [{ iss:'https://securetoken.google.com/foreign' }, { aud:'foreign' }, { email_verified:false }, { role:'admin' }]) {
      await actor('admin-uid', async () => assert.equal((await db.query('select * from students')).rows.length, 0), overrides);
    }
  });
  await test('listed active staff can enter without a separate approval, including legacy pending/suspended rows', async () => {
    assert.deepEqual(await first('select app_role,access_status from app_access where staff_id=5'),
      { app_role: 'assistant', access_status: 'approved' });
    for (const uid of ['pending-uid', 'suspended-uid']) await actor(uid, async () => {
      const r = (await first('select public.get_my_access() as access')).access;
      assert.equal(r.access_status, 'approved');
      assert.equal(r.can_manage_accounts, false); assert.equal(r.can_manage_devices, false);
      assert.equal((await db.query('select * from students')).rows.length, 1);
    });
  });
  await test('assistant can read and enter student data in an unassigned class with server-stamped actor', async () => {
    await actor('assistant-uid', async () => {
      assert.equal((await db.query('select * from classes')).rows.length, 2);
      await db.exec("insert into student_session_records(session_id,student_id,class_id,attendance_status) values (2,1,2,'영상')");
      await db.exec('insert into student_test_results(test_id,student_id,class_id,score) values (1,1,2,25.25)');
      assert.equal(Number((await first('select updated_by from student_test_results where test_id=1')).updated_by), 3);
      await denied('update student_test_results set updated_by=1 where test_id=1');
      await denied('update student_test_results set student_id=2 where test_id=1');
      await denied("insert into classes(term_label,subject) values ('TEST','과학')");
      await denied('delete from student_test_results');
    });
  });
  await test('assistant test entry still enforces test maximum under RLS', async () => {
    await actor('assistant-uid', async () => {
      await assert.rejects(db.query('update student_test_results set score=31 where test_id=1'), e => e.code === '23514');
    });
  });
  await test('session draft RPC saves atomically and can restore homework and tests to unentered', async () => {
    await actor('assistant-uid', async () => {
      await db.exec(`select public.save_student_session_draft(
        2,2,1,
        '{"status":"보강","makeup_date":"2026-09-20","makeup_time":"14:30","makeup_note":"일요일"}',
        '[{"homework_id":1,"grade":"A"}]',
        '[{"test_id":1,"score":25.25,"status":""}]'
      )`);
      assert.equal((await first("select attendance_status from student_session_records where session_id=2 and student_id=1")).attendance_status, '보강');
      assert.equal((await first('select grade from student_homework_results where homework_id=1 and student_id=1')).grade, 'A');
      assert.equal(Number((await first('select score from student_test_results where test_id=1 and student_id=1')).score), 25.25);
      assert.equal(Number((await first('select updated_by from student_homework_results where homework_id=1 and student_id=1')).updated_by), 3);
      await db.exec(`select public.save_student_session_draft(
        2,2,1,
        '{"status":"","makeup_date":"","makeup_time":"","makeup_note":"","notes":""}',
        '[{"homework_id":1,"grade":""}]',
        '[{"test_id":1,"score":null,"status":""}]'
      )`);
      assert.equal((await first('select count(*)::int n from student_session_records where session_id=2 and student_id=1')).n, 0);
      assert.equal((await first('select count(*)::int n from student_homework_results where homework_id=1 and student_id=1')).n, 0);
      assert.equal((await first('select count(*)::int n from student_test_results where test_id=1 and student_id=1')).n, 0);
    });
  });
  await test('managers can view but not edit bank details; assistants cannot view them', async () => {
    await actor('assistant-uid', async () => {
      assert.equal((await db.query('select * from staff_private_details')).rows.length, 0);
      await denied("insert into staff_private_details(staff_id,bank_account) values (2,'NOT ALLOWED')");
    });
    await actor('manager-uid', async () => {
      assert.equal((await db.query('select * from staff_private_details')).rows.length, 2);
      await db.query("update staff_private_details set bank_account='NOT ALLOWED' where staff_id=3");
      assert.equal((await first('select bank_account from staff_private_details where staff_id=3')).bank_account, 'TEST-OWN-ACCOUNT');
      await denied("insert into staff_private_details(staff_id,bank_account) values (2,'NOT ALLOWED')");
    });
    await actor('admin-uid', async () => assert.equal((await db.query('select * from staff_private_details')).rows.length, 2));
  });
  await test('manager and admin can register, enable, and disable a sending device; assistant cannot', async () => {
    for (const uid of ['manager-uid','admin-uid']) {
      await actor(uid, async () => {
        const device = await first("insert into sending_devices(label,is_enabled) values ('테스트 기기',true) returning *");
        assert.equal(Number(device.registered_by), uid === 'manager-uid' ? 2 : 1);
        await db.query('update sending_devices set is_enabled=false where id=$1', [device.id]);
      });
    }
    await actor('assistant-uid', async () => {
      await denied("insert into sending_devices(label,is_enabled) values ('불가',true)");
      assert.equal((await db.query('select * from sending_devices')).rows.length, 0);
    });
  });
  await test('account role cannot be forged through row writes, Firebase UID, email, or custom app_role claim', async () => {
    await actor('assistant-uid', async () => {
      await denied("update app_access set app_role='admin' where staff_id=3");
      await denied("update staff set firebase_uid='assistant-uid' where id=1");
      assert.equal((await first('select public.get_my_access() as a')).a, null);
    }, { email:'admin@example.invalid', app_role:'admin' });
  });
  await test('manager cannot assign account roles or change employment status', async () => {
    await actor('manager-uid', async () => {
      await denied("select public.admin_set_access(4,'assistant','approved')");
      await denied("update staff set employment_status='inactive' where id=1");
    });
  });
  await test('admin can preassign another account role and cannot change its own privilege or suspend a listed account', async () => {
    await actor('admin-uid', async () => {
      await denied("select public.admin_set_access(1,'assistant','approved')");
      await db.exec("select public.admin_set_access(4,'assistant','approved')");
    });
    await actor('pending-uid', async () => assert.equal((await db.query('select * from students')).rows.length, 1));
    await actor('admin-uid', async () => await assert.rejects(db.query("select public.admin_set_access(4,'assistant','suspended')"), e => e.code === '23514'));
    await actor('pending-uid', async () => assert.equal((await db.query('select * from students')).rows.length, 1));
  });
  await test('approved assistant can register and edit students while destructive enrollment actions stay managed', async () => {
    await actor('assistant-uid', async () => {
      const result = await first("select public.register_student_and_enroll(2,null,'SA','조교 등록 학생','','01011112222','','parent','2026-09-01') as id");
      assert.ok(result.id);
      await db.query("select public.update_student_and_enrollment(2,$1,'SA','조교 수정 학생','01099998888','01011112222','','both','2026-09-02')", [result.id]);
      const edited = await first('select s.full_name,s.default_message_recipients,e.joined_on::text from students s join enrollments e on e.student_id=s.id where s.id=$1 and e.class_id=2', [result.id]);
      assert.deepEqual(edited, { full_name: '조교 수정 학생', default_message_recipients: 'both', joined_on: '2026-09-02' });
      await denied(`select public.delete_class_enrollment(2,${result.id})`);
    });
    await actor('manager-uid', async () => {
      const result = await first("select public.register_student_and_enroll(2,null,'S2','새 학생','01000001111','01011112222','','both','2026-09-01') as id");
      assert.ok(result.id);
      assert.equal((await first("select count(*)::int n from enrollments e join students s on s.id=e.student_id where e.class_id=2 and s.student_code='S2'")).n, 1);
      await assert.rejects(
        db.query("select public.register_student_and_enroll(2,null,'S2','다른 이름','','01011112222','','parent','2026-09-01')"),
        error => error.code === '23514',
      );
    });
  });
  await test('enrolling an existing global student preserves contact and recipient settings', async () => {
    await actor('manager-uid', async () => {
      await db.exec("select public.register_student_and_enroll(1,null,'S3','공유 학생','01033334444','01055556666','shared@example.invalid','both','2026-09-01')");
      await db.exec("select public.register_student_and_enroll(2,null,'S3','공유 학생','','','','parent','2026-09-08')");
      const student = await first("select student_phone,parent_phone,email,default_message_recipients from students where student_code='S3'");
      assert.equal(student.student_phone, '01033334444');
      assert.equal(student.parent_phone, '01055556666');
      assert.equal(student.email, 'shared@example.invalid');
      assert.equal(student.default_message_recipients, 'both');
      assert.equal((await first("select count(*)::int n from enrollments e join students s on s.id=e.student_id where s.student_code='S3'")).n, 2);
    });
  });
  await test('blank student code is generated and contact formats are normalized and validated', async () => {
    await actor('manager-uid', async () => {
      const result = await first("select public.register_student_and_enroll(2,null,'','자동 학생','010-7777-8888','(010) 9999-0000','AUTO@EXAMPLE.INVALID','both','2026-09-01') as id");
      const student = await first('select student_code,student_phone,parent_phone,email from students where id=$1', [result.id]);
      assert.match(student.student_code, /^S[A-F0-9]{8}$/);
      assert.equal(student.student_phone, '01077778888');
      assert.equal(student.parent_phone, '01099990000');
      assert.equal(student.email, 'auto@example.invalid');
      await assert.rejects(
        db.query("update students set student_phone='02-123-4567' where id=$1", [result.id]),
        error => error.code === '23514',
      );
      await assert.rejects(
        db.query("update students set email='not-an-email' where id=$1", [result.id]),
        error => error.code === '23514',
      );
    });
  });
  await test('session roster RPC saves every student atomically', async () => {
    let secondStudentId;
    await actor('manager-uid', async () => {
      const result = await first("select public.register_student_and_enroll(2,null,'BATCH','일괄 학생','','01012345678','','parent','2026-09-01') as id");
      secondStudentId = String(result.id);
    });
    await actor('assistant-uid', async () => {
      const invalidDrafts = [
        { student_id: 1, attendance: { status: '출석' }, homework_results: [], test_results: [] },
        { student_id: secondStudentId, attendance: { status: '영상' }, homework_results: [], test_results: [{ test_id: 1, score: 31, status: '' }] },
      ];
      await assert.rejects(
        db.query('select public.save_session_roster_draft(2,2,$1::jsonb)', [JSON.stringify(invalidDrafts)]),
        error => error.code === '23514',
      );
      assert.equal((await first('select count(*)::int n from student_session_records where class_id=2')).n, 0);

      const validDrafts = [
        { student_id: 1, attendance: { status: '출석' }, homework_results: [{ homework_id: 1, grade: 'A' }], test_results: [{ test_id: 1, score: 20.25, status: '' }] },
        { student_id: secondStudentId, attendance: { status: '영상' }, homework_results: [{ homework_id: 1, grade: '미제출' }], test_results: [{ test_id: 1, score: null, status: '결시' }] },
      ];
      await db.query('select public.save_session_roster_draft(2,2,$1::jsonb)', [JSON.stringify(validDrafts)]);
      assert.equal((await first('select count(*)::int n from student_session_records where class_id=2')).n, 2);
      assert.equal((await first('select count(*)::int n from student_homework_results where class_id=2')).n, 2);
      assert.equal((await first('select count(*)::int n from student_test_results where class_id=2')).n, 2);
    });
  });
  await test('manager maintains terms, classes, and session batches while assistant cannot', async () => {
    await actor('assistant-uid', async () => {
      await denied("select public.save_class_term(null,'2026-X')");
      await denied("select public.save_managed_class(null,'TEST','학교','화학',null,array[1]::smallint[],'18:00','20:00',15000,true)");
      await denied("select public.create_class_sessions(1,'[{\"session_number\":2,\"session_date\":\"2026-09-20\"}]')");
    });
    await actor('manager-uid', async () => {
      assert.equal((await first("select public.save_class_term(null,'2026-X') as label")).label, '2026-X');
      const created = await first("select public.save_managed_class(null,'2026-X','가상고','화학',null,array[1,3]::smallint[],'18:00','20:00',15000,true) as id");
      assert.equal(Number((await first("select public.create_class_sessions($1,'[{\"session_number\":1,\"session_date\":\"2026-10-01\"},{\"session_number\":2,\"session_date\":\"2026-10-08\"}]') as n", [created.id])).n), 2);
      assert.equal((await first("select public.save_class_term('2026-X','2026-Y') as label")).label, '2026-Y');
      assert.equal((await first('select term_label from classes where id=$1', [created.id])).term_label, '2026-Y');
      await db.query('select public.archive_managed_class($1)', [created.id]);
      assert.equal((await first('select is_active from classes where id=$1', [created.id])).is_active, false);
      await db.exec("select public.archive_class_term('2026-Y')");
      assert.equal((await first("select is_active from class_terms where label='2026-Y'")).is_active, false);
    });
  });
  await test('manager transfers a student within a term and preserves the old enrollment', async () => {
    let studentId;
    await actor('manager-uid', async () => {
      studentId = String((await first("select public.register_student_and_enroll(1,null,'MOVE','전반 학생','','01022223333','','parent','2026-09-01') as id")).id);
      await db.query("select public.transfer_student(1,2,$1,'2026-09-10')", [studentId]);
      const source = await first('select enrollment_status,ended_on::text,transferred_to_class_id from enrollments where class_id=1 and student_id=$1', [studentId]);
      const target = await first('select enrollment_status,joined_on::text,ended_on from enrollments where class_id=2 and student_id=$1', [studentId]);
      assert.deepEqual(source, { enrollment_status: 'transferred', ended_on: '2026-09-09', transferred_to_class_id: 2 });
      assert.deepEqual(target, { enrollment_status: 'active', joined_on: '2026-09-10', ended_on: null });
      await assert.rejects(db.query("select public.reactivate_student(1,$1,'2026-09-11')", [studentId]), e => e.code === 'P0002');
    });
    await actor('assistant-uid', async () => {
      await assert.rejects(db.query("select public.transfer_student(2,1,$1,'2026-09-20')", [studentId]), e => e.code === '42501');
    });
  });
  await test('linked makeup sessions work in either date order and clean both sides', async () => {
    let studentId;
    let originalSessionId;
    await actor('manager-uid', async () => {
      studentId = String((await first("select public.register_student_and_enroll(1,null,'MAKEUP','보강 학생','','01044445555','','parent','2026-09-01') as id")).id);
      originalSessionId = String((await first("insert into class_sessions(class_id,session_number,session_date) values (1,99,'2026-09-20') returning id")).id);
    });
    await actor('assistant-uid', async () => {
      await db.query("select public.save_student_session_draft(1,$1,$2,'{\"status\":\"결석\",\"notes\":\"원래 메모\"}','[]','[]')", [originalSessionId,studentId]);
    });
    await actor('manager-uid', async () => {
      // B (2026-09-13) is earlier than A (2026-09-20); the link is still valid.
      await db.query("select public.add_makeup_participant(2,2,$1,1,$2,'1회 보강')", [studentId,originalSessionId]);
      assert.deepEqual(await first(`select attendance_status,makeup_date::text,makeup_host_session_id::text,notes
        from student_session_records where session_id=$1 and student_id=$2`, [originalSessionId,studentId]), {
        attendance_status: '보강', makeup_date: '2026-09-13', makeup_host_session_id: '2', notes: '원래 메모',
      });
      assert.equal(String((await first('select home_session_id from session_participants where session_id=2 and student_id=$1', [studentId])).home_session_id), originalSessionId);
    });
    await actor('assistant-uid', async () => {
      await db.query("select public.save_student_session_draft(2,2,$1,'{\"status\":\"출석\"}','[{\"homework_id\":1,\"grade\":\"A\"}]','[{\"test_id\":1,\"score\":20.5,\"status\":\"\"}]')", [studentId]);
      assert.equal((await first('select attendance_status from student_session_records where session_id=2 and student_id=$1', [studentId])).attendance_status, '출석');
      await assert.rejects(
        db.query("select public.save_student_session_draft(1,$1,$2,'{\"status\":\"결석\",\"notes\":\"원래 메모\"}','[]','[]')", [originalSessionId,studentId]),
        e => e.code === '23514',
      );
    });
    await actor('manager-uid', async () => {
      await db.query("select public.update_class_session(2,2,'2026-09-14','보강 일정 수정',array[2]::bigint[])");
      assert.equal((await first('select makeup_date::text from student_session_records where session_id=$1 and student_id=$2', [originalSessionId,studentId])).makeup_date, '2026-09-14');
      await db.query('select public.remove_makeup_participant(2,2,$1)', [studentId]);
      assert.equal((await first('select count(*)::int n from student_session_records where session_id=2 and student_id=$1', [studentId])).n, 0);
      assert.equal((await first('select count(*)::int n from session_participants where session_id=2 and student_id=$1', [studentId])).n, 0);
      assert.deepEqual(await first(`select attendance_status,makeup_date,makeup_host_session_id,notes
        from student_session_records where session_id=$1 and student_id=$2`, [originalSessionId,studentId]), {
        attendance_status: null, makeup_date: null, makeup_host_session_id: null, notes: '원래 메모',
      });
      assert.equal((await first('select count(*)::int n from student_homework_results where homework_id=1 and student_id=$1', [studentId])).n, 0);
      assert.equal((await first('select count(*)::int n from student_test_results where test_id=1 and student_id=$1', [studentId])).n, 0);
    });
  });
  await test('new sessions accept an explicit scheduled-worker list', async () => {
    await actor('manager-uid', async () => {
      assert.equal(Number((await first("select public.create_class_sessions(1,'[{\"session_number\":2,\"session_date\":\"2026-09-20\",\"staff_ids\":[2]}]') as n")).n), 1);
      const newSession = await first('select id from class_sessions where class_id=1 order by id desc limit 1');
      assert.deepEqual((await db.query('select staff_id from session_staff where session_id=$1 order by staff_id', [newSession.id])).rows, [{ staff_id: 2 }]);
    });
  });
  await test('manager can maintain default staff, enrollment dates, sessions, and permanent cleanup', async () => {
    let classId;
    let sessionId;
    let studentId;
    await actor('assistant-uid', async () => {
      await denied("select public.delete_class_enrollment(1,1)");
      await denied("select public.delete_class_session(1,1)");
      await denied("select public.delete_managed_class(1)");
      await denied("select public.save_managed_class_with_day_part(null,'TEST','운영고','생명과학',null,array[6]::smallint[],null,null,null,true,array[]::bigint[],'저녁')");
    });
    await actor('manager-uid', async () => {
      await assert.rejects(db.query("select public.save_managed_class_with_day_part(null,'TEST','운영고','생명과학',null,array[2,4]::smallint[],'18:00','20:00',18000,true,array[2,3]::bigint[],'심야')"), e => e.code === '23514');
      classId = String((await first("select public.save_managed_class_with_day_part(null,'TEST','운영고','생명과학',null,array[2,4]::smallint[],'18:00','20:00',18000,true,array[2,3]::bigint[],'저녁') as id")).id);
      assert.equal((await first('select day_part from classes where id=$1', [classId])).day_part, '저녁');
      await db.query("select public.save_managed_class_with_day_part($1,'TEST','운영고','생명과학',null,array[2,4]::smallint[],'18:00','20:00',18000,true,array[2,3]::bigint[],'오후')", [classId]);
      assert.equal((await first('select day_part from classes where id=$1', [classId])).day_part, '오후');
      assert.deepEqual((await db.query('select staff_id from class_staff where class_id=$1 order by staff_id', [classId])).rows, [{ staff_id: 2 }, { staff_id: 3 }]);
      await db.query('select public.create_class_sessions($1,$2::jsonb)', [classId, JSON.stringify([{ session_number: 1, session_date: '2026-10-01' }])]);
      sessionId = String((await first('select id from class_sessions where class_id=$1', [classId])).id);
      assert.deepEqual((await db.query('select staff_id from session_staff where session_id=$1 order by staff_id', [sessionId])).rows, [{ staff_id: 2 }, { staff_id: 3 }]);
      studentId = String((await first("select public.register_student_and_enroll($1,null,'OPS-STUDENT','운영 학생','01011112222','01033334444','','parent','2026-09-15') as id", [classId])).id);
      await db.query("select public.update_student_and_enrollment($1,$2,'OPS-STUDENT','운영 학생 수정','01011112222','01033334444','','parent','2026-09-01')", [classId, studentId]);
      await db.query("select public.update_class_session($1,$2,'2026-10-02','날짜 수정',array[3]::bigint[])", [classId, sessionId]);
      assert.deepEqual(await first("select session_date::text,notes from class_sessions where id=$1", [sessionId]), { session_date: '2026-10-02', notes: '날짜 수정' });
      assert.deepEqual((await db.query('select staff_id from session_staff where session_id=$1', [sessionId])).rows, [{ staff_id: 3 }]);
      assert.deepEqual(await first('select full_name from students where id=$1', [studentId]), { full_name: '운영 학생 수정' });
      assert.deepEqual(await first('select joined_on::text from enrollments where class_id=$1 and student_id=$2', [classId, studentId]), { joined_on: '2026-09-01' });
    });

    const homeworkId = '9001';
    const testId = '9001';
    await db.query("insert into session_homeworks(id,class_id,session_id,title) values (9001,$1,$2,'운영 숙제')", [classId, sessionId]);
    await db.query("insert into session_tests(id,class_id,session_id,title,max_score) values (9001,$1,$2,'운영 시험',20)", [classId, sessionId]);
    await db.query("insert into student_session_records(class_id,session_id,student_id,attendance_status) values ($1,$2,$3,'출석')", [classId, sessionId, studentId]);
    await db.query("insert into student_homework_results(class_id,homework_id,student_id,grade) values ($1,$2,$3,'A')", [classId, homeworkId, studentId]);
    await db.query("insert into student_test_results(class_id,test_id,student_id,score) values ($1,$2,$3,18.5)", [classId, testId, studentId]);
    await db.query("insert into messages(class_id,session_id,student_id,student_name_snapshot,parent_phone_snapshot,content) values ($1,$2,$3,'운영 학생 수정','01033334444','운영 메시지')", [classId, sessionId, studentId]);
    const workLogId = String((await first("insert into work_logs(staff_id,class_id,session_id,work_label,started_at,ended_at) values (2,$1,$2,'운영 수업','2026-12-01 18:00+09','2026-12-01 20:00+09') returning id", [classId, sessionId])).id);

    await actor('manager-uid', async () => {
      await db.query('select public.delete_class_enrollment($1,$2)', [classId, studentId]);
      assert.equal((await first('select count(*)::int n from enrollments where class_id=$1 and student_id=$2', [classId, studentId])).n, 0);
      assert.equal((await first('select count(*)::int n from student_session_records where class_id=$1 and student_id=$2', [classId, studentId])).n, 0);
      assert.equal((await first('select count(*)::int n from messages where class_id=$1 and student_id=$2', [classId, studentId])).n, 0);
      assert.equal((await first('select count(*)::int n from students where id=$1', [studentId])).n, 1);

      await db.query('select public.delete_class_session($1,$2)', [classId, sessionId]);
      assert.equal((await first('select count(*)::int n from class_sessions where id=$1', [sessionId])).n, 0);
      assert.deepEqual(await first('select class_id,session_id from work_logs where id=$1', [workLogId]), { class_id: Number(classId), session_id: null });
      await assert.rejects(db.query('select public.delete_managed_class($1)', [classId]), error => error.code === 'P0002');
      await db.query('select public.archive_managed_class($1)', [classId]);
      await db.query('select public.delete_managed_class($1)', [classId]);
      assert.equal((await first('select count(*)::int n from classes where id=$1', [classId])).n, 0);
      assert.deepEqual(await first('select class_id,session_id from work_logs where id=$1', [workLogId]), { class_id: null, session_id: null });
    });
  });

  await test('approved staff can delete a session item and its results atomically', async () => {
    await actor('assistant-uid', async () => {
      assert.ok((await first('select count(*)::int n from student_test_results where test_id=1')).n > 0);
      await db.exec("select public.delete_session_item(2,2,'test',1)");
      assert.equal((await first('select count(*)::int n from session_tests where id=1')).n, 0);
      assert.equal((await first('select count(*)::int n from student_test_results where test_id=1')).n, 0);
    });
  });
  await test('assistant sees only own work and cannot invent a work duration', async () => {
    await actor('assistant-uid', async () => {
      assert.equal((await db.query('select * from work_logs')).rows.length, 1);
      await denied("insert into work_logs(staff_id,work_label,started_at) values (3,'불가',now())");
      await assert.rejects(db.query('update work_logs set duration_minutes=999'), e => e.code === '428C9');
    });
  });
  await test('inquiry identity cannot be forged and resolution records the manager automatically', async () => {
    await actor('assistant-uid', async () => {
      await denied("insert into inquiries(requester_staff_id,content) values (1,'다른 사람인 척')");
      await db.exec("insert into inquiries(requester_staff_id,content) values (3,'테스트 문의')");
      await denied('update inquiries set resolved_by=1');
      assert.equal((await db.query("update inquiries set status='resolved' returning id")).rows.length, 0);
    });
    await actor('manager-uid', async () => {
      await db.exec("update inquiries set status='resolved'");
      const r = await first('select resolved_by,resolved_at from inquiries');
      assert.equal(Number(r.resolved_by), 2); assert.ok(r.resolved_at);
    });
  });
  await test('message reads follow assigned classes and device registration alone cannot mutate delivery', async () => {
    await actor('assistant-uid', async () => {
      assert.equal((await db.query('select * from messages')).rows.length, 1);
      assert.equal((await db.query('select * from message_deliveries')).rows.length, 1);
    });
    await actor('manager-uid', async () => {
      assert.equal((await db.query('select * from messages')).rows.length, 2);
      await denied("update message_deliveries set status='submitted',submitted_at=now()");
      await denied("insert into messages(class_id,student_id,student_name_snapshot,content) values (1,1,'학생','발송')");
    });
  });

  await test('memo tests save free-text results and keep formats consistent', async () => {
    await actor('assistant-uid', async () => {
      const memoId = String((await first(
        "insert into session_tests(class_id,session_id,title,result_type,max_score) values (2,2,'통과 시험','memo',null) returning id"
      )).id);
      await assert.rejects(
        db.query('insert into student_test_results(test_id,student_id,class_id,score) values ($1,1,2,1)', [memoId]),
        error => error.code === '23514'
      );
      await db.query(
        "select public.save_student_session_draft(2,2,1,null,'[]'::jsonb,$1::jsonb)",
        [JSON.stringify([{ test_id: memoId, score: null, status: '', result_text: '통과' }])]
      );
      assert.deepEqual(
        await first('select score,status,result_text from student_test_results where test_id=$1 and student_id=1', [memoId]),
        { score: null, status: null, result_text: '통과' }
      );
      await db.query(
        "select public.save_session_roster_draft(2,2,$1::jsonb)",
        [JSON.stringify([{ student_id: 1, attendance: null, homework_results: [], test_results: [
          { test_id: memoId, score: null, status: '', result_text: '재시' }
        ] }])]
      );
      assert.equal(
        (await first('select result_text from student_test_results where test_id=$1 and student_id=1', [memoId])).result_text,
        '재시'
      );
      await assert.rejects(
        db.query("update session_tests set result_type='score',max_score=10 where id=$1", [memoId]),
        error => error.code === '23514'
      );
      await db.query(
        "select public.save_student_session_draft(2,2,1,null,'[]'::jsonb,$1::jsonb)",
        [JSON.stringify([{ test_id: memoId, score: null, status: '', result_text: '' }])]
      );
      assert.equal(
        (await first('select count(*)::int n from student_test_results where test_id=$1 and student_id=1', [memoId])).n,
        0
      );
      await db.query("update session_tests set result_type='score',max_score=10 where id=$1", [memoId]);
      assert.deepEqual(
        await first('select result_type,max_score from session_tests where id=$1', [memoId]),
        { result_type: 'score', max_score: '10' }
      );
    });
  });

  await test('only a verified matching email can link a pre-registered staff account', async () => {
    const newStaff = await first("insert into staff(id,full_name,email) values (100,'새 조교','new@example.invalid') returning id");
    await actor('wrong-uid', async () => {
      const result = await first('select public.link_my_staff_account() as profile');
      assert.equal(result.profile, null);
    }, { email: 'other@example.invalid' });
    await actor('fresh-uid', async () => {
      const result = await first('select public.link_my_staff_account() as profile');
      assert.equal(result.profile.staff_id, String(newStaff.id));
      assert.equal(result.profile.access_status, 'approved');
      assert.equal(result.profile.app_role, 'assistant');
      const again = await first('select public.link_my_staff_account() as profile');
      assert.equal(again.profile.staff_id, String(newStaff.id));
    }, { email: 'new@example.invalid' });
    assert.equal((await first('select firebase_uid from staff where id=$1', [newStaff.id])).firebase_uid, 'fresh-uid');
    await actor('unverified-uid', async () => {
      await denied('select public.link_my_staff_account()');
    }, { email: 'new@example.invalid', email_verified: false });
  });

  await test('approved staff can clock themselves in and out once; managers can correct logs', async () => {
    await db.exec("update classes set weekdays=array[6]::smallint[], day_part='\uC800\uB141' where id=1");
    let shiftId;
    await actor('assistant-uid', async () => {
      shiftId = String((await first('select public.start_my_work_shift(1) as id')).id);
      assert.equal(String((await first('select public.start_my_work_shift(1) as id')).id), shiftId);
      assert.equal((await first('select work_label from work_logs where id=$1', [shiftId])).work_label, '\uACFC\uD559 \uD1A0 \uC800\uB141');
      await assert.rejects(db.query('select public.start_my_work_shift(2)'), error => error.code === '23514');
      assert.equal((await first('select staff_id,class_id,ended_at from work_logs where id=$1', [shiftId])).ended_at, null);
      await db.query('delete from work_logs where id=$1', [shiftId]);
      assert.equal((await first('select count(*)::int n from work_logs where id=$1', [shiftId])).n, 1);
      assert.equal(String((await first('select public.finish_my_work_shift() as id')).id), shiftId);
      await assert.rejects(db.query('select public.finish_my_work_shift()'), error => error.code === 'P0002');
    });
    await actor('manager-uid', async () => {
      await db.query('delete from work_logs where id=$1', [shiftId]);
      assert.equal((await first('select count(*)::int n from work_logs where id=$1', [shiftId])).n, 0);
    });
  });
  await test('all approved staff see class shift summaries without hourly rates', async () => {
    await db.exec("insert into work_logs(staff_id,class_id,work_label,started_at,ended_at,hourly_rate_krw) values (2,1,'TEST','2026-10-01 18:00+09','2026-10-01 20:00+09',20000)");
    await actor('assistant-uid', async () => {
      const rows = (await db.query('select * from public.get_class_work_summary(1)')).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].staff_name, '매니저');
      assert.equal(rows[0].duration_minutes, 120);
      assert.equal('hourly_rate_krw' in rows[0], false);
      assert.equal((await db.query('select * from work_logs where staff_id=2')).rows.length, 0);
    });
    await actor('inactive-uid', async () => await denied('select * from public.get_class_work_summary(1)'));
  });
  await test('admin bank saving inserts and updates while lower roles remain blocked', async () => {
    await db.exec('set role anon');
    try { await denied("select public.admin_save_staff_bank_account(2,'NO')"); }
    finally { await db.exec('reset role'); }
    for (const uid of ['assistant-uid', 'manager-uid']) {
      await actor(uid, async () => await denied("select public.admin_save_staff_bank_account(3,'NO')"));
    }
    await actor('admin-uid', async () => {
      await db.query("select public.admin_save_staff_bank_account(3,' REVISED-ACCOUNT ')");
      assert.equal((await first('select bank_account from staff_private_details where staff_id=3')).bank_account, 'REVISED-ACCOUNT');
      await db.query("select public.admin_save_staff_bank_account(2,'NEW-ACCOUNT')");
      assert.equal((await first('select bank_account from staff_private_details where staff_id=2')).bank_account, 'NEW-ACCOUNT');
    });
  });
  await test('work duration uses displayed clock minutes regardless of seconds', async () => {
    await db.exec("insert into work_logs(staff_id,work_label,started_at,ended_at) values (2,'분 계산','2026-10-08 10:53:59+09','2026-10-08 10:59:01+09')");
    assert.equal((await first("select duration_minutes from work_logs where work_label='분 계산'")).duration_minutes, 6);
  });
  await test('message queue binds recipients to snapshots and a paired approved device', async () => {
    await db.exec("update students set parent_phone='01012345678',student_phone='01087654321',default_message_recipients='both' where id=1; update message_deliveries set status='cancelled' where message_id in (1,2)");
    let pair;
    await actor('assistant-uid', async () => {
      pair = (await first("select public.register_sending_device('TEST PHONE','android-test-1') as pair")).pair;
      assert.equal(pair.secret.length, 64);
      await denied("select public.create_class_messages(2,2,'[]'::jsonb)");
      const payload = JSON.stringify([{ student_id: 1, request_id: '11111111-1111-4111-8111-111111111111', content: 'TEST TEXT' }]);
      assert.equal((await first('select public.create_class_messages(1,1,$1::jsonb) as result', [payload])).result.created, 1);
      assert.equal((await first('select public.create_class_messages(1,1,$1::jsonb) as result', [payload])).result.already_created, 1);
      await denied("select * from public.claim_next_message_delivery(1,'00000000-0000-4000-8000-000000000000','wrong')");
    });
    assert.equal((await db.query("select recipient_type from message_deliveries where message_id=(select id from messages where content='TEST TEXT')")).rows.length, 2);
    await actor('manager-uid', async () => {
      await db.query('update sending_devices set is_enabled=true where id=$1', [pair.device_id]);
    });
    await actor('assistant-uid', async () => {
      const claimed = await first('select * from public.claim_next_message_delivery(1,$1,$2)', [pair.device_id, pair.secret]);
      assert.equal(claimed.content, 'TEST TEXT');
      assert.equal(claimed.phone, claimed.recipient_type === 'parent' ? '01012345678' : '01087654321');
      await db.query("select public.finish_message_delivery($1,$2,$3,$4,'submitted',null)", [claimed.message_id, claimed.recipient_type, pair.device_id, pair.secret]);
      const second = await first('select * from public.claim_next_message_delivery(1,$1,$2)', [pair.device_id, pair.secret]);
      assert.notEqual(second.recipient_type, claimed.recipient_type);
      await db.query("select public.finish_message_delivery($1,$2,$3,$4,'failed','TEST ERROR')", [second.message_id, second.recipient_type, pair.device_id, pair.secret]);
      assert.equal((await first("select count(*)::int n from message_deliveries where message_id=$1 and status in ('submitted','failed')", [claimed.message_id])).n, 2);
    });
    await db.exec("update message_deliveries set status='pending' where message_id=2");
    await actor('assistant-uid', async () => {
      assert.equal(await first('select * from public.claim_next_message_delivery(2,$1,$2)', [pair.device_id, pair.secret]), undefined);
    });
    let otherClassClaim;
    await actor('manager-uid', async () => {
      otherClassClaim = await first('select * from public.claim_next_message_delivery(2,$1,$2)', [pair.device_id, pair.secret]);
    });
    await actor('assistant-uid', async () => {
      await assert.rejects(db.query("select public.finish_message_delivery($1,$2,$3,$4,'failed','DENIED')", [otherClassClaim.message_id, otherClassClaim.recipient_type, pair.device_id, pair.secret]), e => e.code === 'P0002');
    });
    await actor('manager-uid', async () => {
      await db.query("select public.finish_message_delivery($1,$2,$3,$4,'failed','TEST')", [otherClassClaim.message_id, otherClassClaim.recipient_type, pair.device_id, pair.secret]);
    });
    await db.exec("insert into session_staff(session_id,staff_id) values (2,3); update message_deliveries set status='pending' where message_id=2");
    await actor('assistant-uid', async () => {
      const sessionClaim = await first('select * from public.claim_next_message_delivery(2,$1,$2)', [pair.device_id, pair.secret]);
      assert.equal(sessionClaim.message_id, otherClassClaim.message_id);
      await db.query("select public.finish_message_delivery($1,$2,$3,$4,'failed','TEST')", [sessionClaim.message_id, sessionClaim.recipient_type, pair.device_id, pair.secret]);
    });
    await actor('manager-uid', async () => {
      await db.query('select public.reset_sending_device($1)', [pair.device_id]);
    });
    await actor('assistant-uid', async () => await assert.rejects(db.query('select public.get_sending_device_state($1,$2)', [pair.device_id, pair.secret]), e => e.code === '42501'));
  });
  await test('reinstall can re-pair the same Android ID, while manager deletion revokes its secret and preserves the audit row', async () => {
    let pair;
    await actor('assistant-uid', async () => {
      pair = (await first("select public.register_sending_device('REINSTALLED PHONE','android-test-1') as pair")).pair;
      assert.equal((await first('select public.get_sending_device_state($1,$2) as state', [pair.device_id, pair.secret])).state.is_enabled, false);
    });
    await actor('manager-uid', async () => {
      await db.query('update sending_devices set is_enabled=true where id=$1', [pair.device_id]);
      await db.query('select public.archive_sending_device($1)', [pair.device_id]);
    });
    assert.equal((await first('select archived_at is not null as archived,is_enabled from sending_devices where id=$1', [pair.device_id])).archived, true);
    await actor('assistant-uid', async () => {
      await assert.rejects(db.query('select public.get_sending_device_state($1,$2)', [pair.device_id, pair.secret]), e => e.code === '42501');
      const renewed = (await first("select public.register_sending_device('PHONE AFTER ARCHIVE','android-test-1') as pair")).pair;
      assert.equal(renewed.device_id, pair.device_id);
      assert.notEqual(renewed.secret, pair.secret);
    });
    assert.deepEqual(await first('select archived_at,is_enabled from sending_devices where id=$1', [pair.device_id]), { archived_at: null, is_enabled: false });
    await actor('assistant-uid', async () => await denied(`select public.archive_sending_device('${pair.device_id}')`));
  });
  await test('makeup messages require this session participation; pending edits preserve immutable audit', async () => {
    let visitorId;
    await actor('manager-uid', async () => {
      visitorId = (await first("select public.register_student_and_enroll(1,null,'SMS-VISITOR','문자 보강생','','01012344321','','parent','2026-09-01') as id")).id;
      await db.query("select public.add_makeup_participant(2,2,$1,1,1,'문자 테스트')", [visitorId]);
    });
    const payload = JSON.stringify([{ student_id: visitorId, request_id: '22222222-2222-4222-8222-222222222222', content: '보강 안내' }]);
    await assert.rejects(db.query("insert into messages(class_id,student_id,session_id,student_name_snapshot,parent_phone_snapshot,content) values (2,$1,null,'문자 보강생','01012344321','등록되지 않은 반')", [visitorId]), e => e.code === '23514');
    await actor('manager-uid', async () => {
      await assert.rejects(db.query('select public.create_class_messages(2,null,$1::jsonb)', [payload]), e => e.code === '23514');
      assert.equal((await first('select public.create_class_messages(2,2,$1::jsonb) as result', [payload])).result.created, 1);
    });
    const originalId = (await first("select id from messages where content='보강 안내'")).id;
    let newId;
    await actor('assistant-uid', async () => {
      newId = (await first("select public.replace_pending_message($1,'보강 안내 수정','33333333-3333-4333-8333-333333333333') as id", [originalId])).id;
      assert.equal((await first('select content from messages where id=$1', [newId])).content, '보강 안내 수정');
      assert.equal((await first('select status from message_deliveries where message_id=$1', [originalId])).status, 'cancelled');
      assert.equal((await first('select status from message_deliveries where message_id=$1', [newId])).status, 'pending');
    });
    await db.query("update message_deliveries set status='failed' where message_id=$1", [newId]);
    await actor('assistant-uid', async () => {
      await assert.rejects(db.query("select public.replace_pending_message($1,'두 번째 수정','44444444-4444-4444-8444-444444444444')", [newId]), e => e.code === '23514');
    });
  });
  await test('individual message cancellation changes only pending recipients with class access', async () => {
    const allowed = await first("insert into messages(class_id,student_id,session_id,student_name_snapshot,parent_phone_snapshot,student_phone_snapshot,content) values (1,1,1,'가상 학생','01012345678','01087654321','취소 대상') returning id");
    await db.query("insert into message_deliveries(message_id,recipient_type) values ($1,'parent'),($1,'student')", [allowed.id]);
    await db.query("update message_deliveries set status='submitted',submitted_at=now() where message_id=$1 and recipient_type='parent'", [allowed.id]);
    await actor('assistant-uid', async () => {
      assert.equal((await first('select public.cancel_pending_message($1) as count', [allowed.id])).count, 1);
      assert.equal((await first('select public.cancel_pending_message($1) as count', [allowed.id])).count, 0);
    });
    assert.deepEqual((await db.query('select recipient_type,status from message_deliveries where message_id=$1 order by recipient_type', [allowed.id])).rows,
      [{ recipient_type: 'parent', status: 'submitted' }, { recipient_type: 'student', status: 'cancelled' }]);

    const restricted = await first("insert into messages(class_id,student_id,student_name_snapshot,parent_phone_snapshot,content) values (2,1,'가상 학생','01012345678','다른 수업') returning id");
    await db.query("insert into message_deliveries(message_id,recipient_type) values ($1,'parent')", [restricted.id]);
    await actor('assistant-uid', async () => await denied(`select public.cancel_pending_message(${restricted.id})`));
    await actor('manager-uid', async () => {
      assert.equal((await first('select public.cancel_pending_message($1) as count', [restricted.id])).count, 1);
      await assert.rejects(db.query('select public.cancel_pending_message(-1)'), e => e.code === 'P0002');
    });
  });
  await test('manager deletes only unused locations while assistant and referenced locations are protected', async () => {
    const unused = await first("insert into locations(name) values ('UNUSED LOCATION') returning id");
    await actor('assistant-uid', async () => await denied(`select public.delete_managed_location(${unused.id})`));
    await actor('manager-uid', async () => await db.query('select public.delete_managed_location($1)', [unused.id]));
    assert.equal((await first('select count(*)::int n from locations where id=$1', [unused.id])).n, 0);
    const used = await first("insert into locations(name) values ('USED LOCATION') returning id");
    await db.query('update classes set location_id=$1 where id=1', [used.id]);
    await actor('manager-uid', async () => await assert.rejects(db.query('select public.delete_managed_location($1)', [used.id]), e => e.code === '23503'));
  });
  await test('weekday times and chronological session numbers survive inserts, edits, and deletion', async () => {
    await actor('assistant-uid', async () => await denied("select public.save_managed_class_v2(null,'TEST','regular','학교','과학',null,'[]'::jsonb,null,true,'{}'::bigint[])"));
    await actor('manager-uid', async () => {
      const schedule = JSON.stringify([
        { weekday: 1, day_part: '오전', start_time: '09:00', end_time: '11:00' },
        { weekday: 3, day_part: '저녁', start_time: '18:00', end_time: '20:00' },
      ]);
      const saved = await first("select public.save_managed_class_v2(null,'TEST','regular','시간고','과학',null,$1::jsonb,null,true,'{}'::bigint[]) as id", [schedule]);
      const classId = saved.id;
      assert.deepEqual((await db.query('select weekday,day_part,start_time::text from class_weekday_times where class_id=$1 order by weekday', [classId])).rows,
        [{ weekday: 1, day_part: '오전', start_time: '09:00:00' }, { weekday: 3, day_part: '저녁', start_time: '18:00:00' }]);
      await db.query('select public.create_class_sessions($1,$2::jsonb)', [classId, JSON.stringify([
        { session_date: '2026-09-16', staff_ids: [] },
        { session_date: '2026-09-14', staff_ids: [] },
      ])]);
      let sessions = (await db.query('select id,session_number,session_date::text,start_time::text from class_sessions where class_id=$1 order by session_number', [classId])).rows;
      assert.deepEqual(sessions.map((item) => [item.session_number,item.session_date,item.start_time]),
        [[1,'2026-09-14','09:00:00'],[2,'2026-09-16','18:00:00']]);
      await db.query("select public.update_class_session($1,$2,'2026-09-07','moved','{}'::bigint[])", [classId,sessions[1].id]);
      sessions = (await db.query('select id,session_number,session_date::text,start_time::text from class_sessions where class_id=$1 order by session_number', [classId])).rows;
      assert.deepEqual(sessions.map((item) => [item.session_number,item.session_date,item.start_time]),
        [[1,'2026-09-07','09:00:00'],[2,'2026-09-14','09:00:00']]);
      await db.query('select public.delete_class_session($1,$2)', [classId,sessions[0].id]);
      assert.equal((await first('select session_number from class_sessions where class_id=$1', [classId])).session_number, 1);
    });
  });
  await test('one clinic per term accepts same-term students without changing enrollment', async () => {
    let clinicId;
    let sessionId;
    await actor('manager-uid', async () => {
      const schedule = JSON.stringify([{ weekday: 0, day_part: '오후', start_time: '14:00', end_time: '16:00' }]);
      clinicId = (await first("select public.save_managed_class_v2(null,'TEST','clinic',null,null,null,$1::jsonb,null,true,'{}'::bigint[]) as id", [schedule])).id;
      await assert.rejects(db.query('insert into enrollments(class_id,student_id) values ($1,1)', [clinicId]), e => e.code === '23514');
      await assert.rejects(db.query("select public.save_managed_class_v2(null,'TEST','clinic',null,null,null,$1::jsonb,null,true,'{}'::bigint[])", [schedule]), e => e.code === '23505');
      await db.query('select public.create_class_sessions($1,$2::jsonb)', [clinicId, JSON.stringify([{ session_date: '2026-09-20' }])]);
      sessionId = (await first('select id from class_sessions where class_id=$1', [clinicId])).id;
      await assert.rejects(db.query("select public.add_clinic_participant($1,$2,1,999,'')", [clinicId,sessionId]), e => e.code === '23514');
      await db.query("select public.add_clinic_participant($1,$2,1,1,'optional visit')", [clinicId,sessionId]);
    });
    assert.equal((await first('select participation_type from session_participants where session_id=$1 and student_id=1', [sessionId])).participation_type, 'clinic');
    assert.equal((await first('select count(*)::int n from enrollments where class_id=$1', [clinicId])).n, 0);
    assert.equal((await first('select app_private.student_can_record($1,$2,1) as allowed', [clinicId,sessionId])).allowed, true);
    await actor('assistant-uid', async () => {
      await db.query("select public.save_student_session_draft($1,$2,1,$3::jsonb,'[]'::jsonb,'[]'::jsonb)",
        [clinicId,sessionId,JSON.stringify({ status: '출석', notes: '클리닉 참석' })]);
    });
    assert.equal((await first('select attendance_status from student_session_records where class_id=$1 and session_id=$2 and student_id=1', [clinicId,sessionId])).attendance_status, '출석');
    await actor('assistant-uid', async () => await assert.rejects(
      db.query("select public.add_clinic_participant($1,$2,1,2,'')", [clinicId,sessionId]), e => e.code === '42501'));
    await actor('manager-uid', async () => await db.query('select public.remove_makeup_participant($1,$2,1)', [clinicId,sessionId]));
    assert.equal((await first('select count(*)::int n from student_session_records where class_id=$1 and session_id=$2', [clinicId,sessionId])).n, 0);
    assert.equal((await first('select app_private.student_can_record($1,$2,1) as allowed', [clinicId,sessionId])).allowed, false);
  });
  await test('database usage is available only to approved management', async () => {
    await actor('assistant-uid', async () => await denied('select public.get_database_usage_bytes()'));
    await actor('pending-uid', async () => await denied('select public.get_database_usage_bytes()'));
    await actor('manager-uid', async () => {
      assert.ok(Number((await first('select public.get_database_usage_bytes() as bytes')).bytes) > 0);
    });
    await actor('admin-uid', async () => {
      assert.ok(Number((await first('select public.get_database_usage_bytes() as bytes')).bytes) > 0);
    });
  });
  await test('administrator can add a class shift with no end time and finish it later', async () => {
    let id;
    await actor('assistant-uid', async () => await denied("insert into work_logs(staff_id,class_id,work_label,started_at) values (3,1,'TEST CLASS','2026-10-11 10:00+09')"));
    await actor('admin-uid', async () => {
      id = (await first("insert into work_logs(staff_id,class_id,work_label,started_at) values (3,1,'TEST CLASS','2026-10-11 10:00+09') returning id")).id;
      assert.equal((await first('select ended_at from work_logs where id=$1', [id])).ended_at, null);
      await assert.rejects(db.query("insert into work_logs(staff_id,class_id,work_label,started_at) values (3,1,'TEST CLASS','2026-10-11 11:00+09')"), e => e.code === '23505');
      await db.query("update work_logs set ended_at='2026-10-11 10:06+09' where id=$1", [id]);
      assert.equal((await first('select duration_minutes from work_logs where id=$1', [id])).duration_minutes, 6);
    });
  });
  await test('question sheet saves wrong numbers independently and rejects invalid students or questions', async () => {
    await db.exec("insert into student_test_results(test_id,student_id,class_id,score) values (1,1,2,0) on conflict (test_id,student_id) do update set score=excluded.score");
    await actor('assistant-uid', async () => {
      await db.query(`select public.save_test_question_sheet(2,2,1,3,2,
        '[{"student_id":"1","wrong_numbers":[2,5]}]'::jsonb)`);
      assert.deepEqual((await first('select wrong_numbers from test_question_mistakes where test_id=1 and student_id=1')).wrong_numbers, [2,5]);
      assert.equal((await first('select objective_count from test_question_sheets where test_id=1')).objective_count, 3);
      await assert.rejects(db.query(`select public.save_test_question_sheet(2,2,1,3,2,
        '[{"student_id":"1","wrong_numbers":[6]}]'::jsonb)`), e => e.code === '23514');
      await assert.rejects(db.query(`select public.save_test_question_sheet(2,2,1,3,2,
        '[{"student_id":"99","wrong_numbers":[]}]'::jsonb)`), e => e.code === '23514');
      await assert.rejects(db.query(`select public.save_test_question_sheet(1,1,1,3,2,'[]'::jsonb)`), e => e.code === 'P0002');
      assert.deepEqual((await first('select wrong_numbers from test_question_mistakes where test_id=1 and student_id=1')).wrong_numbers, [2,5]);
      await db.query(`select public.save_test_question_sheet(2,2,1,3,2,
        '[{"student_id":"1","wrong_numbers":[]}]'::jsonb)`);
      assert.deepEqual((await first('select wrong_numbers from test_question_mistakes where test_id=1 and student_id=1')).wrong_numbers, []);
      assert.equal((await first('select score from student_test_results where test_id=1 and student_id=1')).score, '0');
    });
  });
  await test('question notes save atomically with mistakes and reject invalid numbers', async () => {
    await actor('assistant-uid', async () => {
      await db.query('select public.save_test_question_sheet_with_notes(2,2,1,3,2,$1::jsonb,$2::jsonb)',
        [JSON.stringify([{ student_id: '1', wrong_numbers: [1, 5] }]), JSON.stringify({ '1': '개념', '5': '서술 근거' })]);
      assert.deepEqual((await first('select question_notes from test_question_sheets where test_id=1')).question_notes,
        { '1': '개념', '5': '서술 근거' });
      await assert.rejects(db.query('select public.save_test_question_sheet_with_notes(2,2,1,3,2,$1::jsonb,$2::jsonb)',
        [JSON.stringify([{ student_id: '1', wrong_numbers: [] }]), JSON.stringify({ '6': '범위 밖' })]), e => e.code === '23514');
      assert.deepEqual((await first('select wrong_numbers from test_question_mistakes where test_id=1 and student_id=1')).wrong_numbers, [1, 5]);
    });
  });
  await test('bulk student registration is all-or-nothing and does not rewrite existing contacts', async () => {
    const firstRow = { student_code: 'BULK1', full_name: '첫 학생', parent_phone: '01012345678', joined_on: '2026-09-13' };
    const originalParentPhone = (await first("select parent_phone from students where student_code='S1'")).parent_phone;
    await actor('inactive-uid', async () => await assert.rejects(
      db.query('select public.register_students_and_enroll(1,$1::jsonb)', [JSON.stringify([firstRow])]), e => e.code === '42501'));
    await actor('assistant-uid', async () => {
      assert.equal((await first('select public.register_students_and_enroll(1,$1::jsonb) as n',
        [JSON.stringify([{ student_code: 'ASSISTANTBULK', full_name: '조교 등록 학생' }])])).n, 1);
    });
    await actor('manager-uid', async () => {
      await assert.rejects(db.query('select public.register_students_and_enroll(1,$1::jsonb)',
        [JSON.stringify([firstRow, { student_code: 'BULK2', full_name: '둘째 학생', parent_phone: 'invalid' }])]), e => e.code === '23514');
      assert.equal((await first("select count(*)::int n from students where student_code='BULK1'")).n, 0);
      assert.equal((await first('select public.register_students_and_enroll(1,$1::jsonb) as n',
        [JSON.stringify([firstRow, { student_code: 'BULK2', full_name: '둘째 학생', parent_phone: '01087654321' },
          { student_code: 'S1', full_name: '가상 학생', parent_phone: '01099998888' }])])).n, 3);
      assert.equal((await first("select count(*)::int n from enrollments e join students s on s.id=e.student_id where e.class_id=1 and s.student_code in ('BULK1','BULK2')")).n, 2);
      assert.equal((await first("select parent_phone from students where student_code='S1'")).parent_phone, originalParentPhone);
    });
  });
  await test('staff archive requires admin, blocks self-removal, and preserves work history', async () => {
    await actor('manager-uid', async () => await denied('select public.archive_staff_profile(3)'));
    await actor('admin-uid', async () => {
      await assert.rejects(db.query('select public.archive_staff_profile(1)'), e => e.code === '23514');
      await db.query('select public.archive_staff_profile(3)');
    });
    const archived = await first('select employment_status,archived_at is not null as archived from staff where id=3');
    assert.equal(archived.employment_status, 'inactive');
    assert.equal(archived.archived, true);
    assert.equal((await first('select access_status from app_access where staff_id=3')).access_status, 'suspended');
    assert.ok((await first('select count(*)::int n from work_logs where staff_id=3')).n > 0);
    await actor('assistant-uid', async () => assert.equal((await db.query('select * from students')).rows.length, 0));
  });
  await test('manager cannot swap a listed email; admin changes revoke the old Firebase link', async () => {
    await actor('manager-uid', async () => await denied("update staff set email='changed@example.invalid' where id=4"));
    await actor('admin-uid', async () => await db.exec("update staff set email='changed@example.invalid' where id=4"));
    assert.equal((await first('select firebase_uid from staff where id=4')).firebase_uid, null);
    await actor('pending-uid', async () => assert.equal((await first('select public.get_my_access() as a')).a, null));
    await actor('changed-uid', async () => {
      const linked = (await first('select public.link_my_staff_account() as a')).a;
      assert.equal(linked.staff_id, '4');
      assert.equal(linked.access_status, 'approved');
    }, { email: 'changed@example.invalid' });
  });
  console.log(`Completed ${passed} access tests. No live accounts or messages changed.`);
} finally { await db.close(); }
