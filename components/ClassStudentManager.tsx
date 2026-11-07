import { Ionicons } from '@expo/vector-icons';
import { Picker } from './ReadablePicker';
import React, { useCallback, useEffect, useState } from 'react';
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
  useWindowDimensions,
  View,
} from 'react-native';

import { useAppAccess } from '../contexts/AppAccessContext';
import { buildClassContacts, syncClassContacts } from '../lib/classContacts';
import { StudentTransferHistory } from './StudentTransferHistory';
import StudentBulkRegistration from './StudentBulkRegistration';
import {
  deleteSupabaseClassEnrollment,
  getSupabaseClassStudents,
  getSupabaseTransferTargets,
  reactivateSupabaseStudent,
  saveAndEnrollSupabaseStudent,
  saveSupabaseStudentEnrollment,
  transferSupabaseStudent,
  withdrawSupabaseStudent,
  type ClassStudent,
  type StudentInput,
  type TransferTarget,
} from '../lib/classData';

type Props = {
  classId: string;
  defaultJoinedOn?: string;
  termLabel: string;
  school: string;
};

type StudentForm = StudentInput & { joinedOn?: string };

function todayYmd(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isValidDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3]);
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '요청을 처리하지 못했습니다.');
    if (message.includes('Student code already belongs')) return '같은 학생 ID가 다른 이름으로 이미 등록되어 있습니다.';
    if (message.includes('duplicate key')) return '이미 사용 중인 학생 ID입니다.';
    if (message.includes('Invalid student phone')) return '학생 전화번호 형식을 확인해 주세요.';
    if (message.includes('Invalid parent phone')) return '학부모 전화번호 형식을 확인해 주세요.';
    if (message.includes('Invalid student email')) return '이메일 형식을 확인해 주세요.';
    if (message.includes('Transfer date must be after')) return '전반일은 기존 수강 시작일보다 뒤여야 합니다.';
    if (message.includes('same term')) return '같은 분기의 다른 수업으로만 전반할 수 있습니다.';
    if (message.includes('already active')) return '이 학생은 옮길 수업에 이미 수강 중입니다.';
    return message;
  }
  return '요청을 처리하지 못했습니다.';
}

function confirmAction(title: string, message: string, action: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(title + '\n\n' + message)) action();
    return;
  }
  Alert.alert(title, message, [
    { text: '취소', style: 'cancel' },
    { text: '완전 삭제', style: 'destructive', onPress: action },
  ]);
}

function emptyForm(joinedOn: string): StudentForm {
  return {
    studentCode: '',
    fullName: '',
    studentPhone: '',
    parentPhone: '',
    email: '',
    defaultMessageRecipients: 'parent',
    joinedOn,
  };
}

function displayPhone(value: string): string {
  if (/^01\d{9}$/.test(value)) return `${value.slice(0, 3)}-${value.slice(3, 7)}-${value.slice(7)}`;
  if (/^01\d{8}$/.test(value)) return `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
  return value || '-';
}

export function ClassStudentManager({ classId, defaultJoinedOn, termLabel, school }: Props) {
  const { access } = useAppAccess();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const canEditStudents = Boolean(access);
  const canManage = access?.app_role === 'manager' || access?.app_role === 'admin';
  const initialJoinedOn = isValidDate(defaultJoinedOn ?? '') ? String(defaultJoinedOn) : todayYmd();

  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [bulkVisible, setBulkVisible] = useState(false);
  const [mode, setMode] = useState<'new' | 'edit'>('new');
  const [form, setForm] = useState<StudentForm>(() => emptyForm(initialJoinedOn));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [contactSyncing, setContactSyncing] = useState(false);
  const [transferVisible, setTransferVisible] = useState(false);
  const [transferTargets, setTransferTargets] = useState<TransferTarget[]>([]);
  const [transferStudentId, setTransferStudentId] = useState('');
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferDate, setTransferDate] = useState(todayYmd());
  const [statusStudent, setStatusStudent] = useState<ClassStudent | null>(null);
  const [statusAction, setStatusAction] = useState<'withdraw' | 'reactivate'>('withdraw');
  const [statusDate, setStatusDate] = useState(todayYmd());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStudents(await getSupabaseClassStudents(classId));
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setMode('new');
    setForm(emptyForm(initialJoinedOn));
    setFormError('');
    setModalVisible(true);
  };

  const openEdit = (student: ClassStudent) => {
    setMode('edit');
    setForm({
      id: student.id,
      studentCode: student.studentCode,
      fullName: student.fullName,
      studentPhone: student.studentPhone,
      parentPhone: student.parentPhone,
      email: student.email,
      defaultMessageRecipients: student.defaultMessageRecipients,
      joinedOn: student.joinedOn,
    });
    setFormError('');
    setModalVisible(true);
  };

  const save = async () => {
    if (!form.fullName.trim()) {
      setFormError('학생 이름을 입력해 주세요.');
      return;
    }
    if (mode === 'edit' && !form.studentCode.trim()) {
      setFormError('학생 ID를 입력해 주세요.');
      return;
    }
    if (!form.joinedOn || !isValidDate(form.joinedOn)) {
      setFormError('수강 시작일은 YYYY-MM-DD 형식으로 입력해 주세요.');
      return;
    }
    setSaving(true);
    setFormError('');
    setNotice('');
    const willGenerateStudentCode = mode === 'new' && !form.studentCode.trim();
    try {
      if (mode === 'new') await saveAndEnrollSupabaseStudent(classId, form);
      else await saveSupabaseStudentEnrollment(classId, form);
      setModalVisible(false);
      await load();
      setNotice(mode === 'new'
        ? willGenerateStudentCode
          ? '학생을 등록하고 수업에 배정했습니다. 학생 ID는 자동으로 생성되었습니다.'
          : '학생을 등록하고 수업에 배정했습니다.'
        : '학생 정보를 수정했습니다.');
    } catch (saveError) {
      setFormError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  const deleteEnrollment = (student: ClassStudent) => {
    confirmAction(
      '수강 학생 완전 삭제',
      student.fullName + ' 학생의 이 수업 수강 정보와 출석·숙제·시험·문자·보강 기록을 완전히 삭제할까요?\n다른 수업 기록과 공통 학생 정보는 유지됩니다.',
      () => {
        void (async () => {
          setSaving(true);
          setError('');
          setNotice('');
          try {
            await deleteSupabaseClassEnrollment(classId, student.id);
            await load();
            setNotice('이 수업의 학생 수강 정보와 연결 기록을 완전히 삭제했습니다.');
          } catch (deleteError) {
            setError(errorText(deleteError));
          } finally {
            setSaving(false);
          }
        })();
      },
    );
  };

  const openTransfer = async () => {
    setFormError('');
    setError('');
    try {
      const targets = await getSupabaseTransferTargets(classId);
      const firstActive = students.find((student) => student.enrollmentStatus === 'active');
      setTransferTargets(targets);
      setTransferStudentId(firstActive?.id ?? '');
      setTransferTargetId(targets[0]?.id ?? '');
      setTransferDate(todayYmd());
      setTransferVisible(true);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  };

  const submitTransfer = async () => {
    if (!transferStudentId || !transferTargetId || !isValidDate(transferDate)) {
      setFormError('학생, 옮길 수업, 전반일을 모두 확인해 주세요.');
      return;
    }
    setSaving(true); setFormError(''); setNotice('');
    try {
      await transferSupabaseStudent(classId, transferTargetId, transferStudentId, transferDate);
      setTransferVisible(false);
      await load();
      setNotice('전반 처리했습니다. 이전 반 기록은 그대로 보존되고 전반일부터 새 반에 표시됩니다.');
    } catch (submitError) { setFormError(errorText(submitError)); }
    finally { setSaving(false); }
  };

  const openStatus = (student: ClassStudent, action: 'withdraw' | 'reactivate') => {
    setStatusStudent(student); setStatusAction(action); setStatusDate(todayYmd()); setFormError('');
  };

  const submitStatus = async () => {
    if (!statusStudent || !isValidDate(statusDate)) { setFormError('날짜를 YYYY-MM-DD 형식으로 입력해 주세요.'); return; }
    setSaving(true); setFormError(''); setNotice('');
    try {
      if (statusAction === 'withdraw') await withdrawSupabaseStudent(classId, statusStudent.id, statusDate);
      else await reactivateSupabaseStudent(classId, statusStudent.id, statusDate);
      setStatusStudent(null);
      await load();
      setNotice(statusAction === 'withdraw' ? '수강 상태를 퇴원으로 변경했습니다.' : '수강을 다시 시작했습니다.');
    } catch (submitError) { setFormError(errorText(submitError)); }
    finally { setSaving(false); }
  };

  const studentActions = (student: ClassStudent) => <>
    {canEditStudents && <Pressable style={styles.editButton} onPress={() => openEdit(student)}>
      <Text style={styles.editButtonText}>수정</Text>
    </Pressable>}
    {canManage && (student.enrollmentStatus === 'active' ? (
      <Pressable style={styles.stopButton} onPress={() => openStatus(student, 'withdraw')}><Text style={styles.stopButtonText}>퇴원</Text></Pressable>
    ) : student.enrollmentStatus === 'withdrawn' ? (
      <Pressable style={styles.restartButton} onPress={() => openStatus(student, 'reactivate')}><Text style={styles.restartButtonText}>수강 재개</Text></Pressable>
    ) : null)}
    {canManage && <Pressable style={styles.deleteButton} onPress={() => deleteEnrollment(student)}>
      <Text style={styles.deleteButtonText}>완전 삭제</Text>
    </Pressable>}
  </>;

  const addPhoneContacts = () => {
    const { entries, conflictCount } = buildClassContacts(termLabel, school, students);
    if (!entries.length) {
      setNotice('수강 중인 학생의 저장 가능한 전화번호가 없습니다.');
      return;
    }
    const proceed = () => { void (async () => {
      setContactSyncing(true); setError(''); setNotice('');
      try {
        const result = await syncClassContacts(termLabel, entries);
        const summary = `분기 그룹 ${termLabel}: 새 연락처 ${result.created}개, 기존 번호 이름 수정 ${result.updated}개`;
        setNotice(`${summary}${result.failed ? `, 실패 ${result.failed}개` : ''}${conflictCount ? ` · 여러 학생에게 중복된 번호 ${conflictCount}개 제외` : ''}`);
        if (result.failed) setError(result.firstError || '일부 연락처를 저장하지 못했습니다. 기기의 연락처 저장 계정과 권한을 확인해 주세요.');
      } catch (cause) { setError(errorText(cause)); }
      finally { setContactSyncing(false); }
    })(); };
    const message = `수강 중인 학생의 전화번호 ${entries.length}개를 연락처에 저장합니다. 같은 번호가 있으면 이름을 바꾸고 ${termLabel} 그룹에 넣습니다.${conflictCount ? ` 서로 다른 학생에게 중복된 번호 ${conflictCount}개는 제외합니다.` : ''}`;
    Alert.alert('연락처 추가', message, [
      { text: '취소', style: 'cancel' },
      { text: '추가 및 수정', onPress: proceed },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={[styles.header, compact && styles.headerCompact]}>
        <View style={styles.headerText}>
          <Text style={styles.title}>수강 학생</Text>
          <Text style={styles.description}>학생 정보는 모든 수업에서 공통으로 사용되며, 여기에서 등록하거나 수정합니다.</Text>
        </View>
        {canEditStudents && (
          <View style={[styles.headerActions, compact && styles.headerActionsCompact]}>
            {canManage && <Pressable style={styles.transferButton} onPress={() => void openTransfer()}>
              <Ionicons name="swap-horizontal-outline" size={17} color="#4338CA" />
              <Text style={styles.transferButtonText}>학생 전반</Text>
            </Pressable>}
            <Pressable style={styles.addButton} onPress={openNew}>
              <Ionicons name="person-add-outline" size={17} color="#FFFFFF" />
              <Text style={styles.addButtonText}>학생 등록</Text>
            </Pressable>
            {Platform.OS === 'android' && <Pressable style={styles.transferButton} disabled={contactSyncing || loading} onPress={addPhoneContacts}>
              {contactSyncing ? <ActivityIndicator size="small" color="#4338CA" /> : <Ionicons name="call-outline" size={17} color="#4338CA" />}
              <Text style={styles.transferButtonText}>{contactSyncing ? '연락처 저장 중...' : '연락처 추가'}</Text>
            </Pressable>}
            <Pressable style={styles.transferButton} onPress={() => setBulkVisible(true)}>
              <Ionicons name="grid-outline" size={17} color="#4338CA" />
              <Text style={styles.transferButtonText}>학생 빠른 등록</Text>
            </Pressable>
          </View>
        )}
      </View>

      {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
      {!!notice && <View style={styles.noticeBox}><Text style={styles.noticeText}>{notice}</Text></View>}

      {loading ? (
        <View style={styles.loadingRow}><ActivityIndicator color="#4F46E5" /><Text style={styles.loadingText}>학생 명단을 불러오는 중...</Text></View>
      ) : students.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>등록된 학생이 없습니다.</Text>
          <Text style={styles.emptyText}>학생 등록 버튼으로 이 수업의 학생을 추가해 주세요.</Text>
        </View>
      ) : compact ? (
        <View style={styles.mobileList}>{students.map((student) => <View key={student.id} style={styles.mobileStudent}>
          <View style={styles.mobileStudentHeader}>
            <Text style={styles.nameText}>{student.fullName} · {student.studentCode}</Text>
            <Text style={styles.mobileStatus}>{student.enrollmentStatus === 'active' ? '수강 중' : student.enrollmentStatus === 'transferred' ? '전반' : '퇴원'}</Text>
          </View>
          <Text style={styles.mobileDetail}>학생 {displayPhone(student.studentPhone)} · 학부모 {displayPhone(student.parentPhone)}</Text>
          <Text style={styles.mobileDetail}>수강 시작 {student.joinedOn || '-'} · 기본 수신 {student.defaultMessageRecipients === 'both' ? '학생+학부모' : '학부모'}</Text>
          {!!student.email && <Text style={styles.mobileDetail}>{student.email}</Text>}
          {!!student.transferredToClassName && <Text style={styles.mobileDetail}>전반 → {student.transferredToClassName}</Text>}
          <StudentTransferHistory classId={classId} name={student.fullName} history={student.transferHistory} />
          <View style={styles.mobileActions}>{studentActions(student)}</View>
        </View>)}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={styles.table}>
            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.headCell, styles.nameCell]}>학생</Text>
              <Text style={[styles.headCell, styles.codeCell]}>학생 ID</Text>
              <Text style={[styles.headCell, styles.phoneCell]}>학생 전화번호</Text>
              <Text style={[styles.headCell, styles.phoneCell]}>학부모 전화번호</Text>
              <Text style={[styles.headCell, styles.emailCell]}>이메일</Text>
              <Text style={[styles.headCell, styles.recipientCell]}>기본 수신</Text>
              <Text style={[styles.headCell, styles.dateCell]}>수강 시작</Text>
              <Text style={[styles.headCell, styles.statusCell]}>수강 상태</Text>
              <Text style={[styles.headCell, styles.actionCell]}>관리</Text>
            </View>
            {students.map((student) => (
              <View key={student.id} style={styles.row}>
                <Text style={[styles.cell, styles.nameCell, styles.nameText]}>{student.fullName}</Text>
                <Text style={[styles.cell, styles.codeCell]}>{student.studentCode}</Text>
                <Text style={[styles.cell, styles.phoneCell]}>{displayPhone(student.studentPhone)}</Text>
                <Text style={[styles.cell, styles.phoneCell]}>{displayPhone(student.parentPhone)}</Text>
                <Text style={[styles.cell, styles.emailCell]} numberOfLines={1}>{student.email || '-'}</Text>
                <Text style={[styles.cell, styles.recipientCell]}>{student.defaultMessageRecipients === 'both' ? '학생+학부모' : '학부모'}</Text>
                <Text style={[styles.cell, styles.dateCell]}>{student.joinedOn || '-'}</Text>
                <View style={[styles.cellView, styles.statusCell]}>
                  <Text style={[
                    styles.statusBadge,
                    student.enrollmentStatus === 'active' ? styles.statusActive
                      : student.enrollmentStatus === 'transferred' ? styles.statusTransferred : styles.statusWithdrawn,
                  ]}>
                    {student.enrollmentStatus === 'active' ? '수강 중'
                      : student.enrollmentStatus === 'transferred' ? `전반${student.transferredToClassName ? ` → ${student.transferredToClassName}` : ''}` : '퇴원'}
                  </Text>
                  {student.endedOn ? <Text style={styles.statusDate}>{student.endedOn}까지</Text> : null}
                  <StudentTransferHistory classId={classId} name={student.fullName} history={student.transferHistory} />
                </View>
                <View style={[styles.cellView, styles.actionCell]}>
                  {studentActions(student)}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <Modal visible={transferVisible} transparent animationType="fade" onRequestClose={() => setTransferVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>학생 전반</Text>
              <Pressable accessibilityLabel="닫기" onPress={() => setTransferVisible(false)}><Ionicons name="close" size={25} color="#4B5563" /></Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              {!!formError && <View style={styles.errorBox}><Text style={styles.errorText}>{formError}</Text></View>}
              <Text style={styles.guideBox}>전반일 전 기록은 현재 수업에 남고, 전반일부터 새 수업의 학생 명단에 표시됩니다.</Text>
              <Text style={styles.label}>전반할 학생 *</Text>
              <View style={styles.pickerWrap}>
                <Picker selectedValue={transferStudentId} onValueChange={(value) => setTransferStudentId(String(value))}>
                  {students.filter((student) => student.enrollmentStatus === 'active').map((student) => (
                    <Picker.Item key={student.id} label={`${student.fullName} (${student.studentCode})`} value={student.id} />
                  ))}
                </Picker>
              </View>
              <Text style={styles.label}>옮길 수업 *</Text>
              <View style={styles.pickerWrap}>
                <Picker selectedValue={transferTargetId} onValueChange={(value) => setTransferTargetId(String(value))}>
                  {transferTargets.length === 0 && <Picker.Item label="같은 분기에 옮길 수업이 없습니다" value="" />}
                  {transferTargets.map((target) => <Picker.Item key={target.id} label={target.label} value={target.id} />)}
                </Picker>
              </View>
              <Text style={styles.label}>전반일 *</Text>
              <TextInput value={transferDate} onChangeText={setTransferDate} style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelButton} disabled={saving} onPress={() => setTransferVisible(false)}><Text style={styles.cancelText}>취소</Text></Pressable>
              <Pressable style={[styles.saveButton, saving && styles.disabled]} disabled={saving || !transferStudentId || !transferTargetId} onPress={() => void submitTransfer()}>
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>전반 처리</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(statusStudent)} transparent animationType="fade" onRequestClose={() => setStatusStudent(null)}>
        <View style={styles.overlay}>
          <View style={styles.smallModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{statusAction === 'withdraw' ? '수강 종료' : '수강 재개'}</Text>
              <Pressable accessibilityLabel="닫기" onPress={() => setStatusStudent(null)}><Ionicons name="close" size={25} color="#4B5563" /></Pressable>
            </View>
            <View style={styles.form}>
              {!!formError && <View style={styles.errorBox}><Text style={styles.errorText}>{formError}</Text></View>}
              <Text style={styles.guideBox}>{statusStudent?.fullName} 학생의 {statusAction === 'withdraw' ? '마지막 수강일' : '새 수강 시작일'}을 입력해 주세요.</Text>
              <Text style={styles.label}>{statusAction === 'withdraw' ? '마지막 수강일' : '수강 시작일'} *</Text>
              <TextInput value={statusDate} onChangeText={setStatusDate} style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelButton} disabled={saving} onPress={() => setStatusStudent(null)}><Text style={styles.cancelText}>취소</Text></Pressable>
              <Pressable style={[styles.saveButton, saving && styles.disabled]} disabled={saving} onPress={() => void submitStatus()}>
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>{statusAction === 'withdraw' ? '퇴원 처리' : '수강 재개'}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{mode === 'new' ? '학생 등록 및 수업 배정' : '학생 정보 수정'}</Text>
              <Pressable accessibilityLabel="닫기" onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={25} color="#4B5563" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              {!!formError && <View style={styles.errorBox}><Text style={styles.errorText}>{formError}</Text></View>}

              <Text style={styles.label}>학생 ID {mode === 'new' ? '(선택)' : '*'}</Text>
              <TextInput
                value={form.studentCode}
                onChangeText={(studentCode) => setForm((current) => ({ ...current, studentCode }))}
                style={styles.input}
                placeholder={mode === 'new' ? '비워두면 자동 생성됩니다' : '모든 수업에서 사용하는 학생 ID'}
                placeholderTextColor="#9CA3AF"
                autoCapitalize="characters"
              />

              <Text style={styles.label}>이름 *</Text>
              <TextInput value={form.fullName} onChangeText={(fullName) => setForm((current) => ({ ...current, fullName }))} style={styles.input} placeholder="학생 이름" placeholderTextColor="#9CA3AF" />

              <Text style={styles.label}>학생 전화번호</Text>
              <TextInput value={form.studentPhone} onChangeText={(studentPhone) => setForm((current) => ({ ...current, studentPhone }))} style={styles.input} placeholder="010-1234-5678" placeholderTextColor="#9CA3AF" keyboardType="phone-pad" />

              <Text style={styles.label}>학부모 전화번호</Text>
              <TextInput value={form.parentPhone} onChangeText={(parentPhone) => setForm((current) => ({ ...current, parentPhone }))} style={styles.input} placeholder="010-1234-5678" placeholderTextColor="#9CA3AF" keyboardType="phone-pad" />

              <Text style={styles.label}>이메일</Text>
              <TextInput value={form.email} onChangeText={(email) => setForm((current) => ({ ...current, email }))} style={styles.input} placeholder="student@example.com" placeholderTextColor="#9CA3AF" autoCapitalize="none" keyboardType="email-address" />

              <Text style={styles.label}>기본 문자 수신자</Text>
              <View style={styles.recipientButtons}>
                <Pressable style={[styles.recipientButton, form.defaultMessageRecipients === 'parent' && styles.recipientButtonActive]} onPress={() => setForm((current) => ({ ...current, defaultMessageRecipients: 'parent' }))}>
                  <Text style={[styles.recipientButtonText, form.defaultMessageRecipients === 'parent' && styles.recipientButtonTextActive]}>학부모만</Text>
                </Pressable>
                <Pressable style={[styles.recipientButton, form.defaultMessageRecipients === 'both' && styles.recipientButtonActive]} onPress={() => setForm((current) => ({ ...current, defaultMessageRecipients: 'both' }))}>
                  <Text style={[styles.recipientButtonText, form.defaultMessageRecipients === 'both' && styles.recipientButtonTextActive]}>학생 + 학부모</Text>
                </Pressable>
              </View>

              <Text style={styles.label}>수강 시작일 *</Text>
              <TextInput value={form.joinedOn ?? ''} onChangeText={(joinedOn) => setForm((current) => ({ ...current, joinedOn }))} style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" autoCapitalize="none" />

              <Text style={styles.helpText}>전화번호는 국내 휴대전화 번호만 입력할 수 있으며 하이픈은 있어도 됩니다.</Text>
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelButton} disabled={saving} onPress={() => setModalVisible(false)}><Text style={styles.cancelText}>취소</Text></Pressable>
              <Pressable style={[styles.saveButton, saving && styles.disabled]} disabled={saving} onPress={() => void save()}>
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>{mode === 'new' ? '등록 및 배정' : '수정 저장'}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {bulkVisible && <StudentBulkRegistration classId={classId} joinedOn={initialJoinedOn}
        onClose={() => setBulkVisible(false)} onSaved={async (count) => {
          await load();
          setNotice(`${count}명의 학생을 등록하고 수업에 배정했습니다.`);
        }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 18, padding: 18, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  headerCompact: { flexDirection: 'column', alignItems: 'stretch' },
  headerText: { flex: 1 },
  title: { color: '#111827', fontSize: 18, fontWeight: '800' },
  description: { marginTop: 5, color: '#6B7280', fontSize: 13, lineHeight: 19 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 7 },
  headerActionsCompact: { justifyContent: 'flex-start' },
  mobileList: { gap: 10 },
  mobileStudent: { padding: 13, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, backgroundColor: '#FFFFFF' },
  mobileStudentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  mobileStatus: { color: '#4338CA', fontWeight: '700', fontSize: 12 },
  mobileDetail: { marginTop: 6, color: '#4B5563', fontSize: 12, lineHeight: 18 },
  mobileActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 9 },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4F46E5' },
  addButtonText: { color: '#FFFFFF', fontWeight: '800' },
  transferButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#C7D2FE', backgroundColor: '#EEF2FF' },
  transferButtonText: { color: '#4338CA', fontWeight: '800' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 24 },
  loadingText: { color: '#6B7280' },
  errorBox: { marginBottom: 12, padding: 11, borderRadius: 9, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  errorText: { color: '#B91C1C', lineHeight: 20 },
  noticeBox: { marginBottom: 12, padding: 11, borderRadius: 9, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  noticeText: { color: '#047857', lineHeight: 20 },
  emptyBox: { alignItems: 'center', paddingVertical: 24, borderRadius: 12, backgroundColor: '#F9FAFB' },
  emptyTitle: { color: '#374151', fontWeight: '800' },
  emptyText: { marginTop: 5, color: '#6B7280', fontSize: 13 },
  table: { minWidth: 1490, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, overflow: 'hidden' },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  headRow: { minHeight: 42, backgroundColor: '#F3F4F6' },
  headCell: { paddingHorizontal: 10, paddingVertical: 12, color: '#374151', fontSize: 12, fontWeight: '800', borderRightWidth: 1, borderRightColor: '#E5E7EB' },
  cell: { paddingHorizontal: 10, paddingVertical: 14, color: '#4B5563', fontSize: 13, borderRightWidth: 1, borderRightColor: '#E5E7EB' },
  cellView: { justifyContent: 'center', alignItems: 'center', padding: 7, borderRightWidth: 1, borderRightColor: '#E5E7EB' },
  nameCell: { width: 120 }, codeCell: { width: 120 }, phoneCell: { width: 145 }, emailCell: { width: 190 }, recipientCell: { width: 105 }, dateCell: { width: 105 }, statusCell: { width: 190 }, actionCell: { width: 220 },
  nameText: { color: '#111827', fontWeight: '800' },
  editButton: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 8, backgroundColor: '#EEF2FF' },
  editButtonText: { color: '#4338CA', fontWeight: '800' },
  stopButton: { marginTop: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: '#FEF2F2' },
  stopButtonText: { color: '#B91C1C', fontSize: 12, fontWeight: '800' },
  restartButton: { marginTop: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: '#ECFDF5' },
  restartButtonText: { color: '#047857', fontSize: 12, fontWeight: '800' },
  deleteButton: { marginTop: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: '#FEE2E2' },
  deleteButtonText: { color: '#991B1B', fontSize: 12, fontWeight: '800' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 11, fontWeight: '800' },
  statusActive: { color: '#047857', backgroundColor: '#D1FAE5' },
  statusTransferred: { color: '#4338CA', backgroundColor: '#E0E7FF' },
  statusWithdrawn: { color: '#6B7280', backgroundColor: '#F3F4F6' },
  statusDate: { marginTop: 4, color: '#6B7280', fontSize: 10 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(17,24,39,0.55)' },
  modalCard: { width: '100%', maxWidth: 560, maxHeight: '92%', borderRadius: 18, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  smallModalCard: { width: '100%', maxWidth: 460, borderRadius: 18, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  modalTitle: { color: '#111827', fontSize: 18, fontWeight: '800' },
  form: { padding: 18 },
  label: { marginTop: 12, marginBottom: 6, color: '#374151', fontSize: 13, fontWeight: '700' },
  input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', color: '#111827' },
  pickerWrap: { minHeight: 46, borderRadius: 9, borderWidth: 1, borderColor: '#D1D5DB', overflow: 'hidden', backgroundColor: '#FFFFFF' },
  guideBox: { padding: 11, borderRadius: 9, color: '#4B5563', backgroundColor: '#F9FAFB', lineHeight: 19 },
  recipientButtons: { flexDirection: 'row', gap: 8 },
  recipientButton: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 9, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  recipientButtonActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  recipientButtonText: { color: '#6B7280', fontWeight: '700' },
  recipientButtonTextActive: { color: '#4338CA' },
  helpText: { marginTop: 14, color: '#6B7280', fontSize: 12, lineHeight: 18 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, padding: 16, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  cancelButton: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 9, backgroundColor: '#F3F4F6' },
  cancelText: { color: '#374151', fontWeight: '800' },
  saveButton: { minWidth: 120, alignItems: 'center', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 9, backgroundColor: '#4F46E5' },
  saveText: { color: '#FFFFFF', fontWeight: '800' },
  disabled: { opacity: 0.55 },
});
