import type { StudentTransfer } from './classData';
import { compareClasses } from './classOrdering';

type Row = Record<string, any>;
export type AttendanceOverviewCell = { text: string; detail: string; transfer: boolean; makeup: boolean };
export type AttendanceOverviewRow = {
  key: string; classId: string; className: string; fullName: string; studentPhone: string; parentPhone: string; email: string;
  isWithdrawn: boolean;
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
  // Temporary visits do not create roster rows. A student belongs to the latest
  // active enrollment, with historical attendance merged into that single row.
  const roster = new Map<string, Row[]>();
  for (const enrollment of enrollments) {
    if (!classMap.has(String(enrollment.class_id))) continue;
    const key = String(enrollment.student_id);
    roster.set(key, [...(roster.get(key) ?? []), enrollment]);
  }
  const maxSession = sessions.reduce((max, row) => Math.max(max, Number(row.session_number)), 0);
  const result: Array<AttendanceOverviewRow & { classId: string; studentId: string }> = [];
  for (const [studentId, studentEnrollments] of roster) {
    const moves = transfers.filter((move) => move.studentId === studentId)
      .slice().sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn) || Number(a.id) - Number(b.id));
    const latestTarget = moves[moves.length - 1]?.targetClassId;
    const active = (item: Row) => item.enrollment_status === 'active' || (!item.enrollment_status && !item.ended_on);
    const enrollment = studentEnrollments.slice().sort((a, b) =>
      Number(active(b)) - Number(active(a))
      || Number(String(b.class_id) === latestTarget) - Number(String(a.class_id) === latestTarget)
      || String(b.ended_on || b.joined_on || '').localeCompare(String(a.ended_on || a.joined_on || ''))
      || Number(b.class_id) - Number(a.class_id))[0];
    const classId = String(enrollment.class_id);
    const student = studentMap.get(studentId), classItem = classMap.get(classId);
    if (!student || !classItem) continue;
    const isWithdrawn = enrollment.enrollment_status === 'withdrawn';
    const linkedClasses = new Set(studentEnrollments.map((item) => String(item.class_id)));
    const byNumber = new Map<number, Row[]>();
    for (const session of sessions) {
      if (!linkedClasses.has(String(session.class_id))) continue;
      // A host visit is visible through the original session's makeup link.
      if (hostMap.has(`${session.id}:${studentId}`)) continue;
      const number = Number(session.session_number);
      byNumber.set(number, [...(byNumber.get(number) ?? []), session]);
    }
    const eligible = (session: Row) => {
      const date = String(session.session_date), sourceClassId = String(session.class_id);
      return studentEnrollments.some((item) => String(item.class_id) === sourceClassId
        && (!item.joined_on || item.joined_on <= date) && (!item.ended_on || item.ended_on >= date))
        || moves.some((move) => move.sourceClassId === sourceClassId
          && (!move.sourceJoinedOn || move.sourceJoinedOn <= date) && date < move.effectiveOn);
    };
    const entered = (session: Row) => Boolean(attendanceMap.get(`${session.id}:${studentId}`)?.attendance_status || homeMap.has(`${session.id}:${studentId}`));
    const newestFirst = (a: Row, b: Row) => String(b.session_date).localeCompare(String(a.session_date))
      || Number(String(b.class_id) === classId) - Number(String(a.class_id) === classId) || Number(b.id) - Number(a.id);
    const arrivalNumbers = new Map<string, number>();
    for (const move of moves) {
      const first = (classSessions.get(move.targetClassId) ?? []).find((session) => session.session_date >= move.effectiveOn);
      if (first) arrivalNumbers.set(move.id, Number(first.session_number));
    }
    const cells = Array.from({ length: maxSession }, (_, index): AttendanceOverviewCell => {
      const candidates = (byNumber.get(index + 1) ?? []).slice().sort(newestFirst);
      const eligibleSessions = candidates.filter(eligible);
      const saved = eligibleSessions.filter(entered);
      // Retain saved historical records even when an older enrollment interval
      // was overwritten before transfer history started being recorded.
      const historical = candidates.filter((session) => {
        const originalEnrollment = studentEnrollments.find((item) => String(item.class_id) === String(session.class_id));
        return entered(session) && (!originalEnrollment?.ended_on || session.session_date <= originalEnrollment.ended_on)
          && (!isWithdrawn || !enrollment.ended_on || session.session_date <= enrollment.ended_on);
      });
      const reference = candidates.find((session) => String(session.class_id) === classId);
      const session = saved[0] ?? eligibleSessions[0] ?? historical[0] ?? reference;
      const cell = { text: '—', detail: '이 수업에는 해당 차시 일정이 없습니다.', transfer: false, makeup: false };
      if (!session) return cell;
      const key = `${session.id}:${studentId}`, date = String(session.session_date);
      const record = attendanceMap.get(key), home = homeMap.get(key);
      const pastWithdrawal = isWithdrawn && enrollment.ended_on && date > enrollment.ended_on && !eligible(session);
      cell.text = pastWithdrawal ? '퇴원' : record?.attendance_status || (eligible(session) ? '미입력' : '미등록');
      const recordedClass = classMap.get(String(session.class_id));
      cell.detail = `${recordedClass ? classLabel(recordedClass) : '이전 수업'} · ${date} · ${index + 1}차시`;
      const details: string[] = [];
      for (const move of moves.filter((item) => arrivalNumbers.get(item.id) === index + 1)) {
        cell.transfer = true;
        details.push(`${move.effectiveOn} 전반: ${move.sourceClassName} → ${move.targetClassName}`);
      }
      for (const other of saved.filter((item) => item.id !== session.id)) {
        const otherClass = classMap.get(String(other.class_id));
        const otherStatus = homeMap.has(`${other.id}:${studentId}`) ? '보강' : attendanceMap.get(`${other.id}:${studentId}`)?.attendance_status;
        details.push(`같은 차시의 이전 기록: ${otherClass ? classLabel(otherClass) : '이전 수업'} · ${other.session_date} · ${otherStatus}`);
      }
      if (home) {
        cell.makeup = true;
        if (!pastWithdrawal) cell.text = '보강';
        const destination = sessionMap.get(String(home.session_id)), destinationClass = classMap.get(String(home.host_class_id));
        details.push(`${recordedClass ? classLabel(recordedClass) : '원래 수업'} ${session.session_number}차시 → ${destinationClass ? classLabel(destinationClass) : '다른 수업'}${destination ? ` ${destination.session_number}차시 (${destination.session_date})` : ''} 보강`);
      }
      if (record?.attendance_status === '보강') {
        cell.makeup = true;
        const note = [record.makeup_date, record.makeup_time?.slice(0, 5), record.makeup_note].filter(Boolean).join(' ');
        if (note) details.push(`보강: ${note}`);
      }
      if (details.length) cell.detail += `\n${details.join('\n')}`;
      return cell;
    });
    result.push({ key: studentId, classId, studentId, className: classLabel(classItem), fullName: String(student.full_name), isWithdrawn,
      studentPhone: String(student.student_phone ?? ''), parentPhone: String(student.parent_phone ?? ''), email: String(student.email ?? ''), cells });
  }
  const names = new Intl.Collator('ko-KR', { numeric: true });
  result.sort((a, b) => compareClasses(classMap.get(a.classId)!, classMap.get(b.classId)!) || names.compare(a.fullName, b.fullName) || names.compare(a.studentId, b.studentId));
  return { maxSession, rows: result };
}
