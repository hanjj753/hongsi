import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Picker } from './ReadablePicker';
import type { ClassStudent, SessionTest } from '../lib/classData';
import { getQuestionSheet, parseWrongQuestionList, questionLabel, saveQuestionSheet } from '../lib/questionSheetData';
import { buildQuestionSheetHtml, openPdfDocument } from '../lib/printDocuments';

const questionCellWidth = 82;
type Props = {
  classId: string;
  sessionId: string;
  sessionDate: string;
  classLabel: string;
  tests: SessionTest[];
  students: ClassStudent[];
  onDirtyChange?: (dirty: boolean) => void;
};

export type QuestionSheetHandle = { save: () => Promise<boolean> };

const numbersText = (numbers: number[], objectiveCount: number) =>
  numbers.map((number) => questionLabel(number, objectiveCount)).join(', ');

function sheetSnapshot(objectiveCount: number, essayCount: number, rows: Record<string, number[]>, notes: Record<string, string>): string {
  return JSON.stringify({ objectiveCount, essayCount, notes: Object.entries(notes).filter(([, note]) => note.trim())
    .sort(([left], [right]) => Number(left) - Number(right)), rows: Object.entries(rows)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([studentId, numbers]) => [studentId, [...numbers].sort((left, right) => left - right)]) });
}

const TestQuestionSheet = React.forwardRef<QuestionSheetHandle, Props>(function TestQuestionSheet({ classId, sessionId, sessionDate, classLabel, tests, students, onDirtyChange }, ref) {
  const [testId, setTestId] = useState('');
  const [objectiveText, setObjectiveText] = useState('');
  const [essayText, setEssayText] = useState('');
  const [wrongByStudent, setWrongByStudent] = useState<Record<string, number[]>>({});
  const [questionNotes, setQuestionNotes] = useState<Record<string, string>>({});
  const [numberInputs, setNumberInputs] = useState<Record<string, string>>({});
  const [pendingInputs, setPendingInputs] = useState<Record<string, boolean>>({});
  const [savedObjectiveCount, setSavedObjectiveCount] = useState<number | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [savedFormSnapshot, setSavedFormSnapshot] = useState('');
  const [loadedTestId, setLoadedTestId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedTest = tests.find((item) => item.id === testId);
  const objectiveCount = Number(objectiveText);
  const essayCount = Number(essayText);
  const countsValid = /^\d+$/.test(objectiveText) && /^\d+$/.test(essayText)
    && objectiveCount + essayCount >= 1 && objectiveCount + essayCount <= 100;
  const total = countsValid ? objectiveCount + essayCount : 0;
  const questionNumbers = useMemo(() => Array.from({ length: total }, (_, index) => index + 1), [total]);
  const rosterRows = useMemo(() => {
    const roster = new Set(students.map((student) => student.id));
    return Object.fromEntries(Object.entries(wrongByStudent).filter(([studentId]) => roster.has(studentId)));
  }, [students, wrongByStudent]);
  const hasChanges = countsValid && loadedTestId === testId
    && (savedSnapshot === null || savedSnapshot !== sheetSnapshot(objectiveCount, essayCount, rosterRows, questionNotes));
  const saveDisabled = busy || loading || !hasChanges;
  const formSnapshot = JSON.stringify({ objectiveText, essayText, wrongByStudent: rosterRows, numberInputs, questionNotes });
  const isDirty = loadedTestId === testId && savedFormSnapshot !== '' && formSnapshot !== savedFormSnapshot;

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!tests.some((item) => item.id === testId)) setTestId(tests[0]?.id ?? '');
  }, [testId, tests]);

  useEffect(() => {
    let active = true;
    setError(''); setNotice('');
    setObjectiveText(''); setEssayText(''); setWrongByStudent({}); setQuestionNotes({}); setNumberInputs({}); setPendingInputs({}); setSavedObjectiveCount(null);
    setSavedSnapshot(null); setSavedFormSnapshot(''); setLoadedTestId('');
    if (!testId) return () => { active = false; };
    setLoading(true);
    void getQuestionSheet(testId).then((sheet) => {
      if (!active) return;
      if (sheet) {
        setObjectiveText(String(sheet.objectiveCount));
        setEssayText(String(sheet.essayCount));
        setSavedObjectiveCount(sheet.objectiveCount);
        const allowed = new Set(students.map((student) => student.id));
        const rows = Object.fromEntries(Object.entries(sheet.wrongByStudent).filter(([id]) => allowed.has(id)));
        setWrongByStudent(rows);
        setQuestionNotes(sheet.questionNotes);
        setNumberInputs(Object.fromEntries(Object.entries(rows).map(([id, numbers]) => [id, numbersText(numbers, sheet.objectiveCount)])));
        setSavedSnapshot(sheetSnapshot(sheet.objectiveCount, sheet.essayCount, rows, sheet.questionNotes));
        setSavedFormSnapshot(JSON.stringify({ objectiveText: String(sheet.objectiveCount), essayText: String(sheet.essayCount), wrongByStudent: rows, numberInputs: Object.fromEntries(Object.entries(rows).map(([id, numbers]) => [id, numbersText(numbers, sheet.objectiveCount)])), questionNotes: sheet.questionNotes }));
      } else {
        setSavedFormSnapshot(JSON.stringify({ objectiveText: '', essayText: '', wrongByStudent: {}, numberInputs: {}, questionNotes: {} }));
      }
      setLoadedTestId(testId);
    }).catch((cause) => { if (active) setError(cause?.message || '오답표를 불러오지 못했습니다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [testId, sessionId]);

  function setRow(studentId: string, wrongNumbers: number[] | null) {
    if (wrongNumbers !== null && savedObjectiveCount === null) setSavedObjectiveCount(objectiveCount);
    setWrongByStudent((current) => {
      const next = { ...current };
      if (wrongNumbers === null) delete next[studentId];
      else next[studentId] = wrongNumbers;
      return next;
    });
    setNumberInputs((current) => ({ ...current, [studentId]: wrongNumbers === null ? '' : numbersText(wrongNumbers, objectiveCount) }));
    setPendingInputs((current) => { const next = { ...current }; delete next[studentId]; return next; });
    setNotice(''); setError('');
  }

  function toggleWrong(studentId: string, number: number) {
    const previous = wrongByStudent[studentId] ?? [];
    const next = previous.includes(number) ? previous.filter((item) => item !== number)
      : [...previous, number].sort((a, b) => a - b);
    setRow(studentId, next);
  }

  function applyNumbers(studentId: string, name: string) {
    try {
      setRow(studentId, parseWrongQuestionList(numberInputs[studentId] ?? '', objectiveCount, essayCount));
    } catch (cause: any) { setError(`${name}: ${cause?.message || '문항 번호를 확인해 주세요.'}`); }
  }

  function validate(): boolean {
    if (!selectedTest) { setError('시험을 먼저 추가해 주세요.'); return false; }
    if (!countsValid) { setError('객관식·서술형 문항 수를 입력해 주세요. 합계는 1~100문항입니다.'); return false; }
    if (savedObjectiveCount !== null && objectiveCount !== savedObjectiveCount && (Object.keys(wrongByStudent).length > 0 || Object.keys(questionNotes).length > 0)) {
      setError('객관식 문항 수를 바꾸면 서술형 오답·문항 메모 번호가 달라집니다. 아래에서 기존 입력을 초기화하고 다시 입력해 주세요.');
      return false;
    }
    if (Object.keys(questionNotes).some((number) => Number(number) > total)) { setError('문항 수가 줄어 기존 문항 메모가 범위를 벗어났습니다.'); return false; }
    if (Object.values(pendingInputs).some(Boolean)) { setError('번호 입력 후 각 학생의 적용을 먼저 눌러 주세요.'); return false; }
    const roster = new Set(students.map((student) => student.id));
    const invalid = Object.entries(wrongByStudent).some(([studentId, numbers]) => roster.has(studentId)
      && numbers.some((number) => number < 1 || number > total));
    if (invalid) { setError('문항 수가 줄어 기존 오답 번호가 범위를 벗어났습니다. 학생별 번호를 고쳐 주세요.'); return false; }
    return true;
  }

  async function save(): Promise<boolean> {
    if (busy || loading || !validate()) return false;
    if (!hasChanges) return true;
    setBusy(true); setError(''); setNotice('');
    try {
      await saveQuestionSheet(classId, sessionId, { testId, objectiveCount, essayCount, wrongByStudent: rosterRows, questionNotes });
      setWrongByStudent(rosterRows);
      setSavedObjectiveCount(objectiveCount);
      setSavedSnapshot(sheetSnapshot(objectiveCount, essayCount, rosterRows, questionNotes));
      setSavedFormSnapshot(formSnapshot);
      setNotice('오답표를 저장했습니다. 시험 점수는 변경되지 않습니다.');
      return true;
    } catch (cause: any) { setError(cause?.message || '오답표를 저장하지 못했습니다.'); return false; }
    finally { setBusy(false); }
  }

  React.useImperativeHandle(ref, () => ({ save }));

  async function print() {
    if (!validate() || !selectedTest) return;
    setBusy(true); setError('');
    try {
      await openPdfDocument(buildQuestionSheetHtml({
        title: `${classLabel} ${sessionDate}`, date: sessionDate, testTitle: selectedTest.title,
        objectiveCount, essayCount, questionNotes,
        rows: students.map((student) => ({
          studentName: student.fullName, studentCode: student.studentCode,
          entered: Object.prototype.hasOwnProperty.call(wrongByStudent, student.id),
          wrongNumbers: wrongByStudent[student.id] ?? [],
        })),
      }));
    } catch (cause: any) { setError(cause?.message || 'PDF를 열지 못했습니다.'); }
    finally { setBusy(false); }
  }

  return <View style={styles.panel}>
    <Text style={styles.title}>시험 오답표</Text>
    <Text style={styles.help}>시험을 선택한 뒤 틀린 문항을 X로 표시합니다. 점수 입력과는 별도로 저장됩니다.</Text>
    {tests.length === 0 ? <Text style={styles.empty}>위의 차시 항목 구성에서 시험을 먼저 추가해 주세요.</Text> : <>
      <Text style={styles.label}>시험 선택</Text>
      <View style={styles.pickerFrame}><Picker selectedValue={testId} onValueChange={(value) => setTestId(String(value))}>
        {tests.map((test) => <Picker.Item key={test.id} value={test.id} label={test.title} />)}
      </Picker></View>
      {loading ? <ActivityIndicator color="#4F46E5" style={{ marginTop: 18 }} /> : <>
        <View style={styles.counts}>
          <View style={styles.countField}><Text style={styles.label}>객관식 문항 수</Text><TextInput style={styles.input} keyboardType="number-pad" value={objectiveText} onChangeText={(text) => { setObjectiveText(text); setNotice(''); }} placeholder="예: 24" placeholderTextColor="#9CA3AF" /></View>
          <View style={styles.countField}><Text style={styles.label}>서술형 문항 수</Text><TextInput style={styles.input} keyboardType="number-pad" value={essayText} onChangeText={(text) => { setEssayText(text); setNotice(''); }} placeholder="예: 2 또는 0" placeholderTextColor="#9CA3AF" /></View>
        </View>
        <Text style={styles.help}>문항 번호 아래에 간단한 설명을 적을 수 있습니다. 번호 입력 예: 1, 5, 서2 · 번호를 적은 뒤 적용을 눌러야 반영됩니다. 빈칸을 적용하면 전부 정답입니다.</Text>
        {savedObjectiveCount !== null && objectiveCount !== savedObjectiveCount && (Object.keys(wrongByStudent).length > 0 || Object.keys(questionNotes).length > 0) && <View style={styles.warning}>
          <Text style={styles.warningText}>객관식 문항 수가 바뀌면 기존 서술형 번호의 의미가 달라집니다. 기존 오답·문항 메모를 초기화하고 다시 입력해 주세요.</Text>
          <Pressable onPress={() => { setWrongByStudent({}); setQuestionNotes({}); setNumberInputs({}); setPendingInputs({}); setSavedObjectiveCount(objectiveCount); setError(''); setNotice('기존 오답·문항 메모를 초기화했습니다. 다시 입력한 뒤 저장해 주세요.'); }}>
            <Text style={styles.warningAction}>기존 입력 초기화</Text>
          </Pressable>
        </View>}
        {countsValid && !(savedObjectiveCount !== null && objectiveCount !== savedObjectiveCount && (Object.keys(wrongByStudent).length > 0 || Object.keys(questionNotes).length > 0)) && <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
          <View>
            <View style={[styles.tableRow, styles.headingRow]}>
              <Text style={[styles.cell, styles.studentCell, styles.headingText]}>학생</Text>
              {questionNumbers.map((number) => <View key={number} style={[styles.cell, styles.questionCell, styles.questionHeading]}>
                <Text style={styles.headingText}>{questionLabel(number, objectiveCount)}</Text>
                <TextInput accessibilityLabel={`${questionLabel(number, objectiveCount)}번 문항 메모`} style={styles.questionMemo}
                  value={questionNotes[String(number)] ?? ''} maxLength={60} editable={!busy}
                  onChangeText={(note) => { setQuestionNotes((current) => {
                    const next = { ...current };
                    if (note.trim()) next[String(number)] = note;
                    else delete next[String(number)];
                    return next;
                  }); setNotice(''); }}
                  placeholder="메모" placeholderTextColor="#94A3B8" />
              </View>)}
              <Text style={[styles.cell, styles.totalCell, styles.headingText]}>오답수</Text>
              <Text style={[styles.cell, styles.inputCell, styles.headingText]}>틀린 번호 일괄 입력</Text>
            </View>
            {students.map((student) => {
              const entered = Object.prototype.hasOwnProperty.call(wrongByStudent, student.id);
              const wrongs = wrongByStudent[student.id] ?? [];
              return <View key={student.id} style={styles.tableRow}>
                <View style={[styles.cell, styles.studentCell]}><Text style={styles.name}>{student.fullName}</Text><Text style={styles.studentMeta}>{entered ? '입력됨' : '미입력'}</Text></View>
                {questionNumbers.map((number) => <Pressable key={number} accessibilityRole="button" accessibilityLabel={`${student.fullName} ${questionLabel(number, objectiveCount)}번 ${wrongs.includes(number) ? '오답' : '정답'}`}
                  onPress={() => toggleWrong(student.id, number)} style={[styles.cell, styles.questionCell, wrongs.includes(number) && styles.wrongCell]}>
                  <Text style={styles.wrongText}>{wrongs.includes(number) ? 'X' : ''}</Text>
                </Pressable>)}
                <Text style={[styles.cell, styles.totalCell, styles.totalText]}>{entered ? wrongs.length : '—'}</Text>
                <View style={[styles.cell, styles.inputCell, styles.inputActions]}>
                  <TextInput style={styles.rowInput} value={numberInputs[student.id] ?? ''} onChangeText={(text) => { setNumberInputs((current) => ({ ...current, [student.id]: text })); setPendingInputs((current) => ({ ...current, [student.id]: true })); setNotice(''); }} placeholder="1, 4, 서2" placeholderTextColor="#94A3B8" />
                  <Pressable onPress={() => applyNumbers(student.id, student.fullName)}><Text style={styles.action}>적용</Text></Pressable>
                  <Pressable onPress={() => setRow(student.id, [])}><Text style={styles.action}>전부 정답</Text></Pressable>
                  <Pressable onPress={() => setRow(student.id, null)}><Text style={styles.mutedAction}>미입력</Text></Pressable>
                </View>
              </View>;
            })}
            <View style={[styles.tableRow, styles.totalRow]}>
              <Text style={[styles.cell, styles.studentCell, styles.totalText]}>오답수</Text>
              {questionNumbers.map((number) => <Text key={number} style={[styles.cell, styles.questionCell, styles.totalText]}>{students.filter((student) => wrongByStudent[student.id]?.includes(number)).length}</Text>)}
              <Text style={[styles.cell, styles.totalCell, styles.totalText]}>{students.reduce((sum, student) => sum + (wrongByStudent[student.id]?.length ?? 0), 0)}</Text>
              <Text style={[styles.cell, styles.inputCell]} />
            </View>
          </View>
        </ScrollView>}
        {students.length === 0 && <Text style={styles.empty}>이 차시에 표시할 학생이 없습니다.</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        <View style={styles.actions}>
          <Pressable disabled={saveDisabled} style={[styles.button, saveDisabled && styles.disabled]} onPress={() => void save()}><Text style={styles.buttonText}>{busy ? '처리 중...' : '오답표 저장'}</Text></Pressable>
          <Pressable disabled={busy || loading || !countsValid || loadedTestId !== testId} style={[styles.outlineButton, (busy || loading || !countsValid || loadedTestId !== testId) && styles.disabled]} onPress={() => void print()}><Text style={styles.outlineText}>PDF 저장 / 인쇄</Text></Pressable>
        </View>
      </>}
    </>}
  </View>;
});

export default TestQuestionSheet;

const styles = StyleSheet.create({
  panel: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 16, marginTop: 20 },
  title: { fontSize: 18, fontWeight: '800', color: '#111827' }, help: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 6 },
  empty: { color: '#6B7280', marginTop: 12 }, label: { color: '#374151', fontSize: 13, fontWeight: '700', marginTop: 14, marginBottom: 5 },
  pickerFrame: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, overflow: 'hidden' },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, countField: { minWidth: 130, flexGrow: 1 },
  input: { minHeight: 42, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, color: '#111827' },
  tableScroll: { marginTop: 14, borderWidth: 1, borderColor: '#CBD5E1' }, tableRow: { flexDirection: 'row' },
  headingRow: { backgroundColor: '#F1F5F9' }, totalRow: { backgroundColor: '#FEF3C7' },
  cell: { minHeight: 37, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  studentCell: { width: 130, paddingHorizontal: 6, alignItems: 'flex-start' }, questionCell: { width: questionCellWidth },
  questionHeading: { minHeight: 67, paddingHorizontal: 3 },
  questionMemo: { width: '100%', minHeight: 28, marginTop: 3, paddingHorizontal: 3, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 4, backgroundColor: '#FFFFFF', color: '#334155', fontSize: 10, textAlign: 'center' },
  totalCell: { width: 65, backgroundColor: '#FEF3C7' }, inputCell: { width: 315 },
  headingText: { color: '#334155', fontWeight: '800', fontSize: 12 }, name: { color: '#111827', fontWeight: '700', fontSize: 12 },
  studentMeta: { color: '#64748B', fontSize: 10 }, wrongCell: { backgroundColor: '#FECACA' }, wrongText: { color: '#991B1B', fontWeight: '800', fontSize: 13 },
  totalText: { color: '#78350F', fontWeight: '800', fontSize: 12 }, inputActions: { flexDirection: 'row', gap: 5, paddingHorizontal: 4 },
  rowInput: { flex: 1, minWidth: 105, minHeight: 30, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 6, paddingHorizontal: 5, fontSize: 12, color: '#111827' },
  action: { color: '#4F46E5', fontWeight: '800', fontSize: 11 }, mutedAction: { color: '#64748B', fontWeight: '700', fontSize: 11 },
  error: { color: '#B91C1C', marginTop: 10 }, notice: { color: '#047857', marginTop: 10 },
  warning: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 12 },
  warningText: { color: '#92400E', fontSize: 12, lineHeight: 18 }, warningAction: { color: '#92400E', fontWeight: '800', marginTop: 6, textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  button: { backgroundColor: '#4F46E5', borderRadius: 8, paddingHorizontal: 15, paddingVertical: 11 }, buttonText: { color: '#FFFFFF', fontWeight: '800' },
  outlineButton: { borderWidth: 1, borderColor: '#4F46E5', borderRadius: 8, paddingHorizontal: 15, paddingVertical: 11 }, outlineText: { color: '#4F46E5', fontWeight: '800' },
  disabled: { opacity: 0.4 },
});
