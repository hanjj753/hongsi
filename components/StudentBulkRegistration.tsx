import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { saveAndEnrollSupabaseStudents, type StudentInput } from '../lib/classData';

type Row = StudentInput & { key: number; joinedOn: string };
type FieldKey = 'studentCode' | 'fullName' | 'studentPhone' | 'parentPhone' | 'email' | 'joinedOn';
const fields: Array<{ key: FieldKey; label: string; width: number; placeholder: string }> = [
  { key: 'fullName', label: '이름 *', width: 120, placeholder: '학생 이름' },
  { key: 'studentCode', label: '학생 ID', width: 130, placeholder: '빈칸이면 자동 생성' },
  { key: 'studentPhone', label: '학생 전화번호', width: 160, placeholder: '010-1234-5678' },
  { key: 'parentPhone', label: '학부모 전화번호', width: 160, placeholder: '010-1234-5678' },
  { key: 'email', label: '이메일', width: 190, placeholder: 'student@example.com' },
  { key: 'joinedOn', label: '수강 시작일 *', width: 135, placeholder: 'YYYY-MM-DD' },
];

export default function StudentBulkRegistration({ classId, joinedOn, onClose, onSaved }: {
  classId: string; joinedOn: string; onClose: () => void; onSaved: (count: number) => Promise<void>;
}) {
  const nextKey = useRef(6);
  const inputs = useRef(new Map<string, TextInput>());
  const makeRow = (key: number): Row => ({
    key, studentCode: '', fullName: '', studentPhone: '', parentPhone: '', email: '',
    defaultMessageRecipients: 'parent', joinedOn,
  });
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, (_, index) => makeRow(index + 1)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filled = rows.filter((row) => fields.some((field) => field.key !== 'joinedOn' && row[field.key].trim()));

  const patch = (key: number, change: Partial<Row>) => {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...change } : row));
    setError('');
  };
  const addRow = () => setRows((current) => [...current, makeRow(nextKey.current++)]);
  const close = () => {
    if (busy) return;
    if (!filled.length) { onClose(); return; }
    const message = '입력 중인 학생 정보가 사라집니다. 닫을까요?';
    if (Platform.OS === 'web') { if (window.confirm(message)) onClose(); }
    else Alert.alert('빠른 등록 닫기', message, [{ text: '계속 입력', style: 'cancel' }, { text: '닫기', onPress: onClose }]);
  };
  const save = async () => {
    if (busy || !filled.length) return;
    setBusy(true); setError('');
    try {
      const count = await saveAndEnrollSupabaseStudents(classId, filled);
      await onSaved(count);
      onClose();
    } catch (cause: any) { setError(cause?.message || '학생을 등록하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const focusNext = (rowIndex: number, field: FieldKey) => {
    const next = rows[rowIndex + 1];
    if (next) inputs.current.get(`${next.key}:${field}`)?.focus();
    else if (rows.length < 100) {
      const key = nextKey.current++;
      setRows((current) => [...current, makeRow(key)]);
      setTimeout(() => inputs.current.get(`${key}:${field}`)?.focus(), 0);
    }
  };

  return <Modal visible animationType="fade" onRequestClose={close}>
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}><Text style={styles.title}>학생 빠른 등록</Text>
          <Text style={styles.guide}>여러 학생을 한 번에 입력하세요. Tab은 다음 칸, Enter는 같은 항목의 다음 학생으로 이동합니다. 빈 행은 저장하지 않습니다.</Text></View>
        <Pressable disabled={busy || filled.length === 0} style={[styles.saveButton, (busy || !filled.length) && styles.disabled]} onPress={() => void save()}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>{filled.length}명 등록</Text>}
        </Pressable>
        <Pressable accessibilityLabel="빠른 등록 닫기" onPress={close} style={styles.close}><Text style={styles.closeText}>닫기</Text></Pressable>
      </View>
      <Text style={styles.hint}>학생 ID는 비우면 자동 생성됩니다. 같은 학생을 다른 수업에도 등록하려면 기존 학생 ID를 입력하세요. 학생·학부모 모두 수신을 선택하려면 학생 전화번호가 필요합니다.</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <ScrollView style={styles.vertical} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled">
          <View>
            <View style={styles.row}>
              <Text style={[styles.heading, { width: 48 }]}>#</Text>
              {fields.map((field) => <Text key={field.key} style={[styles.heading, { width: field.width }]}>{field.label}</Text>)}
              <Text style={[styles.heading, { width: 130 }]}>기본 문자 수신</Text>
              <Text style={[styles.heading, { width: 54 }]}>삭제</Text>
            </View>
            {rows.map((row, rowIndex) => <View key={row.key} style={styles.row}>
              <Text style={[styles.number, { width: 48 }]}>{rowIndex + 1}</Text>
              {fields.map((field) => <View key={field.key} style={[styles.cell, { width: field.width }]}>
                <TextInput ref={(input) => { const key = `${row.key}:${field.key}`; if (input) inputs.current.set(key, input); else inputs.current.delete(key); }}
                  accessibilityLabel={`${rowIndex + 1}행 ${field.label}`} style={styles.input}
                  value={row[field.key]} onChangeText={(value) => patch(row.key, { [field.key]: value })}
                  onKeyPress={(event) => { const native = event.nativeEvent as typeof event.nativeEvent & { isComposing?: boolean; keyCode?: number };
                    if (native.key === 'Enter' && !native.isComposing && native.keyCode !== 229) { event.preventDefault(); focusNext(rowIndex, field.key); } }}
                  placeholder={field.placeholder} placeholderTextColor="#94A3B8"
                  autoCapitalize={field.key === 'email' ? 'none' : 'sentences'} editable={!busy} />
              </View>)}
              <View style={[styles.cell, { width: 130 }]}><Pressable disabled={busy} style={styles.recipient}
                onPress={() => patch(row.key, { defaultMessageRecipients: row.defaultMessageRecipients === 'parent' ? 'both' : 'parent' })}>
                <Text style={styles.recipientText}>{row.defaultMessageRecipients === 'parent' ? '학부모만' : '학생+학부모'}</Text>
              </Pressable></View>
              <View style={[styles.cell, { width: 54 }]}><Pressable disabled={busy || rows.length === 1}
                onPress={() => setRows((current) => current.filter((item) => item.key !== row.key))}>
                <Text style={styles.remove}>×</Text>
              </Pressable></View>
            </View>)}
          </View>
        </ScrollView>
      </ScrollView>
      <View style={styles.footer}><Pressable disabled={busy || rows.length >= 100} style={styles.addButton} onPress={addRow}>
        <Text style={styles.addText}>+ 행 추가</Text>
      </Pressable><Text style={styles.guide}>최대 100명 · 등록은 한 번에 저장됩니다</Text></View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  title: { color: '#111827', fontSize: 21, fontWeight: '800' }, guide: { color: '#64748B', fontSize: 12, marginTop: 5 },
  saveButton: { minWidth: 106, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#4F46E5' },
  saveText: { color: '#FFFFFF', fontWeight: '800' }, disabled: { opacity: 0.45 }, close: { padding: 10 }, closeText: { color: '#475569', fontWeight: '700' },
  hint: { margin: 16, padding: 11, borderRadius: 8, backgroundColor: '#EEF2FF', color: '#4338CA', lineHeight: 19 },
  error: { marginHorizontal: 16, color: '#B91C1C', fontWeight: '700' },
  vertical: { flex: 1, marginHorizontal: 16, marginBottom: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1' },
  row: { flexDirection: 'row' },
  heading: { minHeight: 44, padding: 7, textAlign: 'center', textAlignVertical: 'center', fontSize: 12, fontWeight: '800', color: '#334155', backgroundColor: '#E2E8F0', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#CBD5E1' },
  number: { minHeight: 52, textAlign: 'center', textAlignVertical: 'center', color: '#64748B', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#E2E8F0' },
  cell: { minHeight: 52, padding: 5, justifyContent: 'center', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#E2E8F0' },
  input: { minHeight: 38, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 6, paddingHorizontal: 7, color: '#111827', fontSize: 12 },
  recipient: { minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: '#EEF2FF' },
  recipientText: { color: '#4338CA', fontSize: 11, fontWeight: '700' }, remove: { color: '#B91C1C', textAlign: 'center', fontSize: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingBottom: 18 },
  addButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: '#E0E7FF' }, addText: { color: '#4338CA', fontWeight: '800' },
});
