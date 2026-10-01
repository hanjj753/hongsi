import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isSupabaseDataSource } from '../config/dataSource';
import { useAppAccess, type AppAccessState } from '../contexts/AppAccessContext';
import { signOutCurrentUser } from '../utils/currentUser';

const denialMessages: Partial<Record<AppAccessState, string>> = {
  unlinked: '등록되지 않은 계정입니다. 관리자에게 계정 연결을 요청해 주세요.',
  pending: '계정 승인을 기다리고 있습니다.',
  suspended: '사용이 중지된 계정입니다. 관리자에게 문의해 주세요.',
  inactive: '비활성 직원 계정입니다. 관리자에게 문의해 주세요.',
};

export function AppAccessGate({ children }: React.PropsWithChildren) {
  const router = useRouter();
  const { state, errorMessage, refreshAccess } = useAppAccess();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (isSupabaseDataSource && state === 'signed_out') router.replace('/');
  }, [router, state]);

  if (!isSupabaseDataSource || state === 'legacy' || state === 'approved') return <>{children}</>;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await signOutCurrentUser();
      router.replace('/');
    } finally {
      setSigningOut(false);
    }
  };

  if (state === 'checking' || state === 'signed_out') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.description}>계정 권한을 확인하고 있습니다...</Text>
      </View>
    );
  }

  const message = state === 'error'
    ? errorMessage || '계정 권한을 확인하지 못했습니다.'
    : denialMessages[state] || '이 계정으로 앱을 사용할 수 없습니다.';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>접근 권한 확인</Text>
      <Text style={styles.description}>{message}</Text>
      <Pressable style={styles.primaryButton} onPress={() => void refreshAccess()}>
        <Text style={styles.primaryButtonText}>다시 확인</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} disabled={signingOut} onPress={() => void signOut()}>
        <Text style={styles.secondaryButtonText}>{signingOut ? '로그아웃 중...' : '다른 계정으로 로그인'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F7FB' },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 12 },
  description: { maxWidth: 420, textAlign: 'center', color: '#4B5563', lineHeight: 22, marginTop: 14, marginBottom: 22 },
  primaryButton: { minWidth: 180, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#4F46E5' },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },
  secondaryButton: { marginTop: 10, paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: '#6B7280', fontWeight: '700' },
});
