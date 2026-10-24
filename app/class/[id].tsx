// app/class/[id].tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput, Platform, PermissionsAndroid, Modal, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter, useRootNavigationState } from "expo-router";
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import * as Application from "expo-application";
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { Ionicons } from "@expo/vector-icons";

// Utils & Config
import { fetchSheetData, fetchClassSheet, fetchClassSheetRaw } from "../../utils/googleSheet_csv";
import { getAttendanceStatus, postSheetData } from "../../utils/sheetApi";
import { getActiveSession, startSession, clearSession } from "../../utils/activeSession";
import { getCurrentUserEmail } from "../../utils/currentUser";
import DirectSms from "../../utils/smsSender";
import { getClassUrls } from "../../utils/classInfo";
import { isSupabaseDataSource } from "../../config/dataSource";
import {
  addSupabaseClassSessions,
  deleteSupabaseClassSession,
  getSupabaseActiveStaff,
  getSupabaseClassDetail,
  updateSupabaseClassSession,
  type AssignableStaff,
} from "../../lib/classData";
import { useAppAccess } from "../../contexts/AppAccessContext";
import { AppAccessGate } from "../../components/AppAccessGate";
import { ClassStudentManager } from "../../components/ClassStudentManager";
import SupabaseClassWorkPanel from "../../components/SupabaseClassWorkPanel";
import SupabaseClassMessagingPanel from "../../components/SupabaseClassMessagingPanel";

// PERMISSION_HEADERS 추가
import { CSV_URLS, API_URLS, CLASSES_HEADERS, ATTENDANCE_LOG_HEADERS, MESSAGE_LOG_HEADERS,
  CLASS_SHEET_HEADERS, CLASS_SHEET_HEADER_ROW, CLASS_DATA_COL_SHIFT, CLASS_SESSION_STRIDE, SHEET_NAMES, 
  PERMISSION_HEADERS, ASSISTANT_HEADERS, SCHEDULE_HEADERS,  } from "../../config/sheetConfig";
// import { ADMIN_DEVICE_IDS } from "../../config/adminConfig"; 

import { INDIVIDUAL_MESSAGE_TEMPLATE } from "../../config/messageConfig";

LocaleConfig.locales['kr'] = {
  monthNames: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
  monthNamesShort: ['1.','2.','3.','4.','5.','6.','7.','8.','9.','10.','11.','12.'],
  dayNames: ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'],
  dayNamesShort: ['일','월','화','수','목','금','토'],
  today: "오늘"
};
LocaleConfig.defaultLocale = 'kr';

// ... (Helpers 함수들은 그대로 유지) ...
const hmToMinutes = (hm: string) => {
  const m = String(hm || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const minutesToHm = (mins: number) => {
  const m = Math.max(0, Math.floor(mins));
  const hh = String(Math.floor(m / 60)).padStart(2, "0"); // 시(Hour) 0 채우기
  const mm = String(m % 60).padStart(2, "0");             // 분(Minute) 0 채우기
  return `${hh}:${mm}`;
};
const nowHm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 0, label: "일" },
];

const parseLocalDate = (ymd: string) => {
  const match = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
};

const formatLocalDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const weekdaysFromText = (value: string) =>
  WEEKDAY_OPTIONS.filter(option => String(value || "").includes(option.label)).map(option => option.value);

const buildRecurringDates = (startYmd: string, weekdays: number[], weeks: number | null, untilYmd: string) => {
  const cursor = parseLocalDate(startYmd);
  const until = weeks == null ? parseLocalDate(untilYmd) : null;
  if (!cursor || weekdays.length === 0 || (weeks == null && (!until || until < cursor))
    || (weeks != null && (!Number.isInteger(weeks) || weeks < 1 || weeks > 52))) return [];
  const selected = new Set(weekdays);
  const dates: string[] = [];
  const maxDays = weeks == null ? 730 : weeks * 7;
  for (let offset = 0; offset < maxDays && dates.length <= 60; offset += 1) {
    if (until && cursor > until) break;
    if (selected.has(cursor.getDay())) dates.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

function ClassDetailScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [messageDraftDirty, setMessageDraftDirty] = useState(false);
  const [approvedLeaveAction, setApprovedLeaveAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  usePreventRemove(messageDraftDirty && !approvedLeaveAction, ({ data }) => {
    const leave = () => setApprovedLeaveAction(data.action);
    if (Platform.OS === 'web') {
      if (window.confirm('작성 중인 공지 메시지가 있습니다. 지금 나가면 내용이 사라집니다. 나가시겠어요?')) leave();
    } else {
      Alert.alert('작성 중인 메시지', '지금 나가면 작성 내용이 사라집니다.', [
        { text: '계속 편집', style: 'cancel' },
        { text: '나가기', style: 'destructive', onPress: leave },
      ]);
    }
  });
  useEffect(() => { if (approvedLeaveAction) navigation.dispatch(approvedLeaveAction); }, [approvedLeaveAction, navigation]);
  const { access } = useAppAccess();
  const params = useLocalSearchParams();
  const rootNavState = useRootNavigationState();
  const navReady = !!rootNavState?.key;
  const targetId = String(Array.isArray(params.id) ? params.id[0] : params.id ?? "").trim();
  const userEmail = getCurrentUserEmail();

  useEffect(() => { if (navReady && !userEmail) router.replace("/(tabs)"); }, [navReady, userEmail, router]);

  // --- State ---
  const actionInFlightRef = useRef(false);
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  
  const [saving, setSaving] = useState(false);
  const [sendingNotice, setSendingNotice] = useState(false); 
  const [sendingIndividual, setSendingIndividual] = useState(false);
  const [message, setMessage] = useState("출근 버튼을 눌러 진행하세요.");
  
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState("");
  const [noticeMsg, setNoticeMsg] = useState("");
  const [individualMsg, setIndividualMsg] = useState("");
  const [sessionNum, setSessionNum] = useState("");
  const [workerName, setWorkerName] = useState("");

  const [scheduleRows, setScheduleRows] = useState<any[]>([]);

  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [scheduleSession, setScheduleSession] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");
  const [scheduleWorkers, setScheduleWorkers] = useState("");
  const [assignableStaff, setAssignableStaff] = useState<AssignableStaff[]>([]);
  const [scheduleStaffIds, setScheduleStaffIds] = useState<string[]>([]);
  const [scheduleMode, setScheduleMode] = useState<"single" | "repeat">("single");
  const [repeatLimit, setRepeatLimit] = useState<"weeks" | "until">("weeks");
  const [repeatWeeks, setRepeatWeeks] = useState("8");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([]);

  const [template, setTemplate] = useState(INDIVIDUAL_MESSAGE_TEMPLATE);
  const [isAdmin, setIsAdmin] = useState(false);       // 이메일이 Admin인 경우
  const [isManager, setIsManager] = useState(false);    // 이메일이 Manager인 경우
  const [isAdminDevice, setIsAdminDevice] = useState(false); // Admin이면서 + 기기 ID까지 일치하는 경우

  const [isEditMode, setIsEditMode] = useState(false);

  const [studentSelectionModalVisible, setStudentSelectionModalVisible] = useState(false);
  const [studentList, setStudentList] = useState<any[]>([]); // 불러온 학생 데이터 저장
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

  const [smsReviewModalVisible, setSmsReviewModalVisible] = useState(false);
  const [unsentMessages, setUnsentMessages] = useState<any[]>([]);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      // 웹에서는 브라우저 기본 알림창 사용
      window.alert(`${title}\n\n${message}`);
    } else {
      // 앱에서는 기존 Alert 사용
      Alert.alert(title, message);
    }
  };

  const showTemplateGuide = () => {
    showAlert(
      "템플릿 변수 가이드",
      "아래 변수들을 사용하면 학생별 정보로 자동 변환됩니다.\n\n" +
      "${STUDENT_NAME} : 학생 이름\n" +
      "${QUARTER} : 분기\n" +
      "${SESSION} : 차시\n" +
      "${ATTENDANCE} : 출석 결과\n" +
      "${HOMEWORK} : 과제 점수\n" +
      "${TEST} : 시험 점수\n" +
      "${CLASS_NAME} : 수업명\n" +
      "${DAY} : 요일"
    );
  };

  // 시트 데이터를 기반으로 Admin 권한 확인
  useEffect(() => {
    const checkPermissions = async () => {
      if (!userEmail) return;

      if (isSupabaseDataSource) {
        setIsAdmin(access?.app_role === 'admin');
        setIsManager(access?.app_role === 'manager');
        setIsAdminDevice(false);
        setWorkerName(access?.full_name || "이름 없음");
        return;
      }

      try {
        const data = await fetchSheetData(CSV_URLS.PERMISSIONS);
        if (!Array.isArray(data)) return;

        // 내 이메일과 일치하는 행 찾기
        const myRecord = data.find((r: any) => {
           const sheetEmail = String(r[PERMISSION_HEADERS.EMAIL] || "").trim().toLowerCase();
           return sheetEmail === userEmail.toLowerCase();
        });

        if (myRecord) {
          const role = String(myRecord[PERMISSION_HEADERS.ROLE] || "").trim();
          const sheetDeviceId = String(myRecord[PERMISSION_HEADERS.DEVICE_ID] || "").trim();
          
          // 1. 역할(Role) 체크
          if (role === 'Admin') setIsAdmin(true);
          if (role === 'Manager') setIsManager(true);

          // 2. 기기(Device) 체크 (Admin인 경우에만 추가 검증)
          if (role === 'Admin' && Platform.OS === 'android') {
             const currentDeviceId = Application.getAndroidId();
             // 시트에 등록된 ID와 현재 기기 ID가 같아야 함
             if (sheetDeviceId && currentDeviceId === sheetDeviceId) {
               setIsAdminDevice(true);
             }
          }
        }
      } catch (e) {
        console.error("Permission check failed", e);
      }
    };

    checkPermissions();
  }, [access, userEmail]);
  
  // 1. 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        setLoadError("");
        if (isSupabaseDataSource) {
          const [result, staff] = await Promise.all([getSupabaseClassDetail(targetId), getSupabaseActiveStaff()]);
          setRow(result.row);
          setScheduleRows(result.schedules);
          setAssignableStaff(staff);
          return;
        }

        const [cData, aData, sData] = await Promise.all([
          fetchSheetData(CSV_URLS.CLASSES), 
          fetchSheetData(CSV_URLS.ASSISTANT_INFO),
          fetchSheetData(CSV_URLS.CLASS_SCHEDULES)
        ]);

        setRow((cData || []).find((r: any) => String(r[CLASSES_HEADERS.CLASS_ID] ?? "").trim() === targetId) || null);

        if (Array.isArray(aData) && userEmail) {
          const myRecord = aData.find((r: any) => 
            String(r[ASSISTANT_HEADERS.EMAIL] || "").trim().toLowerCase() === userEmail.trim().toLowerCase()
          );
          if (myRecord && myRecord[ASSISTANT_HEADERS.NAME]) {
            setWorkerName(myRecord[ASSISTANT_HEADERS.NAME]);
          } else {
            setWorkerName("이름 없음"); // 시트에 정보가 없을 경우 대비
          }
        }

        if (Array.isArray(sData)) {
          const mySchedules = sData.filter((r: any) => 
            String(r[SCHEDULE_HEADERS.CLASS_ID] ?? "").trim() === targetId
          );
          
          // 차시(SESSION) 기준으로 오름차순 정렬 (숫자 변환)
          mySchedules.sort((a: any, b: any) => {
            const sA = Number(a[SCHEDULE_HEADERS.SESSION]) || 0;
            const sB = Number(b[SCHEDULE_HEADERS.SESSION]) || 0;
            return sA - sB;
          });
          
          setScheduleRows(mySchedules);
        }

      } catch (error: any) {
        console.error(error);
        setLoadError(error?.message || "수업 정보를 불러오지 못했습니다.");
      } finally { setLoading(false); }
    })();
  }, [targetId]);

  useEffect(() => {
    if (row) {
      setScheduleWorkers(String(row[CLASSES_HEADERS.WORKERS] ?? ""));
      if (isSupabaseDataSource) setScheduleStaffIds(Array.isArray(row.__staffIds) ? row.__staffIds : []);
    }
  }, [row]);

  // 2. 파생 정보
  const classTitle = useMemo(() => {
    if (!row) return "";
    const school = String(row[CLASSES_HEADERS.SCHOOL] ?? "").trim();
    const subject = String(row[CLASSES_HEADERS.SUBJECT] ?? "").trim();
    return row.__classKind === 'clinic' ? '클리닉'
      : (school && subject) ? `${school} ${subject}` : (school || subject || "수업");
  }, [row]);

  const recurringDates = useMemo(() => {
    return buildRecurringDates(selectedDate, repeatWeekdays,
      repeatLimit === 'weeks' ? Number(repeatWeeks) : null, repeatUntil);
  }, [repeatLimit, repeatUntil, repeatWeeks, repeatWeekdays, selectedDate]);

  const scheduleMarkedDates = useMemo(() => {
    if (scheduleMode === "repeat" && !isEditMode) {
      return recurringDates.reduce<Record<string, any>>((marked, date, index) => {
        marked[date] = {
          selected: true,
          selectedColor: index === 0 ? "#4F46E5" : "#10B981",
        };
        return marked;
      }, {});
    }
    return selectedDate ? { [selectedDate]: { selected: true, selectedColor: "#4F46E5" } } : {};
  }, [isEditMode, recurringDates, scheduleMode, selectedDate]);

  // 3. 출석 상태 확인
  const loadAttendanceStatus = useCallback(async () => {
    const normalizedEmail = userEmail!.trim().toLowerCase();
    const res = await getAttendanceStatus(
      API_URLS.ATTENDANCE_LOG,
      SHEET_NAMES.ATTENDANCE,
      normalizedEmail,
    );

    if (!res.ok) {
      const local = await getActiveSession();
      if (local && local.email === normalizedEmail && local.classId === targetId) {
        setCheckedIn(true);
        setCheckInTime(local.startHm);
        setMessage("현재 출근 상태입니다. (서버 상태 확인 실패)");
      } else {
        setMessage(`출퇴근 상태 확인 실패: ${res.error || "오류 발생"}`);
      }
      return;
    }

    const active = res.data;
    if (active?.checkedIn && active.classId === targetId && active.startTime) {
      setCheckedIn(true);
      setCheckInTime(active.startTime);
      setMessage("현재 출근 상태입니다. (퇴근 버튼을 누르세요)");
      await startSession({
        classId: active.classId,
        className: active.className || classTitle,
        email: normalizedEmail,
        workDate: active.workDate || todayYmd(),
        startHm: active.startTime,
        startedAt: Date.now(),
      });
      return;
    }

    setCheckedIn(false);
    setCheckInTime(null);

    if (active?.checkedIn && active.classId) {
      const activeName = active.className || active.classId;
      setMessage(`현재 "${activeName}" 수업에 출근 중입니다.`);
      if (active.startTime) {
        await startSession({
          classId: active.classId,
          className: activeName,
          email: normalizedEmail,
          workDate: active.workDate || todayYmd(),
          startHm: active.startTime,
          startedAt: Date.now(),
        });
      }
      return;
    }

    const local = await getActiveSession();
    if (local?.email === normalizedEmail) await clearSession();
    setMessage("출근 버튼을 눌러 진행하세요.");
  }, [classTitle, targetId, userEmail]);

  useEffect(() => {
    if (row && !isSupabaseDataSource) loadAttendanceStatus();
  }, [row, loadAttendanceStatus]);

  // 4. 출근 핸들러
  const handleCheckIn = async () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setSaving(true);

    try {
      const normalizedEmail = userEmail!.trim().toLowerCase();
      const existing = await getActiveSession();
      if (existing && existing.email === normalizedEmail && existing.classId !== targetId) {
        Alert.alert("알림", `이미 "${existing.className}" 수업에 출근 중입니다.`);
        return;
      }

      const startTime = nowHm();
      const payload = {
        action: "checkin",
        [ATTENDANCE_LOG_HEADERS.ATTENDANCE_DATE]: todayYmd(),
        [ATTENDANCE_LOG_HEADERS.CLASS_ID]: targetId,
        [ATTENDANCE_LOG_HEADERS.QUARTER]: String(row![CLASSES_HEADERS.QUARTER] ?? "").trim(),
        [ATTENDANCE_LOG_HEADERS.CLASS_NAME]: classTitle,
        [ATTENDANCE_LOG_HEADERS.DAY]: String(row![CLASSES_HEADERS.DAY] ?? "").trim(),
        [ATTENDANCE_LOG_HEADERS.WORKERS]: workerName || "이름 없음",
        [ATTENDANCE_LOG_HEADERS.WORKER_EMAIL]: normalizedEmail,
        [ATTENDANCE_LOG_HEADERS.ATTENDANCE_START]: startTime,
        [ATTENDANCE_LOG_HEADERS.ATTENDANCE_END]: "",
        [ATTENDANCE_LOG_HEADERS.STATUS]: "출근",
        [ATTENDANCE_LOG_HEADERS.WORKER_LOCATION]: "",
        [ATTENDANCE_LOG_HEADERS.NOTE]: "",
      };

      const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.ATTENDANCE, payload);
      if (!res.ok) {
        setMessage(`출근 실패: ${res.error || "오류 발생"}`);
        return;
      }

      const confirmedStart = String(res.data?.attendance?.startTime || startTime).trim();
      setCheckedIn(true);
      setCheckInTime(confirmedStart);
      setMessage(res.data?.alreadyActive ? "이미 출근 처리되어 있습니다." : "출근 완료");
      await startSession({
        classId: targetId,
        className: classTitle,
        email: normalizedEmail,
        workDate: String(res.data?.attendance?.workDate || todayYmd()),
        startHm: confirmedStart,
        startedAt: Date.now(),
      });
    } finally {
      actionInFlightRef.current = false;
      setSaving(false);
    }
  };

  // 5. 퇴근 핸들러
  const handleCheckOut = async () => {
    if (actionInFlightRef.current) return;
    if (!checkInTime) { await loadAttendanceStatus(); return; }

    actionInFlightRef.current = true;
    setSaving(true);
    setMessage("퇴근 처리 중...");

    try {
      const endTime = nowHm();
      const startM = hmToMinutes(checkInTime);
      const endM = hmToMinutes(endTime);
      let workHm = "";
      if (startM !== null && endM !== null) {
        let diff = endM - startM;
        if (diff < 0) diff += 24 * 60;
        workHm = minutesToHm(diff);
      }

      const payload = {
        action: "checkout_update",
        [ATTENDANCE_LOG_HEADERS.CLASS_ID]: targetId,
        [ATTENDANCE_LOG_HEADERS.WORKER_EMAIL]: userEmail!.trim().toLowerCase(),
        [ATTENDANCE_LOG_HEADERS.ATTENDANCE_END]: endTime,
        [ATTENDANCE_LOG_HEADERS.WORK_DURATION]: workHm,
      };

      const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.ATTENDANCE, payload);
      if (!res.ok) {
        setMessage(`퇴근 실패: ${res.error || "오류 발생"}`);
        return;
      }

      setCheckedIn(false);
      setCheckInTime(null);
      setMessage("퇴근 처리 완료");
      await clearSession();
    } finally {
      actionInFlightRef.current = false;
      setSaving(false);
    }
  };

  const handleSendNotice = async () => {
    if (!noticeText.trim()) {
      Alert.alert("입력 오류", "공지 내용을 입력해주세요.");
      return;
    }
    
    setSendingNotice(true);
    setNoticeMsg(""); 

    try {
      const urls = await getClassUrls(targetId);
      if (!urls || !urls.sheetUrl) {
        Alert.alert("오류", "이 수업의 시트 주소를 찾을 수 없습니다.");
        return;
      }

      const studentRows = await fetchClassSheet(urls.sheetUrl);
      
      const targets = (studentRows || []).filter((s: any) => 
        String(s[CLASS_SHEET_HEADERS.PARENT_PHONE] ?? "").trim() !== ""
      );

      if (targets.length === 0) {
        Alert.alert("알림", "학부모 전화번호가 등록된 학생이 없습니다.");
        return;
      }

      const promises = targets.map((student: any) => {
        const payload = {
          [MESSAGE_LOG_HEADERS.CLASS_ID]: targetId,
          [MESSAGE_LOG_HEADERS.QUARTER]: String(row[CLASSES_HEADERS.QUARTER] ?? ""),
          [MESSAGE_LOG_HEADERS.CLASS_NAME]: classTitle,
          [MESSAGE_LOG_HEADERS.DAY]: String(row[CLASSES_HEADERS.DAY] ?? ""),
          
          [MESSAGE_LOG_HEADERS.ID]: String(student[CLASS_SHEET_HEADERS.ID] ?? ""),
          [MESSAGE_LOG_HEADERS.STUDENT_NAME]: String(student[CLASS_SHEET_HEADERS.STUDENT_NAME] ?? ""),
          [MESSAGE_LOG_HEADERS.PARENT_PHONE]: String(student[CLASS_SHEET_HEADERS.PARENT_PHONE] ?? ""),
          
          [MESSAGE_LOG_HEADERS.MESSAGE_STATUS]: "unsent", 
          [MESSAGE_LOG_HEADERS.CONTENT]: noticeText
        };
        return postSheetData(API_URLS.MESSAGE_LOG, SHEET_NAMES.MESSAGE_LOG, payload);
      });

      await Promise.all(promises);
      
      setNoticeText(""); 
      setNoticeMsg(`${targets.length}명에게 등록 완료! (상태: unsent)`);
      setTimeout(() => setNoticeMsg(""), 3000);

    } catch (error: any) {
      console.error(error);
      Alert.alert("오류", "전송 중 문제가 발생했습니다.");
    } finally {
      setSendingNotice(false);
    }
  };

  const handleOpenStudentSelection = async () => {
    const session = parseInt(sessionNum);
    if (!session || isNaN(session) || session < 1) {
      Alert.alert("입력 오류", "올바른 차시(숫자)를 입력해주세요.");
      return;
    }

    setSendingIndividual(true);
    setIndividualMsg("");

    try {
      const urls = await getClassUrls(targetId);
      if (!urls || !urls.sheetUrl) {
        Alert.alert("오류", "시트 주소를 찾을 수 없습니다.");
        setSendingIndividual(false);
        return;
      }

      const rawRows = await fetchClassSheetRaw(urls.sheetUrl);
      const targets = rawRows.filter(r => r[0] && r[0].trim() !== "");

      if (targets.length === 0) {
        Alert.alert("알림", "학생 데이터가 없습니다.");
        setSendingIndividual(false);
        return;
      }

      // 학생 데이터 매핑 (나중에 전송할 때 쓰기 위해 저장)
      const startIndex = CLASS_DATA_COL_SHIFT + (session - 1) * CLASS_SESSION_STRIDE;
      
      const parsedStudents = targets.map(studentRow => {
        const studentId = String(studentRow[0] || "");
        const studentName = String(studentRow[1] || "이름없음");
        const parentPhone = String(studentRow[3] || "");
        const attendance = studentRow[startIndex] || "-";
        const homework = studentRow[startIndex + 1] || "-";
        const test = studentRow[startIndex + 2] || "-";

        return {
          id: studentId,
          name: studentName,
          phone: parentPhone,
          attendance,
          homework,
          test,
        };
      }).filter(s => s.phone); // 전화번호 없는 학생 제외

      if (parsedStudents.length === 0) {
        Alert.alert("알림", "학부모 전화번호가 있는 학생이 없습니다.");
        setSendingIndividual(false);
        return;
      }

      // 데이터 저장 및 모달 열기
      setStudentList(parsedStudents);
      // 기본적으로 모두 선택
      const allIds = new Set(parsedStudents.map(s => s.id));
      setSelectedStudentIds(allIds);
      
      setSendingIndividual(false); // 로딩 끝
      setStudentSelectionModalVisible(true); // 모달 열기

    } catch (error) {
      console.error(error);
      showAlert("오류", "데이터를 불러오는 중 문제가 발생했습니다.");
      setSendingIndividual(false);
    }
  };

  // ✅ [추가] 2단계: 선택된 학생들에게 메시지 전송 (모달 확인 버튼)
  const confirmSendIndividual = async () => {
    if (selectedStudentIds.size === 0) {
      Alert.alert("알림", "선택된 학생이 없습니다.");
      return;
    }
    
    setStudentSelectionModalVisible(false); // 모달 닫기
    setSendingIndividual(true); // 로딩 다시 시작
    const session = parseInt(sessionNum); // 위에서 검증했으므로 안전

    try {
      const targets = studentList.filter(s => selectedStudentIds.has(s.id));
      
      const promises = targets.map((student) => {
        let content = template 
          .split("${STUDENT_NAME}").join(student.name)
          .split("${QUARTER}").join(String(row[CLASSES_HEADERS.QUARTER] ?? "")) 
          .split("${SESSION}").join(String(session))
          .split("${ATTENDANCE}").join(student.attendance)
          .split("${HOMEWORK}").join(student.homework)
          .split("${TEST}").join(student.test)
          .split("${CLASS_NAME}").join(classTitle) 
          .split("${DAY}").join(String(row[CLASSES_HEADERS.DAY] ?? ""));

        const payload = {
          [MESSAGE_LOG_HEADERS.CLASS_ID]: targetId,
          [MESSAGE_LOG_HEADERS.QUARTER]: String(row[CLASSES_HEADERS.QUARTER] ?? ""), 
          [MESSAGE_LOG_HEADERS.CLASS_NAME]: classTitle,
          [MESSAGE_LOG_HEADERS.DAY]: String(row[CLASSES_HEADERS.DAY] ?? ""),        
          [MESSAGE_LOG_HEADERS.ID]: student.id,
          [MESSAGE_LOG_HEADERS.STUDENT_NAME]: student.name,
          [MESSAGE_LOG_HEADERS.PARENT_PHONE]: student.phone,
          [MESSAGE_LOG_HEADERS.MESSAGE_STATUS]: "unsent",
          [MESSAGE_LOG_HEADERS.CONTENT]: content
        };

        return postSheetData(API_URLS.MESSAGE_LOG, SHEET_NAMES.MESSAGE_LOG, payload);
      });

      await Promise.all(promises);

      setIndividualMsg(`${session}차시 ${targets.length}명 추가 완료!`);
      setTimeout(() => setIndividualMsg(""), 3000); 
      setSessionNum(""); // 차시 초기화

    } catch (error) {
      console.error(error);
      showAlert("오류", "전송 중 문제가 발생했습니다.");
    } finally {
      setSendingIndividual(false); 
    }
  };

  const toggleStudentSelection = (id: string) => {
    const newSet = new Set(selectedStudentIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedStudentIds(newSet);
  };
  
  // 전체 선택/해제
  const toggleSelectAll = () => {
    if (selectedStudentIds.size === studentList.length) {
      setSelectedStudentIds(new Set()); // 전체 해제
    } else {
      setSelectedStudentIds(new Set(studentList.map(s => s.id))); // 전체 선택
    }
  };

  const handleDirectSms = async () => {
    // 1. 안드로이드 필수 권한 요청
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.SEND_SMS,
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE
        ]);
        const smsGranted = granted[PermissionsAndroid.PERMISSIONS.SEND_SMS] === PermissionsAndroid.RESULTS.GRANTED;
        if (!smsGranted) {
          showAlert("권한 거부", "문자 발송 권한이 거부되었습니다.");
          return;
        }
      } catch (err) {
        console.warn(err);
        return;
      }
    }

    // 2. 데이터 불러오기
    setSaving(true);
    try {
      const response = await fetch(`${API_URLS.MESSAGE_LOG}?sheet=${SHEET_NAMES.MESSAGE_LOG}`);
      const data = await response.json();
      
      if (data.error) {
        showAlert("오류", "시트 데이터를 가져오지 못했습니다.");
        return;
      }

      // 'unsent' 상태이고 현재 수업(classId)인 메시지 필터링
      const messages = data.filter((row: any) => {
        const isUnsent = row[MESSAGE_LOG_HEADERS.MESSAGE_STATUS] === "unsent";
        const isSameClass = String(row[MESSAGE_LOG_HEADERS.CLASS_ID]) === String(targetId);
        return isUnsent && isSameClass;
      });

      if (messages.length === 0) {
        showAlert("알림", "이 수업에 발송 대기 중인(unsent) 메시지가 없습니다.");
        return;
      }

      // 데이터 저장 및 검토 모달 열기
      setUnsentMessages(messages);
      setSmsReviewModalVisible(true);

    } catch (error: any) {
      console.error(error);
      showAlert("오류", "데이터 로드 중 문제가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const processDirectSms = async () => {
    setSmsReviewModalVisible(false); // 모달 닫기
    setSaving(true); // 로딩 표시 시작

    let sentCount = 0;
    let failCount = 0;
    let lastError = "";

    try {
      // 1. 문자 발송 루프
      for (const msg of unsentMessages) {
        const phone = msg[MESSAGE_LOG_HEADERS.PARENT_PHONE];
        const content = msg[MESSAGE_LOG_HEADERS.CONTENT];

        if (phone && content) {
          const cleanPhone = String(phone).replace(/-/g, "");
          try {
            await DirectSms.sendDirectSms(cleanPhone, content);
            sentCount++;
          } catch (e: any) {
            console.error("SMS 전송 실패:", phone, e);
            failCount++;
            lastError = e.message || String(e);
          }
        }
        // 스팸 방지 딜레이
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // 2. 시트 상태 업데이트 (sent)
      if (sentCount > 0) {
        const updatePayload = {
          sheetName: SHEET_NAMES.MESSAGE_LOG,
          action: "update_status",
          classId: targetId, 
        };
        
        const updateRes = await postSheetData(API_URLS.MESSAGE_LOG, SHEET_NAMES.MESSAGE_LOG, updatePayload);

        if (updateRes.ok) {
            let resultMsg = `${sentCount}건 발송 성공.`;
            if (failCount > 0) resultMsg += `\n(${failCount}건 실패)`;
            showAlert("완료", resultMsg);
        } else {
            showAlert("주의", "문자는 보냈으나, 시트 상태 변경(sent)에 실패했습니다.");
        }
      } else {
        showAlert("발송 실패", `전송 실패.\n오류: ${lastError}`);
      }

    } catch (error: any) {
      console.error(error);
      showAlert("오류", error.message || "알 수 없는 오류");
    } finally {
      setSaving(false);
      setUnsentMessages([]); // 목록 초기화
    }
  };

  const handleDeleteUnsentSms = () => {
    Alert.alert(
      "목록 삭제",
      "현재 대기 중인 모든 메시지를 삭제하시겠습니까?\n(삭제 후에는 복구할 수 없습니다.)",
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            try {
              const payload = {
                action: "delete_unsent_messages",
                classId: targetId,
              };

              const res = await postSheetData(API_URLS.MESSAGE_LOG, SHEET_NAMES.MESSAGE_LOG, payload);

              if (res.ok) {
                showAlert("삭제 완료", `${res.data?.count || unsentMessages.length}건의 메시지가 삭제되었습니다.`);
                setSmsReviewModalVisible(false); // 모달 닫기
                setUnsentMessages([]); // 목록 초기화
              } else {
                showAlert("삭제 실패", res.error || "삭제 중 문제가 발생했습니다.");
              }
            } catch (e) {
              console.error(e);
              showAlert("오류", "요청 중 오류가 발생했습니다.");
            } finally {
              setSaving(false);
            }
          }
        }
      ]
    );
  };

  // 실제 삭제를 수행하는 함수 (Web/App 공통)
  const processDelete = async () => {
    setSaving(true);
    try {
      if (isSupabaseDataSource) {
        const selected = scheduleRows.find(item => String(item[SCHEDULE_HEADERS.SESSION]) === String(scheduleSession));
        if (!selected?.__dbId) throw new Error("삭제할 차시를 찾을 수 없습니다.");
        await deleteSupabaseClassSession(targetId, String(selected.__dbId));
        const refreshed = await getSupabaseClassDetail(targetId);
        setRow(refreshed.row);
        setScheduleRows(refreshed.schedules);
        closeModal();
        showAlert("삭제 완료", "일정과 이 차시에 연결된 출석·숙제·시험·문자 기록을 삭제했습니다.");
        return;
      }

      const payload = {
        action: "delete_class_schedule",
        classId: targetId,
        session: scheduleSession, // 삭제할 차시 식별
      };

      const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.SCHEDULE, payload);

      if (res.ok) {
        showAlert("삭제 완료", "일정이 삭제되었습니다.");
        closeModal();
        // 화면 즉시 갱신 (목록에서 제거)
        setScheduleRows(prev => prev.filter(item => String(item[SCHEDULE_HEADERS.SESSION]) !== String(scheduleSession)));
      } else {
        showAlert("삭제 실패", res.error || "문제가 발생했습니다.");
      }
    } catch (e) {
      console.error(e);
      showAlert("오류", e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSchedule = () => {
    // 🌐 웹 환경: 브라우저 기본 confirm 창 사용
    if (Platform.OS === 'web') {
      const ok = window.confirm(isSupabaseDataSource
        ? `${scheduleSession}차시 일정과 연결된 출석·숙제·시험·문자 기록을 완전히 삭제하시겠습니까?`
        : `${scheduleSession}차시 일정을 정말 삭제하시겠습니까?`);
      if (ok) {
        processDelete();
      }
      return;
    }

    // 📱 앱 환경: React Native Alert 사용
    Alert.alert(
      "일정 삭제",
      isSupabaseDataSource
        ? `${scheduleSession}차시 일정과 연결된 출석·숙제·시험·문자 기록을 완전히 삭제하시겠습니까?`
        : `${scheduleSession}차시 일정을 정말 삭제하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive", // 빨간색 강조 (iOS)
          onPress: processDelete // 위에서 만든 함수 실행
        }
      ]
    );
  };

  const handleAddSchedule = async () => {
    if (!selectedDate) { showAlert("알림", "날짜를 선택해주세요."); return; }
    if (!isSupabaseDataSource && !scheduleSession) { showAlert("알림", "차시를 입력해주세요."); return; }

    const firstSession = Number(scheduleSession) || 1;
    if (!isSupabaseDataSource && (!Number.isInteger(firstSession) || firstSession < 1)) {
      showAlert("입력 확인", "차시는 1 이상의 숫자로 입력해주세요.");
      return;
    }

    const isBulkAdd = !isEditMode && scheduleMode === "repeat";
    if (isBulkAdd && repeatWeekdays.length === 0) {
      showAlert("입력 확인", "반복할 요일을 하나 이상 선택해주세요.");
      return;
    }
    if (isBulkAdd && (recurringDates.length === 0 || recurringDates.length > 60)) {
      showAlert("입력 확인", "반복 범위에서 1~60개 일정이 생성되도록 주 수나 종료일을 조정해 주세요.");
      return;
    }

    const dates = isBulkAdd ? recurringDates : [selectedDate];
    const generatedRows = dates.map((date, index) => ({
      classId: targetId,
      quarter: String(row[CLASSES_HEADERS.QUARTER] ?? ""),
      className: classTitle,
      day: String(row[CLASSES_HEADERS.DAY] ?? ""),
      session: String(firstSession + index),
      date,
      workers: scheduleWorkers,
      note: scheduleNote
    }));

    if (!isEditMode && !isSupabaseDataSource) {
      const existingSessions = new Set(scheduleRows.map(item => String(item[SCHEDULE_HEADERS.SESSION] ?? "").trim()));
      const conflicts = generatedRows.filter(item => existingSessions.has(item.session)).map(item => item.session);
      if (conflicts.length > 0) {
        showAlert("차시 중복", `${conflicts.join(", ")}차시는 이미 등록되어 있습니다.`);
        return;
      }
    }

    setSaving(true);
    try {
      if (isSupabaseDataSource) {
        let count = generatedRows.length;
        if (isEditMode) {
          const selected = scheduleRows.find(item => String(item[SCHEDULE_HEADERS.SESSION]) === String(scheduleSession));
          if (!selected?.__dbId) throw new Error("수정할 차시를 찾을 수 없습니다.");
          await updateSupabaseClassSession(
            targetId,
            String(selected.__dbId),
            selectedDate,
            scheduleNote,
            scheduleStaffIds,
          );
        } else {
          count = await addSupabaseClassSessions(targetId, generatedRows.map((item) => ({
            sessionDate: item.date,
            notes: item.note,
            staffIds: scheduleStaffIds,
          })));
        }
        const refreshed = await getSupabaseClassDetail(targetId);
        setRow(refreshed.row);
        setScheduleRows(refreshed.schedules);
        closeModal();
        showAlert("성공", isEditMode ? "일정을 수정했습니다." : count > 1 ? `${count}개의 일정을 등록했습니다.` : "새 일정을 등록했습니다.");
        return;
      }

      const payload = isBulkAdd ? {
        action: "add_class_schedules",
        schedules: generatedRows
      } : {
        action: isEditMode ? "update_class_schedule" : "add_class_schedule",
        ...generatedRows[0]
      };

      const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.SCHEDULE, payload);
      
      if (res.ok) {
        const msg = isEditMode
          ? "일정이 수정되었습니다."
          : isBulkAdd
            ? `${generatedRows.length}개의 일정이 등록되었습니다.`
            : "새 일정이 등록되었습니다.";
        showAlert("성공", msg);
        
        closeModal(); // 모달 닫기 및 초기화
        
        setScheduleRows(prevRows => {
          if (isEditMode) {
            // 1. 수정 모드: 기존 목록에서 해당 '차시'를 찾아서 내용만 갈아끼움
            return prevRows.map(item => {
              if (String(item[SCHEDULE_HEADERS.SESSION]) === String(scheduleSession)) {
                return {
                  ...item, // 기존 값 유지하면서
                  [SCHEDULE_HEADERS.DATE]: selectedDate,     // 날짜 변경
                  [SCHEDULE_HEADERS.WORKERS]: scheduleWorkers, // 근무자 변경
                  [SCHEDULE_HEADERS.NOTE]: scheduleNote      // 비고 변경
                };
              }
              return item;
            });
          } else {
            const newRows = generatedRows.map(item => ({
              [SCHEDULE_HEADERS.CLASS_ID]: item.classId,
              [SCHEDULE_HEADERS.QUARTER]: item.quarter,
              [SCHEDULE_HEADERS.CLASS_NAME]: item.className,
              [SCHEDULE_HEADERS.DAY]: item.day,
              [SCHEDULE_HEADERS.SESSION]: item.session,
              [SCHEDULE_HEADERS.DATE]: item.date,
              [SCHEDULE_HEADERS.WORKERS]: item.workers,
              [SCHEDULE_HEADERS.NOTE]: item.note
            }));
            const newList = [...prevRows, ...newRows];
            return newList.sort((a: any, b: any) => 
              (Number(a[SCHEDULE_HEADERS.SESSION]) || 0) - (Number(b[SCHEDULE_HEADERS.SESSION]) || 0)
            );
          }
        });
        
      } else {
        showAlert("실패", res.error || "요청 실패");
      }
    } catch (e) {
      console.error(e);
      showAlert("오류", e instanceof Error ? e.message : "일정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setScheduleModalVisible(false);
    setIsEditMode(false); // 수정 모드 끄기
    
    // 입력값 초기화
    setSelectedDate("");
    setScheduleSession("");
    setScheduleWorkers("");
    setScheduleStaffIds([]);
    setScheduleNote("");
    setScheduleMode("single");
    setRepeatLimit("weeks");
    setRepeatWeeks("8");
    setRepeatUntil("");
    setRepeatWeekdays([]);
  };

  const openAddScheduleModal = () => {
    const currentSessions = scheduleRows.map(item => Number(item[SCHEDULE_HEADERS.SESSION])).filter(Number.isFinite);
    const nextSession = currentSessions.length > 0 ? Math.max(...currentSessions) + 1 : 1;
    setIsEditMode(false);
    setScheduleMode("single");
    setSelectedDate("");
    setScheduleSession(String(nextSession));
    setScheduleWorkers(String(row[CLASSES_HEADERS.WORKERS] ?? ""));
    setScheduleStaffIds(Array.isArray(row.__staffIds) ? row.__staffIds : []);
    setScheduleNote("");
    setRepeatLimit("weeks");
    setRepeatWeeks("8");
    setRepeatUntil("");
    setRepeatWeekdays(isSupabaseDataSource && Array.isArray(row.__weekdaySchedule)
      ? row.__weekdaySchedule.map((entry: any) => Number(entry.weekday))
      : weekdaysFromText(String(row[CLASSES_HEADERS.DAY] ?? "")));
    setScheduleModalVisible(true);
  };

  const handlePressSchedule = (item: any) => {
    // 권한 체크: 관리자(Admin)나 매니저(Manager)만 수정 가능
    if (!isAdmin && !isManager) {
      showAlert("권한 없음", "일정을 수정할 권한이 없습니다.");
      return;
    }

    setIsEditMode(true); // 수정 모드 켜기
    setScheduleMode("single");

    // 선택된 일정 데이터로 입력창 채우기
    setSelectedDate(item[SCHEDULE_HEADERS.DATE]);
    setScheduleSession(String(item[SCHEDULE_HEADERS.SESSION])); // 숫자인 경우 문자열로 변환
    setScheduleWorkers(item[SCHEDULE_HEADERS.WORKERS] || "");
    setScheduleStaffIds(isSupabaseDataSource && Array.isArray(item.__staffIds) ? item.__staffIds : []);
    setScheduleNote(item[SCHEDULE_HEADERS.NOTE] || "");
    
    setScheduleModalVisible(true); // 모달 열기
  };

  if (!navReady || !userEmail) return null;
  if (loading) return <View style={[styles.container, { justifyContent: "center" }]}><ActivityIndicator /></View>;
  if (loadError) return (
    <View style={[styles.container, { justifyContent: "center", paddingHorizontal: 24 }]}>
      <Text style={{ color: '#991B1B', textAlign: 'center', marginBottom: 16 }}>{loadError}</Text>
      <Pressable onPress={() => router.replace("/(tabs)/class")} style={styles.backBtn}>
        <Text style={styles.backText}>← 수업 목록</Text>
      </Pressable>
    </View>
  );
  if (!row) return <View style={styles.container}><Text>수업 정보를 찾을 수 없습니다.</Text></View>;

  const fabDisabled = saving;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace("/(tabs)/class")} style={styles.backBtn}>
            <Text style={styles.backText}>← 수업 목록</Text>
          </Pressable>
        </View>

        <Text style={styles.title}>{isSupabaseDataSource && row.__classLabel
          ? String(row.__classLabel)
          : `${classTitle} ${String(row[CLASSES_HEADERS.DAY] ?? "")}`}</Text>
        <Text style={styles.meta}>{row.__classKind === 'clinic' ? '클리닉' : String(row[CLASSES_HEADERS.SCHOOL] ?? "")} · {String(row[CLASSES_HEADERS.QUARTER] ?? "")}</Text>

        {isSupabaseDataSource && (
          <View style={styles.sourceBanner}>
            <Text style={styles.sourceBannerTitle}>수업 기록 안내</Text>
            <Text style={styles.sourceBannerText}>{row.__classKind === 'clinic'
              ? '각 차시에서 같은 분기의 학생을 참여자로 추가하고 출석·숙제·시험을 기록할 수 있습니다.'
              : '학생 정보는 이 수업 화면에서 관리합니다. 차시를 누르면 기존 기록을 확인하고 표 형태로 한 번에 입력할 수 있습니다.'}</Text>
          </View>
        )}

        <View style={styles.infoRow}>
            <View style={styles.infoItem}>
                <Text style={styles.label}>장소</Text>
                <Text style={styles.value}>{String(row[CLASSES_HEADERS.PLACE] ?? "-")}</Text>
            </View>
            <View style={styles.infoItem}>
                <Text style={styles.label}>시간</Text>
                <Text style={styles.value}>{isSupabaseDataSource && Array.isArray(row.__weekdaySchedule)
                  ? row.__weekdaySchedule.slice().sort((a: any, b: any) => Number(a.weekday) - Number(b.weekday)).map((entry: any) => `${WEEKDAY_OPTIONS.find((day) => day.value === Number(entry.weekday))?.label ?? ''} ${entry.day_part} ${entry.start_time && entry.end_time ? `${String(entry.start_time).slice(0, 5)}~${String(entry.end_time).slice(0, 5)}` : '시간 미정'}`).join(' · ')
                  : `${String(row[CLASSES_HEADERS.CLASS_START] ?? "")} ~ ${String(row[CLASSES_HEADERS.CLASS_END] ?? "")}`}</Text>
            </View>
        </View>

        <View style={[styles.infoRow, { marginTop: -10 }]}> 
            <View style={styles.infoItem}>
                <Text style={styles.label}>근무자</Text>
                <Text style={styles.value}>{String(row[CLASSES_HEADERS.WORKERS] ?? "-")}</Text>
            </View>
        </View>

        {isSupabaseDataSource && row.__classKind !== 'clinic' && (
          <ClassStudentManager
            classId={targetId}
            defaultJoinedOn={String(scheduleRows[0]?.[SCHEDULE_HEADERS.DATE] ?? todayYmd())}
            termLabel={String(row[CLASSES_HEADERS.QUARTER] ?? '')}
            school={String(row[CLASSES_HEADERS.SCHOOL] ?? '')}
          />
        )}

        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>수업 일정</Text>
            
            {(isAdmin || isManager) && (
              <Pressable onPress={openAddScheduleModal} hitSlop={10}>
                <Text style={{ color: '#4F46E5', fontWeight: '700', fontSize: 14 }}>+ 일정 추가</Text>
              </Pressable>
            )}
          </View>
          
          {scheduleRows.length === 0 ? (
            <Text style={styles.desc}>등록된 일정이 없습니다.</Text>
          ) : (
            <>
              <View style={styles.scrollContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {scheduleRows.map((item, idx) => {
                    const today = todayYmd();
                    const rowDate = String(item[SCHEDULE_HEADERS.DATE] ?? "");
                    
                    const firstFutureIndex = scheduleRows.findIndex(r => String(r[SCHEDULE_HEADERS.DATE]) >= today);
                    
                    let status = 'future';
                    if (rowDate < today) status = 'past';
                    else if (idx === firstFutureIndex) status = 'next';
                    else status = 'future';

                    let boxStyle = styles.boxFuture;
                    let textStyle = styles.textFuture;
                    
                    if (status === 'past') {
                      boxStyle = styles.boxPast;
                      textStyle = styles.textPast;
                    } else if (status === 'next') {
                      boxStyle = styles.boxNext;
                      textStyle = styles.textNext;
                    }

                    const dateParts = rowDate.split('-');
                    const shortDate = dateParts.length === 3 ? `${Number(dateParts[1])}/${Number(dateParts[2])}` : rowDate;

                    return (
                      <Pressable 
                        key={String(item.__dbId ?? idx)}
                        style={[styles.scheduleBox, boxStyle]}
                        onPress={isSupabaseDataSource
                          ? () => router.push({ pathname: "/session/[id]", params: { id: String(item.__dbId), classId: targetId, title: String(row.__classLabel || classTitle), termLabel: String(row[CLASSES_HEADERS.QUARTER] ?? ''), day: String(row[CLASSES_HEADERS.DAY] ?? '') } })
                          : () => handlePressSchedule(item)}
                      >
                        <Text style={[styles.boxSessionText, textStyle]}>
                          {item[SCHEDULE_HEADERS.SESSION]}차시
                        </Text>
                        <Text style={[styles.boxDateText, textStyle]}>
                          {shortDate}
                        </Text>
                        
                        {!!item[SCHEDULE_HEADERS.WORKERS] && (
                          <Text style={[styles.boxDetailText, textStyle, { fontWeight: '600' }]} numberOfLines={1}>
                            {item[SCHEDULE_HEADERS.WORKERS]}
                          </Text>
                        )}
                        
                        {!!item[SCHEDULE_HEADERS.NOTE] && (
                          <Text style={[styles.boxDetailText, textStyle, { fontSize: 10, marginTop: 2, opacity: 0.9 }]} numberOfLines={1}>
                            {item[SCHEDULE_HEADERS.NOTE]}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                  {(isAdmin || isManager) && isSupabaseDataSource && (
                    <Pressable style={[styles.scheduleBox, styles.addScheduleBox]} onPress={openAddScheduleModal}>
                      <Ionicons name="add-circle-outline" size={24} color="#4F46E5" />
                      <Text style={styles.addScheduleText}>차시 추가</Text>
                    </Pressable>
                  )}
                </ScrollView>
              </View>

              <View style={styles.table}>
                <View style={styles.trHead}>
                  <Text style={[styles.th, { flex: 0.6 }]}>차시</Text>
                  <Text style={[styles.th, { flex: 1.6 }]}>날짜</Text>
                  <Text style={[styles.th, { flex: 1.2 }]}>근무자</Text>
                  <Text style={[styles.th, { flex: 2 }]}>비고</Text>
                  {(isAdmin || isManager) && <Text style={[styles.th, { flex: 0.8 }]}>관리</Text>}
                </View>
                {scheduleRows.map((item, idx) => (
                  <View key={String(item.__dbId ?? idx)} style={styles.tr}>
                    <Text style={[styles.td, { flex: 0.6 }]}>{String(item[SCHEDULE_HEADERS.SESSION] ?? "")}</Text>
                    <Text style={[styles.td, { flex: 1.6 }]}>{String(item[SCHEDULE_HEADERS.DATE] ?? "")}</Text>
                    <Text style={[styles.td, { flex: 1.2 }]}>{String(item[SCHEDULE_HEADERS.WORKERS] ?? "")}</Text>
                    <Text style={[styles.td, { flex: 2 }]}>{String(item[SCHEDULE_HEADERS.NOTE] ?? "")}</Text>
                    {(isAdmin || isManager) && (
                      <View style={[styles.tdAction, { flex: 0.8 }]}>
                        <Pressable style={styles.scheduleEditButton} onPress={() => handlePressSchedule(item)}>
                          <Text style={styles.scheduleEditButtonText}>수정/삭제</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        {isSupabaseDataSource && <SupabaseClassWorkPanel classId={targetId}
          classLabel={String(row.__classLabel || classTitle)}
          defaultHourlyRateKrw={String(row[CLASSES_HEADERS.HOURLY_WAGE] ?? '')} />}
        {isSupabaseDataSource && <SupabaseClassMessagingPanel
          classId={targetId}
          canManage={isAdmin || isManager}
          onDraftChange={setMessageDraftDirty}
        />}
        {!isSupabaseDataSource && <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>출근 관리</Text>
            <Text style={styles.desc}>위치 확인 없이 출근/퇴근 시간만 기록합니다.</Text>
            <Text style={styles.msg}>{message}</Text>
            {checkedIn && checkInTime && <Text style={styles.debug}>출근시간: {checkInTime}</Text>}
          </View>

          <View style={styles.card}>
          <Text style={styles.cardTitle}>공지 메시지 추가</Text>
          <Text style={styles.desc}>이 수업의 모든 학생에게 공지를 등록합니다.</Text>
          <TextInput 
            style={styles.input} 
            placeholder="공지 내용을 입력하세요" 
            placeholderTextColor="#9CA3AF"
            multiline 
            numberOfLines={3} 
            value={noticeText} 
            onChangeText={setNoticeText} 
          />
          
          {sendingNotice ? (
            <ActivityIndicator style={{marginTop: 10}} />
          ) : (
            <Pressable style={({ pressed }) => [styles.btnRed, pressed && { opacity: 0.8 }]} onPress={handleSendNotice}>
              <Text style={styles.btnText}>공지 메시지 추가</Text>
            </Pressable>
          )}

          {!!noticeMsg && (
            <Text style={{ color: '#059669', fontWeight: '700', textAlign: 'center', marginTop: 12 }}>
              {noticeMsg}
            </Text>
          )}
          </View>

          <View style={styles.card}>
          <Text style={styles.cardTitle}>개별 메시지 추가</Text>
          <Text style={styles.desc}>차시에 맞는 출석/숙제/시험 점수를 불러와 발송합니다.</Text>
          
          {/* 1. 차시 입력 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
            <TextInput 
              style={[styles.input, { flex: 1, minHeight: 40, marginBottom: 0, marginRight: 10 }]} 
              placeholder="차시 (예: 1)" 
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              value={sessionNum}
              onChangeText={setSessionNum}
            />
            <Text style={{ fontWeight: '600', color: '#4B5563' }}>차시</Text>
          </View>

          {/* 2. 템플릿 입력 */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
             <Text style={{ fontWeight: '600', color: '#4B5563' }}>메시지 템플릿</Text>
             {/* 도움말 버튼 */}
             <Pressable onPress={showTemplateGuide} style={{ padding: 4, flexDirection: 'row', alignItems: 'center' }}>
               <Text style={{ fontSize: 16 }}>❓</Text>
               <Text style={{ fontSize: 12, color: '#4F46E5', fontWeight: 'bold', marginLeft: 2 }}>작성법</Text>
             </Pressable>
          </View>
          
          <TextInput 
            style={[styles.input, { minHeight: 120, fontSize: 13 }]} 
            placeholder="메시지 내용을 입력하세요" 
            multiline 
            textAlignVertical="top"
            value={template} // 여기에 기본값이 들어감
            onChangeText={setTemplate} 
          />

          {sendingIndividual ? (
             <ActivityIndicator style={{marginTop: 10}} color="#10B981" />
          ) : (
            <Pressable style={({ pressed }) => [styles.btnGreen, pressed && { opacity: 0.8 }]} onPress={handleOpenStudentSelection}>
              <Text style={styles.btnText}>메시지 대상 선택</Text>
            </Pressable>
          )}

          {!!individualMsg && <Text style={{ color: '#059669', fontWeight: '700', textAlign: 'center', marginTop: 12 }}>{individualMsg}</Text>}
          </View>

          {isAdminDevice && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>문자 발송</Text>
              <Text style={styles.desc}>해당 수업의 구글 시트에 등록된 문자(unsent)를 보냅니다.</Text>
              <Pressable style={({ pressed }) => [styles.btnBlue, pressed && { opacity: 0.8 }]} onPress={handleDirectSms}>
                <Text style={styles.btnText}>[문자 발송]</Text>
              </Pressable>
            </View>
          )}
        </>}
      </ScrollView>

      <Modal visible={studentSelectionModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalView, { width: '90%', maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>메시지 전송 대상 선택</Text>
            <Text style={[styles.desc, {textAlign: 'center'}]}>
              {sessionNum}차시 데이터 기준 ({selectedStudentIds.size}/{studentList.length}명)
            </Text>

            <TouchableOpacity onPress={toggleSelectAll} style={{ padding: 8, marginBottom: 5 }}>
              <Text style={{ color: '#4F46E5', fontWeight: '700' }}>
                {selectedStudentIds.size === studentList.length ? "전체 해제" : "전체 선택"}
              </Text>
            </TouchableOpacity>

            <View style={{ width: '100%', height: '55%', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#eee' }}>
              <ScrollView>
                {studentList.map(student => {
                  const isSelected = selectedStudentIds.has(student.id);
                  return (
                    <TouchableOpacity 
                      key={student.id} 
                      style={[styles.studentRow, isSelected && styles.studentRowSelected]} 
                      onPress={() => toggleStudentSelection(student.id)}
                    >
                      <Ionicons 
                        name={isSelected ? "checkbox" : "square-outline"} 
                        size={22} 
                        color={isSelected ? "#4F46E5" : "#ccc"} 
                        style={{ marginRight: 12 }}
                      />
                      <View>
                        <Text style={[styles.studentName, isSelected && { color: '#4F46E5' }]}>{student.name}</Text>
                        <Text style={styles.studentInfo}>출석: {student.attendance} | 과제: {student.homework} | 시험: {student.test}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View style={[styles.modalBtnRow, { marginTop: 15 }]}>
              <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setStudentSelectionModalVisible(false)}>
                <Text style={styles.modalBtnTextCancel}>취소</Text>
              </Pressable>
              
              <Pressable style={[styles.modalBtn, styles.modalBtnConfirm]} onPress={confirmSendIndividual}>
                <Text style={styles.modalBtnTextConfirm}>메시지 추가 ({selectedStudentIds.size}명)</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={scheduleModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalView, { width: '90%', maxHeight: '85%' }]}>
            <Text style={styles.modalTitle}>{isEditMode ? "일정 수정" : "새 일정 등록"}</Text>
            
            <ScrollView style={{ width: '100%' }} contentContainerStyle={{ paddingBottom: 20 }}>
              {!isEditMode && (
                <View style={styles.scheduleModeControl}>
                  <Pressable
                    style={[styles.scheduleModeOption, scheduleMode === 'single' && styles.scheduleModeOptionActive]}
                    onPress={() => setScheduleMode('single')}
                  >
                    <Text style={[styles.scheduleModeText, scheduleMode === 'single' && styles.scheduleModeTextActive]}>한 번 등록</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.scheduleModeOption, scheduleMode === 'repeat' && styles.scheduleModeOptionActive]}
                    onPress={() => setScheduleMode('repeat')}
                  >
                    <Text style={[styles.scheduleModeText, scheduleMode === 'repeat' && styles.scheduleModeTextActive]}>반복 등록</Text>
                  </Pressable>
                </View>
              )}

              <Text style={styles.label}>{scheduleMode === 'repeat' && !isEditMode ? '시작 기준일' : '날짜'}: <Text style={{color:'#4F46E5', fontWeight:'bold'}}>{selectedDate || "(달력에서 선택)"}</Text></Text>
              <Calendar
                onDayPress={(day: any) => setSelectedDate(day.dateString)}
                markedDates={scheduleMarkedDates}
                theme={{ selectedDayBackgroundColor: '#4F46E5', todayTextColor: '#4F46E5', arrowColor: '#4F46E5' }}
                style={{ borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 15 }}
              />

              {scheduleMode === 'repeat' && !isEditMode && (
                <View style={styles.repeatPanel}>
                  <Text style={styles.label}>반복 요일</Text>
                  <View style={styles.weekdayRow}>
                    {WEEKDAY_OPTIONS.map(option => {
                      const selected = repeatWeekdays.includes(option.value);
                      return (
                        <Pressable
                          key={option.value}
                          style={[styles.weekdayOption, selected && styles.weekdayOptionActive]}
                          onPress={() => setRepeatWeekdays(current => selected
                            ? current.filter(day => day !== option.value)
                            : [...current, option.value])}
                        >
                          <Text style={[styles.weekdayText, selected && styles.weekdayTextActive]}>{option.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.label}>반복 범위</Text>
                  <View style={styles.scheduleModeControl}>
                    <Pressable style={[styles.scheduleModeOption, repeatLimit === 'weeks' && styles.scheduleModeOptionActive]} onPress={() => setRepeatLimit('weeks')}>
                      <Text style={[styles.scheduleModeText, repeatLimit === 'weeks' && styles.scheduleModeTextActive]}>몇 주 동안</Text>
                    </Pressable>
                    <Pressable style={[styles.scheduleModeOption, repeatLimit === 'until' && styles.scheduleModeOptionActive]} onPress={() => setRepeatLimit('until')}>
                      <Text style={[styles.scheduleModeText, repeatLimit === 'until' && styles.scheduleModeTextActive]}>종료일까지</Text>
                    </Pressable>
                  </View>
                  {repeatLimit === 'weeks'
                    ? <TextInput style={styles.modalInput} value={repeatWeeks} onChangeText={setRepeatWeeks}
                        placeholder="예: 8주" placeholderTextColor="#9CA3AF" keyboardType="number-pad" maxLength={2} />
                    : <TextInput style={styles.modalInput} value={repeatUntil} onChangeText={setRepeatUntil}
                        placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />}
                  <Text style={styles.repeatPreviewDates}>시작 기준일 포함 · 최대 60개 일정</Text>

                  {recurringDates.length > 0 && (
                    <View style={styles.repeatPreview}>
                      <Text style={styles.repeatPreviewTitle}>총 {recurringDates.length}회{isSupabaseDataSource ? ' · 날짜순 차시 자동 지정' : ` · ${scheduleSession || '?'}차시부터`}</Text>
                      <Text style={styles.repeatPreviewDates}>
                        {recurringDates.slice(0, 6).join(' · ')}{recurringDates.length > 6 ? ` 외 ${recurringDates.length - 6}회` : ''}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {isSupabaseDataSource && <Text style={styles.repeatPreviewDates}>
                차시는 날짜 오름차순으로 자동 정렬됩니다. 날짜를 수정하거나 일정을 삭제해도 다시 매겨집니다.
              </Text>}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                {!isSupabaseDataSource && <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{scheduleMode === 'repeat' && !isEditMode ? '시작 차시' : '차시'}</Text>
                  <TextInput style={[styles.modalInput, isEditMode && { backgroundColor: '#E5E7EB', color: '#6B7280' }]}
                    placeholder="예: 1" placeholderTextColor="#9CA3AF" keyboardType="number-pad"
                    value={scheduleSession} onChangeText={setScheduleSession} editable={!isEditMode} />
                </View>}
                <View style={{ flex: 1.5 }}>
                  <Text style={styles.label}>예정 근무자</Text>
                  {isSupabaseDataSource ? (
                    <View style={styles.staffPicker}>
                      {assignableStaff.length === 0 ? (
                        <Text style={styles.staffPickerEmpty}>등록된 근무자가 없습니다.</Text>
                      ) : assignableStaff.map((staff) => {
                        const selected = scheduleStaffIds.includes(staff.id);
                        return (
                          <Pressable
                            key={staff.id}
                            style={[styles.staffChip, selected && styles.staffChipSelected]}
                            onPress={() => setScheduleStaffIds((current) => selected
                              ? current.filter((id) => id !== staff.id)
                              : [...current, staff.id])}
                          >
                            <Ionicons name={selected ? "checkbox" : "square-outline"} size={17} color={selected ? "#4F46E5" : "#6B7280"} />
                            <Text style={[styles.staffChipText, selected && styles.staffChipTextSelected]}>{staff.fullName}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <TextInput
                      style={[styles.modalInput, !scheduleWorkers && { fontStyle: 'italic' }]}
                      placeholder="이름 입력"
                      placeholderTextColor="#9CA3AF"
                      value={scheduleWorkers}
                      onChangeText={setScheduleWorkers}
                    />
                  )}
                </View>
              </View>

              <View style={{ marginBottom: 10 }}>
                <Text style={styles.label}>비고</Text>
                <TextInput 
                  style={[styles.modalInput, !scheduleNote && { fontStyle: 'italic' }]}
                  placeholder="예: 정기 수업, 보강 등"
                  placeholderTextColor="#9CA3AF"
                  value={scheduleNote}
                  onChangeText={setScheduleNote}
                />
              </View>

              <Text style={{ fontSize: 12, color: '#666', marginTop: 5 }}>
                • 수업: {classTitle} {isEditMode && "(차시는 수정할 수 없습니다)"}
              </Text>
            </ScrollView>

            {/* 버튼 영역 */}
            <View style={{ width: '100%', gap: 10 }}>
              {/* 상단: 취소 / 확인 */}
              <View style={styles.modalBtnRow}>
                <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={closeModal}>
                  <Text style={styles.modalBtnTextCancel}>취소</Text>
                </Pressable>
                
                <Pressable disabled={saving} style={[styles.modalBtn, styles.modalBtnConfirm, saving && { opacity: 0.6 }]} onPress={handleAddSchedule}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.modalBtnTextConfirm}>{isEditMode ? "수정완료" : scheduleMode === 'repeat' ? `${recurringDates.length || 0}개 등록` : "등록"}</Text>}
                </Pressable>
              </View>

              {isEditMode && (
                <Pressable 
                  style={[styles.modalBtn, { backgroundColor: '#FEE2E2', marginTop: 5 }]} 
                  onPress={handleDeleteSchedule}
                >
                  <Text style={{ color: '#EF4444', fontWeight: '700' }}>이 일정 삭제하기</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={smsReviewModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalView, { width: '90%', height: '70%' }]}>
            <Text style={styles.modalTitle}>문자 발송 대기 목록</Text>
            <Text style={[styles.desc, {textAlign: 'center'}]}>
              총 {unsentMessages.length}건의 메시지가 대기 중입니다.
            </Text>

            <View style={{ flex: 1, width: '100%', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#eee', marginBottom: 15 }}>
              <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
                {unsentMessages.map((msg, idx) => (
                  <View key={idx} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#f3f3f3' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ fontWeight: 'bold', color: '#333' }}>
                        {msg[MESSAGE_LOG_HEADERS.STUDENT_NAME] || "이름없음"}
                      </Text>
                      <Text style={{ color: '#666', fontSize: 12 }}>
                        {msg[MESSAGE_LOG_HEADERS.PARENT_PHONE]}
                      </Text>
                    </View>
                    <Text style={{ color: '#444', fontSize: 13, lineHeight: 18 }}>
                      {msg[MESSAGE_LOG_HEADERS.CONTENT]}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            <View style={styles.modalBtnRow}>
              <Pressable 
                style={[styles.modalBtn, styles.modalBtnCancel]} 
                onPress={() => setSmsReviewModalVisible(false)}
              >
                <Text style={styles.modalBtnTextCancel}>취소</Text>
              </Pressable>

              <Pressable 
                style={[styles.modalBtn, { backgroundColor: '#FEE2E2', marginHorizontal: 8 }]} 
                onPress={handleDeleteUnsentSms}
              >
                <Text style={{ color: '#EF4444', fontWeight: '700' }}>전체 삭제</Text>
              </Pressable>
              
              <Pressable 
                style={[styles.modalBtn, { backgroundColor: '#3B82F6' }]} // 파란색
                onPress={processDirectSms}
              >
                <Text style={styles.modalBtnTextConfirm}>전송 시작 ({unsentMessages.length}건)</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {!isSupabaseDataSource && (
        <Pressable disabled={fabDisabled} onPress={checkedIn ? handleCheckOut : handleCheckIn} style={[styles.fab, fabDisabled ? { opacity: 0.5 } : checkedIn ? { backgroundColor: "#4B5563" } : { backgroundColor: "#4F46E5" }]}>
          <Text style={styles.fabText}>{checkedIn ? "퇴근" : "출근"}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function ClassDetailRoute() {
  return (
    <AppAccessGate>
      <ClassDetailScreen />
    </AppAccessGate>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: "#F6F7FB", paddingBottom: 100 },
  header: { marginBottom: 12 },
  backBtn: { padding: 5, marginLeft: -5 },
  backText: { fontSize: 14, color: "#4F46E5", fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "800", color: "#111", marginBottom: 4 },
  meta: { fontSize: 14, color: "#666", marginBottom: 20 },
  sourceBanner: { width: '100%', backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  sourceBannerTitle: { color: '#3730A3', fontWeight: '800', marginBottom: 3 },
  sourceBannerText: { color: '#4F46E5', fontSize: 12, lineHeight: 18 },
  infoRow: { flexDirection: 'row', gap: 15, marginBottom: 20 },
  infoItem: { backgroundColor: '#fff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', flex: 1 },
  label: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 4 },
  value: { fontSize: 15, fontWeight: "600", color: "#111827" },
  
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#E5E7EB", elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 6, color: "#1F2937" },
  addScheduleBox: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderColor: '#A5B4FC', backgroundColor: '#EEF2FF' },
  addScheduleText: { marginTop: 5, color: '#4F46E5', fontSize: 12, fontWeight: '800' },
  desc: { fontSize: 13, color: "#6B7280", marginBottom: 10, lineHeight: 18 },
  msg: { fontSize: 14, color: "#111827", fontWeight: "600", marginTop: 4 },
  debug: { fontSize: 12, color: "#059669", marginTop: 6, fontWeight: "600" },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, minHeight: 80, textAlignVertical: "top", marginBottom: 12, fontSize: 14 },
  
  btnRed: { backgroundColor: "#EF4444", padding: 14, borderRadius: 8, alignItems: "center" },
  btnGreen: { backgroundColor: "#10B981", padding: 14, borderRadius: 8, alignItems: "center" },
  btnBlue: { backgroundColor: "#3B82F6", padding: 14, borderRadius: 8, alignItems: "center" }, 
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  
  fab: { position: "absolute", right: 20, bottom: 30, width: 64, height: 64, borderRadius: 32, justifyContent: "center", alignItems: "center", elevation: 6 },
  fabText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  modalView: { backgroundColor: "white", borderRadius: 12, padding: 20, alignItems: "center", shadowColor: "#000", elevation: 5 },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 15, color: "#1F2937" },
  modalInput: { height: 46, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingHorizontal: 12, fontSize: 14, backgroundColor: "#F9FAFB", marginBottom: 0 },
  staffPicker: { minHeight: 46, flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 6, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, backgroundColor: '#F9FAFB' },
  staffPickerEmpty: { padding: 7, color: '#9CA3AF', fontSize: 13 },
  staffChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  staffChipSelected: { borderColor: '#A5B4FC', backgroundColor: '#EEF2FF' },
  staffChipText: { color: '#4B5563', fontSize: 12, fontWeight: '700' },
  staffChipTextSelected: { color: '#4338CA' },
  scheduleModeControl: { width: '100%', flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 8, padding: 3, marginBottom: 16 },
  scheduleModeOption: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  scheduleModeOptionActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB' },
  scheduleModeText: { color: '#6B7280', fontSize: 13, fontWeight: '700' },
  scheduleModeTextActive: { color: '#111827' },
  repeatPanel: { width: '100%', backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 12, marginBottom: 14 },
  weekdayRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4, marginBottom: 14 },
  weekdayOption: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  weekdayOptionActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  weekdayText: { color: '#4B5563', fontSize: 12, fontWeight: '700' },
  weekdayTextActive: { color: '#FFFFFF' },
  repeatPreview: { marginTop: 12, borderLeftWidth: 3, borderLeftColor: '#10B981', paddingLeft: 10 },
  repeatPreviewTitle: { color: '#065F46', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  repeatPreviewDates: { color: '#4B5563', fontSize: 12, lineHeight: 18 },
  modalBtnRow: { flexDirection: "row", gap: 10, width: "100%", marginTop: 10 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  modalBtnCancel: { backgroundColor: "#E5E7EB" },
  modalBtnConfirm: { backgroundColor: "#4F46E5" },
  modalBtnTextCancel: { color: "#374151", fontWeight: "700" },
  modalBtnTextConfirm: { color: "white", fontWeight: "700" },

  table: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, overflow: 'hidden', marginTop: 8 },
  trHead: { flexDirection: 'row', backgroundColor: '#f9f9f9', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingVertical: 12, alignItems: 'center' },
  th: { fontSize: 12, fontWeight: '700', color: '#555', textAlign: 'center' },
  td: { fontSize: 12, color: '#333', textAlign: 'center' },

  scrollContainer: { marginBottom: 15 },
  scheduleEditButton: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7, backgroundColor: '#EEF2FF' },
  scheduleEditButtonText: { color: '#4338CA', fontSize: 11, fontWeight: '800' },
  tdAction: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5, borderRightWidth: 1, borderRightColor: '#E5E7EB' },
  scheduleBox: { width: 200, height: 100, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 8, borderWidth: 1, padding: 6},

  boxPast: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },     // 지난 수업 (회색)
  boxNext: { backgroundColor: '#4F46E5', borderColor: '#4F46E5', elevation: 4, shadowColor: "#4F46E5", shadowOpacity: 0.3, shadowRadius: 4 }, // 다가오는 수업 (강조색)
  boxFuture: { backgroundColor: '#FFFFFF', borderColor: '#D1D5DB' },    // 남은 수업 (흰색)

  boxSessionText: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  boxDateText: { fontSize: 12, fontWeight: '500', marginBottom: 6 },
  
  textPast: { color: '#9CA3AF' },
  textNext: { color: '#FFFFFF' },
  textFuture: { color: '#374151' },

  boxDetailText: { fontSize: 11, textAlign: 'center' },
  studentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f3f3' },
  studentRowSelected: { backgroundColor: '#F5F3FF' },
  studentName: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 2 },
  studentInfo: { fontSize: 12, color: '#666' },
});
