import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const asModule = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`;
const orderingUrl = asModule(await readFile(new URL('./classOrdering.ts', import.meta.url), 'utf8'));
const { compareClasses } = await import(orderingUrl);
const overviewSource = (await readFile(new URL('./attendanceOverview.ts', import.meta.url), 'utf8')).replace("'./classOrdering'", JSON.stringify(orderingUrl));
const { buildAttendanceOverview } = await import(asModule(overviewSource));
const classes = [{ id: '1', school: '경기고', subject: '과학', weekdays: [1], day_part: '저녁' }, { id: '2', school: '경기고', subject: '과학', weekdays: [4], day_part: '저녁' }];
const student = { id: '1', full_name: '김학생', student_phone: '01011112222', parent_phone: '01033334444', email: 'test@example.invalid' };
const sessions = [1,2,3,4].flatMap((number) => classes.map((item) => ({ id: `${item.id}${number}`, class_id: item.id, session_number: number, session_date: `2026-10-${String(1 + (number - 1) * 7).padStart(2, '0')}` })));
const move = (id, sourceClassId, targetClassId, sourceJoinedOn, effectiveOn) => ({ id, studentId: '1', sourceClassId, targetClassId, sourceJoinedOn, effectiveOn, sourceClassName: `반${sourceClassId}`, targetClassName: `반${targetClassId}` });
const build = (overrides = {}) => buildAttendanceOverview({ classes, students: [student], sessions, enrollments: [{ class_id: '1', student_id: '1', joined_on: '2026-10-08' }], records: [], participants: [], transfers: [], classLabel: (item) => `반${item.id}`, ...overrides });

test('school, subject, Monday to Sunday, then morning to evening order is shared', () => {
  const items = ['저녁','오후','오전'].flatMap((part) => [0,6,1].map((day) => ({ school: '경기고', subject: '과학', weekdays: [day], day_part: part })));
  assert.deepEqual(items.sort(compareClasses).map((item) => `${item.weekdays[0]}-${item.day_part}`), ['1-오전','1-오후','1-저녁','6-오전','6-오후','6-저녁','0-오전','0-오후','0-저녁']);
  assert.ok(compareClasses({ school: '가고', subject: '화학' }, { school: '나고', subject: '과학' }) < 0);
  assert.ok(compareClasses({ school: '가고', subject: '과학' }, { school: '가고', subject: '화학' }) < 0);
  assert.ok(compareClasses({ school: '가고', subject: '과학', weekdaySchedule: [{weekday: 1, dayPart: '오전'}] }, { school: '가고', subject: '과학', weekdaySchedule: [{weekday: 1, dayPart: '저녁'}] }) < 0);
});
test('late registration, missing attendance, missing sessions and maximum session number', () => {
  const data = build({ sessions: sessions.filter((item) => item.id !== '14') });
  assert.equal(data.maxSession, 4);
  assert.deepEqual(data.rows[0].cells.map((cell) => cell.text), ['미등록','미입력','미입력','—']);
});
test('a transferred student appears once in the current class, with earlier attendance carried over', () => {
  const data = build({ enrollments: [{ class_id: '1', student_id: '1', joined_on: '2026-10-01', ended_on: '2026-10-07', enrollment_status: 'transferred' }, { class_id: '2', student_id: '1', joined_on: '2026-10-08', enrollment_status: 'active' }],
    transfers: [move('1','1','2','2026-10-01','2026-10-08')], records: [{session_id:'11',student_id:'1',attendance_status:'출석'},{session_id:'22',student_id:'1',attendance_status:'출석'}] });
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].classId, '2');
  assert.deepEqual(data.rows[0].cells.map((cell) => cell.text), ['출석','출석','미입력','미입력']);
  assert.equal(data.rows[0].cells[0].transfer, false);
  assert.match(data.rows[0].cells[0].detail, /반1/);
  assert.equal(data.rows[0].cells[1].transfer, true);
  assert.match(data.rows[0].cells[1].detail, /반1 → 반2/);
});
test('multiple transfers including a return merge every attendance into one current-class row', () => {
  const data = build({ enrollments: [{ class_id: '1', student_id: '1', joined_on: '2026-10-15', enrollment_status: 'active' }, { class_id: '2', student_id: '1', joined_on: '2026-10-08', ended_on: '2026-10-14', enrollment_status: 'transferred' }],
    transfers: [move('1','1','2','2026-10-01','2026-10-08'),move('2','2','1','2026-10-08','2026-10-15')], records: [{session_id:'11',student_id:'1',attendance_status:'출석'},{session_id:'22',student_id:'1',attendance_status:'출석'},{session_id:'13',student_id:'1',attendance_status:'영상'}] });
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].classId, '1');
  assert.equal(data.rows[0].cells[0].text, '출석');
  assert.equal(data.rows[0].cells[1].text, '출석');
  assert.equal(data.rows[0].cells[1].transfer, true);
  assert.match(data.rows[0].cells[1].detail, /반1 → 반2/);
  assert.equal(data.rows[0].cells[2].text, '영상');
  assert.equal(data.rows[0].cells[2].transfer, true);
  assert.match(data.rows[0].cells[2].detail, /반2 → 반1/);
});
test('makeup visits add no host row and remain linked to the original session even if the visit is earlier', () => {
  const data = build({ enrollments: [{class_id:'1',student_id:'1',joined_on:'2026-10-01'}], participants: [{session_id:'21',student_id:'1',host_class_id:'2',home_class_id:'1',home_session_id:'12',participation_type:'makeup'}], records: [{session_id:'21',student_id:'1',attendance_status:'영상'}] });
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].classId, '1');
  assert.equal(data.rows[0].cells[1].text, '보강');
  assert.equal(data.rows[0].cells[1].makeup, true);
  assert.equal(data.rows[0].cells[0].text, '미입력');
  assert.match(data.rows[0].cells[1].detail, /반1 2차시 → 반2 1차시/);
});
test('withdrawal retains past attendance, marks later sessions withdrawn, and keeps earlier unregistered cells', () => {
  const data = build({ enrollments: [{class_id:'1',student_id:'1',joined_on:'2026-10-08',ended_on:'2026-10-08',enrollment_status:'withdrawn'}], records: [{session_id:'12',student_id:'1',attendance_status:'영상'}] });
  assert.equal(data.rows[0].isWithdrawn, true);
  assert.deepEqual(data.rows[0].cells.map((cell) => cell.text), ['미등록','영상','퇴원','퇴원']);
});
test('a student who withdraws after a transfer remains once in the final class', () => {
  const data = build({ enrollments: [{class_id:'1',student_id:'1',joined_on:'2026-10-01',ended_on:'2026-10-07',enrollment_status:'transferred'}, {class_id:'2',student_id:'1',joined_on:'2026-10-08',ended_on:'2026-10-08',enrollment_status:'withdrawn'}], transfers: [move('1','1','2','2026-10-01','2026-10-08')], records: [{session_id:'11',student_id:'1',attendance_status:'출석'}, {session_id:'22',student_id:'1',attendance_status:'출석'}] });
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].classId, '2');
  assert.equal(data.rows[0].isWithdrawn, true);
  assert.deepEqual(data.rows[0].cells.map((cell) => cell.text), ['출석','출석','퇴원','퇴원']);
});
test('overlapping session numbers keep the most recent entered result and show the other result in details', () => {
  const changedSessions = sessions.map((item) => item.id === '12' ? {...item,session_date:'2026-10-07'} : item.id === '22' ? {...item,session_date:'2026-10-09'} : item);
  const data = build({ sessions: changedSessions, enrollments: [{class_id:'1',student_id:'1',joined_on:'2026-10-01',ended_on:'2026-10-07',enrollment_status:'transferred'}, {class_id:'2',student_id:'1',joined_on:'2026-10-08',enrollment_status:'active'}], transfers: [move('1','1','2','2026-10-01','2026-10-08')], records: [{session_id:'12',student_id:'1',attendance_status:'영상'},{session_id:'22',student_id:'1',attendance_status:'출석'}] });
  assert.equal(data.rows[0].cells[1].text, '출석');
  assert.match(data.rows[0].cells[1].detail, /이전 기록: 반1 · 2026-10-07 · 영상/);
});
test('temporary-only participation never creates an attendance overview row', () => {
  const data = build({enrollments:[],participants:[{session_id:'21',student_id:'1',host_class_id:'2',home_class_id:'1',home_session_id:'12'}]});
  assert.equal(data.rows.length, 0);
});
test('an old class absence entered after transfer cannot replace the current class attendance', () => {
  const data = build({ sessions: [
    {id:'11',class_id:'1',session_number:1,session_date:'2026-10-24'},
    {id:'12',class_id:'1',session_number:2,session_date:'2026-10-31'},
    {id:'14',class_id:'1',session_number:4,session_date:'2026-11-14'},
    {id:'21',class_id:'2',session_number:1,session_date:'2026-10-22'},
    {id:'22',class_id:'2',session_number:2,session_date:'2026-10-29'},
    {id:'23',class_id:'2',session_number:3,session_date:'2026-11-05'},
  ], enrollments: [
    {class_id:'1',student_id:'1',joined_on:'2026-10-24',ended_on:'2026-10-28',enrollment_status:'transferred'},
    {class_id:'2',student_id:'1',joined_on:'2026-10-29',enrollment_status:'active'},
  ], transfers: [move('1','1','2','2026-10-24','2026-10-29')], records: [
    {session_id:'11',student_id:'1',attendance_status:'영상'}, {session_id:'12',student_id:'1',attendance_status:'결석'},
    {session_id:'22',student_id:'1',attendance_status:'출석'}, {session_id:'23',student_id:'1',attendance_status:'영상'},
    {session_id:'14',student_id:'1',attendance_status:'결석'},
  ] });
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].classId, '2');
  assert.deepEqual(data.rows[0].cells.map((cell) => cell.text), ['영상','출석','영상','—']);
  assert.equal(data.rows[0].cells[1].transfer, true);
  assert.doesNotMatch(data.rows[0].cells[1].detail, /결석/);
});
