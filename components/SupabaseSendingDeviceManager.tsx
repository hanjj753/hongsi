import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getSendingDevices, resetSendingDevice, setSendingDeviceEnabled, type SendingDevice } from '../lib/messageData';

function confirmReset(action: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm('이 기기의 발송 허용과 등록 정보를 초기화할까요? 기기에서 다시 등록해야 합니다.')) action();
  } else Alert.alert('기기 등록 초기화', '발송 허용을 해제하고 기기에서 다시 등록하도록 할까요?', [
    { text: '취소', style: 'cancel' }, { text: '초기화', onPress: action },
  ]);
}

export default function SupabaseSendingDeviceManager() {
  const [devices, setDevices] = useState<SendingDevice[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const load = useCallback(async () => {
    try { setError(''); setDevices(await getSendingDevices()); }
    catch (cause: any) { setError(cause?.message || '발송 기기를 불러오지 못했습니다.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function change(item: SendingDevice, action: 'toggle' | 'reset') {
    setBusyId(item.id); setError('');
    try {
      if (action === 'reset') await resetSendingDevice(item.id);
      else await setSendingDeviceEnabled(item.id, !item.enabled);
      await load();
    } catch (cause: any) { setError(cause?.message || '기기 상태를 변경하지 못했습니다.'); }
    finally { setBusyId(''); }
  }

  return <View style={styles.card}>
    <View style={styles.row}><Text style={styles.title}>문자 발송 기기</Text>
      <Pressable onPress={() => void load()}><Text style={styles.actionText}>새로고침</Text></Pressable></View>
    <Text style={styles.description}>Android 앱에서 기기 등록을 요청한 뒤, 여기에서 허용해 주세요. 기기 ID만으로는 문자를 보낼 수 없습니다.</Text>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {devices.length === 0 && <Text style={styles.empty}>등록된 기기가 없습니다.</Text>}
    {devices.map((item) => <View key={item.id} style={styles.device}>
      <View style={styles.detail}><Text style={styles.name}>{item.label}</Text>
        <Text style={styles.meta}>Android ID: {item.androidId || '-'} · {item.enabled ? '발송 허용' : '승인 대기/차단'}</Text></View>
      <Pressable disabled={busyId === item.id} style={[styles.button, item.enabled && styles.disableButton]}
        onPress={() => void change(item, 'toggle')}><Text style={styles.buttonText}>{item.enabled ? '차단' : '허용'}</Text></Pressable>
      <Pressable disabled={busyId === item.id} style={styles.resetButton}
        onPress={() => confirmReset(() => void change(item, 'reset'))}><Text style={styles.actionText}>재등록</Text></Pressable>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginBottom: 18, padding: 16, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: '#111827' },
  description: { color: '#6B7280', marginTop: 8, marginBottom: 12, lineHeight: 20 },
  error: { color: '#B91C1C', marginBottom: 10 }, empty: { color: '#6B7280' },
  device: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: '#E5E7EB', paddingVertical: 11 },
  detail: { flex: 1, minWidth: 180 }, name: { color: '#111827', fontWeight: '800' },
  meta: { color: '#6B7280', marginTop: 4, fontSize: 12 },
  button: { backgroundColor: '#4F46E5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  disableButton: { backgroundColor: '#6B7280' }, buttonText: { color: '#FFFFFF', fontWeight: '800' },
  resetButton: { paddingHorizontal: 8, paddingVertical: 8 }, actionText: { color: '#4F46E5', fontWeight: '800' },
});
