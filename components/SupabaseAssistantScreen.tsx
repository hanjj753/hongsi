import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Picker } from './ReadablePicker';
import SupabaseSendingDeviceManager from './SupabaseSendingDeviceManager';
import { useAppAccess } from '../contexts/AppAccessContext';
import { setAccountAccess, type AppRole } from '../utils/appAccess';
import {
  archiveStaffProfile, deleteManagedWorkLog, getStaffDirectory, getWorkLogs, saveManagedWorkLog,
  saveStaffBankAccount, saveStaffProfile, type StaffDraft, type StaffProfile,
  type WorkLog, type WorkLogDraft,
} from '../lib/staffData';

const blankStaff: StaffDraft = {
  fullName: '', email: '', phone: '', positions: ['조교'], duties: ['현장'],
  employmentStatus: 'active', startedOn: '', notes: '',
};
const blankWork = (staffId: string): WorkLogDraft => ({
  staffId, workLabel: '', date: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
  startTime: '', endTime: '', hourlyRateKrw: '', notes: '',
});
const roleLabels = { assistant: '조교', manager: '매니저', admin: '관리자' };

function positionRank(item: StaffProfile): number {
  if (item.positions.includes('CEO')) return 0;
  if (item.positions.includes('실장')) return 1;
  if (item.positions.includes('조교')) return 2;
  return 3;
}

function timeInKorea(value: string) {
  const date = new Date(Date.parse(value) + 9 * 3600000).toISOString();
  return { day: date.slice(0, 10), hm: date.slice(11, 16) };
}

function Field({ label, value, onChange, placeholder, keyboardType, editable = true }: {
  label: string; value: string; onChange: (value: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  editable?: boolean;
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput style={styles.input} value={value} onChangeText={onChange} editable={editable}
      placeholder={placeholder} placeholderTextColor="#9CA3AF"
      keyboardType={keyboardType} autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'} />
  </View>;
}

function Button({ label, onPress, primary = false, danger = false, disabled = false }: {
  label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean;
}) {
  return <Pressable disabled={disabled} style={[styles.button, primary && styles.primary, danger && styles.dangerButton, disabled && styles.disabled]} onPress={onPress}>
    <Text style={[styles.buttonText, primary && styles.primaryText, danger && styles.dangerButtonText]}>{label}</Text>
  </Pressable>;
}

export default function SupabaseAssistantScreen() {
  const { access } = useAppAccess();
  const isAdmin = access?.app_role === 'admin';
  const canManage = isAdmin || access?.app_role === 'manager';
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingStaff, setEditingStaff] = useState<StaffProfile | null>(null);
  const [staffDraft, setStaffDraft] = useState<StaffDraft>({ ...blankStaff });
  const [staffModal, setStaffModal] = useState(false);
  const [bankTarget, setBankTarget] = useState<StaffProfile | null>(null);
  const [bankDraft, setBankDraft] = useState('');
  const [accessTarget, setAccessTarget] = useState<StaffProfile | null>(null);
  const [roleDraft, setRoleDraft] = useState<AppRole>('assistant');
  const [workTarget, setWorkTarget] = useState<StaffProfile | null>(null);
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [workMonth, setWorkMonth] = useState('');
  const [workLoading, setWorkLoading] = useState(false);
  const [editingWork, setEditingWork] = useState<WorkLog | null>(null);
  const [workDraft, setWorkDraft] = useState<WorkLogDraft>(blankWork(''));
  const [workForm, setWorkForm] = useState(false);
  const [permissionInfoVisible, setPermissionInfoVisible] = useState(false);
  const [showField, setShowField] = useState(true);
  const [showMaterial, setShowMaterial] = useState(true);

  const load = useCallback(async () => {
    try { setError(''); setStaff(await getStaffDirectory(Boolean(isAdmin), Boolean(canManage))); }
    catch (cause: any) { setError(cause?.message || '조교 정보를 불러오지 못했습니다.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [isAdmin, canManage]);
  useEffect(() => { void load(); }, [load]);

  const ordered = useMemo(() => staff.filter((item) => positionRank(item) < 2 || item.duties.length === 0
    || (showField && item.duties.includes('현장')) || (showMaterial && item.duties.includes('자료'))).sort((a, b) =>
    positionRank(a) - positionRank(b)
    || Number(a.employmentStatus === 'inactive') - Number(b.employmentStatus === 'inactive')
    || a.fullName.localeCompare(b.fullName, 'ko')), [staff, showField, showMaterial]);
  const months = useMemo(() => [...new Set(workLogs.map((log) => log.workDate.slice(0, 7)))].sort().reverse(), [workLogs]);
  const monthLogs = workLogs.filter((log) => log.workDate.startsWith(workMonth));
  const totalMinutes = monthLogs.reduce((sum, log) => sum + (log.durationMinutes ?? 0), 0);

  function openStaffForm(item: StaffProfile | null) {
    if (!canManage) return;
    setError(''); setEditingStaff(item);
    setStaffDraft(item ? {
      fullName: item.fullName, email: item.email, phone: item.phone,
      positions: [...item.positions], duties: [...item.duties],
      employmentStatus: item.employmentStatus, startedOn: item.startedOn, notes: item.notes,
    } : { ...blankStaff, positions: [...blankStaff.positions], duties: [...blankStaff.duties] });
    setStaffModal(true);
  }

  async function saveStaff() {
    setBusy(true); setError(''); setNotice('');
    try {
      await saveStaffProfile(editingStaff?.id ?? null, staffDraft, Boolean(isAdmin));
      setStaffModal(false);
      await load();
      setNotice(editingStaff ? '조교 정보를 수정했습니다.' : '조교를 추가했습니다. 등록한 이메일로 바로 로그인할 수 있습니다.');
    } catch (cause: any) { setError(cause?.message || '조교 정보를 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  function archiveStaff(item: StaffProfile) {
    if (!isAdmin || item.id === access?.staff_id || busy) return;
    const message = `${item.fullName} 조교를 목록에서 삭제하고 앱 접근을 중지할까요? 근무·수업·문자 이력은 보존됩니다.`;
    const remove = () => { void (async () => {
      setBusy(true); setError(''); setNotice('');
      try {
        await archiveStaffProfile(item.id);
        await load();
        setNotice(`${item.fullName} 조교를 목록에서 삭제했습니다. 기존 이력은 보존됩니다.`);
      } catch (cause: any) { setError(cause?.message || '조교를 삭제하지 못했습니다.'); }
      finally { setBusy(false); }
    })(); };
    if (Platform.OS === 'web') { if (window.confirm(message)) remove(); }
    else Alert.alert('조교 삭제', message, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: remove }]);
  }

  async function saveBank() {
    if (!bankTarget || !isAdmin) return;
    setBusy(true); setError('');
    try {
      await saveStaffBankAccount(bankTarget.id, bankDraft);
      setBankTarget(null); await load(); setNotice('계좌 정보를 저장했습니다.');
    } catch (cause: any) { setError(cause?.message || '계좌 정보를 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function saveAccess() {
    if (!accessTarget || !isAdmin) return;
    setBusy(true); setError('');
    try {
      await setAccountAccess(accessTarget.id, roleDraft);
      setAccessTarget(null); await load(); setNotice('앱 권한을 저장했습니다.');
    } catch (cause: any) { setError(cause?.message || '앱 권한을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  const loadWork = useCallback(async (item: StaffProfile) => {
    setWorkLoading(true); setError('');
    try {
      const rows = await getWorkLogs(item.id);
      setWorkLogs(rows);
      setWorkMonth(rows[0]?.workDate.slice(0, 7) ?? '');
    } catch (cause: any) { setError(cause?.message || '근무 기록을 불러오지 못했습니다.'); }
    finally { setWorkLoading(false); }
  }, []);

  function openWork(item: StaffProfile) {
    setError(''); setWorkTarget(item); setWorkLogs([]); setWorkMonth('');
    void loadWork(item);
  }

  function openWorkForm(item: WorkLog | null) {
    if (!workTarget || !canManage) return;
    setEditingWork(item);
    setWorkDraft(item ? {
      staffId: workTarget.id, workLabel: item.workLabel,
      date: timeInKorea(item.startedAt).day, startTime: timeInKorea(item.startedAt).hm,
      endTime: item.endedAt ? timeInKorea(item.endedAt).hm : '',
      hourlyRateKrw: item.hourlyRateKrw == null ? '' : String(item.hourlyRateKrw),
      notes: item.notes,
    } : blankWork(workTarget.id));
    setWorkForm(true);
  }

  async function saveWork() {
    if (!workTarget) return;
    setBusy(true); setError('');
    try {
      await saveManagedWorkLog(editingWork?.id ?? null, workDraft);
      setWorkForm(false); await loadWork(workTarget); setNotice('근무 기록을 저장했습니다.');
    } catch (cause: any) { setError(cause?.message || '근무 기록을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  function deleteWork(item: WorkLog) {
    if (!canManage || !workTarget) return;
    const message = item.workDate + ' ' + item.workLabel + ' 기록을 완전히 삭제할까요?';
    const remove = () => {
      void (async () => {
        setBusy(true); setError('');
        try { await deleteManagedWorkLog(item.id); await loadWork(workTarget); setNotice('근무 기록을 삭제했습니다.'); }
        catch (cause: any) { setError(cause?.message || '근무 기록을 삭제하지 못했습니다.'); }
        finally { setBusy(false); }
      })();
    };
    if (Platform.OS === 'web') { if (window.confirm(message)) remove(); }
    else Alert.alert('근무 기록 삭제', message, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: remove }]);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="#4F46E5" /></View>;
  return <View style={styles.page}>
    <ScrollView contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.title}>조교</Text><Text style={styles.muted}>조교 정보와 근무 기록</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="앱 권한 안내"
          onPress={() => setPermissionInfoVisible(true)} style={styles.helpButton}>
          <Text style={styles.helpText}>권한 안내 ⓘ</Text>
        </Pressable>
        {canManage && <Button label="+ 조교 추가" primary onPress={() => openStaffForm(null)} />}</View>
      {canManage && <SupabaseSendingDeviceManager />}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      <View style={styles.actions}>
        <Pressable style={[styles.chip, showField && styles.selected]} onPress={() => setShowField((value) => !value)}>
          <Text> {showField ? '☑' : '☐'} 현장</Text>
        </Pressable>
        <Pressable style={[styles.chip, showMaterial && styles.selected]} onPress={() => setShowMaterial((value) => !value)}>
          <Text> {showMaterial ? '☑' : '☐'} 자료</Text>
        </Pressable>
      </View>      {ordered.length === 0 && <Text style={styles.empty}>등록된 조교가 없습니다.</Text>}
      {ordered.map((item) => <View key={item.id} style={[styles.card, item.employmentStatus === 'inactive' && styles.inactive]}>
        <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.name}>{item.fullName}</Text><Text style={styles.muted}>{item.positions.join(' · ') || '직책 미입력'} · {item.duties.join(' · ') || '업무 미입력'}</Text></View>
          {item.employmentStatus === 'inactive' && <Text style={styles.muted}>비근무</Text>}</View>
        <Text style={styles.detail}>{item.email}{item.phone ? ' · ' + item.phone : ''}</Text>
        {!!item.startedOn && <Text style={styles.muted}>근무 시작 {item.startedOn}</Text>}
        {isAdmin && <Text style={styles.muted}>앱 계정: {item.employmentStatus === 'inactive' ? '비근무 · 로그인 불가' : item.linked ? '연결됨' : '첫 로그인 시 자동 연결'} · {roleLabels[item.appRole ?? 'assistant']}</Text>}
        <View style={styles.actions}>
          {!!item.phone && <Button label="전화" onPress={() => void Linking.openURL(`tel:${item.phone.replace(/\D/g, '')}`)} />}
          {!!item.phone && <Button label="문자" onPress={() => void Linking.openURL(`sms:${item.phone.replace(/\D/g, '')}`)} />}
          {(canManage || access?.staff_id === item.id) && <Button label="근무 기록" onPress={() => openWork(item)} />}
          {canManage && <Button label="정보 수정" onPress={() => openStaffForm(item)} />}
          {canManage && <Button label={isAdmin ? '계좌 수정' : '계좌 조회'} onPress={() => { setBankTarget(item); setBankDraft(item.bankAccount ?? ''); }} />}
          {isAdmin && item.id !== access?.staff_id && <Button label="앱 권한" onPress={() => { setAccessTarget(item); setRoleDraft(item.appRole ?? 'assistant'); }} />}
          {isAdmin && item.id !== access?.staff_id && <Button label="조교 삭제" danger disabled={busy} onPress={() => archiveStaff(item)} />}
        </View>
      </View>)}
    </ScrollView>

    <Modal visible={permissionInfoVisible} transparent animationType="fade" onRequestClose={() => setPermissionInfoVisible(false)}>
      <View style={styles.overlay}><View style={styles.smallModal}>
        <Text style={styles.modalTitle}>앱 권한 안내</Text>
        <Text style={styles.permissionText}>조교: 모든 수업의 학생 기록 조회·입력, 본인 근무 기록 조회</Text>
        <Text style={styles.permissionText}>매니저: 조교 정보·근무 기록 관리, 계좌 조회, 발송 기기 등록</Text>
        <Text style={styles.permissionText}>관리자: 매니저 권한에 더해 계좌 수정, 앱 역할 변경</Text>
        <Text style={styles.permissionFootnote}>현역 조교 명단에 등록된 이메일은 첫 로그인 시 자동 연결됩니다.</Text>
        <Text style={styles.permissionFootnote}>직책(CEO·실장·조교)과 앱 권한은 별개입니다.</Text>
        <View style={styles.actions}><Button label="닫기" primary onPress={() => setPermissionInfoVisible(false)} /></View>
      </View></View>
    </Modal>

    <Modal visible={staffModal} transparent animationType="slide" onRequestClose={() => setStaffModal(false)}>
      <View style={styles.overlay}><View style={styles.modal}>
        <Text style={styles.modalTitle}>{editingStaff ? '조교 정보 수정' : '조교 추가'}</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <ScrollView keyboardShouldPersistTaps="handled">
          <Field label="이름" value={staffDraft.fullName} onChange={(fullName) => setStaffDraft({ ...staffDraft, fullName })} />
          <Field label="이메일" value={staffDraft.email} placeholder="assistant@example.com" keyboardType="email-address" editable={!editingStaff || isAdmin} onChange={(email) => setStaffDraft({ ...staffDraft, email })} />
          <Field label="전화번호" value={staffDraft.phone} placeholder="010-1234-5678" keyboardType="phone-pad" onChange={(phone) => setStaffDraft({ ...staffDraft, phone })} />
          <Text style={styles.label}>직책</Text><View style={styles.actions}>{['CEO', '실장', '조교'].map((position) =>
            <Pressable key={position} style={[styles.chip, staffDraft.positions.includes(position) && styles.selected]}
              onPress={() => setStaffDraft({ ...staffDraft, positions: staffDraft.positions.includes(position) ? staffDraft.positions.filter((value) => value !== position) : [...staffDraft.positions, position] })}><Text>{position}</Text></Pressable>)}</View>
          <Text style={styles.label}>담당 업무</Text><View style={styles.actions}>{['CEO', '실장', '현장', '자료'].map((duty) =>
            <Pressable key={duty} style={[styles.chip, staffDraft.duties.includes(duty) && styles.selected]}
              onPress={() => setStaffDraft({ ...staffDraft, duties: staffDraft.duties.includes(duty) ? staffDraft.duties.filter((value) => value !== duty) : [...staffDraft.duties, duty] })}><Text>{duty}</Text></Pressable>)}</View>
          <Field label="근무 시작일" value={staffDraft.startedOn} placeholder="YYYY-MM-DD" onChange={(startedOn) => setStaffDraft({ ...staffDraft, startedOn })} />
          {isAdmin && editingStaff && <View><Text style={styles.label}>재직 상태</Text><View style={styles.pickerBox}><Picker selectedValue={staffDraft.employmentStatus} onValueChange={(employmentStatus) => setStaffDraft({ ...staffDraft, employmentStatus })}><Picker.Item label="현역" value="active" /><Picker.Item label="비근무" value="inactive" /></Picker></View></View>}
          <Field label="비고" value={staffDraft.notes} onChange={(notes) => setStaffDraft({ ...staffDraft, notes })} />
        </ScrollView>
        <View style={styles.actions}><Button label="취소" onPress={() => setStaffModal(false)} /><Button label={busy ? '저장 중...' : '저장'} primary disabled={busy} onPress={() => void saveStaff()} /></View>
      </View></View>
    </Modal>

    <Modal visible={Boolean(bankTarget)} transparent animationType="fade" onRequestClose={() => setBankTarget(null)}>
      <View style={styles.overlay}><View style={styles.smallModal}><Text style={styles.modalTitle}>{bankTarget?.fullName} 계좌 정보</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        {isAdmin ? <Field label="계좌번호" value={bankDraft} onChange={setBankDraft} />
          : <Text selectable style={styles.bankValue}>{bankDraft || '등록된 계좌가 없습니다.'}</Text>}
        <View style={styles.actions}><Button label="닫기" onPress={() => setBankTarget(null)} />{isAdmin && <Button label="저장" primary disabled={busy} onPress={() => void saveBank()} />}</View>
      </View></View>
    </Modal>

    <Modal visible={Boolean(accessTarget)} transparent animationType="fade" onRequestClose={() => setAccessTarget(null)}>
      <View style={styles.overlay}><View style={styles.smallModal}><Text style={styles.modalTitle}>{accessTarget?.fullName} 앱 권한</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!accessTarget?.linked && <Text style={styles.muted}>등록된 이메일로 첫 로그인할 때 계정이 자동 연결됩니다. 역할은 미리 지정할 수 있습니다.</Text>}
        <Text style={styles.label}>역할</Text><View style={styles.pickerBox}><Picker selectedValue={roleDraft} onValueChange={(value) => setRoleDraft(value as AppRole)}><Picker.Item label="조교" value="assistant" /><Picker.Item label="매니저" value="manager" /><Picker.Item label="관리자" value="admin" /></Picker></View>
        <View style={styles.actions}><Button label="취소" onPress={() => setAccessTarget(null)} /><Button label="저장" primary disabled={busy} onPress={() => void saveAccess()} /></View>
      </View></View>
    </Modal>

    <Modal visible={Boolean(workTarget)} transparent animationType="slide" onRequestClose={() => setWorkTarget(null)}>
      <View style={styles.overlay}><View style={styles.modal}>
        <View style={styles.row}><Text style={[styles.modalTitle, { flex: 1 }]}>{workTarget?.fullName} 근무 기록</Text><Button label="닫기" onPress={() => setWorkTarget(null)} /></View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {canManage && <View style={styles.actions}><Button label="+ 기록 추가" primary onPress={() => openWorkForm(null)} /></View>}
        {workLoading ? <ActivityIndicator color="#4F46E5" /> : <ScrollView>
          {months.length > 0 && <View style={styles.pickerBox}><Picker selectedValue={workMonth} onValueChange={setWorkMonth}>{months.map((month) => <Picker.Item key={month} label={month} value={month} />)}</Picker></View>}
          {!!workMonth && <Text style={styles.summary}>{monthLogs.length}건 · 총 {Math.floor(totalMinutes / 60)}시간 {totalMinutes % 60}분</Text>}
          {workLogs.length === 0 && <Text style={styles.empty}>근무 기록이 없습니다.</Text>}
          {monthLogs.map((item) => <View key={item.id} style={styles.logRow}>
            <View style={{ flex: 1 }}><Text style={styles.detail}>{item.workDate} · {item.workLabel}</Text><Text style={styles.muted}>{timeInKorea(item.startedAt).hm}~{item.endedAt ? timeInKorea(item.endedAt).hm : '근무 중'} · {item.durationMinutes ?? 0}분</Text></View>
            {canManage && <View style={styles.actions}><Pressable onPress={() => openWorkForm(item)}><Text style={styles.link}>수정</Text></Pressable><Pressable onPress={() => deleteWork(item)}><Text style={styles.deleteText}>삭제</Text></Pressable></View>}
          </View>)}
        </ScrollView>}
      </View></View>
    </Modal>

    <Modal visible={workForm} transparent animationType="fade" onRequestClose={() => setWorkForm(false)}>
      <View style={styles.overlay}><View style={styles.modal}><Text style={styles.modalTitle}>{editingWork ? '근무 기록 수정' : '근무 기록 추가'}</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <ScrollView keyboardShouldPersistTaps="handled">
          <Field label="날짜" value={workDraft.date} placeholder="YYYY-MM-DD" onChange={(date) => setWorkDraft({ ...workDraft, date })} />
          <Field label="수업 / 근무명" value={workDraft.workLabel} onChange={(workLabel) => setWorkDraft({ ...workDraft, workLabel })} />
          <View style={styles.row}><View style={{ flex: 1 }}><Field label="출근" value={workDraft.startTime} placeholder="HH:MM" onChange={(startTime) => setWorkDraft({ ...workDraft, startTime })} /></View><View style={{ flex: 1 }}><Field label="퇴근 (비우면 근무 중)" value={workDraft.endTime} placeholder="HH:MM 또는 빈칸" onChange={(endTime) => setWorkDraft({ ...workDraft, endTime })} /></View></View>
          <Field label="당시 시급(원, 선택)" value={workDraft.hourlyRateKrw} keyboardType="numeric" onChange={(hourlyRateKrw) => setWorkDraft({ ...workDraft, hourlyRateKrw })} />
          <Field label="비고" value={workDraft.notes} onChange={(notes) => setWorkDraft({ ...workDraft, notes })} />
        </ScrollView>
        <View style={styles.actions}><Button label="취소" onPress={() => setWorkForm(false)} /><Button label="저장" primary disabled={busy} onPress={() => void saveWork()} /></View>
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F9FAFB' }, content: { padding: 20, paddingBottom: 45, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#111827', fontSize: 25, fontWeight: '900' }, name: { color: '#111827', fontSize: 17, fontWeight: '800' },
  muted: { color: '#6B7280', fontSize: 12, marginTop: 3 }, detail: { color: '#374151', fontSize: 13, marginTop: 7 },
  card: { padding: 16, backgroundColor: '#FFFFFF', borderRadius: 13, borderWidth: 1, borderColor: '#E5E7EB', gap: 5 },
  inactive: { opacity: 0.65 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  helpButton: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8, backgroundColor: '#EEF2FF' },
  helpText: { color: '#4338CA', fontWeight: '800', fontSize: 12 },
  permissionText: { color: '#374151', lineHeight: 21, fontSize: 13 },
  permissionFootnote: { color: '#6B7280', marginTop: 6, fontSize: 12 },
  bankValue: { color: '#111827', fontSize: 16, paddingVertical: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  button: { paddingHorizontal: 11, paddingVertical: 9, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF', borderRadius: 9 },
  primary: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' }, disabled: { opacity: 0.5 },
  dangerButton: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  buttonText: { color: '#374151', fontWeight: '700', fontSize: 12 }, primaryText: { color: '#FFFFFF' }, dangerButtonText: { color: '#B91C1C' },
  error: { color: '#B91C1C', padding: 11, backgroundColor: '#FEF2F2', borderRadius: 8 },
  notice: { color: '#047857', padding: 11, backgroundColor: '#ECFDF5', borderRadius: 8 },
  empty: { color: '#6B7280', padding: 16, textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0007', padding: 12 },
  modal: { width: '100%', maxWidth: 580, maxHeight: '90%', padding: 18, backgroundColor: '#FFFFFF', borderRadius: 14 },
  smallModal: { width: '100%', maxWidth: 420, padding: 18, backgroundColor: '#FFFFFF', borderRadius: 14 },
  modalTitle: { color: '#111827', fontSize: 18, fontWeight: '900', marginBottom: 12 },
  field: { marginVertical: 6 }, label: { color: '#374151', fontWeight: '700', marginBottom: 5, fontSize: 12 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 11, minHeight: 42, color: '#111827' },
  chip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#D1D5DB' },
  selected: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  pickerBox: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, overflow: 'hidden', marginVertical: 6 },
  summary: { color: '#1F2937', fontWeight: '800', paddingVertical: 10 },
  logRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { color: '#4F46E5', fontWeight: '800', fontSize: 12 }, deleteText: { color: '#DC2626', fontWeight: '800', fontSize: 12 },
});
