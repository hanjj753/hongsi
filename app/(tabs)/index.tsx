// [홈] 탭
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform, Image, TouchableOpacity, Alert, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Picker } from '@react-native-picker/picker';

// Firebase & Auth
import auth from '@react-native-firebase/auth';
import { signOut } from 'firebase/auth';
import { webAuth } from '../../firebaseConfig'; // 여긴 ../../가 맞을 수 있습니다 (프로젝트 구조에 따라 확인 필요)

// Utils & Config
import { getCurrentUserEmail } from '../../utils/currentUser';
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { CSV_URLS, ATTENDANCE_LOG_HEADERS } from "../../utils/sheetConfig";

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

  // 1. 로그인 유저 확인
  useEffect(() => {
    const u = Platform.OS === 'web' ? webAuth.currentUser : auth().currentUser;
    setUser(u);
  }, []);

  // 2. 근무 기록 로드
  const load = useCallback(async () => {
    const email = getCurrentUserEmail();
    if (!email) return;

    // sheetConfig의 ATTENDANCE_LOG URL 사용
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
    setRefreshing(false);
  };

  // 3. 월별 필터 옵션
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

  // 4. 선택된 월 요약
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

  // 5. 로그아웃
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
      Alert.alert('로그아웃 실패', error.message);
    }
  };

  if (loading && !refreshing) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  return (
    <ScrollView 
      contentContainerStyle={styles.container} 
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.headerTitle}>마이 페이지</Text>

      {user && (
        <View style={styles.card}>
          {user.photoURL && <Image source={{ uri: user.photoURL }} style={styles.avatar} />}
          <View style={styles.row}>
            <InfoItem label="이름" value={user.displayName || "이름 없음"} />
            <InfoItem label="이메일" value={user.email} />
          </View>

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

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
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
});