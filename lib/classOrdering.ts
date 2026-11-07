type ClassSortValue = {
  id?: string | number; school?: string | null; subject?: string | null;
  classKind?: string; class_kind?: string; weekdays?: number[] | null;
  dayPart?: string | null; day_part?: string | null;
  weekdaySchedule?: Array<{ weekday: number; dayPart: string }>;
  class_weekday_times?: Array<{ weekday: number; day_part: string }>;
};
const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });
const weekdayRank = (day: number) => day === 0 ? 7 : day;
const partRank = (part: string) => ({ 오전: 0, 오후: 1, 저녁: 2 }[part] ?? 3);
function schedule(item: ClassSortValue) {
  const entries = item.weekdaySchedule ?? item.class_weekday_times?.map((day) => ({ weekday: day.weekday, dayPart: day.day_part }));
  return (entries?.length ? entries : (item.weekdays ?? []).map((weekday) => ({ weekday, dayPart: item.dayPart ?? item.day_part ?? '' })))
    .slice().sort((a, b) => weekdayRank(a.weekday) - weekdayRank(b.weekday) || partRank(a.dayPart) - partRank(b.dayPart));
}
export function compareClasses(a: ClassSortValue, b: ClassSortValue): number {
  const school = (item: ClassSortValue) => item.classKind === 'clinic' || item.class_kind === 'clinic' ? '클리닉' : item.school?.trim() ?? '';
  const nameOrder = collator.compare(school(a), school(b)) || collator.compare(a.subject?.trim() ?? '', b.subject?.trim() ?? '');
  if (nameOrder) return nameOrder;
  const left = schedule(a), right = schedule(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (!left[i] || !right[i]) return left.length - right.length;
    const order = weekdayRank(left[i].weekday) - weekdayRank(right[i].weekday);
    if (order) return order;
  }
  for (let i = 0; i < left.length; i++) {
    const order = partRank(left[i].dayPart) - partRank(right[i].dayPart);
    if (order) return order;
  }
  return collator.compare(String(a.id ?? ''), String(b.id ?? ''));
}
