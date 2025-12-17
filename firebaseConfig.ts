// firebaseConfig.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAU1OYC9Al1C0J9ZNCdvYvhJ9PoTo4MxC4",
  authDomain: "hongsi-assistant.firebaseapp.com",
  projectId: "hongsi-assistant",
  storageBucket: "hongsi-assistant.firebasestorage.app",
  messagingSenderId: "804211566696",
  appId: "1:804211566696:web:8012cdfa9b624a6b7af3dd"
};

// 앱이 이미 초기화되었는지 확인하고, 안 되어 있으면 초기화 (싱글톤 패턴)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// 웹용 Auth 객체 내보내기
export const webAuth = getAuth(app);