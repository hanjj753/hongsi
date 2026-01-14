import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform, Image, TouchableOpacity, Alert, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

import auth from '@react-native-firebase/auth';
import { signOut } from 'firebase/auth';
import { webAuth } from '../../firebaseConfig';

import { Picker } from '@react-native-picker/picker';
import { fetchSheetData } from "../utils/googleSheet_csv";

const WORK_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ1HbWFSWxfgzLh2q2R9NW2HuqPbJIFMVCndtmsr_awDT6HGsrXYCyBhgIX-0KPKa7-hMU-fo-sm_w-/pub?gid=531970902&single=true&output=csv";

type WorkRow = {
  date: string;
  shift: string;
  start: string;
  end: string;
  work: string;
  email: string;
};

function formatDateYYYYMMDD(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}. ${m}. ${d}`;
}

function parseSheetDate(dateStr: string): Date | null {
  // "2025. 12. 3" / "2025.12.03" / "2025. 1. 13" 모두 처리
  const cleaned = String(dateStr || "").replace(/\s/g, ""); // 공백 제거
  const m = cleaned.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);

  const dt = new Date(y, mo, d);
  return isNaN(dt.getTime()) ? null : dt;
}

function toYYMM(dt: Date): string {
  const yy = String(dt.getFullYear()).slice(-2);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function durationToSeconds(s: string): number {
  const parts = String(s || "").split(':').map(v => v.trim()).filter(Boolean);
  if (parts.length === 3) {
    const [h, m, sec] = parts.map(Number);
    return (h || 0) * 3600 + (m || 0) * 60 + (sec || 0);
  }
  if (parts.length === 2) {
    const [h, m] = parts.map(Number);
    return (h || 0) * 3600 + (m || 0) * 60;
  }
  return 0;
}

function secondsToHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function HomeScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  const [rows, setRows] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedMonth, setSelectedMonth] = useState<string>("");

  // ✅ 로그인 유저 세팅
  useEffect(() => {
    if (Platform.OS === 'web') {
      const currentUser = webAuth.currentUser;
      if (currentUser) setUser(currentUser);
    } else {
      const currentUser = auth().currentUser;
      if (currentUser) setUser(currentUser);
    }
  }, []);

  // ✅ ClassScreen과 동일: load() 함수로 CSV 가져오기
  const load = useCallback(async () => {
    if (!user?.email) return;

    const data = await fetchSheetData(WORK_CSV_URL);

    // ✅ CSV 헤더명을 "근무 기록지" 시트 헤더와 동일하게 사용
    // 스샷 기준: 근무 일자 / 반 / Email / 출근 시간 / 퇴근 시간 / 근무 시간
    const cleaned = (data || []).filter((r: any) => r && (r["근무 일자"] || r["Email"]));

    // ✅ "나" 필터링 + 필요한 필드만 표준화
    const myRows: WorkRow[] = cleaned
      .filter((r: any) => String(r["Email"] ?? "").trim().toLowerCase() === user.email.toLowerCase())
      .map((r: any) => ({
        date: String(r["근무 일자"] ?? "").trim(),
        shift: String(r["반"] ?? "").trim(),
        start: String(r["출근 시간"] ?? "").trim(),
        end: String(r["퇴근 시간"] ?? "").trim(),
        work: String(r["근무 시간"] ?? "").trim(),
        email: String(r["Email"] ?? "").trim(),
      }))
      // 날짜 파싱 가능한 것만
      .map(r => ({ ...r, _dt: parseSheetDate(r.date) as any }))
      .filter((r: any) => r._dt)
      // 최신순 정렬
      .sort((a: any, b: any) => (b._dt as Date).getTime() - (a._dt as Date).getTime())
      .map(({ _dt, ...rest }: any) => rest);

      // console.log("raw rows count:", (data || []).length);
      // console.log("cleaned count:", cleaned.length);
      // console.log("first row:", cleaned[0]);
      // console.log("keys:", cleaned[0] ? Object.keys(cleaned[0]) : []);
      // console.log("matched count:", myRows.length);

    setRows(myRows);
  }, [user?.email]);

  // ✅ 처음 로드
  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        Alert.alert("근무 데이터 불러오기 실패", e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  // ✅ 당겨서 새로고침
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (e: any) {
      Alert.alert("새로고침 실패", e.message);
    } finally {
      setRefreshing(false);
    }
  };

  // ✅ monthOptions = 내가 근무한 달만
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const dt = parseSheetDate(r.date);
      if (!dt) continue;
      set.add(toYYMM(dt));
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [rows]);

  // ✅ 기본 선택 월 자동 지정
  useEffect(() => {
    if (!selectedMonth && monthOptions.length > 0) {
      setSelectedMonth(monthOptions[0]);
    }
  }, [monthOptions, selectedMonth]);

  // ✅ 선택 월 필터 (로컬)
  const monthRows = useMemo(() => {
    if (!selectedMonth) return [];
    return rows.filter(r => {
      const dt = parseSheetDate(r.date);
      if (!dt) return false;
      return toYYMM(dt) === selectedMonth;
    });
  }, [rows, selectedMonth]);

  const monthSummary = useMemo(() => {
    const count = monthRows.length;
    const totalSeconds = monthRows.reduce((acc, r) => acc + durationToSeconds(r.work || "0:00:00"), 0);
    return {
      workCount: count,
      totalWork: secondsToHMS(totalSeconds),
      expectedPay: "-" // 계산 안 함
    };
  }, [monthRows]);

  const handleLogout = async () => {
    try {
      if (Platform.OS === 'web') {
        await signOut(webAuth);
        window.location.href = '/';
        return;
      } else {
        await auth().signOut();
        if (router.canDismiss()) router.dismissAll();
        router.replace('/');
      }
    } catch (error: any) {
      Alert.alert('로그아웃 실패', error.message);
    }
  };

  const titleMonth = selectedMonth || "-- --";

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.headerTitle}>마이 페이지</Text>

      {user ? (
        <View style={styles.profileCard}>
          {user.photoURL && <Image source={{ uri: user.photoURL }} style={styles.avatar} />}

          <Text style={styles.label}>이름</Text>
          <Text style={styles.info}>{user.displayName || '이름 없음'}</Text>

          <Text style={styles.label}>이메일</Text>
          <Text style={styles.info}>{user.email}</Text>

          {/* 월 선택 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>월 선택</Text>

            {monthOptions.length === 0 ? (
              <Text style={styles.loadingText}>근무 기록이 없습니다.</Text>
            ) : (
              <View style={styles.pickerBox}>
                <Picker
                  selectedValue={selectedMonth}
                  onValueChange={(v) => setSelectedMonth(String(v))}
                  style={styles.picker}
                >
                  {monthOptions.map(m => (
                    <Picker.Item key={m} label={m} value={m} />
                  ))}
                </Picker>
              </View>
            )}
          </View>

          {/* 근무 요약 */}
          {monthOptions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.tableTitle}>{titleMonth} 근무 요약</Text>

              <View style={styles.table}>
                <View style={styles.rowHeader}>
                  <Text style={[styles.cell, styles.headerCell]}>근무 시간</Text>
                  <Text style={[styles.cell, styles.headerCell]}>근무 횟수</Text>
                  <Text style={[styles.cell, styles.headerCell]}>예상 급여</Text>
                </View>

                <View style={styles.row}>
                  <Text style={styles.cell}>{monthSummary.totalWork}</Text>
                  <Text style={styles.cell}>{monthSummary.workCount}</Text>
                  <Text style={styles.cell}>{monthSummary.expectedPay}</Text>
                </View>
              </View>
            </View>
          )}

          {/* 근무 기록 표 */}
          {monthOptions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.tableTitle}>{titleMonth} 근무 기록</Text>

              <View style={styles.table}>
                <View style={styles.rowHeader}>
                  <Text style={[styles.cell2, styles.headerCell]}>근무 일자</Text>
                  <Text style={[styles.cell2, styles.headerCell]}>반</Text>
                  <Text style={[styles.cell2, styles.headerCell]}>근무 시간</Text>
                  <Text style={[styles.cell2, styles.headerCell]}>출근 시간</Text>
                  <Text style={[styles.cell2, styles.headerCell]}>퇴근 시간</Text>
                </View>

                {/* ✅ 여기부터: 표 내용만 고정 높이 + 내부 스크롤 */}
                <View style={styles.tableBodyBox}>
                  {monthRows.length === 0 ? (
                    <View style={styles.row}>
                      <Text style={[styles.cellFull, styles.loadingText]}>해당 월 기록이 없습니다.</Text>
                    </View>
                  ) : (
                    <ScrollView
                      style={styles.tableBodyScroll}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                    >
                      {monthRows.map((r, idx) => (
                        <View style={styles.row} key={`${r.date}-${idx}`}>
                          <Text style={styles.cell2}>{r.date}</Text>
                          <Text style={styles.cell2}>{r.shift}</Text>
                          <Text style={styles.cell2}>{r.work}</Text>
                          <Text style={styles.cell2}>{r.start}</Text>
                          <Text style={styles.cell2}>{r.end}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
                {/* ✅ 여기까지 */}
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text>로그인 정보를 불러오는 중...</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  profileCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 12,
    backgroundColor: '#eee',
  },
  label: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
    marginTop: 10,
  },
  info: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },

  section: { width: '100%', marginTop: 18 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 8 },
  loadingText: { color: '#777', fontSize: 13 },

  pickerBox: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  picker: { width: '100%', height: 44 },

  tableTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 10 },
  table: { borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 12, overflow: 'hidden' },
  rowHeader: { flexDirection: 'row', backgroundColor: '#f2f2f2' },
  row: { flexDirection: 'row', backgroundColor: '#fff' },

  cell: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 13,
    textAlign: 'center',
    borderRightWidth: 1,
    borderRightColor: '#eee',
  },
  cell2: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    fontSize: 12,
    textAlign: 'center',
    borderRightWidth: 1,
    borderRightColor: '#eee',
  },
  cellFull: {
    flex: 5,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 13,
    textAlign: 'center',
  },
  headerCell: { fontWeight: '800', color: '#333' },

  logoutButton: {
    marginTop: 20,
    backgroundColor: '#FF5A5F',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 8,
  },
  logoutText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  tableBodyBox: {
    maxHeight: 150,   // 원하는 표의 최대 높이(px).
  },

  tableBodyScroll: {
    flexGrow: 0,      // 내부 ScrollView가 무한 확장되지 않게
  },
});
