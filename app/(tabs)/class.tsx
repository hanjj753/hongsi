// [수업] 탭
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Platform, Modal, Linking, TextInput, Alert, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { useRouter } from 'expo-router';
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import { Picker } from "../../components/ReadablePicker";
import { useFocusEffect } from "@react-navigation/native";

// Utils
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { postSheetData } from "../../utils/sheetApi";
import { getCurrentUserEmail } from "../../utils/currentUser";
import { CSV_URLS, API_URLS, SHEET_NAMES, CLASSES_HEADERS, POSITIONS_HEADERS, PERMISSION_HEADERS } from "../../config/sheetConfig";
import { getActiveSession, ActiveSession } from "../../utils/activeSession";
import { isSupabaseDataSource } from "../../config/dataSource";
import { deleteSupabaseLocation, getSupabaseClasses, getSupabaseLocations, saveSupabaseLocation } from "../../lib/classData";
import { useAppAccess } from "../../contexts/AppAccessContext";
import { TermClassManager } from "../../components/TermClassManager";
import { AllStudentRecords } from "../../components/AllStudentRecords";
import { getOpenWorkLog, type WorkLog } from "../../lib/staffData";

export default function ClassScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const { access } = useAppAccess();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [supabaseOpenShift, setSupabaseOpenShift] = useState<WorkLog | null>(null);
  const [didAutoPick, setDidAutoPick] = useState(false);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("ALL");

  // 권한 및 관리 상태
  const [legacyIsAdmin, setLegacyIsAdmin] = useState(false);
  const [legacyIsManager, setLegacyIsManager] = useState(false);
  const isAdmin = isSupabaseDataSource ? access?.app_role === 'admin' : legacyIsAdmin;
  const isManager = isSupabaseDataSource ? access?.app_role === 'manager' : legacyIsManager;

  // 위치 정보 State
  const [positions, setPositions] = useState<any[]>([]);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editPlace, setEditPlace] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editLocationId, setEditLocationId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    if (isSupabaseDataSource) {
      if (access?.staff_id) getOpenWorkLog(String(access.staff_id))
        .then((log) => { if (active) setSupabaseOpenShift(log); })
        .catch((cause) => { if (active) setLoadError(cause?.message || '출근 상태를 불러오지 못했습니다.'); });
    } else {
      getActiveSession().then((session) => { if (active) setActiveSession(session); });
    }
    return () => { active = false; };
  }, [access?.staff_id]));

  const load = useCallback(async () => {
    try {
      setLoadError("");
      if (isSupabaseDataSource) {
        const [cData, pData] = await Promise.all([getSupabaseClasses(), getSupabaseLocations()]);
        setRows(cData);
        setPositions(pData);
        return;
      }

      const [cData, pData, permData] = await Promise.all([
        fetchSheetData(`${CSV_URLS.CLASSES}&t=${Date.now()}`),
        fetchSheetData(`${CSV_URLS.POSITIONS}&t=${Date.now()}`),
        fetchSheetData(CSV_URLS.PERMISSIONS)
      ]);

      setRows((cData || []).filter((r:any) => r && String(r[CLASSES_HEADERS.CLASS_ID] ?? "").trim() !== ""));
      setPositions(pData || []);

      // 권한 체크
      const myEmail = getCurrentUserEmail();
      if (myEmail && Array.isArray(permData)) {
        const myRecord = permData.find((r: any) =>
          String(r[PERMISSION_HEADERS.EMAIL] || "").trim().toLowerCase() === myEmail.trim().toLowerCase()
        );
        if (myRecord) {
          const role = String(myRecord[PERMISSION_HEADERS.ROLE] || "").trim();
          setLegacyIsAdmin(role === 'Admin');
          setLegacyIsManager(role === 'Manager');
        }
      }
    } catch (e: any) {
      console.error(e);
      setLoadError(e?.message || "수업 정보를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    (async () => { try { await load(); } finally { setLoading(false); } })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
      if (isSupabaseDataSource) {
        setSupabaseOpenShift(access?.staff_id ? await getOpenWorkLog(String(access.staff_id)) : null);
      } else setActiveSession(await getActiveSession());
    } finally { setRefreshing(false); }
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      // 웹에서는 브라우저 기본 알림창 사용
      window.alert(`${title}\n\n${message}`);
    } else {
      // 앱에서는 기존 Alert 사용
      Alert.alert(title, message);
    }
  };

  // 장소 저장 (추가/수정) 핸들러
  const handleSaveLocation = async () => {
    if (!editPlace.trim() || !editLocation.trim()) {
      showAlert("알림", "장소명과 좌표를 입력해주세요.");
      return;
    }

    setSaving(true);
    try {
      if (isSupabaseDataSource) {
        const coordinates = editLocation.split(',').map((part) => Number(part.trim()));
        if (coordinates.length !== 2 || coordinates.some((value) => !Number.isFinite(value))
          || coordinates[0] < -90 || coordinates[0] > 90 || coordinates[1] < -180 || coordinates[1] > 180) {
          showAlert("입력 확인", "좌표를 '위도, 경도' 형식으로 입력해 주세요.");
          return;
        }
        await saveSupabaseLocation({
          id: editLocationId,
          name: editPlace.trim(),
          latitude: coordinates[0],
          longitude: coordinates[1],
          notes: editNote.trim(),
        });
        showAlert("성공", isEditMode ? "수정되었습니다." : "추가되었습니다.");
        setEditModalVisible(false);
        await load();
        return;
      }

      const action = isEditMode ? "update_location" : "add_location";
      const payload = {
        action,
        place: editPlace.trim(),
        location: editLocation.trim(),
        note: editNote.trim()
      };

      const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.POSITIONS, payload);

      if (res.ok) {
        showAlert("성공", isEditMode ? "수정되었습니다." : "추가되었습니다.");
        setEditModalVisible(false);
        load();
      } else {
        showAlert("실패", res.error || "문제가 발생했습니다.");
      }
    } catch (e) {
      console.error(e);
      showAlert("오류", "전송 중 문제가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  // 장소 삭제 핸들러
  const handleDeleteLocation = (placeName: string) => {

    const processDelete = async () => {
      setSaving(true);
      try {
        if (isSupabaseDataSource) {
          if (!editLocationId) throw new Error('삭제할 장소 ID를 찾을 수 없습니다.');
          await deleteSupabaseLocation(editLocationId);
          showAlert("완료", "장소를 삭제했습니다.");
          setEditModalVisible(false);
          await load();
          return;
        }
        const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.POSITIONS, {
          action: "delete_location",
          place: placeName
        });
        if (res.ok) {
          showAlert("완료", "삭제되었습니다.");
          setEditModalVisible(false); // 삭제 성공 시 수정 모달 닫기
          load(); // 데이터 새로고침
        } else {
          showAlert("실패", res.error || "문제가 발생했습니다.");
        }
      } catch (e: any) {
        console.error(e);
        showAlert("오류", e?.code === '23503' ? "이 장소를 사용하는 수업 또는 일정이 있어 삭제할 수 없습니다." : (e?.message || "삭제 중 오류가 발생했습니다."));
      } finally {
        setSaving(false);
      }
    };

    // 웹 환경을 위한 confirm 처리
    if (Platform.OS === 'web') {
      if (window.confirm(`[${placeName}] 장소를 삭제하시겠습니까?`)) {
        processDelete();
      }
    } else {
      Alert.alert("삭제 확인", `[${placeName}] 장소를 삭제하시겠습니까?`, [
        { text: "취소", style: "cancel" },
        { text: "삭제", style: "destructive", onPress: processDelete }
      ]);
    }
  };

  // 수정 모달 열기
  const openEditModal = (item?: any) => {
    if (item) {
      setIsEditMode(true);
      setEditLocationId(item.__dbId ? String(item.__dbId) : undefined);
      setEditPlace(String(item[POSITIONS_HEADERS.PLACE] || ""));
      setEditLocation(String(item[POSITIONS_HEADERS.PLACE_LOCATION] || ""));
      setEditNote(String(item[POSITIONS_HEADERS.NOTE] || ""));
    } else {
      setIsEditMode(false);
      setEditLocationId(undefined);
      setEditPlace("");
      setEditLocation("");
      setEditNote("");
    }
    setEditModalVisible(true);
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
  const openMap = (placeName: string, coordStr?: string) => {
    let lat = "", lng = "";

    // 좌표 파싱
    if (coordStr && coordStr.includes(",")) {
      const parts = coordStr.split(",").map(s => s.trim());
      if (parts.length === 2) {
        lat = parts[0];
        lng = parts[1];
      }
    }

    // 1. 웹 (Web) 환경: 네이버 지도 검색 (한국에서는 네이버가 정확함)
    if (Platform.OS === 'web') {
      const query = (lat && lng) ? `${lat},${lng}` : placeName;
      const webUrl = `https://map.naver.com/p/search/${encodeURIComponent(query)}`;

      window.open(webUrl, '_blank');
      setMapModalVisible(false);
      return;
    }

    // 2. 앱 (App) 환경: 구글 지도 사용
    // Universal Link 방식을 사용하여 앱이 있으면 앱으로, 없으면 브라우저로 안전하게 연결됩니다.
    // query에 "위도,경도"를 넣으면 해당 좌표에 핀이 찍히고, "장소명"을 넣으면 검색됩니다.
    const query = (lat && lng) ? `${lat},${lng}` : placeName;
    const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

    Linking.openURL(googleUrl).catch(err => {
      console.error("Google Maps Open Error", err);
      // 만약 구글 맵 연결도 실패하면 최후의 수단으로 네이버 웹 검색 결과로 이동
      const fallbackUrl = `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
      Linking.openURL(fallbackUrl);
    });

    setMapModalVisible(false);
  };

  if (loading) return <View style={[styles.container, { justifyContent: "center" }]}><ActivityIndicator /></View>;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

        {/* 헤더 영역 */}
        <View style={[styles.headerRow, compact && styles.headerRowCompact]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <FontAwesome5 name="chalkboard" size={24} color="#333" />
            <Text style={styles.title}>수업 목록</Text>
          </View>

          <View style={[styles.headerActions, compact && styles.headerActionsCompact]}>
            {isSupabaseDataSource && <AllStudentRecords />}
            {isSupabaseDataSource && (isAdmin || isManager) && <TermClassManager onChanged={load} />}
            <Pressable
              style={({pressed}) => [styles.mapBtn, pressed && { opacity: 0.7 }]}
              onPress={() => setMapModalVisible(true)}
            >
              <FontAwesome5 name="map-marked-alt" size={20} color="#4F46E5" />
              <Text style={styles.mapBtnText}>위치 보기</Text>
            </Pressable>
          </View>
        </View>

        {!!loadError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable onPress={() => void onRefresh()}><Text style={styles.retryText}>다시 불러오기</Text></Pressable>
          </View>
        )}

        {isSupabaseDataSource && supabaseOpenShift && (
          <Pressable disabled={!supabaseOpenShift.classId} style={styles.openShiftBanner}
            onPress={() => supabaseOpenShift.classId && router.push({ pathname: "/class/[id]", params: { id: supabaseOpenShift.classId } })}>
            <Text style={styles.openShiftTitle}>현재 출근 중</Text>
            <Text style={styles.openShiftText}>{supabaseOpenShift.workLabel} · {new Date(supabaseOpenShift.startedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })} 출근</Text>
            {supabaseOpenShift.classId && <Text style={styles.openShiftHint}>눌러서 해당 수업으로 이동</Text>}
          </Pressable>
        )}
        {!isSupabaseDataSource && activeSession && (
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

        {!loadError && filteredRows.length === 0 && (
          <Text style={styles.emptyClasses}>등록된 수업이 없습니다. Supabase에서 수업을 먼저 입력해 주세요.</Text>
        )}

        {filteredRows.map((r, index) => {
          const id = String(r[CLASSES_HEADERS.CLASS_ID] ?? "");
          const school = String(r[CLASSES_HEADERS.SCHOOL] ?? "").trim();
          const subject = String(r[CLASSES_HEADERS.SUBJECT] ?? "").trim();
          const day = String(r[CLASSES_HEADERS.DAY] ?? "").trim();
          const header = isSupabaseDataSource && r.__classLabel
            ? String(r.__classLabel)
            : (school && subject) ? `${school} ${subject} ${day}` : (school || subject || "수업");

          const place = String(r[CLASSES_HEADERS.PLACE] ?? "").trim();
          const start = String(r[CLASSES_HEADERS.CLASS_START] ?? "").trim();
          const end = String(r[CLASSES_HEADERS.CLASS_END] ?? "").trim();
          const timeLabel = isSupabaseDataSource && Array.isArray(r.__weekdaySchedule) && r.__weekdaySchedule.length
            ? r.__weekdaySchedule.slice().sort((a: any, b: any) => Number(a.weekday) - Number(b.weekday)).map((entry: any) => {
              const time = entry.start_time && entry.end_time
                ? `${String(entry.start_time).slice(0, 5)} ~ ${String(entry.end_time).slice(0, 5)}` : '시간 미정';
              return `${['일', '월', '화', '수', '목', '금', '토'][Number(entry.weekday)]} ${entry.day_part} ${time}`;
            }).join(' · ')
            : (start || end ? `${start} ~ ${end}` : '-');
          const quarter = String(r[CLASSES_HEADERS.QUARTER] ?? "").trim();
          const workers = String(r[CLASSES_HEADERS.WORKERS] ?? "-").trim();

          return (
            <Pressable key={`${id}-${index}`} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} onPress={() => router.push({ pathname: "/class/[id]", params: { id } })}>
              <View style={styles.accent} />
              <View style={styles.cardBody}>
                <Text style={styles.day}>{header}</Text>
                {(school || quarter) && <Text style={styles.meta}>{quarter}</Text>}
                <View style={styles.lineRow}><Text style={styles.lineLabel}>장소</Text><Text style={styles.lineValue}>{place || "-"}</Text></View>
                <View style={styles.lineRow}><Text style={styles.lineLabel}>시간</Text><Text style={styles.lineValue}>{timeLabel}</Text></View>
                <View style={styles.lineRow}><Text style={styles.lineLabel}>근무자</Text><Text style={styles.lineValue}>{workers}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={mapModalVisible} transparent animationType="fade" onRequestClose={() => setMapModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMapModalVisible(false)}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>📍 강의실 위치 찾기</Text>
              <View style={{ flexDirection: 'row', gap: 15 }}>
                {(isAdmin || isManager) && (
                  <Pressable onPress={() => openEditModal()}>
                    <FontAwesome5 name="plus" size={18} color="#4F46E5" />
                  </Pressable>
                )}
                <Pressable onPress={() => setMapModalVisible(false)}>
                  <FontAwesome5 name="times" size={20} color="#999" />
                </Pressable>
              </View>
            </View>
            <Text style={styles.modalDesc}>선택하면 지도로 연결됩니다. {(isAdmin || isManager) && "수정은 아이콘을 누르세요."}</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {positions.length === 0 ? <Text style={styles.emptyText}>등록된 위치 정보가 없습니다.</Text> :
                positions.map((pos, idx) => {
                  const name = String(pos[POSITIONS_HEADERS.PLACE] || "");
                  const coord = String(pos[POSITIONS_HEADERS.PLACE_LOCATION] || "");
                  const note = String(pos[POSITIONS_HEADERS.NOTE] || "");
                  if (!name) return null;
                  return (
                    <View key={idx} style={styles.locationItemRow}>
                      <Pressable style={({pressed}) => [styles.locationItemLeft, pressed && {backgroundColor: '#F3F4F6'}]} onPress={() => openMap(name, coord)}>
                        <FontAwesome5 name="map-marker-alt" size={16} color="#4F46E5" style={{marginRight: 10}} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.locationText}>{name}</Text>
                          <Text style={{fontSize: 11, color: '#999'}}>{coord} {note ? `/ ${note}` : ""}</Text>
                        </View>
                      </Pressable>
                      {(isAdmin || isManager) && (
                        <Pressable onPress={() => openEditModal(pos)} style={{ padding: 10 }}>
                          <FontAwesome5 name="edit" size={16} color="#9CA3AF" />
                        </Pressable>
                      )}
                    </View>
                  )
                })
              }
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={editModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>{isEditMode ? "장소 정보 수정" : "새 장소 추가"}</Text>

            <Text style={styles.editLabel}>장소명 (식별자)</Text>
            <TextInput
              style={[styles.editInput, isEditMode && styles.readOnlyInput]}
              value={editPlace} onChangeText={setEditPlace} editable={!isEditMode} placeholder="예: 상아 본관" placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.editLabel}>좌표 (위도, 경도)</Text>
            <TextInput style={styles.editInput} value={editLocation} onChangeText={setEditLocation} placeholder="37.123, 127.123" placeholderTextColor="#9CA3AF"/>

            <Text style={styles.editLabel}>비고</Text>
            <TextInput style={styles.editInput} value={editNote} onChangeText={setEditNote} placeholder="예: 3층" placeholderTextColor="#9CA3AF"/>

            <View style={styles.modalBtnRow}>
              <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setEditModalVisible(false)}>
                <Text style={styles.modalBtnTextCancel}>취소</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnConfirm]} onPress={handleSaveLocation}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnTextConfirm}>저장</Text>}
              </Pressable>
            </View>

            {isEditMode && (
              <Pressable onPress={() => handleDeleteLocation(editPlace)} style={{ marginTop: 15, alignSelf: 'center' }}>
                <Text style={{ color: '#EF4444', fontWeight: '700' }}>이 장소 삭제하기</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingTop: 20, alignItems: "center", paddingBottom: 24, backgroundColor: "#F6F7FB" },

  headerRow: { width: "92%", flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  headerRowCompact: { width: '100%', flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  headerActionsCompact: { justifyContent: 'flex-start' },
  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
  errorBox: { width: '92%', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  errorText: { color: '#991B1B', marginBottom: 8 },
  retryText: { color: '#4F46E5', fontWeight: '800' },
  emptyClasses: { width: '92%', color: '#6B7280', textAlign: 'center', paddingVertical: 30 },

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
  pickerInner: { borderRadius: 14, overflow: "hidden", position: "relative", justifyContent: 'center', height: 56, paddingRight: 12, },
  picker: { height: 56, width: "100%", color: "#111827", backgroundColor: "transparent", borderWidth: 0 },
  pickerWeb: { outlineStyle: "none", outlineWidth: 0, borderWidth: 0, paddingLeft: 15 } as ViewStyle & { outlineStyle: "none"; outlineWidth: number },
  pickerChevron: { position: "absolute", right: 12, top: 0, height: 56, justifyContent: "center", alignItems: "center" },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '60%', elevation: 5 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111' },
  modalDesc: { fontSize: 13, color: '#666', marginBottom: 15 },
  locationItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f3f3' },
  locationText: { fontSize: 15, color: '#333', fontWeight: '600' },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 20 },

  locationItemRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f3f3f3' },
  locationItemLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  editLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 15, marginBottom: 5 },
  editInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 15, backgroundColor: '#F9FAFB' },
  readOnlyInput: { backgroundColor: '#E5E7EB', color: '#6B7280' },
  modalBtnRow: { flexDirection: "row", gap: 10, width: "100%", marginTop: 20 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  modalBtnCancel: { backgroundColor: "#E5E7EB" },
  modalBtnConfirm: { backgroundColor: "#4F46E5" },
  modalBtnTextCancel: { color: "#374151", fontWeight: "700" },
  modalBtnTextConfirm: { color: "white", fontWeight: "700" },
});
