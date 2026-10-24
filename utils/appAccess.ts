import { getSupabase } from '../lib/supabase';

export type AppRole = 'assistant' | 'manager' | 'admin';
export type AccessStatus = 'pending' | 'approved' | 'suspended';
export type AppAccess = {
  staff_id: string;
  full_name: string;
  app_role: AppRole | null;
  access_status: AccessStatus;
  employment_status: 'active' | 'inactive';
  can_manage_devices: boolean;
  can_manage_accounts: boolean;
};

/** Links a verified Firebase user only when its email is in the active staff directory. */
export async function getMyAppAccess(): Promise<AppAccess | null> {
  const { data: initial, error: initialError } = await getSupabase().rpc('get_my_access');
  if (initialError) throw initialError;
  // A verified Firebase email can claim only its pre-registered staff row.
  const { data, error } = initial === null
    ? await getSupabase().rpc('link_my_staff_account')
    : { data: initial, error: null };
  if (error) throw error;
  if (data === null) return null;
  if (typeof data !== 'object' || typeof data.staff_id !== 'string'
    || typeof data.full_name !== 'string'
    || ![null, 'assistant', 'manager', 'admin'].includes(data.app_role)
    || !['pending', 'approved', 'suspended'].includes(data.access_status)
    || !['active', 'inactive'].includes(data.employment_status)
    || typeof data.can_manage_devices !== 'boolean' || typeof data.can_manage_accounts !== 'boolean') {
    throw new Error('계정 권한 응답을 확인할 수 없습니다.');
  }
  return data as AppAccess;
}

export function isApprovedAccess(access: AppAccess | null): boolean {
  return Boolean(access?.app_role && access.access_status === 'approved' && access.employment_status === 'active');
}

export async function setAccountAccess(staffId: string, role: AppRole): Promise<void> {
  // The DB RPC checks the calling user's role and rejects self-modification.
  const { error } = await getSupabase().rpc('admin_set_access', {
    target_staff_id: staffId, new_role: role, new_status: 'approved',
  });
  if (error) throw error;
}
