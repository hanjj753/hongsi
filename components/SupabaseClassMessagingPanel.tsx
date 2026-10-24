import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { getSupabaseClassStudents, type ClassStudent } from '../lib/classData';
import {
  cancelPendingClassMessages, claimNextMessageDelivery, finishMessageDelivery,
  getClassMessageQueue, getClassPendingDeliveryCount, getLocalDevicePairing, getThisSendingDeviceState,
  queueClassMessages, registerThisSendingDevice, replacePendingMessage, type MessageDraft, type QueuedMessage,
} from '../lib/messageData';
import DirectSms from '../utils/smsSender';

function confirmAction(title: string, message: string, action: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) action();
  } else Alert.alert(title, message, [{ text: '취소', style: 'cancel' }, { text: '확인', onPress: action }]);
}

function koreaTime(value: string) {
  return new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}
function eligible(student: ClassStudent) {
  return Boolean(student.parentPhone && (student.defaultMessageRecipients !== 'both' || student.studentPhone));
}

const statusLabels: Record<string, string> = {
  pending: '대기', sending: '전송 중', submitted: '기기 제출', failed: '실패',
  cancelled: '취소', unknown: '상태 미확인', legacy_sent: '기존 발송 기록',
};

export default function SupabaseClassMessagingPanel({ classId, canManage, onDraftChange }: {
  classId: string; canManage: boolean; onDraftChange: (dirty: boolean) => void;
}) {
  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [notice, setNotice] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('홍시 문자 발송 기기');
  const [deviceState, setDeviceState] = useState<'unregistered' | 'pending' | 'enabled' | 'invalid'>('unregistered');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editContent, setEditContent] = useState('');
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(() => new Set());
  const prepared = useRef<{ fingerprint: string; items: MessageDraft[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const [classStudents, messages, pending] = await Promise.all([
        getSupabaseClassStudents(classId),
        getClassMessageQueue(classId),
        getClassPendingDeliveryCount(classId),
      ]);
      setStudents(classStudents);
      setQueue(messages);
      setPendingCount(pending);
      setError('');
    } catch (cause: any) { setError(cause?.message || '문자 정보를 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [classId]);
  const loadDevice = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const state = await getThisSendingDeviceState();
      setDeviceState(state ? state.enabled ? 'enabled' : 'pending' : 'unregistered');
    } catch { setDeviceState('invalid'); }
  }, []);
  useEffect(() => { void load(); void loadDevice(); }, [load, loadDevice]);
  useEffect(() => {
    const original = queue.find((item) => item.id === editingId)?.content ?? '';
    onDraftChange(Boolean(notice.trim()) || Boolean(editingId && editContent !== original));
  }, [notice, editingId, editContent, queue, onDraftChange]);

  const activeStudents = students.filter((student) => student.enrollmentStatus === 'active');

  async function registerDevice() {
    setBusy(true); setError(''); setSuccess('');
    try { await registerThisSendingDevice(deviceLabel); await loadDevice(); setSuccess('등록 요청을 보냈습니다. 매니저가 기기를 허용하면 발송할 수 있습니다.'); }
    catch (cause: any) { setError(cause?.message || '기기를 등록하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function queueItems(items: Array<{ studentId: string; content: string }>, targetSessionId: string | null) {
    if (!items.length) throw new Error('메시지 대상이 없습니다.');
    const fingerprint = JSON.stringify({ targetSessionId, items });
    if (prepared.current?.fingerprint !== fingerprint) {
      prepared.current = { fingerprint, items: items.map((item) => ({
        student_id: item.studentId, content: item.content, request_id: Crypto.randomUUID(),
      })) };
    }
    setProgress({ label: '메시지를 대기 목록에 추가하는 중', done: 0, total: prepared.current.items.length });
    const created = await queueClassMessages(classId, targetSessionId, prepared.current.items,
      (done, total) => setProgress({ label: '메시지를 대기 목록에 추가하는 중', done, total }));
    prepared.current = null;
    await load();
    return created;
  }

  async function queueNotice() {
    setBusy(true); setError(''); setSuccess('');
    try {
      if (!notice.trim()) throw new Error('공지 내용을 입력해 주세요.');
      const recipients = activeStudents.filter(eligible);
      if (!recipients.length) throw new Error('발송 가능한 학생이 없습니다. 학부모·학생 전화번호를 확인해 주세요.');
      const count = await queueItems(recipients.map((student) => ({ studentId: student.id, content: notice.trim() })), null);
      setSuccess(`${count}명의 공지 메시지를 대기 목록에 추가했습니다.`);
      setNotice('');
    } catch (cause: any) { setError(cause?.message || '공지 메시지를 추가하지 못했습니다.'); }
    finally { setBusy(false); setProgress(null); }
  }

  async function sendPending() {
    if (Platform.OS !== 'android' || busy) return;
    setBusy(true); setError(''); setSuccess('');
    let submitted = 0;
    let failed = 0;
    const targetCount = Math.min(pendingCount, 200);
    setProgress({ label: '문자 발송 준비 중', done: 0, total: targetCount });
    try {
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS);
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Android 문자 발송 권한이 필요합니다.');
      const pairing = await getLocalDevicePairing();
      if (!pairing) throw new Error('이 기기를 먼저 등록해 주세요.');
      for (let index = 0; index < 200; index++) {
        const item = await claimNextMessageDelivery(classId, pairing);
        if (!item) break;
        setProgress({ label: 'Android 기기에 문자를 제출하는 중', done: submitted + failed, total: targetCount });
        try {
          await DirectSms.sendDirectSms(item.phone.replace(/\D/g, ''), item.content);
        } catch (cause: any) {
          try { await finishMessageDelivery(item, pairing, 'failed', cause?.message || String(cause)); }
          catch { throw new Error('문자 발송 실패 후 DB 상태를 확인하지 못했습니다. 전송 중 기록을 확인해 주세요. 자동 재발송하지 않습니다.'); }
          failed++;
          setProgress({ label: `기기 제출 ${submitted}건 · 실패 ${failed}건`, done: submitted + failed, total: targetCount });
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        try { await finishMessageDelivery(item, pairing, 'submitted'); }
        catch { throw new Error('기기에 문자를 제출했지만 DB 상태를 확인하지 못했습니다. 전송 중 기록을 확인해 주세요. 자동 재발송하지 않습니다.'); }
        submitted++;
        setProgress({ label: `기기 제출 ${submitted}건 · 실패 ${failed}건`, done: submitted + failed, total: targetCount });
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setSuccess(`기기 제출 ${submitted}건 · 실패 ${failed}건. 실제 수신 여부는 통신사 결과를 확인해 주세요.`);
      await load();
    } catch (cause: any) { setError(cause?.message || '문자 발송을 완료하지 못했습니다.'); await load(); }
    finally { setBusy(false); setProgress(null); }
  }

  async function cancelPending() {
    setBusy(true); setError(''); setSuccess('');
    try { const count = await cancelPendingClassMessages(classId); setSuccess(`대기 중이던 수신자 ${count}건을 취소했습니다.`); await load(); }
    catch (cause: any) { setError(cause?.message || '대기 메시지를 취소하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editingId || !editContent.trim()) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      await replacePendingMessage(editingId, editContent);
      setEditingId(''); setEditContent('');
      setSuccess('대기 메시지를 수정했습니다. 기존 대기 건은 취소 처리되었습니다.');
      await load();
    } catch (cause: any) { setError(cause?.message || '대기 메시지를 수정하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  return <View style={styles.panel}>
    <Text style={styles.title}>메시지</Text>
    <Text style={styles.description}>여기서는 수업 공지를 추가하고 문자 발송을 관리합니다. 차시별 개별 메시지는 해당 차시 화면에서 작성합니다. 학생별 기본 수신자에 따라 학부모만 또는 학생·학부모 모두에게 보냅니다.</Text>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {!!success && <Text style={styles.success}>{success}</Text>}
    {progress && <View style={styles.progressCard} accessibilityLabel={`${progress.label} ${progress.done}/${progress.total}`}>
      <Text style={styles.progressLabel}>{progress.label} · {progress.done}/{progress.total}건</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.min(100, Math.round(progress.done / Math.max(progress.total, 1) * 100))}%` }]} />
      </View>
    </View>}
    {loading ? <ActivityIndicator color="#4F46E5" /> : <>
      <View style={styles.section}>
        <Text style={styles.heading}>공지 메시지 추가</Text>
        <Text style={styles.description}>현재 수강 중이고 필요한 전화번호가 등록된 학생 {activeStudents.filter(eligible).length}명</Text>
        <TextInput style={styles.input} multiline value={notice} onChangeText={setNotice} placeholder="공지 내용을 입력하세요" placeholderTextColor="#9CA3AF" />
        <Pressable disabled={busy || !notice.trim()} style={[styles.button, (busy || !notice.trim()) && styles.disabled]} onPress={() => void queueNotice()}>
          <Text style={styles.buttonText}>공지 추가</Text>
        </Pressable>
      </View>
      <View style={styles.section}>
        <View style={styles.row}><Text style={styles.heading}>발송 대기 및 확인 필요</Text>
          <Pressable onPress={() => void load()}><Text style={styles.link}>새로고침</Text></Pressable></View>
        <Text style={styles.description}>대기 수신자 {pendingCount}건 · 발송 완료/취소된 메시지는 숨김 · 최대 200건</Text>
        {queue.length === 0 ? <Text style={styles.empty}>대기 중이거나 확인이 필요한 메시지가 없습니다.</Text> : queue.map((item) => <View key={item.id} style={styles.message}>
          <Text style={styles.candidateName}>{item.studentName} · {koreaTime(item.createdAt)}</Text>
          <Text style={styles.previewText} numberOfLines={expandedMessages.has(item.id) ? undefined : 3}>{item.content}</Text>
          <Pressable onPress={() => setExpandedMessages((current) => {
            const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;
          })}><Text style={styles.link}>{expandedMessages.has(item.id) ? '접기' : '전체 보기'}</Text></Pressable>
          <Text style={styles.candidateDetail}>{item.deliveries.map((delivery) => `${delivery.recipientType === 'parent' ? '학부모' : '학생'}: ${statusLabels[delivery.status] || delivery.status}`).join(' · ')}</Text>
          {item.deliveries.length > 0 && item.deliveries.every((delivery) => delivery.status === 'pending') && <>
            <Pressable disabled={busy} onPress={() => { setEditingId(item.id); setEditContent(item.content); }}><Text style={styles.link}>메시지 수정</Text></Pressable>
            {editingId === item.id && <View style={styles.editBox}>
              <Text style={styles.candidateDetail}>아직 전송되지 않은 메시지만 수정할 수 있습니다.</Text>
              <TextInput style={styles.input} multiline value={editContent} onChangeText={setEditContent} placeholder="수정할 메시지" placeholderTextColor="#9CA3AF" />
              <View style={styles.editActions}>
                <Pressable disabled={busy || !editContent.trim() || editContent.trim() === item.content} style={[styles.button, (busy || !editContent.trim() || editContent.trim() === item.content) && styles.disabled]} onPress={() => void saveEdit()}><Text style={styles.buttonText}>수정 저장</Text></Pressable>
                <Pressable onPress={() => { setEditingId(''); setEditContent(''); }}><Text style={styles.link}>취소</Text></Pressable>
              </View>
            </View>}
          </>}
        </View>)}
        {canManage && pendingCount > 0 && <Pressable disabled={busy} onPress={() => confirmAction('대기 메시지 취소', `이 수업의 대기 수신자 ${pendingCount}건을 취소할까요?`, () => void cancelPending())}>
          <Text style={styles.danger}>대기 메시지 전체 취소</Text>
        </Pressable>}
      </View>
      <View style={styles.section}>
        <Text style={styles.heading}>Android 기기 문자 발송</Text>
        {Platform.OS !== 'android' ? <Text style={styles.description}>문자 발송과 기기 등록은 Android 앱에서 가능합니다.</Text> : <>
          <Text style={styles.description}>기기 상태: {deviceState === 'enabled' ? '발송 허용' : deviceState === 'pending' ? '매니저 승인 대기' : deviceState === 'invalid' ? '재등록 필요' : '미등록'}</Text>
          {(deviceState === 'unregistered' || deviceState === 'invalid') && <Text style={styles.hint}>앱을 재설치하면 기기 등록 정보가 지워집니다. 이 기기를 다시 등록 요청한 뒤 매니저 승인을 받아 주세요.</Text>}
          {deviceState !== 'enabled' && <>
            <TextInput style={styles.deviceInput} value={deviceLabel} onChangeText={setDeviceLabel} placeholder="기기 이름" />
            <Pressable disabled={busy} style={[styles.button, busy && styles.disabled]} onPress={() => void registerDevice()}><Text style={styles.buttonText}>이 기기 등록 요청</Text></Pressable>
            <Pressable onPress={() => void loadDevice()}><Text style={styles.link}>승인 상태 새로고침</Text></Pressable>
          </>}
          {deviceState === 'enabled' && <Pressable disabled={busy || pendingCount === 0} style={[styles.button, (busy || pendingCount === 0) && styles.disabled]}
            onPress={() => confirmAction('문자 발송', `대기 수신자 ${pendingCount}건을 이 Android 기기로 제출할까요?`, () => void sendPending())}>
            <Text style={styles.buttonText}>{busy ? '전송 중...' : `대기 문자 발송 (${pendingCount}건)`}</Text>
          </Pressable>}
          <Text style={styles.hint}>전송 중 앱이 종료되면 중복 방지를 위해 자동 재발송하지 않습니다. '기기 제출'은 실제 수신 확인이 아닙니다.</Text>
        </>}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { padding: 16, marginBottom: 16, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  title: { fontSize: 18, fontWeight: '800', color: '#111827' },
  heading: { fontSize: 15, fontWeight: '800', color: '#111827' },
  description: { marginTop: 6, marginBottom: 10, color: '#6B7280', lineHeight: 19, fontSize: 13 },
  section: { borderTopWidth: 1, borderColor: '#E5E7EB', paddingTop: 15, marginTop: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: { minHeight: 75, padding: 11, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, backgroundColor: '#F9FAFB', fontSize: 14, textAlignVertical: 'top' },
  button: { alignSelf: 'flex-start', backgroundColor: '#4F46E5', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, marginTop: 10 },
  buttonText: { color: '#FFFFFF', fontWeight: '800' }, disabled: { opacity: 0.5 },
  hint: { color: '#6B7280', fontSize: 12, lineHeight: 18, marginTop: 9 },
  link: { color: '#4F46E5', fontWeight: '800', marginTop: 10 }, danger: { color: '#B91C1C', fontWeight: '800', marginTop: 15 },
  candidateName: { color: '#111827', fontWeight: '700' }, candidateDetail: { color: '#6B7280', fontSize: 12, marginTop: 4 },
  previewText: { color: '#374151', marginTop: 6, lineHeight: 20 },
  message: { padding: 12, borderBottomWidth: 1, borderColor: '#E5E7EB' }, empty: { color: '#6B7280', marginTop: 10 },
  editBox: { marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: '#F9FAFB' },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  deviceInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 10, backgroundColor: '#F9FAFB' },
  progressCard: { marginTop: 12, padding: 11, borderRadius: 9, backgroundColor: '#EEF2FF' },
  progressLabel: { color: '#312E81', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  progressTrack: { height: 9, borderRadius: 9, overflow: 'hidden', backgroundColor: '#C7D2FE' },
  progressFill: { height: '100%', backgroundColor: '#4F46E5' },
  error: { color: '#B91C1C', marginTop: 9 }, success: { color: '#047857', marginTop: 9 },
});








