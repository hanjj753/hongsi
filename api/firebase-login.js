const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { createFirebaseClaimBootstrap } = require('../server/firebaseClaimBootstrap');

function getAdminAuth() {
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Firebase Admin credentials are not configured');
  const account = JSON.parse(raw);
  if (account.project_id !== 'hongsi-assistant'
    || !account.client_email || !account.private_key) {
    throw new Error('Firebase Admin credentials do not match this project');
  }
  const app = getApps().find((item) => item.name === 'hongsi-firebase-login')
    ?? initializeApp({ credential: cert(account), projectId: 'hongsi-assistant' }, 'hongsi-firebase-login');
  return getAuth(app);
}

module.exports = createFirebaseClaimBootstrap(getAdminAuth);
