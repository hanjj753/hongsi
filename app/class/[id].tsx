// app/class/[id].tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput, Platform, PermissionsAndroid, Modal, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter, useRootNavigationState } from "expo-router";
import * as Location from "expo-location";
import * as Application from "expo-application";
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { Ionicons } from "@expo/vector-icons";

// Utils & Config
import { fetchSheetData, fetchClassSheet, fetchClassSheetRaw } from "../../utils/googleSheet_csv";
import { postSheetData } from "../../utils/sheetApi";
import { getActiveSession, startSession, clearSession, ActiveSession } from "../../utils/activeSession";
import { getCurrentUserEmail } from "../../utils/currentUser";
import DirectSms from "../../utils/smsSender";
import { getClassUrls } from "../../utils/classInfo";

// PERMISSION_HEADERS 추가
import { CSV_URLS, API_URLS, CLASSES_HEADERS, POSITIONS_HEADERS, ATTENDANCE_LOG_HEADERS, MESSAGE_LOG_HEADERS, 
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

// Constants
const WARN_RADIUS_METERS = 30; 
const ACCEPT_RADIUS_METERS = 100;

// ... (Helpers 함수들은 그대로 유지) ...
const hmToMinutes = (hm: string) => {
  const m = String(hm || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const minutesToHm = (mins: number) => {
  const m = Math.max(0, Math.floor(mins));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
const nowHm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const formatCoord5 = (n: number) => (Math.round(n * 1e5) / 1e5).toFixed(5);
const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin((toRad(lon2 - lon1)) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export default function ClassDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rootNavState = useRootNavigationState();
  const navReady = !!rootNavState?.key;
  const targetId = String(Array.isArray(params.id) ? params.id[0] : params.id ?? "").trim();
  const userEmail = getCurrentUserEmail();

  useEffect(() => { if (navReady && !userEmail) router.replace("/(tabs)"); }, [navReady, userEmail, router]);
  if (!navReady || !userEmail) return null;

  // --- State ---
  const [actionLockUntil, setActionLockUntil] = useState<number>(0);
  const [row, setRow] = useState<any>(null);
  const [posMap, setPosMap] = useState<Map<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [checkingGps, setCheckingGps] = useState(false);
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

  const [template, setTemplate] = useState(INDIVIDUAL_MESSAGE_TEMPLATE);
  const [isAdmin, setIsAdmin] = useState(false);       // 이메일이 Admin인 경우
  const [isManager, setIsManager] = useState(false);    // 이메일이 Manager인 경우
  const [isAdminDevice, setIsAdminDevice] = useState(false); // Admin이면서 + 기기 ID까지 일치하는 경우

  const [isEditMode, setIsEditMode] = useState(false);

  const [studentSelectionModalVisible, setStudentSelectionModalVisible] = useState(false);
  const [studentList, setStudentList] = useState<any[]>([]); // 불러온 학생 데이터 저장
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

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
  }, [userEmail]);
  
  // 1. 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        const [cData, pData, aData, sData] = await Promise.all([
          fetchSheetData(CSV_URLS.CLASSES), 
          fetchSheetData(CSV_URLS.POSITIONS),
          fetchSheetData(CSV_URLS.ASSISTANT_INFO),
          fetchSheetData(CSV_URLS.CLASS_SCHEDULES)
        ]);

        setRow((cData || []).find((r: any) => String(r[CLASSES_HEADERS.CLASS_ID] ?? "").trim() === targetId) || null);
        
        const map = new Map<string, string>();
        (pData || []).forEach((r: any) => {
          const key = String(r[POSITIONS_HEADERS.PLACE] ?? "").trim();
          const val = String(r[POSITIONS_HEADERS.PLACE_LOCATION] ?? "").trim();
          if (key && val) map.set(key, val);
        });
        setPosMap(map);

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

      } finally { setLoading(false); }
    })();
  }, [targetId]);

  useEffect(() => {
    if (row) {
      setScheduleWorkers(String(row[CLASSES_HEADERS.WORKERS] ?? ""));
    }
  }, [row]);

  // 2. 파생 정보
  const classTitle = useMemo(() => {
    if (!row) return "";
    const school = String(row[CLASSES_HEADERS.SCHOOL] ?? "").trim();
    const subject = String(row[CLASSES_HEADERS.SUBJECT] ?? "").trim();
    return (school && subject) ? `${school} ${subject}` : (school || subject || "수업");
  }, [row]);

  const attendanceSpot = useMemo(() => {
    if (!row || !posMap) return null;
    const placeName = String(row[CLASSES_HEADERS.PLACE] ?? "").trim();
    if (!placeName) return null;
    
    const rawCoord = posMap.get(placeName) ?? "";
    const parts = rawCoord.replace(/[()]/g, "").split(",").map(s => s.trim());
    if (parts.length < 2) return null;
    return { name: placeName, lat: Number(parts[0]), lon: Number(parts[1]), radiusMeters: ACCEPT_RADIUS_METERS };
  }, [row, posMap]);

  // 3. 출석 상태 확인
  const loadAttendanceStatus = useCallback(async () => {
    const log = await fetchSheetData(`${CSV_URLS.ATTENDANCE_LOG}&t=${Date.now()}`);
    const myLog = (log || []).filter((r: any) => {
      const cid = String(r[ATTENDANCE_LOG_HEADERS.CLASS_ID] ?? "").trim();
      const mail = String(r[ATTENDANCE_LOG_HEADERS.WORKER_EMAIL] ?? r["Email"] ?? "").trim().toLowerCase();
      return cid === targetId && mail === userEmail!.toLowerCase();
    });

    if (myLog.length === 0) {
      setCheckedIn(false); setCheckInTime(null); setMessage("출근 버튼을 눌러 진행하세요."); return;
    }

    const active = myLog.find((r: any) => {
      const st = String(r[ATTENDANCE_LOG_HEADERS.STATUS] ?? "").trim();
      return st === "출근";
    });

    if (active) {
      setCheckedIn(true);
      setCheckInTime(String(active[ATTENDANCE_LOG_HEADERS.ATTENDANCE_START] ?? "").trim());
      setMessage("✅ 현재 출근 상태입니다. (퇴근 버튼을 누르세요)");
    } else {
      setCheckedIn(false); setCheckInTime(null); setMessage("출근 버튼을 눌러 진행하세요.");
    }
  }, [targetId, userEmail]);

  useEffect(() => { if (row) loadAttendanceStatus(); }, [row, loadAttendanceStatus]);

  // 4. GPS
  const getGps = async () => {
    if (!attendanceSpot) { setMessage("❌ 수업 장소 좌표가 없습니다."); return null; }
    setCheckingGps(true); setMessage("위치 확인 중…");
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setMessage("❌ 위치 권한이 필요합니다."); return null; }
      
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      const { latitude, longitude } = loc.coords;
      const dist = haversine(latitude, longitude, attendanceSpot.lat, attendanceSpot.lon);
      return { lat: latitude, lon: longitude, dist };
    } catch { setMessage("❌ 위치 확인 실패"); return null; }
    finally { setCheckingGps(false); }
  };

  // 5. 출근 핸들러
  const handleCheckIn = async () => {
    const existing = await getActiveSession();
    if (existing && existing.email === userEmail!.toLowerCase() && existing.classId !== targetId) {
      Alert.alert("알림", `이미 "${existing.className}" 수업에 출근 중입니다.`); return;
    }
    const gps = await getGps();
    if (!gps) return;

    const distM = Math.round(gps.dist);
    let remark = distM > WARN_RADIUS_METERS ? `⚠ 지정 위치 벗어남 (${distM}m)` : "";
    const startTime = nowHm();

    const payload = {
      action: "checkin", 
      [ATTENDANCE_LOG_HEADERS.ATTENDANCE_DATE]: todayYmd(),
      [ATTENDANCE_LOG_HEADERS.CLASS_ID]: targetId,
      [ATTENDANCE_LOG_HEADERS.QUARTER]: String(row![CLASSES_HEADERS.QUARTER] ?? "").trim(),
      [ATTENDANCE_LOG_HEADERS.CLASS_NAME]: classTitle,
      [ATTENDANCE_LOG_HEADERS.DAY]: String(row![CLASSES_HEADERS.DAY] ?? "").trim(),
      [ATTENDANCE_LOG_HEADERS.WORKERS]: workerName || "이름 없음",
      [ATTENDANCE_LOG_HEADERS.WORKER_EMAIL]: userEmail,
      [ATTENDANCE_LOG_HEADERS.ATTENDANCE_START]: startTime,
      [ATTENDANCE_LOG_HEADERS.ATTENDANCE_END]: "",
      [ATTENDANCE_LOG_HEADERS.STATUS]: "출근",
      [ATTENDANCE_LOG_HEADERS.WORKER_LOCATION]: `${formatCoord5(gps.lat)},${formatCoord5(gps.lon)}`,
      [ATTENDANCE_LOG_HEADERS.NOTE]: remark,
    };

    setSaving(true);
    const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.ATTENDANCE, payload);
    setSaving(false);

    if (res.ok) {
      setCheckedIn(true); setCheckInTime(startTime); setMessage(`✅ 출근 완료 (${distM}m)`);
      await startSession({ classId: targetId, className: classTitle, email: userEmail!.toLowerCase(), workDate: todayYmd(), startHm: startTime, startedAt: Date.now() });
      setActionLockUntil(Date.now() + 2000);
      setTimeout(loadAttendanceStatus, 1500);
    } else {
      setMessage(`❌ 출근 실패: ${res.error || "오류 발생"}`);
    }
  };

  // 6. 퇴근 핸들러
  const handleCheckOut = async () => {
    if (Date.now() < actionLockUntil) return;
    if (!checkInTime) { await loadAttendanceStatus(); return; }
    
    const gps = await getGps(); 

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
      [ATTENDANCE_LOG_HEADERS.WORKER_EMAIL]: userEmail, 
      [ATTENDANCE_LOG_HEADERS.ATTENDANCE_END]: endTime,
      "근무 시간": workHm,
    };

    setSaving(true);
    setCheckedIn(false); setCheckInTime(null); setMessage("✅ 퇴근 처리 중…");
    await clearSession();

    const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.ATTENDANCE, payload);
    setSaving(false);

    if (res.ok) {
      setMessage("✅ 퇴근 처리 완료");
      setTimeout(loadAttendanceStatus, 1500);
    } else {
      setMessage(`❌ 퇴근 실패: ${res.error}`);
      loadAttendanceStatus();
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

      setIndividualMsg(`${session}차시 ${targets.length}명 전송 완료!`);
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
    // 1. 안드로이드 필수 권한 요청 (SEND_SMS + READ_PHONE_STATE)
    if (Platform.OS === 'android') {
      try {
        // 여러 권한을 한 번에 요청합니다.
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.SEND_SMS,
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE
        ]);

        const smsGranted = granted[PermissionsAndroid.PERMISSIONS.SEND_SMS] === PermissionsAndroid.RESULTS.GRANTED;
        const stateGranted = granted[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED;

        // READ_PHONE_STATE는 기기/버전에 따라 필수가 아닐 수도 있으므로, SEND_SMS만이라도 있으면 진행 시도
        if (!smsGranted) {
          showAlert("권한 거부", "문자 발송 권한이 거부되었습니다.\n[설정] > [앱] 에서 권한을 허용해주세요.");
          return;
        }
      } catch (err) {
        console.warn(err);
        showAlert("권한 오류", "권한을 요청하는 중 오류가 발생했습니다.");
        return;
      }
    }

    Alert.alert(
      "문자 발송",
      "현재 수업의 대기 중인(unsent) 메시지를 모두 발송하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "발송",
          onPress: async () => {
            setSaving(true);
            try {
              // 1. 시트 데이터 가져오기
              const response = await fetch(`${API_URLS.MESSAGE_LOG}?sheet=${SHEET_NAMES.MESSAGE_LOG}`);
              const data = await response.json();
              
              if (data.error) {
                showAlert("오류", "시트 데이터를 가져오지 못했습니다.");
                return;
              }

              // 2. 필터링 (현재 수업 & unsent)
              const unsentMessages = data.filter((row: any) => {
                const isUnsent = row[MESSAGE_LOG_HEADERS.MESSAGE_STATUS] === "unsent";
                const isSameClass = String(row[MESSAGE_LOG_HEADERS.CLASS_ID]) === String(targetId);
                return isUnsent && isSameClass;
              });

              if (unsentMessages.length === 0) {
                showAlert("알림", "이 수업에 발송 대기 중인(unsent) 메시지가 없습니다.");
                setSaving(false);
                return;
              }

              let sentCount = 0;
              let failCount = 0;
              let lastError = "";

              // 3. 문자 발송 루프
              for (const msg of unsentMessages) {
                const phone = msg[MESSAGE_LOG_HEADERS.PARENT_PHONE];
                const content = msg[MESSAGE_LOG_HEADERS.CONTENT];

                if (phone && content) {
                  const cleanPhone = String(phone).replace(/-/g, "");
                  try {
                    // DirectSms 모듈 사용
                    await DirectSms.sendDirectSms(cleanPhone, content);
                    sentCount++;
                  } catch (e: any) {
                    console.error("SMS 전송 실패:", phone, e);
                    failCount++;
                    lastError = e.message || String(e);
                    lastError = e.message || String(e);
                    showAlert("발송 실패 (디버깅)", `번호: ${cleanPhone}\n에러내용: ${lastError}`);
                  }
                }
                
                // 안드로이드 스팸 차단 방지 딜레이 (1.5초)
                await new Promise(resolve => setTimeout(resolve, 1500));
              }

              // 4. 상태 업데이트
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
                showAlert("발송 실패", `모든 전송이 실패했습니다.\n(권한 문제일 가능성이 높습니다)\n오류 내용: ${lastError}`);
              }

            } catch (error: any) {
              console.error(error);
              showAlert("오류 상세", error.message || "알 수 없는 오류");
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
      showAlert("오류", "삭제 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSchedule = () => {
    // 🌐 웹 환경: 브라우저 기본 confirm 창 사용
    if (Platform.OS === 'web') {
      const ok = window.confirm(`${scheduleSession}차시 일정을 정말 삭제하시겠습니까?`);
      if (ok) {
        processDelete();
      }
      return;
    }

    // 📱 앱 환경: React Native Alert 사용
    Alert.alert(
      "일정 삭제",
      `${scheduleSession}차시 일정을 정말 삭제하시겠습니까?`,
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
    if (!scheduleSession) { showAlert("알림", "차시를 입력해주세요."); return; }

    setSaving(true);
    try {

      const action = isEditMode ? "update_class_schedule" : "add_class_schedule";
      
      const payload = {
        action: action,
        classId: targetId,
        quarter: String(row[CLASSES_HEADERS.QUARTER] ?? ""),
        className: classTitle,
        day: String(row[CLASSES_HEADERS.DAY] ?? ""),
        session: scheduleSession,
        date: selectedDate,
        workers: scheduleWorkers,
        note: scheduleNote
      };

      const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.SCHEDULE, payload);
      
      if (res.ok) {
        const msg = isEditMode ? "일정이 수정되었습니다." : "새 일정이 등록되었습니다.";
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
            // 2. 추가 모드: 새 객체를 만들어서 목록에 추가하고 정렬
            const newRow = {
              [SCHEDULE_HEADERS.CLASS_ID]: targetId,
              [SCHEDULE_HEADERS.QUARTER]: String(row[CLASSES_HEADERS.QUARTER] ?? ""),
              [SCHEDULE_HEADERS.CLASS_NAME]: classTitle,
              [SCHEDULE_HEADERS.DAY]: String(row[CLASSES_HEADERS.DAY] ?? ""),
              [SCHEDULE_HEADERS.SESSION]: scheduleSession,
              [SCHEDULE_HEADERS.DATE]: selectedDate,
              [SCHEDULE_HEADERS.WORKERS]: scheduleWorkers,
              [SCHEDULE_HEADERS.NOTE]: scheduleNote
            };
            const newList = [...prevRows, newRow];
            
            // 차시 순서대로 다시 정렬
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
      showAlert("오류", "전송 중 문제가 발생했습니다.");
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
    setScheduleNote("");
  };

  const handlePressSchedule = (item: any) => {
    // 권한 체크: 관리자(Admin)나 매니저(Manager)만 수정 가능
    if (!isAdmin && !isManager) {
      showAlert("권한 없음", "일정을 수정할 권한이 없습니다.");
      return;
    }

    setIsEditMode(true); // 수정 모드 켜기

    // 선택된 일정 데이터로 입력창 채우기
    setSelectedDate(item[SCHEDULE_HEADERS.DATE]);
    setScheduleSession(String(item[SCHEDULE_HEADERS.SESSION])); // 숫자인 경우 문자열로 변환
    setScheduleWorkers(item[SCHEDULE_HEADERS.WORKERS] || "");
    setScheduleNote(item[SCHEDULE_HEADERS.NOTE] || "");
    
    setScheduleModalVisible(true); // 모달 열기
  };

  if (loading) return <View style={[styles.container, { justifyContent: "center" }]}><ActivityIndicator /></View>;
  if (!row) return <View style={styles.container}><Text>수업 정보를 찾을 수 없습니다.</Text></View>;

  const fabDisabled = checkingGps || saving || !attendanceSpot || Date.now() < actionLockUntil;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace("/(tabs)/class")} style={styles.backBtn}>
            <Text style={styles.backText}>← 수업 목록</Text>
          </Pressable>
        </View>

        <Text style={styles.title}>{`${classTitle} ${String(row[CLASSES_HEADERS.DAY] ?? "")}`}</Text>
        <Text style={styles.meta}>{String(row[CLASSES_HEADERS.SCHOOL] ?? "")} · {String(row[CLASSES_HEADERS.QUARTER] ?? "")}</Text>

        <View style={styles.infoRow}>
            <View style={styles.infoItem}>
                <Text style={styles.label}>장소</Text>
                <Text style={styles.value}>{String(row[CLASSES_HEADERS.PLACE] ?? "-")}</Text>
            </View>
            <View style={styles.infoItem}>
                <Text style={styles.label}>시간</Text>
                <Text style={styles.value}>{String(row[CLASSES_HEADERS.CLASS_START] ?? "")} ~ {String(row[CLASSES_HEADERS.CLASS_END] ?? "")}</Text>
            </View>
        </View>

        <View style={[styles.infoRow, { marginTop: -10 }]}> 
            <View style={styles.infoItem}>
                <Text style={styles.label}>근무자</Text>
                <Text style={styles.value}>{String(row[CLASSES_HEADERS.WORKERS] ?? "-")}</Text>
            </View>
        </View>

        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>수업 일정</Text>
            
            {(isAdmin || isManager) && (
              <Pressable onPress={() => setScheduleModalVisible(true)} hitSlop={10}>
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
                        key={idx} 
                        style={[styles.scheduleBox, boxStyle]}
                        onPress={() => handlePressSchedule(item)} 
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
                </ScrollView>
              </View>

              <View style={styles.table}>
                <View style={styles.trHead}>
                  <Text style={[styles.th, { flex: 0.6 }]}>차시</Text>
                  <Text style={[styles.th, { flex: 1.6 }]}>날짜</Text>
                  <Text style={[styles.th, { flex: 1.2 }]}>근무자</Text>
                  <Text style={[styles.th, { flex: 2 }]}>비고</Text>
                </View>
                {scheduleRows.map((item, idx) => (
                  <View key={idx} style={styles.tr}>
                    <Text style={[styles.td, { flex: 0.6 }]}>{String(item[SCHEDULE_HEADERS.SESSION] ?? "")}</Text>
                    <Text style={[styles.td, { flex: 1.6 }]}>{String(item[SCHEDULE_HEADERS.DATE] ?? "")}</Text>
                    <Text style={[styles.td, { flex: 1.2 }]}>{String(item[SCHEDULE_HEADERS.WORKERS] ?? "")}</Text>
                    <Text style={[styles.td, { flex: 2 }]}>{String(item[SCHEDULE_HEADERS.NOTE] ?? "")}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>출근 관리</Text>
          <Text style={styles.desc}>{attendanceSpot ? `기준 위치: ${attendanceSpot.name} (반경 ${attendanceSpot.radiusMeters}m)` : "❗ 위치 정보를 찾을 수 없습니다."}</Text>
          <Text style={styles.msg}>{message}</Text>
          {checkedIn && checkInTime && <Text style={styles.debug}>출근시간: {checkInTime}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>공지 메시지 추가</Text>
          <Text style={styles.desc}>이 수업의 모든 학생에게 공지를 등록합니다.</Text>
          <TextInput 
            style={styles.input} 
            placeholder="공지 내용을 입력하세요" 
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

        { isAdminDevice && (
          <View style={styles.card}>
              <Text style={styles.cardTitle}>문자 발송</Text>
              <Text style={styles.desc}>해당 수업의 구글 시트에 등록된 문자(unsent)를 보냅니다.</Text>
              <Pressable style={({ pressed }) => [styles.btnBlue, pressed && { opacity: 0.8 }]} onPress={handleDirectSms}>
                <Text style={styles.btnText}>[문자 발송]</Text>
              </Pressable>
            </View>
        )}
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

            <View style={{ flex: 1, width: '100%', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#eee' }}>
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
              <Text style={styles.label}>날짜 선택: <Text style={{color:'#4F46E5', fontWeight:'bold'}}>{selectedDate || "(달력에서 선택)"}</Text></Text>
              <Calendar
                onDayPress={(day: any) => setSelectedDate(day.dateString)}
                markedDates={{
                  [selectedDate]: {selected: true, disableTouchEvent: true, selectedColor: 'orange'}
                }}
                theme={{ selectedDayBackgroundColor: '#4F46E5', todayTextColor: '#4F46E5', arrowColor: '#4F46E5' }}
                style={{ borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 15 }}
              />

              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>차시</Text>
                  <TextInput 
                    style={[
                      styles.modalInput, 
                      isEditMode && { backgroundColor: '#E5E7EB', color: '#6B7280' }
                    ]}
                    placeholder="예: 1"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="number-pad"
                    value={scheduleSession}
                    onChangeText={setScheduleSession}
                    editable={!isEditMode} // 수정 모드에선 읽기 전용
                  />
                </View>
                <View style={{ flex: 1.5 }}>
                  <Text style={styles.label}>예정 근무자</Text>
                  <TextInput 
                    style={[styles.modalInput, !scheduleWorkers && { fontStyle: 'italic' }]}
                    placeholder="이름 입력" 
                    placeholderTextColor="#9CA3AF"
                    value={scheduleWorkers}
                    onChangeText={setScheduleWorkers}
                  />
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
                
                <Pressable style={[styles.modalBtn, styles.modalBtnConfirm]} onPress={handleAddSchedule}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.modalBtnTextConfirm}>{isEditMode ? "수정완료" : "등록"}</Text>}
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

      <Pressable disabled={fabDisabled} onPress={checkedIn ? handleCheckOut : handleCheckIn} style={[styles.fab, fabDisabled ? { opacity: 0.5 } : checkedIn ? { backgroundColor: "#4B5563" } : { backgroundColor: "#4F46E5" }]}>
        <Text style={styles.fabText}>{checkedIn ? "퇴근" : "출근"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: "#F6F7FB", paddingBottom: 100 },
  header: { marginBottom: 12 },
  backBtn: { padding: 5, marginLeft: -5 },
  backText: { fontSize: 14, color: "#4F46E5", fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "800", color: "#111", marginBottom: 4 },
  meta: { fontSize: 14, color: "#666", marginBottom: 20 },
  infoRow: { flexDirection: 'row', gap: 15, marginBottom: 20 },
  infoItem: { backgroundColor: '#fff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', flex: 1 },
  label: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 4 },
  value: { fontSize: 15, fontWeight: "600", color: "#111827" },
  
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#E5E7EB", elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 6, color: "#1F2937" },
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