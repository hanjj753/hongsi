import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import auth from '@react-native-firebase/auth';
import { onAuthStateChanged as onWebAuthStateChanged } from 'firebase/auth';
import { webAuth } from '../firebaseConfig';
import { isSupabaseDataSource } from '../config/dataSource';
import { getMyAppAccess, type AppAccess } from '../utils/appAccess';

export type AppAccessState =
  | 'legacy'
  | 'checking'
  | 'signed_out'
  | 'unlinked'
  | 'pending'
  | 'suspended'
  | 'inactive'
  | 'approved'
  | 'error';

type AppAccessContextValue = {
  access: AppAccess | null;
  state: AppAccessState;
  errorMessage: string;
  refreshAccess: () => Promise<void>;
};

const AppAccessContext = createContext<AppAccessContextValue | null>(null);

function currentFirebaseUser() {
  return Platform.OS === 'web' ? webAuth.currentUser : auth().currentUser;
}

export function AppAccessProvider({ children }: React.PropsWithChildren) {
  const [access, setAccess] = useState<AppAccess | null>(null);
  const [state, setState] = useState<AppAccessState>(isSupabaseDataSource ? 'checking' : 'legacy');
  const [errorMessage, setErrorMessage] = useState('');
  const requestId = useRef(0);

  const refreshAccess = useCallback(async () => {
    if (!isSupabaseDataSource) {
      setState('legacy');
      return;
    }

    const id = ++requestId.current;
    if (!currentFirebaseUser()) {
      setAccess(null);
      setState('signed_out');
      return;
    }

    setState('checking');
    setErrorMessage('');
    try {
      const next = await getMyAppAccess();
      if (id !== requestId.current) return;
      setAccess(next);
      if (!next) setState('unlinked');
      else if (next.employment_status !== 'active') setState('inactive');
      else if (next.access_status === 'pending') setState('pending');
      else if (next.access_status === 'suspended') setState('suspended');
      else if (next.access_status === 'approved' && next.app_role) setState('approved');
      else setState('unlinked');
    } catch (error: any) {
      if (id !== requestId.current) return;
      setAccess(null);
      setErrorMessage(error?.message || '계정 권한을 확인하지 못했습니다.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseDataSource) return;
    const unsubscribe = Platform.OS === 'web'
      ? onWebAuthStateChanged(webAuth, () => { void refreshAccess(); })
      : auth().onAuthStateChanged(() => { void refreshAccess(); });
    return unsubscribe;
  }, [refreshAccess]);

  return (
    <AppAccessContext.Provider value={{ access, state, errorMessage, refreshAccess }}>
      {children}
    </AppAccessContext.Provider>
  );
}

export function useAppAccess(): AppAccessContextValue {
  const value = useContext(AppAccessContext);
  if (!value) throw new Error('AppAccessProvider가 필요합니다.');
  return value;
}
