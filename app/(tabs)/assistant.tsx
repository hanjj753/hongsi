// [조교] 탭
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Linking, TouchableOpacity, RefreshControl, Alert, Modal, Platform, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from '@react-native-picker/picker';
import AssistantFormModal, {
  AssistantFormValues,
  EMPTY_ASSISTANT_FORM,
  normalizeAssistantFormValues,
} from "../../components/AssistantFormModal";
import SupabaseAssistantScreen from '../../components/SupabaseAssistantScreen';
import { isSupabaseDataSource } from '../../config/dataSource';

// Config & Utils
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { postSheetData } from "../../utils/sheetApi"; // ✅ [수정] 추가됨
import { getCurrentUserEmail } from "../../utils/currentUser";
import { CSV_URLS, API_URLS, SHEET_NAMES, ASSISTANT_HEADERS, PERMISSION_HEADERS, ATTENDANCE_LOG_HEADERS } from "../../config/sheetConfig"; // ✅ [수정] API_URLS, SHEET_NAMES 추가됨

// ==========================================
// Types & Helpers (from index.tsx)
// ==========================================
type Assistant = {
  name: string;
  rawPosition: string;
  positions: string[];
  phone: string;
  email: string;
  roles: string[]; 
  status: string;
  startDate: string;
  account: string;
  isInactive: boolean;
};

type WorkRow = {
  date: string;
  shift: string;
  day: string;
  start: string;
  end: string;
  work: string;
  email: string;
  _dt?: Date;
};

function todayYmd(): string {
  const dt = new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

function isValidHm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function koreanDay(value: string): string {
  if (!isValidYmd(value)) return "";
  const [year, month, day] = value.split('-').map(Number);
  return ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day).getDay()];
}

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

export default function AssistantScreen() {
  return isSupabaseDataSource ? <SupabaseAssistantScreen /> : <LegacyAssistantScreen />;
}

function LegacyAssistantScreen() {
  const [allData, setAllData] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // UI 상태
  const [activeCollapsed, setActiveCollapsed] = useState(false);
  const [inactiveCollapsed, setInactiveCollapsed] = useState(true);
  const [showField, setShowField] = useState(true);
  const [showMaterial, setShowMaterial] = useState(true);

  // ✅ 권한 상태
  const [isAdmin, setIsAdmin] = useState(false);
  const [isManager, setIsManager] = useState(false);

  const [assistantModalVisible, setAssistantModalVisible] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [assistantForm, setAssistantForm] = useState<AssistantFormValues>({ ...EMPTY_ASSISTANT_FORM });
  const [savingAssistant, setSavingAssistant] = useState(false);

  // ✅ 근무 기록 모달 상태
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [targetName, setTargetName] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [logRows, setLogRows] = useState<WorkRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingLog, setEditingLog] = useState<WorkRow | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editShift, setEditShift] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const assistantFromForm = (form: AssistantFormValues): Assistant => {
    const normalized = normalizeAssistantFormValues(form);
    return {
      name: normalized.name,
      rawPosition: normalized.position,
      positions: [normalized.position],
      phone: normalized.phone,
      email: normalized.email,
      roles: normalized.role.split(',').map(value => value.trim()).filter(Boolean),
      status: normalized.status,
      startDate: normalized.startDate,
      account: normalized.account,
      isInactive: normalized.status === "비근무",
    };
  };

  const openAddAssistantModal = () => {
    if (!isAdmin && !isManager) return;
    setEditingAssistant(null);
    setAssistantForm({ ...EMPTY_ASSISTANT_FORM });
    setAssistantModalVisible(true);
  };

  const openEditAssistantModal = (assistant: Assistant) => {
    if (!isAdmin && !isManager) return;
    setEditingAssistant(assistant);
    setAssistantForm(normalizeAssistantFormValues({
      position: assistant.rawPosition,
      name: assistant.name,
      phone: assistant.phone,
      email: assistant.email,
      role: assistant.roles.join(', '),
      startDate: assistant.startDate,
      account: assistant.account,
      status: assistant.status,
    }));
    setAssistantModalVisible(true);
  };

  const updateAssistantForm = (key: keyof AssistantFormValues, value: string) => {
    setAssistantForm(current => ({ ...current, [key]: value }));
  };

  const handleSaveAssistant = async () => {
    const normalized = assistantFromForm(assistantForm);
    if (!normalized.name || !normalized.email) {
      showAlert("입력 확인", "이름과 Gmail은 필수입니다.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(normalized.email)) {
      showAlert("입력 확인", "올바른 이메일 주소를 입력해주세요.");
      return;
    }

    const duplicate = allData.find(item =>
      item !== editingAssistant && item.email.trim().toLowerCase() === normalized.email
    );
    if (duplicate) {
      showAlert("이메일 중복", "같은 이메일로 등록된 조교가 이미 있습니다.");
      return;
    }

    setSavingAssistant(true);
    try {
      const payload = {
        action: editingAssistant ? "update_assistant" : "add_assistant",
        originalEmail: editingAssistant?.email || "",
        position: normalized.rawPosition,
        name: normalized.name,
        phone: normalized.phone,
        email: normalized.email,
        role: normalized.roles.join(', '),
        startDate: normalized.startDate,
        account: normalized.account,
        status: normalized.status,
      };
      const res = await postSheetData(API_URLS.ASSISTANT_MGMT, SHEET_NAMES.ASSISTANT_INFO, payload);
      if (!res.ok) {
        showAlert("저장 실패", res.error || "조교 정보를 저장하지 못했습니다.");
        return;
      }

      setAllData(current => editingAssistant
        ? current.map(item => item === editingAssistant ? normalized : item)
        : [...current, normalized]);
      setAssistantModalVisible(false);
      showAlert("완료", editingAssistant ? "조교 정보가 수정되었습니다." : "조교 정보가 추가되었습니다.");
    } catch (error) {
      console.error(error);
      showAlert("오류", "조교 정보 저장 중 문제가 발생했습니다.");
    } finally {
      setSavingAssistant(false);
    }
  };

  const calculateDuration = (start: string, end: string) => {
    if (!start || !end) return "";
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (isNaN(sh) || isNaN(eh)) return "";

    let startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;
    
    // 자정을 넘긴 경우 (예: 23:00 ~ 01:00)
    if (endMins < startMins) endMins += 24 * 60;
    
    const diff = endMins - startMins;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const openEditModal = (log: WorkRow) => {
    if (!isAdmin && !isManager) return;
    setEditingLog(log);
    setEditDate(log.date);
    setEditShift(log.shift);
    setEditStart(log.start);
    setEditEnd(log.end || log.start);
    setEditModalVisible(true);
  };

  const openAddModal = () => {
    if (!isAdmin && !isManager) return;
    setEditingLog(null);
    setEditDate(todayYmd());
    setEditShift("");
    setEditStart("");
    setEditEnd("");
    setEditModalVisible(true);
  };

  // 근무 기록 추가 및 수정
  const handleSaveEdit = async () => {
    const normalizedDate = editDate.trim();
    const normalizedShift = editShift.trim();
    const normalizedStart = editStart.trim();
    const normalizedEnd = editEnd.trim();

    if (!isValidYmd(normalizedDate)) {
      showAlert("입력 확인", "날짜를 YYYY-MM-DD 형식으로 입력해주세요.");
      return;
    }
    if (!normalizedShift) {
      showAlert("입력 확인", "수업 또는 근무명을 입력해주세요.");
      return;
    }
    if (!isValidHm(normalizedStart) || !isValidHm(normalizedEnd)) {
      showAlert("입력 확인", "출퇴근 시간을 HH:MM 형식으로 입력해주세요.");
      return;
    }

    const newDuration = calculateDuration(normalizedStart, normalizedEnd);
    setSavingEdit(true);

    try {
      const payload = editingLog ? {
        action: "update_attendance_log",
        targetDate: editingLog.date,
        targetEmail: editingLog.email,
        targetClass: editingLog.shift,
        oldStart: editingLog.start,
        oldEnd: editingLog.end || "",
        newStart: normalizedStart,
        newEnd: normalizedEnd,
        newDuration
      } : {
        action: "add_attendance_log",
        record: {
          [ATTENDANCE_LOG_HEADERS.ATTENDANCE_DATE]: normalizedDate,
          [ATTENDANCE_LOG_HEADERS.CLASS_ID]: "",
          [ATTENDANCE_LOG_HEADERS.QUARTER]: "",
          [ATTENDANCE_LOG_HEADERS.CLASS_NAME]: normalizedShift,
          [ATTENDANCE_LOG_HEADERS.DAY]: koreanDay(normalizedDate),
          [ATTENDANCE_LOG_HEADERS.WORKERS]: targetName,
          [ATTENDANCE_LOG_HEADERS.WORKER_EMAIL]: targetEmail,
          [ATTENDANCE_LOG_HEADERS.ATTENDANCE_START]: normalizedStart,
          [ATTENDANCE_LOG_HEADERS.ATTENDANCE_END]: normalizedEnd,
          [ATTENDANCE_LOG_HEADERS.WORK_DURATION]: newDuration,
          [ATTENDANCE_LOG_HEADERS.STATUS]: "퇴근",
          [ATTENDANCE_LOG_HEADERS.WORKER_LOCATION]: "",
          [ATTENDANCE_LOG_HEADERS.NOTE]: "관리자 직접 추가"
        }
      };

      const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.ATTENDANCE, payload);

      if (res.ok) {
        if (editingLog) {
          setLogRows(prev => prev.map(log => log === editingLog ? {
            ...log,
            start: normalizedStart,
            end: normalizedEnd,
            work: newDuration
          } : log));
          showAlert("완료", "근무 기록이 수정되었습니다.");
        } else {
          if (res.data?.alreadyExists) {
            showAlert("확인", "이미 같은 근무 기록이 있습니다.");
            setEditModalVisible(false);
            return;
          }
          const parsedDate = parseSheetDate(normalizedDate) || undefined;
          const newLog: WorkRow = {
            date: normalizedDate,
            shift: normalizedShift,
            day: koreanDay(normalizedDate),
            start: normalizedStart,
            end: normalizedEnd,
            work: newDuration,
            email: targetEmail,
            _dt: parsedDate
          };
          setLogRows(prev => [newLog, ...prev]);
          if (parsedDate) setSelectedMonth(toYYMM(parsedDate));
          showAlert("완료", "근무 기록이 추가되었습니다.");
        }
        setEditModalVisible(false);
      } else {
        showAlert("실패", res.error || "해당 기록을 찾을 수 없거나 오류가 발생했습니다.");
      }
    } catch (e) {
      console.error(e);
      showAlert("오류", "서버 전송 중 문제가 발생했습니다.");
    } finally {
      setSavingEdit(false);
    }
  };

  const processDeleteLog = async () => {
    if (!editingLog) return;
    setSavingEdit(true);
    try {
      const res = await postSheetData(API_URLS.ATTENDANCE_LOG, SHEET_NAMES.ATTENDANCE, {
        action: "delete_attendance_log",
        targetDate: editingLog.date,
        targetEmail: editingLog.email,
        targetClass: editingLog.shift,
        oldStart: editingLog.start,
        oldEnd: editingLog.end || ""
      });

      if (!res.ok) {
        showAlert("삭제 실패", res.error || "기록을 찾을 수 없습니다.");
        return;
      }

      setLogRows(prev => prev.filter(log => log !== editingLog));
      setEditModalVisible(false);
      showAlert("완료", "근무 기록이 삭제되었습니다.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteLog = () => {
    if (!editingLog || savingEdit) return;
    const message = `${editingLog.date} ${editingLog.shift} 기록을 삭제하시겠습니까?`;
    if (Platform.OS === 'web') {
      if (window.confirm(message)) processDeleteLog();
      return;
    }
    Alert.alert("근무 기록 삭제", message, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: processDeleteLog }
    ]);
  };

  // 1. 초기 데이터 로드 (조교 목록 & 내 권한)
  const loadData = useCallback(async () => {
    try {
      // (1) 조교 정보 로드
      const data = await fetchSheetData(CSV_URLS.ASSISTANT_INFO);
      const cleanData = data.map((row: any) => {
        const rawPos = row[ASSISTANT_HEADERS.POSITION] || "";
        const rawRole = row[ASSISTANT_HEADERS.ROLE] || "";
        const status = row[ASSISTANT_HEADERS.STATUS] || "";
        
        return {
          name: row[ASSISTANT_HEADERS.NAME],
          rawPosition: rawPos,
          positions: rawPos.split(",").map((s: string) => s.trim()).filter(Boolean),
          phone: row[ASSISTANT_HEADERS.PHONE],
          email: row[ASSISTANT_HEADERS.EMAIL],
          roles: rawRole.split(",").map((s: string) => s.trim()).filter(Boolean),
          status: status,
          startDate: row[ASSISTANT_HEADERS.START_DATE] || "",
          account: row[ASSISTANT_HEADERS.ACCOUNT] || "",
          isInactive: status.includes("비근무"),
        };
      });
      setAllData(cleanData);

      // (2) 내 권한 확인
      const myEmail = getCurrentUserEmail();
      if (myEmail) {
        const permData = await fetchSheetData(CSV_URLS.PERMISSIONS);
        if (Array.isArray(permData)) {
          const myRecord = permData.find((r: any) => 
            String(r[PERMISSION_HEADERS.EMAIL] || "").trim().toLowerCase() === myEmail.trim().toLowerCase()
          );
          if (myRecord) {
            const role = String(myRecord[PERMISSION_HEADERS.ROLE] || "").trim();
            if (role === 'Admin') setIsAdmin(true);
            if (role === 'Manager') setIsManager(true);
          }
        }
      }

    } catch (error) {
      console.error(error);
      Alert.alert("오류", "정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ✅ 근무 기록 조회 핸들러
  const handleViewLogs = async (email: string, name: string) => {
    if (!email) {
      Alert.alert("알림", "이메일 정보가 없는 사용자입니다.");
      return;
    }

    setTargetName(name);
    setTargetEmail(email.trim().toLowerCase());
    setLogModalVisible(true);
    setLoadingLogs(true);
    setLogRows([]);

    try {
      const data = await fetchSheetData(CSV_URLS.ATTENDANCE_LOG);
      const targetEmail = email.trim().toLowerCase();

      const userRows: WorkRow[] = (data || [])
        .filter((r: any) => {
          const rowEmail = (r[ATTENDANCE_LOG_HEADERS.WORKER_EMAIL] || r["Email"] || "").trim().toLowerCase();
          return rowEmail === targetEmail;
        })
        .map((r: any) => {
          const start = String(r[ATTENDANCE_LOG_HEADERS.ATTENDANCE_START] ?? "").trim();
          const end = String(r[ATTENDANCE_LOG_HEADERS.ATTENDANCE_END] ?? "").trim();
          const savedDuration = String(r[ATTENDANCE_LOG_HEADERS.WORK_DURATION] ?? "").trim();
          return {
            date: String(r[ATTENDANCE_LOG_HEADERS.ATTENDANCE_DATE] ?? "").trim(),
            shift: String(r[ATTENDANCE_LOG_HEADERS.CLASS_NAME] ?? "").trim(),
            day: String(r[ATTENDANCE_LOG_HEADERS.DAY] ?? "").trim(),
            start,
            end,
            work: savedDuration || calculateDuration(start, end),
            email: targetEmail,
            _dt: parseSheetDate(r[ATTENDANCE_LOG_HEADERS.ATTENDANCE_DATE]) ?? undefined
          };
        });

      setLogRows(userRows);

      // 최신 월 선택
      const months = Array.from(new Set(userRows.map(r => r._dt ? toYYMM(r._dt) : ""))).filter(Boolean).sort((a, b) => b.localeCompare(a));
      if (months.length > 0) setSelectedMonth(months[0]);
      else setSelectedMonth("");

    } catch (e) {
      console.error(e);
      Alert.alert("오류", "근무 기록을 불러오지 못했습니다.");
    } finally {
      setLoadingLogs(false);
    }
  };

  // ✅ 모달 내부 계산 로직
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    logRows.forEach(r => { if (r._dt) set.add(toYYMM(r._dt)); });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [logRows]);

  const monthRows = useMemo(() => {
    if (!selectedMonth) return [];
    return logRows.filter(r => r._dt && toYYMM(r._dt) === selectedMonth);
  }, [logRows, selectedMonth]);

  const monthSummary = useMemo(() => {
    const totalSeconds = monthRows.reduce((acc, r) => acc + durationToSeconds(r.work), 0);
    return {
      count: monthRows.length,
      totalTime: secondsToHMS(totalSeconds),
    };
  }, [monthRows]);


  // 그룹핑 로직
  const { ceos, managers, activeAssistants, inactiveAssistants } = useMemo(() => {
    const groupCeo: Assistant[] = [];
    const groupManager: Assistant[] = [];
    const groupActive: Assistant[] = [];
    const groupInactive: Assistant[] = [];

    allData.forEach(staff => {
      if (staff.rawPosition.includes("CEO")) { groupCeo.push(staff); return; }
      if (staff.rawPosition.includes("실장")) { groupManager.push(staff); return; }

      const hasField = staff.roles.includes("현장");
      const hasMaterial = staff.roles.includes("자료");

      if (staff.roles.length > 0) {
        const matchField = showField && hasField;
        const matchMaterial = showMaterial && hasMaterial;
        if (!matchField && !matchMaterial) return;
      }

      if (staff.isInactive) groupInactive.push(staff);
      else groupActive.push(staff);
    });

    return { ceos: groupCeo, managers: groupManager, activeAssistants: groupActive, inactiveAssistants: groupInactive };
  }, [allData, showField, showMaterial]);

  const handleCall = (phone: string) => { if (phone) Linking.openURL(`tel:${phone.replace(/-/g, "")}`); };
  const handleSms = (phone: string) => { if (phone) Linking.openURL(`sms:${phone.replace(/-/g, "")}`); };

  const getBadgeColor = (posName: string) => {
    if (posName.includes("CEO")) return "#111827";
    if (posName.includes("실장")) return "#10B981";
    if (posName.includes("조교장")) return "#EF4444";
    if (posName.includes("개발")) return "#8B5CF6";
    return "#3B82F6";
  };

  const CheckBox = ({ label, value, onChange }: { label: string, value: boolean, onChange: (v: boolean) => void }) => (
    <TouchableOpacity style={styles.checkboxContainer} onPress={() => onChange(!value)} activeOpacity={0.7}>
      <Ionicons name={value ? "checkbox" : "square-outline"} size={20} color={value ? "#4F46E5" : "#9CA3AF"} />
      <Text style={[styles.checkboxLabel, value && styles.checkboxLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const ManageActions = ({ item }: { item: Assistant }) => (
    <View style={styles.manageActionRow}>
      <TouchableOpacity style={styles.smallManageBtn} onPress={() => openEditAssistantModal(item)}>
        <Ionicons name="create-outline" size={14} color="#374151" />
        <Text style={styles.smallManageText}>정보 수정</Text>
      </TouchableOpacity>
      {!!item.email && (
        <TouchableOpacity style={styles.smallLogBtn} onPress={() => handleViewLogs(item.email, item.name)}>
          <Ionicons name="time-outline" size={14} color="#4F46E5" />
          <Text style={styles.smallLogBtnText}>근무 기록</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // 🔹 조교 카드 컴포넌트
  const StaffCard = ({ item }: { item: Assistant }) => (
    <View style={[styles.card, item.isInactive && styles.cardInactive]}>
      <View style={styles.cardHeader}>
        <View style={styles.headerTop}>
            <View style={styles.headerLeft}>
                <Text style={[styles.name, item.isInactive && styles.textInactive]}>{item.name}</Text>
                <View style={styles.badgeContainer}>
                  {item.positions.map((pos, idx) => (
                      <View key={idx} style={[styles.badge, { backgroundColor: getBadgeColor(pos) }, item.isInactive && styles.badgeInactive]}>
                      <Text style={styles.badgeText}>{pos}</Text>
                      </View>
                  ))}
                </View>
            </View>
            <Text style={[styles.startDate, item.isInactive && styles.textInactive]}>{item.startDate}</Text>
        </View>
        
        <View style={styles.roleRow}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {item.roles.length > 0 ? (
                    item.roles.map((role, idx) => (
                    <View key={idx} style={[styles.roleBadge, item.isInactive && styles.roleBadgeInactive]}>
                        <Text style={[styles.roleText, item.isInactive && styles.roleTextInactive]}>{role}</Text>
                    </View>
                    ))
                ) : (
                    <View style={{height: 20}} /> 
                )}
            </View>
            {(isAdmin || isManager) && <ManageActions item={item} />}
        </View>
      </View>
      
      <View style={styles.divider} />

      <View style={styles.row}>
        <TouchableOpacity style={styles.contactItem} onPress={() => !item.isInactive && handleCall(item.phone)} disabled={item.isInactive}>
            <Ionicons name="call" size={16} color={item.isInactive ? "#9CA3AF" : "#6B7280"} />
            <Text style={[styles.contactText, item.isInactive && styles.textInactive]}>{item.phone || "-"}</Text>
        </TouchableOpacity>
        {!item.isInactive && item.phone && (
          <TouchableOpacity style={styles.iconBtn} onPress={() => handleSms(item.phone)}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#4B5563" />
          </TouchableOpacity>
        )}
      </View>

      {item.email ? (
        <View style={{flexDirection:'column'}}>
            <View style={[styles.row, {marginBottom: 4}]}>
                <View style={styles.contactItem}>
                    <Ionicons name="mail" size={16} color={item.isInactive ? "#9CA3AF" : "#6B7280"} />
                    <Text style={[styles.contactText, item.isInactive && styles.textInactive]}>{item.email}</Text>
                </View>
            </View>
        </View>
      ) : null}
    </View>
  );

  // 🔹 임원 카드 컴포넌트
  const ExecCard = ({ item }: { item: Assistant }) => {
    const isCEO = item.rawPosition.includes("CEO");
    const title = isCEO ? "CEO" : "실장";
    const accent = isCEO ? "#111827" : "#10B981";
    const icon = isCEO ? "sparkles-outline" : "briefcase-outline";

    return (
      <View style={styles.execCard}>
        <View style={[styles.execRibbon, { backgroundColor: accent }]}>
          <Ionicons name={icon as any} size={14} color="#fff" />
          <Text style={styles.execRibbonText}>{title}</Text>
        </View>

        <View style={styles.execBody}>
          <View style={styles.execTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.execName}>{item.name}</Text>
              <View style={styles.execBadgeRow}>
                {item.positions.map((pos, idx) => (
                  <View key={idx} style={[styles.execBadge, { borderColor: accent }]}>
                    <Text style={[styles.execBadgeText, { color: accent }]}>{pos}</Text>
                  </View>
                ))}
              </View>
            </View>
            {!!item.startDate && (
              <View style={styles.execDatePill}>
                <Ionicons name="calendar-outline" size={14} color="#6B7280" />
                <Text style={styles.execDateText}>{item.startDate}</Text>
              </View>
            )}
          </View>

          <View style={styles.execInfoRow}>
            <View style={styles.execInfoItem}>
              <Ionicons name="call-outline" size={16} color="#4B5563" />
              <Text style={styles.execInfoText}>{item.phone || "-"}</Text>
            </View>
            {item.email ? (
              <View style={{flexDirection:'column', gap: 6}}>
                <View style={styles.execInfoItem}>
                    <Ionicons name="mail-outline" size={16} color="#4B5563" />
                    <Text style={styles.execInfoText} numberOfLines={1}>{item.email}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {(isAdmin || isManager) && <ManageActions item={item} />}

          <View style={styles.execCtaRow}>
            <TouchableOpacity style={[styles.execCtaBtn, { borderColor: accent }]} onPress={() => handleCall(item.phone)} disabled={!item.phone}>
              <Ionicons name="call" size={16} color={accent} />
              <Text style={[styles.execCtaText, { color: accent }]}>전화</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.execCtaBtn, { backgroundColor: accent, borderColor: accent }]} onPress={() => handleSms(item.phone)} disabled={!item.phone}>
              <Ionicons name="chatbubble-ellipses" size={16} color="#fff" />
              <Text style={[styles.execCtaText, { color: "#fff" }]}>문자</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (loading && !refreshing) return <View style={styles.center}><ActivityIndicator size="large" color="#4F46E5" /></View>;

  return (
    <View style={{flex: 1}}>
      <ScrollView 
        style={styles.container} 
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.pageHeader}>
          <View style={styles.pageHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>주소록</Text>
              <Text style={styles.headerDesc}>팀원 연락처 및 역할 정보입니다.</Text>
            </View>
            {(isAdmin || isManager) && (
              <TouchableOpacity style={styles.addAssistantBtn} onPress={openAddAssistantModal}>
                <Ionicons name="person-add-outline" size={17} color="#FFFFFF" />
                <Text style={styles.addAssistantText}>조교 추가</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {ceos.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>CEO</Text>
              {ceos.map((item, i) => <ExecCard key={`ceo-${i}`} item={item} />)}
          </View>
        )}

        {managers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>실장</Text>
              {managers.map((item, i) => <ExecCard key={`mgr-${i}`} item={item} />)}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>조교 ({activeAssistants.length + inactiveAssistants.length}명)</Text>

          <View style={styles.filterBox}>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>역할</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <CheckBox label="현장" value={showField} onChange={setShowField} />
                <CheckBox label="자료" value={showMaterial} onChange={setShowMaterial} />
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.collapseHeader} onPress={() => setActiveCollapsed(v => !v)}>
            <View style={styles.collapseHeaderLeft}>
              <Ionicons name={activeCollapsed ? "chevron-forward" : "chevron-down"} size={18} color="#374151" />
              <Text style={styles.collapseTitle}>현역 조교</Text>
              <Text style={styles.collapseCount}>({activeAssistants.length}명)</Text>
            </View>
          </TouchableOpacity>

          {!activeCollapsed && (
            activeAssistants.length === 0 ? <Text style={styles.emptyText}>조건에 맞는 현역 조교가 없습니다.</Text> :
            activeAssistants.map((item, i) => <StaffCard key={`active-${i}`} item={item} />)
          )}

          <TouchableOpacity style={[styles.collapseHeader, { marginTop: 10 }]} onPress={() => setInactiveCollapsed(v => !v)}>
            <View style={styles.collapseHeaderLeft}>
              <Ionicons name={inactiveCollapsed ? "chevron-forward" : "chevron-down"} size={18} color="#374151" />
              <Text style={styles.collapseTitle}>비근무 조교</Text>
              <Text style={styles.collapseCount}>({inactiveAssistants.length}명)</Text>
            </View>
          </TouchableOpacity>

          {!inactiveCollapsed && (
            inactiveAssistants.length === 0 ? <Text style={styles.emptyText}>조건에 맞는 비근무 조교가 없습니다.</Text> :
            inactiveAssistants.map((item, i) => <StaffCard key={`inactive-${i}`} item={item} />)
          )}
        </View>
      </ScrollView>

      <AssistantFormModal
        visible={assistantModalVisible}
        title={editingAssistant ? "조교 정보 수정" : "새 조교 등록"}
        values={assistantForm}
        saving={savingAssistant}
        onChange={updateAssistantForm}
        onCancel={() => setAssistantModalVisible(false)}
        onSubmit={handleSaveAssistant}
      />

      {/* ✅ 근무 기록 모달 */}
      <Modal visible={logModalVisible} animationType="slide" transparent onRequestClose={() => setLogModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalView}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{targetName} 님의 근무 기록</Text>
              <View style={styles.modalHeaderActions}>
                {(isAdmin || isManager) && (
                  <TouchableOpacity style={styles.headerIconBtn} onPress={openAddModal} accessibilityLabel="근무 기록 추가">
                    <Ionicons name="add" size={24} color="#4F46E5" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.headerIconBtn} onPress={() => setLogModalVisible(false)} accessibilityLabel="닫기">
                  <Ionicons name="close" size={24} color="#333" />
                </TouchableOpacity>
              </View>
            </View>

            {loadingLogs ? (
              <ActivityIndicator size="large" color="#4F46E5" style={{ marginVertical: 20 }} />
            ) : logRows.length === 0 ? (
              <View style={styles.emptyLog}>
                <Text style={styles.emptyLogText}>근무 기록이 없습니다.</Text>
              </View>
            ) : (
              <ScrollView style={{ width: '100%' }}>
                {/* 월 선택 Picker */}
                <View style={styles.pickerBox}>
                  <Picker selectedValue={selectedMonth} onValueChange={setSelectedMonth} style={{ height: 50 }}>
                    {monthOptions.map(m => <Picker.Item key={m} label={m} value={m} />)}
                  </Picker>
                </View>

                {selectedMonth && (
                    <>
                    <View style={styles.tableTitleRow}>
                        <Text style={styles.tableTitleText}>{selectedMonth} 요약</Text>
                    </View>
                    <View style={styles.table}>
                        <View style={styles.trHead}>
                            <Text style={styles.th}>총 시간</Text>
                            <Text style={styles.th}>횟수</Text>
                        </View>
                        <View style={styles.tr}>
                            <Text style={styles.td}>{monthSummary.totalTime}</Text>
                            <Text style={styles.td}>{monthSummary.count}회</Text>
                        </View>
                    </View>
                    
                    <View style={[styles.tableTitleRow, {marginTop: 20}]}>
                        <Text style={styles.tableTitleText}>상세 내역</Text>
                    </View>
                    <View style={styles.table}>
                        <View style={styles.trHead}>
                            <Text style={[styles.th, { flex: 0.8 }]}>날짜</Text>
                            <Text style={[styles.th, { flex: 1.2 }]}>수업</Text>
                            <Text style={styles.th}>시간</Text>
                        </View>
                        {monthRows.map((r, i) => (
                            <TouchableOpacity 
                              key={i} 
                              style={styles.tr} 
                              onPress={() => openEditModal(r)}
                              activeOpacity={0.7}
                            >
                                <Text style={[styles.td, { flex: 0.8 }]}>{r.date}</Text>
                                <Text style={[styles.td, { flex: 1.2 }]}>{r.shift}</Text>
                                <View style={{flex: 1, alignItems: 'center'}}>
                                    <Text style={[styles.td, {fontSize: 12}]}>
                                        {r.end ? `${r.start}~${r.end}` : `${r.start} (진행)`}
                                    </Text>
                                    {(isAdmin || isManager) && <Text style={{fontSize:9, color:'#4F46E5'}}>✎수정</Text>}
                                </View>
                            </TouchableOpacity>
                        ))}
                    </View>
                    </>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
      <Modal visible={editModalVisible} animationType="fade" transparent onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalView, { width: '85%' }]}>
            <Text style={styles.modalTitle}>{editingLog ? "근무 기록 수정" : "근무 기록 추가"}</Text>

            <View style={{ width: '100%', marginBottom: 20 }}>
                <Text style={styles.editLabel}>날짜</Text>
                <TextInput
                  style={[styles.editInput, editingLog && styles.readOnlyInput]}
                  value={editDate}
                  onChangeText={setEditDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9CA3AF"
                  maxLength={10}
                  editable={!editingLog}
                />

                <Text style={styles.editLabel}>수업 / 근무명</Text>
                <TextInput
                  style={[styles.editInput, editingLog && styles.readOnlyInput]}
                  value={editShift}
                  onChangeText={setEditShift}
                  placeholder="예: 경기고 통합과학"
                  placeholderTextColor="#9CA3AF"
                  editable={!editingLog}
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.editLabel}>출근</Text>
                    <TextInput 
                      style={styles.editInput} 
                      value={editStart} onChangeText={setEditStart} placeholder="HH:MM" placeholderTextColor="#9CA3AF" maxLength={5}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.editLabel}>퇴근</Text>
                    <TextInput 
                      style={styles.editInput} 
                      value={editEnd} onChangeText={setEditEnd} placeholder="HH:MM" placeholderTextColor="#9CA3AF" maxLength={5}
                    />
                  </View>
                </View>
                <Text style={{textAlign:'right', marginTop:5, color:'#4F46E5', fontWeight:'bold'}}>
                  시간: {calculateDuration(editStart, editEnd)}
                </Text>
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity disabled={savingEdit} style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setEditModalVisible(false)}>
                <Text style={styles.modalBtnTextCancel}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={savingEdit} style={[styles.modalBtn, styles.modalBtnConfirm]} onPress={handleSaveEdit}>
                {savingEdit ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnTextConfirm}>저장</Text>}
              </TouchableOpacity>
            </View>

            {editingLog && (
              <TouchableOpacity disabled={savingEdit} style={styles.deleteRecordBtn} onPress={handleDeleteLog}>
                <Ionicons name="trash-outline" size={17} color="#DC2626" />
                <Text style={styles.deleteRecordText}>이 기록 삭제</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  contentContainer: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  
  pageHeader: { padding: 20, paddingTop: 60, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", marginBottom: 10 },
  pageHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { fontSize: 24, fontWeight: "800", color: "#111" },
  headerDesc: { fontSize: 14, color: "#6B7280", marginTop: 4 },
  addAssistantBtn: { minHeight: 40, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 8, backgroundColor: '#4F46E5' },
  addAssistantText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  filterBox: { backgroundColor: "#fff", padding: 15, borderRadius: 12,marginBottom: 16,borderWidth: 1,borderColor: "#E5E7EB"},
  filterRow: { flexDirection: 'row', alignItems: 'center' },
  filterLabel: { fontSize: 14, fontWeight: "700", color: "#374151", width: 50 },
  checkboxContainer: { flexDirection: 'row', alignItems: 'center' },
  checkboxLabel: { marginLeft: 4, fontSize: 14, color: "#6B7280" },
  checkboxLabelActive: { color: "#1F2937", fontWeight: "600" },

  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#374151", marginBottom: 12, marginLeft: 4 },

  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  cardInactive: { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB", shadowOpacity: 0 },
  textInactive: { color: "#9CA3AF" },
  badgeInactive: { backgroundColor: "#9CA3AF", opacity: 0.7 },

  cardHeader: { marginBottom: 12 },
  headerTop: { flexDirection: "row", justifyContent: 'space-between', alignItems: "flex-start", marginBottom: 6 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flex: 1 },
  name: { fontSize: 17, fontWeight: "700", color: "#1F2937", marginRight: 8 },
  startDate: { fontSize: 13, color: "#6B7280", fontWeight: "500" },
  badgeContainer: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  roleContainer: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  roleBadge: { backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: "#E5E7EB" },
  roleText: { fontSize: 12, color: "#4B5563", fontWeight: "600" },
  roleBadgeInactive: { backgroundColor: "#E5E7EB", borderColor: "#D1D5DB" },
  roleTextInactive: { color: "#9CA3AF" },

  divider: { height: 1, backgroundColor: "#F3F4F6", marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 8, justifyContent: 'space-between' },
  contactItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  contactText: { fontSize: 14, color: "#4B5563", fontWeight: "500" },
  iconBtn: { padding: 4 },
  emptyText: { textAlign: "center", marginTop: 20, color: "#9CA3AF", fontSize: 14 },

  collapseHeader: { backgroundColor: "#fff", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 10 },
  collapseHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  collapseTitle: { fontSize: 15, fontWeight: "800", color: "#374151" },
  collapseCount: { fontSize: 13, color: "#6B7280", fontWeight: "600", marginLeft: 2 },

  execCard: { backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 12, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 },
  execRibbon: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  execRibbonText: { color: "#fff", fontSize: 13, fontWeight: "800", letterSpacing: 0.3 },
  execBody: { padding: 16 },
  execTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  execName: { fontSize: 20, fontWeight: "900", color: "#111827" },
  execBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  execBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, backgroundColor: "#F9FAFB" },
  execBadgeText: { fontSize: 12, fontWeight: "800" },
  execDatePill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#F3F4F6" },
  execDateText: { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  execInfoRow: { marginTop: 14, gap: 8 },
  execInfoItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  execInfoText: { fontSize: 14, fontWeight: "600", color: "#374151", flexShrink: 1 },
  execCtaRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  execCtaBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10, borderRadius: 12, borderWidth: 1, backgroundColor: "#fff" },
  execCtaText: { fontSize: 14, fontWeight: "800" },

  logBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EEF2FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, alignSelf: 'flex-start', marginLeft: 24, marginTop: -4 },
  logBtnText: { fontSize: 12, fontWeight: '700', color: '#4F46E5', marginLeft: 4 },
  
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  modalView: { width: "90%", maxHeight: "85%", backgroundColor: "white", borderRadius: 16, padding: 20, alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  modalHeader: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 18, fontWeight: "bold", color: "#111" },
  emptyLog: { padding: 30, alignItems: 'center' },
  emptyLogText: { color: '#999' },
  
  pickerBox: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, overflow: 'hidden', marginBottom: 20, backgroundColor: '#fff' },
  tableTitleRow: { marginBottom: 8 },
  tableTitleText: { fontSize: 15, fontWeight: '700', color: '#333' },
  
  table: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, overflow: 'hidden' },
  trHead: { flexDirection: 'row', backgroundColor: '#f9f9f9', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingVertical: 12 },
  th: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700', color: '#555' },
  td: { flex: 1, textAlign: 'center', fontSize: 13, color: '#333' },

  modalBtnRow: { flexDirection: "row", gap: 10, width: "100%", marginTop: 20 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center", justifyContent: 'center' },
  modalBtnCancel: { backgroundColor: "#E5E7EB" },
  modalBtnConfirm: { backgroundColor: "#4F46E5" },
  modalBtnTextCancel: { color: "#374151", fontWeight: "700", fontSize: 14 },
  modalBtnTextConfirm: { color: "white", fontWeight: "700", fontSize: 14 },
  roleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  manageActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  smallManageBtn: { minHeight: 32, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#F3F4F6', borderRadius: 6, borderWidth: 1, borderColor: '#D1D5DB' },
  smallManageText: { fontSize: 11, fontWeight: '700', color: '#374151' },
  smallLogBtn: { minHeight: 32, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#EEF2FF', borderRadius: 6, borderWidth: 1, borderColor: '#C7D2FE' },
  smallLogBtnText: { fontSize: 11, fontWeight: '700', color: '#4F46E5' },
  editLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4, marginTop: 10 },
  editInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 10, fontSize: 16, backgroundColor: '#F9FAFB', color: '#111' },
  readOnlyInput: { backgroundColor: '#F3F4F6', color: '#6B7280' },
  deleteRecordBtn: { width: '100%', minHeight: 44, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FEF2F2', borderRadius: 8 },
  deleteRecordText: { color: '#DC2626', fontSize: 14, fontWeight: '700' },
});
