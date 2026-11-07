import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getSupabaseTermAttendance } from '../lib/classData';
import type { AttendanceOverview, AttendanceOverviewCell, AttendanceOverviewRow } from '../lib/attendanceOverview';

const fixedHeaders = ['수업', '이름', '학생 전화번호', '학부모 전화번호', '이메일'];
const attendanceText = (cell: AttendanceOverviewCell) => `${cell.text}${cell.transfer ? ' ↔' : ''}${cell.makeup && cell.text !== '보강' ? ' *' : ''}`;
const rowValues = (row: AttendanceOverviewRow) => [row.className, row.fullName, row.studentPhone || '-', row.parentPhone || '-', row.email || '-',
  ...row.cells.map(attendanceText)];
type MeasuredColumns = { columns: string[][]; sizes: Record<number, { body?: number; header?: number }> };

export function TermAttendanceOverview({ termLabel, search, loadAttendance = getSupabaseTermAttendance }: {
  termLabel: string; search: string; loadAttendance?: (termLabel: string) => Promise<AttendanceOverview>;
}) {
  const [data, setData] = useState<AttendanceOverview>({ maxSession: 0, rows: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  const [measured, setMeasured] = useState<MeasuredColumns>({ columns: [], sizes: {} });
  const headers = useMemo(() => [...fixedHeaders, ...Array.from({ length: data.maxSession }, (_, i) => `${i + 1}차시 출석`)], [data.maxSession]);
  // Measure all loaded values, including rows outside the virtualized viewport.
  // Keep widths stable while searching; only a new dataset changes the measurements.
  const columns = useMemo(() => {
    const values = headers.map(() => new Set<string>());
    for (const row of data.rows) rowValues(row).forEach((value, index) => values[index]?.add(value));
    return values.map((column) => [...column]);
  }, [data, headers]);
  const widths = headers.map((header, index) => {
    const size = measured.columns === columns ? measured.sizes[index] : undefined;
    return size ? Math.max(56, Math.ceil(Math.max(size.body ?? 0, size.header ?? 0)) + 24) : Math.max(64, header.length * 12 + 24);
  });
  const measure = (index: number, kind: 'body' | 'header', width: number) => {
    const rounded = Math.ceil(width);
    setMeasured((current) => {
      const sizes = current.columns === columns ? current.sizes : {};
      if (sizes[index]?.[kind] === rounded) return current;
      return { columns, sizes: { ...sizes, [index]: { ...sizes[index], [kind]: rounded } } };
    });
  };
  useEffect(() => {
    let active = true;
    setData({ maxSession: 0, rows: [] }); setError(''); setDetail(null);
    if (!termLabel) return;
    setLoading(true);
    loadAttendance(termLabel).then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(cause?.message || '출석 현황을 불러오지 못했습니다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [termLabel, revision, loadAttendance]);
  const rows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('ko-KR');
    return keyword ? data.rows.filter((row) => `${row.className} ${row.fullName} ${row.studentPhone} ${row.parentPhone} ${row.email}`.toLocaleLowerCase('ko-KR').includes(keyword)) : data.rows;
  }, [data, search]);
  const groups = useMemo(() => {
    let group = 0;
    return rows.map((row, index) => {
      if (index > 0 && row.classId !== rows[index - 1].classId) group++;
      return group;
    });
  }, [rows]);
  if (!termLabel) return <Text style={styles.empty}>분기를 선택하면 모든 수업의 출석 현황이 표시됩니다.</Text>;
  if (loading) return <View style={styles.empty}><ActivityIndicator color="#4F46E5" /><Text style={styles.help}>출석 현황을 불러오는 중...</Text></View>;
  if (error) return <View style={styles.empty}><Text style={styles.error}>{error}</Text><Pressable onPress={() => setRevision((value) => value + 1)}><Text style={styles.retry}>다시 불러오기</Text></Pressable></View>;
  const tableWidth = widths.reduce((total, width) => total + width, 0);
  const renderRow = ({ item, index: rowIndex }: { item: AttendanceOverviewRow; index: number }) => <View style={[styles.row, groups[rowIndex] % 2 === 1 && styles.alternateGroup,
    rowIndex > 0 && groups[rowIndex] !== groups[rowIndex - 1] && styles.groupStart]}>
    {[item.className, item.fullName, item.studentPhone || '-', item.parentPhone || '-', item.email || '-'].map((value, i) => (
      <View key={i} style={[styles.cell, { width: widths[i] }]}><Text numberOfLines={1} style={[styles.text, i === 1 && item.isWithdrawn && styles.withdrawn]}>{value}</Text></View>
    ))}
    {item.cells.map((cell, index) => <Pressable key={index} style={[styles.cell, { width: widths[index + fixedHeaders.length] }, cell.transfer && styles.transferBg, cell.makeup && styles.makeupBg]}
      accessibilityRole="button"
      accessibilityLabel={`${item.fullName} ${index + 1}차시 ${cell.text}. ${cell.detail}`}
      accessibilityHint="출석 상세 내역을 엽니다."
      onPress={() => setDetail({ title: `${item.fullName} · ${index + 1}차시`, text: `${termLabel} · ${item.className}\n출석: ${cell.text}\n${cell.detail}` })}>
      <Text style={[styles.text, styles.attendance, ['미입력', '—'].includes(cell.text) && styles.muted,
        cell.transfer && styles.transfer, cell.makeup && styles.makeup, cell.text === '미등록' && styles.unregistered, cell.text === '퇴원' && styles.withdrawn]}>{attendanceText(cell)}</Text>
    </Pressable>)}
  </View>;
  return <View style={styles.container}>
    <View style={styles.summary}><Text style={styles.help}>{termLabel} · {rows.length}명 · 최대 {data.maxSession}차시</Text><Pressable onPress={() => setRevision((value) => value + 1)}><Text style={styles.retry}>새로고침</Text></Pressable></View>
    <Text style={styles.help}><Text style={styles.transfer}>빨강 ↔ 전반</Text> · <Text style={styles.makeup}>파랑 보강</Text> · <Text style={styles.unregistered}>초록 미등록</Text> · <Text style={styles.withdrawn}>보라 퇴원</Text> · 출석 칸을 누르면 상세 내용을 확인합니다.</Text>
    <Text style={styles.help}>학생당 한 행 · 전반 전 출석은 현재 반에 합쳐 표시 · 보강은 원래 차시에만 표시 · 미입력: 빈 출석 · —: 해당 차시 일정 없음</Text>
    <ScrollView horizontal style={styles.horizontal} contentContainerStyle={styles.horizontalContent}>
      <View style={{ width: tableWidth, flex: 1 }}>
        <FlatList data={rows} keyExtractor={(row) => row.key} renderItem={renderRow} stickyHeaderIndices={[0]}
          initialNumToRender={20} windowSize={7} getItemLayout={(_, index) => ({ length: 48, offset: 48 * (index + 1), index })}
          extraData={measured}
          ListHeaderComponent={<View style={[styles.row, styles.header]}>{headers.map((title, i) => <View key={i} style={[styles.cell, { width: widths[i] }]}><Text style={styles.heading}>{title}</Text></View>)}</View>}
          ListEmptyComponent={<Text style={styles.empty}>표시할 학생이 없습니다.</Text>} />
      </View>
    </ScrollView>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={styles.measurementClip}>
      <View style={styles.measurement}>{columns.map((values, index) => <View key={index} style={styles.measureColumn}>
        <Text style={[styles.text, index >= fixedHeaders.length && styles.measureAttendance]} onLayout={(event) => measure(index, 'body', event.nativeEvent.layout.width)}>{values.join('\n') || '-'}</Text>
        <Text style={styles.heading} onLayout={(event) => measure(index, 'header', event.nativeEvent.layout.width)}>{headers[index]}</Text>
      </View>)}</View>
    </View>
    <Modal visible={detail !== null} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
      <Pressable style={styles.detailOverlay} accessibilityLabel="출석 상세 닫기" onPress={() => setDetail(null)}>
        <Pressable style={styles.detailModal} onPress={(event) => event.stopPropagation()}>
          <View style={styles.detailHeader}><Text style={styles.detailTitle}>{detail?.title}</Text><Pressable onPress={() => setDetail(null)} style={styles.closeButton}><Text style={styles.retry}>닫기</Text></Pressable></View>
          <ScrollView><Text style={styles.detailText}>{detail?.text}</Text></ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, gap: 7 }, horizontal: { flex: 1, marginTop: 7, borderWidth: 1, borderColor: '#E2E8F0' }, horizontalContent: { flexGrow: 1 },
  row: { height: 48, flexDirection: 'row', backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }, header: { backgroundColor: '#F1F5F9' },
  alternateGroup: { backgroundColor: '#F8FAFC' }, groupStart: { borderTopWidth: 3, borderTopColor: '#64748B' },
  cell: { paddingHorizontal: 10, justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#E2E8F0' }, text: { color: '#1F2937', fontSize: 12 },
  heading: { fontSize: 12, color: '#334155', fontWeight: '800' }, attendance: { textAlign: 'center' }, muted: { color: '#94A3B8' },
  unregistered: { color: '#15803D', fontWeight: '800' }, withdrawn: { color: '#7E22CE', fontWeight: '800' },
  transfer: { color: '#B91C1C', fontWeight: '800' }, makeup: { color: '#1D4ED8', fontWeight: '800' }, transferBg: { backgroundColor: '#FFF7F7' }, makeupBg: { backgroundColor: '#EFF6FF' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }, help: { color: '#64748B', fontSize: 12, lineHeight: 18 },
  retry: { color: '#4F46E5', fontSize: 13, fontWeight: '800', padding: 5 }, empty: { padding: 24, color: '#64748B', textAlign: 'center' }, error: { color: '#B91C1C' },
  measurementClip: { position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 }, measurement: { width: 10000, alignItems: 'flex-start' }, measureColumn: { alignItems: 'flex-start' }, measureAttendance: { fontWeight: '800' },
  detailOverlay: { flex: 1, padding: 20, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', alignItems: 'center' }, detailModal: { width: '100%', maxWidth: 640, maxHeight: '80%', padding: 20, borderRadius: 16, backgroundColor: '#FFFFFF' },
  detailHeader: { flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }, detailTitle: { flex: 1, color: '#111827', fontSize: 18, fontWeight: '800' }, closeButton: { padding: 5 }, detailText: { color: '#334155', fontSize: 15, lineHeight: 25 },
});
