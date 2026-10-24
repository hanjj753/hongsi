import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { ClassStudent } from './classData';

export type ContactEntry = { name: string; phone: string };
export type ContactSyncResult = { created: number; updated: number; failed: number; firstError?: string };

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('82') ? `0${digits.slice(2)}` : digits;
}

export function buildClassContacts(termLabel: string, school: string, students: ClassStudent[]): {
  entries: ContactEntry[]; conflictCount: number;
} {
  const prefix = `${termLabel.trim()} ${school.trim()}`.trim();
  const byPhone = new Map<string, ContactEntry & { studentId: string }>();
  const conflicts = new Set<string>();
  for (const student of students.filter((item) => item.enrollmentStatus === 'active')) {
    const base = `${prefix} ${student.fullName.trim()}`.trim();
    for (const entry of [
      { name: base, phone: student.studentPhone },
      { name: `${base} 모`, phone: student.parentPhone },
    ]) {
      const phone = normalizePhone(entry.phone);
      if (!/^0\d{8,10}$/.test(phone)) continue;
      const previous = byPhone.get(phone);
      if (previous && previous.studentId !== student.id) { conflicts.add(phone); continue; }
      // If student and parent numbers are the same, use the parent label.
      byPhone.set(phone, { ...entry, phone, studentId: student.id });
    }
  }
  return {
    entries: [...byPhone.values()].filter((entry) => !conflicts.has(entry.phone))
      .map(({ name, phone }) => ({ name, phone })),
    conflictCount: conflicts.size,
  };
}

export async function syncClassContacts(groupName: string, entries: ContactEntry[]): Promise<ContactSyncResult> {
  if (Platform.OS !== 'android') throw new Error('연락처 추가는 Android 앱에서만 사용할 수 있습니다.');
  const module = NativeModules.ClassContacts;
  if (!module?.syncContacts) throw new Error('연락처 기능이 포함된 새 앱을 설치한 뒤 다시 시도해 주세요.');
  const permissions = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
    PermissionsAndroid.PERMISSIONS.WRITE_CONTACTS,
  ]);
  if (permissions[PermissionsAndroid.PERMISSIONS.READ_CONTACTS] !== PermissionsAndroid.RESULTS.GRANTED
    || permissions[PermissionsAndroid.PERMISSIONS.WRITE_CONTACTS] !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('연락처 읽기와 쓰기 권한을 허용해 주세요.');
  }
  return module.syncContacts(groupName, entries);
}
