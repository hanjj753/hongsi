import { CLASSES_HEADERS, POSITIONS_HEADERS, SCHEDULE_HEADERS } from '../config/sheetConfig';
import { getSupabase } from './supabase';

type AnyRow = Record<string, any>;

export type AttendanceStatus = '출석' | '영상' | '보강' | '결석';
export type HomeworkGrade = 'A' | 'B' | 'C' | '미제출';
export type MessageRecipientPreference = 'parent' | 'both';
export type EnrollmentStatus = 'active' | 'transferred' | 'withdrawn';
export type ClassDayPart = '' | '오전' | '오후' | '저녁';
export type ClassKind = 'regular' | 'clinic';
export type WeekdaySchedule = { weekday: number; dayPart: ClassDayPart; startTime: string; endTime: string };

export type ClassStudent = {
  id: string;
  studentCode: string;
  fullName: string;
  studentPhone: string;
  parentPhone: string;
  email: string;
  defaultMessageRecipients: MessageRecipientPreference;
  joinedOn: string;
  endedOn: string;
  enrollmentStatus: EnrollmentStatus;
  transferredToClassId: string;
  transferredToClassName: string;
  participationType: 'enrolled' | 'makeup' | 'clinic';
  homeClassId: string;
  homeClassName: string;
  homeSessionId: string;
  homeSessionLabel: string;
};

export type AssignableStaff = { id: string; fullName: string };
export type TransferTarget = { id: string; label: string };
export type MakeupCandidate = { studentId: string; studentCode: string; fullName: string; homeClassId: string; homeClassName: string };
export type MakeupHomeSession = { id: string; sessionNumber: number; sessionDate: string; label: string };
export type StudentOverview = {
  id: string;
  studentCode: string;
  fullName: string;
  enrollments: Array<{
    classId: string;
    className: string;
    termLabel: string;
    status: EnrollmentStatus;
    joinedOn: string;
    endedOn: string;
    transferredToClassName: string;
  }>;
};
export type StudentAttendanceHistory = {
  sessionId: string;
  sessionDate: string;
  sessionNumber: number;
  className: string;
  termLabel: string;
  status: AttendanceStatus | '';
  isMakeupVisit: boolean;
  makeupRelationLabel: string;
};
export type StudentHomeworkHistory = Omit<StudentAttendanceHistory, 'status'> & { title: string; grade: HomeworkGrade };
export type StudentTestHistory = Omit<StudentAttendanceHistory, 'status'> & {
  title: string;
  resultType: 'score' | 'memo';
  score: number | null;
  resultText: string;
  status: '결시' | '';
};
export type StudentRecordHistory = {
  attendance: StudentAttendanceHistory[];
  homeworks: StudentHomeworkHistory[];
  tests: StudentTestHistory[];
};

export type SessionAttendance = {
  status: AttendanceStatus | '';
  makeupDate: string;
  makeupTime: string;
  makeupNote: string;
  notes: string;
  makeupHostSessionId: string;
  makeupHostClassName: string;
  makeupHostSessionNumber: number;
  makeupHostSessionDate: string;
};

export type SessionHomework = {
  id: string;
  title: string;
  sortOrder: number;
  notes: string;
  results: Record<string, { grade: HomeworkGrade; notes: string }>;
};

export type SessionTest = {
  id: string;
  title: string;
  resultType: 'score' | 'memo';
  maxScore: number | null;
  sortOrder: number;
  notes: string;
  results: Record<string, { score: number | null; resultText: string; status: '결시' | ''; notes: string }>;
};

export type SessionWorkspace = {
  sessionId: string;
  sessionNumber: number;
  sessionDate: string;
  classKind: ClassKind;
  students: ClassStudent[];
  attendance: Record<string, SessionAttendance>;
  homeworks: SessionHomework[];
  tests: SessionTest[];
};

const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];
const koreanNameCollator = new Intl.Collator('ko-KR', { sensitivity: 'base', numeric: true });
const firstRelation = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;
const timeHm = (value: unknown) => String(value ?? '').slice(0, 5);
const nullableText = (value: string) => value.trim() || null;
const positiveId = (value: string) => /^[1-9]\d*$/.test(String(value).trim());
const workerNames = (links: any[] | null | undefined) => (links ?? [])
  .map((link) => firstRelation<any>(link?.staff)?.full_name)
  .filter(Boolean)
  .join(', ');

async function readAllRows(fetchPage: (from: number, to: number) => any): Promise<AnyRow[]> {
  const rows: AnyRow[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

async function readRowsByIds(table: 'session_homeworks' | 'session_tests' | 'class_sessions' | 'classes',
  columns: string, ids: string[]): Promise<AnyRow[]> {
  const rows: AnyRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await getSupabase().from(table).select(columns).in('id', ids.slice(offset, offset + 100));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

export function formatClassLabel(item: {
  id?: string | number;
  school?: string | null;
  subject?: string | null;
  weekdays?: number[] | null;
  dayPart?: string | null;
  day_part?: string | null;
  classKind?: ClassKind;
  class_kind?: ClassKind;
  weekdaySchedule?: WeekdaySchedule[];
  class_weekday_times?: Array<{ weekday: number; day_part: string }>;
}): string {
  const name = item.classKind === 'clinic' || item.class_kind === 'clinic'
    ? '클리닉' : [item.school, item.subject].filter(Boolean).join(' ') || `수업 ${item.id ?? ''}`.trim();
  const schedule = item.weekdaySchedule ?? item.class_weekday_times?.map((entry) => ({
    weekday: entry.weekday, dayPart: entry.day_part as ClassDayPart, startTime: '', endTime: '',
  }));
  const days = schedule?.length
    ? [...schedule].sort((a, b) => a.weekday - b.weekday)
      .map((entry) => `${weekdayLabels[entry.weekday]} ${entry.dayPart}`.trim()).join('·')
    : (item.weekdays ?? []).map((day) => weekdayLabels[day]).filter(Boolean).join('·');
  return [name, days, schedule?.length ? '' : item.dayPart ?? item.day_part].filter(Boolean).join(' ');
}

function toClassRow(item: AnyRow): AnyRow {
  const location = firstRelation<AnyRow>(item.location);
  return {
    [CLASSES_HEADERS.CLASS_ID]: String(item.id),
    [CLASSES_HEADERS.QUARTER]: item.term_label,
    [CLASSES_HEADERS.SCHOOL]: item.school ?? '',
    [CLASSES_HEADERS.SUBJECT]: item.subject ?? '',
    [CLASSES_HEADERS.DAY]: (item.weekdays ?? []).map((day: number) => weekdayLabels[day]).filter(Boolean).join(', '),
    [CLASSES_HEADERS.PLACE]: location?.name ?? '',
    [CLASSES_HEADERS.CLASS_START]: timeHm(item.default_start_time),
    [CLASSES_HEADERS.CLASS_END]: timeHm(item.default_end_time),
    [CLASSES_HEADERS.WORKERS]: workerNames(item.class_staff),
    [CLASSES_HEADERS.HOURLY_WAGE]: item.default_hourly_rate_krw ?? '',
    __dbId: String(item.id),
    __classLabel: formatClassLabel(item),
    __dayPart: item.day_part ?? '',
    __classKind: item.class_kind ?? 'regular',
    __weekdaySchedule: item.class_weekday_times ?? [],
    __staffIds: (item.class_staff ?? []).map((link: AnyRow) => String(firstRelation<AnyRow>(link?.staff)?.id ?? '')).filter(Boolean),
  };
}

export async function getSupabaseClasses(): Promise<AnyRow[]> {
  const { data, error } = await getSupabase()
    .from('classes')
    .select('id,term_label,school,subject,weekdays,day_part,class_kind,class_weekday_times(weekday,day_part,start_time,end_time),default_start_time,default_end_time,default_hourly_rate_krw,is_active,location:locations(id,name,latitude,longitude,notes),class_staff(staff:staff(id,full_name))')
    .eq('is_active', true)
    .order('term_label', { ascending: false })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toClassRow);
}

export async function getSupabaseLocations(): Promise<AnyRow[]> {
  const { data, error } = await getSupabase()
    .from('locations')
    .select('id,name,latitude,longitude,notes')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((item: AnyRow) => ({
    [POSITIONS_HEADERS.PLACE]: item.name,
    [POSITIONS_HEADERS.PLACE_LOCATION]: item.latitude == null ? '' : `${item.latitude}, ${item.longitude}`,
    [POSITIONS_HEADERS.NOTE]: item.notes ?? '',
    __dbId: String(item.id),
  }));
}

export type ManagedClassTerm = { label: string; isActive: boolean };
export type ManagedLocation = { id: string; name: string };
export type ManagedClass = {
  id: string;
  termLabel: string;
  school: string;
  subject: string;
  locationId: string;
  locationName: string;
  weekdays: number[];
  classKind: ClassKind;
  weekdaySchedule: WeekdaySchedule[];
  dayPart: ClassDayPart;
  startTime: string;
  endTime: string;
  hourlyRateKrw: string;
  staffIds: string[];
  isActive: boolean;
};

export type ManagedClassInput = Omit<ManagedClass, 'locationName'>;

export async function getSupabaseClassCatalog(): Promise<{
  terms: ManagedClassTerm[];
  classes: ManagedClass[];
  locations: ManagedLocation[];
}> {
  const [termsResult, classesResult, locationsResult] = await Promise.all([
    getSupabase().from('class_terms').select('label,is_active').order('label', { ascending: false }),
    getSupabase().from('classes')
      .select('id,term_label,school,subject,location_id,weekdays,day_part,class_kind,class_weekday_times(weekday,day_part,start_time,end_time),default_start_time,default_end_time,default_hourly_rate_krw,is_active,location:locations(name),class_staff(staff_id)')
      .order('term_label', { ascending: false }).order('id', { ascending: true }),
    getSupabase().from('locations').select('id,name').order('name', { ascending: true }),
  ]);
  const error = termsResult.error || classesResult.error || locationsResult.error;
  if (error) throw error;
  return {
    terms: (termsResult.data ?? []).map((item: AnyRow) => ({ label: String(item.label), isActive: Boolean(item.is_active) })),
    classes: (classesResult.data ?? []).map((item: AnyRow) => ({
      id: String(item.id),
      termLabel: String(item.term_label),
      school: String(item.school ?? ''),
      subject: String(item.subject ?? ''),
      locationId: String(item.location_id ?? ''),
      locationName: String(firstRelation<AnyRow>(item.location)?.name ?? ''),
      weekdays: Array.isArray(item.weekdays) ? item.weekdays.map(Number) : [],
      classKind: item.class_kind === 'clinic' ? 'clinic' : 'regular',
      weekdaySchedule: (item.class_weekday_times ?? []).map((entry: AnyRow) => ({
        weekday: Number(entry.weekday), dayPart: entry.day_part as ClassDayPart,
        startTime: timeHm(entry.start_time), endTime: timeHm(entry.end_time),
      })),
      dayPart: (item.day_part ?? '') as ClassDayPart,
      startTime: timeHm(item.default_start_time),
      endTime: timeHm(item.default_end_time),
      hourlyRateKrw: item.default_hourly_rate_krw == null ? '' : String(item.default_hourly_rate_krw),
      staffIds: (item.class_staff ?? []).map((link: AnyRow) => String(link.staff_id)),
      isActive: Boolean(item.is_active),
    })),
    locations: (locationsResult.data ?? []).map((item: AnyRow) => ({ id: String(item.id), name: String(item.name) })),
  };
}

export async function saveSupabaseClassTerm(originalLabel: string, newLabel: string): Promise<string> {
  const cleanLabel = newLabel.trim();
  if (!cleanLabel) throw new Error('분기 이름을 입력해 주세요.');
  const { data, error } = await getSupabase().rpc('save_class_term', {
    original_label: originalLabel.trim() || null,
    new_label: cleanLabel,
  });
  if (error) throw error;
  return String(data);
}

export async function archiveSupabaseClassTerm(label: string): Promise<void> {
  const { error } = await getSupabase().rpc('archive_class_term', { target_label: label });
  if (error) throw error;
}

function validTimeOrBlank(value: string): boolean {
  if (!value) return true;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

export async function saveSupabaseManagedClass(input: ManagedClassInput): Promise<string> {
  const school = input.school.trim();
  const subject = input.subject.trim();
  if (!input.termLabel.trim()) throw new Error('분기를 선택해 주세요.');
  if (input.classKind === 'regular' && !school && !subject) throw new Error('학교 또는 과목을 입력해 주세요.');
  const schedule = [...input.weekdaySchedule].sort((a, b) => a.weekday - b.weekday);
  if (!schedule.length || schedule.length > 7 || new Set(schedule.map((item) => item.weekday)).size !== schedule.length) {
    throw new Error('요일을 1개 이상 중복 없이 선택해 주세요.');
  }
  for (const item of schedule) {
    if (!Number.isInteger(item.weekday) || item.weekday < 0 || item.weekday > 6) throw new Error('요일 값이 올바르지 않습니다.');
    if (!['오전', '오후', '저녁'].includes(item.dayPart)) throw new Error('각 요일의 시간대를 선택해 주세요.');
    if (!validTimeOrBlank(item.startTime) || !validTimeOrBlank(item.endTime)
      || Boolean(item.startTime) !== Boolean(item.endTime)
      || (item.startTime && item.endTime && item.startTime >= item.endTime)) {
      throw new Error('각 요일의 시작·종료 시간을 HH:MM 형식으로 입력해 주세요.');
    }
  }
  const rate = input.hourlyRateKrw.trim();
  if (rate && (!/^\d+$/.test(rate) || Number(rate) > 2147483647)) {
    throw new Error('시급은 0 이상의 정수로 입력해 주세요.');
  }
  const { data, error } = await getSupabase().rpc('save_managed_class_v2', {
    target_class_id: input.id && positiveId(input.id) ? input.id : null,
    target_term_label: input.termLabel.trim(),
    target_kind: input.classKind,
    target_school: input.classKind === 'clinic' ? null : school,
    target_subject: input.classKind === 'clinic' ? null : subject,
    target_location_id: input.locationId && positiveId(input.locationId) ? input.locationId : null,
    target_weekday_schedule: schedule.map((item) => ({
      weekday: item.weekday, day_part: item.dayPart,
      start_time: item.startTime || null, end_time: item.endTime || null,
    })),
    target_hourly_rate_krw: rate ? Number(rate) : null,
    target_is_active: input.isActive,
    target_staff_ids: [...new Set(input.staffIds)].filter(positiveId).map(Number),
  });
  if (error) throw error;
  return String(data);
}

export async function archiveSupabaseManagedClass(classId: string): Promise<void> {
  if (!positiveId(classId)) throw new Error('수업 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('archive_managed_class', { target_class_id: classId });
  if (error) throw error;
}

export async function deleteSupabaseManagedClass(classId: string): Promise<void> {
  if (!positiveId(classId)) throw new Error('수업 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('delete_managed_class', { target_class_id: classId });
  if (error) throw error;
}

export async function addSupabaseClassSessions(
  classId: string,
  sessions: Array<{ sessionDate: string; notes: string; staffIds?: string[] }>,
): Promise<number> {
  if (!positiveId(classId)) throw new Error('수업 ID가 올바르지 않습니다.');
  if (sessions.length < 1 || sessions.length > 60) throw new Error('일정은 한 번에 1~60개까지 등록할 수 있습니다.');
  const { data, error } = await getSupabase().rpc('create_class_sessions', {
    target_class_id: classId,
    session_drafts: sessions.map((item) => ({
      session_date: item.sessionDate,
      notes: item.notes.trim(),
      ...(item.staffIds ? { staff_ids: item.staffIds } : {}),
    })),
  });
  if (error) throw error;
  return Number(data ?? sessions.length);
}

export async function updateSupabaseClassSession(
  classId: string,
  sessionId: string,
  sessionDate: string,
  notes: string,
  staffIds: string[],
): Promise<void> {
  if (![classId, sessionId].every(positiveId)) throw new Error('수업 또는 차시 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('update_class_session', {
    target_class_id: classId,
    target_session_id: sessionId,
    new_session_date: sessionDate,
    new_notes: notes.trim(),
    target_staff_ids: [...new Set(staffIds)].filter(positiveId).map(Number),
  });
  if (error) throw error;
}

export async function deleteSupabaseClassSession(classId: string, sessionId: string): Promise<void> {
  if (![classId, sessionId].every(positiveId)) throw new Error('수업 또는 차시 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('delete_class_session', {
    target_class_id: classId,
    target_session_id: sessionId,
  });
  if (error) throw error;
}

export async function getSupabaseActiveStaff(): Promise<AssignableStaff[]> {
  const { data, error } = await getSupabase().from('staff')
    .select('id,full_name')
    .eq('employment_status', 'active')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((item: AnyRow) => ({ id: String(item.id), fullName: String(item.full_name) }));
}

export async function saveSupabaseLocation(input: { id?: string; name: string; latitude: number; longitude: number; notes: string }) {
  const values = { name: input.name, latitude: input.latitude, longitude: input.longitude, notes: input.notes || null };
  const query = input.id
    ? getSupabase().from('locations').update(values).eq('id', input.id)
    : getSupabase().from('locations').insert(values);
  const { error } = await query;
  if (error) throw error;
}

export async function deleteSupabaseLocation(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_managed_location', { target_location_id: id });
  if (error) throw error;
}
export async function getSupabaseClassDetail(classId: string): Promise<{ row: AnyRow | null; schedules: AnyRow[] }> {
  const normalizedClassId = String(classId).trim();
  if (!/^[1-9]\d*$/.test(normalizedClassId)) return { row: null, schedules: [] };

  const { data: classItem, error: classError } = await getSupabase()
    .from('classes')
    .select('id,term_label,school,subject,weekdays,day_part,class_kind,class_weekday_times(weekday,day_part,start_time,end_time),default_start_time,default_end_time,default_hourly_rate_krw,is_active,location:locations(id,name,latitude,longitude,notes),class_staff(staff:staff(id,full_name))')
    .eq('id', normalizedClassId)
    .eq('is_active', true)
    .maybeSingle();
  if (classError) throw classError;
  if (!classItem) return { row: null, schedules: [] };

  const row = toClassRow(classItem as AnyRow);
  const { data: sessions, error: sessionError } = await getSupabase()
    .from('class_sessions')
    .select('id,session_number,session_date,start_time,end_time,notes,session_staff(staff:staff(id,full_name))')
    .eq('class_id', (classItem as AnyRow).id)
    .order('session_number', { ascending: true });
  if (sessionError) throw sessionError;

  return {
    row,
    schedules: (sessions ?? []).map((item: AnyRow) => ({
      [SCHEDULE_HEADERS.CLASS_ID]: normalizedClassId,
      [SCHEDULE_HEADERS.QUARTER]: row[CLASSES_HEADERS.QUARTER],
      [SCHEDULE_HEADERS.CLASS_NAME]: row.__classLabel,
      [SCHEDULE_HEADERS.DAY]: row[CLASSES_HEADERS.DAY],
      [SCHEDULE_HEADERS.SESSION]: String(item.session_number),
      [SCHEDULE_HEADERS.DATE]: item.session_date,
      [SCHEDULE_HEADERS.WORKERS]: workerNames(item.session_staff),
      [SCHEDULE_HEADERS.NOTE]: item.notes ?? '',
      __dbId: String(item.id),
      __staffIds: (item.session_staff ?? []).map((link: AnyRow) => String(firstRelation<AnyRow>(link?.staff)?.id ?? '')).filter(Boolean),
    })),
  };
}

function toClassStudent(enrollment: AnyRow): ClassStudent | null {
  const student = firstRelation<AnyRow>(enrollment.student);
  if (!student) return null;
  const transferTarget = firstRelation<AnyRow>(enrollment.transferred_to);
  return {
    id: String(student.id),
    studentCode: String(student.student_code ?? ''),
    fullName: String(student.full_name ?? ''),
    studentPhone: String(student.student_phone ?? ''),
    parentPhone: String(student.parent_phone ?? ''),
    email: String(student.email ?? ''),
    defaultMessageRecipients: student.default_message_recipients === 'both' ? 'both' : 'parent',
    joinedOn: String(enrollment.joined_on ?? ''),
    endedOn: String(enrollment.ended_on ?? ''),
    enrollmentStatus: ['transferred', 'withdrawn'].includes(enrollment.enrollment_status)
      ? enrollment.enrollment_status as EnrollmentStatus : 'active',
    transferredToClassId: String(enrollment.transferred_to_class_id ?? transferTarget?.id ?? ''),
    transferredToClassName: transferTarget ? formatClassLabel(transferTarget) : '',
    participationType: enrollment.participation_type === 'clinic' ? 'clinic'
      : enrollment.participation_type === 'makeup' ? 'makeup' : 'enrolled',
    homeClassId: String(enrollment.home_class_id ?? ''),
    homeClassName: String(enrollment.home_class_name ?? ''),
    homeSessionId: String(enrollment.home_session_id ?? ''),
    homeSessionLabel: String(enrollment.home_session_label ?? ''),
  };
}

export async function getSupabaseClassStudents(classId: string): Promise<ClassStudent[]> {
  const normalizedClassId = String(classId).trim();
  if (!positiveId(normalizedClassId)) throw new Error('수업 ID가 올바르지 않습니다.');
  const { data, error } = await getSupabase()
    .from('enrollments')
    .select('joined_on,ended_on,enrollment_status,transferred_to_class_id,transferred_to:classes!enrollments_transferred_to_class_id_fkey(id,school,subject,weekdays,day_part,class_kind),student:students(id,student_code,full_name,student_phone,parent_phone,email,default_message_recipients)')
    .eq('class_id', normalizedClassId);
  if (error) throw error;
  return (data ?? [])
    .map((item: AnyRow) => toClassStudent(item))
    .filter((item): item is ClassStudent => Boolean(item))
    .sort((a, b) => koreanNameCollator.compare(a.fullName, b.fullName) || a.studentCode.localeCompare(b.studentCode));
}

export type StudentInput = {
  id?: string;
  studentCode: string;
  fullName: string;
  studentPhone: string;
  parentPhone: string;
  email: string;
  defaultMessageRecipients: MessageRecipientPreference;
  joinedOn?: string;
};

function normalizeMobilePhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^[0-9()+ -]+$/.test(trimmed)) {
    throw new Error('전화번호에는 숫자, 공백, 괄호, 하이픈만 사용할 수 있습니다.');
  }
  const normalized = trimmed.replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(normalized)) {
    throw new Error('전화번호는 01로 시작하는 국내 휴대전화 10~11자리로 입력해 주세요.');
  }
  return normalized;
}

function normalizeStudentInput(input: StudentInput, requireStudentCode: boolean): StudentInput {
  const studentCode = input.studentCode.trim();
  const fullName = input.fullName.trim();
  if (requireStudentCode && !studentCode) throw new Error('학생 ID를 입력해 주세요.');
  if (!fullName) throw new Error('학생 이름을 입력해 주세요.');
  const studentPhone = normalizeMobilePhone(input.studentPhone);
  const parentPhone = normalizeMobilePhone(input.parentPhone);
  const email = input.email.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('이메일 형식을 확인해 주세요. 예: student@example.com');
  }
  if (input.defaultMessageRecipients === 'both' && !studentPhone) {
    throw new Error('학생과 학부모 모두에게 문자를 보내려면 학생 전화번호가 필요합니다.');
  }
  return { ...input, studentCode, fullName, studentPhone, parentPhone, email };
}

export async function saveSupabaseStudent(input: StudentInput): Promise<string> {
  if (!input.id || !positiveId(input.id)) throw new Error('수정할 학생 ID가 올바르지 않습니다.');
  const normalized = normalizeStudentInput(input, true);
  const values = {
    student_code: normalized.studentCode,
    full_name: normalized.fullName,
    student_phone: nullableText(normalized.studentPhone),
    parent_phone: nullableText(normalized.parentPhone),
    email: nullableText(normalized.email)?.toLowerCase() ?? null,
    default_message_recipients: normalized.defaultMessageRecipients,
  };
  const { data, error } = await getSupabase()
    .from('students')
    .update(values)
    .eq('id', input.id)
    .select('id')
    .single();
  if (error) throw error;
  return String(data.id);
}

export async function saveSupabaseStudentEnrollment(classId: string, input: StudentInput): Promise<void> {
  if (!positiveId(classId) || !input.id || !positiveId(input.id)) throw new Error('수정할 수강 정보가 올바르지 않습니다.');
  const normalized = normalizeStudentInput(input, true);
  const { error } = await getSupabase().rpc('update_student_and_enrollment', {
    target_class_id: classId,
    target_student_id: input.id,
    new_student_code: normalized.studentCode,
    new_full_name: normalized.fullName,
    new_student_phone: normalized.studentPhone,
    new_parent_phone: normalized.parentPhone,
    new_email: normalized.email,
    new_default_message_recipients: normalized.defaultMessageRecipients,
    new_joined_on: normalized.joinedOn || null,
  });
  if (error) throw error;
}

export async function saveAndEnrollSupabaseStudent(classId: string, input: StudentInput): Promise<string> {
  if (!positiveId(classId)) throw new Error('수업 ID가 올바르지 않습니다.');
  const normalized = normalizeStudentInput(input, false);
  const { data, error } = await getSupabase().rpc('register_student_and_enroll', {
    target_class_id: classId,
    target_student_id: input.id ?? null,
    new_student_code: normalized.studentCode,
    new_full_name: normalized.fullName,
    new_student_phone: normalized.studentPhone,
    new_parent_phone: normalized.parentPhone,
    new_email: normalized.email,
    new_default_message_recipients: normalized.defaultMessageRecipients,
    new_joined_on: normalized.joinedOn || null,
  });
  if (error) throw error;
  return String(data);
}

export async function getSupabaseTransferTargets(sourceClassId: string): Promise<TransferTarget[]> {
  if (!positiveId(sourceClassId)) throw new Error('수업 ID가 올바르지 않습니다.');
  const { data: source, error: sourceError } = await getSupabase().from('classes')
    .select('term_label').eq('id', sourceClassId).single();
  if (sourceError) throw sourceError;
  const { data, error } = await getSupabase().from('classes')
    .select('id,school,subject,weekdays,day_part,class_kind').eq('term_label', source.term_label).eq('is_active', true)
    .neq('id', sourceClassId).eq('class_kind', 'regular').order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((item: AnyRow) => ({
    id: String(item.id),
    label: formatClassLabel(item),
  }));
}

export async function transferSupabaseStudent(sourceClassId: string, targetClassId: string, studentId: string, effectiveOn: string): Promise<void> {
  if (![sourceClassId, targetClassId, studentId].every(positiveId)) throw new Error('전반 대상 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('transfer_student', {
    source_class_id: sourceClassId,
    target_class_id: targetClassId,
    target_student_id: studentId,
    effective_on: effectiveOn,
  });
  if (error) throw error;
}

export async function withdrawSupabaseStudent(classId: string, studentId: string, lastAttendanceOn: string): Promise<void> {
  if (![classId, studentId].every(positiveId)) throw new Error('수강 종료 대상 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('withdraw_student', {
    target_class_id: classId,
    target_student_id: studentId,
    last_attendance_on: lastAttendanceOn,
  });
  if (error) throw error;
}

export async function reactivateSupabaseStudent(classId: string, studentId: string, joinedOn: string): Promise<void> {
  if (![classId, studentId].every(positiveId)) throw new Error('수강 재개 대상 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('reactivate_student', {
    target_class_id: classId,
    target_student_id: studentId,
    new_joined_on: joinedOn,
  });
  if (error) throw error;
}

export async function updateSupabaseEnrollmentStartDate(classId: string, studentId: string, joinedOn: string): Promise<void> {
  if (![classId, studentId].every(positiveId)) throw new Error('수업 또는 학생 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('update_enrollment_start_date', {
    target_class_id: classId,
    target_student_id: studentId,
    new_joined_on: joinedOn,
  });
  if (error) throw error;
}

export async function deleteSupabaseClassEnrollment(classId: string, studentId: string): Promise<void> {
  if (![classId, studentId].every(positiveId)) throw new Error('수업 또는 학생 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('delete_class_enrollment', {
    target_class_id: classId,
    target_student_id: studentId,
  });
  if (error) throw error;
}

export async function getSupabaseMakeupCandidates(classId: string, sessionId: string): Promise<MakeupCandidate[]> {
  if (![classId, sessionId].every(positiveId)) throw new Error('수업 또는 차시 ID가 올바르지 않습니다.');
  const [sessionResult, hostClassResult, existingParticipantsResult, hostEnrollmentsResult, linkedHomeSessionsResult] = await Promise.all([
    getSupabase().from('class_sessions').select('session_date').eq('id', sessionId).eq('class_id', classId).single(),
    getSupabase().from('classes').select('term_label').eq('id', classId).single(),
    getSupabase().from('session_participants').select('student_id').eq('session_id', sessionId),
    getSupabase().from('enrollments').select('student_id,joined_on,ended_on').eq('class_id', classId),
    getSupabase().from('session_participants').select('student_id,home_session_id').not('home_session_id', 'is', null),
  ]);
  const firstError = sessionResult.error || hostClassResult.error || existingParticipantsResult.error || hostEnrollmentsResult.error || linkedHomeSessionsResult.error;
  if (firstError) throw firstError;
  const sessionDate = String(sessionResult.data.session_date);
  const excluded = new Set((existingParticipantsResult.data ?? []).map((item: AnyRow) => String(item.student_id)));
  for (const item of hostEnrollmentsResult.data ?? []) {
    if ((!item.joined_on || item.joined_on <= sessionDate) && (!item.ended_on || item.ended_on >= sessionDate)) excluded.add(String(item.student_id));
  }
  const linkedOriginalSessions = new Set((linkedHomeSessionsResult.data ?? [])
    .map((item: AnyRow) => `${item.student_id}:${item.home_session_id}`));
  const { data, error } = await getSupabase().from('enrollments')
    .select('class_id,student_id,joined_on,ended_on,enrollment_status,class:classes!enrollments_class_id_fkey(id,term_label,school,subject,weekdays,day_part,class_kind,is_active,class_sessions(id,session_number,session_date)),student:students(id,student_code,full_name)')
    .neq('class_id', classId);
  if (error) throw error;
  return (data ?? []).filter((item: AnyRow) => {
    const sourceClass = firstRelation<AnyRow>(item.class);
    const hasAvailableOriginalSession = (sourceClass?.class_sessions ?? []).some((sourceSession: AnyRow) => (
      (!item.joined_on || item.joined_on <= sourceSession.session_date)
      && (!item.ended_on || item.ended_on >= sourceSession.session_date)
      && !linkedOriginalSessions.has(`${item.student_id}:${sourceSession.id}`)
    ));
    return sourceClass?.is_active && sourceClass?.term_label === hostClassResult.data.term_label
      && hasAvailableOriginalSession && !excluded.has(String(item.student_id));
  }).map((item: AnyRow) => {
    const sourceClass = firstRelation<AnyRow>(item.class)!;
    const student = firstRelation<AnyRow>(item.student)!;
    return {
      studentId: String(student.id), studentCode: String(student.student_code), fullName: String(student.full_name),
      homeClassId: String(sourceClass.id),
      homeClassName: formatClassLabel(sourceClass),
    };
  }).sort((a, b) => koreanNameCollator.compare(a.fullName, b.fullName) || a.homeClassName.localeCompare(b.homeClassName));
}

export async function getSupabaseClinicCandidates(classId: string, sessionId: string): Promise<MakeupCandidate[]> {
  if (![classId, sessionId].every(positiveId)) throw new Error('클리닉 또는 차시 ID가 올바르지 않습니다.');
  const [hostResult, sessionResult, participantsResult] = await Promise.all([
    getSupabase().from('classes').select('term_label,class_kind').eq('id', classId).single(),
    getSupabase().from('class_sessions').select('session_date').eq('id', sessionId).eq('class_id', classId).single(),
    getSupabase().from('session_participants').select('student_id').eq('session_id', sessionId),
  ]);
  const firstError = hostResult.error || sessionResult.error || participantsResult.error;
  if (firstError) throw firstError;
  if (hostResult.data.class_kind !== 'clinic') throw new Error('클리닉 수업이 아닙니다.');
  const sessionDate = String(sessionResult.data.session_date);
  const alreadyAdded = new Set((participantsResult.data ?? []).map((item: AnyRow) => String(item.student_id)));
  const { data, error } = await getSupabase().from('enrollments')
    .select('class_id,student_id,joined_on,ended_on,class:classes!enrollments_class_id_fkey!inner(id,term_label,school,subject,weekdays,day_part,class_kind,is_active),student:students(id,student_code,full_name)')
    .eq('class.term_label', hostResult.data.term_label)
    .eq('class.class_kind', 'regular')
    .eq('class.is_active', true);
  if (error) throw error;
  const seen = new Set<string>();
  return (data ?? []).filter((item: AnyRow) => {
    const home = firstRelation<AnyRow>(item.class);
    const id = String(item.student_id);
    if (!home?.is_active || home.class_kind !== 'regular' || home.term_label !== hostResult.data.term_label
      || (item.joined_on && item.joined_on > sessionDate)
      || (item.ended_on && item.ended_on < sessionDate)
      || alreadyAdded.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((item: AnyRow) => {
    const home = firstRelation<AnyRow>(item.class)!;
    const student = firstRelation<AnyRow>(item.student)!;
    return {
      studentId: String(student.id), studentCode: String(student.student_code),
      fullName: String(student.full_name), homeClassId: String(home.id),
      homeClassName: formatClassLabel(home),
    };
  }).sort((a, b) => koreanNameCollator.compare(a.fullName, b.fullName));
}

export async function addSupabaseClinicParticipant(
  classId: string, sessionId: string, candidate: MakeupCandidate, notes = '',
): Promise<void> {
  const { error } = await getSupabase().rpc('add_clinic_participant', {
    target_host_class_id: classId, target_session_id: sessionId,
    target_student_id: candidate.studentId, target_home_class_id: candidate.homeClassId,
    new_notes: notes,
  });
  if (error) throw error;
}

export async function getSupabaseMakeupHomeSessions(homeClassId: string, studentId: string): Promise<MakeupHomeSession[]> {
  if (![homeClassId, studentId].every(positiveId)) throw new Error('원래 수업 또는 학생 ID가 올바르지 않습니다.');
  const [enrollmentResult, sessionsResult, linkedResult] = await Promise.all([
    getSupabase().from('enrollments').select('joined_on,ended_on').eq('class_id', homeClassId).eq('student_id', studentId).single(),
    getSupabase().from('class_sessions').select('id,session_number,session_date').eq('class_id', homeClassId)
      .order('session_date', { ascending: true }).order('session_number', { ascending: true }),
    getSupabase().from('session_participants').select('home_session_id').eq('student_id', studentId).not('home_session_id', 'is', null),
  ]);
  const firstError = enrollmentResult.error || sessionsResult.error || linkedResult.error;
  if (firstError) throw firstError;
  const used = new Set((linkedResult.data ?? []).map((item: AnyRow) => String(item.home_session_id)));
  const { joined_on: joinedOn, ended_on: endedOn } = enrollmentResult.data;
  return (sessionsResult.data ?? []).filter((item: AnyRow) => (
    (!joinedOn || joinedOn <= item.session_date)
    && (!endedOn || endedOn >= item.session_date)
    && !used.has(String(item.id))
  )).map((item: AnyRow) => ({
    id: String(item.id),
    sessionNumber: Number(item.session_number),
    sessionDate: String(item.session_date),
    label: `${item.session_number}차시 · ${item.session_date}`,
  }));
}

export async function addSupabaseMakeupParticipant(
  classId: string,
  sessionId: string,
  candidate: MakeupCandidate,
  homeSessionId: string,
  notes = '',
): Promise<void> {
  if (!positiveId(homeSessionId)) throw new Error('원래 수업의 차시를 선택해 주세요.');
  const { error } = await getSupabase().rpc('add_makeup_participant', {
    target_host_class_id: classId,
    target_session_id: sessionId,
    target_student_id: candidate.studentId,
    target_home_class_id: candidate.homeClassId,
    target_home_session_id: homeSessionId,
    new_notes: notes,
  });
  if (error) throw error;
}

export async function removeSupabaseMakeupParticipant(classId: string, sessionId: string, studentId: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_makeup_participant', {
    target_host_class_id: classId,
    target_session_id: sessionId,
    target_student_id: studentId,
  });
  if (error) throw error;
}

export async function getSupabaseSessionWorkspace(classId: string, sessionId: string): Promise<SessionWorkspace> {
  if (!positiveId(classId) || !positiveId(sessionId)) throw new Error('수업 또는 차시 ID가 올바르지 않습니다.');
  const { data: session, error: sessionError } = await getSupabase()
    .from('class_sessions')
    .select('id,session_number,session_date,class:classes(class_kind)')
    .eq('id', sessionId)
    .eq('class_id', classId)
    .single();
  if (sessionError) throw sessionError;

  const [enrollmentsResult, participantsResult, attendanceResult, homeworksResult, testsResult] = await Promise.all([
    getSupabase().from('enrollments')
      .select('joined_on,ended_on,enrollment_status,student:students(id,student_code,full_name,student_phone,parent_phone,email,default_message_recipients)')
      .eq('class_id', classId),
    getSupabase().from('session_participants')
      .select('student_id,home_class_id,home_session_id,participation_type,notes,student:students(id,student_code,full_name,student_phone,parent_phone,email,default_message_recipients)')
      .eq('host_class_id', classId).eq('session_id', sessionId),
    getSupabase().from('student_session_records')
      .select('student_id,attendance_status,makeup_date,makeup_time,makeup_note,makeup_host_session_id,notes')
      .eq('class_id', classId).eq('session_id', sessionId),
    getSupabase().from('session_homeworks')
      .select('id,title,sort_order,notes,student_homework_results(student_id,grade,notes)')
      .eq('class_id', classId).eq('session_id', sessionId)
      .order('sort_order', { ascending: true }).order('id', { ascending: true }),
    getSupabase().from('session_tests')
      .select('id,title,result_type,max_score,sort_order,notes,student_test_results(student_id,score,result_text,status,notes)')
      .eq('class_id', classId).eq('session_id', sessionId)
      .order('sort_order', { ascending: true }).order('id', { ascending: true }),
  ]);
  const firstError = enrollmentsResult.error || participantsResult.error || attendanceResult.error || homeworksResult.error || testsResult.error;
  if (firstError) throw firstError;

  const sessionDate = String(session.session_date);
  const enrolledStudents = (enrollmentsResult.data ?? [])
    .filter((item: AnyRow) => (!item.joined_on || item.joined_on <= sessionDate) && (!item.ended_on || item.ended_on >= sessionDate))
    .map((item: AnyRow) => toClassStudent(item))
    .filter((item): item is ClassStudent => Boolean(item));
  const enrolledIds = new Set(enrolledStudents.map((item) => item.id));
  const participantHomeClassIds = [...new Set((participantsResult.data ?? []).map((item: AnyRow) => String(item.home_class_id)))];
  const participantHomeSessionIds = [...new Set((participantsResult.data ?? [])
    .map((item: AnyRow) => String(item.home_session_id ?? '')).filter(Boolean))];
  const linkedHostSessionIds = [...new Set((attendanceResult.data ?? [])
    .map((item: AnyRow) => String(item.makeup_host_session_id ?? '')).filter(Boolean))];
  const [homeSessionsResult, linkedHostSessionsResult] = await Promise.all([
    participantHomeSessionIds.length
      ? getSupabase().from('class_sessions').select('id,class_id,session_number,session_date').in('id', participantHomeSessionIds)
      : Promise.resolve({ data: [], error: null }),
    linkedHostSessionIds.length
      ? getSupabase().from('class_sessions').select('id,class_id,session_number,session_date').in('id', linkedHostSessionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (homeSessionsResult.error || linkedHostSessionsResult.error) throw homeSessionsResult.error || linkedHostSessionsResult.error;
  const linkedHostClassIds = (linkedHostSessionsResult.data ?? []).map((item: AnyRow) => String(item.class_id));
  const relatedClassIds = [...new Set([...participantHomeClassIds, ...linkedHostClassIds])];
  const relatedClasses = new Map<string, AnyRow>();
  if (relatedClassIds.length > 0) {
    const { data: classRows, error: classRowsError } = await getSupabase().from('classes')
      .select('id,school,subject,weekdays,day_part,class_kind').in('id', relatedClassIds);
    if (classRowsError) throw classRowsError;
    for (const classRow of classRows ?? []) relatedClasses.set(String(classRow.id), classRow);
  }
  const homeSessions = new Map((homeSessionsResult.data ?? []).map((item: AnyRow) => [String(item.id), item]));
  const linkedHostSessions = new Map((linkedHostSessionsResult.data ?? []).map((item: AnyRow) => [String(item.id), item]));
  const makeupStudents = (participantsResult.data ?? []).map((item: AnyRow) => {
    const homeClass = relatedClasses.get(String(item.home_class_id));
    const homeSession = homeSessions.get(String(item.home_session_id));
    return toClassStudent({
      student: item.student,
      enrollment_status: 'active',
      participation_type: item.participation_type,
      home_class_id: item.home_class_id,
      home_class_name: homeClass ? formatClassLabel(homeClass) : '',
      home_session_id: item.home_session_id,
      home_session_label: homeSession ? `${homeSession.session_number}차시 · ${homeSession.session_date}` : '',
    });
  }).filter((item): item is ClassStudent => Boolean(item) && !enrolledIds.has(item.id));
  const students = [...enrolledStudents, ...makeupStudents]
    .sort((a, b) => koreanNameCollator.compare(a.fullName, b.fullName) || a.studentCode.localeCompare(b.studentCode));

  const attendance = Object.fromEntries((attendanceResult.data ?? []).map((item: AnyRow) => [String(item.student_id), {
    ...(linkedHostSessions.has(String(item.makeup_host_session_id)) ? (() => {
      const linkedSession = linkedHostSessions.get(String(item.makeup_host_session_id));
      const linkedClass = relatedClasses.get(String(linkedSession?.class_id));
      return {
        makeupHostSessionId: String(item.makeup_host_session_id),
        makeupHostClassName: linkedClass ? formatClassLabel(linkedClass) : '',
        makeupHostSessionNumber: Number(linkedSession?.session_number ?? 0),
        makeupHostSessionDate: String(linkedSession?.session_date ?? ''),
      };
    })() : { makeupHostSessionId: '', makeupHostClassName: '', makeupHostSessionNumber: 0, makeupHostSessionDate: '' }),
    status: (item.attendance_status ?? '') as AttendanceStatus | '',
    makeupDate: String(item.makeup_date ?? ''),
    makeupTime: timeHm(item.makeup_time),
    makeupNote: String(item.makeup_note ?? ''),
    notes: String(item.notes ?? ''),
  }]));
  const homeworks = (homeworksResult.data ?? []).map((item: AnyRow): SessionHomework => ({
    id: String(item.id), title: String(item.title), sortOrder: Number(item.sort_order), notes: String(item.notes ?? ''),
    results: Object.fromEntries((item.student_homework_results ?? []).map((result: AnyRow) => [String(result.student_id), {
      grade: result.grade as HomeworkGrade, notes: String(result.notes ?? ''),
    }])),
  }));
  const tests = (testsResult.data ?? []).map((item: AnyRow): SessionTest => ({
    id: String(item.id), title: String(item.title), resultType: item.result_type === 'memo' ? 'memo' : 'score',
    maxScore: item.max_score == null ? null : Number(item.max_score), sortOrder: Number(item.sort_order), notes: String(item.notes ?? ''),
    results: Object.fromEntries((item.student_test_results ?? []).map((result: AnyRow) => [String(result.student_id), {
      score: result.score == null ? null : Number(result.score), resultText: String(result.result_text ?? ''),
      status: result.status === '결시' ? '결시' : '', notes: String(result.notes ?? ''),
    }])),
  }));
  return { sessionId: String(session.id), sessionNumber: Number(session.session_number), sessionDate,
    classKind: firstRelation<AnyRow>((session as AnyRow).class)?.class_kind === 'clinic' ? 'clinic' : 'regular',
    students, attendance, homeworks, tests };
}

export async function getSupabaseAllStudentOverviews(): Promise<StudentOverview[]> {
  const [students, enrollments, classRows] = await Promise.all([
    readAllRows((from, to) => getSupabase().from('students')
      .select('id,student_code,full_name').order('full_name').order('id').range(from, to)),
    readAllRows((from, to) => getSupabase().from('enrollments')
      .select('class_id,student_id,joined_on,ended_on,enrollment_status,transferred_to_class_id')
      .order('student_id').order('class_id').range(from, to)),
    readAllRows((from, to) => getSupabase().from('classes')
      .select('id,term_label,school,subject,weekdays,day_part,class_kind,is_active')
      .order('id').range(from, to)),
  ]);
  const classes = new Map((classRows)
    .filter((item: AnyRow) => item.is_active)
    .map((item: AnyRow) => [String(item.id), item]));
  const enrollmentsByStudent = new Map<string, AnyRow[]>();
  for (const item of enrollments) {
    if (!classes.has(String(item.class_id))) continue;
    const key = String(item.student_id);
    enrollmentsByStudent.set(key, [...(enrollmentsByStudent.get(key) ?? []), item]);
  }
  return (students).map((student: AnyRow) => ({
    id: String(student.id),
    studentCode: String(student.student_code),
    fullName: String(student.full_name),
    enrollments: (enrollmentsByStudent.get(String(student.id)) ?? []).map((item: AnyRow) => {
      const classItem = classes.get(String(item.class_id));
      const target = classes.get(String(item.transferred_to_class_id));
      return {
        classId: String(item.class_id),
        className: classItem ? formatClassLabel(classItem) : `수업 ${item.class_id}`,
        termLabel: String(classItem?.term_label ?? ''),
        status: (['transferred', 'withdrawn'].includes(item.enrollment_status) ? item.enrollment_status : 'active') as EnrollmentStatus,
        joinedOn: String(item.joined_on ?? ''),
        endedOn: String(item.ended_on ?? ''),
        transferredToClassName: target ? formatClassLabel(target) : '',
      };
    }).sort((a, b) => b.termLabel.localeCompare(a.termLabel) || a.className.localeCompare(b.className)),
  })).filter((student) => student.enrollments.length > 0)
    .sort((a, b) => koreanNameCollator.compare(a.fullName, b.fullName) || a.studentCode.localeCompare(b.studentCode));
}

export async function getSupabaseStudentRecordHistory(studentId: string): Promise<StudentRecordHistory> {
  if (!positiveId(studentId)) throw new Error('학생 ID가 올바르지 않습니다.');
  const [records, homeworkResults, testResults, participants] = await Promise.all([
    readAllRows((from, to) => getSupabase().from('student_session_records')
      .select('session_id,class_id,attendance_status,makeup_host_session_id').eq('student_id', studentId)
      .order('session_id').range(from, to)),
    readAllRows((from, to) => getSupabase().from('student_homework_results')
      .select('homework_id,class_id,grade').eq('student_id', studentId)
      .order('homework_id').range(from, to)),
    readAllRows((from, to) => getSupabase().from('student_test_results')
      .select('test_id,class_id,score,result_text,status').eq('student_id', studentId)
      .order('test_id').range(from, to)),
    readAllRows((from, to) => getSupabase().from('session_participants')
      .select('session_id,host_class_id,home_session_id,home_class_id,participation_type').eq('student_id', studentId)
      .order('session_id').range(from, to)),
  ]);
  const homeworkIds = (homeworkResults).map((item: AnyRow) => String(item.homework_id));
  const testIds = (testResults).map((item: AnyRow) => String(item.test_id));
  const [homeworkItemRows, testItemRows] = await Promise.all([
    readRowsByIds('session_homeworks', 'id,session_id,title', homeworkIds),
    readRowsByIds('session_tests', 'id,session_id,title,result_type', testIds),
  ]);
  const homeworkItems = new Map(homeworkItemRows.map((item: AnyRow) => [String(item.id), item]));
  const testItems = new Map(testItemRows.map((item: AnyRow) => [String(item.id), item]));
  const sessionIds = [...new Set([
    ...records.map((item: AnyRow) => String(item.session_id)),
    ...records.map((item: AnyRow) => String(item.makeup_host_session_id ?? '')).filter(Boolean),
    ...homeworkItemRows.map((item: AnyRow) => String(item.session_id)),
    ...testItemRows.map((item: AnyRow) => String(item.session_id)),
    ...(participants).flatMap((item: AnyRow) => [String(item.session_id), String(item.home_session_id ?? '')]).filter(Boolean),
  ])];
  const classIds = [...new Set([
    ...records.map((item: AnyRow) => String(item.class_id)),
    ...(homeworkResults).map((item: AnyRow) => String(item.class_id)),
    ...(testResults).map((item: AnyRow) => String(item.class_id)),
    ...(participants).flatMap((item: AnyRow) => [String(item.host_class_id), String(item.home_class_id)]),
  ])];
  if (sessionIds.length === 0) return { attendance: [], homeworks: [], tests: [] };
  const [sessionRows, classRows] = await Promise.all([
    readRowsByIds('class_sessions', 'id,class_id,session_number,session_date', sessionIds),
    readRowsByIds('classes', 'id,term_label,school,subject,weekdays,day_part,class_kind,is_active', classIds),
  ]);
  const sessions = new Map(sessionRows.map((item: AnyRow) => [String(item.id), item]));
  const classes = new Map(classRows.map((item: AnyRow) => [String(item.id), item]));
  const isActiveClass = (classId: unknown) => Boolean(classes.get(String(classId))?.is_active);
  const visibleParticipants = (participants).filter((item: AnyRow) => (
    isActiveClass(item.host_class_id) && isActiveClass(item.home_class_id)
  ));
  const participantByHostSession = new Map(visibleParticipants
    .map((item: AnyRow) => [String(item.session_id), item]));
  const participantByHomeSession = new Map(visibleParticipants
    .filter((item: AnyRow) => item.home_session_id != null)
    .map((item: AnyRow) => [String(item.home_session_id), item]));
  const className = (classId: unknown) => {
    const item = classes.get(String(classId));
    return item ? formatClassLabel(item) : `수업 ${classId}`;
  };
  const makeupRelation = (targetSessionId: unknown) => {
    const key = String(targetSessionId);
    const hostRelation = participantByHostSession.get(key);
    if (hostRelation) {
      const original = sessions.get(String(hostRelation.home_session_id));
      return {
        isMakeupVisit: true,
        makeupRelationLabel: hostRelation.participation_type === 'clinic'
          ? `클리닉 참여 · 소속 수업 ${className(hostRelation.home_class_id)}`
          : `${className(hostRelation.home_class_id)}${original ? ` ${original.session_number}차시` : ''} 보강으로 임시 참여`,
      };
    }
    const homeRelation = participantByHomeSession.get(key);
    if (homeRelation) {
      const host = sessions.get(String(homeRelation.session_id));
      return {
        isMakeupVisit: false,
        makeupRelationLabel: `다른 반 보강 → ${className(homeRelation.host_class_id)}${host ? ` ${host.session_number}차시 (${host.session_date})` : ''}`,
      };
    }
    return { isMakeupVisit: false, makeupRelationLabel: '' };
  };
  const base = (sessionId: unknown, classId: unknown) => {
    const session = sessions.get(String(sessionId));
    const classItem = classes.get(String(classId));
    return {
      sessionId: String(sessionId), sessionDate: String(session?.session_date ?? ''), sessionNumber: Number(session?.session_number ?? 0),
      className: classItem ? formatClassLabel(classItem) : `수업 ${classId}`,
      termLabel: String(classItem?.term_label ?? ''),
      ...makeupRelation(sessionId),
    };
  };
  const attendance = records.filter((item: AnyRow) => isActiveClass(item.class_id))
    .map((item: AnyRow): StudentAttendanceHistory => {
    return {
      ...base(item.session_id, item.class_id),
      status: (item.attendance_status ?? '') as AttendanceStatus | '',
    };
  });
  const homeworks = (homeworkResults).filter((item: AnyRow) => isActiveClass(item.class_id))
    .map((item: AnyRow): StudentHomeworkHistory => {
    const definition = homeworkItems.get(String(item.homework_id));
    return { ...base(definition?.session_id, item.class_id), title: String(definition?.title ?? ''), grade: item.grade as HomeworkGrade };
  });
  const tests = (testResults).filter((item: AnyRow) => isActiveClass(item.class_id))
    .map((item: AnyRow): StudentTestHistory => {
    const definition = testItems.get(String(item.test_id));
    return {
      ...base(definition?.session_id, item.class_id), title: String(definition?.title ?? ''),
      resultType: definition?.result_type === 'memo' ? 'memo' : 'score',
      score: item.score == null ? null : Number(item.score), resultText: String(item.result_text ?? ''),
      status: item.status === '결시' ? '결시' : '',
    };
  });
  const sortNewest = <T extends { sessionDate: string; sessionNumber: number }>(items: T[]) => items.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.sessionNumber - a.sessionNumber);
  return { attendance: sortNewest(attendance), homeworks: sortNewest(homeworks), tests: sortNewest(tests) };
}

export async function addSupabaseHomework(classId: string, sessionId: string, title: string, sortOrder: number): Promise<void> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('숙제 이름을 입력해 주세요.');
  const { error } = await getSupabase().from('session_homeworks').insert({ class_id: classId, session_id: sessionId, title: normalizedTitle, sort_order: sortOrder });
  if (error) throw error;
}

export async function updateSupabaseHomework(itemId: string, title: string): Promise<void> {
  if (!positiveId(itemId)) throw new Error('숙제 항목 ID가 올바르지 않습니다.');
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('숙제 이름을 입력해 주세요.');
  const { error } = await getSupabase().from('session_homeworks').update({ title: normalizedTitle }).eq('id', itemId);
  if (error) throw error;
}

export async function addSupabaseTest(classId: string, sessionId: string, title: string, resultType: 'score' | 'memo', maxScore: number | null, sortOrder: number): Promise<void> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('시험 이름을 입력해 주세요.');
  if (resultType === 'score' && (maxScore == null || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 999999.99 || Math.round(maxScore * 100) !== maxScore * 100)) {
    throw new Error('만점은 0보다 큰 숫자로 소수점 둘째 자리까지만 입력해 주세요.');
  }
  const { error } = await getSupabase().from('session_tests').insert({
    class_id: classId, session_id: sessionId, title: normalizedTitle,
    result_type: resultType, max_score: resultType === 'score' ? maxScore : null, sort_order: sortOrder,
  });
  if (error) throw error;
}

export async function updateSupabaseTest(itemId: string, title: string, resultType: 'score' | 'memo', maxScore: number | null): Promise<void> {
  if (!positiveId(itemId)) throw new Error('시험 항목 ID가 올바르지 않습니다.');
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('시험 이름을 입력해 주세요.');
  if (resultType === 'score' && (maxScore == null || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 999999.99 || Math.round(maxScore * 100) !== maxScore * 100)) {
    throw new Error('만점은 0보다 큰 숫자로 소수점 둘째 자리까지만 입력해 주세요.');
  }
  const { error } = await getSupabase().from('session_tests').update({
    title: normalizedTitle, result_type: resultType, max_score: resultType === 'score' ? maxScore : null,
  }).eq('id', itemId);
  if (error) throw error;
}

export async function deleteSupabaseSessionItem(
  classId: string,
  sessionId: string,
  kind: 'homework' | 'test',
  itemId: string,
): Promise<void> {
  if (![classId, sessionId, itemId].every(positiveId)) throw new Error('삭제 대상 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('delete_session_item', {
    target_class_id: classId,
    target_session_id: sessionId,
    target_item_kind: kind,
    target_item_id: itemId,
  });
  if (error) throw error;
}

export type StudentSessionDraft = {
  attendance?: { status: AttendanceStatus | ''; makeupDate?: string; makeupTime?: string; makeupNote?: string; notes?: string };
  homeworkResults: Array<{ homeworkId: string; grade: HomeworkGrade | ''; notes?: string }>;
  testResults: Array<{ testId: string; score: number | null; resultText?: string; status: '결시' | ''; notes?: string }>;
};

export async function saveSupabaseStudentSessionDraft(classId: string, sessionId: string, studentId: string, draft: StudentSessionDraft): Promise<void> {
  if (!positiveId(classId) || !positiveId(sessionId) || !positiveId(studentId)) throw new Error('저장 대상 ID가 올바르지 않습니다.');
  const makeup = draft.attendance?.status === '보강';
  if (makeup && draft.attendance?.makeupTime && !draft.attendance.makeupDate) throw new Error('보강 시간을 입력하려면 보강 날짜도 입력해 주세요.');
  const { error } = await getSupabase().rpc('save_student_session_draft', {
    target_class_id: classId,
    target_session_id: sessionId,
    target_student_id: studentId,
    attendance: draft.attendance ? {
      status: draft.attendance.status,
      makeup_date: makeup ? draft.attendance.makeupDate ?? '' : '',
      makeup_time: makeup ? draft.attendance.makeupTime ?? '' : '',
      makeup_note: makeup ? draft.attendance.makeupNote ?? '' : '',
      notes: draft.attendance.notes ?? '',
    } : null,
    homework_results: draft.homeworkResults.map((item) => ({ homework_id: item.homeworkId, grade: item.grade, notes: item.notes ?? '' })),
    test_results: draft.testResults.map((item) => ({
      test_id: item.testId, score: item.status === '결시' ? null : item.score,
      result_text: item.status === '결시' ? '' : item.resultText ?? '', status: item.status, notes: item.notes ?? '',
    })),
  });
  if (error) throw error;
}

export async function saveSupabaseSessionRosterDraft(
  classId: string,
  sessionId: string,
  drafts: Array<{ studentId: string; draft: StudentSessionDraft }>,
): Promise<void> {
  if (!positiveId(classId) || !positiveId(sessionId)) throw new Error('수업 또는 차시 ID가 올바르지 않습니다.');
  if (drafts.some((item) => !positiveId(item.studentId))) throw new Error('저장 대상 학생 ID가 올바르지 않습니다.');
  const { error } = await getSupabase().rpc('save_session_roster_draft', {
    target_class_id: classId,
    target_session_id: sessionId,
    student_drafts: drafts.map(({ studentId, draft }) => {
      const makeup = draft.attendance?.status === '보강';
      return {
        student_id: studentId,
        attendance: draft.attendance ? {
          status: draft.attendance.status,
          makeup_date: makeup ? draft.attendance.makeupDate ?? '' : '',
          makeup_time: makeup ? draft.attendance.makeupTime ?? '' : '',
          makeup_note: makeup ? draft.attendance.makeupNote ?? '' : '',
          notes: draft.attendance.notes ?? '',
        } : null,
        homework_results: draft.homeworkResults.map((item) => ({
          homework_id: item.homeworkId,
          grade: item.grade,
          notes: item.notes ?? '',
        })),
        test_results: draft.testResults.map((item) => ({
          test_id: item.testId,
          score: item.status === '결시' ? null : item.score,
          result_text: item.status === '결시' ? '' : item.resultText ?? '',
          status: item.status,
          notes: item.notes ?? '',
        })),
      };
    }),
  });
  if (error) throw error;
}
