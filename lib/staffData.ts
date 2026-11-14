import { getSupabase } from './supabase';

export type StaffProfile = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  positions: string[];
  duties: string[];
  employmentStatus: 'active' | 'inactive';
  startedOn: string;
  notes: string;
  linked: boolean;
  bankAccount?: string;
  appRole?: 'assistant' | 'manager' | 'admin';
  accessStatus?: 'pending' | 'approved' | 'suspended';
};

export type StaffDraft = Pick<StaffProfile, 'fullName' | 'email' | 'phone' | 'positions' | 'duties' | 'employmentStatus' | 'startedOn' | 'notes'>;

export type WorkLog = {
  id: string;
  staffId: string;
  classId: string | null;
  workLabel: string;
  startedAt: string;
  endedAt: string | null;
  workDate: string;
  durationMinutes: number | null;
  hourlyRateKrw: number | null;
  notes: string;
};

export type ClassWorkSummary = {
  id: string;
  staffName: string;
  workDate: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function mapWorkLog(row: any): WorkLog {
  return {
    id: String(row.id), staffId: String(row.staff_id),
    classId: row.class_id == null ? null : String(row.class_id),
    workLabel: String(row.work_label), startedAt: String(row.started_at),
    endedAt: row.ended_at == null ? null : String(row.ended_at),
    workDate: String(row.work_date),
    durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
    hourlyRateKrw: row.hourly_rate_krw == null ? null : Number(row.hourly_rate_krw),
    notes: String(row.notes ?? ''),
  };
}

export async function getStaffDirectory(isAdmin: boolean, canViewBank: boolean): Promise<StaffProfile[]> {
  const [staffResult, accessResult, bankResult] = await Promise.all([
    getSupabase().from('staff').select('id,full_name,email,phone,positions,duties,employment_status,started_on,notes,firebase_uid').is('archived_at', null).order('full_name'),
    isAdmin ? getSupabase().from('app_access').select('staff_id,app_role,access_status') : Promise.resolve({ data: [], error: null }),
    canViewBank ? getSupabase().from('staff_private_details').select('staff_id,bank_account') : Promise.resolve({ data: [], error: null }),
  ]);
  const error = staffResult.error || accessResult.error || bankResult.error;
  if (error) throw error;
  const access = new Map((accessResult.data ?? []).map((row: any) => [String(row.staff_id), row]));
  const banks = new Map((bankResult.data ?? []).map((row: any) => [String(row.staff_id), row]));
  return (staffResult.data ?? []).map((row: any) => {
    const id = String(row.id);
    const account: any = access.get(id);
    const bank: any = banks.get(id);
    return {
      id, fullName: String(row.full_name), email: String(row.email), phone: String(row.phone ?? ''),
      positions: Array.isArray(row.positions) ? row.positions.map(String) : [],
      duties: Array.isArray(row.duties) ? row.duties.map(String) : [],
      employmentStatus: row.employment_status === 'inactive' ? 'inactive' : 'active',
      startedOn: String(row.started_on ?? ''), notes: String(row.notes ?? ''),
      linked: Boolean(row.firebase_uid),
      ...(canViewBank ? { bankAccount: String(bank?.bank_account ?? '') } : {}),
      ...(isAdmin ? {
        appRole: account?.app_role,
        accessStatus: account?.access_status,
      } : {}),
    };
  });
}

export async function saveStaffProfile(id: string | null, draft: StaffDraft, isAdmin: boolean): Promise<void> {
  const fullName = draft.fullName.trim();
  const email = draft.email.trim().toLowerCase();
  const phone = draft.phone.replace(/[\s()-]/g, '');
  const startedOn = draft.startedOn.trim();
  if (!fullName) throw new Error('이름을 입력해 주세요.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('이메일 형식을 확인해 주세요.');
  if (phone && !/^0\d{8,10}$/.test(phone)) throw new Error('전화번호 형식을 확인해 주세요.');
  if (startedOn && !isValidDate(startedOn)) throw new Error('근무 시작일은 YYYY-MM-DD 형식으로 입력해 주세요.');
  const payload = {
    full_name: fullName, email, phone: phone || null,
    positions: draft.positions, duties: draft.duties,
    started_on: startedOn || null, notes: draft.notes.trim() || null,
    ...(id ? (isAdmin ? { employment_status: draft.employmentStatus } : {}) : { employment_status: 'active' }),
  };
  const query = id
    ? getSupabase().from('staff').update(payload).eq('id', id).select('id').single()
    : getSupabase().from('staff').insert(payload);
  const { error } = await query;
  if (error) throw error;
}

export async function archiveStaffProfile(staffId: string): Promise<void> {
  const { error } = await getSupabase().rpc('archive_staff_profile', { target_staff_id: staffId });
  if (error) throw error;
}

export async function saveStaffBankAccount(staffId: string, bankAccount: string): Promise<void> {
  const { error } = await getSupabase().rpc('admin_save_staff_bank_account', {
    target_staff_id: staffId,
    target_bank_account: bankAccount,
  });
  if (error) throw error;
}

export async function getWorkLogs(staffId: string): Promise<WorkLog[]> {
  const result: WorkLog[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await getSupabase().from('work_logs')
      .select('id,staff_id,class_id,work_label,started_at,ended_at,work_date,duration_minutes,hourly_rate_krw,notes')
      .eq('staff_id', staffId).order('started_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    result.push(...(data ?? []).map(mapWorkLog));
    if ((data ?? []).length < pageSize) return result;
  }
}

export async function getOpenWorkLog(staffId: string): Promise<WorkLog | null> {
  const { data, error } = await getSupabase().from('work_logs')
    .select('id,staff_id,class_id,work_label,started_at,ended_at,work_date,duration_minutes,hourly_rate_krw,notes')
    .eq('staff_id', staffId).is('ended_at', null).maybeSingle();
  if (error) throw error;
  return data ? mapWorkLog(data) : null;
}

export async function getClassWorkLogForEdit(classId: string, logId: string): Promise<WorkLog> {
  const { data, error } = await getSupabase().from('work_logs')
    .select('id,staff_id,class_id,work_label,started_at,ended_at,work_date,duration_minutes,hourly_rate_krw,notes')
    .eq('class_id', classId).eq('id', logId).single();
  if (error) throw error;
  return mapWorkLog(data);
}

export async function getClassWorkSummary(classId: string, offset = 0, pageSize = 50): Promise<ClassWorkSummary[]> {
  const { data, error } = await getSupabase()
    .rpc('get_class_work_summary', { target_class_id: classId })
    .order('started_at', { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: String(row.work_log_id), staffName: String(row.staff_name), workDate: String(row.work_date),
    startedAt: String(row.started_at), endedAt: row.ended_at == null ? null : String(row.ended_at),
    durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
  }));
}

export async function startMyWorkShift(classId: string): Promise<void> {
  const { error } = await getSupabase().rpc('start_my_work_shift', { target_class_id: classId });
  if (error) throw error;
}

export async function finishMyWorkShift(): Promise<void> {
  const { error } = await getSupabase().rpc('finish_my_work_shift');
  if (error) throw error;
}

export type WorkLogDraft = {
  staffId: string;
  classId?: string;
  workLabel: string;
  date: string;
  startTime: string;
  endTime: string;
  hourlyRateKrw: string;
  notes: string;
};

function kstTimestamp(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

export async function saveManagedWorkLog(id: string | null, draft: WorkLogDraft): Promise<void> {
  const date = draft.date.trim();
  const start = draft.startTime.trim();
  const end = draft.endTime.trim();
  const label = draft.workLabel.trim();
  const rate = draft.hourlyRateKrw.trim();
  if (!draft.staffId.trim()) throw new Error('근무자를 선택해 주세요.');
  if (!isValidDate(date)) throw new Error('근무 날짜는 YYYY-MM-DD 형식으로 입력해 주세요.');
  if (!timePattern.test(start) || (end && !timePattern.test(end))) throw new Error('출퇴근 시간은 HH:MM 형식으로 입력해 주세요.');
  if (!label) throw new Error('수업 또는 근무명을 입력해 주세요.');
  if (rate && (!/^\d+$/.test(rate) || Number(rate) > 1000000)) throw new Error('시급은 0 이상의 정수로 입력해 주세요.');
  const endDate = end && end < start
    ? new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
    : date;
  const payload = {
    staff_id: draft.staffId, work_label: label,
    ...(draft.classId !== undefined ? { class_id: draft.classId } : {}),
    started_at: kstTimestamp(date, start), ended_at: end ? kstTimestamp(endDate, end) : null,
    hourly_rate_krw: rate ? Number(rate) : null, notes: draft.notes.trim() || null,
  };
  const query = id
    ? getSupabase().from('work_logs').update(payload).eq('id', id).select('id').single()
    : getSupabase().from('work_logs').insert(payload);
  const { error } = await query;
  if (error) throw error;
}

export async function deleteManagedWorkLog(id: string, classId?: string): Promise<void> {
  let query = getSupabase().from('work_logs').delete().eq('id', id);
  if (classId !== undefined) query = query.eq('class_id', classId);
  const { error } = await query.select('id').single();
  if (error) throw error;
}
