// [수업] 탭
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Platform, Modal, Linking } from "react-native";
import { useRouter } from 'expo-router';
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import { Picker } from "@react-native-picker/picker";
import { useFocusEffect } from "@react-navigation/native";

// Utils
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { CSV_URLS, CLASSES_HEADERS, POSITIONS_HEADERS } from "../../config/sheetConfig";
import { getActiveSession, ActiveSession } from "../../utils/activeSession";

export default function ClassScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [didAutoPick, setDidAutoPick] = useState(false);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("ALL");

  // 위치 정보 State
  const [positions, setPositions] = useState<any[]>([]);
  const [mapModalVisible, setMapModalVisible] = useState(false);

  useFocusEffect(useCallback(() => {
    (async () => { setActiveSession(await getActiveSession()); })();
  }, []));

  const load = useCallback(async () => {
    const tryFetch = async () => {
      const [cData, pData] = await Promise.all([
        fetchSheetData(`${CSV_URLS.CLASSES}&t=${Date.now()}`),
        fetchSheetData(CSV_URLS.POSITIONS)
      ]);
      return {
        classes: (cData || []).filter((r:any) => r && String(r[CLASSES_HEADERS.CLASS_ID] ?? "").trim() !== ""),
        positions: pData || []
      };
    };

    try {
      let data = await tryFetch();
      if (data.classes.length === 0) {
        await new Promise((res) => setTimeout(res, 600));
        data = await tryFetch();
      }
      setRows(data.classes);
      setPositions(data.positions);
    } catch (e: any) {
      setRows([]);
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

  // 지도 앱 열기 핸들러
  const openMap = async (placeName: string, coordStr?: string) => {
    let lat = "", lng = "";
    
    // 좌표 파싱 (예: "37.123, 127.123")
    if (coordStr && coordStr.includes(",")) {
      const parts = coordStr.split(",").map(s => s.trim());
      if (parts.length === 2) {
        lat = parts[0];
        lng = parts[1];
      }
    }

    // 1. 웹 (Web) 환경 -> 무조건 "검색 결과" 페이지로 이동 (새 탭)
    if (Platform.OS === 'web') {
      // 좌표가 있으면 "위도,경도"를 검색어로, 없으면 "장소명"을 검색어로 사용
      const query = (lat && lng) ? `${lat},${lng}` : placeName;
      
      // 네이버 지도 PC 버전 검색 URL
      const webUrl = `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
      
      window.open(webUrl, '_blank'); 
      setMapModalVisible(false);
      return;
    }

    // 2. 앱 (App) 환경 -> 네이버 지도 앱 / 카카오맵 앱 실행 시도
    const handleError = () => {
        // 지도 앱이 하나도 없을 경우 웹 검색 결과로 이동 (Fallback)
        const query = (lat && lng) ? `${lat},${lng}` : placeName;
        Linking.openURL(`https://map.naver.com/p/search/${encodeURIComponent(query)}`);
    };

    try {
      if (lat && lng) {
        // [A] 좌표 있음 -> "핀(Pin)" 찍기 모드
        const naverApp = `nmap://place?lat=${lat}&lng=${lng}&name=${encodeURIComponent(placeName)}&appname=com.myapp`;
        const kakaoApp = `kakaomap://look?p=${lat},${lng}`;
        
        const canNaver = await Linking.canOpenURL(naverApp);
        if (canNaver) {
            await Linking.openURL(naverApp);
        } else {
            const canKakao = await Linking.canOpenURL(kakaoApp);
            if (canKakao) {
                await Linking.openURL(kakaoApp);
            } else {
                handleError(); // 둘 다 없으면 웹으로
            }
        }
      } else {
        // [B] 좌표 없음 -> "검색" 모드
        const naverSearch = `nmap://search?query=${encodeURIComponent(placeName)}&appname=com.myapp`;
        const kakaoSearch = `kakaomap://search?q=${encodeURIComponent(placeName)}`;

        const canNaver = await Linking.canOpenURL(naverSearch);
        if (canNaver) {
            await Linking.openURL(naverSearch);
        } else {
            const canKakao = await Linking.canOpenURL(kakaoSearch);
            if (canKakao) {
                await Linking.openURL(kakaoSearch);
            } else {
                handleError(); // 둘 다 없으면 웹으로
            }
        }
      }
    } catch (e) {
      console.warn(e);
      handleError();
    }
    
    setMapModalVisible(false);
  };

  if (loading) return <View style={[styles.container, { justifyContent: "center" }]}><ActivityIndicator /></View>;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        
        {/* 헤더 영역 */}
        <View style={styles.headerRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <FontAwesome5 name="chalkboard" size={24} color="#333" />
            <Text style={styles.title}>수업 목록</Text>
          </View>
          
          <Pressable 
            style={({pressed}) => [styles.mapBtn, pressed && { opacity: 0.7 }]} 
            onPress={() => setMapModalVisible(true)}
          >
            <FontAwesome5 name="map-marked-alt" size={20} color="#4F46E5" />
            <Text style={styles.mapBtnText}>위치 보기</Text>
          </Pressable>
        </View>

        {activeSession && (
          <Pressable style={styles.openShiftBanner} onPress={() => router.push({ pathname: "/class/[id]", params: { id: activeSession.classId } })}>
            <Text style={styles.openShiftTitle}>현재 출근 중</Text>
            <Text style={styles.openShiftText}>{activeSession.className} · {activeSession.startHm} 출근</Text>
            <Text style={styles.openShiftHint}>눌러서 해당 수업으로 이동</Text>
          </Pressable>
        )}

        <View style={styles.filterWrap}>
          <Text style={styles.filterLabel}>분기</Text>
          <View style={styles.pickerShell}>
            <View style={styles.pickerInner}>
              <Picker
                selectedValue={selectedQuarter}
                onValueChange={(val) => setSelectedQuarter(String(val))}
                style={[styles.picker, Platform.OS === "web" && styles.pickerWeb]}
                mode="dropdown"
              >
                {quarterOptions.map((q) => (
                  <Picker.Item key={q} label={q === "ALL" ? "전체" : q} value={q} />
                ))}
              </Picker>
            </View>
          </View>
        </View>

        {filteredRows.map((r, index) => {
          const id = String(r[CLASSES_HEADERS.CLASS_ID] ?? "");
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

      {/* 지도 선택 모달 */}
      <Modal visible={mapModalVisible} transparent animationType="fade" onRequestClose={() => setMapModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMapModalVisible(false)}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>📍 강의실 위치 찾기</Text>
              <Pressable onPress={() => setMapModalVisible(false)}>
                <FontAwesome5 name="times" size={20} color="#999" />
              </Pressable>
            </View>
            
            <Text style={styles.modalDesc}>선택하면 네이버/카카오맵으로 연결됩니다.</Text>

            <ScrollView style={{ maxHeight: 400 }}>
              {positions.length === 0 ? (
                <Text style={styles.emptyText}>등록된 위치 정보가 없습니다.</Text>
              ) : (
                positions.map((pos, idx) => {
                  const name = String(pos[POSITIONS_HEADERS.PLACE] || "");
                  const coord = String(pos[POSITIONS_HEADERS.PLACE_LOCATION] || ""); 
                  const note = String(pos[POSITIONS_HEADERS.NOTE] || ""); 

                  if (!name) return null;
                  
                  // 표시할 텍스트 조합 (좌표 / 비고)
                  let subText = coord;
                  if (note) {
                    subText = subText ? `${subText} / ${note}` : note;
                  }

                  return (
                    <Pressable 
                      key={idx} 
                      style={({pressed}) => [styles.locationItem, pressed && {backgroundColor: '#F3F4F6'}]}
                      onPress={() => openMap(name, coord)}
                    >
                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
                        <FontAwesome5 name="map-marker-alt" size={16} color="#4F46E5" style={{marginRight: 10}} />
                        <View>
                          <Text style={styles.locationText}>{name}</Text>
                          {!!subText && <Text style={{fontSize: 11, color: '#999'}}>{subText}</Text>}
                        </View>
                      </View>
                      <FontAwesome5 name="chevron-right" size={12} color="#ccc" style={{marginLeft: 'auto'}} />
                    </Pressable>
                  )
                })
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingTop: 20, alignItems: "center", paddingBottom: 24, backgroundColor: "#F6F7FB" },
  
  headerRow: { width: "92%", flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
  
  mapBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EEF2FF', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: '#C7D2FE' },
  mapBtnText: { marginLeft: 6, color: '#4F46E5', fontWeight: '700', fontSize: 13 },

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

  pickerShell: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  pickerInner: { borderRadius: 14, overflow: "hidden", position: "relative", justifyContent: 'center', height: 50, paddingRight: 12, },
  picker: { height: 50, width: "100%", color: "#111827", backgroundColor: "transparent", borderWidth: 0 },
  pickerWeb: { outlineStyle: "none", outlineWidth: 0, borderWidth: 0, paddingLeft: 15 },
  pickerChevron: { position: "absolute", right: 12, top: 0, height: 44, justifyContent: "center", alignItems: "center" },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '60%', elevation: 5 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111' },
  modalDesc: { fontSize: 13, color: '#666', marginBottom: 15 },
  locationItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f3f3' },
  locationText: { fontSize: 15, color: '#333', fontWeight: '600' },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 20 },
});