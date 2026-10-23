const assert = require('node:assert/strict');
const test = require('node:test');
const { createFirebaseClaimBootstrap } = require('./firebaseClaimBootstrap');

const identity = {
  uid: 'firebase-user-1', email: 'helper@example.com', email_verified: true,
  aud: 'hongsi-assistant', iss: 'https://securetoken.google.com/hongsi-assistant',
};

function response() {
  return {
    code: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function auth(overrides = {}) {
  const calls = [];
  return {
    calls,
    verifyIdToken: async () => identity,
    getUser: async () => ({
      uid: identity.uid, email: identity.email, emailVerified: true,
      disabled: false, customClaims: { anotherClaim: 'preserved' },
    }),
    setCustomUserClaims: async (...args) => { calls.push(args); },
    ...overrides,
  };
}

test('requires a signed Firebase token and never changes claims without one', async () => {
  const firebase = auth();
  const result = response();
  await createFirebaseClaimBootstrap(() => firebase)({ method: 'POST', headers: {} }, result);
  assert.equal(result.code, 401);
  assert.equal(firebase.calls.length, 0);
});

test('rejects an unverified email even when its token is valid', async () => {
  const firebase = auth({ verifyIdToken: async () => ({ ...identity, email_verified: false }) });
  const result = response();
  await createFirebaseClaimBootstrap(() => firebase)({ method: 'POST', headers: { authorization: 'Bearer valid.token' } }, result);
  assert.equal(result.code, 403);
  assert.equal(firebase.calls.length, 0);
});

test('rejects a token issued by another Firebase project', async () => {
  const firebase = auth({ verifyIdToken: async () => ({ ...identity, aud: 'another-project' }) });
  const result = response();
  await createFirebaseClaimBootstrap(() => firebase)({ method: 'POST', headers: { authorization: 'Bearer valid.token' } }, result);
  assert.equal(result.code, 403);
  assert.equal(firebase.calls.length, 0);
});

test('preserves unrelated claims while adding only the Supabase login role', async () => {
  const firebase = auth();
  const result = response();
  await createFirebaseClaimBootstrap(() => firebase)({ method: 'POST', headers: { authorization: 'Bearer valid.token' } }, result);
  assert.equal(result.code, 204);
  assert.deepEqual(firebase.calls, [[identity.uid, { anotherClaim: 'preserved', role: 'authenticated' }]]);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('does not overwrite an existing Firebase role', async () => {
  const firebase = auth({ getUser: async () => ({
    uid: identity.uid, email: identity.email, emailVerified: true,
    disabled: false, customClaims: { role: 'custom-app-role' },
  }) });
  const result = response();
  await createFirebaseClaimBootstrap(() => firebase)({ method: 'POST', headers: { authorization: 'Bearer valid.token' } }, result);
  assert.equal(result.code, 409);
  assert.equal(firebase.calls.length, 0);
});

test('already provisioned accounts do not require another Firebase write', async () => {
  const firebase = auth({ getUser: async () => ({
    uid: identity.uid, email: identity.email, emailVerified: true,
    disabled: false, customClaims: { role: 'authenticated' },
  }) });
  const result = response();
  await createFirebaseClaimBootstrap(() => firebase)({ method: 'POST', headers: { authorization: 'Bearer valid.token' } }, result);
  assert.equal(result.code, 204);
  assert.equal(firebase.calls.length, 0);
});
