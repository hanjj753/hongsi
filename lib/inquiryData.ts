import { getSupabase } from './supabase';

export type Inquiry = {
  id: string;
  requesterStaffId: string;
  requesterName: string;
  content: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
};

export async function getInquiries(): Promise<Inquiry[]> {
  const rows: any[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await getSupabase().from('inquiries')
      .select('id,requester_staff_id,content,status,created_at,resolved_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }
  const { data: staff, error: staffError } = await getSupabase().from('staff').select('id,full_name');
  if (staffError) throw staffError;
  const names = new Map((staff ?? []).map((item: any) => [String(item.id), String(item.full_name)]));
  return rows.map((row) => ({
    id: String(row.id), requesterStaffId: String(row.requester_staff_id),
    requesterName: names.get(String(row.requester_staff_id)) ?? '이름 없음',
    content: String(row.content), status: row.status === 'resolved' ? 'resolved' : 'open',
    createdAt: String(row.created_at), resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
  }));
}

export async function createInquiry(staffId: string, content: string): Promise<void> {
  const clean = content.trim();
  if (!clean) throw new Error('문의 내용을 입력해 주세요.');
  const { error } = await getSupabase().from('inquiries').insert({ requester_staff_id: staffId, content: clean });
  if (error) throw error;
}

export async function resolveInquiry(id: string): Promise<void> {
  const { data, error } = await getSupabase().from('inquiries')
    .update({ status: 'resolved' }).eq('id', id).eq('status', 'open').select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('이미 해결됐거나 처리 권한이 없습니다.');
}
