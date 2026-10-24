import * as Crypto from 'expo-crypto';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ClassStudent, SessionWorkspace } from '../lib/classData';
import { queueClassMessages, type MessageDraft } from '../lib/messageData';
import { defaultSessionMessageTemplate, fillSessionMessageTemplate, homeworkToken, testToken } from '../lib/sessionMessageTemplate';

type Props = {
  classId: string;
  classLabel: string;
  termLabel: string;
  day: string;
  workspace: SessionWorkspace;
  recordsDirty: boolean;
  onDraftChange: (dirty: boolean) => void;
};

const eligible = (student: ClassStudent) =>
  Boolean(student.parentPhone && (student.defaultMessageRecipients !== 'both' || student.studentPhone));

export default function SessionMessagingComposer({ classId, classLabel, termLabel, day, workspace, recordsDirty, onDraftChange }: Props) {
  const initialTemplate = useMemo(() => defaultSessionMessageTemplate(workspace), [workspace.homeworks, workspace.tests]);
  const eligibleStudents = useMemo(() => workspace.students.filter(eligible).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ko')),
    [workspace.students]);
  const [template, setTemplate] = useState(initialTemplate);
  const [templateTouched, setTemplateTouched] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(eligibleStudents.map((student) => student.id)));
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const prepared = useRef<{ fingerprint: string; items: MessageDraft[] } | null>(null);

  useEffect(() => { if (!selectionTouched && !queued) setSelected(new Set(eligibleStudents.map((student) => student.id))); }, [eligibleStudents, selectionTouched, queued]);
  useEffect(() => { if (!templateTouched) setTemplate(initialTemplate); }, [initialTemplate, templateTouched]);

  const dirty = !queued && (template !== initialTemplate || selectionTouched);
  useEffect(() => { onDraftChange(dirty); }, [dirty, onDraftChange]);

  const chosenStudents = eligibleStudents.filter((student) => selected.has(student.id));
  const previewStudent = chosenStudents[0];
  const preview = previewStudent ? fillSessionMessageTemplate(template, previewStudent, workspace, classLabel, termLabel, day) : '';
  const tokens = [
    ...workspace.homeworks.map((item) => ({ token: homeworkToken(item.sortOrder), title: item.title })),
    ...workspace.tests.map((item) => ({ token: testToken(item.sortOrder), title: item.title })),
  ];

  async function queueIndividual() {
    if (busy || recordsDirty) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      if (!template.trim()) throw new Error('메시지 내용을 입력해 주세요.');
      if (!chosenStudents.length) throw new Error('메시지를 받을 학생을 선택해 주세요.');
      const items = chosenStudents.map((student) => ({
        studentId: student.id,
        content: fillSessionMessageTemplate(template, student, workspace, classLabel, termLabel, day),
      }));
      if (items.some((item) => /\$\{[^}]+\}/.test(item.content))) throw new Error('사용할 수 없는 변수가 있습니다. 위의 변수 목록을 확인해 주세요.');
      const fingerprint = JSON.stringify({ sessionId: workspace.sessionId, items });
      if (prepared.current?.fingerprint !== fingerprint) prepared.current = {
        fingerprint,
        items: items.map((item) => ({ student_id: item.studentId, content: item.content, request_id: Crypto.randomUUID() })),
      };
      setProgress({ done: 0, total: prepared.current.items.length });
      const count = await queueClassMessages(classId, workspace.sessionId, prepared.current.items,
        (done, total) => setProgress({ done, total }));
      prepared.current = null;
      setSuccess(`${count}명의 개별 메시지를 발송 대기 목록에 추가했습니다. 실제 발송은 수업 화면에서 진행합니다.`);
      setSelected(new Set());
      setSelectionTouched(false);
      setTemplateTouched(false);
      setTemplate(initialTemplate);
      setQueued(true);
    } catch (cause: any) { setError(cause?.message || '메시지를 추가하지 못했습니다.'); }
    finally { setBusy(false); setProgress(null); }
  }

  return <View style={styles.panel}>
    <Text style={styles.title}>차시별 개별 메시지</Text>
    <Text style={styles.help}>이 차시에 저장된 출석·숙제·시험 결과를 학생별 변수로 바꿔 발송 대기 목록에 추가합니다.</Text>
    {recordsDirty && <Text style={styles.warning}>위의 학생 기록이나 항목을 먼저 저장한 뒤 메시지를 추가해 주세요.</Text>}
    <Text style={styles.label}>사용 가능한 변수</Text>
    <Text style={styles.help}>{'${STUDENT_NAME}, ${CLASS_NAME}, ${QUARTER}, ${DAY}, ${SESSION}, ${ATTENDANCE}'}</Text>
    {tokens.length ? <View style={styles.tokens}>{tokens.map(({ token, title }) =>
      <Pressable key={token} style={styles.token} onPress={() => { setTemplate((current) => `${current}\n\${${token}}`); setTemplateTouched(true); setQueued(false); }}>
        <Text style={styles.tokenText}>{'${' + token + '}'} · {title}</Text>
      </Pressable>)}</View> : <Text style={styles.help}>숙제나 시험을 위에서 추가하면 HW1, TEST1처럼 변수가 표시됩니다.</Text>}
    <Text style={styles.label}>메시지 내용</Text>
    <TextInput style={styles.template} multiline value={template} onChangeText={(value) => { setTemplate(value); setTemplateTouched(true); setQueued(false); }} placeholder="메시지 내용을 입력하세요" placeholderTextColor="#9CA3AF" />
    <Text style={styles.label}>받을 학생 · {chosenStudents.length}/{eligibleStudents.length}명</Text>
    <Pressable onPress={() => { setSelected(new Set(eligibleStudents.map((student) => student.id))); setSelectionTouched(true); setQueued(false); }}><Text style={styles.link}>발송 가능한 학생 전체 선택</Text></Pressable>
    <View style={styles.students}>{workspace.students.map((student) => {
      const canSend = eligible(student);
      return <Pressable key={student.id} disabled={!canSend} style={styles.student} onPress={() => {
        setSelected((current) => { const next = new Set(current); if (next.has(student.id)) next.delete(student.id); else next.add(student.id); return next; });
        setSelectionTouched(true); setQueued(false);
      }}>
        <Text style={styles.studentName}>{selected.has(student.id) ? '☑' : '☐'} {student.fullName}</Text>
        {student.participationType === 'makeup' && <Text style={styles.help}>다른 반 보강 · 이 차시의 메시지 대상으로 선택할 수 있습니다.</Text>}
        {!canSend && <Text style={styles.help}>필요한 전화번호가 없습니다.</Text>}
      </Pressable>;
    })}</View>
    {previewStudent && <View style={styles.preview}><Text style={styles.label}>미리보기 · {previewStudent.fullName}</Text><Text style={styles.previewText}>{preview}</Text></View>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    {!!success && <Text style={styles.success}>{success}</Text>}
    {progress && <View style={styles.progress}><Text style={styles.help}>대기 목록에 추가하는 중 · {progress.done}/{progress.total}명</Text><View style={styles.track}><View style={[styles.fill, { width: `${Math.round(progress.done / Math.max(progress.total, 1) * 100)}%` }]} /></View></View>}
    <Pressable disabled={busy || recordsDirty || chosenStudents.length === 0 || !template.trim()} style={[styles.button, (busy || recordsDirty || chosenStudents.length === 0 || !template.trim()) && styles.disabled]} onPress={() => void queueIndividual()}>
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>선택한 {chosenStudents.length}명 메시지 추가</Text>}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  panel: { marginTop: 20, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  title: { color: '#111827', fontSize: 18, fontWeight: '800' },
  label: { marginTop: 14, marginBottom: 6, color: '#374151', fontWeight: '800' },
  help: { color: '#6B7280', fontSize: 12, lineHeight: 19 },
  warning: { marginTop: 10, color: '#92400E', fontWeight: '700' },
  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  token: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#EEF2FF' },
  tokenText: { color: '#4338CA', fontWeight: '700' },
  template: { minHeight: 170, padding: 12, borderRadius: 9, borderWidth: 1, borderColor: '#D1D5DB', color: '#111827', textAlignVertical: 'top' },
  link: { color: '#4F46E5', fontWeight: '800' },
  students: { marginTop: 8, gap: 6 },
  student: { padding: 10, borderRadius: 8, backgroundColor: '#F9FAFB' },
  studentName: { color: '#111827', fontWeight: '700' },
  preview: { marginTop: 14, padding: 12, borderRadius: 9, backgroundColor: '#EEF2FF' },
  previewText: { color: '#374151', lineHeight: 21 },
  error: { marginTop: 10, color: '#B91C1C' },
  success: { marginTop: 10, color: '#047857' },
  progress: { marginTop: 12 },
  track: { height: 9, marginTop: 6, borderRadius: 9, overflow: 'hidden', backgroundColor: '#C7D2FE' },
  fill: { height: '100%', backgroundColor: '#4F46E5' },
  button: { alignSelf: 'flex-start', minHeight: 43, justifyContent: 'center', marginTop: 14, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#4F46E5' },
  buttonText: { color: '#FFFFFF', fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
