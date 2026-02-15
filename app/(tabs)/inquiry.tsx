// app/(tabs)/inquiry.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';

import { getCurrentUserEmail } from "../../utils/currentUser";
import { fetchSheetData } from "../../utils/googleSheet_csv";
import { postSheetData } from "../../utils/sheetApi";
import { CSV_URLS, API_URLS, SHEET_NAMES, ASSISTANT_HEADERS } from "../../config/sheetConfig";

export default function InquiryScreen() {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  // 사용자 정보 State
  const [userName, setUserName] = useState("로딩 중...");
  const [userEmail, setUserEmail] = useState("");

  // 화면이 열릴 때 내 정보(이름, 이메일) 가져오기
  useEffect(() => {
    const loadUserInfo = async () => {
      const email = getCurrentUserEmail();
      if (email) {
        setUserEmail(email);
        try {
          const data = await fetchSheetData(CSV_URLS.ASSISTANT_INFO);
          if (Array.isArray(data)) {
            const myRecord = data.find((r: any) => 
              String(r[ASSISTANT_HEADERS.EMAIL] || "").trim().toLowerCase() === email.trim().toLowerCase()
            );
            if (myRecord) {
              setUserName(String(myRecord[ASSISTANT_HEADERS.NAME] || "이름 없음"));
            } else {
              setUserName("정보 없음");
            }
          }
        } catch (e) {
          setUserName("조회 실패");
        }
      } else {
        setUserName("비로그인");
      }
    };
    loadUserInfo();
  }, []);

  const handleSubmit = async () => {
    if (!content.trim()) {
      Alert.alert("알림", "문의 내용을 입력해주세요.");
      return;
    }

    setSending(true);
    try {
      // ✅ [수정] 실제 전송 로직 구현
      const res = await postSheetData(API_URLS.ASSISTANT_MGMT, SHEET_NAMES.INQUIRY, {
        action: "submit_inquiry",
        name: userName,
        email: userEmail,
        content: content
      });

      if (res.ok) {
        Alert.alert("접수 완료", "문의 내용이 성공적으로 접수되었습니다.");
        setContent(""); // 내용 초기화
      } else {
        Alert.alert("전송 실패", res.error || "알 수 없는 오류가 발생했습니다.");
      }
      
    } catch (e) {
      console.error(e);
      Alert.alert("오류", "전송 중 문제가 발생했습니다.");
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <FontAwesome5 name="question-circle" size={24} color="#333" />
        <Text style={styles.headerTitle}>문의하기</Text>
      </View>
      <Text style={styles.subTitle}>건의사항이나 궁금한 점을 남겨주세요.</Text>

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

      <View style={styles.formCard}>
        <Text style={styles.label}>문의 내용</Text>
        <TextInput 
          style={[styles.input, styles.textArea]} 
          placeholder="문의 내용을 자세히 적어주세요" 
          multiline numberOfLines={8} textAlignVertical="top"
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
  textArea: { minHeight: 150 },
  submitBtn: { backgroundColor: '#4F46E5', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 5 },
  submitBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
  infoCard: { backgroundColor: '#EEF2FF', borderRadius: 12, padding: 20, borderTopWidth: 4, borderTopColor: '#4F46E5' },
  infoTitle: { fontSize: 16, fontWeight: '700', color: '#312E81', marginBottom: 10 },
  infoText: { fontSize: 14, color: '#4338CA', marginBottom: 4 },
});