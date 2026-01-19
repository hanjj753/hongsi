import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useRouter } from 'expo-router';
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import { Picker } from "@react-native-picker/picker";
import { fetchSheetData } from "../utils/googleSheet_csv";
import { useFocusEffect } from "@react-navigation/native";
import { getOpenShift } from "../utils/openShiftStore";

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS-Pbe6xrRkyggkeJGhXCcYKTUcQGc0MP9rPmu3gNg3bw7QiMw_ztHv7wGCPHlOqJXp0wLOkK-O6AX8/pub?gid=0&single=true&output=csv";

export default function ClassScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openShift, setOpenShift] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [didAutoPick, setDidAutoPick] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const s = await getOpenShift();
        setOpenShift(s);
      })();
    }, [])
  );

  const router = useRouter();
  
  // ✅ selected quarter (local filter)
  // const [selectedQuarter, setSelectedQuarter] = useState<string>("ALL");
  const [selectedQuarter, setSelectedQuarter] = useState<string>("2026-1F");

  const load = useCallback(async () => {
    setError(null);

    const tryFetch = async () => {
      const data = await fetchSheetData(`${SHEET_CSV_URL}&t=${Date.now()}`);
      const cleaned = (data || []).filter((r) => r && String(r["ID"] ?? "").trim() !== "");
      return cleaned;
    };

    try {
      let cleaned = await tryFetch();

      // ✅ 첫 요청이 비었으면 1번만 재시도
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


  // fetch once on screen load
  useEffect(() => {
    (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  // ✅ derive quarter options from downloaded data
  const quarterOptions = useMemo(() => {
    const unique = Array.from(
      new Set(
        rows.map((r) => String(r["분기"] ?? "").trim()).filter(Boolean)
      )
    );
    unique.sort();
    return ["ALL", ...unique];
  }, [rows]);

  function parseQuarterKey(q: string) {
    // 2026-1F / 2025-2V 같은 형식
    const m = String(q ?? "").trim().match(/^(\d{4})-(\d)([MFV])$/i);
    if (!m) return null;

    const year = Number(m[1]);
    const sem = Number(m[2]); // 1 or 2
    const z = m[3].toUpperCase(); // M/F/V

    const zRank = z === "M" ? 1 : z === "F" ? 2 : z === "V" ? 3 : 0;
    return { year, sem, zRank, raw: `${year}-${sem}${z}` };
  }

  function compareQuarter(a: string, b: string) {
    const pa = parseQuarterKey(a);
    const pb = parseQuarterKey(b);
    if (!pa && !pb) return 0;
    if (!pa) return -1;
    if (!pb) return 1;

    if (pa.year !== pb.year) return pa.year - pb.year;
    if (pa.sem !== pb.sem) return pa.sem - pb.sem;
    return pa.zRank - pb.zRank;
  }

  const latestQuarter = useMemo(() => {
    const qs = rows
      .map((r) => String(r["분기"] ?? "").trim())
      .filter(Boolean);

    if (qs.length === 0) return null;

    // 최신 = max
    return qs.slice().sort((a, b) => compareQuarter(a, b)).pop()!;
  }, [rows]);

  useEffect(() => {
    // ✅ 데이터 들어온 뒤 1번만 자동 설정
    if (didAutoPick) return;
    if (!latestQuarter) return;

    setSelectedQuarter(latestQuarter);
    setDidAutoPick(true);
  }, [didAutoPick, latestQuarter]);
  
  // ✅ local filtering only
  const filteredRows = useMemo(() => {
    if (selectedQuarter === "ALL") return rows;
    return rows.filter(
      (r) => String(r["분기"] ?? "").trim() === selectedQuarter
    );
  }, [rows, selectedQuarter]);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <FontAwesome5 name="chalkboard" size={28} color="#333" />
      <Text style={styles.title}>수업 목록</Text>
      {openShift && (
        <Pressable
          style={styles.openShiftBanner}
          onPress={() =>
            router.push({
              pathname: "/class/[id]",
              params: { id: openShift.classId },
            })
          }
        >
          <Text style={styles.openShiftTitle}>현재 출근 중</Text>
          <Text style={styles.openShiftText}>
            {openShift.classTitle} · {openShift.startHm} 출근
          </Text>
          <Text style={styles.openShiftHint}>눌러서 해당 수업으로 이동</Text>
        </Pressable>
      )}

      {/* ✅ Quarter filter UI */}
      <View style={styles.filterWrap}>
        <Text style={styles.filterLabel}>분기</Text>
        <View style={styles.pickerBox}>
          <Picker
            selectedValue={selectedQuarter}
            onValueChange={(val) => setSelectedQuarter(String(val))}
          >
            {quarterOptions.map((q) => (
              <Picker.Item
                key={q}
                label={q === "ALL" ? "전체" : q}
                value={q}
              />
            ))}
          </Picker>
        </View>
      </View>

      {/* Cards */}
      {filteredRows.map((r, index) => {
        const subject = String(r["과목"] ?? "").trim();
        const className = String(r["수업 목록"] ?? "").trim();
        const place = String(r["장소"] ?? "").trim();
        const start = String(r["시작"] ?? "").trim();
        const end = String(r["종료"] ?? "").trim();
        const school = String(r["학교"] ?? "").trim();
        const quarter = String(r["분기"] ?? "").trim();

        const header =
          subject && className
            ? `${subject} · ${className}`
            : subject || className || "수업";

        return (
          <Pressable
            key={`${r["ID"] ?? index}`}
            style={({ pressed }) => [
              styles.card,
              pressed && { opacity: 0.9 },
            ]}
            onPress={() =>
              router.push({
                pathname: "/class/[id]",
                params: { id: String(r["ID"]) },
              })
            }
          >

            <View style={styles.accent} />
            <View style={styles.cardBody}>
              <Text style={styles.day}>{header}</Text>

              {(school || quarter) && (
                <Text style={styles.meta}>
                  {school}
                  {school && quarter ? " · " : ""}
                  {quarter}
                </Text>
              )}

              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>장소</Text>
                <Text style={styles.lineValue}>{place || "-"}</Text>
              </View>

              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>시간</Text>
                <Text style={styles.lineValue}>
                  {start || end ? `${start} ~ ${end}` : "-"}
                </Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingTop: 40,
    alignItems: "center",
    paddingBottom: 24,
    backgroundColor: "#F6F7FB",
  },
  title: {
    fontSize: 18,
    marginVertical: 12,
    fontWeight: "700",
    color: "#111827",
  },

  filterWrap: {
    width: "92%",
    marginBottom: 10,
  },
  filterLabel: {
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "700",
    marginBottom: 6,
  },
  pickerBox: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#fff",
  },

  card: {
    width: "92%",
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginVertical: 0,
    borderRadius: 12,
    overflow: "hidden",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  accent: {
    width: 6,
    backgroundColor: "#4F46E5",
  },
  cardBody: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  day: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 4,
  },
  meta: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 10,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 6,
  },
  lineLabel: {
    width: 44,
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "600",
  },
  lineValue: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    fontWeight: "500",
  },

  openShiftBanner: {
    width: "92%",
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 10,
  },
  openShiftTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: "#4F46E5",
    marginBottom: 6,
  },
  openShiftText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
  },
  openShiftHint: {
    marginTop: 6,
    fontSize: 12,
    color: "#6B7280",
  },

});
