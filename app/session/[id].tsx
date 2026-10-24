import { Ionicons } from '@expo/vector-icons';
import { Picker } from '../../components/ReadablePicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { AppAccessGate } from '../../components/AppAccessGate';
import TestQuestionSheet, { type QuestionSheetHandle } from '../../components/TestQuestionSheet';
import SessionMessagingComposer from '../../components/SessionMessagingComposer';
import SessionQuickEntryGrid, { type QuickEntryRow } from '../../components/SessionQuickEntryGrid';
import { useAppAccess } from '../../contexts/AppAccessContext';
import type { QuickEntryColumn } from '../../lib/sessionQuickEntry';
import {
  addSupabaseMakeupParticipant,
  addSupabaseClinicParticipant,
  addSupabaseHomework,
  addSupabaseTest,
  deleteSupabaseSessionItem,
  getSupabaseMakeupCandidates,
  getSupabaseClinicCandidates,
  getSupabaseMakeupHomeSessions,
  getSupabaseSessionWorkspace,
  removeSupabaseMakeupParticipant,
  saveSupabaseSessionRosterDraft,
  updateSupabaseHomework,
  updateSupabaseTest,
  type AttendanceStatus,
  type HomeworkGrade,
  type MakeupCandidate,
  type MakeupHomeSession,
  type SessionWorkspace,
  type StudentSessionDraft,
} from '../../lib/classData';

type TestMode = 'blank' | 'score' | 'memo' | 'absent';

type StudentDraftState = {
  attendance: {
    status: AttendanceStatus | '';
    makeupDate: string;
    makeupTime: string;
    makeupNote: string;
    notes: string;
  };
  homework: Record<string, { grade: HomeworkGrade | ''; notes: string }>;
  tests: Record<string, { mode: TestMode; score: string; resultText: string; notes: string }>;
};

const attendanceOptions: Array<{ label: string; value: AttendanceStatus | '' }> = [
  { label: '미입력', value: '' },
  { label: '출석', value: '출석' },
  { label: '영상', value: '영상' },
  { label: '보강', value: '보강' },
  { label: '결석', value: '결석' },
];

const homeworkOptions: Array<{ label: string; value: HomeworkGrade | '' }> = [
  { label: '미입력', value: '' },
  { label: 'A', value: 'A' },
  { label: 'B', value: 'B' },
  { label: 'C', value: 'C' },
  { label: '미제출', value: '미제출' },
];

const widths = { student: 150, attendance: 120, makeup: 240, notes: 170, homework: 125, test: 180, testMemo: 220 };

function firstParam(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim();
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '요청을 처리하지 못했습니다.');
    if (message.includes('Test maximum cannot be lower')) return '새 만점보다 높은 기존 점수가 있습니다. 해당 학생 점수를 먼저 수정해 주세요.';
    if (message.includes('Test format cannot change after results')) return '학생 결과가 입력된 시험은 형식을 변경할 수 없습니다. 결과를 지운 뒤 변경해 주세요.';
    if (message.includes('Test result does not match its format')) return '시험 형식에 맞지 않는 결과입니다. 시험 형식과 입력값을 확인해 주세요.';
    if (message.includes('Linked makeup attendance')) return '이 보강은 다른 반 차시와 연결되어 있습니다. 보강을 간 반의 차시에서 해당 학생을 제거해 주세요.';
    if (message.includes('duplicate key')) return '같은 이름의 항목이 이미 있습니다.';
    return message;
  }
  return '요청을 처리하지 못했습니다.';
}

function isValidDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3]);
}

function isValidTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function formatScore(value: number, fixed = false): string {
  return fixed ? value.toFixed(2) : value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
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

function buildDrafts(workspace: SessionWorkspace): Record<string, StudentDraftState> {
  return Object.fromEntries(workspace.students.map((student) => {
    const attendance = workspace.attendance[student.id];
    return [student.id, {
      attendance: {
        status: attendance?.status ?? '',
        makeupDate: attendance?.makeupDate ?? '',
        makeupTime: attendance?.makeupTime ?? '',
        makeupNote: attendance?.makeupNote ?? '',
        notes: attendance?.notes ?? '',
      },
      homework: Object.fromEntries(workspace.homeworks.map((item) => {
        const result = item.results[student.id];
        return [item.id, { grade: (result?.grade ?? '') as HomeworkGrade | '', notes: result?.notes ?? '' }];
      })),
      tests: Object.fromEntries(workspace.tests.map((item) => {
        const result = item.results[student.id];
        const mode: TestMode = result?.status === '결시' ? 'absent'
          : item.resultType === 'memo' && result?.resultText ? 'memo'
            : result?.score != null ? 'score' : 'blank';
        return [item.id, {
          mode, score: result?.score == null ? '' : String(result.score),
          resultText: result?.resultText ?? '', notes: result?.notes ?? '',
        }];
      })),
    }];
  }));
}

function SessionWorkspaceScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const { access } = useAppAccess();
  const canManage = access?.app_role === 'manager' || access?.app_role === 'admin';
  const params = useLocalSearchParams<{ id?: string | string[]; classId?: string | string[]; title?: string | string[]; termLabel?: string | string[]; day?: string | string[] }>();
  const sessionId = firstParam(params.id);
  const classId = firstParam(params.classId);
  const routeTitle = firstParam(params.title);
  const validParams = /^[1-9]\d*$/.test(classId) && /^[1-9]\d*$/.test(sessionId);

  const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null);
  const [drafts, setDrafts] = useState<Record<string, StudentDraftState>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [questionSheetDirty, setQuestionSheetDirty] = useState(false);
  const [messageDirty, setMessageDirty] = useState(false);
  const [quickEntryVisible, setQuickEntryVisible] = useState(false);
  const questionSheetRef = useRef<QuestionSheetHandle>(null);
  const [leavePromptVisible, setLeavePromptVisible] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const [approvedLeaveAction, setApprovedLeaveAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const [homeworkTitle, setHomeworkTitle] = useState('');
  const [testTitle, setTestTitle] = useState('');
  const [testResultType, setTestResultType] = useState<'score' | 'memo'>('score');
  const [testMaxScore, setTestMaxScore] = useState('');
  const [homeworkEditId, setHomeworkEditId] = useState('');
  const [testEditId, setTestEditId] = useState('');
  const [makeupModalVisible, setMakeupModalVisible] = useState(false);
  const [makeupCandidates, setMakeupCandidates] = useState<MakeupCandidate[]>([]);
  const [makeupCandidateKey, setMakeupCandidateKey] = useState('');
  const [makeupHomeSessions, setMakeupHomeSessions] = useState<MakeupHomeSession[]>([]);
  const [makeupHomeSessionId, setMakeupHomeSessionId] = useState('');
  const [makeupSessionsLoading, setMakeupSessionsLoading] = useState(false);
  const [makeupNotes, setMakeupNotes] = useState('');
  const editingTestHasResults = Boolean(testEditId && Object.keys(workspace?.tests.find((item) => item.id === testEditId)?.results ?? {}).length);

  const load = useCallback(async (showFullLoader = false) => {
    if (!validParams) {
      setLoadError('수업 또는 차시 주소가 올바르지 않습니다.');
      setLoading(false);
      return;
    }
    if (showFullLoader) setLoading(true);
    else setRefreshing(true);
    setLoadError('');
    try {
      const nextWorkspace = await getSupabaseSessionWorkspace(classId, sessionId);
      setWorkspace(nextWorkspace);
      setDrafts(buildDrafts(nextWorkspace));
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [classId, sessionId, validParams]);

  useEffect(() => {
    void load(true);
  }, [load]);

  const itemStatistics = useMemo(() => {
    if (!workspace) return { homeworks: [], tests: [] };
    const total = workspace.students.length;
    return {
      homeworks: workspace.homeworks.map((item) => {
        const grades = workspace.students.map((student) => drafts[student.id]?.homework[item.id]?.grade ?? '');
        const count = (grade: HomeworkGrade) => grades.filter((value) => value === grade).length;
        const entered = grades.filter(Boolean).length;
        return { id: item.id, title: item.title, total, entered, a: count('A'), b: count('B'), c: count('C'), missing: count('미제출') };
      }),
      tests: workspace.tests.map((item) => {
        const values = workspace.students.map((student) => drafts[student.id]?.tests[item.id]);
        const absent = values.filter((value) => value?.mode === 'absent').length;
        if (item.resultType === 'memo') {
          const resultTexts = values
            .filter((value) => value?.mode === 'memo')
            .map((value) => value!.resultText.trim()).filter(Boolean);
          const counts = new Map<string, number>();
          for (const result of resultTexts) counts.set(result, (counts.get(result) ?? 0) + 1);
          return {
            id: item.id, title: item.title, resultType: item.resultType, maxScore: null,
            total, entered: resultTexts.length + absent, absent,
            resultSummary: [...counts].map(([label, count]) => `${label} ${count}명`).join(' · '),
            average: null, highest: null, lowest: null,
          };
        }
        const scores = values
          .filter((value) => value?.mode === 'score' && /^\d+(?:\.\d{1,2})?$/.test(value.score.trim()))
          .map((value) => Number(value!.score))
          .filter((value) => Number.isFinite(value) && value >= 0 && value <= (item.maxScore ?? 0));
        const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
        return {
          id: item.id, title: item.title, resultType: item.resultType, maxScore: item.maxScore, total,
          entered: scores.length + absent, absent, average,
          resultSummary: '',
          highest: scores.length ? Math.max(...scores) : null,
          lowest: scores.length ? Math.min(...scores) : null,
        };
      }),
    };
  }, [drafts, workspace]);

  const savedDrafts = useMemo(() => workspace ? buildDrafts(workspace) : {}, [workspace]);
  const changedStudents = useMemo(() => workspace?.students.filter((student) =>
    JSON.stringify(drafts[student.id]) !== JSON.stringify(savedDrafts[student.id])) ?? [],
  [drafts, savedDrafts, workspace]);
  const hasDraftChanges = changedStudents.length > 0;
  const quickColumns = useMemo<QuickEntryColumn[]>(() => {
    if (!workspace) return [];
    return [
      { key: 'attendance', label: '출석', kind: 'attendance', width: 176 },
      { key: 'attendance-note', label: '출석 메모', kind: 'attendance-note', width: 170 },
      ...workspace.homeworks.map((item) => ({ key: `homework:${item.id}`, label: `HW${item.sortOrder}: ${item.title}`, kind: 'homework' as const, itemId: item.id, width: 155 })),
      ...workspace.tests.map((item) => ({ key: `test:${item.id}`, label: `TEST${item.sortOrder}: ${item.title}${item.resultType === 'score' ? ` / ${item.maxScore}점` : ' / 결과'}`, kind: item.resultType === 'score' ? 'score' as const : 'memo' as const, itemId: item.id, maxScore: item.maxScore, width: item.resultType === 'score' ? 155 : 190 })),
    ];
  }, [workspace]);
  const quickRows = useMemo<QuickEntryRow[]>(() => workspace?.students.map((student) => {
    const draft = drafts[student.id];
    const values: Record<string, string> = {
      attendance: draft?.attendance.status ?? '',
      'attendance-note': draft?.attendance.notes ?? '',
    };
    for (const item of workspace.homeworks) values[`homework:${item.id}`] = draft?.homework[item.id]?.grade ?? '';
    for (const item of workspace.tests) {
      const result = draft?.tests[item.id];
      values[`test:${item.id}`] = result?.mode === 'absent' ? '결시'
        : result?.mode === 'score' ? result.score : result?.mode === 'memo' ? result.resultText : '';
    }
    return {
      id: student.id, name: student.fullName, code: student.studentCode,
      lockAttendance: Boolean(workspace.attendance[student.id]?.makeupHostSessionId), values,
    };
  }) ?? [], [drafts, workspace]);
  const editingHomework = workspace?.homeworks.find((item) => item.id === homeworkEditId);
  const editingTest = workspace?.tests.find((item) => item.id === testEditId);
  const hasPendingHomework = Boolean(homeworkEditId
    ? editingHomework && homeworkTitle.trim() !== editingHomework.title
    : homeworkTitle.trim());
  const hasPendingTest = Boolean(testEditId
    ? editingTest && (testTitle.trim() !== editingTest.title || testResultType !== editingTest.resultType
      || (testResultType === 'score' && Number(testMaxScore) !== editingTest.maxScore))
    : testTitle.trim() || testMaxScore.trim());
  const hasUnsavedChanges = hasDraftChanges || questionSheetDirty || hasPendingHomework || hasPendingTest || messageDirty;

  usePreventRemove(hasUnsavedChanges && !approvedLeaveAction, ({ data }) => {
    setPendingLeaveAction(data.action);
    setLeavePromptVisible(true);
  });

  useEffect(() => {
    if (approvedLeaveAction) navigation.dispatch(approvedLeaveAction);
  }, [approvedLeaveAction, navigation]);

  const updateDraft = useCallback((studentId: string, updater: (draft: StudentDraftState) => StudentDraftState) => {
    setNotice('');
    setActionError('');
    setDrafts((current) => {
      const draft = current[studentId];
      return draft ? { ...current, [studentId]: updater(draft) } : current;
    });
  }, []);

  const setAttendance = (studentId: string, status: AttendanceStatus | '') => {
    updateDraft(studentId, (draft) => ({
      ...draft,
      attendance: status === ''
        ? { status: '', makeupDate: '', makeupTime: '', makeupNote: '', notes: '' }
        : { ...draft.attendance, status, ...(status === '보강' ? {} : { makeupDate: '', makeupTime: '', makeupNote: '' }) },
    }));
  };

  const patchAttendance = (studentId: string, patch: Partial<StudentDraftState['attendance']>) => {
    updateDraft(studentId, (draft) => ({ ...draft, attendance: { ...draft.attendance, ...patch } }));
  };

  const setHomeworkGrade = (studentId: string, homeworkId: string, grade: HomeworkGrade | '') => {
    updateDraft(studentId, (draft) => ({
      ...draft,
      homework: { ...draft.homework, [homeworkId]: { ...(draft.homework[homeworkId] ?? { notes: '' }), grade } },
    }));
  };

  const patchTest = (studentId: string, testId: string, patch: Partial<StudentDraftState['tests'][string]>) => {
    updateDraft(studentId, (draft) => ({
      ...draft,
      tests: { ...draft.tests, [testId]: { ...(draft.tests[testId] ?? { mode: 'blank', score: '', resultText: '', notes: '' }), ...patch } },
    }));
  };

  const commitQuickEntry = (studentId: string, column: QuickEntryColumn, value: string) => {
    if (column.kind === 'attendance') setAttendance(studentId, value as AttendanceStatus | '');
    else if (column.kind === 'attendance-note') patchAttendance(studentId, { notes: value });
    else if (column.kind === 'homework' && column.itemId) setHomeworkGrade(studentId, column.itemId, value as HomeworkGrade | '');
    else if (column.itemId) {
      const patch: Partial<StudentDraftState['tests'][string]> = value === '' ? { mode: 'blank', score: '', resultText: '' }
        : value === '결시' ? { mode: 'absent', score: '', resultText: '' }
          : column.kind === 'score' ? { mode: 'score', score: value, resultText: '' }
            : { mode: 'memo', score: '', resultText: value };
      patchTest(studentId, column.itemId, patch);
    }
  };

  const buildStudentPayload = (studentId: string, fullName: string): StudentSessionDraft | null => {
    if (!workspace) return null;
    const draft = drafts[studentId];
    if (!draft) return null;
    if (draft.attendance.status === '보강') {
      if (draft.attendance.makeupDate && !isValidDate(draft.attendance.makeupDate)) {
        throw new Error(`${fullName}: 보강 날짜는 YYYY-MM-DD 형식으로 입력해 주세요.`);
      }
      if (draft.attendance.makeupTime && !isValidTime(draft.attendance.makeupTime)) {
        throw new Error(`${fullName}: 보강 시간은 HH:MM 형식으로 입력해 주세요.`);
      }
      if (draft.attendance.makeupTime && !draft.attendance.makeupDate) {
        throw new Error(`${fullName}: 보강 시간을 입력하려면 날짜도 입력해 주세요.`);
      }
    }

    const testResults: StudentSessionDraft['testResults'] = workspace.tests.map((test) => {
      const value = draft.tests[test.id] ?? { mode: 'blank' as const, score: '', resultText: '', notes: '' };
      if (value.mode === 'blank') return { testId: test.id, score: null, resultText: '', status: '' as const, notes: value.notes };
      if (value.mode === 'absent') return { testId: test.id, score: null, resultText: '', status: '결시' as const, notes: value.notes };
      if (test.resultType === 'memo') {
        const resultText = value.resultText.trim();
        if (value.mode !== 'memo' || !resultText || resultText.length > 200) {
          throw new Error(`${fullName}: ${test.title} 결과를 200자 이내로 입력해 주세요.`);
        }
        return { testId: test.id, score: null, resultText, status: '' as const, notes: value.notes };
      }
      if (value.mode !== 'score') throw new Error(`${fullName}: ${test.title} 점수 형식을 확인해 주세요.`);
      const normalized = value.score.trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
        throw new Error(`${fullName}: ${test.title} 점수는 소수점 둘째 자리까지 입력해 주세요.`);
      }
      const score = Number(normalized);
      if (score < 0 || score > (test.maxScore ?? 0)) {
        throw new Error(`${fullName}: ${test.title} 점수는 0~${test.maxScore} 사이여야 합니다.`);
      }
      return { testId: test.id, score, resultText: '', status: '' as const, notes: value.notes };
    });

    return {
      attendance: { ...draft.attendance },
      homeworkResults: workspace.homeworks.map((item) => ({
        homeworkId: item.id,
        grade: draft.homework[item.id]?.grade ?? '',
        notes: draft.homework[item.id]?.notes ?? '',
      })),
      testResults,
    };
  };

  const saveAll = async (): Promise<boolean> => {
    if (!workspace || workspace.students.length === 0 || !hasDraftChanges || busyKey || refreshing) return false;
    setActionError('');
    setNotice('');
    let payloads: Array<{ studentId: string; draft: StudentSessionDraft }>;
    try {
      payloads = changedStudents.map((student) => {
        const draft = buildStudentPayload(student.id, student.fullName);
        if (!draft) throw new Error(`${student.fullName} 학생의 입력값을 찾지 못했습니다.`);
        return { studentId: student.id, draft };
      });
    } catch (error) {
      setActionError(errorText(error));
      return false;
    }
    setBusyKey('save-all');
    try {
      await saveSupabaseSessionRosterDraft(classId, sessionId, payloads);
      await load(false);
      setNotice(`${payloads.length}명의 변경된 기록을 저장했습니다.`);
      return true;
    } catch (error) {
      setActionError(errorText(error));
      return false;
    } finally {
      setBusyKey('');
    }
  };

  const saveAndLeave = async () => {
    if (!pendingLeaveAction || busyKey || refreshing) return;
    setLeavePromptVisible(false);
    if (hasDraftChanges && !(await saveAll())) return;
    if (hasPendingHomework && !(await addHomework())) return;
    if (hasPendingTest && !(await addTest())) return;
    if (questionSheetDirty && !(await questionSheetRef.current?.save())) return;
    setApprovedLeaveAction(pendingLeaveAction);
  };

  const addHomework = async (): Promise<boolean> => {
    if (!workspace || !homeworkTitle.trim()) {
      setActionError('숙제 이름을 입력해 주세요.');
      return false;
    }
    setBusyKey('add-homework');
    setActionError('');
    setNotice('');
    try {
      const editing = Boolean(homeworkEditId);
      if (editing) await updateSupabaseHomework(homeworkEditId, homeworkTitle);
      else {
        const sortOrder = Math.max(0, ...workspace.homeworks.map((item) => item.sortOrder)) + 1;
        await addSupabaseHomework(classId, sessionId, homeworkTitle, sortOrder);
      }
      setHomeworkTitle('');
      setHomeworkEditId('');
      await load(false);
      setNotice(editing ? '숙제 항목을 수정했습니다.' : '숙제 항목을 추가했습니다.');
      return true;
    } catch (error) {
      setActionError(errorText(error));
      return false;
    } finally {
      setBusyKey('');
    }
  };

  const addTest = async (): Promise<boolean> => {
    if (!workspace || !testTitle.trim()) {
      setActionError('시험 이름을 입력해 주세요.');
      return false;
    }
    const normalized = testMaxScore.trim();
    if (testResultType === 'score' && (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0)) {
      setActionError('시험 만점은 0보다 큰 숫자로 소수점 둘째 자리까지 입력해 주세요.');
      return false;
    }
    setBusyKey('add-test');
    setActionError('');
    setNotice('');
    try {
      const editing = Boolean(testEditId);
      const maxScore = testResultType === 'score' ? Number(normalized) : null;
      if (editing) await updateSupabaseTest(testEditId, testTitle, testResultType, maxScore);
      else {
        const sortOrder = Math.max(0, ...workspace.tests.map((item) => item.sortOrder)) + 1;
        await addSupabaseTest(classId, sessionId, testTitle, testResultType, maxScore, sortOrder);
      }
      setTestTitle('');
      setTestResultType('score');
      setTestMaxScore('');
      setTestEditId('');
      await load(false);
      setNotice(editing ? '시험 항목을 수정했습니다.' : '시험 항목을 추가했습니다.');
      return true;
    } catch (error) {
      setActionError(errorText(error));
      return false;
    } finally {
      setBusyKey('');
    }
  };

  const deleteItem = (kind: 'homework' | 'test', itemId: string, title: string) => {
    confirmAction('항목 삭제', `${title} 항목을 삭제할까요?\n이 항목에 입력한 모든 학생 결과도 함께 삭제되며 복구할 수 없습니다.`, () => {
      void (async () => {
        setBusyKey(`delete-${kind}-${itemId}`);
        setActionError('');
        setNotice('');
        try {
          await deleteSupabaseSessionItem(classId, sessionId, kind, itemId);
          if (kind === 'homework' && homeworkEditId === itemId) { setHomeworkEditId(''); setHomeworkTitle(''); }
          if (kind === 'test' && testEditId === itemId) { setTestEditId(''); setTestTitle(''); setTestResultType('score'); setTestMaxScore(''); }
          await load(false);
          setNotice(`${title} 항목을 삭제했습니다.`);
        } catch (deleteError) {
          setActionError(errorText(deleteError));
        } finally {
          setBusyKey('');
        }
      })();
    });
  };

  const openMakeupModal = async () => {
    setBusyKey('load-makeup'); setActionError(''); setNotice('');
    try {
      const clinic = workspace?.classKind === 'clinic';
      const candidates = clinic
        ? await getSupabaseClinicCandidates(classId, sessionId)
        : await getSupabaseMakeupCandidates(classId, sessionId);
      const firstCandidate = candidates[0];
      const originalSessions = !clinic && firstCandidate
        ? await getSupabaseMakeupHomeSessions(firstCandidate.homeClassId, firstCandidate.studentId)
        : [];
      setMakeupCandidates(candidates);
      setMakeupCandidateKey(firstCandidate ? `${firstCandidate.studentId}:${firstCandidate.homeClassId}` : '');
      setMakeupHomeSessions(originalSessions);
      setMakeupHomeSessionId(originalSessions[0]?.id ?? '');
      setMakeupNotes('');
      setMakeupModalVisible(true);
    } catch (error) { setActionError(errorText(error)); }
    finally { setBusyKey(''); }
  };

  const changeMakeupCandidate = async (candidateKey: string) => {
    setMakeupCandidateKey(candidateKey);
    setMakeupHomeSessions([]);
    setMakeupHomeSessionId('');
    const candidate = makeupCandidates.find((item) => `${item.studentId}:${item.homeClassId}` === candidateKey);
    if (!candidate || workspace?.classKind === 'clinic') return;
    setMakeupSessionsLoading(true);
    try {
      const originalSessions = await getSupabaseMakeupHomeSessions(candidate.homeClassId, candidate.studentId);
      setMakeupHomeSessions(originalSessions);
      setMakeupHomeSessionId(originalSessions[0]?.id ?? '');
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setMakeupSessionsLoading(false);
    }
  };

  const addMakeupStudent = async () => {
    const candidate = makeupCandidates.find((item) => `${item.studentId}:${item.homeClassId}` === makeupCandidateKey);
    if (!candidate) { setActionError('추가할 학생을 선택해 주세요.'); return; }
    if (workspace?.classKind !== 'clinic' && !makeupHomeSessionId) {
      setActionError('원래 수업에서 보강으로 처리할 차시를 선택해 주세요.'); return;
    }
    setBusyKey('add-makeup'); setActionError(''); setNotice('');
    try {
      if (workspace?.classKind === 'clinic') {
        await addSupabaseClinicParticipant(classId, sessionId, candidate, makeupNotes);
      } else {
        await addSupabaseMakeupParticipant(classId, sessionId, candidate, makeupHomeSessionId, makeupNotes);
      }
      setMakeupModalVisible(false);
      await load(false);
      setNotice(`${candidate.fullName} 학생을 이 차시에 추가했습니다.`);
    } catch (error) { setActionError(errorText(error)); }
    finally { setBusyKey(''); }
  };

  const removeMakeupStudent = (studentId: string, fullName: string) => {
    confirmAction('참여 학생 제거', `${fullName} 학생을 이 차시에서 제거할까요?\n이 차시에 입력한 출석·숙제·시험 기록도 함께 삭제됩니다.`, () => {
      void (async () => {
        setBusyKey(`remove-makeup-${studentId}`); setActionError(''); setNotice('');
        try {
          await removeSupabaseMakeupParticipant(classId, sessionId, studentId);
          await load(false);
          setNotice(`${fullName} 학생을 이 차시에서 제거했습니다.`);
        } catch (error) { setActionError(errorText(error)); }
        finally { setBusyKey(''); }
      })();
    });
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#4F46E5" /><Text style={styles.loadingText}>차시 기록을 불러오는 중...</Text></View>;
  }

  if (!workspace) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>차시를 열 수 없습니다.</Text>
        <Text style={styles.centerMessage}>{loadError || '차시 정보가 없습니다.'}</Text>
        <View style={styles.centerActions}>
          <Pressable style={styles.secondaryButton} onPress={() => router.back()}><Text style={styles.secondaryButtonText}>뒤로</Text></Pressable>
          <Pressable style={styles.primaryButton} onPress={() => void load(true)}><Text style={styles.primaryButtonText}>다시 불러오기</Text></Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="뒤로" style={styles.iconButton} onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color="#111827" /></Pressable>
        <View style={styles.headerTextWrap}>
          <Text numberOfLines={1} style={styles.headerTitle}>{routeTitle || '차시 기록'}</Text>
          <Text style={styles.headerMeta}>{workspace.sessionNumber}차시 · {workspace.sessionDate}</Text>
        </View>
        <Pressable accessibilityLabel="새로고침" disabled={refreshing} style={styles.iconButton} onPress={() => void load(false)}>
          {refreshing ? <ActivityIndicator size="small" color="#4F46E5" /> : <Ionicons name="refresh" size={21} color="#4F46E5" />}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerTitle}>{workspace.sessionNumber}차시 기록표</Text>
          <Text style={styles.infoBannerText}>기존에 저장한 값이 표에 표시됩니다. 여러 학생을 수정한 뒤 전체 저장을 한 번 누르면 됩니다.</Text>
        </View>
        {!!loadError && <View style={styles.errorBox}><Text style={styles.errorBoxText}>{loadError}</Text></View>}
        {!!actionError && <View style={styles.errorBox}><Text style={styles.errorBoxText}>{actionError}</Text></View>}
        {!!notice && <View style={styles.successBox}><Text style={styles.successBoxText}>{notice}</Text></View>}

        <View style={styles.setupCard}>
          <Text style={styles.sectionTitle}>차시 항목 구성</Text>
          <Text style={styles.sectionDescription}>숙제와 시험을 추가하거나 이름·시험 형식·만점을 수정할 수 있습니다.</Text>
          <View style={[styles.setupForms, compact && styles.setupFormsCompact]}>
            <View style={[styles.setupGroup, compact && styles.setupGroupCompact]}>
              <Text style={styles.setupLabel}>{homeworkEditId ? '숙제 수정' : '숙제 추가'}</Text>
              <View style={[styles.inlineForm, compact && styles.inlineFormCompact]}>
                <TextInput value={homeworkTitle} onChangeText={setHomeworkTitle} style={[styles.input, styles.growInput, compact && styles.growInputCompact]} placeholder="예: 교재 숙제" placeholderTextColor="#9CA3AF" editable={!busyKey} />
                {!!homeworkEditId && <Pressable disabled={Boolean(busyKey)} style={styles.cancelEditButton} onPress={() => { setHomeworkEditId(''); setHomeworkTitle(''); }}><Text style={styles.cancelEditText}>취소</Text></Pressable>}
                <Pressable disabled={Boolean(busyKey)} style={[styles.compactButton, Boolean(busyKey) && styles.disabled]} onPress={() => void addHomework()}>
                  {busyKey === 'add-homework' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.compactButtonText}>{homeworkEditId ? '저장' : '추가'}</Text>}
                </Pressable>
              </View>
              <View style={styles.itemList}>{workspace.homeworks.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.itemName}>HW{item.sortOrder}: {item.title}</Text>
                  <Pressable style={styles.itemAction} onPress={() => { setHomeworkEditId(item.id); setHomeworkTitle(item.title); }}><Text style={styles.itemActionText}>수정</Text></Pressable>
                  <Pressable style={styles.itemDelete} onPress={() => deleteItem('homework', item.id, item.title)}><Text style={styles.itemDeleteText}>삭제</Text></Pressable>
                </View>
              ))}</View>
            </View>
            <View style={[styles.setupGroup, compact && styles.setupGroupCompact]}>
              <Text style={styles.setupLabel}>{testEditId ? '시험 수정' : '시험 추가'}</Text>
              <View style={styles.resultTypeOptions}>
                <Pressable disabled={Boolean(busyKey) || editingTestHasResults} style={[styles.resultTypeOption, testResultType === 'score' && styles.resultTypeOptionActive]} onPress={() => setTestResultType('score')}><Text style={[styles.resultTypeText, testResultType === 'score' && styles.resultTypeTextActive]}>점수형</Text></Pressable>
                <Pressable disabled={Boolean(busyKey) || editingTestHasResults} style={[styles.resultTypeOption, testResultType === 'memo' && styles.resultTypeOptionActive]} onPress={() => { setTestResultType('memo'); setTestMaxScore(''); }}><Text style={[styles.resultTypeText, testResultType === 'memo' && styles.resultTypeTextActive]}>결과 메모형</Text></Pressable>
              </View>
              {editingTestHasResults && <Text style={styles.sectionDescription}>학생 결과가 입력된 시험은 형식을 변경할 수 없습니다.</Text>}
              <View style={[styles.inlineForm, compact && styles.inlineFormCompact]}>
                <TextInput value={testTitle} onChangeText={setTestTitle} style={[styles.input, styles.growInput, compact && styles.growInputCompact]} placeholder="예: 단원 평가" placeholderTextColor="#9CA3AF" editable={!busyKey} />
                {testResultType === 'score' && <TextInput value={testMaxScore} onChangeText={setTestMaxScore} style={[styles.input, styles.maxInput]} placeholder="만점" placeholderTextColor="#9CA3AF" keyboardType="decimal-pad" editable={!busyKey} />}
                {!!testEditId && <Pressable disabled={Boolean(busyKey)} style={styles.cancelEditButton} onPress={() => { setTestEditId(''); setTestTitle(''); setTestResultType('score'); setTestMaxScore(''); }}><Text style={styles.cancelEditText}>취소</Text></Pressable>}
                <Pressable disabled={Boolean(busyKey)} style={[styles.compactButton, Boolean(busyKey) && styles.disabled]} onPress={() => void addTest()}>
                  {busyKey === 'add-test' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.compactButtonText}>{testEditId ? '저장' : '추가'}</Text>}
                </Pressable>
              </View>
              <View style={styles.itemList}>{workspace.tests.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.itemName}>TEST{item.sortOrder}: {item.title} · {item.resultType === 'score' ? `${formatScore(item.maxScore ?? 0)}점` : '결과 메모형'}</Text>
                  <Pressable style={styles.itemAction} onPress={() => { setTestEditId(item.id); setTestTitle(item.title); setTestResultType(item.resultType); setTestMaxScore(item.maxScore == null ? '' : String(item.maxScore)); }}><Text style={styles.itemActionText}>수정</Text></Pressable>
                  <Pressable style={styles.itemDelete} onPress={() => deleteItem('test', item.id, item.title)}><Text style={styles.itemDeleteText}>삭제</Text></Pressable>
                </View>
              ))}</View>
            </View>
          </View>
        </View>

        <View style={[styles.tableHeader, compact && styles.tableHeaderCompact]}>
          <View>
            <Text style={styles.sectionTitle}>학생 기록</Text>
            <Text style={styles.sectionDescription}>{workspace.students.length}명 · 빈 값으로 저장하면 미입력 상태가 됩니다.</Text>
          </View>
          <View style={[styles.tableHeaderActions, compact && styles.tableHeaderActionsCompact]}>
            {Platform.OS === 'web' && workspace.students.length > 0 && (
              <Pressable disabled={Boolean(busyKey) || refreshing} style={[styles.makeupAddButton, (Boolean(busyKey) || refreshing) && styles.disabled]} onPress={() => setQuickEntryVisible(true)}>
                <Ionicons name="grid-outline" size={17} color="#4338CA" /><Text style={styles.makeupAddText}>빠른 입력</Text>
              </Pressable>
            )}
            {canManage && (
              <Pressable disabled={Boolean(busyKey)} style={[styles.makeupAddButton, Boolean(busyKey) && styles.disabled]} onPress={() => void openMakeupModal()}>
                <Ionicons name="person-add-outline" size={17} color="#4338CA" /><Text style={styles.makeupAddText}>{workspace.classKind === 'clinic' ? '클리닉 참여 학생' : '다른 반 보강 학생'}</Text>
              </Pressable>
            )}
          </View>
        </View>

        {(itemStatistics.homeworks.length > 0 || itemStatistics.tests.length > 0) && (
          <View style={styles.statisticsPanel}>
            <Text style={styles.statisticsTitle}>항목 통계</Text>
            <Text style={styles.statisticsHint}>표에서 값을 바꾸면 저장 전에도 통계가 바로 계산됩니다.</Text>
            <View style={styles.statisticsGrid}>
              {itemStatistics.homeworks.map((stat) => (
                <View key={`homework-${stat.id}`} style={styles.statisticsCard}>
                  <Text style={styles.statisticsName}>숙제 · {stat.title}</Text>
                  <Text style={styles.statisticsValue}>A {stat.a} · B {stat.b} · C {stat.c} · 미제출 {stat.missing}</Text>
                  <Text style={styles.statisticsMeta}>입력 {stat.entered}/{stat.total}명</Text>
                </View>
              ))}
              {itemStatistics.tests.map((stat) => (
                <View key={`test-${stat.id}`} style={styles.statisticsCard}>
                  <Text style={styles.statisticsName}>시험 · {stat.title}{stat.resultType === 'score' ? ` / ${formatScore(stat.maxScore ?? 0)}점` : ' / 결과 메모'}</Text>
                  {stat.resultType === 'score'
                    ? <Text style={styles.statisticsValue}>평균 {stat.average == null ? '—' : formatScore(stat.average, true)} · 최고 {stat.highest == null ? '—' : formatScore(stat.highest)} · 최저 {stat.lowest == null ? '—' : formatScore(stat.lowest)}</Text>
                    : <Text style={styles.statisticsValue}>{stat.resultSummary || '입력된 결과 없음'}</Text>}
                  <Text style={styles.statisticsMeta}>입력 {stat.entered}/{stat.total}명 · 결시 {stat.absent}명</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {workspace.students.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{workspace.classKind === 'clinic' ? '클리닉 참여 학생이 없습니다.' : '이 날짜에 수강 중인 학생이 없습니다.'}</Text>
            <Text style={styles.emptyDescription}>{workspace.classKind === 'clinic' ? '위의 클리닉 참여 학생 버튼에서 같은 분기의 학생을 추가해 주세요.' : '수업 화면으로 돌아가 학생을 먼저 등록해 주세요.'}</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroller}>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeadRow]}>
                <Text style={[styles.headCell, { width: widths.student }]}>학생</Text>
                <Text style={[styles.headCell, { width: widths.attendance }]}>출석</Text>
                <Text style={[styles.headCell, { width: widths.makeup }]}>보강 정보</Text>
                <Text style={[styles.headCell, { width: widths.notes }]}>출석 메모</Text>
                {workspace.homeworks.map((item) => <Text key={item.id} style={[styles.headCell, { width: widths.homework }]}>HW{item.sortOrder}: {item.title}</Text>)}
                {workspace.tests.map((item) => <Text key={item.id} style={[styles.headCell, { width: item.resultType === 'memo' ? widths.testMemo : widths.test }]}>TEST{item.sortOrder}: {item.title}{'\n'}<Text style={styles.maxScore}>{item.resultType === 'score' ? `/ ${item.maxScore}점` : '결과 메모'}</Text></Text>)}
              </View>

              {workspace.students.map((student) => {
                const draft = drafts[student.id];
                if (!draft) return null;
                const linkedMakeup = workspace.attendance[student.id];
                return (
                  <View key={student.id} style={styles.tableRow}>
                    <View style={[styles.bodyCell, styles.studentCell, { width: widths.student }]}>
                      <Text style={styles.studentName}>{student.fullName}</Text>
                      <Text style={styles.studentCode}>{student.studentCode}</Text>
                      {(student.participationType === 'makeup' || student.participationType === 'clinic') && (
                        <>
                          <Text style={styles.makeupBadge}>{student.participationType === 'clinic' ? '클리닉 참여' : '보강 참여'} · {student.homeClassName || '다른 반'}{student.homeSessionLabel ? ` · ${student.homeSessionLabel}` : ''}</Text>
                          {canManage && <Pressable onPress={() => removeMakeupStudent(student.id, student.fullName)}><Text style={styles.removeMakeupText}>이 차시에서 제거</Text></Pressable>}
                        </>
                      )}
                      {student.participationType === 'enrolled' && linkedMakeup?.makeupHostSessionId && (
                        <Text style={styles.linkedMakeupBadge}>다른 반 보강 → {linkedMakeup.makeupHostClassName || '다른 반'} {linkedMakeup.makeupHostSessionNumber}차시</Text>
                      )}
                    </View>
                    <View style={[styles.bodyCell, { width: widths.attendance }]}>
                      <View style={styles.pickerFrame}>
                        <Picker enabled={!busyKey && !linkedMakeup?.makeupHostSessionId} selectedValue={draft.attendance.status} onValueChange={(value) => setAttendance(student.id, value as AttendanceStatus | '')} style={styles.picker}>
                          {attendanceOptions.map((option) => <Picker.Item key={option.value || 'blank'} label={option.label} value={option.value} />)}
                        </Picker>
                      </View>
                    </View>
                    <View style={[styles.bodyCell, { width: widths.makeup }]}>
                      {linkedMakeup?.makeupHostSessionId ? (
                        <View style={styles.linkedMakeupInfo}>
                          <Text style={styles.linkedMakeupTitle}>{linkedMakeup.makeupHostClassName || '다른 반'} {linkedMakeup.makeupHostSessionNumber}차시에서 보강</Text>
                          <Text style={styles.linkedMakeupMeta}>{linkedMakeup.makeupHostSessionDate} · 보강을 간 차시에서 연결을 관리합니다.</Text>
                        </View>
                      ) : draft.attendance.status === '보강' ? (
                        <>
                          <View style={styles.makeupRow}>
                            <TextInput value={draft.attendance.makeupDate} onChangeText={(makeupDate) => patchAttendance(student.id, { makeupDate })} style={[styles.gridInput, styles.dateInput]} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" editable={!busyKey} />
                            <TextInput value={draft.attendance.makeupTime} onChangeText={(makeupTime) => patchAttendance(student.id, { makeupTime })} style={[styles.gridInput, styles.timeInput]} placeholder="HH:MM" placeholderTextColor="#9CA3AF" editable={!busyKey} />
                          </View>
                          <TextInput value={draft.attendance.makeupNote} onChangeText={(makeupNote) => patchAttendance(student.id, { makeupNote })} style={styles.gridInput} placeholder="예: 일요일 보강" placeholderTextColor="#9CA3AF" editable={!busyKey} />
                        </>
                      ) : <Text style={styles.mutedText}>보강 선택 시 입력</Text>}
                    </View>
                    <View style={[styles.bodyCell, { width: widths.notes }]}>
                      <TextInput value={draft.attendance.notes} onChangeText={(notes) => patchAttendance(student.id, { notes })} style={[styles.gridInput, styles.notesInput]} placeholder="선택" placeholderTextColor="#9CA3AF" multiline editable={!busyKey} />
                    </View>
                    {workspace.homeworks.map((item) => (
                      <View key={item.id} style={[styles.bodyCell, { width: widths.homework }]}>
                        <View style={styles.pickerFrame}>
                          <Picker enabled={!busyKey} selectedValue={draft.homework[item.id]?.grade ?? ''} onValueChange={(value) => setHomeworkGrade(student.id, item.id, value as HomeworkGrade | '')} style={styles.picker}>
                            {homeworkOptions.map((option) => <Picker.Item key={option.value || 'blank'} label={option.label} value={option.value} />)}
                          </Picker>
                        </View>
                      </View>
                    ))}
                    {workspace.tests.map((item) => {
                      const value = draft.tests[item.id] ?? { mode: 'blank' as const, score: '', resultText: '', notes: '' };
                      return (
                        <View key={item.id} style={[styles.bodyCell, { width: item.resultType === 'memo' ? widths.testMemo : widths.test }]}>
                          <View style={styles.pickerFrame}>
                            <Picker enabled={!busyKey} selectedValue={value.mode} onValueChange={(mode) => patchTest(student.id, item.id, {
                              mode: mode as TestMode,
                              ...(mode === 'score' ? {} : { score: '' }),
                              ...(mode === 'memo' ? {} : { resultText: '' }),
                            })} style={styles.picker}>
                              <Picker.Item label="미입력" value="blank" />
                              <Picker.Item label={item.resultType === 'memo' ? '결과 입력' : '점수'} value={item.resultType === 'memo' ? 'memo' : 'score'} />
                              <Picker.Item label="결시" value="absent" />
                            </Picker>
                          </View>
                          {value.mode === 'score' && <TextInput value={value.score} onChangeText={(score) => patchTest(student.id, item.id, { mode: 'score', score })} style={styles.gridInput} placeholder={`0 ~ ${item.maxScore}`} placeholderTextColor="#9CA3AF" keyboardType="decimal-pad" editable={!busyKey} />}
                          {value.mode === 'memo' && <TextInput value={value.resultText} onChangeText={(resultText) => patchTest(student.id, item.id, { mode: 'memo', resultText })} style={styles.gridInput} placeholder="예: 통과, 재시" placeholderTextColor="#9CA3AF" maxLength={200} editable={!busyKey} />}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}

        {workspace.students.length > 0 && (
          <Pressable disabled={Boolean(busyKey) || refreshing || !hasDraftChanges} style={[styles.bottomSaveButton, (Boolean(busyKey) || refreshing || !hasDraftChanges) && styles.disabled]} onPress={() => void saveAll()}>
            {busyKey === 'save-all' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.bottomSaveText}>전체 저장</Text>}
          </Pressable>
        )}
        <TestQuestionSheet ref={questionSheetRef} onDirtyChange={setQuestionSheetDirty} classId={classId} sessionId={sessionId} sessionDate={workspace.sessionDate}
          classLabel={routeTitle || '수업'} tests={workspace.tests} students={workspace.students} />
        <SessionMessagingComposer classId={classId} classLabel={routeTitle || '수업'}
          termLabel={firstParam(params.termLabel)} day={firstParam(params.day)} workspace={workspace}
          recordsDirty={hasDraftChanges || hasPendingHomework || hasPendingTest} onDraftChange={setMessageDirty} />
      </ScrollView>

      {quickEntryVisible && Platform.OS === 'web' && (
        <SessionQuickEntryGrid rows={quickRows} columns={quickColumns} hasChanges={hasDraftChanges}
          busy={Boolean(busyKey) || refreshing} error={actionError} onCommit={commitQuickEntry}
          onSave={saveAll} onClose={() => setQuickEntryVisible(false)} />
      )}

      <Modal visible={leavePromptVisible} transparent animationType="fade" onRequestClose={() => setLeavePromptVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.leaveCard}>
            <Text style={styles.modalTitle}>저장하지 않은 변경사항</Text>
            <Text style={styles.leaveMessage}>{messageDirty ? '작성 중인 메시지는 아직 대기 목록에 추가되지 않았습니다. 지금 나가면 작성 내용이 사라집니다.' : '변경한 차시 기록이 있습니다. 저장하고 나가시겠어요?'}</Text>
            {!messageDirty && <Pressable style={styles.leaveSaveButton} disabled={Boolean(busyKey) || refreshing} onPress={() => void saveAndLeave()}><Text style={styles.modalSaveText}>저장하고 나가기</Text></Pressable>}
            <Pressable style={styles.leaveDiscardButton} onPress={() => { setLeavePromptVisible(false); setApprovedLeaveAction(pendingLeaveAction); }}><Text style={styles.leaveDiscardText}>저장하지 않고 나가기</Text></Pressable>
            <Pressable style={styles.leaveCancelButton} onPress={() => setLeavePromptVisible(false)}><Text style={styles.modalCancelText}>계속 편집</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={makeupModalVisible} transparent animationType="fade" onRequestClose={() => setMakeupModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{workspace.classKind === 'clinic' ? '클리닉 참여 학생 추가' : '다른 반 보강 학생 추가'}</Text>
              <Pressable accessibilityLabel="닫기" onPress={() => setMakeupModalVisible(false)}><Ionicons name="close" size={24} color="#4B5563" /></Pressable>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalGuide}>{workspace.classKind === 'clinic'
                ? '같은 분기의 정식 수강생을 이 클리닉 차시에 추가합니다. 원래 수업의 수강 상태는 유지되고 클리닉 출석·숙제·시험은 전체 학생 기록에 표시됩니다.'
                : '원래 수업 A의 차시와 실제로 보강하는 이 수업 B의 차시를 연결합니다. B가 A보다 먼저여도 괜찮습니다. B에서 출석·숙제·시험을 입력하고 A에는 다른 반 보강 상태가 자동으로 남습니다.'}</Text>
              <Text style={styles.setupLabel}>학생과 원래 반</Text>
              <View style={styles.pickerFrame}>
                <Picker selectedValue={makeupCandidateKey} onValueChange={(value) => void changeMakeupCandidate(String(value))} style={styles.picker}>
                  {makeupCandidates.length === 0 && <Picker.Item label="추가할 수 있는 학생이 없습니다" value="" />}
                  {makeupCandidates.map((candidate) => (
                    <Picker.Item key={`${candidate.studentId}:${candidate.homeClassId}`} label={`${candidate.fullName} (${candidate.homeClassName})`} value={`${candidate.studentId}:${candidate.homeClassId}`} />
                  ))}
                </Picker>
              </View>
              {workspace.classKind !== 'clinic' && <>
              <Text style={[styles.setupLabel, { marginTop: 14 }]}>원래 수업에서 보강으로 처리할 차시</Text>
              {makeupSessionsLoading ? <ActivityIndicator color="#4F46E5" /> : (
                <View style={styles.pickerFrame}>
                  <Picker selectedValue={makeupHomeSessionId} onValueChange={(value) => setMakeupHomeSessionId(String(value))} style={styles.picker}>
                    {makeupHomeSessions.length === 0 && <Picker.Item label="선택할 수 있는 원래 차시가 없습니다" value="" />}
                    {makeupHomeSessions.map((originalSession) => <Picker.Item key={originalSession.id} label={originalSession.label} value={originalSession.id} />)}
                  </Picker>
                </View>
              )}
              </>}
              <Text style={[styles.setupLabel, { marginTop: 14 }]}>메모 (선택)</Text>
              <TextInput value={makeupNotes} onChangeText={setMakeupNotes} style={styles.input} placeholder="예: 이번 주 1회 보강" placeholderTextColor="#9CA3AF" />
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} disabled={Boolean(busyKey)} onPress={() => setMakeupModalVisible(false)}><Text style={styles.modalCancelText}>취소</Text></Pressable>
              <Pressable style={[styles.modalSave, (!makeupCandidateKey || (workspace.classKind !== 'clinic' && !makeupHomeSessionId) || makeupSessionsLoading || Boolean(busyKey)) && styles.disabled]} disabled={!makeupCandidateKey || (workspace.classKind !== 'clinic' && !makeupHomeSessionId) || makeupSessionsLoading || Boolean(busyKey)} onPress={() => void addMakeupStudent()}>
                {busyKey === 'add-makeup' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.modalSaveText}>차시에 추가</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function SessionRecordRoute() {
  return <AppAccessGate><SessionWorkspaceScreen /></AppAccessGate>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F7FB' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F7FB' },
  loadingText: { marginTop: 12, color: '#6B7280' },
  errorTitle: { color: '#991B1B', fontSize: 20, fontWeight: '800' },
  centerMessage: { marginTop: 8, color: '#6B7280', textAlign: 'center' },
  centerActions: { flexDirection: 'row', gap: 8, marginTop: 18 },
  primaryButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9, backgroundColor: '#4F46E5' },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },
  secondaryButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9, backgroundColor: '#E5E7EB' },
  secondaryButtonText: { color: '#374151', fontWeight: '800' },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 6, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  headerTextWrap: { flex: 1, paddingHorizontal: 8 },
  headerTitle: { color: '#111827', fontSize: 17, fontWeight: '800' },
  headerMeta: { marginTop: 3, color: '#6B7280', fontSize: 12 },
  content: { width: '100%', maxWidth: 1500, alignSelf: 'center', padding: 18, paddingBottom: 60 },
  infoBanner: { padding: 16, borderRadius: 13, borderWidth: 1, borderColor: '#C7D2FE', backgroundColor: '#EEF2FF' },
  infoBannerTitle: { color: '#3730A3', fontSize: 16, fontWeight: '800' },
  infoBannerText: { marginTop: 5, color: '#4F46E5', lineHeight: 20 },
  errorBox: { marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  errorBoxText: { color: '#B91C1C' },
  successBox: { marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' },
  successBoxText: { color: '#047857' },
  setupCard: { marginTop: 16, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  sectionTitle: { color: '#111827', fontSize: 18, fontWeight: '800' },
  sectionDescription: { marginTop: 4, color: '#6B7280', fontSize: 13 },
  setupForms: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 14 },
  setupGroup: { flexGrow: 1, flexBasis: 360 },
  setupFormsCompact: { flexDirection: 'column' },
  setupGroupCompact: { width: '100%', flexGrow: 0, flexBasis: 'auto' },
  setupLabel: { marginBottom: 7, color: '#374151', fontWeight: '800' },
  resultTypeOptions: { flexDirection: 'row', gap: 8, marginBottom: 9 },
  resultTypeOption: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  resultTypeOptionActive: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
  resultTypeText: { color: '#4B5563', fontSize: 12, fontWeight: '700' },
  resultTypeTextActive: { color: '#4338CA' },
  inlineForm: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineFormCompact: { flexWrap: 'wrap' },
  input: { height: 42, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', color: '#111827' },
  growInput: { flex: 1, minWidth: 130 },
  growInputCompact: { width: '100%', flexGrow: 0, flexShrink: 0, flexBasis: '100%', minWidth: 0 },
  maxInput: { width: 90 },
  compactButton: { minWidth: 62, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#4F46E5' },
  compactButtonText: { color: '#FFFFFF', fontWeight: '800' },
  cancelEditButton: { paddingHorizontal: 10, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#E5E7EB' },
  cancelEditText: { color: '#374151', fontWeight: '700' },
  currentItems: { marginTop: 7, color: '#6B7280', fontSize: 12 },
  itemList: { marginTop: 8, gap: 6 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 8, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB' },
  itemName: { flex: 1, color: '#374151', fontSize: 12, fontWeight: '700' },
  itemAction: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: '#EEF2FF' },
  itemActionText: { color: '#4F46E5', fontSize: 11, fontWeight: '800' },
  itemDelete: { paddingHorizontal: 8, paddingVertical: 5 },
  itemDeleteText: { color: '#DC2626', fontSize: 11, fontWeight: '800' },
  tableHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 22, marginBottom: 10 },
  tableHeaderActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  tableHeaderCompact: { flexDirection: 'column', alignItems: 'stretch' },
  tableHeaderActionsCompact: { justifyContent: 'flex-start' },
  makeupAddButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1, borderColor: '#C7D2FE', backgroundColor: '#EEF2FF' },
  makeupAddText: { color: '#4338CA', fontSize: 12, fontWeight: '800' },
  statisticsPanel: { marginBottom: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#D1FAE5', backgroundColor: '#F0FDF4' },
  statisticsTitle: { color: '#065F46', fontSize: 15, fontWeight: '900' },
  statisticsHint: { marginTop: 3, color: '#047857', fontSize: 11 },
  statisticsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  statisticsCard: { flexGrow: 1, flexBasis: 270, padding: 11, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#A7F3D0' },
  statisticsName: { color: '#065F46', fontSize: 12, fontWeight: '800' },
  statisticsValue: { marginTop: 6, color: '#111827', fontSize: 12, fontWeight: '700' },
  statisticsMeta: { marginTop: 4, color: '#6B7280', fontSize: 11 },
  tableScroller: { borderRadius: 12, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  table: { backgroundColor: '#FFFFFF' },
  tableRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  tableHeadRow: { backgroundColor: '#F3F4F6' },
  headCell: { minHeight: 58, paddingHorizontal: 8, paddingVertical: 12, color: '#374151', fontSize: 12, fontWeight: '800', textAlign: 'center', borderRightWidth: 1, borderRightColor: '#D1D5DB' },
  maxScore: { color: '#6B7280', fontSize: 11, fontWeight: '600' },
  bodyCell: { minHeight: 104, justifyContent: 'center', padding: 7, borderRightWidth: 1, borderRightColor: '#E5E7EB' },
  studentCell: { backgroundColor: '#FAFAFA' },
  studentName: { color: '#111827', fontSize: 14, fontWeight: '800' },
  studentCode: { marginTop: 4, color: '#6B7280', fontSize: 11 },
  makeupBadge: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', color: '#0369A1', backgroundColor: '#E0F2FE', fontSize: 10, fontWeight: '800' },
  linkedMakeupBadge: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', color: '#6D28D9', backgroundColor: '#EDE9FE', fontSize: 10, fontWeight: '800' },
  removeMakeupText: { marginTop: 6, color: '#DC2626', fontSize: 10, fontWeight: '700' },
  pickerFrame: { overflow: 'hidden', borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  picker: { height: 54, color: '#111827', backgroundColor: '#FFFFFF' },
  gridInput: { minHeight: 37, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', color: '#111827', fontSize: 12 },
  makeupRow: { flexDirection: 'row', gap: 5, marginBottom: 5 },
  linkedMakeupInfo: { padding: 9, borderRadius: 8, borderWidth: 1, borderColor: '#DDD6FE', backgroundColor: '#F5F3FF' },
  linkedMakeupTitle: { color: '#5B21B6', fontSize: 12, fontWeight: '800' },
  linkedMakeupMeta: { marginTop: 4, color: '#7C3AED', fontSize: 10, lineHeight: 14 },
  dateInput: { flex: 1 },
  timeInput: { width: 65 },
  notesInput: { minHeight: 72, textAlignVertical: 'top', paddingTop: 8 },
  mutedText: { color: '#9CA3AF', fontSize: 12, textAlign: 'center' },
  emptyCard: { alignItems: 'center', padding: 26, borderRadius: 13, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  emptyTitle: { color: '#374151', fontWeight: '800' },
  emptyDescription: { marginTop: 6, color: '#6B7280', fontSize: 13 },
  bottomSaveButton: { alignSelf: 'flex-end', minWidth: 150, alignItems: 'center', marginTop: 14, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 10, backgroundColor: '#4F46E5' },
  bottomSaveText: { color: '#FFFFFF', fontWeight: '800' },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(17,24,39,0.55)' },
  modalCard: { width: '100%', maxWidth: 560, borderRadius: 16, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 17, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  modalTitle: { color: '#111827', fontSize: 17, fontWeight: '800' },
  modalBody: { padding: 17 },
  modalGuide: { marginBottom: 14, padding: 11, borderRadius: 9, color: '#4B5563', backgroundColor: '#F9FAFB', fontSize: 12, lineHeight: 18 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 15, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  modalCancel: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 9, backgroundColor: '#F3F4F6' },
  modalCancelText: { color: '#374151', fontWeight: '800' },
  modalSave: { minWidth: 120, alignItems: 'center', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 9, backgroundColor: '#4F46E5' },
  modalSaveText: { color: '#FFFFFF', fontWeight: '800' },
  leaveCard: { width: '100%', maxWidth: 420, padding: 20, borderRadius: 16, backgroundColor: '#FFFFFF' },
  leaveMessage: { marginTop: 10, marginBottom: 18, color: '#4B5563', lineHeight: 21 },
  leaveSaveButton: { alignItems: 'center', padding: 13, borderRadius: 9, backgroundColor: '#4F46E5' },
  leaveDiscardButton: { alignItems: 'center', padding: 12, marginTop: 8, borderRadius: 9, borderWidth: 1, borderColor: '#E5E7EB' },
  leaveDiscardText: { color: '#DC2626', fontWeight: '800' },
  leaveCancelButton: { alignItems: 'center', padding: 12, marginTop: 8 },
  disabled: { opacity: 0.5 },
});
