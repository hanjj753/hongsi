// [홈] 탭
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform, Image, TouchableOpacity, Alert, ScrollView, RefreshControl, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import * as Application from 'expo-application';
import AssistantFormModal, {
  AssistantFormValues,
  EMPTY_ASSISTANT_FORM,
  normalizeAssistantFormValues,
} from '../../components/AssistantFormModal';

// Firebase & Auth
import auth from '@react-native-firebase/auth';
import { signOut } from 'firebase/auth';
import { webAuth } from '../../firebaseConfig'; 

// Utils & Config
import { getCurrentUserEmail } from '../../utils/currentUser';
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { CSV_URLS, ATTENDANCE_LOG_HEADERS, SHEET_NAMES, API_URLS, PERMISSION_HEADERS, ASSISTANT_HEADERS } from "../../config/sheetConfig";
import { postSheetData } from "../../utils/sheetApi";

// ==========================================
// Types & Helpers
// ==========================================
type WorkRow = {
  date: string;
  shift: string;
  start: string;
  end: string;
  work: string;
  email: string;
  _dt?: Date;
};

function parseSheetDate(dateStr: string): Date | null {
  const cleaned = String(dateStr || "").replace(/[\s\.]/g, "-").replace(/-+/g, "-"); 
  const dt = new Date(cleaned);
  return isNaN(dt.getTime()) ? null : dt;
}

function toYYMM(dt: Date): string {
  const yy = String(dt.getFullYear()).slice(-2);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function durationToSeconds(s: string): number {
  const parts = String(s || "").split(':').map(v => v.trim()).filter(Boolean);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  if (parts.length === 2) return Number(parts[0]) * 3600 + Number(parts[1]) * 60;
  return 0;
}

function secondsToHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ==========================================
// Component
// ==========================================
export default function HomeScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  
  // 상태 관리
  const [androidId, setAndroidId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false); 
  const [isManager, setIsManager] = useState(false);

  // 모달 관련 상태
  const [modalVisible, setModalVisible] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [targetRole, setTargetRole] = useState<"Admin" | "Manager">("Manager");
  const [processing, setProcessing] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [newAssistant, setNewAssistant] = useState<AssistantFormValues>({ ...EMPTY_ASSISTANT_FORM });

  // 웹/앱 호환 알림 함수
  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      // 웹에서는 window.alert 사용
      window.alert(`${title}\n\n${message}`);
    } else {
      // 앱에서는 기존 Alert 사용
      Alert.alert(title, message);
    }
  };

  // 1. 로그인 유저 확인 & 기기 ID & 권한 확인
  useEffect(() => {
    const u = Platform.OS === 'web' ? webAuth.currentUser : auth().currentUser;
    setUser(u);

    let currentAndroidId: string | null = null;
    if (Platform.OS === 'android') {
      try {
        currentAndroidId = Application.getAndroidId();
        setAndroidId(currentAndroidId);
      } catch (e) {
        console.error("Android ID Error", e);
      }
    }

    if (u) {
      registerUserToSheet(u, currentAndroidId);
      checkAdminPermission(u.email);
    }
  }, []);

  const registerUserToSheet = async (userData: any, dId: string | null) => {
    if (!userData || !userData.email) return;

    try {
      // 1. [조교 정보] 시트 먼저 조회 (보안 체크)
      const assistantData = await fetchSheetData(CSV_URLS.ASSISTANT_INFO);
      
      let myRecord = null;
      if (Array.isArray(assistantData)) {
        myRecord = assistantData.find((r: any) => 
          String(r[ASSISTANT_HEADERS.EMAIL] || "").trim().toLowerCase() === userData.email.trim().toLowerCase()
        );
      }

      // 명단에 내 이메일이 없다면? -> 로그인 거부!
      if (!myRecord) {
        // 1) 경고창 띄우기
        showAlert(
          "로그인 거부", 
          "귀하의 정보가 [조교 정보] 시트에 등록되어 있지 않습니다.\n\n앱을 사용하려면 Admin 또는 Manager에게\n조교 정보 추가를 먼저 요청해주세요."
        );
        
        // 2) 강제 로그아웃 (즉시 튕겨냄)
        handleLogout(); 
        
        // 3) 함수 종료 (권한 관리 시트에 등록하지 않음)
        return; 
      }

      // 2. 통과된 경우: 시트에 있는 실명 가져오기
      // (만약 시트에 이름이 비어있으면 구글 이름 사용)
      const finalName = myRecord[ASSISTANT_HEADERS.NAME] || userData.displayName || "이름 없음";

      // 3. [앱 권한 관리] 시트에 등록 요청 (실명 사용)
      await postSheetData(API_URLS.ASSISTANT_MGMT, SHEET_NAMES.PERMISSIONS, {
        action: "register_user",
        name: finalName, 
        email: userData.email,
        deviceId: dId || "", 
      });

    } catch (e) {
      console.error("유저 등록 확인 중 오류", e);
      // 에러 발생 시에도 보안을 위해 등록 로직이 실행되지 않도록 함
    }
  };

  // 내 권한 확인 (CSV 방식)
  const checkAdminPermission = async (email: string | null) => {
    if (!email) return;
    try {
      const data = await fetchSheetData(CSV_URLS.PERMISSIONS);
      if (Array.isArray(data)) {
        const myRecord = data.find((r: any) => {
           const rowEmail = String(r[PERMISSION_HEADERS.EMAIL] || "").trim();
           return rowEmail === email.trim();
        });

        if (myRecord) {
          const role = String(myRecord[PERMISSION_HEADERS.ROLE] || "").trim();
          if (role === 'Admin') setIsAdmin(true);
          if (role === 'Manager') setIsManager(true);
        }
      }
    } catch (e) {
      console.error("권한 확인 실패", e);
    }
  };

  const load = useCallback(async () => {
    const email = getCurrentUserEmail();
    if (!email) return;

    const data = await fetchSheetData(CSV_URLS.ATTENDANCE_LOG);
    const myEmail = email.trim().toLowerCase();
    
    const myRows: WorkRow[] = (data || [])
      .filter((r: any) => {
        const rowEmail = (r[ATTENDANCE_LOG_HEADERS.WORKER_EMAIL] ||  "").trim().toLowerCase();
        return rowEmail === myEmail;
      })
      .map((r: any) => ({
        date: String(r[ATTENDANCE_LOG_HEADERS.ATTENDANCE_DATE] ?? "").trim(),
        shift: String(r[ATTENDANCE_LOG_HEADERS.CLASS_NAME] ?? "").trim(),
        start: String(r[ATTENDANCE_LOG_HEADERS.ATTENDANCE_START] ?? "").trim(),
        end: String(r[ATTENDANCE_LOG_HEADERS.ATTENDANCE_END] ?? "").trim(),
        work: String(r["근무 시간"] ?? "").trim(), 
        email: myEmail,
        _dt: parseSheetDate(r[ATTENDANCE_LOG_HEADERS.ATTENDANCE_DATE]) ?? undefined
      }))
      .filter(r => r._dt)
      .sort((a, b) => (b._dt!.getTime() - a._dt!.getTime()));

    setRows(myRows);
  }, []);

  useEffect(() => {
    if (user) {
      load().catch(e => console.error(e)).finally(() => setLoading(false));
    }
  }, [user, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    if (user) checkAdminPermission(user.email);
    setRefreshing(false);
  };

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r._dt) set.add(toYYMM(r._dt)); });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [rows]);

  useEffect(() => {
    if (!selectedMonth && monthOptions.length > 0) {
      setSelectedMonth(monthOptions[0]);
    }
  }, [monthOptions, selectedMonth]);

  const monthRows = useMemo(() => {
    if (!selectedMonth) return [];
    return rows.filter(r => r._dt && toYYMM(r._dt) === selectedMonth);
  }, [rows, selectedMonth]);

  const monthSummary = useMemo(() => {
    const totalSeconds = monthRows.reduce((acc, r) => acc + durationToSeconds(r.work), 0);
    return {
      count: monthRows.length,
      totalTime: secondsToHMS(totalSeconds),
    };
  }, [monthRows]);

  const handleLogout = async () => {
    try {
      if (Platform.OS === 'web') {
        await signOut(webAuth);
        window.location.href = '/';
      } else {
        await auth().signOut();
        if (router.canDismiss()) router.dismissAll();
        router.replace('/');
      }
    } catch (error: any) {
      showAlert('로그아웃 실패', error.message);
    }
  };

  // 관리자 기능 핸들러
  const openAddModal = (role: "Admin" | "Manager") => {
    setTargetRole(role);
    setTargetEmail("");
    setModalVisible(true);
  };

  const handleSubmitRole = async () => {
    if (!targetEmail.trim()) {
      showAlert("알림", "이메일을 입력해주세요.");
      return;
    }
    
    setProcessing(true);
    
    try {
      // Admin 등록 시: Device ID 존재 여부 확인 (보안)
      if (targetRole === 'Admin') {
        const data = await fetchSheetData(CSV_URLS.PERMISSIONS);
        const targetUser = data.find((r: any) => 
          String(r[PERMISSION_HEADERS.EMAIL] || "").trim() === targetEmail.trim()
        );

        if (!targetUser) {
          showAlert("등록 불가", "해당 이메일은 시트에 등록되지 않았습니다.\n앱에 로그인한 적이 있는 유저만 등록 가능합니다.");
          setProcessing(false);
          return;
        }

        const deviceId = String(targetUser[PERMISSION_HEADERS.DEVICE_ID] || "").trim();
        if (!deviceId) {
          showAlert("등록 불가", "해당 계정은 Device ID가 없습니다.\n안드로이드 앱에서 로그인하여 기기 정보가 있는 유저만 Admin이 될 수 있습니다.");
          setProcessing(false);
          return;
        }
      }

      const res = await postSheetData(API_URLS.ASSISTANT_MGMT, SHEET_NAMES.PERMISSIONS, {
        action: "update_permission",
        targetEmail: targetEmail.trim(),
        targetRole: targetRole,
      });

      if (res.ok) {
        showAlert("성공", `${targetEmail} 님을 ${targetRole}(으)로 등록했습니다.`);
        setModalVisible(false);
      } else {
        showAlert("실패", res.error || "등록에 실패했습니다.");
      }
    } catch (e) {
      console.error(e);
      showAlert("오류", "요청 중 문제가 발생했습니다.");
    } finally {
      setProcessing(false);
    }
  };

  const openAddAssistantModal = () => {
    setNewAssistant({ ...EMPTY_ASSISTANT_FORM });
    setAddModalVisible(true);
  };

  const handleAddAssistant = async () => {
    const normalized = normalizeAssistantFormValues(newAssistant);
    if (!normalized.name || !normalized.email) {
      showAlert("입력 오류", "이름과 이메일은 필수입니다.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(normalized.email)) {
      showAlert("입력 오류", "올바른 이메일 주소를 입력해주세요.");
      return;
    }

    setProcessing(true);
    try {
      const res = await postSheetData(API_URLS.ASSISTANT_MGMT, SHEET_NAMES.ASSISTANT_INFO, {
        action: "add_assistant",
        ...normalized,
      });

      if (res.ok) {
        showAlert("성공", `${normalized.name} 조교 정보를 추가했습니다.`);
        setAddModalVisible(false);
        setNewAssistant({ ...EMPTY_ASSISTANT_FORM });
      } else {
        showAlert("실패", res.error || "추가 실패");
      }
    } catch (e) {
      console.error(e);
      showAlert("오류", "요청 중 문제가 발생했습니다.");
    } finally {
      setProcessing(false);
    }
  };

  const updateNewAssistant = (key: keyof AssistantFormValues, value: string) => {
    setNewAssistant(prev => ({ ...prev, [key]: value }));
  };

  if (loading && !refreshing) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView 
        contentContainerStyle={styles.container} 
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.headerTitle}>마이 페이지</Text>

        {user && (
          <View style={styles.card}>
            {user.photoURL && <Image source={{ uri: user.photoURL }} style={styles.avatar} />}
            
            {androidId && (
              <View style={{ alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ fontSize: 12, color: '#999', marginBottom: 2 }}>Device ID</Text>
                <Text style={{ fontSize: 14, color: '#555', fontWeight: 'bold' }} selectable>
                  {androidId}
                </Text>
              </View>
            )}

            <View style={styles.row}>
              <InfoItem label="이름" value={user.displayName || "이름 없음"} />
              <InfoItem label="이메일" value={user.email} />
            </View>

            {/* Admin인 경우에만 보이는 버튼 */}
            {isAdmin && (
              <View style={styles.authButtonContainer}>
                <TouchableOpacity style={styles.reqBtnAdmin} onPress={() => openAddModal("Admin")}>
                  <Text style={styles.reqBtnText}>+ Admin 추가</Text>
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.reqBtnManager} onPress={() => openAddModal("Manager")}>
                  <Text style={styles.reqBtnText}>+ Manager 추가</Text>
                </TouchableOpacity>
              </View>
            )}

            {(isAdmin || isManager) && (
              <TouchableOpacity 
                style={[styles.reqBtnManager, { marginTop: 10, backgroundColor: '#10B981' }]} 
                onPress={openAddAssistantModal}
              >
                <Text style={styles.reqBtnText}>+ 조교 정보 시트에 추가</Text>
              </TouchableOpacity>
            )}

            {rows.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyStateText}>근무 기록이 없습니다.</Text>
              </View>
            ) : (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>월 선택</Text>
                  <View style={styles.pickerBox}>
                    <Picker selectedValue={selectedMonth} onValueChange={setSelectedMonth} style={{ height: 50 }}>
                      {monthOptions.map(m => <Picker.Item key={m} label={m} value={m} />)}
                    </Picker>
                  </View>
                </View>

                {selectedMonth ? (
                  <View style={styles.section}>
                    <Text style={styles.tableTitle}>{selectedMonth} 근무 요약</Text>
                    <View style={styles.table}>
                      <View style={styles.trHead}>
                        <Text style={styles.th}>총 근무 시간</Text>
                        <Text style={styles.th}>근무 횟수</Text>
                      </View>
                      <View style={styles.tr}>
                        <Text style={styles.td}>{monthSummary.totalTime}</Text>
                        <Text style={styles.td}>{monthSummary.count}회</Text>
                      </View>
                    </View>
                  </View>
                ) : null}

                {selectedMonth ? (
                  <View style={styles.section}>
                    <Text style={styles.tableTitle}>상세 기록</Text>
                    <View style={styles.table}>
                      <View style={styles.trHead}>
                        <Text style={[styles.th, { flex: 0.8 }]}>날짜</Text>
                        <Text style={[styles.th, { flex: 1.2 }]}>수업</Text>
                        <Text style={styles.th}>시간</Text>
                      </View>
                      {monthRows.length === 0 ? (
                        <Text style={styles.noData}>기록이 없습니다.</Text>
                      ) : (
                        monthRows.map((r, i) => (
                          <View key={i} style={styles.tr}>
                            <Text style={[styles.td, { flex: 0.8 }]}>{r.date}</Text>
                            <Text style={[styles.td, { flex: 1.2 }]}>{r.shift}</Text>
                            <Text style={styles.td}>
                              {r.end ? `${r.start}~${r.end}` : `${r.start} (근무중)`}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  </View>
                ) : null}
              </>
            )}

            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Text style={styles.logoutText}>로그아웃</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* 이메일 입력 모달 */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={styles.modalView}>
            <Text style={styles.modalTitle}>{targetRole} 권한 부여</Text>
            <Text style={styles.modalDesc}>
              해당 권한을 부여할 사용자의 Gmail을 정확히 입력해주세요. (이미 등록된 유저는 권한이 변경됩니다.)
            </Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="example@gmail.com"
              placeholderTextColor="#9CA3AF"
              value={targetEmail}
              onChangeText={setTargetEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnCancel]} 
                onPress={() => setModalVisible(false)}
                disabled={processing}
              >
                <Text style={styles.modalBtnTextCancel}>취소</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnConfirm]} 
                onPress={handleSubmitRole}
                disabled={processing}
              >
                {processing ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.modalBtnTextConfirm}>등록</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <AssistantFormModal
        visible={addModalVisible}
        title="새 조교 등록"
        values={newAssistant}
        saving={processing}
        onChange={updateNewAssistant}
        onCancel={() => setAddModalVisible(false)}
        onSubmit={handleAddAssistant}
      />
    </View>
  );
}

const InfoItem = ({ label, value }: { label: string, value: string }) => (
  <View style={{ flex: 1, alignItems: 'center' }}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value} numberOfLines={1}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#f5f5f5', padding: 20, alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 20, color: '#333' },
  
  card: { width: '100%', maxWidth: 500, backgroundColor: 'white', borderRadius: 16, padding: 20, elevation: 3 },
  avatar: { width: 80, height: 80, borderRadius: 40, alignSelf: 'center', marginBottom: 16, backgroundColor: '#eee' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  label: { fontSize: 13, color: '#888', marginBottom: 4 },
  value: { fontSize: 16, fontWeight: '600', color: '#333' },

  authButtonContainer: { flexDirection: 'row', gap: 10, marginTop: 20, marginBottom: 5 },
  reqBtnAdmin: { flex: 1, backgroundColor: '#374151', paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  reqBtnManager: { flex: 1, backgroundColor: '#4F46E5', paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  reqBtnText: { color: 'white', fontSize: 14, fontWeight: '700' },

  section: { marginTop: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#555', marginBottom: 8 },
  pickerBox: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, overflow: 'hidden' },
  
  tableTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 8 },
  table: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, overflow: 'hidden' },
  trHead: { flexDirection: 'row', backgroundColor: '#f9f9f9', paddingVertical: 10 },
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#eee', paddingVertical: 12 },
  th: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700', color: '#555' },
  td: { flex: 1, textAlign: 'center', fontSize: 13, color: '#333' },
  noData: { textAlign: 'center', padding: 20, color: '#999' },

  logoutBtn: { marginTop: 30, backgroundColor: '#FF5A5F', padding: 14, borderRadius: 10, alignItems: 'center' },
  logoutText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  modalView: { width: "85%", backgroundColor: "white", borderRadius: 12, padding: 24, alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: "bold", marginBottom: 10, color: "#1F2937" },
  modalDesc: { fontSize: 14, color: "#6B7280", textAlign: "center", marginBottom: 20 },
  modalInput: { width: "100%", height: 50, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingHorizontal: 15, fontSize: 16, marginBottom: 20, backgroundColor: "#F9FAFB" },
  modalBtnRow: { flexDirection: "row", gap: 10, width: "100%" },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  modalBtnCancel: { backgroundColor: "#E5E7EB" },
  modalBtnConfirm: { backgroundColor: "#4F46E5" },
  modalBtnTextCancel: { color: "#374151", fontWeight: "700" },
  modalBtnTextConfirm: { color: "white", fontWeight: "700" },

  emptyContainer: { marginTop: 60, alignItems: 'center', justifyContent: 'center' },
  emptyStateText: { fontSize: 16, color: '#9CA3AF', fontWeight: '600' },
});
