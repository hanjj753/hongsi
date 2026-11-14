import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Picker } from './ReadablePicker';
import { getSupabaseActiveStaff, type AssignableStaff } from '../lib/classData';
import { useAppAccess } from '../contexts/AppAccessContext';
import {
  deleteManagedWorkLog, finishMyWorkShift, getClassWorkLogForEdit, getClassWorkSummary, getOpenWorkLog, saveManagedWorkLog, startMyWorkShift,
  type ClassWorkSummary, type WorkLog, type WorkLogDraft,
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

export default function SupabaseClassWorkPanel({ classId, classLabel, defaultHourlyRateKrw }: {
  classId: string; classLabel: string; defaultHourlyRateKrw: string;
}) {
  const { access } = useAppAccess();
  const canDeleteWork = access?.app_role === 'admin' || access?.app_role === 'manager';
  const [open, setOpen] = useState<WorkLog | null>(null);
  const [history, setHistory] = useState<ClassWorkSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formVisible, setFormVisible] = useState(false);
  const [editingWork, setEditingWork] = useState<WorkLog | null>(null);
  const [editingStaffName, setEditingStaffName] = useState('');
  const [staff, setStaff] = useState<AssignableStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [draft, setDraft] = useState<WorkLogDraft>({
    staffId: '', classId, workLabel: classLabel, date: '', startTime: '', endTime: '',
    hourlyRateKrw: defaultHourlyRateKrw, notes: '',
  });

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

  async function openManualForm() {
    setError(''); setNotice(''); setStaffLoading(true);
    setEditingWork(null); setEditingStaffName('');
    const now = koreanTime(new Date().toISOString());
    setDraft({ staffId: '', classId, workLabel: classLabel, date: now.date,
      startTime: now.time, endTime: '', hourlyRateKrw: defaultHourlyRateKrw, notes: '' });
    setFormVisible(true);
    try { setStaff(await getSupabaseActiveStaff()); }
    catch (cause: any) { setError(cause?.message || '근무자 목록을 불러오지 못했습니다.'); }
    finally { setStaffLoading(false); }
  }

  async function openEditForm(row: ClassWorkSummary) {
    setError(''); setNotice(''); setStaffLoading(false); setBusy(true);
    try {
      const log = await getClassWorkLogForEdit(classId, row.id);
      const start = koreanTime(log.startedAt);
      setEditingWork(log);
      setEditingStaffName(row.staffName);
      setDraft({ staffId: log.staffId, classId, workLabel: log.workLabel,
        date: start.date, startTime: start.time,
        endTime: log.endedAt ? koreanTime(log.endedAt).time : '',
        hourlyRateKrw: log.hourlyRateKrw == null ? '' : String(log.hourlyRateKrw),
        notes: log.notes });
      setFormVisible(true);
    } catch (cause: any) { setError(cause?.message || '수정할 근무 기록을 불러오지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function saveManualWork() {
    setBusy(true); setError(''); setNotice('');
    try {
      await saveManagedWorkLog(editingWork?.id ?? null, draft);
      setFormVisible(false);
      await reload();
      setNotice(editingWork ? '근무 기록을 수정했습니다.' : draft.endTime.trim() ? '근무 기록을 추가했습니다.' : '출근 중인 기록을 추가했습니다.');
    } catch (cause: any) {
      const message = String(cause?.message || '근무 기록을 저장하지 못했습니다.');
      setError(!editingWork && cause?.code === '23505' && !draft.endTime.trim()
        ? '이 근무자는 이미 출근 중입니다. 기존 출근 기록을 확인해 주세요.' : message);
    } finally { setBusy(false); }
  }

  function deleteWork(row: ClassWorkSummary) {
    if (!canDeleteWork || busy) return;
    const message = `${row.staffName} · ${row.workDate} · ${koreanTime(row.startedAt).time} 출근 기록을 삭제할까요?${row.endedAt ? '' : '\n현재 근무 중인 기록입니다. 삭제하면 해당 출근 상태도 해제됩니다.'}`;
    const remove = async () => {
      setBusy(true); setError(''); setNotice('');
      try {
        await deleteManagedWorkLog(row.id, classId);
        await reload();
        setNotice('근무 기록을 삭제했습니다.');
      } catch (cause: any) { setError(cause?.message || '근무 기록을 삭제하지 못했습니다.'); }
      finally { setBusy(false); }
    };
    if (Platform.OS === 'web') { if (window.confirm(message)) void remove(); }
    else Alert.alert('근무 기록 삭제', message, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => void remove() }]);
  }

  return <View style={styles.card}>
    <View style={styles.topRow}>
      <Text style={styles.title}>출근 관리</Text>
      <View style={styles.headerActions}>
        {access?.app_role === 'admin' && <Pressable accessibilityRole="button" onPress={() => void openManualForm()}><Text style={styles.refresh}>+ 기록 추가</Text></Pressable>}
        <Pressable accessibilityRole="button" onPress={() => void reload()}><Text style={styles.refresh}>새로고침</Text></Pressable>
      </View>
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
            {canDeleteWork && <Text style={[styles.cell, styles.actionCell, styles.headerText]}>관리</Text>}
          </View>
          {history.length === 0 && <Text style={styles.empty}>아직 출근 기록이 없습니다.</Text>}
          {history.map((row) => <View key={row.id} style={styles.tableRow}>
            <Text style={[styles.cell, styles.nameCell]} numberOfLines={1}>{row.staffName}</Text>
            <Text style={[styles.cell, styles.dateCell]}>{row.workDate}</Text>
            <Text style={[styles.cell, styles.timeCell]}>{koreanTime(row.startedAt).time}</Text>
            <Text style={[styles.cell, styles.timeCell]}>{row.endedAt ? koreanTime(row.endedAt).time : '근무 중'}</Text>
            <Text style={[styles.cell, styles.durationCell]}>{durationLabel(row.durationMinutes)}</Text>
            {canDeleteWork && <View style={styles.actionCell}>
              {access?.app_role === 'admin' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void openEditForm(row)}><Text style={[styles.refresh, busy && styles.disabled]}>수정</Text></Pressable>}
              <Pressable accessibilityRole="button" accessibilityLabel={`${row.staffName} ${row.workDate} 근무 기록 삭제`} disabled={busy} onPress={() => deleteWork(row)}><Text style={[styles.deleteText, busy && styles.disabled]}>삭제</Text></Pressable>
            </View>}
          </View>)}
        </View>
      </ScrollView>
      {hasMore && <Pressable disabled={loadingMore} onPress={() => void loadMore()} style={styles.moreButton}>
        <Text style={styles.refresh}>{loadingMore ? '불러오는 중...' : '이전 기록 더 보기'}</Text>
      </Pressable>}
    </>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    {!!notice && <Text style={styles.notice}>{notice}</Text>}

    <Modal visible={formVisible} transparent animationType="fade" onRequestClose={() => setFormVisible(false)}>
      <View style={styles.overlay}><View style={styles.formModal}>
        <Text style={styles.formTitle}>{editingWork ? '이 수업의 근무 기록 수정' : '이 수업의 근무 기록 추가'}</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>근무자</Text>
          {editingWork ? <Text style={styles.readonlyStaff}>{editingStaffName}</Text> : staffLoading ? <ActivityIndicator color="#4F46E5" /> :
            <View style={styles.pickerFrame}><Picker selectedValue={draft.staffId} onValueChange={(staffId) => setDraft((current) => ({ ...current, staffId: String(staffId) }))}>
              <Picker.Item label="근무자 선택" value="" />
              {staff.map((item) => <Picker.Item key={item.id} label={item.fullName} value={item.id} />)}
            </Picker></View>}
          <Text style={styles.fieldLabel}>수업 / 근무명</Text>
          <TextInput style={styles.input} value={draft.workLabel} onChangeText={(workLabel) => setDraft((current) => ({ ...current, workLabel }))} placeholder="수업 또는 근무명" />
          <Text style={styles.fieldLabel}>날짜</Text>
          <TextInput style={styles.input} value={draft.date} onChangeText={(date) => setDraft((current) => ({ ...current, date }))} placeholder="YYYY-MM-DD" />
          <View style={styles.timeFields}>
            <View style={styles.timeField}><Text style={styles.fieldLabel}>출근 시간</Text><TextInput style={styles.input} value={draft.startTime} onChangeText={(startTime) => setDraft((current) => ({ ...current, startTime }))} placeholder="HH:MM" /></View>
            <View style={styles.timeField}><Text style={styles.fieldLabel}>퇴근 시간 (선택)</Text><TextInput style={styles.input} value={draft.endTime} onChangeText={(endTime) => setDraft((current) => ({ ...current, endTime }))} placeholder="비우면 근무 중" /></View>
          </View>
          <Text style={styles.formHelp}>퇴근 시간을 비워 저장하면 출근 중 상태가 됩니다. 이 화면이나 조교 탭에서 나중에 퇴근 시간을 입력할 수 있습니다.</Text>
          <Text style={styles.fieldLabel}>당시 시급 (원, 선택)</Text>
          <TextInput style={styles.input} value={draft.hourlyRateKrw} onChangeText={(hourlyRateKrw) => setDraft((current) => ({ ...current, hourlyRateKrw }))} keyboardType="numeric" placeholder="시급" />
          <Text style={styles.fieldLabel}>비고</Text>
          <TextInput style={styles.input} value={draft.notes} onChangeText={(notes) => setDraft((current) => ({ ...current, notes }))} placeholder="선택 입력" />
        </ScrollView>
        <View style={styles.formActions}>
          <Pressable style={styles.secondaryButton} onPress={() => setFormVisible(false)}><Text style={styles.secondaryText}>취소</Text></Pressable>
          <Pressable disabled={busy || staffLoading} style={[styles.button, (busy || staffLoading) && styles.disabled]} onPress={() => void saveManualWork()}><Text style={styles.buttonText}>{busy ? '저장 중...' : editingWork ? '변경 저장' : '기록 추가'}</Text></Pressable>
        </View>
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 17, marginBottom: 14, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  title: { color: '#111827', fontSize: 16, fontWeight: '800' },
  refresh: { color: '#4F46E5', fontWeight: '700', fontSize: 13 },
  description: { color: '#4B5563', marginTop: 10 },
  startedAt: { color: '#312E81', fontWeight: '700', marginTop: 6 },
  button: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: '#4F46E5', borderRadius: 9, paddingHorizontal: 24, paddingVertical: 11 },
  disabled: { opacity: 0.5 }, buttonText: { color: '#FFFFFF', fontWeight: '800' },
  tableTitle: { marginTop: 25, marginBottom: 10, fontWeight: '800', fontSize: 15, color: '#111827' },
  table: { minWidth: 680, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  tableHeader: { backgroundColor: '#F3F4F6' }, headerText: { fontWeight: '800', color: '#374151' },
  cell: { paddingHorizontal: 10, paddingVertical: 12, fontSize: 13, color: '#111827' },
  nameCell: { width: 130 }, dateCell: { width: 120 }, timeCell: { width: 100 }, durationCell: { width: 130 },
  actionCell: { width: 130, paddingHorizontal: 10, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 18 },
  deleteText: { color: '#DC2626', fontWeight: '700', fontSize: 13 },
  empty: { padding: 14, color: '#6B7280' }, moreButton: { alignSelf: 'center', padding: 12 },
  error: { color: '#B91C1C', marginTop: 9 }, notice: { color: '#047857', marginTop: 9 },
  overlay: { flex: 1, backgroundColor: '#0007', justifyContent: 'center', alignItems: 'center', padding: 12 },
  formModal: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 18, width: '100%', maxWidth: 520, maxHeight: '90%' },
  formTitle: { color: '#111827', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  fieldLabel: { color: '#374151', fontWeight: '700', fontSize: 13, marginTop: 12, marginBottom: 5 },
  pickerFrame: { borderColor: '#D1D5DB', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  readonlyStaff: { color: '#111827', fontWeight: '700', paddingVertical: 10 },
  input: { minHeight: 44, borderColor: '#D1D5DB', borderWidth: 1, borderRadius: 8, paddingHorizontal: 11, color: '#111827' },
  timeFields: { flexDirection: 'row', gap: 10 }, timeField: { flex: 1 },
  formHelp: { color: '#6B7280', fontSize: 12, lineHeight: 18, marginTop: 10 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 18 },
  secondaryButton: { paddingHorizontal: 18, paddingVertical: 11 }, secondaryText: { color: '#374151', fontWeight: '700' },
});
