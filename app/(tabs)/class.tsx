import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import { Picker } from "@react-native-picker/picker";
import { fetchSheetData } from "../utils/googleSheet_csv";

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS-Pbe6xrRkyggkeJGhXCcYKTUcQGc0MP9rPmu3gNg3bw7QiMw_ztHv7wGCPHlOqJXp0wLOkK-O6AX8/pub?gid=0&single=true&output=csv";

export default function ClassScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ✅ selected quarter (local filter)
  // const [selectedQuarter, setSelectedQuarter] = useState<string>("ALL");
  const [selectedQuarter, setSelectedQuarter] = useState<string>("2026-1F");

  const load = useCallback(async () => {
    const data = await fetchSheetData(SHEET_CSV_URL);

    const cleaned = (data || []).filter(
      (r) =>
        r &&
        (r["과목"] || r["수업 목록"] || r["장소"] || r["시작"] || r["종료"])
    );

    setRows(cleaned);
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
          <View key={`${r["ID"] ?? index}`} style={styles.card}>
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
          </View>
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
});
