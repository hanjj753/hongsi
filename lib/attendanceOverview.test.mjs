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
test('both sides of a transfer are marked and a return preserves the earlier enrollment period', () => {
  const data = build({ enrollments: [{ class_id: '1', student_id: '1', joined_on: '2026-10-15' }, { class_id: '2', student_id: '1', joined_on: '2026-10-08', ended_on: '2026-10-14' }],
    transfers: [move('1','1','2','2026-10-01','2026-10-08'),move('2','2','1','2026-10-08','2026-10-15')], records: [{session_id:'11',student_id:'1',attendance_status:'출석'},{session_id:'22',student_id:'1',attendance_status:'출석'},{session_id:'13',student_id:'1',attendance_status:'영상'}] });
  assert.equal(data.rows[0].cells[0].text, '출석');
  assert.equal(data.rows[0].cells[1].text, '전반');
  assert.equal(data.rows[1].cells[1].text, '출석');
  assert.equal(data.rows[1].cells[1].transfer, true);
  assert.match(data.rows[1].cells[1].detail, /반1 → 반2/);
  assert.equal(data.rows[0].cells[2].text, '영상');
  assert.equal(data.rows[0].cells[2].transfer, true);
});
test('makeup attendance is blue on both classes even when the host date is earlier', () => {
  const data = build({ enrollments: [{class_id:'1',student_id:'1',joined_on:'2026-10-01'}], participants: [{session_id:'21',student_id:'1',host_class_id:'2',home_class_id:'1',home_session_id:'12',participation_type:'makeup'}], records: [{session_id:'21',student_id:'1',attendance_status:'영상'}] });
  assert.equal(data.rows.length, 2);
  assert.equal(data.rows[0].cells[1].text, '보강');
  assert.equal(data.rows[0].cells[1].makeup, true);
  assert.equal(data.rows[1].cells[0].text, '영상');
  assert.equal(data.rows[1].cells[0].makeup, true);
  assert.equal(data.rows[1].cells[1].text, '—');
  assert.match(data.rows[1].cells[0].detail, /보강/);
});
