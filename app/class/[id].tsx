// app/class/[id].tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import {
  useLocalSearchParams,
  useRouter,
  useRootNavigationState,
} from "expo-router";
import * as Location from "expo-location";
import { getOpenShift, setOpenShift, clearOpenShift } from "../utils/openShiftStore";

import { fetchSheetData } from "../utils/googleSheet_csv";
import { postAttendance } from "../utils/attendanceApi";
import { getCurrentUserEmail } from "../utils/currentUser";

/** ===============================
 *  URLs
 * =============================== */
// Classes (read)
const CLASSES_CSV_URL = "REMOVED_PRIVATE_SHEET_URL";

// Classes Positions
const POSITIONS_CSV_URL = "REMOVED_PRIVATE_SHEET_URL";

// Attendance log (read) — publish this sheet/tab as CSV too
const ATTENDANCE_LOG_CSV_URL = "REMOVED_PRIVATE_SHEET_URL";

// Attendance log (write)
const ATTENDANCE_POST_URL = "REMOVED_PRIVATE_SCRIPT_URL";

/** ===============================
 *  Types
 * =============================== */
type Row = Record<string, any>;

type AttendanceSpot = {
  name: string;
  lat: number;
  lon: number;
  radiusMeters: number;
};

const WARN_RADIUS_METERS = 30;    // 이 범위 내에서는 정상 출근
const ACCEPT_RADIUS_METERS = 100; // 이 범위를 넘어서면 이상이면 경고 출력

/** ===============================
 *  Helpers
 * =============================== */
function hmToMinutes(hm: string) {
  const m = String(hm || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToHm(mins: number) {
  const m = Math.max(0, Math.floor(mins));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${hh}:${String(mm).padStart(2, "0")}`; // 예: "2:05"
}

function calcWorkMinutes(startHm: string, endHm: string) {
  const s = hmToMinutes(startHm);
  const e = hmToMinutes(endHm);
  if (s === null || e === null) return null;

  let diff = e - s;
  if (diff < 0) diff += 24 * 60; // ✅ 자정 넘김
  return diff;
}

function nowHm() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function roundCoord5(n: number) {
  return Math.round(n * 1e5) / 1e5;
}

function formatCoord5(n: number) {
  return roundCoord5(n).toFixed(5);
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

function minutesBetween(startIso: string, endIso: string) {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  return Math.max(0, Math.round((b - a) / 60000));
}

function parseCoordinate(coord: any): { lat: number; lon: number } | null {
  const raw = String(coord ?? "").trim();
  if (!raw) return null;

  // Accept: "37.12,127.33" (+ spaces). Also tolerate "(..,..)".
  const cleaned = raw.replace(/[()]/g, "");
  const parts = cleaned.split(",").map((s) => s.trim());
  if (parts.length < 2) return null;

  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lon };
}

export default function ClassDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rootNavState = useRootNavigationState();
  const navReady = !!rootNavState?.key;

  const rawId = (params as any)?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const targetId = String(id ?? "").trim();

  // Logged in email (from Firebase auth)
  const userEmail = getCurrentUserEmail();

  // ✅ Redirect only after nav is ready (prevents "navigate before mounting")
  useEffect(() => {
    if (!navReady) return;
    if (!userEmail) router.replace("/(tabs)");
  }, [navReady, userEmail, router]);

  // Don’t render screen until navigation is ready and user exists
  if (!navReady) return null;
  if (!userEmail) return null;

  /** ===============================
   *  State
   * =============================== */
  const [actionLockUntil, setActionLockUntil] = useState<number>(0);
  const [openShift, setOpenShiftState] = useState<null | {
    classId: string;
    classTitle: string;
    email: string;
    workDate: string;
    startHm: string;
    startedAt: number;
  }>(null);
  
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  const [posMap, setPosMap] = useState<Map<string, string> | null>(null);
  const [posLoading, setPosLoading] = useState(true);

  const [checkingGps, setCheckingGps] = useState(false);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("출근 버튼을 눌러 진행하세요.");
  const [distance, setDistance] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);

  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const s = await getOpenShift();
      setOpenShiftState(s);
    })();
  }, []);

  /** ===============================
   *  Load class row
   * =============================== */
  const loadClass = useCallback(async () => {
    const data = await fetchSheetData(CLASSES_CSV_URL);
    const found = (data || []).find(
      (r: Row) => String(r["ID"] ?? "").trim() === targetId
    );
    setRow(found || null);
  }, [targetId]);

  /** ===============================
   *  Load positions map (position -> "lat,lon")
   * =============================== */
  const loadPositions = useCallback(async () => {
    const data = await fetchSheetData(POSITIONS_CSV_URL);
    const map = new Map<string, string>();

    (data || []).forEach((r: Row) => {
      const key = String(r["장소"] ?? r["position"] ?? r["Position"] ?? "").trim();
      const coord = String(r["좌표"] ?? r["coordinate"] ?? r["Coordinate"] ?? "").trim();
      if (key && coord) map.set(key, coord);
    });

    setPosMap(map);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadClass(), loadPositions()]);
      } finally {
        setLoading(false);
        setPosLoading(false);
      }
    })();
  }, [loadClass, loadPositions]);

  /** ===============================
   *  Derived
   * =============================== */
  const classTitle = useMemo(() => {
    if (!row) return "";
    const subject = String(row["과목"] ?? "").trim();
    const className = String(row["수업 목록"] ?? "").trim();
    return subject && className
      ? `${subject} · ${className}`
      : subject || className || "수업";
  }, [row]);

  // ✅ Find attendance spot based on the class “장소” matching positions sheet `position`
  const attendanceSpot: AttendanceSpot | null = useMemo(() => {
    if (!row || !posMap) return null;

    // This is the key we match to positions sheet.
    // If you later add a dedicated column like "출근위치키", switch to that first.
    const positionKey = String(
      row["출근위치키"] ?? row["position"] ?? row["장소"] ?? ""
    ).trim();

    if (!positionKey) return null;

    const coordStr = posMap.get(positionKey);
    const parsed = parseCoordinate(coordStr);
    if (!parsed) return null;

    return {
      name: positionKey,
      lat: parsed.lat,
      lon: parsed.lon,
      radiusMeters: ACCEPT_RADIUS_METERS, // 100
    };
  }, [row, posMap]);

  /** ===============================
   *  Attendance status from log CSV
   * =============================== */
  const loadAttendanceStatus = useCallback(async () => {
    const log = await fetchSheetData(`${ATTENDANCE_LOG_CSV_URL}&t=${Date.now()}`); // 캐시 방지

    // ✅ 본인(이메일) + 현재 수업ID 기록만
    const relevant = (log || []).filter((r: Row) => {
      const cid = String(r["수업ID"] ?? "").trim();
      const mail = String(r["Email"] ?? "").trim().toLowerCase();
      return cid === targetId && mail === userEmail.toLowerCase();
    });

    if (relevant.length === 0) {
      setCheckedIn(false);
      setCheckInTime(null);
      setMessage("출근 버튼을 눌러 진행하세요.");
      return;
    }

    // ✅ 1) '출근' + '퇴근시간 빈칸' 인 행이 있으면 무조건 출근 상태
    const openRows = relevant.filter((r: Row) => {
      const st = String(r["상태"] ?? "").trim();
      const start = String(r["출근 시간"] ?? "").trim();
      const end = String(r["퇴근 시간"] ?? "").trim();
      return st === "출근" && start !== "" && end === "";
    });

    // 최신 판단: "근무 일자 + 출근 시간" 문자열로 정렬 (YYYY-MM-DD 가정)
    const keyOf = (r: Row) =>
      `${String(r["근무 일자"] ?? "").trim()} ${String(r["출근 시간"] ?? "").trim()}`;

    if (openRows.length > 0) {
      const latestOpen = openRows.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b))).pop()!;
      const startTime = String(latestOpen["출근 시간"] ?? "").trim();

      setCheckedIn(true);
      setCheckInTime(startTime || null);
      setMessage("✅ 현재 출근 상태입니다. (퇴근 버튼을 누르세요)");
      return;
    }

    // ✅ 2) 열린 출근이 없으면 그냥 최신 기록 기준으로 상태 표시
    const latestAny = relevant.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b))).pop()!;
    const status = String(latestAny["상태"] ?? "").trim();

    if (status === "출근") {
      const startTime = String(latestAny["출근 시간"] ?? "").trim();
      setCheckedIn(true);
      setCheckInTime(startTime || null);
      setMessage("✅ 현재 출근 상태입니다. (퇴근 버튼을 누르세요)");
    } else {
      setCheckedIn(false);
      setCheckInTime(null);
      setMessage("출근 버튼을 눌러 진행하세요.");
    }
  }, [targetId, userEmail]);


  // Load attendance state after we have class + positions
  useEffect(() => {
    if (!row) return;
    loadAttendanceStatus();
  }, [row, loadAttendanceStatus]);

  /** ===============================
   *  Location + distance
   * =============================== */
  const getDistanceAndCoords = useCallback(async () => {
    if (!attendanceSpot) {
      setMessage("❌ 출근 좌표를 찾을 수 없습니다. (positions 시트 매칭 확인)");
      return { ok: false as const };
    }

    setCheckingGps(true);
    setMessage("위치 확인 중…");
    setDistance(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setMessage("❌ 위치 권한이 필요합니다.");
        return { ok: false as const };
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });

      const { latitude, longitude } = loc.coords;
      const lat5 = roundCoord5(latitude);
      const lon5 = roundCoord5(longitude);

      setLatitude(lat5);
      setLongitude(lon5);

      const dist = haversine(
        latitude,
        longitude,
        attendanceSpot.lat,
        attendanceSpot.lon
      );
      setDistance(dist);

      const inside = dist <= attendanceSpot.radiusMeters;
      return { ok: true as const, dist, inside, latitude, longitude };
    } catch {
      setMessage("❌ 위치 확인 실패");
      return { ok: false as const };
    } finally {
      setCheckingGps(false);
    }
  }, [attendanceSpot]);

  /** ===============================
   *  Actions
   * =============================== */
  const handleCheckIn = useCallback(async () => {
    // ✅ 다른 수업에 출근 중이면 막기
    const existing = await getOpenShift();
    if (existing && existing.email === userEmail.toLowerCase() && existing.classId !== targetId) {
      setMessage(`❌ 이미 "${existing.classTitle}" 수업에 출근한 상태입니다.\n해당 수업에서 먼저 퇴근해 주세요.`);
      return;
    }

    if (!row) return;

    const res = await getDistanceAndCoords();
    if (!res.ok) return;

    const distM = Math.round(res.dist);

    // ✅ 비고 생성 (거리 구간에 따라)
    let remark = "";
    if (distM > WARN_RADIUS_METERS && distM < ACCEPT_RADIUS_METERS) {
      remark = `⚠ 지정 위치 경고(30m 이상), ${distM} m`;
    } else if (distM >= ACCEPT_RADIUS_METERS) {
      remark = `⚠ 지정 위치 벗어남(100m 이상), ${distM} m`;
    }

    // ✅ 사용자 메시지 (100m 이상도 "반려" 아님)
    if (distM <= WARN_RADIUS_METERS) {
      setMessage(`✅ 출근 처리 완료 (${distM}m)`);
    } else if (distM < ACCEPT_RADIUS_METERS) {
      setMessage(`✅ 출근 처리 완료 (${distM}m)`);
    } else {
      setMessage(`✅ 출근 완료 (⚠경고: 지정된 위치와 ${distM}m 떨어져 있습니다)`);
    }

    const startTime = nowHm(); // "HH:MM"
    const payload = {
      "근무 일자": todayYmd(),
      "수업ID": String(row["ID"] ?? "").trim(),
      "반": classTitle,
      "근무자": String(row["근무자"] ?? row["조교"] ?? "").trim(), // 너 시트 구조에 맞게
      "Email": userEmail,
      "출근 시간": startTime,
      "퇴근 시간": "",
      "상태": "출근",
      "위치": `${formatCoord5(res.latitude)},${formatCoord5(res.longitude)}`,
      "비고": remark, // ← 여기!
    };


    setSaving(true);
    try {
      const out = await postAttendance(ATTENDANCE_POST_URL, payload);
      if (out?.ok) {
        // ✅ 출근 즉시 상태 반영(CSV 지연 대비)
        setCheckedIn(true);
        setCheckInTime(startTime);
        setMessage("✅ 현재 출근 상태입니다. (퇴근 버튼을 누르세요)");

        // ✅ 전역 출근 상태 저장 (수업탭에서도 표시/다른 수업 막기)
        const os = {
          classId: targetId,
          classTitle,
          email: userEmail.toLowerCase(),
          workDate: todayYmd(),
          startHm: startTime,
          startedAt: Date.now(),
        };
        await setOpenShift(os);
        setOpenShiftState(os);

        // ✅ 출근 직후 퇴근 연타 방지(2초)
        setActionLockUntil(Date.now() + 2000);

        // ✅ 뒤에서 동기화(캐시깨고 재조회)
        setTimeout(() => {
          loadAttendanceStatus();
        }, 1200);
      } else {
        setMessage("❌ 출근 저장 실패");
      }
    } catch {
      setMessage("❌ 출근 저장 실패 (네트워크/권한)");
    } finally {
      setSaving(false);
    }
  }, [
    row,
    classTitle,
    userEmail,
    getDistanceAndCoords,
    loadAttendanceStatus,
    attendanceSpot?.name,
  ]);


  const handleCheckOut = useCallback(async () => {
    // ✅ 출근/퇴근 공용 연타 방지
    if (Date.now() < actionLockUntil) {
      setMessage("⏳ 처리 중입니다. 잠시 후 다시 눌러주세요.");
      return;
    }

    if (!row) return;

    if (!checkInTime) {
      setMessage("❌ 출근 기록을 찾을 수 없습니다. (상태 동기화 필요)");
      await loadAttendanceStatus();
      return;
    }

    const res = await getDistanceAndCoords();
    if (!res.ok) return;

    const endTime = nowHm(); // "HH:MM"
    const workMin = calcWorkMinutes(checkInTime, endTime);
    const workHm = workMin === null ? "" : minutesToHm(workMin);

    const payload = {
      action: "checkout_update",
      "수업ID": String(row["ID"] ?? "").trim(),
      "Email": userEmail.toLowerCase(),
      "퇴근 시간": endTime,
      "근무 시간": workHm,
      "위치": `${formatCoord5(res.latitude)},${formatCoord5(res.longitude)}`,
    };

    // ✅ 퇴근도 "즉시 UI 반영" (CSV 지연 대비)
    setSaving(true);
    try {
      // 1) 버튼/상태 먼저 잠금
      setActionLockUntil(Date.now() + 2000);

      // 2) UI 먼저 퇴근 처리된 것처럼 보여주기
      setCheckedIn(false);
      setCheckInTime(null);
      setMessage("✅ 퇴근 처리 중…");

      // 3) 전역 출근 상태도 바로 제거 (수업탭 배너 즉시 내려감)
      await clearOpenShift();
      setOpenShiftState(null);

      // 4) 서버 업데이트
      const out = await postAttendance(ATTENDANCE_POST_URL, payload);

      if (out?.ok) {
        setMessage(out?.message ?? "✅ 퇴근 처리 완료");

        // 5) 뒤에서 동기화(캐시깨고 재조회)
        setTimeout(() => {
          loadAttendanceStatus();
        }, 1200);
      } else {
        // 실패하면 상태 복구 시도
        setMessage(out?.error ?? "❌ 퇴근 저장 실패");
        await loadAttendanceStatus();
      }
    } catch {
      setMessage("❌ 퇴근 저장 실패 (네트워크/권한)");
      await loadAttendanceStatus();
    } finally {
      setSaving(false);
    }
  }, [
    row,
    userEmail,
    checkInTime,
    getDistanceAndCoords,
    loadAttendanceStatus,
    actionLockUntil,
  ]);


  /** ===============================
   *  UI states
   * =============================== */
  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!row) {
    return (
      <View style={styles.container}>
        <Pressable
          onPress={() => router.replace("/(tabs)/class")}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← 수업 목록</Text>
        </Pressable>

        <Text style={styles.title}>수업을 찾을 수 없습니다</Text>
        <Text style={styles.meta}>ID: {targetId}</Text>
      </View>
    );
  }

  const school = String(row["학교"] ?? "").trim();
  const quarter = String(row["분기"] ?? "").trim();
  const place = String(row["장소"] ?? "").trim();
  const start = String(row["시작"] ?? "").trim();
  const end = String(row["종료"] ?? "").trim();

  // FAB
  const fabDisabled =
    checkingGps || saving || posLoading || !attendanceSpot || Date.now() < actionLockUntil;
  const fabLabel = checkedIn ? "퇴근" : "출근";

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.replace("/(tabs)/class")}
            style={({ pressed }) => [
              styles.backButton,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.backText}>← 수업 목록</Text>
          </Pressable>
        </View>

        <Text style={styles.title}>{classTitle}</Text>
        <Text style={styles.meta}>
          {school || "-"}
          {quarter ? ` · ${quarter}` : ""}
        </Text>

        <Section label="장소" value={place} />
        <Section
          label="시간"
          value={(start || end) ? `${start || "-"} ~ ${end || "-"}` : "-"}
        />

        <View style={styles.attendanceCard}>
          <Text style={styles.attendanceTitle}>출근</Text>

          <Text style={styles.attendanceDesc}>
            {posLoading
              ? "출근 위치 로딩 중…"
              : attendanceSpot
              ? `기준 위치: ${attendanceSpot.name}  (반경 ${attendanceSpot.radiusMeters}m)`
              : "❗ positions 시트에서 좌표를 찾을 수 없습니다. (position 키 매칭 확인)"}
          </Text>

          <Text style={styles.attendanceMsg}>{message}</Text>

          {distance !== null && (
            <Text style={styles.attendanceDebug}>
              거리: {Math.round(distance)}m{"\n"}
              위도: {latitude}{"\n"}
              경도: {longitude}
            </Text>
          )}

          {checkedIn && checkInTime && (
            <Text style={styles.attendanceDebug}>출근시간: {checkInTime}</Text>
          )}

          <Text style={styles.attendanceDebug}>로그인: {userEmail}</Text>
        </View>
      </ScrollView>

      {/* Floating action button bottom-right */}
      <Pressable
        disabled={fabDisabled}
        onPress={checkedIn ? handleCheckOut : handleCheckIn}
        style={({ pressed }) => [
          styles.fab,
          fabDisabled && { opacity: 0.5 },
          pressed && !fabDisabled && { transform: [{ scale: 0.98 }] },
        ]}
      >
        <Text style={styles.fabText}>{fabLabel}</Text>
      </Pressable>
    </View>
  );
}

function Section({ label, value }: { label: string; value: any }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{String(value ?? "-")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: "#F6F7FB",
    paddingBottom: 100,
  },
  header: { marginBottom: 12 },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignSelf: "flex-start",
  },
  backText: { fontSize: 14, fontWeight: "600", color: "#4F46E5" },

  title: { fontSize: 20, fontWeight: "800", color: "#111827", marginBottom: 6 },
  meta: { fontSize: 13, color: "#6B7280", marginBottom: 18 },

  section: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 10,
  },
  label: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 4 },
  value: { fontSize: 15, fontWeight: "500", color: "#111827" },

  attendanceCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginTop: 6,
  },
  attendanceTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 6 },
  attendanceDesc: { fontSize: 12, color: "#6B7280", marginBottom: 10 },
  attendanceMsg: { fontSize: 14, color: "#111827", marginBottom: 10 },
  attendanceDebug: { marginTop: 6, fontSize: 12, color: "#6B7280", lineHeight: 18 },

  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#4F46E5",
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  fabText: { color: "#fff", fontWeight: "900", fontSize: 16 },
});
