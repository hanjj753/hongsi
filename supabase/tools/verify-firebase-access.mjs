import { readFile } from 'node:fs/promises';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Local setup check, never imported by the app. Signs in an existing verified
// Firebase user using Admin SDK custom auth, then READS the development DB.
// Tokens stay in process memory. This does not test the Google popup/native UI.
let stage = 'configuration';
let app;
const check = (condition) => { if (!condition) throw new Error('Check failed'); };
try {
  const args = process.argv.slice(2);
  const emailIndex = args.indexOf('--email');
  const email = emailIndex >= 0 ? args[emailIndex + 1]?.trim().toLowerCase() : null;
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  check(email?.includes('@') && credentialPath);
  check(url === 'https://xhyzngxwxeooffmcaxyl.supabase.co' && key?.startsWith('sb_publishable_'));
  const credential = JSON.parse(await readFile(credentialPath, 'utf8'));
  check(credential.type === 'service_account' && credential.project_id === 'hongsi-assistant');
  const config = await readFile(new URL('../../firebaseConfig.ts', import.meta.url), 'utf8');
  const apiKey = config.match(/apiKey:\s*"([^"]+)"/)?.[1];
  check(apiKey);
  app = initializeApp({ credential: cert(credential), projectId: 'hongsi-assistant' });
  const auth = getAuth(app);

  stage = 'existing Firebase identity';
  const user = await auth.getUserByEmail(email);
  check(!user.disabled && user.emailVerified && user.customClaims?.role === 'authenticated');

  stage = 'Firebase custom-token sign-in';
  const customToken = await auth.createCustomToken(user.uid);
  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    signal: AbortSignal.timeout(15000),
  });
  if (!signIn.ok) throw Object.assign(new Error('Sign-in request failed'), { code: `firebase_http_${signIn.status}` });
  const session = await signIn.json();
  // This endpoint does not promise localId; verify identity from the signed JWT below.
  check(typeof session.idToken === 'string' && session.isNewUser !== true);

  stage = 'Firebase ID-token verification';
  const claims = await auth.verifyIdToken(session.idToken, true);
  check(claims.uid === user.uid && claims.email === email && claims.email_verified === true
    && claims.role === 'authenticated' && claims.aud === 'hongsi-assistant'
    && claims.iss === 'https://securetoken.google.com/hongsi-assistant');

  stage = 'Supabase administrator access';
  const headers = { apikey: key, Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' };
  const result = await fetch(`${url}/rest/v1/rpc/get_my_access`, {
    method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw Object.assign(new Error('Access request failed'), { code: `supabase_http_${result.status}` });
  const access = await result.json();
  check(access?.app_role === 'admin' && access.access_status === 'approved' && access.employment_status === 'active'
    && access.can_manage_accounts === true && access.can_manage_devices === true);
  const identity = await fetch(`${url}/rest/v1/staff?select=id,email,firebase_uid&id=eq.${encodeURIComponent(access.staff_id)}`, {
    headers, signal: AbortSignal.timeout(15000),
  });
  check(identity.ok);
  const rows = await identity.json();
  check(rows.length === 1 && rows[0].firebase_uid === user.uid && rows[0].email === email);

  stage = 'Supabase class read queries';
  const classSelect = 'id,term_label,school,subject,weekdays,default_start_time,default_end_time,default_hourly_rate_krw,is_active,location:locations(id,name,latitude,longitude,notes),class_staff(staff:staff(id,full_name))';
  const classes = await fetch(`${url}/rest/v1/classes?select=${encodeURIComponent(classSelect)}&is_active=eq.true&order=term_label.desc,id.asc`, {
    headers, signal: AbortSignal.timeout(15000),
  });
  if (!classes.ok) throw Object.assign(new Error('Class read failed'), { code: `supabase_http_${classes.status}` });
  const classRows = await classes.json();
  check(Array.isArray(classRows));
  const locations = await fetch(`${url}/rest/v1/locations?select=id,name,latitude,longitude,notes&order=name.asc`, {
    headers, signal: AbortSignal.timeout(15000),
  });
  if (!locations.ok) throw Object.assign(new Error('Location read failed'), { code: `supabase_http_${locations.status}` });
  const locationRows = await locations.json();
  check(Array.isArray(locationRows));
  console.log(JSON.stringify({ result: 'PASS', app_role: access.app_role, access_status: access.access_status,
    can_manage_accounts: access.can_manage_accounts, can_manage_devices: access.can_manage_devices,
    class_count: classRows.length, location_count: locationRows.length }));
  console.log('Verified signed Firebase ID token -> Supabase development API -> matching administrator. No DB writes or saved tokens.');
} catch (error) {
  // Do not dump SDK responses, credentials, or tokens on failures.
  const code = /^[a-z0-9_/-]+$/i.test(error.code ?? '') ? error.code : 'verification_failed';
  console.error(`FAIL ${stage} (${code})`);
  process.exitCode = 1;
} finally {
  if (app) await deleteApp(app);
}
