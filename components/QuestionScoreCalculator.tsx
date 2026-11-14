import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { previewQuestionScores, type QuestionScoreSnapshot } from '../lib/questionScoreCalculator';

export default function QuestionScoreCalculator({ snapshot, busy = false, onApply, onClose }: {
  snapshot: QuestionScoreSnapshot;
  busy?: boolean;
  onApply: (scores: Record<string, number>) => void;
  onClose: () => void;
}) {
  const total = snapshot.objectiveCount + snapshot.essayCount;
  const numbers = useMemo(() => Array.from({ length: total }, (_, index) => index + 1), [total]);
  const [inputs, setInputs] = useState<string[]>(() => Array(total).fill(''));
  const [error, setError] = useState('');
  const preview = useMemo(() => previewQuestionScores(snapshot, inputs), [snapshot, inputs]);
  const scoredCount = Object.keys(preview.scores).length;
  const disabled = busy || !!preview.error || scoredCount === 0;
  const label = (number: number) => number <= snapshot.objectiveCount ? String(number) : `서${number - snapshot.objectiveCount}`;
  const formatScore = (score: number) => `${Number(score.toFixed(2))}점`;

  function apply() {
    if (disabled) return;
    try { onApply(preview.scores); }
    catch (cause: any) { setError(cause?.message || '점수를 반영하지 못했습니다.'); }
  }

  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}><View style={styles.dialog}>
      <View style={styles.header}>
        <View style={styles.titleBlock}><Text style={styles.title}>점수 계산기</Text><Text style={styles.subtitle}>{snapshot.title} · 만점 {snapshot.maxScore}점</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="점수 계산기 닫기" style={styles.close} onPress={onClose}><Text style={styles.closeText}>닫기</Text></Pressable>
      </View>
      <Text style={styles.help}>창을 열 때의 오답표입니다. 오답은 이 창에서 수정할 수 없습니다. 문항별 배점을 입력하면 점수가 계산됩니다. 배점은 소수점 둘째 자리까지, 배점 없는 문항은 0을 입력하세요.</Text>
      <Text style={styles.summary}>배점 합계 {preview.totalPoints === null ? '—' : preview.totalPoints} / {snapshot.maxScore}점 · 반영 대상 {scoredCount}명</Text>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled">
          <View style={styles.table}>
            <View style={[styles.row, styles.headingRow]}>
              <View style={[styles.cell, styles.studentCell]}><Text style={styles.heading}>학생 / 배점</Text></View>
              {numbers.map((number) => <View key={number} style={[styles.cell, styles.questionCell, styles.questionHeading]}>
                <Text style={styles.heading}>{label(number)}</Text>
                {!!snapshot.questionNotes[String(number)] && <Text style={styles.memo}>{snapshot.questionNotes[String(number)]}</Text>}
                <TextInput accessibilityLabel={`${label(number)}번 배점`} style={styles.pointInput} value={inputs[number - 1]}
                  keyboardType="decimal-pad" placeholder="배점" placeholderTextColor="#94A3B8" selectTextOnFocus editable={!busy}
                  onChangeText={(value) => { setInputs((current) => current.map((previous, index) => index === number - 1 ? value : previous)); setError(''); }} />
              </View>)}
              <View style={[styles.cell, styles.scoreCell]}><Text style={styles.heading}>계산 점수</Text></View>
            </View>
            {snapshot.students.map((student) => <View key={student.id} style={styles.row}>
              <View style={[styles.cell, styles.studentCell]}><Text style={styles.name}>{student.fullName}</Text><Text style={styles.meta}>{student.studentCode}</Text></View>
              {numbers.map((number) => {
                const wrong = student.wrongNumbers?.includes(number);
                return <View key={number} style={[styles.cell, styles.questionCell, wrong && styles.wrongCell]}>
                  <Text style={wrong ? styles.wrong : styles.meta}>{wrong ? 'X' : student.wrongNumbers === null ? '—' : ''}</Text>
                </View>;
              })}
              <View style={[styles.cell, styles.scoreCell]}><Text accessibilityLabel={`${student.fullName} 계산 점수`} style={student.wrongNumbers === null ? styles.meta : styles.score}>
                {student.wrongNumbers === null ? '미입력' : Object.prototype.hasOwnProperty.call(preview.scores, student.id) ? formatScore(preview.scores[student.id]) : '배점 입력'}
              </Text></View>
            </View>)}
            <View style={[styles.row, styles.totalRow]}>
              <View style={[styles.cell, styles.studentCell]}><Text style={styles.heading}>오답수</Text></View>
              {numbers.map((number) => <View key={number} style={[styles.cell, styles.questionCell]}><Text style={styles.heading}>{snapshot.students.filter((student) => student.wrongNumbers?.includes(number)).length}</Text></View>)}
              <View style={[styles.cell, styles.scoreCell]}><Text style={styles.meta}>—</Text></View>
            </View>
          </View>
        </ScrollView>
      </ScrollView>
      {!!(error || preview.error) && <Text accessibilityRole="alert" style={error || inputs.some((value) => value.trim()) ? styles.error : styles.help}>{error || preview.error}</Text>}
      <Text style={styles.help}>오답표가 미입력인 학생은 기존 점수를 유지합니다. 반영 대상 학생의 기존 점수·결시 표시는 덮어씁니다. 반영 후 차시의 ‘전체 저장’을 눌러야 DB에 저장됩니다.</Text>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" style={styles.cancel} onPress={onClose}><Text style={styles.cancelText}>취소</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={disabled} style={[styles.apply, disabled && styles.disabled]} onPress={apply}><Text style={styles.applyText}>점수 칸에 덮어쓰기{scoredCount > 0 ? ` (${scoredCount}명)` : ''}</Text></Pressable>
      </View>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0007', justifyContent: 'center', alignItems: 'center', padding: 12 },
  dialog: { width: '100%', maxWidth: 1400, maxHeight: '94%', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, titleBlock: { flex: 1 },
  title: { fontSize: 20, fontWeight: '800', color: '#111827' }, subtitle: { fontSize: 14, color: '#475569', marginTop: 5 },
  close: { paddingVertical: 12, paddingHorizontal: 8 }, closeText: { color: '#4F46E5', fontWeight: '700' },
  help: { fontSize: 12, lineHeight: 19, color: '#64748B', marginTop: 10 }, summary: { fontSize: 14, fontWeight: '700', color: '#312E81', marginVertical: 12 },
  scroll: { flexShrink: 1 }, table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#CBD5E1' }, row: { flexDirection: 'row' },
  headingRow: { backgroundColor: '#F1F5F9' }, totalRow: { backgroundColor: '#FEF3C7' },
  cell: { minHeight: 44, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', padding: 5 },
  studentCell: { width: 140, alignItems: 'flex-start' }, questionCell: { width: 82 }, questionHeading: { minHeight: 85 }, scoreCell: { width: 110, backgroundColor: '#EEF2FF' },
  heading: { color: '#334155', fontSize: 12, fontWeight: '800' }, memo: { color: '#64748B', fontSize: 10, textAlign: 'center', marginTop: 3 },
  pointInput: { width: '100%', minHeight: 36, marginTop: 6, borderColor: '#CBD5E1', borderWidth: 1, borderRadius: 5, textAlign: 'center', backgroundColor: '#FFFFFF', color: '#111827', fontSize: 14 },
  name: { color: '#111827', fontSize: 13, fontWeight: '700' }, meta: { color: '#64748B', fontSize: 11 },
  wrongCell: { backgroundColor: '#FECACA' }, wrong: { color: '#991B1B', fontWeight: '800' }, score: { color: '#3730A3', fontWeight: '800', fontSize: 14 },
  error: { color: '#B91C1C', fontSize: 12, lineHeight: 18, marginTop: 10 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12 },
  cancel: { paddingHorizontal: 18, paddingVertical: 13 }, cancelText: { color: '#475569', fontWeight: '700' },
  apply: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: 8, backgroundColor: '#4F46E5' }, applyText: { color: '#FFFFFF', fontWeight: '800' }, disabled: { opacity: 0.4 },
});
