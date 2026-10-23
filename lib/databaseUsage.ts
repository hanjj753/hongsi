import { getSupabase } from './supabase';

export const SUPABASE_FREE_DATABASE_LIMIT_BYTES = 500 * 1024 * 1024;

export async function getDatabaseUsageBytes(): Promise<number> {
  const { data, error } = await getSupabase().rpc('get_database_usage_bytes');
  if (error) throw error;
  const bytes = Number(data);
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error('DB 사용량을 읽지 못했습니다.');
  return bytes;
}
