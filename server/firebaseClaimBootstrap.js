const PROJECT_ID = 'hongsi-assistant';

function createFirebaseClaimBootstrap(getAdminAuth) {
  return async function bootstrapFirebaseClaim(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return response.status(405).json({ error: 'POST 요청만 사용할 수 있습니다.' });
    }

    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string'
      ? /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization)
      : null;
    if (!match || match[1].length > 8192) {
      return response.status(401).json({ error: 'Firebase 로그인이 필요합니다.' });
    }

    let adminAuth;
    try {
      adminAuth = getAdminAuth();
    } catch {
      return response.status(503).json({ error: '계정 연결 서버 설정을 확인해 주세요.' });
    }

    let identity;
    try {
      identity = await adminAuth.verifyIdToken(match[1], true);
    } catch {
      return response.status(401).json({ error: 'Firebase 로그인 정보를 다시 확인해 주세요.' });
    }
    if (identity.aud !== PROJECT_ID
      || identity.iss !== `https://securetoken.google.com/${PROJECT_ID}`
      || identity.email_verified !== true
      || typeof identity.email !== 'string'
      || !identity.email.trim()
      || typeof identity.uid !== 'string'
      || !identity.uid) {
      return response.status(403).json({ error: '인증된 Firebase 이메일 계정만 연결할 수 있습니다.' });
    }

    try {
      const user = await adminAuth.getUser(identity.uid);
      if (user.disabled || !user.emailVerified
        || user.email?.toLowerCase() !== identity.email.toLowerCase()) {
        return response.status(403).json({ error: 'Firebase 계정 상태를 확인해 주세요.' });
      }
      const existingRole = user.customClaims?.role;
      if (existingRole && existingRole !== 'authenticated') {
        return response.status(409).json({ error: '기존 Firebase 역할 설정을 관리자가 확인해야 합니다.' });
      }
      if (existingRole !== 'authenticated') {
        await adminAuth.setCustomUserClaims(user.uid, {
          ...user.customClaims,
          role: 'authenticated',
        });
      }
      return response.status(204).end();
    } catch {
      return response.status(503).json({ error: '계정 연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  };
}

module.exports = { createFirebaseClaimBootstrap };
