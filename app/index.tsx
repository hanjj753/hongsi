import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons'; // 아이콘 사용

import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged as onWebAuthStateChanged, signOut } from 'firebase/auth';
import { webAuth } from '../firebaseConfig';
import { isSupabaseDataSource } from '../config/dataSource';
import { useAppAccess } from '../contexts/AppAccessContext';

export default function LoginScreen() {
  const router = useRouter();
  const { state: accessState, errorMessage: accessError, refreshAccess } = useAppAccess();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const loginInProgress = useRef(false);

  useEffect(() => {
    if (isSupabaseDataSource && accessState === 'signed_out') setInitializing(false);
  }, [accessState]);

  // Supabase mode must wait for the Firebase user to be checked against the
  // staff/access tables before entering the protected tab navigator. Routing
  // immediately after the popup can race with the gate's signed-out state and
  // bounce the user back to this screen.
  useEffect(() => {
    if (!isSupabaseDataSource || !webAuth.currentUser) return;
    if (accessState !== 'checking' && accessState !== 'signed_out') {
      router.replace('/(tabs)');
    }
  }, [accessState, router]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return onWebAuthStateChanged(webAuth, async (user) => {
        try {
          if (user) {
            if (isSupabaseDataSource) {
              // AppAccessProvider performs the access check. The effect above
              // navigates only after that check reaches a final state.
            } else {
              const token = localStorage.getItem('google_access_token');
              if (token) router.replace('/(tabs)');
              else if (!loginInProgress.current) await signOut(webAuth);
            }
          }
        } catch (error: any) {
          console.error('Auth state error:', error);
          Alert.alert('초기화 오류', error.message);
        } finally {
          setInitializing(false);
        }
      });
    }

    try {
      GoogleSignin.configure({
        webClientId: '804211566696-qm3a9b7la3suceoqpongn6hrnkr56qra.apps.googleusercontent.com',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });
    } catch (configError: any) {
      console.error('GoogleSignin Config Error:', configError);
      Alert.alert('설정 오류', '구글 로그인 설정 중 오류가 발생했습니다.\n' + configError.message);
    }

    return auth().onAuthStateChanged((user) => {
      if (user) router.replace('/(tabs)');
      setInitializing(false);
    });
  }, [router]);

  async function onGoogleButtonPress() {
    if (loading) return;
    loginInProgress.current = true;
    setLoading(true);

    try {
      if (Platform.OS === 'web') {
        const provider = new GoogleAuthProvider();
        if (isSupabaseDataSource) {
          provider.setCustomParameters({ prompt: 'select_account' });
        } else {
          provider.addScope('https://www.googleapis.com/auth/drive.readonly');
        }
        const result = await signInWithPopup(webAuth, provider);

        if (isSupabaseDataSource) {
          // Explicitly start the access check before navigation. This also
          // covers browsers where auth observer callbacks are delivered late.
          await refreshAccess();
        } else {
          const credential = GoogleAuthProvider.credentialFromResult(result);
          const token = credential?.accessToken;
          if (!token) throw new Error('Google Drive 접근 토큰을 받지 못했습니다.');
          localStorage.setItem('google_access_token', token);
          router.replace('/(tabs)');
        }
      } else {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const response = await GoogleSignin.signIn();
        const idToken = response.data?.idToken;

        if (!idToken) throw new Error('Google ID Token 없음');

        const googleCredential = auth.GoogleAuthProvider.credential(idToken);
        await auth().signInWithCredential(googleCredential);
      }

    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'SIGN_IN_CANCELLED') {
        // 무시
      } else {
        Alert.alert('로그인 실패', error.message);
      }
    } finally {
      loginInProgress.current = false;
      setLoading(false);
    }
  }

  if (initializing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={{ marginTop: 20, color: '#666' }}>앱을 실행 중입니다...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Ionicons name="logo-google" size={60} color="#DB4437" style={{ marginBottom: 20 }} />
      <Text style={styles.title}>김연주T 과학 로그인</Text>
      
      <TouchableOpacity
        style={styles.button} 
        onPress={onGoogleButtonPress}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>Google 계정으로 로그인</Text>
        )}
      </TouchableOpacity>
      {loading && isSupabaseDataSource && (
        <Text style={styles.progressText}>
          {accessState === 'checking' ? '계정 권한을 확인하고 있습니다...' : 'Google 로그인을 완료하고 있습니다...'}
        </Text>
      )}
      {!loading && isSupabaseDataSource && accessState === 'error' && Boolean(accessError) && (
        <Text style={styles.errorText}>{accessError}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 40, color: '#333' },
  button: { 
    backgroundColor: '#4285F4', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 8,
    flexDirection: 'row', alignItems: 'center', elevation: 3 
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600', marginLeft: 10 },
  progressText: { marginTop: 16, color: '#4B5563' },
  errorText: { maxWidth: 420, marginTop: 16, paddingHorizontal: 24, color: '#B91C1C', textAlign: 'center' },
});
