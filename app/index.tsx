import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons'; // 아이콘 사용

import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged as onWebAuthStateChanged, signOut } from 'firebase/auth';
import { webAuth } from '../firebaseConfig';

export default function LoginScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      // [Web] 웹용 로그인 상태 감지
      const unsubscribe = onWebAuthStateChanged(webAuth, async (user) => {
        if (user) {
          const token = localStorage.getItem('google_access_token');
          if (token) {
            router.replace('/(tabs)');
          } else { 
            await signOut(webAuth); 
          }
        }
      });
      return () => unsubscribe();
    } else {
      // [App] 앱용 구글 로그인 설정 & 상태 감지
      GoogleSignin.configure({
        webClientId: '804211566696-qm3a9b7la3suceoqpongn6hrnkr56qra.apps.googleusercontent.com', 
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });

      const subscriber = auth().onAuthStateChanged((user) => {
        if (user) router.replace('/(tabs)');
      });
      return subscriber;
    }
  }, []);

  async function onGoogleButtonPress() {
    if (loading) return;
    setLoading(true);

    try {
      if (Platform.OS === 'web') {
        const provider = new GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/drive.readonly');
        const result = await signInWithPopup(webAuth, provider);

        const credential = GoogleAuthProvider.credentialFromResult(result);
        const token = credential?.accessToken;

        if (token) { localStorage.setItem('google_access_token', token); }

        router.replace('/(tabs)');
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
        // 사용자가 창 닫음 (무시)
      } else {
        Alert.alert('로그인 실패', error.message);
      }
    } finally {
      setLoading(false);
    }
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
});