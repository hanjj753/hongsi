import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppAccess } from '../contexts/AppAccessContext';
import {
  finishMyWorkShift, getClassWorkSummary, getOpenWorkLog, startMyWorkShift,
  type ClassWorkSummary, type WorkLog,
} from '../lib/staffData';

const pageSize = 50;

function koreanTime(value: string) {
  const local = new Date(Date.parse(value) + 9 * 3600000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function durationLabel(minutes: number | null) {
  if (minutes === null) return '근무 중';
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
}

export default function SupabaseClassWorkPanel({ classId }: { classId: string }) {
  const { access } = useAppAccess();
  const [open, setOpen] = useState<WorkLog | null>(null);
  const [history, setHistory] = useState<ClassWorkSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    if (!access?.staff_id) { setLoading(false); return; }
    setLoading(true);
    try {
      setError('');
      const current = await getOpenWorkLog(access.staff_id);
      setOpen(current);
      const rows = await getClassWorkSummary(classId, 0, pageSize);
      setHistory(rows);
      setHasMore(rows.length === pageSize);
    } catch (cause: any) { setError(cause?.message || '출퇴근 기록을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [access?.staff_id, classId]);
  useEffect(() => { void reload(); }, [reload]);

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      setError('');
      const rows = await getClassWorkSummary(classId, history.length, pageSize);
      setHistory((current) => [...current, ...rows]);
      setHasMore(rows.length === pageSize);
    } catch (cause: any) { setError(cause?.message || '이전 근무 기록을 불러오지 못했습니다.'); }
    finally { setLoadingMore(false); }
  }

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
    <View style={styles.topRow}>
      <Text style={styles.title}>출근 관리</Text>
      <Pressable accessibilityRole="button" onPress={() => void reload()}><Text style={styles.refresh}>새로고침</Text></Pressable>
    </View>
    {loading ? <ActivityIndicator color="#4F46E5" /> : <>
      <Text style={styles.description}>{open ? '현재 출근 중: ' + open.workLabel : '현재 출근 중인 수업이 없습니다.'}</Text>
      {open && <Text style={styles.startedAt}>근무 시작 시간: {koreanTime(open.startedAt).date} {koreanTime(open.startedAt).time}</Text>}
      {open && open.classId !== classId && <Text style={styles.description}>다른 수업에서 출근했습니다. 퇴근은 여기에서도 기록할 수 있습니다.</Text>}
      <Pressable disabled={busy} style={[styles.button, busy && styles.disabled]} onPress={() => void submit()}>
        <Text style={styles.buttonText}>{busy ? '처리 중...' : open ? '퇴근' : '출근'}</Text>
      </Pressable>

      <Text style={styles.tableTitle}>이 수업의 출근 기록</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.cell, styles.nameCell, styles.headerText]}>근무자</Text>
            <Text style={[styles.cell, styles.dateCell, styles.headerText]}>날짜</Text>
            <Text style={[styles.cell, styles.timeCell, styles.headerText]}>출근</Text>
            <Text style={[styles.cell, styles.timeCell, styles.headerText]}>퇴근</Text>
            <Text style={[styles.cell, styles.durationCell, styles.headerText]}>근무 시간</Text>
          </View>
          {history.length === 0 && <Text style={styles.empty}>아직 출근 기록이 없습니다.</Text>}
          {history.map((row) => <View key={row.id} style={styles.tableRow}>
            <Text style={[styles.cell, styles.nameCell]} numberOfLines={1}>{row.staffName}</Text>
            <Text style={[styles.cell, styles.dateCell]}>{row.workDate}</Text>
            <Text style={[styles.cell, styles.timeCell]}>{koreanTime(row.startedAt).time}</Text>
            <Text style={[styles.cell, styles.timeCell]}>{row.endedAt ? koreanTime(row.endedAt).time : '근무 중'}</Text>
            <Text style={[styles.cell, styles.durationCell]}>{durationLabel(row.durationMinutes)}</Text>
          </View>)}
        </View>
      </ScrollView>
      {hasMore && <Pressable disabled={loadingMore} onPress={() => void loadMore()} style={styles.moreButton}>
        <Text style={styles.refresh}>{loadingMore ? '불러오는 중...' : '이전 기록 더 보기'}</Text>
      </Pressable>}
    </>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    {!!notice && <Text style={styles.notice}>{notice}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 17, marginBottom: 14, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#111827', fontSize: 16, fontWeight: '800' },
  refresh: { color: '#4F46E5', fontWeight: '700', fontSize: 13 },
  description: { color: '#4B5563', marginTop: 10 },
  startedAt: { color: '#312E81', fontWeight: '700', marginTop: 6 },
  button: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: '#4F46E5', borderRadius: 9, paddingHorizontal: 24, paddingVertical: 11 },
  disabled: { opacity: 0.5 }, buttonText: { color: '#FFFFFF', fontWeight: '800' },
  tableTitle: { marginTop: 25, marginBottom: 10, fontWeight: '800', fontSize: 15, color: '#111827' },
  table: { minWidth: 600, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  tableHeader: { backgroundColor: '#F3F4F6' }, headerText: { fontWeight: '800', color: '#374151' },
  cell: { paddingHorizontal: 10, paddingVertical: 12, fontSize: 13, color: '#111827' },
  nameCell: { width: 130 }, dateCell: { width: 120 }, timeCell: { width: 100 }, durationCell: { width: 130 },
  empty: { padding: 14, color: '#6B7280' }, moreButton: { alignSelf: 'center', padding: 12 },
  error: { color: '#B91C1C', marginTop: 9 }, notice: { color: '#047857', marginTop: 9 },
});
