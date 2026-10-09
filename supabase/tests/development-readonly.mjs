import assert from 'node:assert/strict';

// No private credentials, user rows, or writes. Only the selected development API.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(url, 'https://xhyzngxwxeooffmcaxyl.supabase.co');
assert.ok(key?.startsWith('sb_publishable_'));
const classSelect = encodeURIComponent('id,term_label,school,subject,weekdays,default_start_time,default_end_time,default_hourly_rate_krw,is_active,location:locations(id,name,latitude,longitude,notes),class_staff(staff:staff(id,full_name))');
for (const path of [
  'students?select=id&limit=1',
  'staff_private_details?select=staff_id&limit=1',
  `classes?select=${classSelect}&is_active=eq.true&order=term_label.desc,id.asc`,
  'class_terms?select=label,is_active&order=label.desc',
  'locations?select=id,name,latitude,longitude,notes&order=name.asc',
  'session_participants?select=session_id,student_id&limit=1',
  'message_deliveries?select=message_id%2Cmessage%3Amessages!inner%28class_id%29&status=eq.pending&message.class_id=eq.1',
]) {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey:key }, signal:AbortSignal.timeout(15000) });
  assert.ok([401,403].includes(r.status), `Expected anonymous denial, received ${r.status}`);
  assert.equal((await r.json()).code, '42501', 'Expected database permission denial, not an invalid API key');
  console.log(`PASS anonymous ${path.split('?')[0]} denied (${r.status})`);
}
for (const [name, body] of [
  ['get_my_access', {}],
  ['link_my_staff_account', {}],
  ['start_my_work_shift', { target_class_id: 1 }],
  ['finish_my_work_shift', {}],
  ['get_class_work_summary', { target_class_id: 1 }],
  ['admin_save_staff_bank_account', { target_staff_id: 1, target_bank_account: 'DENIED' }],
  ['register_sending_device', { device_label: 'DENIED', android_identifier: 'DENIED' }],
  ['reset_sending_device', { target_device_id: '00000000-0000-4000-8000-000000000000' }],
  ['get_sending_device_state', { target_device_id: '00000000-0000-4000-8000-000000000000', device_secret: 'DENIED' }],
  ['create_class_messages', { target_class_id: 1, target_session_id: null, message_items: [] }],
  ['claim_next_message_delivery', { target_class_id: 1, target_device_id: '00000000-0000-4000-8000-000000000000', device_secret: 'DENIED' }],
  ['finish_message_delivery', { target_message_id: 1, target_recipient_type: 'parent', target_device_id: '00000000-0000-4000-8000-000000000000', device_secret: 'DENIED', delivery_result: 'failed', error_message: 'DENIED' }],
  ['cancel_pending_class_messages', { target_class_id: 1 }],
  ['delete_managed_location', { target_location_id: 1 }],
  ['register_student_and_enroll', {
    target_class_id: 1, target_student_id: null, new_student_code: 'DENIED', new_full_name: 'DENIED',
    new_student_phone: '', new_parent_phone: '', new_email: '', new_default_message_recipients: 'parent', new_joined_on: null,
  }],
  ['save_student_session_draft', {
    target_class_id: 1, target_session_id: 1, target_student_id: 1,
    attendance: null, homework_results: [], test_results: [],
  }],
  ['save_session_roster_draft', {
    target_class_id: 1, target_session_id: 1, student_drafts: [],
  }],
  ['save_class_term', { original_label: null, new_label: 'DENIED' }],
  ['archive_class_term', { target_label: 'DENIED' }],
  ['save_managed_class', {
    target_class_id: null, target_term_label: 'DENIED', target_school: 'DENIED', target_subject: 'DENIED',
    target_location_id: null, target_weekdays: [], target_start_time: null, target_end_time: null,
    target_hourly_rate_krw: null, target_is_active: true,
  }],
  ['save_managed_class_with_staff', {
    target_class_id: null, target_term_label: 'DENIED', target_school: 'DENIED', target_subject: 'DENIED',
    target_location_id: null, target_weekdays: [], target_start_time: null, target_end_time: null,
    target_hourly_rate_krw: null, target_is_active: true, target_staff_ids: [],
  }],
  ['save_managed_class_with_day_part', {
    target_class_id: null, target_term_label: 'DENIED', target_school: 'DENIED', target_subject: 'DENIED',
    target_location_id: null, target_weekdays: [], target_start_time: null, target_end_time: null,
    target_hourly_rate_krw: null, target_is_active: true, target_staff_ids: [], target_day_part: '저녁',
  }],
  ['archive_managed_class', { target_class_id: 1 }],
  ['delete_managed_class', { target_class_id: 1 }],
  ['update_enrollment_start_date', { target_class_id: 1, target_student_id: 1, new_joined_on: '2099-01-01' }],
  ['update_student_and_enrollment', {
    target_class_id: 1, target_student_id: 1, new_student_code: 'DENIED', new_full_name: 'DENIED',
    new_student_phone: '', new_parent_phone: '', new_email: '', new_default_message_recipients: 'parent',
    new_joined_on: '2099-01-01',
  }],
  ['update_class_session', {
    target_class_id: 1, target_session_id: 1, new_session_date: '2099-01-01', new_notes: '', target_staff_ids: [],
  }],
  ['delete_class_session', { target_class_id: 1, target_session_id: 1 }],
  ['delete_class_enrollment', { target_class_id: 1, target_student_id: 1 }],
  ['create_class_sessions', { target_class_id: 1, session_drafts: [{ session_number: 999, session_date: '2099-01-01' }] }],
  ['delete_session_item', { target_class_id: 1, target_session_id: 1, target_item_kind: 'test', target_item_id: 1 }],
  ['transfer_student', { source_class_id: 1, target_class_id: 2, target_student_id: 1, effective_on: '2099-01-01' }],
  ['withdraw_student', { target_class_id: 1, target_student_id: 1, last_attendance_on: '2099-01-01' }],
  ['reactivate_student', { target_class_id: 1, target_student_id: 1, new_joined_on: '2099-01-01' }],
  ['add_makeup_participant', { target_host_class_id: 1, target_session_id: 1, target_student_id: 1, target_home_class_id: 2, target_home_session_id: 2, new_notes: '' }],
  ['remove_makeup_participant', { target_host_class_id: 1, target_session_id: 1, target_student_id: 1 }],
]) {
  const rpc = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method:'POST', headers:{ apikey:key, 'Content-Type':'application/json' },
    body:JSON.stringify(body), signal:AbortSignal.timeout(15000),
  });
  assert.ok([401,403].includes(rpc.status), `Expected anonymous ${name} denial, received ${rpc.status}`);
  assert.equal((await rpc.json()).code, '42501', `Expected ${name} permission denial`);
  console.log(`PASS anonymous ${name} RPC denied (${rpc.status})`);
}
