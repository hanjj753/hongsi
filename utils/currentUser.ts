// 현재 로그인한 사용자의 정보를 가져오는 유틸리티 함수
import { Platform } from "react-native";
import auth from "@react-native-firebase/auth";
import { webAuth } from "../firebaseConfig";

/**
 * 현재 로그인한 사용자의 이메일을 반환합니다.
 * @returns {string | null} 이메일 주소 또는 null (비로그인 시)
 */
export function getCurrentUserEmail(): string | null {
  if (Platform.OS === "web") {
    return webAuth.currentUser?.email ?? null;
  }
  return auth().currentUser?.email ?? null;
}

/**
 * (선택 사항) 현재 사용자의 Firebase ID Token을 반환합니다.
 * 백엔드(Apps Script 등)에 보안 전송할 때 사용할 수 있습니다.
 * @returns {Promise<string | null>} ID 토큰
 */
export async function getCurrentUserIdToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return webAuth.currentUser
      ? await webAuth.currentUser.getIdToken()
      : null;
  }
  return auth().currentUser
    ? await auth().currentUser.getIdToken()
    : null;
}
