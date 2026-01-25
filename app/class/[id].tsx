// app/class/[id].tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput } from "react-native";
import { useLocalSearchParams, useRouter, useRootNavigationState } from "expo-router";
import * as Location from "expo-location";

// Utils & Config
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { postSheetData } from "../../utils/sheetApi";
import { getActiveSession, startSession, clearSession, ActiveSession } from "../../utils/activeSession";
import { getCurrentUserEmail } from "../../utils/currentUser";
import { CSV_URLS, API_URLS, CLASSES_HEADERS, POSITIONS_HEADERS, ATTENDANCE_LOG_HEADERS } from "../../utils/sheetConfig";

// Constants
const WARN_RADIUS_METERS = 30; // 30m 이내 정상
const ACCEPT_RADIUS_METERS = 100; // 100m 이내 인정(경고)
const SHEET_NAME_ATTENDANCE = "조교_출석_현황"; 

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
  const [message, setMessage] = useState("출근 버튼을 눌러 진행하세요.");
  
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState("");

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

  // 5. 출근 핸들러 (분기 정보 추가됨 ⭐)
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

  const handleSendNotice = () => Alert.alert("준비 중", "공지 발송 기능은 추후 업데이트됩니다.");
  const handleSendIndividual = () => Alert.alert("준비 중", "개별 발송 기능은 추후 업데이트됩니다.");

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

        <Text style={styles.title}>{classTitle}</Text>
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
          <Text style={styles.desc}>수강생들에게 단체 문자를 발송합니다.</Text>
          <TextInput style={styles.input} placeholder="공지 내용을 입력하세요" multiline numberOfLines={3} value={noticeText} onChangeText={setNoticeText} />
          <Pressable style={({ pressed }) => [styles.btnRed, pressed && { opacity: 0.8 }]} onPress={handleSendNotice}>
            <Text style={styles.btnText}>공지 보내기</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>개별 메시지 발송</Text>
          <Text style={styles.desc}>수강생들에게 개인별 문자를 발송합니다.</Text>
          <Pressable style={({ pressed }) => [styles.btnGreen, pressed && { opacity: 0.8 }]} onPress={handleSendIndividual}>
            <Text style={styles.btnText}>문자 메시지 보내기</Text>
          </Pressable>
        </View>
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
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  fab: { position: "absolute", right: 20, bottom: 30, width: 64, height: 64, borderRadius: 32, justifyContent: "center", alignItems: "center", elevation: 6 },
  fabText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});