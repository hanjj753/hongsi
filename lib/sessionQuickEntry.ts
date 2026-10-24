export type QuickEntryColumn = {
  key: string;
  label: string;
  kind: 'attendance' | 'attendance-note' | 'homework' | 'score' | 'memo';
  itemId?: string;
  maxScore?: number | null;
  width: number;
};

export function normalizeQuickEntryValue(column: QuickEntryColumn, raw: string): string | null {
  const value = raw.trim();
  if (column.kind === 'attendance-note') return raw;
  if (value === '') return '';
  if (column.kind === 'attendance') {
    return ['출석', '영상', '보강', '결석'].includes(value) ? value : null;
  }
  if (column.kind === 'homework') {
    const grade = /^[abc]$/i.test(value) ? value.toUpperCase() : value;
    return ['A', 'B', 'C', '미제출'].includes(grade) ? grade : null;
  }
  if (value === '결시') return value;
  if (column.kind === 'memo') return value.length <= 200 ? raw : null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= (column.maxScore ?? 0) ? value : null;
}
