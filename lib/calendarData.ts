import { formatClassLabel, getSupabaseClassCatalog } from './classData';
import { getSupabase } from './supabase';

export type CalendarClass = { id: string; name: string; day: string; quarter: string };
export type CalendarClassEvent = {
  id: string; classId: string; quarter: string; title: string; date: string;
  start: string; end: string; allDay: boolean; location: string;
  workers: string; description: string;
};

async function readSessions(): Promise<any[]> {
  const result: any[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await getSupabase().from('class_sessions')
      .select('id,class_id,session_number,session_date,start_time,end_time,location_id,notes,session_staff(staff_id)')
      .order('session_date', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    result.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return result;
  }
}

export async function getSupabaseCalendarWorkspace(): Promise<{
  classes: CalendarClass[]; events: CalendarClassEvent[]; assistants: string[];
}> {
  const [catalog, sessions, staffResult] = await Promise.all([
    getSupabaseClassCatalog(), readSessions(),
    getSupabase().from('staff').select('id,full_name,positions,employment_status'),
  ]);
  if (staffResult.error) throw staffResult.error;
  const staff = new Map((staffResult.data ?? []).map((row: any) => [String(row.id), String(row.full_name)]));
  const assistants = (staffResult.data ?? []).filter((row: any) =>
    row.employment_status === 'active' && !row.positions?.includes('CEO') && !row.positions?.includes('실장'))
    .map((row: any) => String(row.full_name)).sort((a: string, b: string) => a.localeCompare(b, 'ko'));
  const activeClasses = catalog.classes.filter((item) => item.isActive);
  const byId = new Map(activeClasses.map((item) => [item.id, item]));
  const places = new Map(catalog.locations.map((item) => [item.id, item.name]));
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const classes = activeClasses.map((item) => ({
    id: item.id, name: formatClassLabel(item), day: item.weekdays.map((day) => weekdays[day]).join('·'), quarter: item.termLabel,
  }));
  const events: CalendarClassEvent[] = [];
  for (const row of sessions) {
    const item = byId.get(String(row.class_id));
    if (!item) continue;
    const date = String(row.session_date);
    const startHm = String(row.start_time ?? item.startTime ?? '').slice(0, 5);
    const endHm = String(row.end_time ?? item.endTime ?? '').slice(0, 5);
    const allDay = !startHm || !endHm;
    const workerIds = (row.session_staff ?? []).map((link: any) => String(link.staff_id));
    const workerNames = (workerIds.length ? workerIds : item.staffIds).map((id: string) => staff.get(id)).filter(Boolean) as string[];
    const location = places.get(String(row.location_id ?? item.locationId)) ?? '';
    const note = String(row.notes ?? '').trim();
    events.push({
      id: `session-${row.id}`, classId: item.id, quarter: item.termLabel,
      title: `${formatClassLabel(item)} (${row.session_number}차시)`, date,
      start: new Date(`${date}T${allDay ? '00:00' : startHm}:00+09:00`).toISOString(),
      end: new Date(`${date}T${allDay ? '23:59' : endHm}:00+09:00`).toISOString(),
      allDay, location: [note, location && `장소: ${location}`].filter(Boolean).join(' / '),
      workers: workerNames.join(', '), description: `예정 근무자: ${workerNames.join(', ') || '-'}`,
    });
  }
  return { classes, events, assistants };
}
