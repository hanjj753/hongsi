// [달력] 탭 
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, RefreshControl, Pressable, Linking, Platform } from "react-native";
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import { Calendar, LocaleConfig } from 'react-native-calendars'; 

// ====== [설정] ======
const PUBLIC_ICAL_URL =
  "https://api.allorigins.win/raw?url=" +
  encodeURIComponent(
    "https://calendar.google.com/calendar/ical/ee197c570de2b714564a3288488f091adbab80f38f76d63a7a11c76484868b6a%40group.calendar.google.com/public/basic.ics"
  );

// 표시 범위 (데이터 로드용)
const RANGE_PAST_DAYS = 30; 
const RANGE_FUTURE_DAYS = 90;

// 한글 달력 설정
LocaleConfig.locales['kr'] = {
  monthNames: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
  monthNamesShort: ['1.','2.','3.','4.','5.','6.','7.','8.','9.','10.','11.','12.'],
  dayNames: ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'],
  dayNamesShort: ['일','월','화','수','목','금','토'],
  today: "오늘"
};
LocaleConfig.defaultLocale = 'kr';

function getLocalDateString(isoString: string) {
  const d = new Date(isoString);
  // 로컬 시간 기준으로 연/월/일 추출
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- (이하 파싱 로직은 친구분 코드 그대로 유지) ---
type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
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

function formatTimeHM(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
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

function unfoldIcsLines(ics: string) {
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
  const v = value.trim();
  if (/^\d{8}$/.test(v)) {
    const y = v.slice(0, 4), m = v.slice(4, 6), d = v.slice(6, 8);
    return { iso: new Date(`${y}-${m}-${d}T00:00:00`).toISOString(), allDay: true };
  }
  if (/^\d{8}T\d{6}Z$/.test(v)) {
    const y = v.slice(0, 4), m = v.slice(4, 6), d = v.slice(6, 8);
    const hh = v.slice(9, 11), mm = v.slice(11, 13), ss = v.slice(13, 15);
    return { iso: new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`).toISOString(), allDay: false };
  }
  if (/^\d{8}T\d{6}$/.test(v)) {
    const y = v.slice(0, 4), m = v.slice(4, 6), d = v.slice(6, 8);
    const hh = v.slice(9, 11), mm = v.slice(11, 13), ss = v.slice(13, 15);
    return { iso: new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`).toISOString(), allDay: false };
  }
  return null;
}

function parseIcsEvents(ics: string): CalEvent[] {
  const lines = unfoldIcsLines(ics);
  const events: CalEvent[] = [];
  let inEvent = false;
  let cur: any = {};

  const commit = () => {
    if (!cur.dtStartRaw) return;
    const startParsed = parseIcsDate(cur.dtStartRaw);
    const endParsed = cur.dtEndRaw ? parseIcsDate(cur.dtEndRaw) : null;
    if (!startParsed) return;
    let startIso = startParsed.iso;
    let endIso = endParsed?.iso;
    if (!endIso) {
      const st = new Date(startIso);
      st.setHours(st.getHours() + 1);
      endIso = st.toISOString();
    }
    const allDay = Boolean(startParsed.allDay);
    events.push({
      id: cur.uid || `${cur.title}-${startIso}`,
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
    if (line === "BEGIN:VEVENT") { inEvent = true; cur = {}; continue; }
    if (line === "END:VEVENT") { if (inEvent) commit(); inEvent = false; cur = {}; continue; }
    if (!inEvent) continue;
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
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export default function CalendarScreen() {
  
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  
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
    if (!PUBLIC_ICAL_URL) throw new Error("PUBLIC_ICAL_URL 설정 필요");

    const url = `${PUBLIC_ICAL_URL}${PUBLIC_ICAL_URL.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ICS 불러오기 실패: ${res.status}`);

    const ics = await res.text();
    const parsed = parseIcsEvents(ics);
    const clamped = clampRange(parsed, timeRange.min, timeRange.max);
    setEvents(clamped);
  }, [timeRange]);

  useEffect(() => {
    (async () => {
      try { await load(); } catch (e: any) { setEvents([]); setError(e?.message); } finally { setLoading(false); }
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } catch (e: any) { setError(e?.message); } finally { setRefreshing(false); }
  };

  // [변환] iCal 데이터 -> 캘린더용 markedDates 변환
  const markedDates = useMemo(() => {
    const marks: any = {};
    
    events.forEach(ev => {
      const dateStr = getLocalDateString(ev.start); // YYYY-MM-DD
      
      // 해당 날짜에 점(dot) 찍기
      if (!marks[dateStr]) {
        marks[dateStr] = { marked: true, dots: [] };
      }
      // 점은 하루에 최대 3개까지만 표시 (UI 깨짐 방지)
      if (marks[dateStr].dots && marks[dateStr].dots.length < 3) {
         marks[dateStr].dots.push({ color: '#4F46E5' });
      }
    });

    // 선택된 날짜 스타일 덮어쓰기
    if (selectedDate) {
      marks[selectedDate] = {
        ...(marks[selectedDate] || {}),
        selected: true,
        selectedColor: '#4F46E5',
        disableTouchEvent: true
      };
    }
    return marks;
  }, [events, selectedDate]);

  // [필터] 선택된 날짜의 일정만 필터링
  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return events.filter(e => getLocalDateString(e.start) === selectedDate);
  }, [events, selectedDate]);


  const openEvent = async (ev: CalEvent) => {
    if (ev.url) { await Linking.openURL(ev.url); return; }
    const m = (ev.description || "").match(/https?:\/\/\S+/);
    if (m?.[0]) await Linking.openURL(m[0]);
  };

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#4F46E5" />
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
        <Text style={styles.title}>공용 달력</Text>
      </View>

      <View style={styles.calendarWrapper}>
        <Calendar
          current={selectedDate}
          onDayPress={(day: any) => setSelectedDate(day.dateString)}
          markedDates={markedDates}
          markingType={'multi-dot'} // 점 여러 개 찍기 지원
          theme={{
            selectedDayBackgroundColor: '#4F46E5',
            todayTextColor: '#4F46E5',
            arrowColor: '#4F46E5',
            dotColor: '#4F46E5',
          }}
          style={{ borderRadius: 12 }}
        />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.listSection}>
        <Text style={styles.sectionTitle}>
          {selectedDate} 일정 ({selectedDayEvents.length}개)
        </Text>

        {selectedDayEvents.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.muted}>일정이 없습니다.</Text>
          </View>
        ) : (
          selectedDayEvents.map((ev) => (
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
            </Pressable>
          ))
        )}
      </View>

      <Text style={[styles.muted, { marginTop: 20, textAlign: 'center' }]}>
        공용 구글 캘린더 (iCal) 데이터를 표시합니다.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingTop: 40, paddingBottom: 40, backgroundColor: "#F6F7FB", alignItems: "center" },
  center: { justifyContent: "center" },
  header: { width: "92%", flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 15 },
  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
  muted: { color: "#6B7280", fontSize: 13 },
  calendarWrapper: { width: "92%", backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", elevation: 2, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 10, marginBottom: 20 },
  listSection: { width: "92%" },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#374151", marginBottom: 10, marginLeft: 4 },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#fff", marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4F46E5", marginTop: 6 },
  itemTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  itemMeta: { fontSize: 13, color: "#6B7280", marginTop: 4 },
  itemDesc: { fontSize: 12, color: "#9CA3AF", marginTop: 6 },
  errorBox: { width: "92%", padding: 10, backgroundColor: "#FEE2E2", borderRadius: 8, marginBottom: 10 },
  errorText: { color: "#991B1B" },
  emptyBox: { padding: 20, alignItems: "center", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", borderStyle: 'dashed' },
});