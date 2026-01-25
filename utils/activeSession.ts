// 앱에서 현재 출근 중인 수업 정보를 저장/불러오는 유틸리티
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** ===============================
 * Types
 * =============================== */
export type ActiveSession = {
  classId: string;    // 수업 ID
  className: string;  // 수업명
  email: string;      // 근무자 이메일 (소문자)
  workDate: string;   // 출근 날짜 (YYYY-MM-DD)
  startHm: string;    // 출근 시각 (HH:MM)
  startedAt: number;  // 타임스탬프 (경과 시간 계산용)
};

const KEY = "ACTIVE_WORK_SESSION_V1";

/** ===============================
 * Internal helpers
 * =============================== */
// 데이터를 안전하게 복구하고, 필수 값이 없으면 null 반환
function normalizeSession(obj: any): ActiveSession | null {
  if (!obj) return null;

  const classId = String(obj.classId ?? "").trim();
  
  // classTitle 대신 className 사용 (혹시 모를 구버전 데이터 호환을 위해 obj.classTitle도 체크)
  const className = String(obj.className ?? obj.classTitle ?? "").trim();
  
  const email = String(obj.email ?? "").trim().toLowerCase();
  const workDate = String(obj.workDate ?? "").trim();
  const startHm = String(obj.startHm ?? "").trim();
  const startedAt = Number(obj.startedAt ?? 0);

  if (!classId || !email || !startHm) return null;

  return {
    classId,
    className,
    email,
    workDate,
    startHm,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
  };
}

function safeParse(json: string | null): ActiveSession | null {
  if (!json) return null;
  try {
    return normalizeSession(JSON.parse(json));
  } catch {
    return null;
  }
}

/** ===============================
 * Storage wrappers (Web/Native)
 * =============================== */
const Storage = {
  get: async (): Promise<string | null> => {
    if (Platform.OS === "web") return localStorage.getItem(KEY);
    return AsyncStorage.getItem(KEY);
  },
  set: async (value: string): Promise<void> => {
    if (Platform.OS === "web") return localStorage.setItem(KEY, value);
    return AsyncStorage.setItem(KEY, value);
  },
  remove: async (): Promise<void> => {
    if (Platform.OS === "web") return localStorage.removeItem(KEY);
    return AsyncStorage.removeItem(KEY);
  }
};

/** ===============================
 * Public API
 * =============================== */

/** 현재 진행 중인 근무 세션 가져오기 */
export async function getActiveSession(): Promise<ActiveSession | null> {
  const raw = await Storage.get();
  return safeParse(raw);
}

/** 근무 시작 (세션 저장) */
export async function startSession(session: ActiveSession): Promise<void> {
  const normalized = normalizeSession(session);
  if (!normalized) return;
  await Storage.set(JSON.stringify(normalized));
}

/** 근무 종료 (세션 삭제) */
export async function clearSession(): Promise<void> {
  await Storage.remove();
}