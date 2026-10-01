import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppAccess } from '../contexts/AppAccessContext';
import { finishMyWorkShift, getOpenWorkLog, startMyWorkShift, type WorkLog } from '../lib/staffData';

export default function SupabaseClassWorkPanel({ classId }: { classId: string }) {
  const { access } = useAppAccess();
  const [open, setOpen] = useState<WorkLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    if (!access?.staff_id) return;
    try { setError(''); setOpen(await getOpenWorkLog(access.staff_id)); }
    catch (cause: any) { setError(cause?.message || '출퇴근 상태를 확인하지 못했습니다.'); }
    finally { setLoading(false); }
  }, [access?.staff_id]);
  useEffect(() => { void reload(); }, [reload]);

  async function submit() {
    setBusy(true); setError(''); setNotice('');
    try {
      if (open) { await finishMyWorkShift(); setNotice('퇴근을 기록했습니다.'); }
      else { await startMyWorkShift(classId); setNotice('출근을 기록했습니다.'); }
      await reload();
    } catch (cause: any) { setError(cause?.message || '출퇴근 기록에 실패했습니다.'); }
    finally { setBusy(false); }
  }

  return <View style={styles.card}>
    <View style={styles.row}><Text style={styles.title}>출근 관리</Text><Pressable onPress={() => void reload()}><Text style={styles.refresh}>새로고침</Text></Pressable></View>
    {loading ? <ActivityIndicator color="#4F46E5" /> : <>
      <Text style={styles.description}>{open ? '현재 출근 중: ' + open.workLabel : '현재 출근 중인 수업이 없습니다.'}</Text>
      {open && open.classId !== classId && <Text style={styles.description}>다른 수업에서 출근했습니다. 퇴근은 여기에서도 기록할 수 있습니다.</Text>}
      <Pressable disabled={busy} style={[styles.button, busy && { opacity: 0.5 }]} onPress={() => void submit()}><Text style={styles.buttonText}>{busy ? '처리 중...' : open ? '퇴근' : '출근'}</Text></Pressable>
    </>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    {!!notice && <Text style={styles.notice}>{notice}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 17, marginBottom: 14, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#111827', fontSize: 16, fontWeight: '800' }, refresh: { color: '#4F46E5', fontWeight: '700', fontSize: 12 },
  description: { color: '#4B5563', marginTop: 10 },
  button: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: '#4F46E5', borderRadius: 9, paddingHorizontal: 24, paddingVertical: 11 },
  buttonText: { color: '#FFFFFF', fontWeight: '800' }, error: { color: '#B91C1C', marginTop: 9 }, notice: { color: '#047857', marginTop: 9 },
});
