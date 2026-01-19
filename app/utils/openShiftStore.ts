// utils/openShiftStore.ts
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** ===============================
 *  Types
 * =============================== */
export type OpenShift = {
  classId: string;
  classTitle: string;
  email: string;        // lower-case
  workDate: string;     // YYYY-MM-DD
  startHm: string;      // HH:MM
  startedAt: number;    // ms (Date.now())
};

const KEY = "OPEN_SHIFT_V1";

/** ===============================
 *  Internal helpers
 * =============================== */
function safeParse(json: string | null): OpenShift | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    return normalizeOpenShift(obj);
  } catch {
    return null;
  }
}

function normalizeOpenShift(obj: any): OpenShift | null {
  if (!obj) return null;

  const classId = String(obj.classId ?? "").trim();
  const classTitle = String(obj.classTitle ?? "").trim();
  const email = String(obj.email ?? "").trim().toLowerCase();
  const workDate = String(obj.workDate ?? "").trim();
  const startHm = String(obj.startHm ?? "").trim();
  const startedAt = Number(obj.startedAt ?? 0);

  if (!classId || !email || !startHm) return null;

  return {
    classId,
    classTitle,
    email,
    workDate,
    startHm,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
  };
}

/** ===============================
 *  Storage wrappers
 * =============================== */
async function storageGet(): Promise<string | null> {
  if (Platform.OS === "web") {
    return Promise.resolve(localStorage.getItem(KEY));
  }
  return AsyncStorage.getItem(KEY);
}

async function storageSet(value: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(KEY, value);
    return;
  }
  await AsyncStorage.setItem(KEY, value);
}

async function storageRemove(): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.removeItem(KEY);
}

/** ===============================
 *  Public API
 * =============================== */

/** 현재 출근 중인 수업 가져오기 */
export async function getOpenShift(): Promise<OpenShift | null> {
  const raw = await storageGet();
  return safeParse(raw);
}

/** 출근 시작 시 저장 */
export async function setOpenShift(shift: OpenShift): Promise<void> {
  const normalized = normalizeOpenShift(shift);
  if (!normalized) return;
  await storageSet(JSON.stringify(normalized));
}

/** 퇴근 시 초기화 */
export async function clearOpenShift(): Promise<void> {
  await storageRemove();
}