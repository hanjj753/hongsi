import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isSupabaseDataSource } from '../config/dataSource';
import { useAppAccess, type AppAccessState } from '../contexts/AppAccessContext';
import { getCurrentUserEmail, signOutCurrentUser } from '../utils/currentUser';
import LoginScreen from '../app/index';

const denialMessages: Partial<Record<AppAccessState, string>> = {
  unlinked: '현역 조교 명단에 등록된 이메일로만 로그인할 수 있습니다. 관리자에게 이메일 등록을 요청해 주세요.',
  inactive: '비활성 직원 계정입니다. 관리자에게 문의해 주세요.',
};

export function AppAccessGate({ children }: React.PropsWithChildren) {
  const router = useRouter();
  const { state, errorMessage, refreshAccess } = useAppAccess();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  if (!isSupabaseDataSource || state === 'legacy' || state === 'approved') return <>{children}</>;

  const signOut = async () => {
    setSigningOut(true);
    setSignOutError('');
    try {
      await signOutCurrentUser();
      router.replace('/');
    } catch (error: any) {
      setSignOutError(error?.message || '로그아웃에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setSigningOut(false);
    }
  };

  if (state === 'signed_out') {
    // The tab navigator can unmount while the root stack is changing routes.
    // Render the login screen here too, so a delayed replace never leaves a blank view.
    return <LoginScreen />;
  }

  if (state === 'checking') {
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
  const email = getCurrentUserEmail();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>접근 권한 확인</Text>
      <Text style={styles.description}>{message}</Text>
      {email && <Text style={styles.account}>현재 로그인: {email}</Text>}
      <Pressable style={styles.primaryButton} onPress={() => void refreshAccess()}>
        <Text style={styles.primaryButtonText}>다시 확인</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} disabled={signingOut} onPress={() => void signOut()}>
        <Text style={styles.secondaryButtonText}>{signingOut ? '로그아웃 중...' : '로그아웃하고 계정 바꾸기'}</Text>
      </Pressable>
      <Text style={styles.accountHelp}>로그인 화면에서 Google 버튼을 다시 눌러 다른 계정을 선택하세요.</Text>
      {Boolean(signOutError) && <Text style={styles.signOutError}>{signOutError}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F7FB' },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 12 },
  description: { maxWidth: 420, textAlign: 'center', color: '#4B5563', lineHeight: 22, marginTop: 14, marginBottom: 22 },
  account: { color: '#374151', fontWeight: '700', marginBottom: 20 },
  accountHelp: { maxWidth: 420, textAlign: 'center', color: '#6B7280', lineHeight: 20 },
  signOutError: { maxWidth: 420, textAlign: 'center', color: '#B91C1C', marginTop: 12 },
  primaryButton: { minWidth: 180, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#4F46E5' },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },
  secondaryButton: { marginTop: 10, paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: '#6B7280', fontWeight: '700' },
});
