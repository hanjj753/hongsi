// [달력] 탭
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, RefreshControl, Pressable, Linking } from "react-native";
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { Picker } from '../../components/ReadablePicker';
import { useRouter } from 'expo-router';
import { isSupabaseDataSource } from '../../config/dataSource';
import { getSupabaseCalendarWorkspace } from '../../lib/calendarData';

import { fetchSheetData } from "../../utils/googleSheet_csv";
import { CSV_URLS, SCHEDULE_HEADERS, ASSISTANT_HEADERS, CLASSES_HEADERS } from "../../config/sheetConfig";


// ====== [설정] ======
// 🚨 [주석 처리] 외부 iCal 패치는 불안정하여 잠시 중단합니다.
/*
const PUBLIC_ICAL_URL =
  "https://api.allorigins.win/raw?url=" +
  encodeURIComponent(
    "https://calendar.google.com/calendar/ical/ee197c570de2b714564a3288488f091adbab80f38f76d63a7a11c76484868b6a%40group.calendar.google.com/public/basic.ics"
  );
*/

const CLASS_COLORS = [
  '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', 
  '#EF4444', '#6366F1', '#14B8A6', '#F97316', '#84CC16'
];

const getClassColor = (classId: string, index: number) => {
  return CLASS_COLORS[index % CLASS_COLORS.length];
};

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
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type CalEvent = {
  id: string; title: string; start: string; end: string; allDay: boolean; location?: string; description?: string; url?: string;
  type: 'ical' | 'class'; 
  classId?: string;
  quarter?: string; // 필터링용 분기 추가
  color?: string;
  workers?: string;
  eventDate?: string;
};

// ... (헬퍼 함수들: addDays, formatTimeHM 등 기존 유지) ...
function addDays(date: Date, days: number) {
  const d = new Date(date); d.setDate(d.getDate() + days); return d;
}
function formatTimeHM(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
// (iCal 파싱 함수들은 주석 처리된 URL 때문에 당장 안 쓰이지만, 나중을 위해 코드는 남겨둡니다)
// ...

export default function CalendarScreen() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(getLocalDateString(new Date().toISOString()));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2단계 필터링 상태
  // 1. 전체 수업 메타데이터 저장: [{id, name, day, quarter}, ...]
  const [allClasses, setAllClasses] = useState<{id: string, name: string, day: string, quarter: string}[]>([]);
  
  // 2. 선택된 필터값
  const [selectedQuarter, setSelectedQuarter] = useState<string>("ALL");
  const [selectedClassId, setSelectedClassId] = useState<string>("ALL");

  const [activeAssistants, setActiveAssistants] = useState<string[]>([]); // 현역 조교 이름 목록
  const [selectedAssistants, setSelectedAssistants] = useState<string[]>([]); // 체크된 조교들

  const load = useCallback(async () => {
    setError(null);
    try {
      if (isSupabaseDataSource) {
        const workspace = await getSupabaseCalendarWorkspace();
        setActiveAssistants(workspace.assistants);
        setAllClasses(workspace.classes);
        const quarters = [...new Set(workspace.classes.map((item) => item.quarter))].sort().reverse();
        setSelectedQuarter((current) => quarters.includes(current) ? current : quarters[0] ?? 'ALL');
        const ids = workspace.classes.map((item) => item.id).sort();
        setEvents(workspace.events.map((item) => ({
          ...item, type: 'class' as const, eventDate: item.date,
          color: getClassColor(item.classId, ids.indexOf(item.classId)),
        })).sort((a, b) => a.start.localeCompare(b.start)));
        return;
      }
      let icalEvents: CalEvent[] = []; // iCal 로직 생략

      const aData = await fetchSheetData(CSV_URLS.ASSISTANT_INFO);
      if (Array.isArray(aData)) {
        const actives = aData
          .filter((r: any) => {
            const status = String(r[ASSISTANT_HEADERS.STATUS] || "");
            const position = String(r[ASSISTANT_HEADERS.POSITION] || ""); // 직책 확인
            
            return (
              !status.includes("비근무") && 
              !position.includes("CEO") && 
              !position.includes("실장")
            );
          })
          .map((r: any) => String(r[ASSISTANT_HEADERS.NAME] || "").trim())
          .filter(Boolean)
          .sort(); // 가나다순 정렬
        setActiveAssistants(actives);
      }

      const classDetails = new Map<string, { start: string, end: string, place: string }>();
      const cData = await fetchSheetData(CSV_URLS.CLASSES);
      
      if (Array.isArray(cData)) {
        cData.forEach((row: any) => {
          const cid = String(row[CLASSES_HEADERS.CLASS_ID] ?? "").trim();
          if (!cid) return;
          
          classDetails.set(cid, {
            start: String(row[CLASSES_HEADERS.CLASS_START] ?? "").trim(),
            end: String(row[CLASSES_HEADERS.CLASS_END] ?? "").trim(),
            place: String(row[CLASSES_HEADERS.PLACE] ?? "").trim(),
          });
        });
      }

      let sheetEvents: CalEvent[] = [];
      const classInfoMap = new Map<string, {name: string, day: string, quarter: string}>();
      const sData = await fetchSheetData(CSV_URLS.CLASS_SCHEDULES); 
      
      if (Array.isArray(sData)) {
        // 색상 매핑을 위해 클래스 ID 수집용 Set
        const uniqueClassIds = new Set<string>();

        // 1차 순회: ID 수집 (색상 할당 순서 고정용)
        sData.forEach((row: any) => {
          const cid = String(row[SCHEDULE_HEADERS.CLASS_ID] ?? "").trim();
          if (cid) uniqueClassIds.add(cid);
        });
        const classIdList = Array.from(uniqueClassIds).sort(); // 정렬하여 인덱스 고정

        // 2차 순회: 데이터 파싱
        sData.forEach((row: any, idx: number) => {
          const dateStr = String(row[SCHEDULE_HEADERS.DATE] ?? "").trim(); 
          if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return;

          const cid = String(row[SCHEDULE_HEADERS.CLASS_ID] ?? "").trim();
          const cname = String(row[SCHEDULE_HEADERS.CLASS_NAME] ?? "수업").trim();
          const quarter = String(row[SCHEDULE_HEADERS.QUARTER] ?? "").trim();
          const day = String(row[SCHEDULE_HEADERS.DAY] ?? "").trim();
          const session = String(row[SCHEDULE_HEADERS.SESSION] ?? "").trim();
          const note = String(row[SCHEDULE_HEADERS.NOTE] ?? "").trim();
          const workers = String(row[SCHEDULE_HEADERS.WORKERS] ?? "-").trim();

          if (cid && !classInfoMap.has(cid)) {
            classInfoMap.set(cid, { name: cname, day, quarter });
          }

          const detail = classDetails.get(cid) || { start: "", end: "", place: "" };
          let startIso = new Date(dateStr).toISOString(); // 기본값 (00:00)
          let endIso = new Date(dateStr).toISOString();
          let isAllDay = true;

          if (detail.start && detail.end) {
            // "2026-02-05"와 "14:00"을 합쳐서 Date 객체 생성
            const [y, m, d] = dateStr.split('-').map(Number);
            const [sh, sm] = detail.start.split(':').map(Number);
            const [eh, em] = detail.end.split(':').map(Number);

            // 로컬 시간 기준으로 Date 생성 후 ISO 변환
            const startDate = new Date(y, m - 1, d, sh, sm);
            const endDate = new Date(y, m - 1, d, eh, em);
            
            startIso = startDate.toISOString();
            endIso = endDate.toISOString();
            isAllDay = false; // 시간이 있으므로 종일 아님
          }

          // 2) 장소/설명 합치기
          // note(설명)가 있으면 우선 표시하고, 장소 정보가 있으면 뒤에 붙임
          let locationStr = note;
          if (detail.place) {
            locationStr = locationStr ? `${locationStr} / 장소 : ${detail.place}` : detail.place;
          }
          
          // 색상 결정
          const colorIndex = classIdList.indexOf(cid);
          const assignedColor = getClassColor(cid, colorIndex >= 0 ? colorIndex : 0);

          // 제목 변경: "수업명 요일 (차시)"
          const titleStr = `${cname} ${day} ${session ? `(${session}차시)` : ''}`;

          sheetEvents.push({
            id: `sheet-${cid}-${idx}`,
            title: titleStr, 
            start: startIso,
            end: endIso,
            allDay: isAllDay,
            location: locationStr,
            description: `예정 근무자: ${String(row[SCHEDULE_HEADERS.WORKERS] ?? "-")}`,
            workers: workers,
            type: 'class',
            classId: cid,
            quarter: quarter,
            color: assignedColor // 색상 저장
          });
        });
      }

      const classMetaList = Array.from(classInfoMap.entries()).map(([id, info]) => ({ id, ...info }));
      setAllClasses(classMetaList);

      if (classMetaList.length > 0) {
        const quarters = Array.from(new Set(classMetaList.map(c => c.quarter))).sort().reverse();
        setSelectedQuarter(prev => (quarters.includes(prev) ? prev : quarters[0]));
      }

      const combined = [...icalEvents, ...sheetEvents];
      combined.sort((a, b) => a.start.localeCompare(b.start));
      setEvents(combined);

    } catch (e: any) {
      console.error(e);
      setError(e?.message || "일정을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    (async () => { try { await load(); } finally { setLoading(false); } })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const quarterOptions = useMemo(() => {
    const unique = Array.from(new Set(allClasses.map(c => c.quarter))).filter(Boolean);
    return unique.sort().reverse();
  }, [allClasses]);

  const classOptions = useMemo(() => {
    if (!selectedQuarter) return [];
    const filtered = allClasses.filter(c => c.quarter === selectedQuarter);
    filtered.sort((a, b) => {
      const nameDiff = a.name.localeCompare(b.name);
      if (nameDiff !== 0) return nameDiff;
      return a.day.localeCompare(b.day);
    });
    return filtered.map(c => ({
      label: isSupabaseDataSource ? c.name : `${c.name} ${c.day}`,
      value: c.id
    }));
  }, [allClasses, selectedQuarter]);

  // 분기가 바뀌면 수업 선택 초기화 (전체 보기로)
  useEffect(() => { setSelectedClassId("ALL"); }, [selectedQuarter]);

  const isWorkerMatched = (ev: CalEvent) => {
    // 1. 선택된 조교가 없으면 -> 모두 보여줌 (필터 해제 상태)
    if (selectedAssistants.length === 0) return true;
    
    // 2. 수업에 근무자 정보가 없으면 -> 숨김
    if (!ev.workers || ev.workers === "-") return false;

    // 3. 콤마로 구분된 근무자 이름들을 배열로 분리 (예: "홍길동, 김철수" -> ["홍길동", "김철수"])
    const eventWorkers = ev.workers.split(",").map(w => w.trim());

    // 4. 선택된 조교 중 한 명이라도 이 수업 근무자 명단에 있는지 확인 (OR 조건)
    return selectedAssistants.some(selectedName => eventWorkers.includes(selectedName));
  };

  const markedDates = useMemo(() => {
    const marks: any = {};
    
    events.forEach(ev => {
      if (ev.type === 'class') {
        if (ev.quarter !== selectedQuarter) return;
        if (selectedClassId !== "ALL" && ev.classId !== selectedClassId) return;
        if (!isWorkerMatched(ev)) return;
      }

      const dateStr = ev.eventDate ?? getLocalDateString(ev.start);
      if (!marks[dateStr]) marks[dateStr] = { marked: true, dots: [] };
      
      // 색상 선택: 특정 수업 선택 시엔 주황색 고정, "전체 수업" 시엔 각 수업 고유 색상
      let dotColor = '#4F46E5'; // 기본(iCal)
      if (ev.type === 'class') {
        if (selectedClassId !== "ALL") {
          dotColor = '#F59E0B'; // 단일 수업 선택: 주황색
        } else {
          dotColor = ev.color || '#F59E0B'; // 전체 보기: 수업별 고유 색상
        }
      }

      const existingDots = marks[dateStr].dots;
      const hasSameColor = existingDots.some((d: any) => d.color === dotColor);
      
      if (!hasSameColor && existingDots.length < 3) {
        marks[dateStr].dots.push({ color: dotColor });
      }
    });

    if (selectedDate) {
      marks[selectedDate] = { ...(marks[selectedDate] || {}), selected: true, selectedColor: '#4F46E5', disableTouchEvent: true };
    }
    return marks;
  }, [events, selectedDate, selectedQuarter, selectedClassId, selectedAssistants]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return events.filter(e => {
      if ((e.eventDate ?? getLocalDateString(e.start)) !== selectedDate) return false;
      if (e.type === 'class') {
        if (e.quarter !== selectedQuarter) return false;
        if (selectedClassId !== "ALL" && e.classId !== selectedClassId) return false;
        if (!isWorkerMatched(e)) return false;
      }
      return true;
    });
  }, [events, selectedDate, selectedQuarter, selectedClassId, selectedAssistants]);

  const filteredClassEvents = useMemo(() => {
    return events.filter(e => {
      if (e.type !== 'class') return false; // 수업 일정만 대상
      if (e.quarter !== selectedQuarter) return false;
      if (selectedClassId !== "ALL" && e.classId !== selectedClassId) return false;
      if (!isWorkerMatched(e)) return false;
      return true;
    }).sort((a, b) => a.start.localeCompare(b.start));
  }, [events, selectedQuarter, selectedClassId, selectedAssistants]);

  const groupedClassEvents = useMemo(() => {
    const groups: { [key: string]: CalEvent[] } = {};
    
    filteredClassEvents.forEach(ev => {
      const cId = ev.classId || "기타";
      if (!groups[cId]) groups[cId] = [];
      groups[cId].push(ev);
    });
    return groups;
  }, [filteredClassEvents]);

  const getClassNameById = (id: string) => {
    return allClasses.find(c => c.id === id)?.name || "수업";
  };

  const toggleAssistant = (name: string) => {
    setSelectedAssistants(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name);
      return [...prev, name];
    });
  };

  const openEvent = async (ev: CalEvent) => {
    if (isSupabaseDataSource && ev.classId && ev.id.startsWith('session-')) {
      router.push({ pathname: '/session/[id]', params: { id: ev.id.slice(8), classId: ev.classId, title: ev.title } });
      return;
    }
    if (ev.url) { await Linking.openURL(ev.url); return; }
    const m = (ev.description || "").match(/https?:\/\/\S+/);
    if (m?.[0]) await Linking.openURL(m[0]);
  };

  if (loading && !refreshing) return <View style={[styles.container, styles.center]}><ActivityIndicator size="large" color="#4F46E5" /></View>;

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      
      <View style={styles.headerColumn}>
        <View style={styles.headerRow}>
          <FontAwesome5 name="calendar-check" size={24} color="#111827" />
          <Text style={styles.title}>전체 일정</Text>
        </View>

        <Text style={styles.label}>분기 선택</Text>
        <View style={[styles.pickerContainer, { marginBottom: 12 }]}>
          <Picker
            selectedValue={selectedQuarter}
            onValueChange={setSelectedQuarter}
            style={styles.picker}
            dropdownIconColor="#4F46E5"
            mode="dropdown"
          >
            {quarterOptions.map(q => <Picker.Item key={q} label={`${q}`} value={q} />)}
          </Picker>
        </View>

        <Text style={styles.label}>수업 선택</Text>
        <View style={styles.pickerContainer}>
          <Picker
            selectedValue={selectedClassId}
            onValueChange={setSelectedClassId}
            style={styles.picker}
            dropdownIconColor="#4F46E5"
            mode="dropdown"
            enabled={classOptions.length > 0}
          >
          <Picker.Item label="전체 수업" value="ALL" />
            {classOptions.map(c => <Picker.Item key={c.value} label={c.label} value={c.value} />)}
          </Picker>
        </View>
        <View style={{ width: '92%', marginTop: 12, marginBottom: 5 }}>
          <Text style={styles.label}>근무자 필터 (현역 조교)</Text>
          
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            
            {/* '전체' 버튼 */}
            <Pressable 
              style={[styles.chip, selectedAssistants.length === 0 && styles.chipActive]} 
              onPress={() => setSelectedAssistants([])}
            >
              <Text style={[styles.chipText, selectedAssistants.length === 0 && styles.chipTextActive]}>전체</Text>
            </Pressable>

            {/* 조교 목록 */}
            {activeAssistants.map((name, idx) => {
              const isSelected = selectedAssistants.includes(name);
              return (
                <Pressable 
                  key={`${name}-${idx}`} 
                  style={[styles.chip, isSelected && styles.chipActive]} 
                  onPress={() => toggleAssistant(name)}
                >
                  <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View style={styles.calendarWrapper}>
        <Calendar
          current={selectedDate}
          onDayPress={(day: any) => setSelectedDate(day.dateString)}
          markedDates={markedDates}
          markingType={'multi-dot'}
          theme={{ selectedDayBackgroundColor: '#4F46E5', todayTextColor: '#4F46E5', arrowColor: '#4F46E5', dotColor: '#4F46E5' }}
          style={{ borderRadius: 12 }}
        />
      </View>

      {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

      <View style={styles.listSection}>
        <Text style={styles.sectionTitle}>{selectedDate} 일정 ({selectedDayEvents.length}개)</Text>
        {selectedDayEvents.length === 0 ? (
          <View style={styles.emptyBox}><Text style={styles.muted}>일정이 없습니다.</Text></View>
        ) : (
          selectedDayEvents.map((ev, i) => (
            <Pressable key={i} onPress={() => openEvent(ev)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]}>
              <View style={[styles.dot, { 
                backgroundColor: (selectedClassId !== "ALL" && ev.type === 'class') ? '#F59E0B' : (ev.color || '#4F46E5') 
              }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{ev.title}</Text>
                <Text style={styles.itemMeta}>
                  {ev.allDay ? "" : `시간 : ${formatTimeHM(ev.start)} ~ ${formatTimeHM(ev.end)} / `}
                  {ev.location ? `${ev.location}` : ""}
                </Text>
                {!!ev.description && <Text style={styles.itemDesc} numberOfLines={2}>{ev.description}</Text>}
              </View>
            </Pressable>
          ))
        )}
      </View>

      <View style={{ width: '92%', height: 1, backgroundColor: '#E5E7EB', marginVertical: 24 }} />

      <View style={styles.listSection}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <FontAwesome5 name="list" size={16} color="#374151" style={{ marginRight: 6 }} />
            <Text style={[styles.sectionTitle, { marginBottom: 0, marginLeft: 0 }]}>
              {selectedQuarter} 수업 일정
            </Text>
        </View>

        {filteredClassEvents.length === 0 ? (
            <Text style={[styles.muted, { textAlign: 'center', marginVertical: 10 }]}>등록된 수업 일정이 없습니다.</Text>
        ) : (
            Object.keys(groupedClassEvents).map(cId => (
            <View key={cId} style={{ marginBottom: 20 }}>
                {/* 그룹 헤더 (수업명) */}
                <Text style={styles.groupHeader}>{getClassNameById(cId)}</Text>
                
                {groupedClassEvents[cId].map((ev, i) => (
                <Pressable key={i} onPress={() => openEvent(ev)} style={({ pressed }) => [styles.item, styles.itemCompact, pressed && { opacity: 0.85 }]}>
                    {/* 날짜 뱃지 */}
                    <Text style={styles.dateBadge}>{(ev.eventDate ?? getLocalDateString(ev.start)).slice(5)}</Text>
                    
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{ev.title}</Text>
                      
                      {/* 장소/비고 */}
                      {!!ev.location && (
                        <Text style={styles.itemMeta}>{ev.location}</Text>
                      )}
                      
                      {!!ev.description && (
                        <Text style={[styles.itemDesc, { marginTop: 2 }]}>
                          {ev.description}
                        </Text>
                      )}
                    </View>
                </Pressable>
                ))}
            </View>
            ))
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingTop: 20, paddingBottom: 40, backgroundColor: "#F6F7FB", alignItems: "center" },
  center: { justifyContent: "center" },
  headerColumn: { width: "92%", marginBottom: 15 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
  
  label: { fontSize: 12, color: "#6B7280", fontWeight: "700", marginBottom: 6, marginLeft: 2 },
  pickerContainer: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', overflow: 'hidden', height: 56, justifyContent: 'center' },
  picker: { width: '100%', height: 56 },

  muted: { color: "#6B7280", fontSize: 13 },
  calendarWrapper: { width: "92%", backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", elevation: 2, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 10, marginBottom: 20 },
  listSection: { width: "92%" },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#374151", marginBottom: 10, marginLeft: 4 },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#fff", marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  itemTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  itemMeta: { fontSize: 13, color: "#6B7280", marginTop: 4 }, // "종일" 제거로 빈칸이 될 수 있음
  itemDesc: { fontSize: 12, color: "#9CA3AF", marginTop: 6 },
  errorBox: { width: "92%", padding: 10, backgroundColor: "#FEE2E2", borderRadius: 8, marginBottom: 10 },
  errorText: { color: "#991B1B" },
  emptyBox: { padding: 20, alignItems: "center", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", borderStyle: 'dashed' },

  groupHeader: { fontSize: 14, fontWeight: "800", color: "#4F46E5", marginTop: 10, marginBottom: 8, paddingLeft: 4, borderLeftWidth: 3, borderLeftColor: "#4F46E5", paddingVertical: 2 },
  itemCompact: { paddingVertical: 12, paddingHorizontal: 14, gap: 10, alignItems: 'center' },
  dateBadge: { fontSize: 12, fontWeight: "700", color: "#6B7280", width: 40, textAlign: 'center' },

  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB",},
  chipActive: { backgroundColor: "#4F46E5", borderColor: "#4F46E5", },
  chipText: { fontSize: 13, fontWeight: "600", color: "#4B5563",},
  chipTextActive: { color: "#fff", },
});