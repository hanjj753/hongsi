import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { Picker } from './ReadablePicker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  archiveSupabaseClassTerm,
  archiveSupabaseManagedClass,
  deleteSupabaseManagedClass,
  formatClassLabel,
  getSupabaseActiveStaff,
  getSupabaseClassCatalog,
  saveSupabaseClassTerm,
  saveSupabaseManagedClass,
  type AssignableStaff,
  type ManagedClass,
  type ManagedClassInput,
  type ManagedClassTerm,
  type ManagedLocation,
} from '../lib/classData';

type Props = { onChanged: () => Promise<void> | void };

const weekdayOptions = [
  { value: 1, label: '월' }, { value: 2, label: '화' }, { value: 3, label: '수' },
  { value: 4, label: '목' }, { value: 5, label: '금' }, { value: 6, label: '토' },
  { value: 0, label: '일' },
];
const dayPartOptions = ['오전', '오후', '저녁'] as const;

const emptyClass = (termLabel: string): ManagedClassInput => ({
  id: '', termLabel, school: '', subject: '', locationId: '', weekdays: [],
  dayPart: '', startTime: '', endTime: '', hourlyRateKrw: '', staffIds: [], isActive: true,
});

function errorText(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  if (message.includes('Term label already exists') || message.includes('duplicate key')) return '이미 등록된 분기 이름입니다.';
  if (message.includes('classes_time_pair')) return '시작 시간과 종료 시간을 함께 입력해 주세요.';
  if (message.includes('classes_name_present')) return '학교 또는 과목을 입력해 주세요.';
  return message || '요청을 처리하지 못했습니다.';
}

function confirmAction(title: string, message: string, action: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) action();
    return;
  }
  Alert.alert(title, message, [
    { text: '취소', style: 'cancel' },
    { text: '삭제', style: 'destructive', onPress: action },
  ]);
}

export function TermClassManager({ onChanged }: Props) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [terms, setTerms] = useState<ManagedClassTerm[]>([]);
  const [classes, setClasses] = useState<ManagedClass[]>([]);
  const [locations, setLocations] = useState<ManagedLocation[]>([]);
  const [staff, setStaff] = useState<AssignableStaff[]>([]);
  const [selectedTerm, setSelectedTerm] = useState('');
  const [termEditorOriginal, setTermEditorOriginal] = useState<string | null | undefined>(undefined);
  const [termDraft, setTermDraft] = useState('');
  const [classEditorVisible, setClassEditorVisible] = useState(false);
  const [classDraft, setClassDraft] = useState<ManagedClassInput>(emptyClass(''));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalog, activeStaff] = await Promise.all([
        getSupabaseClassCatalog(),
        getSupabaseActiveStaff(),
      ]);
      setTerms(catalog.terms);
      setClasses(catalog.classes);
      setLocations(catalog.locations);
      setStaff(activeStaff);
      const activeLabels = catalog.terms.filter((item) => item.isActive).map((item) => item.label);
      setSelectedTerm((current) => activeLabels.includes(current) ? current : activeLabels[0] ?? '');
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  const activeTerms = useMemo(() => terms.filter((item) => item.isActive), [terms]);
  const selectedClasses = useMemo(() => classes
    .filter((item) => item.termLabel === selectedTerm)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.school.localeCompare(b.school, 'ko-KR') || a.subject.localeCompare(b.subject, 'ko-KR')),
  [classes, selectedTerm]);

  const refreshAll = async () => {
    await load();
    await onChanged();
  };

  const saveTerm = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveSupabaseClassTerm(termEditorOriginal ?? '', termDraft);
      setSelectedTerm(saved);
      setTermEditorOriginal(undefined);
      setTermDraft('');
      await refreshAll();
      setSelectedTerm(saved);
      setNotice(termEditorOriginal ? '분기 이름을 수정했습니다.' : '분기를 추가했습니다.');
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  const archiveTerm = () => {
    if (!selectedTerm) return;
    confirmAction('분기 삭제', `${selectedTerm} 분기를 목록에서 삭제할까요?\n수업과 학생 기록은 지우지 않고 보관됩니다.`, () => {
      void (async () => {
        setSaving(true);
        setError('');
        try {
          await archiveSupabaseClassTerm(selectedTerm);
          await refreshAll();
          setNotice('분기와 소속 수업을 목록에서 삭제했습니다. 기존 기록은 보존됩니다.');
        } catch (archiveError) {
          setError(errorText(archiveError));
        } finally {
          setSaving(false);
        }
      })();
    });
  };

  const openNewClass = () => {
    if (!selectedTerm) {
      setError('분기를 먼저 추가해 주세요.');
      return;
    }
    setError('');
    setClassDraft(emptyClass(selectedTerm));
    setClassEditorVisible(true);
  };

  const openEditClass = (item: ManagedClass) => {
    setError('');
    setClassDraft({
      id: item.id, termLabel: item.termLabel, school: item.school, subject: item.subject,
      locationId: item.locationId, weekdays: item.weekdays, dayPart: item.dayPart, startTime: item.startTime,
      endTime: item.endTime, hourlyRateKrw: item.hourlyRateKrw,
      staffIds: item.staffIds, isActive: item.isActive,
    });
    setClassEditorVisible(true);
  };

  const saveClass = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await saveSupabaseManagedClass({ ...classDraft, isActive: true });
      setClassEditorVisible(false);
      await refreshAll();
      setNotice(classDraft.id ? '수업 정보를 수정했습니다.' : '새 수업을 추가했습니다.');
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  const archiveClass = (item: ManagedClass) => {
    confirmAction('수업 삭제', `${[item.school, item.subject].filter(Boolean).join(' ')} 수업을 목록에서 삭제할까요?\n차시와 학생 기록은 지우지 않고 보관됩니다.`, () => {
      void (async () => {
        setSaving(true);
        setError('');
        try {
          await archiveSupabaseManagedClass(item.id);
          await refreshAll();
          setNotice('수업을 목록에서 삭제했습니다. 기존 기록은 보존됩니다.');
        } catch (archiveError) {
          setError(errorText(archiveError));
        } finally {
          setSaving(false);
        }
      })();
    });
  };

  const deleteClassPermanently = (item: ManagedClass) => {
    const label = [item.school, item.subject].filter(Boolean).join(' ') || '이 수업';
    confirmAction('수업 완전 삭제', label + '의 차시, 수강, 성적, 문자, 보강 기록을 완전히 삭제할까요?\n이 작업은 복구할 수 없습니다. 근무 기록은 수업 연결만 해제하고 보존합니다.', () => {
      void (async () => {
        setSaving(true);
        setError('');
        try {
          await deleteSupabaseManagedClass(item.id);
          await refreshAll();
          setNotice('수업과 연결 기록을 완전히 삭제했습니다.');
        } catch (deleteError) {
          setError(errorText(deleteError));
        } finally {
          setSaving(false);
        }
      })();
    });
  };

  const toggleWeekday = (day: number) => setClassDraft((current) => ({
    ...current,
    weekdays: current.weekdays.includes(day) ? current.weekdays.filter((item) => item !== day) : [...current.weekdays, day],
  }));
  const toggleStaff = (staffId: string) => setClassDraft((current) => ({
    ...current,
    staffIds: current.staffIds.includes(staffId)
      ? current.staffIds.filter((item) => item !== staffId)
      : [...current.staffIds, staffId],
  }));

  return (
    <>
      <Pressable style={({ pressed }) => [styles.trigger, pressed && styles.pressed]} onPress={() => setVisible(true)}>
        <FontAwesome5 name="calendar-alt" size={16} color="#4F46E5" />
        <Text style={styles.triggerText}>분기/수업 관리</Text>
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.managerModal}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>분기 및 수업 관리</Text>
                <Text style={styles.modalDescription}>일반 삭제는 기록을 보존해 숨기며, 삭제된 수업은 완전 삭제할 수 있습니다.</Text>
              </View>
              <Pressable accessibilityLabel="닫기" style={styles.closeButton} onPress={() => setVisible(false)}>
                <FontAwesome5 name="times" size={20} color="#6B7280" />
              </Pressable>
            </View>

            {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
            {!!notice && <View style={styles.noticeBox}><Text style={styles.noticeText}>{notice}</Text></View>}

            {loading ? <View style={styles.loader}><ActivityIndicator color="#4F46E5" /></View> : (
              <ScrollView contentContainerStyle={styles.managerContent} keyboardShouldPersistTaps="handled">
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>분기</Text>
                  <Pressable style={styles.outlineButton} onPress={() => { setTermEditorOriginal(null); setTermDraft(''); }}>
                    <Text style={styles.outlineButtonText}>+ 분기 추가</Text>
                  </Pressable>
                </View>

                {termEditorOriginal !== undefined && (
                  <View style={styles.editorStrip}>
                    <TextInput style={styles.input} value={termDraft} onChangeText={setTermDraft} placeholder="예: 2026-3F" placeholderTextColor="#9CA3AF" editable={!saving} />
                    <Pressable style={styles.smallMutedButton} onPress={() => setTermEditorOriginal(undefined)}><Text style={styles.smallMutedText}>취소</Text></Pressable>
                    <Pressable disabled={saving} style={[styles.smallPrimaryButton, saving && styles.disabled]} onPress={() => void saveTerm()}>
                      <Text style={styles.smallPrimaryText}>{termEditorOriginal ? '이름 저장' : '추가'}</Text>
                    </Pressable>
                  </View>
                )}

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.termTabs}>
                  {activeTerms.map((term) => (
                    <Pressable key={term.label} style={[styles.termTab, selectedTerm === term.label && styles.termTabActive]} onPress={() => setSelectedTerm(term.label)}>
                      <Text style={[styles.termTabText, selectedTerm === term.label && styles.termTabTextActive]}>{term.label}</Text>
                    </Pressable>
                  ))}
                  {activeTerms.length === 0 && <Text style={styles.emptyText}>등록된 분기가 없습니다.</Text>}
                </ScrollView>

                {!!selectedTerm && (
                  <>
                    <View style={styles.selectedTermRow}>
                      <Text style={styles.selectedTermTitle}>{selectedTerm}</Text>
                      <View style={styles.actionRow}>
                        <Pressable style={styles.textButton} onPress={() => { setTermEditorOriginal(selectedTerm); setTermDraft(selectedTerm); }}><Text style={styles.textButtonText}>이름 수정</Text></Pressable>
                        <Pressable style={styles.dangerTextButton} onPress={archiveTerm}><Text style={styles.dangerText}>분기 삭제</Text></Pressable>
                      </View>
                    </View>

                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionTitle}>소속 수업</Text>
                      <Pressable style={styles.primaryButton} onPress={openNewClass}><Text style={styles.primaryButtonText}>+ 수업 추가</Text></Pressable>
                    </View>

                    {selectedClasses.length === 0 ? <Text style={styles.emptyText}>이 분기에 등록된 수업이 없습니다.</Text> : selectedClasses.map((item) => (
                      <View key={item.id} style={[styles.classCard, !item.isActive && styles.archivedCard]}>
                        <View style={styles.classCardBody}>
                          <Text style={styles.classTitle}>{formatClassLabel(item)}</Text>
                          <Text style={styles.classMeta}>{item.startTime && item.endTime ? `${item.startTime}~${item.endTime}` : '시간 미정'} · {item.locationName || '장소 미정'}</Text>
                          {!item.isActive && <Text style={styles.archivedLabel}>삭제됨 · 수정 후 저장하면 복구됩니다</Text>}
                        </View>
                        <View style={styles.actionRow}>
                          <Pressable style={styles.textButton} onPress={() => openEditClass(item)}><Text style={styles.textButtonText}>{item.isActive ? '수정' : '복구/수정'}</Text></Pressable>
                          {item.isActive
                            ? <Pressable style={styles.dangerTextButton} onPress={() => archiveClass(item)}><Text style={styles.dangerText}>삭제</Text></Pressable>
                            : <Pressable style={styles.permanentDeleteButton} onPress={() => deleteClassPermanently(item)}><Text style={styles.permanentDeleteText}>완전 삭제</Text></Pressable>}
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={classEditorVisible} transparent animationType="fade" onRequestClose={() => setClassEditorVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.classEditorModal}>
            <Text style={styles.modalTitle}>{classDraft.id ? '수업 정보 수정' : '새 수업 추가'}</Text>
            {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
            <ScrollView contentContainerStyle={styles.classForm} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>분기</Text>
              <View style={styles.pickerFrame}><Picker selectedValue={classDraft.termLabel} onValueChange={(termLabel) => setClassDraft((current) => ({ ...current, termLabel: String(termLabel) }))} style={styles.picker}>{activeTerms.map((term) => <Picker.Item key={term.label} label={term.label} value={term.label} />)}</Picker></View>
              <View style={styles.twoColumns}>
                <View style={styles.field}><Text style={styles.label}>학교</Text><TextInput style={styles.input} value={classDraft.school} onChangeText={(school) => setClassDraft((current) => ({ ...current, school }))} placeholder="예: 경기고" placeholderTextColor="#9CA3AF" /></View>
                <View style={styles.field}><Text style={styles.label}>과목</Text><TextInput style={styles.input} value={classDraft.subject} onChangeText={(subject) => setClassDraft((current) => ({ ...current, subject }))} placeholder="예: 통합과학" placeholderTextColor="#9CA3AF" /></View>
              </View>
              <View style={styles.scheduleFields}>
                <View style={styles.scheduleDays}>
                  <Text style={styles.label}>요일</Text>
                  <View style={styles.weekdays}>{weekdayOptions.map((option) => { const selected = classDraft.weekdays.includes(option.value); return <Pressable key={option.value} style={[styles.weekday, selected && styles.weekdayActive]} onPress={() => toggleWeekday(option.value)}><Text style={[styles.weekdayText, selected && styles.weekdayTextActive]}>{option.label}</Text></Pressable>; })}</View>
                </View>
                <View style={styles.schedulePart}>
                  <Text style={styles.label}>시간대 *</Text>
                  <View style={styles.dayParts}>{dayPartOptions.map((part) => { const selected = classDraft.dayPart === part; return <Pressable key={part} style={[styles.dayPart, selected && styles.dayPartActive]} onPress={() => setClassDraft((current) => ({ ...current, dayPart: part }))}><Text style={[styles.dayPartText, selected && styles.dayPartTextActive]}>{part}</Text></Pressable>; })}</View>
                </View>
              </View>
              <Text style={styles.label}>장소</Text>
              <View style={styles.pickerFrame}><Picker selectedValue={classDraft.locationId} onValueChange={(locationId) => setClassDraft((current) => ({ ...current, locationId: String(locationId) }))} style={styles.picker}><Picker.Item label="선택 안 함" value="" />{locations.map((location) => <Picker.Item key={location.id} label={location.name} value={location.id} />)}</Picker></View>
              <View style={styles.twoColumns}>
                <View style={styles.field}><Text style={styles.label}>시작 시간</Text><TextInput style={styles.input} value={classDraft.startTime} onChangeText={(startTime) => setClassDraft((current) => ({ ...current, startTime }))} placeholder="HH:MM" placeholderTextColor="#9CA3AF" /></View>
                <View style={styles.field}><Text style={styles.label}>종료 시간</Text><TextInput style={styles.input} value={classDraft.endTime} onChangeText={(endTime) => setClassDraft((current) => ({ ...current, endTime }))} placeholder="HH:MM" placeholderTextColor="#9CA3AF" /></View>
              </View>
              <Text style={styles.label}>기본 시급</Text>
              <TextInput style={styles.input} value={classDraft.hourlyRateKrw} onChangeText={(hourlyRateKrw) => setClassDraft((current) => ({ ...current, hourlyRateKrw }))} placeholder="예: 15000" placeholderTextColor="#9CA3AF" keyboardType="number-pad" />
              <Text style={styles.label}>기본 예정 근무자</Text>
              <Text style={styles.fieldHelp}>새 일정을 추가할 때 아래 근무자가 기본으로 선택됩니다.</Text>
              <View style={styles.staffOptions}>
                {staff.map((item) => {
                  const selected = classDraft.staffIds.includes(item.id);
                  return (
                    <Pressable key={item.id} style={[styles.staffOption, selected && styles.staffOptionActive]} onPress={() => toggleStaff(item.id)}>
                      <Text style={[styles.staffOptionText, selected && styles.staffOptionTextActive]}>{item.fullName}</Text>
                    </Pressable>
                  );
                })}
                {staff.length === 0 && <Text style={styles.emptyText}>등록된 근무자가 없습니다.</Text>}
              </View>
            </ScrollView>
            <View style={styles.footerButtons}>
              <Pressable style={styles.cancelButton} onPress={() => setClassEditorVisible(false)}><Text style={styles.cancelText}>취소</Text></Pressable>
              <Pressable disabled={saving} style={[styles.confirmButton, saving && styles.disabled]} onPress={() => void saveClass()}>
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.confirmText}>저장</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#FFFFFF', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: '#C7D2FE' },
  triggerText: { color: '#4F46E5', fontWeight: '700', fontSize: 13 }, pressed: { opacity: 0.7 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14, backgroundColor: 'rgba(0,0,0,0.48)' },
  managerModal: { width: '100%', maxWidth: 920, maxHeight: '92%', borderRadius: 16, backgroundColor: '#FFFFFF', padding: 18 },
  classEditorModal: { width: '100%', maxWidth: 620, maxHeight: '90%', borderRadius: 16, backgroundColor: '#FFFFFF', padding: 18 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  modalTitle: { color: '#111827', fontSize: 19, fontWeight: '800' }, modalDescription: { marginTop: 4, color: '#6B7280', fontSize: 12 },
  closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  loader: { minHeight: 220, alignItems: 'center', justifyContent: 'center' }, managerContent: { paddingTop: 16, paddingBottom: 24 },
  errorBox: { marginTop: 12, padding: 10, borderRadius: 9, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' }, errorText: { color: '#B91C1C' },
  noticeBox: { marginTop: 12, padding: 10, borderRadius: 9, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' }, noticeText: { color: '#047857' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4, marginBottom: 10 }, sectionTitle: { color: '#111827', fontSize: 16, fontWeight: '800' },
  outlineButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#C7D2FE' }, outlineButtonText: { color: '#4F46E5', fontWeight: '700' },
  primaryButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 8, backgroundColor: '#4F46E5' }, primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },
  editorStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }, input: { minHeight: 43, flex: 1, paddingHorizontal: 11, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, backgroundColor: '#FFFFFF', color: '#111827' },
  smallMutedButton: { paddingHorizontal: 11, paddingVertical: 11, borderRadius: 8, backgroundColor: '#E5E7EB' }, smallMutedText: { color: '#374151', fontWeight: '700' },
  smallPrimaryButton: { paddingHorizontal: 13, paddingVertical: 11, borderRadius: 8, backgroundColor: '#4F46E5' }, smallPrimaryText: { color: '#FFFFFF', fontWeight: '800' },
  termTabs: { alignItems: 'center', gap: 8, paddingBottom: 15 }, termTab: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: '#F3F4F6' }, termTabActive: { backgroundColor: '#4F46E5' }, termTabText: { color: '#4B5563', fontWeight: '700' }, termTabTextActive: { color: '#FFFFFF' },
  selectedTermRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#E5E7EB' }, selectedTermTitle: { color: '#111827', fontSize: 19, fontWeight: '900' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, textButton: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7, backgroundColor: '#EEF2FF' }, textButtonText: { color: '#4F46E5', fontWeight: '700', fontSize: 12 }, dangerTextButton: { paddingHorizontal: 10, paddingVertical: 7 }, dangerText: { color: '#DC2626', fontWeight: '700', fontSize: 12 },
  permanentDeleteButton: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7, backgroundColor: '#FEE2E2' }, permanentDeleteText: { color: '#991B1B', fontWeight: '800', fontSize: 12 },
  classCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, marginBottom: 8, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' }, archivedCard: { backgroundColor: '#F9FAFB', opacity: 0.8 }, classCardBody: { flex: 1 }, classTitle: { color: '#111827', fontSize: 15, fontWeight: '800' }, classMeta: { marginTop: 5, color: '#6B7280', fontSize: 12 }, archivedLabel: { marginTop: 5, color: '#9CA3AF', fontSize: 11 }, emptyText: { color: '#6B7280', paddingVertical: 14 },
  classForm: { paddingTop: 15, paddingBottom: 22 }, label: { marginTop: 11, marginBottom: 6, color: '#374151', fontSize: 12, fontWeight: '800' }, twoColumns: { flexDirection: 'row', gap: 10 }, field: { flex: 1 },
  pickerFrame: { minHeight: 56, justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, backgroundColor: '#FFFFFF' }, picker: { height: 56, color: '#111827', backgroundColor: '#FFFFFF' },
  weekdays: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, weekday: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#F3F4F6' }, weekdayActive: { backgroundColor: '#4F46E5' }, weekdayText: { color: '#4B5563', fontWeight: '700' }, weekdayTextActive: { color: '#FFFFFF' },
  scheduleFields: { flexDirection: 'row', flexWrap: 'wrap', gap: 15 }, scheduleDays: { flexGrow: 1, minWidth: 250 }, schedulePart: { flexGrow: 1, minWidth: 190 },
  dayParts: { flexDirection: 'row', gap: 7 }, dayPart: { paddingHorizontal: 12, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#F3F4F6' }, dayPartActive: { backgroundColor: '#4F46E5' }, dayPartText: { color: '#4B5563', fontWeight: '700' }, dayPartTextActive: { color: '#FFFFFF' },
  fieldHelp: { marginBottom: 8, color: '#6B7280', fontSize: 12 }, staffOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, staffOption: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' }, staffOptionActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' }, staffOptionText: { color: '#6B7280', fontWeight: '700' }, staffOptionTextActive: { color: '#4338CA' },
  footerButtons: { flexDirection: 'row', gap: 9 }, cancelButton: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 9, backgroundColor: '#E5E7EB' }, cancelText: { color: '#374151', fontWeight: '800' }, confirmButton: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 9, backgroundColor: '#4F46E5' }, confirmText: { color: '#FFFFFF', fontWeight: '800' }, disabled: { opacity: 0.5 },
});
