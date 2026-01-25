// [파일] 탭
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, Platform, TouchableOpacity, Linking, Image } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import Ionicons from '@expo/vector-icons/Ionicons';

const TARGET_FOLDER_NAME = "김연주쌤 과학";

export default function FilesScreen() {
  const [loading, setLoading] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [isTargetMissing, setIsTargetMissing] = useState(false);

  useEffect(() => {
    findTargetFolderId();
  }, []);

  // 액세스 토큰 가져오기 (Drive API용)
  const getAccessToken = async () => {
    if (Platform.OS === 'web') {
      const token = localStorage.getItem('google_access_token');
      if (!token) throw new Error('인증 토큰이 없습니다. 로그인 탭에서 다시 로그인해주세요.');
      return token;
    } else {
      // ✅ 앱에서는 GoogleSignin을 통해 Access Token을 직접 받아옵니다.
      const tokens = await GoogleSignin.getTokens();
      return tokens.accessToken;
    }
  };

  // 폴더 ID 찾기
  const findTargetFolderId = async () => {
    setLoading(true);
    setIsTargetMissing(false);

    try {
      const token = await getAccessToken();
      
      // 1. 쿼리: 이름 일치 + 폴더 타입 + 중요문서함(Star) + 휴지통 아님
      const query = `name = '${TARGET_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and starred = true and trashed = false`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
      
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const result = await response.json();

      if (result.files && result.files.length > 0) {
        setFolderId(result.files[0].id);
      } else {
        setIsTargetMissing(true);
      }
    } catch (error: any) {
      console.error("[Drive API Error]", error);
    } finally {
      setLoading(false);
    }
  };

  const openGoogleDrive = () => {
    let url = 'https://drive.google.com/drive/my-drive';
    if (folderId) {
      url = `https://drive.google.com/drive/folders/${folderId}`;
    }

    Linking.openURL(url).catch(err => {
      Alert.alert('오류', '구글 드라이브를 열 수 없습니다.');
    });
  };

  // 1. 폴더 미발견 (안내 화면)
  if (isTargetMissing) {
    return (
      <View style={styles.container}>
        <Ionicons name="alert-circle-outline" size={80} color="#FBBC04" style={{ marginBottom: 20 }} />
        <Text style={styles.title}>폴더 연결 필요</Text>
        <Text style={styles.desc}>
          구글 드라이브에서{"\n"}
          <Text style={{ fontWeight: 'bold' }}>'{TARGET_FOLDER_NAME}'</Text> 폴더를{"\n"}
          중요 문서함(별표)에 추가해주세요.
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={findTargetFolderId}>
          <Text style={styles.retryText}>확인 후 다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 2. 정상 화면
  return (
    <View style={styles.container}>
      <Image
        source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/d/da/Google_Drive_logo_%282020-present%29.png' }}
        style={styles.logo}
        resizeMode="contain"
      />

      <Text style={styles.title}>수업 자료실</Text>
      <Text style={styles.desc}>
        {loading ? "폴더 위치를 확인 중입니다..." : "모든 수업 자료는 구글 드라이브에서\n확인하고 다운로드할 수 있습니다."}
      </Text>

      {loading ? (
        <ActivityIndicator size="large" color="#4285F4" style={{ marginTop: 30 }} />
      ) : (
        <TouchableOpacity style={styles.mainButton} onPress={openGoogleDrive} activeOpacity={0.8}>
          <Ionicons name="logo-google" size={24} color="white" style={{ marginRight: 10 }} />
          <Text style={styles.buttonText}>구글 드라이브 열기</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.subText}>
        {Platform.OS === 'web' ? '새 탭에서 드라이브가 열립니다.' : '구글 드라이브 앱으로 연결됩니다.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', padding: 30 },
  logo: { width: 100, height: 100, marginBottom: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  desc: { fontSize: 16, color: '#666', textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  mainButton: {
    backgroundColor: '#4285F4', flexDirection: 'row', alignItems: 'center',
    paddingVertical: 15, paddingHorizontal: 40, borderRadius: 30,
    elevation: 5, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 5,
  },
  buttonText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  subText: { marginTop: 20, fontSize: 13, color: '#999' },
  retryButton: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 20, backgroundColor: '#eee', borderRadius: 8 },
  retryText: { color: '#333', fontWeight: '600' }
});