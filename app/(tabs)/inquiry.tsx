// app/(tabs)/inquiry.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';

// 필요하다면 기존 유틸리티/설정 import
// import { postSheetData } from "../../utils/sheetApi";
// import { API_URLS, SHEET_NAMES } from "../../config/sheetConfig";
// import { getCurrentUserEmail } from "../../utils/currentUser";

export default function InquiryScreen() {
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  // 문의 전송 핸들러 (나중에 API 연결)
  const handleSubmit = async () => {
    if (!subject.trim() || !content.trim()) {
      Alert.alert("알림", "제목과 내용을 모두 입력해주세요.");
      return;
    }

    setSending(true);
    try {
      // TODO: 여기에 실제 전송 로직 구현 (구글 시트 or 이메일 전송)
      // await postSheetData(...)

      // 임시 성공 처리
      await new Promise(resolve => setTimeout(resolve, 1000)); 
      Alert.alert("접수 완료", "문의 내용이 성공적으로 접수되었습니다.");
      setSubject("");
      setContent("");
      
    } catch (e) {
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

      <View style={styles.formCard}>
        <Text style={styles.label}>제목</Text>
        <TextInput 
          style={styles.input} 
          placeholder="제목을 입력하세요" 
          value={subject}
          onChangeText={setSubject}
        />

        <Text style={styles.label}>내용</Text>
        <TextInput 
          style={[styles.input, styles.textArea]} 
          placeholder="문의 내용을 자세히 적어주세요" 
          multiline 
          numberOfLines={6}
          textAlignVertical="top"
          value={content}
          onChangeText={setContent}
        />

        <Pressable 
          style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.8 }]} 
          onPress={handleSubmit}
          disabled={sending}
        >
          {sending ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.submitBtnText}>문의 접수</Text>
          )}
        </Pressable>
      </View>

      {/* 추가 정보 카드 (예: 연락처) */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>📞 관리자 연락처</Text>
        <Text style={styles.infoText}>010-1234-5678</Text>
        <Text style={styles.infoText}>admin@example.com</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#F6F7FB' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 5 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#111' },
  subTitle: { fontSize: 14, color: '#666', marginBottom: 20, marginLeft: 2 },
  
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20, elevation: 2, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 6 },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 15, marginBottom: 16 },
  textArea: { minHeight: 120 },
  
  submitBtn: { backgroundColor: '#4F46E5', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },

  infoCard: { backgroundColor: '#EEF2FF', borderRadius: 12, padding: 20, borderTopWidth: 4, borderTopColor: '#4F46E5' },
  infoTitle: { fontSize: 16, fontWeight: '700', color: '#312E81', marginBottom: 10 },
  infoText: { fontSize: 14, color: '#4338CA', marginBottom: 4 },
});