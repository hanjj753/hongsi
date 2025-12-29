import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, Image, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';

import auth from '@react-native-firebase/auth';
import { signOut } from 'firebase/auth';
import { webAuth } from '../../firebaseConfig';

export default function HomeScreen() {
  
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {

    if(Platform.OS === 'web') {
      // [Web]
      const currentUser = webAuth.currentUser;
      if(currentUser) { 
        setUser(currentUser);
      }
    } else {
      // [App]
      const currentUser = auth().currentUser;
      if(currentUser) {
        setUser(currentUser);
      }
    }

  }, []);

  const handleLogout = async () => {
    try {
      if(Platform.OS === 'web') {
        await signOut(webAuth);
        window.location.href = '/';
        return;
      } else {
        await auth().signOut();
        if (router.canDismiss()) { router.dismissAll(); }
        router.replace('/');
      }
    } catch (error : any) {
      Alert.alert('로그아웃 실패', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>마이 페이지</Text>
      
      {user ? (
        <View style={styles.profileCard}>
          {user.photoURL && (
            <Image source={{uri : user.photoURL}} style={styles.avatar}/>
          )}

          <Text style={styles.label}>이름</Text>
          <Text style={styles.info}>{user.displayName || '이름 없음'}</Text>

          <Text style={styles.label}>이메일</Text>
          <Text style={styles.info}>{user.email}</Text>

          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text>로그인 정보를 불러오는 중...</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 30,
    color: '#333',
  },
  profileCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 25,
    alignItems: 'center',
    elevation: 4, // 안드로이드 그림자
    shadowColor: '#000', // iOS 그림자
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 20,
    backgroundColor: '#eee',
  },
  label: {
    fontSize: 14,
    color: '#888',
    marginBottom: 5,
    marginTop: 10,
  },
  info: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  logoutButton: {
    marginTop: 30,
    backgroundColor: '#FF5A5F',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 8,
  },
  logoutText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
});