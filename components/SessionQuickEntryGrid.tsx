import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizeQuickEntryValue, type QuickEntryColumn } from '../lib/sessionQuickEntry';

export type QuickEntryRow = {
  id: string;
  name: string;
  code: string;
  lockAttendance: boolean;
  values: Record<string, string>;
};

type Props = {
  rows: QuickEntryRow[];
  columns: QuickEntryColumn[];
  hasChanges: boolean;
  busy: boolean;
  error: string;
  onCommit: (studentId: string, column: QuickEntryColumn, value: string) => void;
  onSave: () => Promise<boolean>;
  onClose: () => void;
};

type CellProps = {
  row: QuickEntryRow;
  column: QuickEntryColumn;
  busy: boolean;
  onCommit: Props['onCommit'];
  onInvalidChange: (key: string, invalid: boolean) => void;
  onRegister: (key: string, input: TextInput | null) => void;
  onEnter: (rowId: string, columnKey: string) => void;
  onNavigate: (rowId: string, columnKey: string, direction: 'left' | 'right' | 'up' | 'down') => void;
};

function QuickCell({ row, column, busy, onCommit, onInvalidChange, onRegister, onEnter, onNavigate }: CellProps) {
  const value = row.values[column.key] ?? '';
  const [raw, setRaw] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const selection = useRef({ start: 0, end: 0 });
  const key = `${row.id}:${column.key}`;
  const locked = column.kind === 'attendance' && row.lockAttendance;

  useEffect(() => {
    setRaw(value);
    setInvalid(false);
    onInvalidChange(key, false);
  }, [key, onInvalidChange, value]);

  const change = (nextRaw: string) => {
    setRaw(nextRaw);
    const normalized = normalizeQuickEntryValue(column, nextRaw);
    const nextInvalid = normalized === null;
    setInvalid(nextInvalid);
    onInvalidChange(key, nextInvalid);
    if (normalized !== null && normalized !== value) onCommit(row.id, column, normalized);
  };

  const placeholder = column.kind === 'attendance' ? '출석/영상/보강/결석'
    : column.kind === 'homework' ? 'A/B/C/미제출'
      : column.kind === 'score' ? `0~${column.maxScore} / 결시`
        : column.kind === 'memo' ? '결과 / 결시' : '메모';

  return (
    <View style={[styles.cell, { width: column.width }]}>
      <View style={styles.inputWrap}>
      <TextInput
        ref={(input) => onRegister(key, input)}
        accessibilityLabel={`${row.name} ${column.label}`}
        value={raw}
        onChangeText={change}
        onSelectionChange={(event) => { selection.current = event.nativeEvent.selection; }}
        onKeyPress={(event) => {
          const native = event.nativeEvent as typeof event.nativeEvent & { isComposing?: boolean; keyCode?: number };
          if (native.isComposing || native.keyCode === 229) return;
          if (native.key === 'Enter') {
            event.preventDefault();
            onEnter(row.id, column.key);
          } else if (native.key === 'ArrowUp' || native.key === 'ArrowDown') {
            event.preventDefault();
            onNavigate(row.id, column.key, native.key === 'ArrowUp' ? 'up' : 'down');
          } else if (native.key === 'ArrowLeft' || native.key === 'ArrowRight') {
            const target = event.target as unknown as { selectionStart?: number; selectionEnd?: number };
            const start = target?.selectionStart ?? selection.current.start;
            const end = target?.selectionEnd ?? selection.current.end;
            if ((native.key === 'ArrowLeft' && start === 0 && end === 0)
              || (native.key === 'ArrowRight' && start === raw.length && end === raw.length)) {
              event.preventDefault();
              onNavigate(row.id, column.key, native.key === 'ArrowLeft' ? 'left' : 'right');
            }
          }
        }}
        editable={!busy && !locked}
        blurOnSubmit={false}
        selectTextOnFocus={false}
        autoCorrect={false}
        autoCapitalize="none"
        placeholder={locked ? '다른 반에서 보강' : placeholder}
        placeholderTextColor="#9CA3AF"
        style={[styles.input, invalid && styles.invalidInput, locked && styles.lockedInput]}
      />
      {raw !== '' && !locked && <Pressable accessibilityLabel={`${row.name} ${column.label} 값 지우기`}
        disabled={busy} style={styles.clearButton} onPress={() => change('')}>
        <Text style={styles.clearText}>×</Text>
      </Pressable>}
      </View>
    </View>
  );
}

export default function SessionQuickEntryGrid({ rows, columns, hasChanges, busy, error, onCommit, onSave, onClose }: Props) {
  const [invalidKeys, setInvalidKeys] = useState<Set<string>>(() => new Set());
  const inputs = useRef(new Map<string, TextInput>());
  const onInvalidChange = useCallback((key: string, invalid: boolean) => {
    setInvalidKeys((current) => {
      if (current.has(key) === invalid) return current;
      const next = new Set(current);
      if (invalid) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const onRegister = useCallback((key: string, input: TextInput | null) => {
    if (input) inputs.current.set(key, input);
    else inputs.current.delete(key);
  }, []);
  const onEnter = useCallback((rowId: string, columnKey: string) => {
    const rowIndex = rows.findIndex((row) => row.id === rowId);
    const columnIndex = columns.findIndex((column) => column.key === columnKey);
    for (let offset = 1; offset <= rows.length * columns.length; offset += 1) {
      const nextIndex = (rowIndex + offset) % rows.length;
      const nextColumnIndex = (columnIndex + Math.floor((rowIndex + offset) / rows.length)) % columns.length;
      const nextRow = rows[nextIndex];
      const nextColumn = columns[nextColumnIndex];
      if (nextRow.lockAttendance && nextColumn.kind === 'attendance') continue;
      const next = inputs.current.get(`${nextRow.id}:${nextColumn.key}`);
      if (next) { next.focus(); return; }
    }
  }, [columns, rows]);
  const onNavigate = useCallback((rowId: string, columnKey: string, direction: 'left' | 'right' | 'up' | 'down') => {
    const rowIndex = rows.findIndex((row) => row.id === rowId);
    const columnIndex = columns.findIndex((column) => column.key === columnKey);
    const rowStep = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const columnStep = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    for (let offset = 1; offset < Math.max(rows.length, columns.length); offset += 1) {
      const nextRow = rows[rowIndex + offset * rowStep];
      const nextColumn = columns[columnIndex + offset * columnStep];
      if (!nextRow || !nextColumn) return;
      if (nextRow.lockAttendance && nextColumn.kind === 'attendance') continue;
      const next = inputs.current.get(`${nextRow.id}:${nextColumn.key}`);
      if (next) {
        next.focus();
        if (direction === 'left' || direction === 'right') {
          const position = direction === 'left' ? (nextRow.values[nextColumn.key] ?? '').length : 0;
          const webInput = next as unknown as { setSelectionRange?: (start: number, end: number) => void };
          if (typeof webInput.setSelectionRange === 'function') webInput.setSelectionRange(position, position);
          else next.setNativeProps({ selection: { start: position, end: position } });
        }
        return;
      }
    }
  }, [columns, rows]);

  const close = () => {
    if (invalidKeys.size > 0 && !window.confirm('형식이 맞지 않는 입력값이 있습니다. 해당 칸의 입력을 버리고 닫을까요?')) return;
    onClose();
  };
  const save = async () => {
    if (invalidKeys.size > 0 || !hasChanges || busy) return;
    if (await onSave()) onClose();
  };

  return (
    <Modal visible animationType="fade" onRequestClose={close}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>학생 기록 빠른 입력</Text>
            <Text style={styles.guide}>Tab: 다음 칸 · Enter/↓: 다음 학생 · ←/→: 글의 양 끝에서 옆 칸 · 빈칸: 미입력</Text>
          </View>
          <View style={styles.actions}>
            <Pressable disabled={!hasChanges || invalidKeys.size > 0 || busy} style={[styles.saveButton, (!hasChanges || invalidKeys.size > 0 || busy) && styles.disabled]} onPress={() => void save()}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>전체 저장</Text>}
            </Pressable>
            <Pressable accessibilityLabel="빠른 입력 닫기" style={styles.closeButton} onPress={close}><Ionicons name="close" size={24} color="#374151" /></Pressable>
          </View>
        </View>
        <Text style={styles.hint}>출석은 출석·영상·보강·결석, 숙제는 A·B·C·미제출로 입력하세요. 보강 날짜·시간은 기본 학생 기록 표에서 입력할 수 있습니다. 저장 전 변경사항은 표를 닫아도 유지됩니다.</Text>
        {invalidKeys.size > 0 && <Text style={styles.validation}>형식이 맞지 않는 칸 {invalidKeys.size}개를 수정해야 저장할 수 있습니다.</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <ScrollView style={styles.vertical} nestedScrollEnabled>
          <View style={styles.gridRow}>
            <View style={styles.nameColumn}>
              <View style={[styles.nameCell, styles.heading]}><Text style={styles.headingText}>학생</Text></View>
              {rows.map((row) => <View key={row.id} style={styles.nameCell}><Text style={styles.studentName} numberOfLines={1}>{row.name}</Text><Text style={styles.studentCode} numberOfLines={1}>{row.code}</Text></View>)}
            </View>
            <ScrollView horizontal style={styles.horizontal} showsHorizontalScrollIndicator>
              <View>
                <View style={styles.gridRow}>{columns.map((column) => <View key={column.key} style={[styles.cell, styles.heading, { width: column.width }]}><Text style={styles.headingText} numberOfLines={2}>{column.label}</Text></View>)}</View>
                {rows.map((row) => <View key={row.id} style={styles.gridRow}>{columns.map((column) => <QuickCell key={column.key} row={row} column={column} busy={busy} onCommit={onCommit} onInvalidChange={onInvalidChange} onRegister={onRegister} onEnter={onEnter} onNavigate={onNavigate} />)}</View>)}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingHorizontal: 24, paddingVertical: 18, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  titleBlock: { flex: 1 },
  title: { color: '#111827', fontSize: 22, fontWeight: '800' },
  guide: { marginTop: 5, color: '#6B7280', fontSize: 13 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  saveButton: { minWidth: 110, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, borderRadius: 9, backgroundColor: '#4F46E5' },
  saveText: { color: '#FFFFFF', fontWeight: '800' },
  closeButton: { padding: 7 },
  disabled: { opacity: 0.45 },
  hint: { marginHorizontal: 24, marginTop: 16, padding: 12, color: '#4338CA', backgroundColor: '#EEF2FF', borderRadius: 9, fontSize: 13, lineHeight: 20 },
  validation: { marginHorizontal: 24, marginTop: 10, color: '#B91C1C', fontWeight: '700' },
  error: { marginHorizontal: 24, marginTop: 10, color: '#B91C1C' },
  vertical: { flex: 1, margin: 24, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, backgroundColor: '#FFFFFF' },
  horizontal: { flex: 1 },
  gridRow: { flexDirection: 'row' },
  nameColumn: { width: 165, zIndex: 1, backgroundColor: '#FFFFFF', borderRightWidth: 2, borderRightColor: '#CBD5E1' },
  heading: { backgroundColor: '#EEF2F7' },
  headingText: { color: '#334155', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  nameCell: { height: 58, justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  studentName: { color: '#111827', fontSize: 14, fontWeight: '700' },
  studentCode: { marginTop: 2, color: '#64748B', fontSize: 11 },
  cell: { height: 58, justifyContent: 'center', padding: 6, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#E5E7EB' },
  inputWrap: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, minWidth: 0, height: 41, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF', color: '#111827', fontSize: 13 },
  clearButton: { width: 22, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: '#64748B', fontSize: 18 },
  invalidInput: { borderWidth: 2, borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
  lockedInput: { color: '#64748B', backgroundColor: '#F1F5F9' },
});
