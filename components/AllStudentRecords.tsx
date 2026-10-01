import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import {
  getSupabaseAllStudentOverviews,
  getSupabaseStudentRecordHistory,
  type StudentRecordHistory,
  type StudentOverview,
} from '../lib/classData';

const statusLabel = { active: '수강 중', transferred: '전반', withdrawn: '퇴원' } as const;

export function AllStudentRecords() {
  const { width } = useWindowDimensions();
  const narrow = width < 720;
  const [visible, setVisible] = useState(false);
  const [students, setStudents] = useState<StudentOverview[]>([]);
  const [selected, setSelected] = useState<StudentOverview | null>(null);
  const [history, setHistory] = useState<StudentRecordHistory>({ attendance: [], homeworks: [], tests: [] });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('ko-KR');
    return keyword ? students.filter((student) => `${student.fullName} ${student.studentCode}`.toLocaleLowerCase('ko-KR').includes(keyword)) : students;
  }, [search, students]);

  const open = async () => {
    setVisible(true); setLoading(true); setError(''); setSelected(null); setHistory({ attendance: [], homeworks: [], tests: [] });
    try { setStudents(await getSupabaseAllStudentOverviews()); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : '학생 기록을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  };

  const selectStudent = async (student: StudentOverview) => {
    setSelected(student); setHistoryLoading(true); setError('');
    try { setHistory(await getSupabaseStudentRecordHistory(student.id)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : '출석 기록을 불러오지 못했습니다.'); }
    finally { setHistoryLoading(false); }
  };

  return (
    <>
      <Pressable style={styles.openButton} onPress={() => void open()}>
        <Ionicons name="people-outline" size={18} color="#4F46E5" />
        <Text style={styles.openText}>전체 학생 기록</Text>
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <View style={styles.header}>
              <View><Text style={styles.title}>전체 학생 기록</Text><Text style={styles.subtitle}>수업·전반 이력과 모든 반의 출석을 한곳에서 확인합니다.</Text></View>
              <Pressable accessibilityLabel="닫기" onPress={() => setVisible(false)}><Ionicons name="close" size={25} color="#4B5563" /></Pressable>
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <View style={[styles.body, narrow && styles.bodyNarrow]}>
              <View style={[styles.studentPane, narrow && styles.studentPaneNarrow]}>
                <TextInput value={search} onChangeText={setSearch} style={styles.search} placeholder="이름 또는 학생 ID 검색" placeholderTextColor="#9CA3AF" />
                {loading ? <ActivityIndicator style={styles.loader} color="#4F46E5" /> : (
                  <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                    {filtered.map((student) => (
                      <Pressable key={student.id} style={[styles.studentRow, selected?.id === student.id && styles.studentRowSelected]} onPress={() => void selectStudent(student)}>
                        <Text style={styles.studentName}>{student.fullName}</Text><Text style={styles.studentCode}>{student.studentCode}</Text>
                      </Pressable>
                    ))}
                    {filtered.length === 0 && <Text style={styles.empty}>검색 결과가 없습니다.</Text>}
                  </ScrollView>
                )}
              </View>
              <ScrollView style={[styles.detailPane, narrow && styles.detailPaneNarrow]} contentContainerStyle={styles.detailContent}>
                {!selected ? <Text style={styles.empty}>왼쪽에서 학생을 선택해 주세요.</Text> : (
                  <>
                    <Text style={styles.detailTitle}>{selected.fullName} <Text style={styles.detailCode}>{selected.studentCode}</Text></Text>
                    <Text style={styles.sectionTitle}>수강 이력</Text>
                    {selected.enrollments.map((item) => (
                      <View key={`${item.classId}-${item.joinedOn}`} style={styles.historyCard}>
                        <View style={styles.historyTop}><Text style={styles.historyName}>{item.termLabel} · {item.className}</Text><Text style={styles.status}>{statusLabel[item.status]}</Text></View>
                        <Text style={styles.historyMeta}>{item.joinedOn || '시작일 없음'}{item.endedOn ? ` ~ ${item.endedOn}` : ' ~ 수강 중'}{item.transferredToClassName ? ` · ${item.transferredToClassName}(으)로 전반` : ''}</Text>
                      </View>
                    ))}
                    <Text style={styles.sectionTitle}>출석 기록</Text>
                    {historyLoading ? <ActivityIndicator color="#4F46E5" /> : history.attendance.length === 0 ? <Text style={styles.empty}>저장된 출석 기록이 없습니다.</Text> : history.attendance.map((item) => (
                      <View key={`${item.sessionId}-${item.className}`} style={styles.attendanceRow}>
                        <View style={styles.attendanceText}><Text style={styles.historyName}>{item.sessionDate} · {item.className} {item.sessionNumber}차시</Text><Text style={styles.historyMeta}>{item.termLabel}{item.makeupRelationLabel ? ` · ${item.makeupRelationLabel}` : ''}</Text></View>
                        <Text style={styles.attendanceStatus}>{item.status || '미입력'}</Text>
                      </View>
                    ))}
                    <Text style={styles.sectionTitle}>숙제 기록</Text>
                    {history.homeworks.length === 0 ? <Text style={styles.empty}>저장된 숙제 기록이 없습니다.</Text> : history.homeworks.map((item, index) => (
                      <View key={`${item.sessionId}-${item.title}-${index}`} style={styles.attendanceRow}>
                        <View style={styles.attendanceText}><Text style={styles.historyName}>{item.sessionDate} · {item.className} {item.sessionNumber}차시 · {item.title}</Text><Text style={styles.historyMeta}>{item.termLabel}{item.makeupRelationLabel ? ` · ${item.makeupRelationLabel}` : ''}</Text></View>
                        <Text style={styles.attendanceStatus}>{item.grade}</Text>
                      </View>
                    ))}
                    <Text style={styles.sectionTitle}>시험 기록</Text>
                    {history.tests.length === 0 ? <Text style={styles.empty}>저장된 시험 기록이 없습니다.</Text> : history.tests.map((item, index) => (
                      <View key={`${item.sessionId}-${item.title}-${index}`} style={styles.attendanceRow}>
                        <View style={styles.attendanceText}><Text style={styles.historyName}>{item.sessionDate} · {item.className} {item.sessionNumber}차시 · {item.title}</Text><Text style={styles.historyMeta}>{item.termLabel}{item.makeupRelationLabel ? ` · ${item.makeupRelationLabel}` : ''}</Text></View>
                        <Text style={styles.attendanceStatus}>{item.status === '결시' ? '결시' : item.resultType === 'memo' ? item.resultText || '미입력' : item.score ?? '미입력'}</Text>
                      </View>
                    ))}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  openButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#C7D2FE', backgroundColor: '#FFFFFF' },
  openText: { color: '#4F46E5', fontSize: 13, fontWeight: '800' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(17,24,39,0.55)' },
  modal: { width: '100%', maxWidth: 1100, height: '86%', borderRadius: 18, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  title: { color: '#111827', fontSize: 19, fontWeight: '900' },
  subtitle: { marginTop: 4, color: '#6B7280', fontSize: 12 },
  error: { margin: 12, padding: 10, borderRadius: 8, color: '#B91C1C', backgroundColor: '#FEF2F2' },
  body: { flex: 1, flexDirection: 'row' },
  bodyNarrow: { flexDirection: 'column' },
  studentPane: { width: 280, padding: 13, borderRightWidth: 1, borderRightColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  studentPaneNarrow: { width: '100%', maxHeight: 230, borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  search: { height: 42, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: '#D1D5DB', color: '#111827', backgroundColor: '#FFFFFF' },
  loader: { marginTop: 24 }, list: { marginTop: 10 },
  studentRow: { padding: 11, marginBottom: 5, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  studentRowSelected: { borderColor: '#A5B4FC', backgroundColor: '#EEF2FF' },
  studentName: { color: '#111827', fontWeight: '800' }, studentCode: { marginTop: 3, color: '#6B7280', fontSize: 11 },
  detailPane: { flex: 1 }, detailContent: { padding: 18 },
  detailPaneNarrow: { width: '100%' },
  detailTitle: { color: '#111827', fontSize: 20, fontWeight: '900' }, detailCode: { color: '#6B7280', fontSize: 13 },
  sectionTitle: { marginTop: 20, marginBottom: 8, color: '#374151', fontSize: 14, fontWeight: '900' },
  historyCard: { marginBottom: 7, padding: 11, borderRadius: 9, borderWidth: 1, borderColor: '#E5E7EB' },
  historyTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, historyName: { flex: 1, color: '#111827', fontSize: 12, fontWeight: '800' },
  historyMeta: { marginTop: 4, color: '#6B7280', fontSize: 11 }, status: { color: '#4338CA', fontSize: 11, fontWeight: '800' },
  attendanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  attendanceText: { flex: 1 }, attendanceStatus: { minWidth: 48, textAlign: 'center', color: '#3730A3', fontSize: 12, fontWeight: '900' },
  empty: { padding: 18, color: '#6B7280', textAlign: 'center' },
});
