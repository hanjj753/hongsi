import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
    sub: uid, iss: 'https://securetoken.google.com/hongsi-assistant', aud: 'hongsi-assistant',
    role: 'authenticated', email_verified: true, ...overrides,
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
  for (const file of ['20260913000100_initial_schema.sql','20260913000200_firebase_access.sql','20260923000300_remove_class_code.sql','20260924000400_student_records_rpc.sql','20260924000500_preserve_existing_student_details.sql','20260925000600_bulk_records_and_student_validation.sql','20260925000700_class_catalog_and_session_items.sql','20260926000800_enrollment_moves_makeups_and_session_staff.sql','20260926000900_restrict_enrollment_reactivation.sql','20260926001000_link_makeup_sessions.sql','20260926001100_class_enrollment_session_management.sql','20261001001200_class_day_part.sql','20261001001300_test_result_formats.sql']) {
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
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
  await test('all migrations execute and retain RLS on all 22 tables', async () => {
    assert.equal((await first("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and relrowsecurity")).n, 22);
  });
  await test('anonymous users have no table access or public privileged RPC', async () => {
    await db.exec('set role anon');
    try {
      await denied('select * from students');
      await denied('select public.get_my_access()');
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
  await test('unregistered, pending, suspended, inactive, and foreign-project users cannot access student data', async () => {
    for (const uid of ['unknown','pending-uid','suspended-uid','inactive-uid']) {
      await actor(uid, async () => {
        assert.equal((await db.query('select * from students')).rows.length, 0);
        await denied("insert into students(student_code,full_name) values ('INVALID','불가')");
      });
    }
    for (const overrides of [{ iss:'https://securetoken.google.com/foreign' }, { aud:'foreign' }, { email_verified:false }, { role:'admin' }]) {
      await actor('admin-uid', async () => assert.equal((await db.query('select * from students')).rows.length, 0), overrides);
    }
  });
  await test('pending users can see their own approval state without an automatic account approval', async () => {
    await actor('pending-uid', async () => {
      const r = (await first('select public.get_my_access() as access')).access;
      assert.equal(r.staff_id, '4'); assert.equal(r.access_status, 'pending');
      assert.equal(r.can_manage_accounts, false); assert.equal(r.can_manage_devices, false);
      assert.equal((await db.query('select * from app_access')).rows.length, 1);
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
  await test('only admin sees bank details, including an assistants own account', async () => {
    for (const uid of ['assistant-uid','manager-uid']) {
      await actor(uid, async () => {
        assert.equal((await db.query('select * from staff_private_details')).rows.length, 0);
        await denied("insert into staff_private_details(staff_id,bank_account) values (2,'NOT ALLOWED')");
      });
    }
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
      assert.equal((await first('select public.get_my_access() as a')).a.app_role, 'assistant');
    }, { email:'admin@example.invalid', app_role:'admin' });
  });
  await test('manager cannot approve accounts or suspend through employment-status edits', async () => {
    await actor('manager-uid', async () => {
      await denied("select public.admin_set_access(4,'assistant','approved')");
      await denied("update staff set employment_status='inactive' where id=1");
    });
  });
  await test('admin can change another account and cannot change its own privilege', async () => {
    await actor('admin-uid', async () => {
      await denied("select public.admin_set_access(1,'assistant','approved')");
      await db.exec("select public.admin_set_access(4,'assistant','approved')");
    });
    await actor('pending-uid', async () => assert.equal((await db.query('select * from students')).rows.length, 1));
    await actor('admin-uid', async () => db.exec("select public.admin_set_access(4,'assistant','suspended')"));
    await actor('pending-uid', async () => assert.equal((await db.query('select * from students')).rows.length, 0));
  });
  await test('manager can register and enroll a student atomically while assistant cannot', async () => {
    await actor('assistant-uid', async () => {
      await denied("select public.register_student_and_enroll(2,null,'S2','새 학생','','01011112222','','parent','2026-09-01')");
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
      const newSession = await first('select id from class_sessions where class_id=1 and session_number=2');
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
  console.log(`Completed ${passed} access tests. No live accounts or messages changed.`);
} finally { await db.close(); }
