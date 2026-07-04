// [문의] 탭
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, Platform, RefreshControl } from 'react-native';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';

// Utils & Config
import { getCurrentUserEmail } from "../../utils/currentUser";
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { postSheetData } from "../../utils/sheetApi";
import { CSV_URLS, API_URLS, SHEET_NAMES, ASSISTANT_HEADERS, PERMISSION_HEADERS, INQUIRY_HEADERS } from "../../config/sheetConfig";

export default function InquiryScreen() {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  
  // 유저 정보 State
  const [userName, setUserName] = useState("로딩 중...");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("");

  // 관리자용 State
  const [inquiryList, setInquiryList] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  
  // 필터 상태 (ALL | X | O)
  const [filterStatus, setFilterStatus] = useState<"ALL" | "X" | "O">("ALL");

  // 1. 내 정보 가져오기 & 권한 확인
  useEffect(() => {
    const loadUserInfo = async () => {
      const email = getCurrentUserEmail();
      if (email) {
        setUserEmail(email);
        try {
          const [assistantData, permData] = await Promise.all([
            fetchSheetData(CSV_URLS.ASSISTANT_INFO),
            fetchSheetData(CSV_URLS.PERMISSIONS)
          ]);

          if (Array.isArray(assistantData)) {
            const myRecord = assistantData.find((r: any) => 
              String(r[ASSISTANT_HEADERS.EMAIL] || "").trim().toLowerCase() === email.trim().toLowerCase()
            );
            if (myRecord) {
              setUserName(String(myRecord[ASSISTANT_HEADERS.NAME] || "이름 없음"));
            } else {
              setUserName("정보 없음");
            }
          }

          if (Array.isArray(permData)) {
            const myPerm = permData.find((r: any) => 
               String(r[PERMISSION_HEADERS.EMAIL] || "").trim().toLowerCase() === email.trim().toLowerCase()
            );
            
            if (myPerm) {
              const role = String(myPerm[PERMISSION_HEADERS.ROLE] || "");
              if (role === 'Admin' || role === 'Manager') {
                setUserRole(role); 
              }
              fetchInquiries(); 
            }
          }

        } catch (e) {
          console.error(e);
          setUserName("조회 실패");
        }
      } else {
        setUserName("비로그인");
      }
    };
    loadUserInfo();
  }, []);

  // 2. 문의 내역 불러오기
  const fetchInquiries = async () => {
    try {
      const data = await fetchSheetData(`${CSV_URLS.INQUIRY}&t=${Date.now()}`);
      if (Array.isArray(data)) {
        setInquiryList(data.reverse());
      }
    } catch (e) {
      console.error("문의 리스트 로드 실패", e);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchInquiries(); 
    setRefreshing(false);
  }, [userRole]);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // 3. 문의 제출 핸들러
  const handleSubmit = async () => {
    if (!content.trim()) {
      showAlert("알림", "문의 내용을 입력해주세요.");
      return;
    }

    setSending(true);
    try {
      const res = await postSheetData(API_URLS.ASSISTANT_MGMT, SHEET_NAMES.INQUIRY, {
        action: "submit_inquiry",
        name: userName,
        email: userEmail,
        content: content
      });

      if (res.ok) {
        showAlert("접수 완료", "문의 내용이 성공적으로 접수되었습니다.");
        setContent(""); 
        fetchInquiries();
      } else {
        showAlert("전송 실패", res.error || "알 수 없는 오류가 발생했습니다.");
      }
      
    } catch (e) {
      console.error(e);
      showAlert("오류", "전송 중 문제가 발생했습니다.");
    } finally {
      setSending(false);
    }
  };

  // 4. 문의 해결 처리 (X -> O)
  // 4. 문의 해결 처리 (ID 기반 수정)
  const handleSolve = async (item: any) => {

    const id = item[INQUIRY_HEADERS.ID]; 
    const status = String(item[INQUIRY_HEADERS.STATUS] || "").trim();

    // ID가 없는 경우(예전 데이터 등) 방어 코드
    if (!id) {
      showAlert("오류", "문의 ID를 찾을 수 없습니다.");
      return;
    }

    if (status === "O") return; // 이미 해결됨

    if (Platform.OS === 'web') {
      if (!window.confirm("이 문의를 '해결(O)' 상태로 변경하시겠습니까?")) return;
    }

    try {

      setInquiryList(prev => prev.map(row => {
        if (String(row[INQUIRY_HEADERS.ID]) === String(id)) {
          return { ...row, [INQUIRY_HEADERS.STATUS]: "O" };
        }
        return row;
      }));

      // 서버에 ID 전송
      const res = await postSheetData(API_URLS.ASSISTANT_MGMT, SHEET_NAMES.INQUIRY, {
        action: "solve_inquiry",
        id: id  
      });

      if (!res.ok) {
        showAlert("오류", "상태 변경 실패: " + res.error);
        fetchInquiries(); // 실패 시 목록 원상복구
      }
    } catch (e) {
      showAlert("오류", "요청 중 오류 발생");
      fetchInquiries();
    }
  };

  // 필터링된 리스트 계산
  const filteredList = useMemo(() => {
    if (filterStatus === "ALL") return inquiryList;
    return inquiryList.filter(item => {
      const status = String(item[INQUIRY_HEADERS.STATUS] || "X").trim();
      if (filterStatus === "O") return status === "O";
      if (filterStatus === "X") return status !== "O"; // 빈값도 미해결로 간주
      return true;
    });
  }, [inquiryList, filterStatus]);

  const myInquiryList = useMemo(() => {
    return inquiryList.filter(item => {
      // 혹시 config에 이메일 헤더가 어떻게 되어있을지 몰라 안전하게 여러 키워드 탐색
      const rowEmail = String(item[INQUIRY_HEADERS.EMAIL] || item["이메일"] || item["Email"] || "").trim();
      return rowEmail.toLowerCase() === userEmail.toLowerCase();
    });
  }, [inquiryList, userEmail]);

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.headerRow}>
        <FontAwesome5 name="question-circle" size={24} color="#333" />
        <Text style={styles.headerTitle}>문의하기</Text>
      </View>
      <Text style={styles.subTitle}>건의사항이나 궁금한 점을 남겨주세요.</Text>

      {/* 내 정보 */}
      <View style={styles.profileCard}>
        <View style={styles.profileRow}>
            <Text style={styles.profileLabel}>이름</Text>
            <Text style={styles.profileValue}>{userName}</Text>
        </View>
        <View style={styles.profileRow}>
            <Text style={styles.profileLabel}>이메일</Text>
            <Text style={styles.profileValue}>{userEmail}</Text>
        </View>
      </View>

      {/* 입력 폼 */}
      <View style={styles.formCard}>
        <Text style={styles.label}>문의 내용</Text>
        <TextInput 
          style={[styles.input, styles.textArea]} 
          placeholder="문의 내용을 자세히 적어주세요." 
          placeholderTextColor="#9CA3AF"
          multiline numberOfLines={6} textAlignVertical="top"
          value={content} onChangeText={setContent}
        />

        <Pressable 
          style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.8 }]} 
          onPress={handleSubmit}
          disabled={sending}
        >
          {sending ? <ActivityIndicator color="white" /> : <Text style={styles.submitBtnText}>문의 접수</Text>}
        </Pressable>
      </View>

      <View style={{ marginTop: 10, marginBottom: userRole ? 10 : 40 }}>
        <Text style={[styles.managerTitle, { marginBottom: 12 }]}>내 문의 내역</Text>
        {myInquiryList.length === 0 ? (
          <Text style={{ textAlign: 'center', color: '#999', marginVertical: 20 }}>등록한 문의가 없습니다.</Text>
        ) : (
          myInquiryList.map((item, idx) => {
            const isSolved = String(item[INQUIRY_HEADERS.STATUS] || "").trim() === "O";
            return (
              <View key={`my-${idx}`} style={[styles.inquiryItem, isSolved && { opacity: 0.6, backgroundColor: '#F3F4F6' }]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.inquiryDate}>{String(item[INQUIRY_HEADERS.DATE] || "").slice(5, 16)}</Text>
                  <Text style={[styles.inquiryContent, { marginTop: 4 }]}>{item[INQUIRY_HEADERS.CONTENT]}</Text>
                </View>
                <View style={[styles.statusBadge, isSolved ? styles.statusO : styles.statusX]}>
                  <Text style={[styles.statusText, isSolved ? {color:'#065F46'} : {color:'#991B1B'}]}>
                    {isSolved ? "해결됨" : "접수됨"}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      {(userRole === 'Admin' || userRole === 'Manager') && (
        <View style={{ marginTop: 24, marginBottom: 40 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <FontAwesome5 name="user-shield" size={16} color="#4F46E5" style={{marginRight: 8}}/>
            <Text style={styles.managerTitle}>문의 관리 ({userRole})</Text>
          </View>

          <View style={styles.filterRow}>
            <Pressable 
              style={[styles.chip, filterStatus === 'ALL' && styles.chipActive]} 
              onPress={() => setFilterStatus('ALL')}
            >
              <Text style={[styles.chipText, filterStatus === 'ALL' && styles.chipTextActive]}>전체</Text>
            </Pressable>
            <Pressable 
              style={[styles.chip, filterStatus === 'X' && styles.chipActive]} 
              onPress={() => setFilterStatus('X')}
            >
              <Text style={[styles.chipText, filterStatus === 'X' && styles.chipTextActive]}>미해결</Text>
            </Pressable>
            <Pressable 
              style={[styles.chip, filterStatus === 'O' && styles.chipActive]} 
              onPress={() => setFilterStatus('O')}
            >
              <Text style={[styles.chipText, filterStatus === 'O' && styles.chipTextActive]}>해결됨</Text>
            </Pressable>
          </View>
          
          {filteredList.length === 0 ? (
            <Text style={{ textAlign: 'center', color: '#999', marginVertical: 20 }}>내역이 없습니다.</Text>
          ) : (
            filteredList.map((item, idx) => {
              const isSolved = String(item[INQUIRY_HEADERS.STATUS] || "").trim() === "O";
              
              return (
                <View key={idx} style={[styles.inquiryItem, isSolved && { opacity: 0.6, backgroundColor: '#F3F4F6' }]}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={styles.inquiryName}>{item[INQUIRY_HEADERS.NAME]}</Text>
                      <Text style={styles.inquiryDate}>{String(item[INQUIRY_HEADERS.DATE] || "").slice(5, 16)}</Text>
                    </View>
                    <Text style={styles.inquiryContent}>{item[INQUIRY_HEADERS.CONTENT]}</Text>
                  </View>
                  
                  <Pressable 
                    onPress={() => handleSolve(item)} 
                    style={[styles.statusBadge, isSolved ? styles.statusO : styles.statusX]}
                  >
                    <Text style={[styles.statusText, isSolved ? {color:'#065F46'} : {color:'#991B1B'}]}>
                      {isSolved ? "해결됨" : "미해결"}
                    </Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#F6F7FB' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 5 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#111' },
  subTitle: { fontSize: 14, color: '#666', marginBottom: 20, marginLeft: 2 },
  
  profileCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  profileRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  profileLabel: { fontSize: 14, color: '#6B7280', fontWeight: '600' },
  profileValue: { fontSize: 14, color: '#111827', fontWeight: 'bold' },

  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20, elevation: 2, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 8 },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 15, marginBottom: 16 },
  textArea: { minHeight: 120 },
  
  submitBtn: { backgroundColor: '#4F46E5', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 5 },
  submitBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },

  // 관리자 리스트 스타일
  managerTitle: { fontSize: 18, fontWeight: '800', color: '#111' },
  inquiryItem: { flexDirection: 'row', backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee', alignItems: 'center' },
  inquiryName: { fontSize: 15, fontWeight: '700', color: '#333' },
  inquiryDate: { fontSize: 13, color: '#999' },
  inquiryContent: { fontSize: 14, color: '#555', lineHeight: 20 },
  
  statusBadge: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  statusX: { backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FECaca' }, 
  statusO: { backgroundColor: '#D1FAE5', borderWidth: 1, borderColor: '#A7F3D0' }, 
  statusText: { fontSize: 12, fontWeight: '700' },

  // 필터 칩 스타일
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 15 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#E5E7EB' },
  chipActive: { backgroundColor: '#4F46E5' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#4B5563' },
  chipTextActive: { color: '#fff' },
});