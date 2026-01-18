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

import { fetchSheetData } from "../utils/googleSheet_csv";
import { postAttendance } from "../utils/attendanceApi";
import { getCurrentUserEmail } from "../utils/currentUser";

/** ===============================
 *  URLs
 * =============================== */
// Classes (read)
const CLASSES_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS-Pbe6xrRkyggkeJGhXCcYKTUcQGc0MP9rPmu3gNg3bw7QiMw_ztHv7wGCPHlOqJXp0wLOkK-O6AX8/pub?gid=0&single=true&output=csv";

// Classes Positions
const POSITIONS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSYAszZjdX2DbIo7pECDNw9OY_e0YT-FWZ8Idb3dWb5ZeOc-o87mBgx76XzW8R4sHhmdbxrbsmk2EHD/pub?gid=261803907&single=true&output=csv";

// Attendance log (read) — publish this sheet/tab as CSV too
const ATTENDANCE_LOG_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSYAszZjdX2DbIo7pECDNw9OY_e0YT-FWZ8Idb3dWb5ZeOc-o87mBgx76XzW8R4sHhmdbxrbsmk2EHD/pub?gid=0&single=true&output=csv";

// Attendance log (write)
const ATTENDANCE_POST_URL = "https://script.google.com/macros/s/AKfycbxbxaJZPQlphtlCJdMat3OL4xXRC_SnjlCfhm4d6OKz5QTA3fyJOl98cs9-f-pBxmXtag/exec";

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
function nowIso() {
  return new Date().toISOString();
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

// Pick latest record by start_time (ISO sorts lexicographically)
function pickLatest(records: Row[]) {
  return records
    .slice()
    .sort((x, y) =>
      String(y["start_time"] ?? y["start time"] ?? "").localeCompare(
        String(x["start_time"] ?? x["start time"] ?? "")
      )
    )[0];
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
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  const [posMap, setPosMap] = useState<Map<string, string> | null>(null);
  const [posLoading, setPosLoading] = useState(true);

  const [checkingGps, setCheckingGps] = useState(false);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("출석 버튼을 눌러 진행하세요.");
  const [distance, setDistance] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);

  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);

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
    // If you later add a dedicated column like "출석위치키", switch to that first.
    const positionKey = String(
      row["출석위치키"] ?? row["position"] ?? row["장소"] ?? ""
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
    const log = await fetchSheetData(ATTENDANCE_LOG_CSV_URL);

    // Expecting headers:
    // class_id, person_email, start_time, 상태
    const relevant = (log || []).filter((r: Row) => {
      const cid = String(r["class_id"] ?? r["class id"] ?? "").trim();
      const mail = String(r["person_email"] ?? r["person mail"] ?? "").trim();
      return (
        cid === targetId && mail.toLowerCase() === userEmail.toLowerCase()
      );
    });

    if (relevant.length === 0) {
      setCheckedIn(false);
      setCheckInTime(null);
      return;
    }

    const latest = pickLatest(relevant);
    const status = String(latest["상태"] ?? latest["status"] ?? "").trim();
    const startTime = String(
      latest["start_time"] ?? latest["start time"] ?? ""
    ).trim();

    if (status === "출근") {
      setCheckedIn(true);
      setCheckInTime(startTime || null);
      setMessage("✅ 현재 출근 상태입니다. (퇴근 버튼을 누르세요)");
    } else {
      setCheckedIn(false);
      setCheckInTime(null);
      setMessage("출석 버튼을 눌러 진행하세요.");
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
      setMessage("❌ 출석 좌표를 찾을 수 없습니다. (positions 시트 매칭 확인)");
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
      setLatitude(latitude);
      setLongitude(longitude);

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

    const startTime = nowIso();
    const payload = {
      "근무 일자": todayYmd(),
      "수업ID": String(row["ID"] ?? "").trim(),
      "반": classTitle,
      "근무자": String(row["근무자"] ?? row["조교"] ?? "").trim(), // 너 시트 구조에 맞게
      "Email": userEmail,
      "출근 시간": startTime,
      "퇴근 시간": "",
      "상태": "출근",
      "위치": `${res.latitude},${res.longitude}`,
      "근무 시간": "",
      "비고": remark, // ← 여기!
    };


    setSaving(true);
    try {
      const out = await postAttendance(ATTENDANCE_POST_URL, payload);
      if (out?.ok) {
        // 메시지는 이미 위에서 세팅했으니 상태만 새로고침
        await loadAttendanceStatus();
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
    if (!row) return;

    if (!checkInTime) {
      setMessage("❌ 출근 기록을 찾을 수 없습니다. (상태 동기화 필요)");
      await loadAttendanceStatus();
      return;
    }

    const res = await getDistanceAndCoords();
    if (!res.ok) return;

    const endTime = nowIso();
    const totalMinutes = minutesBetween(checkInTime, endTime);

    const payload = {
      action: "checkout_update",
      "수업ID": String(row["ID"] ?? "").trim(),
      "Email": userEmail.toLowerCase(),
      "퇴근 시간": endTime,
      "위치": `${res.latitude},${res.longitude}`,
    };


    setSaving(true);
    try {
      const out = await postAttendance(ATTENDANCE_POST_URL, payload);
      if (out?.ok) {
        setMessage(`✅ 퇴근 처리 완료 (총 ${totalMinutes}분)`);
        await loadAttendanceStatus();
      } else {
        setMessage("❌ 퇴근 저장 실패");
      }
    } catch {
      setMessage("❌ 퇴근 저장 실패 (네트워크/권한)");
    } finally {
      setSaving(false);
    }
  }, [
    row,
    classTitle,
    userEmail,
    checkInTime,
    getDistanceAndCoords,
    loadAttendanceStatus,
    attendanceSpot?.name,
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
    checkingGps || saving || posLoading || !attendanceSpot;
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
          <Text style={styles.attendanceTitle}>출석</Text>

          <Text style={styles.attendanceDesc}>
            {posLoading
              ? "출석 위치 로딩 중…"
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
