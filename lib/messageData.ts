import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { getSupabase } from './supabase';

const pairingKey = 'hongsi-sms-device-pairing-v1';

type DevicePairing = { deviceId: string; secret: string };
export type SendingDevice = { id: string; label: string; androidId: string; enabled: boolean; createdAt: string };
export type Delivery = { recipientType: 'parent' | 'student'; status: string; attemptCount: number; submittedAt: string | null; lastError: string | null };
export type QueuedMessage = { id: string; studentName: string; content: string; createdAt: string; deliveries: Delivery[] };
export type MessageDraft = { student_id: string; content: string; request_id: string };
export type ClaimedDelivery = { messageId: string; recipientType: 'parent' | 'student'; phone: string; content: string };

export async function getLocalDevicePairing(): Promise<DevicePairing | null> {
  if (Platform.OS !== 'android') return null;
  const stored = await SecureStore.getItemAsync(pairingKey);
  if (!stored) return null;
  try {
    const item = JSON.parse(stored);
    return typeof item.deviceId === 'string' && typeof item.secret === 'string' ? item : null;
  } catch { return null; }
}

export async function registerThisSendingDevice(label: string): Promise<DevicePairing> {
  if (Platform.OS !== 'android') throw new Error('문자 발송 기기는 Android 앱에서 등록해 주세요.');
  const androidId = Application.getAndroidId();
  if (!androidId) throw new Error('Android 기기 ID를 읽을 수 없습니다.');
  if (!label.trim()) throw new Error('기기 이름을 입력해 주세요.');
  const { data, error } = await getSupabase().rpc('register_sending_device', {
    device_label: label.trim(), android_identifier: androidId,
  });
  if (error) throw error;
  const pairing = { deviceId: String(data.device_id), secret: String(data.secret) };
  await SecureStore.setItemAsync(pairingKey, JSON.stringify(pairing));
  return pairing;
}

export async function getThisSendingDeviceState(): Promise<{ id: string; label: string; enabled: boolean } | null> {
  const pairing = await getLocalDevicePairing();
  if (!pairing) return null;
  const { data, error } = await getSupabase().rpc('get_sending_device_state', {
    target_device_id: pairing.deviceId, device_secret: pairing.secret,
  });
  if (error) throw error;
  return { id: String(data.device_id), label: String(data.label), enabled: Boolean(data.is_enabled) };
}

export async function getSendingDevices(): Promise<SendingDevice[]> {
  const { data, error } = await getSupabase().from('sending_devices')
    .select('id,label,legacy_device_id,is_enabled,created_at').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: String(row.id), label: String(row.label), androidId: String(row.legacy_device_id ?? ''),
    enabled: Boolean(row.is_enabled), createdAt: String(row.created_at),
  }));
}

export async function setSendingDeviceEnabled(id: string, enabled: boolean): Promise<void> {
  const { data, error } = await getSupabase().from('sending_devices')
    .update({ is_enabled: enabled }).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('기기를 변경할 권한이 없거나 찾을 수 없습니다.');
}

export async function resetSendingDevice(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('reset_sending_device', { target_device_id: id });
  if (error) throw error;
}

export async function queueClassMessages(classId: string, sessionId: string | null, items: MessageDraft[]): Promise<number> {
  if (!items.length) throw new Error('메시지 대상이 없습니다.');
  let created = 0;
  for (let index = 0; index < items.length; index += 100) {
    const { data, error } = await getSupabase().rpc('create_class_messages', {
      target_class_id: classId, target_session_id: sessionId, message_items: items.slice(index, index + 100),
    });
    if (error) throw error;
    created += Number(data?.created ?? 0);
  }
  return created;
}

export async function getClassMessageQueue(classId: string): Promise<QueuedMessage[]> {
  const { data, error } = await getSupabase().from('messages')
    .select('id,student_name_snapshot,content,created_at,message_deliveries(recipient_type,status,attempt_count,submitted_at,last_error)')
    .eq('class_id', classId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: String(row.id), studentName: String(row.student_name_snapshot), content: String(row.content),
    createdAt: String(row.created_at),
    deliveries: (row.message_deliveries ?? []).map((delivery: any) => ({
      recipientType: delivery.recipient_type, status: String(delivery.status),
      attemptCount: Number(delivery.attempt_count),
      submittedAt: delivery.submitted_at == null ? null : String(delivery.submitted_at),
      lastError: delivery.last_error == null ? null : String(delivery.last_error),
    })),
  }));
}

export async function getClassPendingDeliveryCount(classId: string): Promise<number> {
  const { count, error } = await getSupabase().from('message_deliveries')
    .select('message_id,message:messages!inner(class_id)', { count: 'exact', head: true })
    .eq('status', 'pending').eq('message.class_id', classId);
  if (error) throw error;
  return count ?? 0;
}

export async function claimNextMessageDelivery(classId: string, pairing: DevicePairing): Promise<ClaimedDelivery | null> {
  const { data, error } = await getSupabase().rpc('claim_next_message_delivery', {
    target_class_id: classId, target_device_id: pairing.deviceId, device_secret: pairing.secret,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return { messageId: String(row.message_id), recipientType: row.recipient_type,
    phone: String(row.phone), content: String(row.content) };
}

export async function finishMessageDelivery(item: ClaimedDelivery, pairing: DevicePairing,
  result: 'submitted' | 'failed', errorMessage?: string): Promise<void> {
  const { error } = await getSupabase().rpc('finish_message_delivery', {
    target_message_id: item.messageId, target_recipient_type: item.recipientType,
    target_device_id: pairing.deviceId, device_secret: pairing.secret,
    delivery_result: result, error_message: errorMessage ?? null,
  });
  if (error) throw error;
}

export async function cancelPendingClassMessages(classId: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('cancel_pending_class_messages', { target_class_id: classId });
  if (error) throw error;
  return Number(data ?? 0);
}

