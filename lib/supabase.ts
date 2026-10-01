import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUserTokenResult } from '../utils/currentUser';

// Expo statically substitutes these public settings. Secret/service_role keys
// must never be used here; Firebase provides the per-user Authorization token.
const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let client: SupabaseClient | undefined;

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
  if (!projectUrl || !publishableKey) throw new Error('Supabase 개발 프로젝트 연결 설정이 필요합니다.');
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
      // Refresh once after an administrator provisions the Firebase claim.
      if (token.claims.role !== 'authenticated') {
        token = await withTimeout(
          getCurrentUserTokenResult(true),
          10000,
          'Firebase 로그인 토큰 갱신 시간이 초과되었습니다. 다시 로그인해 주세요.',
        );
      }
      if (!token || token.claims.role !== 'authenticated') {
        throw new Error('DB 로그인 설정이 아직 완료되지 않은 계정입니다. 관리자에게 계정 연결을 요청해 주세요.');
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
