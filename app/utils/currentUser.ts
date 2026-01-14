// app/utils/currentUser.ts
import { Platform } from "react-native";
import auth from "@react-native-firebase/auth";
import { webAuth } from "../../firebaseConfig";

/**
 * Get the logged-in user's email (App + Web)
 */
export function getCurrentUserEmail(): string | null {
  if (Platform.OS === "web") {
    return webAuth.currentUser?.email ?? null;
  }
  return auth().currentUser?.email ?? null;
}

/**
 * (Optional) Get Firebase ID token for secure server logging
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
