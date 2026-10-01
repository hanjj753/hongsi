import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useAppAccess } from '../contexts/AppAccessContext';
import { getWorkLogs, type WorkLog } from '../lib/staffData';

export default function SupabaseHomeWorkSummary() {
  const { access } = useAppAccess();
  const [rows, setRows] = useState<WorkLog[]>([]);
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!access?.staff_id) return;
    try {
      setError('');
      const next = await getWorkLogs(access.staff_id);
      setRows(next);
      setMonth((current) => current && next.some((row) => row.workDate.startsWith(current)) ? current : next[0]?.workDate.slice(0, 7) ?? '');
    } catch (cause: any) { setError(cause?.message || '근무 기록을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [access?.staff_id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const months = useMemo(() => [...new Set(rows.map((row) => row.workDate.slice(0, 7)))].sort().reverse(), [rows]);
  const shown = rows.filter((row) => row.workDate.startsWith(month));
  const total = shown.reduce((sum, row) => sum + (row.durationMinutes ?? 0), 0);
  return <View style={styles.card}>
    <View style={styles.header}><Text style={styles.title}>내 근무 기록</Text><Pressable onPress={() => void load()}><Text style={styles.refresh}>새로고침</Text></Pressable></View>
    {loading ? <ActivityIndicator color="#4F46E5" /> : <>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {months.length === 0 ? <Text style={styles.empty}>근무 기록이 없습니다.</Text> : <>
        <View style={styles.picker}><Picker selectedValue={month} onValueChange={setMonth}>
          {months.map((value) => <Picker.Item key={value} label={value} value={value} />)}
        </Picker></View>
        <Text style={styles.summary}>총 {Math.floor(total / 60)}시간 {total % 60}분 · {shown.length}회</Text>
        {shown.map((row) => <View key={row.id} style={styles.log}>
          <Text style={styles.logTitle}>{row.workDate} · {row.workLabel}</Text>
          <Text style={styles.meta}>{row.endedAt ? String(row.durationMinutes ?? 0) + '분' : '근무 중'}</Text>
        </View>)}
      </>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginTop: 14, padding: 16, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#111827', fontSize: 16, fontWeight: '800' }, refresh: { color: '#4F46E5', fontWeight: '700', fontSize: 12 },
  picker: { marginTop: 12, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, overflow: 'hidden' },
  summary: { color: '#374151', fontWeight: '800', marginTop: 12, marginBottom: 5 },
  log: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  logTitle: { color: '#111827' }, meta: { color: '#6B7280', marginTop: 3, fontSize: 12 },
  empty: { color: '#6B7280', marginTop: 12 }, error: { color: '#B91C1C', marginTop: 12 },
});
