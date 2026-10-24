import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { getCurrentUserTokenResult } from '../utils/currentUser';

// Expo statically substitutes these public settings. Secret/service_role keys
// must never be used here; Firebase provides the per-user Authorization token.
const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let client: SupabaseClient | undefined;
let bootstrapRequest: Promise<void> | undefined;

async function bootstrapFirebaseLogin(idToken: string): Promise<void> {
  if (!bootstrapRequest) {
    bootstrapRequest = (async () => {
      const url = Platform.OS === 'web'
        ? '/api/firebase-login'
        : 'https://hongsi-eta.vercel.app/api/firebase-login';
      let response: Response;
      try {
        response = await withTimeout(fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
          cache: 'no-store',
        }), 25000, '계정 연결 시간이 초과되었습니다. 다시 확인해 주세요.');
      } catch {
        throw new Error('자동 계정 연결 서버에 접속하지 못했습니다. 잠시 후 다시 확인해 주세요.');
      }
      if (response.status !== 204) {
        throw new Error(response.status === 503
          ? '자동 계정 연결 서버 설정을 확인해 주세요.'
          : response.status === 401 || response.status === 403
            ? 'Google 로그인 상태를 확인한 뒤 다시 로그인해 주세요.'
            : '자동 계정 연결을 완료하지 못했습니다. 관리자에게 문의해 주세요.');
      }
    })().finally(() => { bootstrapRequest = undefined; });
  }
  await bootstrapRequest;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(projectUrl && publishableKey);
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!projectUrl || !publishableKey) throw new Error('데이터베이스 연결 설정이 필요합니다.');
  if (!publishableKey.startsWith('sb_publishable_')) {
    throw new Error('앱에는 Supabase Publishable key만 사용할 수 있습니다.');
  }
  const url = new URL(projectUrl);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Supabase 프로젝트의 HTTPS 주소를 확인해 주세요.');
  }
  client = createClient(projectUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => {
      let token = await withTimeout(
        getCurrentUserTokenResult(),
        10000,
        'Firebase 로그인 토큰 확인 시간이 초과되었습니다. 다시 로그인해 주세요.',
      );
      if (!token) return null;
      // A verified Firebase login gets the Supabase transport role from our
      // server. Database access still requires an active staff directory email.
      if (token.claims.role !== 'authenticated') {
        await bootstrapFirebaseLogin(token.token);
        token = await withTimeout(
          getCurrentUserTokenResult(true),
          10000,
          'Firebase 로그인 토큰 갱신 시간이 초과되었습니다. 다시 로그인해 주세요.',
        );
      }
      if (!token || token.claims.role !== 'authenticated') {
        throw new Error('DB 로그인 토큰을 갱신하지 못했습니다. 다시 로그인해 주세요.');
      }
      return token.token;
    },
    global: {
      // Bound DB network requests so a connection failure cannot leave a view
      // loading indefinitely. Writes are never automatically retried here.
      fetch: async (input, init) => {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        const callerSignal = init?.signal;
        if (callerSignal?.aborted) cancel();
        else callerSignal?.addEventListener('abort', cancel, { once: true });
        const timeout = setTimeout(cancel, 15000);
        try { return await fetch(input, { ...init, signal: controller.signal }); }
        finally {
          clearTimeout(timeout);
          callerSignal?.removeEventListener('abort', cancel);
        }
      },
    },
  });
  return client;
}
