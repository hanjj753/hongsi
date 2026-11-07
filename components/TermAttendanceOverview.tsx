import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getSupabaseTermAttendance } from '../lib/classData';
import type { AttendanceOverview, AttendanceOverviewRow } from '../lib/attendanceOverview';

const widths = [260, 105, 150, 150, 220];
const cellWidth = 108;
export function TermAttendanceOverview({ termLabel, search }: { termLabel: string; search: string }) {
  const [data, setData] = useState<AttendanceOverview>({ maxSession: 0, rows: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setData({ maxSession: 0, rows: [] }); setError('');
    if (!termLabel) return;
    setLoading(true);
    getSupabaseTermAttendance(termLabel).then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(cause?.message || '출석 현황을 불러오지 못했습니다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [termLabel, revision]);
  const rows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('ko-KR');
    return keyword ? data.rows.filter((row) => `${row.className} ${row.fullName} ${row.studentPhone} ${row.parentPhone} ${row.email}`.toLocaleLowerCase('ko-KR').includes(keyword)) : data.rows;
  }, [data, search]);
  if (!termLabel) return <Text style={styles.empty}>분기를 선택하면 모든 수업의 출석 현황이 표시됩니다.</Text>;
  if (loading) return <View style={styles.empty}><ActivityIndicator color="#4F46E5" /><Text style={styles.help}>출석 현황을 불러오는 중...</Text></View>;
  if (error) return <View style={styles.empty}><Text style={styles.error}>{error}</Text><Pressable onPress={() => setRevision((value) => value + 1)}><Text style={styles.retry}>다시 불러오기</Text></Pressable></View>;
  const headers = ['수업', '이름', '학생 전화번호', '학부모 전화번호', '이메일', ...Array.from({ length: data.maxSession }, (_, i) => `${i + 1}차시 출석`)];
  const tableWidth = widths.reduce((total, width) => total + width, 0) + data.maxSession * cellWidth;
  const renderRow = ({ item }: { item: AttendanceOverviewRow }) => <View style={styles.row}>
    {[item.className, item.fullName, item.studentPhone || '-', item.parentPhone || '-', item.email || '-'].map((value, i) => (
      <View key={i} style={[styles.cell, { width: widths[i] }]} {...(Platform.OS === 'web' ? { title: value } as any : {})}><Text numberOfLines={1} style={styles.text}>{value}</Text></View>
    ))}
    {item.cells.map((cell, index) => <Pressable key={index} style={[styles.cell, { width: cellWidth }, cell.transfer && styles.transferBg, cell.makeup && styles.makeupBg]}
      accessibilityLabel={`${item.fullName} ${index + 1}차시 ${cell.text}. ${cell.detail}`}
      {...(Platform.OS === 'web' ? { title: cell.detail } as any : {})}
      onPress={() => { if (Platform.OS !== 'web') Alert.alert(`${item.fullName} · ${index + 1}차시`, `${cell.text}\n${cell.detail}`); }}>
      <Text style={[styles.text, styles.attendance, ['미등록', '미입력', '—'].includes(cell.text) && styles.muted,
        cell.transfer && styles.transfer, cell.makeup && styles.makeup]}>{cell.text}{cell.transfer ? ' ↔' : ''}{cell.makeup && cell.text !== '보강' ? ' *' : ''}</Text>
    </Pressable>)}
  </View>;
  return <View style={styles.container}>
    <View style={styles.summary}><Text style={styles.help}>{termLabel} · {rows.length}행 · 최대 {data.maxSession}차시</Text><Pressable onPress={() => setRevision((value) => value + 1)}><Text style={styles.retry}>새로고침</Text></Pressable></View>
    <Text style={styles.help}><Text style={styles.transfer}>빨강 ↔ 전반</Text> · <Text style={styles.makeup}>파랑 * 보강/클리닉</Text> · 마우스를 올리거나 칸을 누르면 상세 내용을 확인합니다.</Text>
    <Text style={styles.help}>미등록: 수강 기간 밖 · 미입력: 수강 중인 차시의 빈 출석 · —: 일정 또는 임시 참여가 없는 차시</Text>
    <ScrollView horizontal style={styles.horizontal} contentContainerStyle={styles.horizontalContent}>
      <View style={{ width: tableWidth, flex: 1 }}>
        <FlatList data={rows} keyExtractor={(row) => row.key} renderItem={renderRow} stickyHeaderIndices={[0]}
          initialNumToRender={20} windowSize={7} getItemLayout={(_, index) => ({ length: 48, offset: 48 * (index + 1), index })}
          ListHeaderComponent={<View style={[styles.row, styles.header]}>{headers.map((title, i) => <View key={i} style={[styles.cell, { width: widths[i] ?? cellWidth }]}><Text style={styles.heading}>{title}</Text></View>)}</View>}
          ListEmptyComponent={<Text style={styles.empty}>표시할 학생이 없습니다.</Text>} />
      </View>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, gap: 7 }, horizontal: { flex: 1, marginTop: 7, borderWidth: 1, borderColor: '#E2E8F0' }, horizontalContent: { flexGrow: 1 },
  row: { height: 48, flexDirection: 'row', backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }, header: { backgroundColor: '#F1F5F9' },
  cell: { paddingHorizontal: 10, justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#E2E8F0' }, text: { color: '#1F2937', fontSize: 12 },
  heading: { fontSize: 12, color: '#334155', fontWeight: '800' }, attendance: { textAlign: 'center' }, muted: { color: '#94A3B8' },
  transfer: { color: '#B91C1C', fontWeight: '800' }, makeup: { color: '#1D4ED8', fontWeight: '800' }, transferBg: { backgroundColor: '#FFF7F7' }, makeupBg: { backgroundColor: '#EFF6FF' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }, help: { color: '#64748B', fontSize: 12, lineHeight: 18 },
  retry: { color: '#4F46E5', fontSize: 13, fontWeight: '800', padding: 5 }, empty: { padding: 24, color: '#64748B', textAlign: 'center' }, error: { color: '#B91C1C' },
});
