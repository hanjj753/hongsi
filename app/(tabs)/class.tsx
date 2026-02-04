// [수업] 탭
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Platform } from "react-native";
import { useRouter } from 'expo-router';
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import { Picker } from "@react-native-picker/picker";
import { useFocusEffect } from "@react-navigation/native";

// Utils (경로 ../../utils 로 유지)
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { CSV_URLS, CLASSES_HEADERS } from "../../config/sheetConfig";
import { getActiveSession, ActiveSession } from "../../utils/activeSession";

export default function ClassScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [didAutoPick, setDidAutoPick] = useState(false);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("ALL");

  // 화면 포커스 시 출근 상태 최신화
  useFocusEffect(useCallback(() => {
    (async () => { setActiveSession(await getActiveSession()); })();
  }, []));

  const load = useCallback(async () => {
    setError(null);
    const tryFetch = async () => {
      const data = await fetchSheetData(`${CSV_URLS.CLASSES}&t=${Date.now()}`);
      return (data || []).filter((r) => r && String(r[CLASSES_HEADERS.CLASS_ID] ?? "").trim() !== "");
    };
    try {
      let cleaned = await tryFetch();
      if (cleaned.length === 0) {
        await new Promise((res) => setTimeout(res, 600));
        cleaned = await tryFetch();
      }
      setRows(cleaned);
    } catch (e: any) {
      setRows([]);
      setError(e?.message ?? "수업 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    (async () => { try { await load(); } finally { setLoading(false); } })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); setActiveSession(await getActiveSession()); } finally { setRefreshing(false); }
  };

  const quarterOptions = useMemo(() => {
    const unique = Array.from(new Set(rows.map((r) => String(r[CLASSES_HEADERS.QUARTER] ?? "").trim()).filter(Boolean)));
    unique.sort();
    return ["ALL", ...unique];
  }, [rows]);

  function parseQuarterKey(q: string) {
    const m = String(q ?? "").trim().match(/^(\d{4})-(\d)([MFV])$/i);
    if (!m) return null;
    return { year: Number(m[1]), sem: Number(m[2]), zRank: m[3].toUpperCase() === "M" ? 1 : m[3].toUpperCase() === "F" ? 2 : 3 };
  }

  const latestQuarter = useMemo(() => {
    const qs = rows.map((r) => String(r[CLASSES_HEADERS.QUARTER] ?? "").trim()).filter(Boolean);
    if (qs.length === 0) return null;
    return qs.slice().sort((a, b) => {
      const pa = parseQuarterKey(a), pb = parseQuarterKey(b);
      if (!pa || !pb) return 0;
      if (pa.year !== pb.year) return pa.year - pb.year;
      if (pa.sem !== pb.sem) return pa.sem - pb.sem;
      return pa.zRank - pb.zRank;
    }).pop()!;
  }, [rows]);

  useEffect(() => {
    if (didAutoPick || !latestQuarter) return;
    setSelectedQuarter(latestQuarter);
    setDidAutoPick(true);
  }, [didAutoPick, latestQuarter]);

  const filteredRows = useMemo(() => {
    return selectedQuarter === "ALL" ? rows : rows.filter((r) => String(r[CLASSES_HEADERS.QUARTER] ?? "").trim() === selectedQuarter);
  }, [rows, selectedQuarter]);

  if (loading) return <View style={[styles.container, { justifyContent: "center" }]}><ActivityIndicator /></View>;

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <FontAwesome5 name="chalkboard" size={28} color="#333" />
      <Text style={styles.title}>수업 목록</Text>

      {/* 현재 출근 중 배너 */}
      {activeSession && (
        <Pressable style={styles.openShiftBanner} onPress={() => router.push({ pathname: "/class/[id]", params: { id: activeSession.classId } })}>
          <Text style={styles.openShiftTitle}>현재 출근 중</Text>
          <Text style={styles.openShiftText}>{activeSession.className} · {activeSession.startHm} 출근</Text>
          <Text style={styles.openShiftHint}>눌러서 해당 수업으로 이동</Text>
        </Pressable>
      )}

      {/* 분기 필터 */}
      <View style={styles.filterWrap}>
        <Text style={styles.filterLabel}>분기</Text>

        <View style={styles.pickerShell}>
          <View style={styles.pickerInner}>
            <Picker
              selectedValue={selectedQuarter}
              onValueChange={(val) => setSelectedQuarter(String(val))}
              style={[styles.picker, Platform.OS === "web" && styles.pickerWeb]}
              // ✅ 안드로이드 기본 화살표 숨김(커스텀 화살표만 남기기)
              dropdownIconColor={Platform.OS === "android" ? "transparent" : "#6B7280"}
              mode="dropdown"
            >
              {quarterOptions.map((q) => (
                <Picker.Item key={q} label={q === "ALL" ? "전체" : q} value={q} />
              ))}
            </Picker>

            {/* ✅ 커스텀 화살표: 웹/안드로이드만 표시 (iOS는 기본 UX가 달라서 보통 안 붙임) */}
            {(Platform.OS === "web" || Platform.OS === "android") && (
              <View pointerEvents="none" style={styles.pickerChevron}>
                <FontAwesome5 name="chevron-down" size={14} color="#6B7280" />
              </View>
            )}
          </View>
        </View>
      </View>


      {/* 수업 카드 목록 */}
      {filteredRows.map((r, index) => {
        const id = String(r[CLASSES_HEADERS.CLASS_ID] ?? "");
        
        // ✅ [수정됨] CLASS_NAME 헤더 없이 학교 + 과목 조합
        const school = String(r[CLASSES_HEADERS.SCHOOL] ?? "").trim();
        const subject = String(r[CLASSES_HEADERS.SUBJECT] ?? "").trim();
        const day = String(r[CLASSES_HEADERS.DAY] ?? "").trim();
        const header = (school && subject) ? `${school} ${subject} ${day}` : (school || subject || "수업");

        const place = String(r[CLASSES_HEADERS.PLACE] ?? "").trim();
        const start = String(r[CLASSES_HEADERS.CLASS_START] ?? "").trim();
        const end = String(r[CLASSES_HEADERS.CLASS_END] ?? "").trim();
        const quarter = String(r[CLASSES_HEADERS.QUARTER] ?? "").trim();
        const workers = String(r[CLASSES_HEADERS.WORKERS] ?? "-").trim();

        return (
          <Pressable key={`${id}-${index}`} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} onPress={() => router.push({ pathname: "/class/[id]", params: { id } })}>
            <View style={styles.accent} />
            <View style={styles.cardBody}>
              <Text style={styles.day}>{header}</Text>
              {/* 메타 정보: 학교가 헤더에 있으므로 여기선 분기만 보여줘도 되지만, 명확성을 위해 같이 표시 */}
              {(school || quarter) && <Text style={styles.meta}>{quarter}</Text>}
              <View style={styles.lineRow}><Text style={styles.lineLabel}>장소</Text><Text style={styles.lineValue}>{place || "-"}</Text></View>
              <View style={styles.lineRow}><Text style={styles.lineLabel}>시간</Text><Text style={styles.lineValue}>{start || end ? `${start} ~ ${end}` : "-"}</Text></View>
              <View style={styles.lineRow}><Text style={styles.lineLabel}>근무자</Text><Text style={styles.lineValue}>{workers}</Text>
              </View>
            
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingTop: 40, alignItems: "center", paddingBottom: 24, backgroundColor: "#F6F7FB" },
  title: { fontSize: 18, marginVertical: 12, fontWeight: "700", color: "#111827" },
  filterWrap: { width: "92%", marginBottom: 10 },
  filterLabel: { fontSize: 12, color: "#6B7280", fontWeight: "700", marginBottom: 6 },
  pickerBox: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, overflow: "hidden", backgroundColor: "#fff" },
  card: { width: "92%", flexDirection: "row", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB", marginVertical: 6, borderRadius: 12, overflow: "hidden", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  accent: { width: 6, backgroundColor: "#4F46E5" },
  cardBody: { flex: 1, paddingVertical: 14, paddingHorizontal: 14 },
  day: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 4 },
  meta: { fontSize: 12, color: "#6B7280", marginBottom: 10 },
  lineRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 6 },
  lineLabel: { width: 44, fontSize: 12, color: "#6B7280", fontWeight: "600" },
  lineValue: { flex: 1, fontSize: 14, color: "#111827", fontWeight: "500" },
  openShiftBanner: { width: "92%", padding: 14, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#4F46E5", marginBottom: 16, shadowColor: "#4F46E5", shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  openShiftTitle: { fontSize: 12, fontWeight: "900", color: "#4F46E5", marginBottom: 6 },
  openShiftText: { fontSize: 16, fontWeight: "800", color: "#111827" },
  openShiftHint: { marginTop: 6, fontSize: 12, color: "#6B7280" },

  // 선택 상자 이쁘게
  pickerShell: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },

  pickerInner: {
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },

  picker: {
    height: 44,
    width: "100%",
    color: "#111827",
    backgroundColor: "transparent",
    // ✅ Picker(특히 웹 select)의 기본 테두리가 튀지 않게
    borderWidth: 0,
  },

  // ✅ 웹에서 <select> 기본 검은 테두리/포커스 아웃라인/기본 화살표 제거
  pickerWeb: {
    outlineStyle: "none",
    outlineWidth: 0,
    borderWidth: 0,

    // @ts-ignore (RN Web 전용 CSS)
    appearance: "none",
    // @ts-ignore
    WebkitAppearance: "none",
    // @ts-ignore
    MozAppearance: "none",

    paddingRight: 36, // 커스텀 화살표 공간 확보
  },

  pickerChevron: {
    position: "absolute",
    right: 12,
    top: 0,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },

});