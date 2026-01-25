// app/class/[id].tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput, Platform } from "react-native";
import { useLocalSearchParams, useRouter, useRootNavigationState } from "expo-router";
import * as Location from "expo-location";
import * as Application from "expo-application";

// Utils & Config
import { fetchSheetData, fetchClassSheet, fetchClassSheetRaw } from "../../utils/googleSheet_csv";
import { postSheetData } from "../../utils/sheetApi";
import { getActiveSession, startSession, clearSession, ActiveSession } from "../../utils/activeSession";
import { getCurrentUserEmail } from "../../utils/currentUser";
import DirectSms from "../../utils/smsSender";
import { getClassUrls } from "../../utils/classInfo";

import { CSV_URLS, API_URLS, CLASSES_HEADERS, POSITIONS_HEADERS, ATTENDANCE_LOG_HEADERS, MESSAGE_LOG_HEADERS, 
  CLASS_SHEET_HEADERS, CLASS_SHEET_HEADER_ROW, CLASS_DATA_COL_SHIFT, CLASS_SESSION_STRIDE } from "../../config/sheetConfig";
import { ADMIN_DEVICE_IDS } from "../../config/adminConfig";
import { INDIVIDUAL_MESSAGE_TEMPLATE } from "../../config/messageConfig";

// Constants
const WARN_RADIUS_METERS = 30; // 30m 이내 정상
const ACCEPT_RADIUS_METERS = 100; // 100m 이내 인정(경고)
const SHEET_NAME_ATTENDANCE = "조교_출석_현황"; 
const SHEET_NAME_MESSAGE = "메시지 log";

// Helpers
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

  const [isAdminDevice, setIsAdminDevice] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const androidId = Application.getAndroidId();
      if (ADMIN_DEVICE_IDS.includes(androidId)) {
        setIsAdminDevice(true);
      }
    }
  }, []);

  // 1. 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        const [cData, pData] = await Promise.all([fetchSheetData(CSV_URLS.CLASSES), fetchSheetData(CSV_URLS.POSITIONS)]);
        setRow((cData || []).find((r: any) => String(r[CLASSES_HEADERS.CLASS_ID] ?? "").trim() === targetId) || null);
        
        const map = new Map<string, string>();
        (pData || []).forEach((r: any) => {
          const key = String(r[POSITIONS_HEADERS.PLACE] ?? "").trim();
          const val = String(r[POSITIONS_HEADERS.PLACE_LOCATION] ?? "").trim();
          if (key && val) map.set(key, val);
        });
        setPosMap(map);
      } finally { setLoading(false); }
    })();
  }, [targetId]);

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
      // 퇴근 시간이 비어있고 상태가 출근인 경우
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
      [ATTENDANCE_LOG_HEADERS.QUARTER]: String(row![CLASSES_HEADERS.QUARTER] ?? "").trim(), // ✅ 추가됨: 분기 정보
      [ATTENDANCE_LOG_HEADERS.CLASS_NAME]: classTitle,
      [ATTENDANCE_LOG_HEADERS.DAY]: String(row![CLASSES_HEADERS.DAY] ?? "").trim(),
      [ATTENDANCE_LOG_HEADERS.WORKERS]: String(row![CLASSES_HEADERS.WORKERS] ?? "").trim(),
      [ATTENDANCE_LOG_HEADERS.WORKER_EMAIL]: userEmail,
      [ATTENDANCE_LOG_HEADERS.ATTENDANCE_START]: startTime,
      [ATTENDANCE_LOG_HEADERS.ATTENDANCE_END]: "",
      [ATTENDANCE_LOG_HEADERS.STATUS]: "출근",
      [ATTENDANCE_LOG_HEADERS.WORKER_LOCATION]: `${formatCoord5(gps.lat)},${formatCoord5(gps.lon)}`,
      [ATTENDANCE_LOG_HEADERS.NOTE]: remark,
    };

    setSaving(true);
    const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAME_ATTENDANCE, payload);
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
    
    // GPS는 퇴근 시에는 선택사항일 수 있으나 기록을 위해 가져옴
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
      "근무 시간": workHm, // Apps Script는 "근무 시간" 컬럼을 사용
    };

    setSaving(true);
    setCheckedIn(false); setCheckInTime(null); setMessage("✅ 퇴근 처리 중…");
    await clearSession();

    const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAME_ATTENDANCE, payload);
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
    setNoticeMsg(""); // 메시지 초기화

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
        return postSheetData(API_URLS.MESSAGE_LOG, SHEET_NAME_MESSAGE, payload);
      });

      await Promise.all(promises);
      
      // ✅ 성공 시 화면에 메시지 표시
      setNoticeText(""); 
      setNoticeMsg(`${targets.length}명에게 등록 완료! (상태: unsent)`);
      
      // 3초 뒤에 메시지 사라지게 하기
      setTimeout(() => setNoticeMsg(""), 3000);

    } catch (error: any) {
      console.error(error);
      Alert.alert("오류", "전송 중 문제가 발생했습니다.");
    } finally {
      setSendingNotice(false);
    }
  };

  const handleSendIndividual = async () => {
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
        return;
      }

      const rawRows = await fetchClassSheetRaw(urls.sheetUrl);

      // ID가 있는 행만 필터링
      const targets = rawRows.filter(r => r[0] && r[0].trim() !== "");

      if (targets.length === 0) {
        Alert.alert("알림", "학생 데이터가 없습니다.");
        return;
      }

      const startIndex = CLASS_DATA_COL_SHIFT + (session - 1) * CLASS_SESSION_STRIDE;

      const promises = targets.map((studentRow) => {
        const studentName = studentRow[1];
        const parentPhone = studentRow[3];
        
        if (!parentPhone) return Promise.resolve();

        const attendance = studentRow[startIndex] || "-";
        const homework = studentRow[startIndex + 1] || "-";
        const test = studentRow[startIndex + 2] || "-";

        let content = INDIVIDUAL_MESSAGE_TEMPLATE
          .replace("${STUDENT_NAME}", studentName)
          .replace("${QUARTER}", String(row[CLASSES_HEADERS.QUARTER] ?? "")) 
          .replace("${SESSION}", String(session))
          .replace("${ATTENDANCE}", attendance)
          .replace("${HOMEWORK}", homework)
          .replace("${TEST}", test)
          .replace("${CLASS_NAME}", classTitle) 
          .replace("${DAY}", String(row[CLASSES_HEADERS.DAY] ?? ""));

        const payload = {
          [MESSAGE_LOG_HEADERS.CLASS_ID]: targetId,
          [MESSAGE_LOG_HEADERS.QUARTER]: String(row[CLASSES_HEADERS.QUARTER] ?? ""), 
          [MESSAGE_LOG_HEADERS.CLASS_NAME]: classTitle,
          [MESSAGE_LOG_HEADERS.DAY]: String(row[CLASSES_HEADERS.DAY] ?? ""),        
          [MESSAGE_LOG_HEADERS.ID]: studentRow[0],
          [MESSAGE_LOG_HEADERS.STUDENT_NAME]: studentName,
          [MESSAGE_LOG_HEADERS.PARENT_PHONE]: parentPhone,
          [MESSAGE_LOG_HEADERS.MESSAGE_STATUS]: "unsent",
          [MESSAGE_LOG_HEADERS.CONTENT]: content
        };

        return postSheetData(API_URLS.MESSAGE_LOG, SHEET_NAME_MESSAGE, payload);
      });

      await Promise.all(promises);

      setIndividualMsg(`${session}차시 메시지 등록 완료!`);
      setTimeout(() => setIndividualMsg(""), 3000); // 3초 뒤 사라짐
      setSessionNum("");

    } catch (error) {
      console.error(error);
      Alert.alert("오류", "전송 중 문제가 발생했습니다.");
    } finally {
      setSendingIndividual(false); 
    }
  };

  const handleDirectSms = async () => {
    Alert.alert(
      "문자 발송",
      "현재 대기 중인(unsent) 모든 메시지를 발송하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "발송",
          onPress: async () => {
            setSaving(true);
            try {
              // 1. 메시지 로그 시트 데이터 가져오기 (GAS doGet 사용)
              // sheetConfig.ts의 SHEET_NAME_MESSAGE 확인 ("메시지 log")
              const response = await fetch(`${API_URLS.MESSAGE_LOG}?sheet=${SHEET_NAME_MESSAGE}`);
              const data = await response.json();
              
              if (data.error) {
                Alert.alert("오류", "시트 데이터를 가져오지 못했습니다.");
                return;
              }

              // 2. 'unsent' 상태인 메시지 필터링
              // GAS에서 가져온 JSON의 키는 시트의 헤더 이름("상태", "학부모 전화번호", "내용")입니다.
              const unsentMessages = data.filter((row: any) => row[MESSAGE_LOG_HEADERS.MESSAGE_STATUS] === "unsent");

              if (unsentMessages.length === 0) {
                Alert.alert("알림", "발송 대기 중인(unsent) 메시지가 없습니다.");
                setSaving(false);
                return;
              }

              // 3. 문자 발송 (DirectSms)
              let sentCount = 0;
              for (const msg of unsentMessages) {
                const phone = msg[MESSAGE_LOG_HEADERS.PARENT_PHONE]; // "학부모 전화번호"
                const content = msg[MESSAGE_LOG_HEADERS.CONTENT];   // "내용"

                if (phone && content) {
                  // 전화번호에서 하이픈 제거 (선택사항, 모듈에 따라 다름)
                  const cleanPhone = String(phone).replace(/-/g, "");
                  try {
                    await DirectSms.sendDirectSms(cleanPhone, content);
                    sentCount++;
                  } catch (e) {
                    console.error("SMS 전송 실패:", phone, e);
                  }
                }
              }

              // 4. 시트 상태 업데이트 요청 (unsent -> sent)
              const updatePayload = {
                sheetName: SHEET_NAME_MESSAGE,
                action: "update_status" // GAS에서 이 action을 처리하도록 수정됨
              };
              
              const updateRes = await postSheetData(API_URLS.MESSAGE_LOG, SHEET_NAME_MESSAGE, updatePayload);

              if (updateRes.ok) {
                 Alert.alert("완료", `${sentCount}건의 문자를 발송하고 상태를 업데이트했습니다.`);
              } else {
                 Alert.alert("주의", "문자는 발송했으나, 시트 상태 업데이트에 실패했습니다.");
              }

            } catch (error) {
              console.error(error);
              Alert.alert("오류", "작업 중 문제가 발생했습니다.");
            } finally {
              setSaving(false);
            }
          }
        }
      ]
    );
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>출근 관리</Text>
          <Text style={styles.desc}>{attendanceSpot ? `기준 위치: ${attendanceSpot.name} (반경 ${attendanceSpot.radiusMeters}m)` : "❗ 위치 정보를 찾을 수 없습니다."}</Text>
          <Text style={styles.msg}>{message}</Text>
          {checkedIn && checkInTime && <Text style={styles.debug}>출근시간: {checkInTime}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>공지 발송</Text>
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
              <Text style={styles.btnText}>공지 보내기</Text>
            </Pressable>
          )}

          {!!noticeMsg && (
            <Text style={{ color: '#059669', fontWeight: '700', textAlign: 'center', marginTop: 12 }}>
              {noticeMsg}
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>개별 메시지 발송</Text>
          <Text style={styles.desc}>차시에 맞는 출석/숙제/시험 점수를 불러와 발송합니다.</Text>
          
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <TextInput 
              style={[styles.input, { flex: 1, minHeight: 40, marginBottom: 0, marginRight: 10 }]} 
              placeholder="차시 (예: 1)" 
              keyboardType="number-pad"
              value={sessionNum}
              onChangeText={setSessionNum}
            />
            <Text style={{ fontWeight: '600', color: '#4B5563' }}>차시</Text>
          </View>

          {sendingIndividual ? (
             <ActivityIndicator style={{marginTop: 10}} color="#10B981" />
          ) : (
            <Pressable style={({ pressed }) => [styles.btnGreen, pressed && { opacity: 0.8 }]} onPress={handleSendIndividual}>
              <Text style={styles.btnText}>문자 메시지 보내기</Text>
            </Pressable>
          )}

          {!!individualMsg && (
            <Text style={{ color: '#059669', fontWeight: '700', textAlign: 'center', marginTop: 12 }}>
              {individualMsg}
            </Text>
          )}
        </View>

        { isAdminDevice && (
          <View style={styles.card}>
              <Text style={styles.cardTitle}>일반 문자 발송</Text>
              <Text style={styles.desc}>전화번호를 입력하여 직접 문자를 보냅니다.</Text>
              <Pressable style={({ pressed }) => [styles.btnBlue, pressed && { opacity: 0.8 }]} onPress={handleDirectSms}>
                <Text style={styles.btnText}>[문자 발송]</Text>
              </Pressable>
            </View>
        )}
      </ScrollView>

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
  btnBlue: { backgroundColor: "#3B82F6", padding: 14, borderRadius: 8, alignItems: "center" }, // 파란색 버튼 스타일 추가
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  
  fab: { position: "absolute", right: 20, bottom: 30, width: 64, height: 64, borderRadius: 32, justifyContent: "center", alignItems: "center", elevation: 6 },
  fabText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});