// app/(tabs)/calendar.tsx
// ✅ "보기 전용" 공용 캘린더 (Google Calendar Public iCal/ICS) 표시
// - Google Cloud Console / API Key / OAuth 필요 없음
// - 캘린더가 "공개(일정 세부정보 공개)" 상태여야 함
//
// 사용법:
// 1) Google Calendar(웹) → 해당 캘린더 설정 → "캘린더 통합" → "공개 iCal 형식" URL 복사
// 2) 아래 PUBLIC_ICAL_URL에 넣기

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {View, Text, StyleSheet, ActivityIndicator, ScrollView, RefreshControl, Pressable, Linking, Platform, } from "react-native";
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";

// ====== 설정(여기만 채우면 동작) ======
const PUBLIC_ICAL_URL =
  "https://api.allorigins.win/raw?url=" +
  encodeURIComponent(
    "https://calendar.google.com/calendar/ical/ee197c570de2b714564a3288488f091adbab80f38f76d63a7a11c76484868b6a%40group.calendar.google.com/public/basic.ics"
  );

// (선택) 표시 기간 (오늘 기준 ±n일) — iCal이 크면 렌더 부담 줄이기용(클라에서 필터)
const RANGE_PAST_DAYS = 7;
const RANGE_FUTURE_DAYS = 14;

type CalEvent = {
  id: string;
  title: string;
  start: string; // ISO string
  end: string;   // ISO string
  allDay: boolean;
  location?: string;
  description?: string;
  url?: string;
};

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateLabel(iso: string) {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function formatTimeHM(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatWeekdayKR(yyyyMmDd: string) {
  // yyyyMmDd: "2026-02-05"
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return days[d.getDay()];
}


function clampRange(events: CalEvent[], min: Date, max: Date) {
  const minT = min.getTime();
  const maxT = max.getTime();
  return events.filter((e) => {
    const st = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    return en >= minT && st <= maxT;
  });
}

// --- iCal(ICS) 파서 (가벼운 자체 파서; 주요 필드만 지원) ---
// 지원: DTSTART, DTEND, SUMMARY, LOCATION, DESCRIPTION, URL, UID
// 제한: 복잡한 RRULE(반복) 완전 지원 X  (많이 필요하면 다음 단계에서 보강 가능)
function unfoldIcsLines(ics: string) {
  // iCal 라인 폴딩(줄바꿈 후 공백/탭으로 시작하면 이전 라인 이어붙임)
  const raw = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseIcsDate(value: string): { iso: string; allDay: boolean } | null {
  // 1) All-day: YYYYMMDD
  // 2) DateTime UTC: YYYYMMDDTHHMMSSZ
  // 3) DateTime local-ish: YYYYMMDDTHHMMSS (TZID 파라미터는 여기선 무시)
  const v = value.trim();

  // All-day
  if (/^\d{8}$/.test(v)) {
    const y = v.slice(0, 4);
    const m = v.slice(4, 6);
    const d = v.slice(6, 8);
    // all-day는 로컬 00:00로 두고 표시에서 "종일" 처리
    const iso = new Date(`${y}-${m}-${d}T00:00:00`).toISOString();
    return { iso, allDay: true };
  }

  // UTC datetime
  if (/^\d{8}T\d{6}Z$/.test(v)) {
    const y = v.slice(0, 4);
    const m = v.slice(4, 6);
    const d = v.slice(6, 8);
    const hh = v.slice(9, 11);
    const mm = v.slice(11, 13);
    const ss = v.slice(13, 15);
    const iso = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`).toISOString();
    return { iso, allDay: false };
  }

  // local datetime (no Z) -> treat as local
  if (/^\d{8}T\d{6}$/.test(v)) {
    const y = v.slice(0, 4);
    const m = v.slice(4, 6);
    const d = v.slice(6, 8);
    const hh = v.slice(9, 11);
    const mm = v.slice(11, 13);
    const ss = v.slice(13, 15);
    const iso = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`).toISOString();
    return { iso, allDay: false };
  }

  return null;
}

function parseIcsEvents(ics: string): CalEvent[] {
  const lines = unfoldIcsLines(ics);

  const events: CalEvent[] = [];
  let inEvent = false;

  let cur: Partial<CalEvent> & {
    uid?: string;
    dtStartRaw?: string;
    dtEndRaw?: string;
    allDayStart?: boolean;
    allDayEnd?: boolean;
  } = {};

  const commit = () => {
    if (!cur.dtStartRaw) return;

    const startParsed = parseIcsDate(cur.dtStartRaw);
    const endParsed = cur.dtEndRaw ? parseIcsDate(cur.dtEndRaw) : null;

    if (!startParsed) return;

    let startIso = startParsed.iso;
    let endIso = endParsed?.iso;

    // DTEND 없는 경우 1시간짜리로 가정
    if (!endIso) {
      const st = new Date(startIso);
      st.setHours(st.getHours() + 1);
      endIso = st.toISOString();
    }

    // All-day인 경우 iCal에서 DTEND는 "다음날 00:00"로 주는 경우가 많음.
    const allDay = Boolean(startParsed.allDay);

    events.push({
      id: cur.uid || `${cur.title || "event"}-${startIso}`,
      title: cur.title || "(제목 없음)",
      start: startIso,
      end: endIso,
      allDay,
      location: cur.location,
      description: cur.description,
      url: cur.url,
    });
  };

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent) commit();
      inEvent = false;
      cur = {};
      continue;
    }
    if (!inEvent) continue;

    // 파라미터 제거: KEY;PARAM=...:VALUE 형태
    const idx = line.indexOf(":");
    if (idx < 0) continue;

    const left = line.slice(0, idx);
    const value = line.slice(idx + 1);

    const key = left.split(";")[0].toUpperCase();

    if (key === "UID") cur.uid = value.trim();
    else if (key === "SUMMARY") cur.title = value.replace(/\\n/g, "\n").trim();
    else if (key === "DTSTART") cur.dtStartRaw = value.trim();
    else if (key === "DTEND") cur.dtEndRaw = value.trim();
    else if (key === "LOCATION") cur.location = value.replace(/\\n/g, "\n").trim();
    else if (key === "DESCRIPTION") cur.description = value.replace(/\\n/g, "\n").trim();
    else if (key === "URL") cur.url = value.trim();
  }

  // start 기준 정렬
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export default function CalendarScreen() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeRange = useMemo(() => {
    const now = new Date();
    const min = addDays(now, -RANGE_PAST_DAYS);
    const max = addDays(now, RANGE_FUTURE_DAYS);
    return { min, max };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    if (!PUBLIC_ICAL_URL || PUBLIC_ICAL_URL.includes("YOUR_PUBLIC_")) {
      throw new Error("PUBLIC_ICAL_URL(공개 ICS 주소)을 설정해주세요.");
    }

    // 캐시 우회(특히 웹/프록시)
    const url = `${PUBLIC_ICAL_URL}${PUBLIC_ICAL_URL.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ICS 불러오기 실패: ${res.status} ${text || ""}`.trim());
    }

    const ics = await res.text();
    const parsed = parseIcsEvents(ics);
    const clamped = clampRange(parsed, timeRange.min, timeRange.max);
    setEvents(clamped);
  }, [timeRange.max, timeRange.min]);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setEvents([]);
        setError(e?.message ?? "일정을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (e: any) {
      setError(e?.message ?? "일정을 불러오지 못했습니다.");
    } finally {
      setRefreshing(false);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const key = formatDateLabel(ev.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    const keys = Array.from(map.keys()).sort();
    return keys.map((k) => ({
      date: k,
      items: map.get(k)!.slice().sort((a, b) => a.start.localeCompare(b.start)),
    }));
  }, [events]);

  const openEvent = async (ev: CalEvent) => {
    // ICS에 URL이 있으면 그걸 우선 오픈. 없으면 공용 캘린더 링크가 따로 없다면 아무것도 안 함.
    if (ev.url) {
      await Linking.openURL(ev.url);
      return;
    }
    // description에 링크가 들어가는 경우가 있어서 단순 탐색(선택)
    const m = (ev.description || "").match(/https?:\/\/\S+/);
    if (m?.[0]) {
      await Linking.openURL(m[0]);
    }
  };

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
        <Text style={styles.muted}>일정을 불러오는 중…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <FontAwesome5 name="calendar-alt" size={24} color="#111827" />
        <Text style={styles.title}>달력</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.rangeHint}>
          {RANGE_PAST_DAYS}d / {RANGE_FUTURE_DAYS}d
        </Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>불러오기 오류</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={[styles.muted, { marginTop: 8 }]}>
            ※ 캘린더가 “공개(일정 세부정보 공개)”인지, ICS URL이 맞는지 확인하세요.
          </Text>
        </View>
      ) : null}

      <View style={styles.listCard}>
        {grouped.length === 0 ? (
          <Text style={styles.muted}>표시할 일정이 없습니다.</Text>
        ) : (
          grouped.map((g) => (
            <View key={g.date} style={{ marginBottom: 14 }}>
              <Text style={styles.sectionTitle}>
                {g.date} ({formatWeekdayKR(g.date)})
              </Text>
              {g.items.map((ev) => (
                <Pressable
                  key={ev.id}
                  onPress={() => openEvent(ev)}
                  style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]}
                >
                  <View style={styles.dot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{ev.title}</Text>
                    <Text style={styles.itemMeta}>
                      {ev.allDay ? "종일" : `${formatTimeHM(ev.start)} ~ ${formatTimeHM(ev.end)}`}
                      {ev.location ? ` · ${ev.location}` : ""}
                    </Text>
                    {!!ev.description && (
                      <Text style={styles.itemDesc} numberOfLines={2}>
                        {ev.description}
                      </Text>
                    )}
                  </View>
                  {(ev.url || /https?:\/\/\S+/.test(ev.description || "")) ? (
                    <FontAwesome5 name="external-link-alt" size={14} color="#6B7280" />
                  ) : null}
                </Pressable>
              ))}
            </View>
          ))
        )}
      </View>

      <Text style={[styles.muted, { marginTop: 10 }]}>
        ✅ 이 화면은 “보기 전용”입니다. (Google Cloud Console / API Key 필요 없음)
      </Text>
      <Text style={styles.muted}>
        ※ 반복 일정(RRULE)이 많은 캘린더면, 더 완전한 파서로 확장할 수 있어요.
      </Text>
      {Platform.OS === "web" ? (
        <Text style={styles.muted}>웹은 브라우저 캐시 때문에 새로고침 반영이 늦을 수 있어요.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingTop: 40,
    paddingBottom: 24,
    alignItems: "center",
    backgroundColor: "#F6F7FB",
  },
  center: { justifyContent: "center" },
  header: {
    width: "92%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  title: { fontSize: 18, fontWeight: "800", color: "#111827" },
  rangeHint: { fontSize: 12, color: "#9CA3AF", fontWeight: "700" },
  muted: { color: "#6B7280", marginTop: 8 },

  errorBox: {
    width: "92%",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  errorTitle: { fontWeight: "900", color: "#B91C1C", marginBottom: 6 },
  errorText: { color: "#7F1D1D" },

  listCard: {
    width: "92%",
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#374151",
    marginBottom: 8,
    marginTop: 6,
  },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#4F46E5",
    marginTop: 4,
  },
  itemTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  itemMeta: { fontSize: 12, color: "#6B7280", marginTop: 3 },
  itemDesc: { fontSize: 12, color: "#6B7280", marginTop: 6, lineHeight: 16 },
});
