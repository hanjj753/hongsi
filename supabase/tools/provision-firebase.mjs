import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Local administrative tool, never imported by Expo or shipped to a browser.
// Default is a read-only preview. --apply adds only the Supabase login claim;
// it does not grant a Hongsi admin/manager role or approve any database access.
const args = process.argv.slice(2);
const emailIndex = args.indexOf('--email');
const email = emailIndex >= 0 ? args[emailIndex + 1]?.trim().toLowerCase() : null;
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!email?.includes('@') || !credentialPath) {
  throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to the local Firebase service-account JSON, then pass --email user@example.com.');
}
const serviceAccount = JSON.parse(await readFile(credentialPath, 'utf8'));
if (serviceAccount.project_id !== 'hongsi-assistant') throw new Error('Wrong Firebase project; no changes made.');
initializeApp({ credential:cert(serviceAccount), projectId:'hongsi-assistant' });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
if (user.disabled || !user.emailVerified) throw new Error('Only an active, verified Firebase user can be linked.');
if (user.customClaims?.role && user.customClaims.role !== 'authenticated') {
  throw new Error('An existing role claim needs review before replacement; no changes made.');
}
const claims = { ...user.customClaims, role:'authenticated' };
console.log(JSON.stringify({ email:user.email, firebase_uid:user.uid, hasSupabaseClaim:user.customClaims?.role === 'authenticated' }));
if (!args.includes('--apply')) {
  console.log('Preview only. Add --apply to set the login claim. Existing custom claims will be preserved.');
} else {
  await auth.setCustomUserClaims(user.uid, claims);
  const refreshed = await auth.getUser(user.uid);
  if (refreshed.customClaims?.role !== 'authenticated') throw new Error('Could not verify the saved claim.');
  console.log('Verified role=authenticated. Refresh the user ID token or sign in again.');
  // A private mapping file assists the separate, explicit DB account approval.
  const directory = new URL('../.local/', import.meta.url);
  await mkdir(directory, { recursive:true });
  await writeFile(new URL('firebase-user.json', directory), JSON.stringify({
    firebase_uid:user.uid, email:user.email, full_name:user.displayName ?? '', project_id:'hongsi-assistant',
  }, null, 2), 'utf8');
}
