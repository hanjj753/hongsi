import type { StudentTransfer } from './classData';
import { compareClasses } from './classOrdering';

type Row = Record<string, any>;
export type AttendanceOverviewCell = { text: string; detail: string; transfer: boolean; makeup: boolean };
export type AttendanceOverviewRow = {
  key: string; className: string; fullName: string; studentPhone: string; parentPhone: string; email: string;
  cells: AttendanceOverviewCell[];
};
export type AttendanceOverview = { maxSession: number; rows: AttendanceOverviewRow[] };

export function buildAttendanceOverview(input: {
  classes: Row[]; students: Row[]; enrollments: Row[]; sessions: Row[]; records: Row[];
  participants: Row[]; transfers: StudentTransfer[]; classLabel: (row: Row) => string;
}): AttendanceOverview {
  const { classes, students, enrollments, sessions, records, participants, transfers, classLabel } = input;
  const studentMap = new Map(students.map((row) => [String(row.id), row]));
  const classMap = new Map(classes.map((row) => [String(row.id), row]));
  const sessionMap = new Map(sessions.map((row) => [String(row.id), row]));
  const attendanceMap = new Map(records.map((row) => [`${row.session_id}:${row.student_id}`, row]));
  const hostMap = new Map(participants.map((row) => [`${row.session_id}:${row.student_id}`, row]));
  const homeMap = new Map(participants.filter((row) => row.home_session_id != null).map((row) => [`${row.home_session_id}:${row.student_id}`, row]));
  const classSessions = new Map<string, Row[]>();
  for (const session of sessions) {
    const key = String(session.class_id);
    classSessions.set(key, [...(classSessions.get(key) ?? []), session]);
  }
  for (const list of classSessions.values()) list.sort((a, b) => a.session_date.localeCompare(b.session_date) || a.session_number - b.session_number);
  const roster = new Map<string, Row>();
  for (const enrollment of enrollments) roster.set(`${enrollment.class_id}:${enrollment.student_id}`, enrollment);
  for (const participant of participants) {
    const key = `${participant.host_class_id}:${participant.student_id}`;
    if (!roster.has(key)) roster.set(key, { class_id: participant.host_class_id, student_id: participant.student_id, temporary: true });
  }
  const maxSession = sessions.reduce((max, row) => Math.max(max, Number(row.session_number)), 0);
  const result: Array<AttendanceOverviewRow & { classId: string; studentId: string }> = [];
  for (const enrollment of roster.values()) {
    const classId = String(enrollment.class_id), studentId = String(enrollment.student_id);
    const student = studentMap.get(studentId), classItem = classMap.get(classId);
    if (!student || !classItem) continue;
    const moves = transfers.filter((move) => move.studentId === studentId);
    const outgoing = moves.filter((move) => move.sourceClassId === classId);
    const incoming = moves.filter((move) => move.targetClassId === classId);
    const list = classSessions.get(classId) ?? [];
    const byNumber = new Map(list.map((session) => [Number(session.session_number), session]));
    const cells = Array.from({ length: maxSession }, (_, index): AttendanceOverviewCell => {
      const session = byNumber.get(index + 1);
      const cell = { text: '—', detail: '이 수업에는 해당 차시 일정이 없습니다.', transfer: false, makeup: false };
      if (!session) return cell;
      const key = `${session.id}:${studentId}`, date = String(session.session_date);
      const record = attendanceMap.get(key), host = hostMap.get(key), home = homeMap.get(key);
      const firstAfter = (move: StudentTransfer) => list.find((entry) => entry.session_date >= move.effectiveOn)?.id === session.id;
      const arriving = incoming.filter(firstAfter), leaving = outgoing.filter(firstAfter);
      const eligible = !enrollment.temporary && (
        ((!enrollment.joined_on || enrollment.joined_on <= date) && (!enrollment.ended_on || enrollment.ended_on >= date))
        || outgoing.some((move) => (!move.sourceJoinedOn || move.sourceJoinedOn <= date) && date < move.effectiveOn)
      );
      cell.text = record?.attendance_status || (host || eligible ? '미입력' : enrollment.temporary ? '—' : '미등록');
      cell.detail = `${date} · ${index + 1}차시`;
      const details: string[] = [];
      for (const move of [...arriving, ...leaving]) {
        cell.transfer = true;
        details.push(`${move.effectiveOn} 전반: ${move.sourceClassName} → ${move.targetClassName}`);
      }
      if (leaving.length && !eligible && !record?.attendance_status && !host) cell.text = '전반';
      if (host) {
        cell.makeup = true;
        const original = sessionMap.get(String(host.home_session_id));
        const originalClass = classMap.get(String(host.home_class_id));
        details.push(`${originalClass ? classLabel(originalClass) : '원래 수업'}${original ? ` ${original.session_number}차시` : ''} → ${classLabel(classItem)} ${session.session_number}차시 (${host.participation_type === 'clinic' ? '클리닉 참여' : '보강'})`);
      }
      if (home) {
        cell.makeup = true;
        const destination = sessionMap.get(String(home.session_id)), destinationClass = classMap.get(String(home.host_class_id));
        details.push(`${classLabel(classItem)} ${session.session_number}차시 → ${destinationClass ? classLabel(destinationClass) : '다른 수업'}${destination ? ` ${destination.session_number}차시 (${destination.session_date})` : ''} 보강`);
        if (!record?.attendance_status) cell.text = '보강';
      }
      if (record?.attendance_status === '보강') {
        cell.makeup = true;
        const note = [record.makeup_date, record.makeup_time?.slice(0, 5), record.makeup_note].filter(Boolean).join(' ');
        if (note) details.push(`보강: ${note}`);
      }
      if (details.length) cell.detail += `\n${details.join('\n')}`;
      return cell;
    });
    result.push({ key: `${classId}:${studentId}`, classId, studentId, className: classLabel(classItem), fullName: String(student.full_name),
      studentPhone: String(student.student_phone ?? ''), parentPhone: String(student.parent_phone ?? ''), email: String(student.email ?? ''), cells });
  }
  const names = new Intl.Collator('ko-KR', { numeric: true });
  result.sort((a, b) => compareClasses(classMap.get(a.classId)!, classMap.get(b.classId)!) || names.compare(a.fullName, b.fullName) || names.compare(a.studentId, b.studentId));
  return { maxSession, rows: result };
}
