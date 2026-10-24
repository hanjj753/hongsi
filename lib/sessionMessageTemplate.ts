import type { ClassStudent, SessionTest, SessionWorkspace } from './classData';

export const homeworkToken = (sortOrder: number) => `HW${sortOrder}`;
export const testToken = (sortOrder: number) => `TEST${sortOrder}`;

function testValue(item: SessionTest, studentId: string): string {
  const result = item.results[studentId];
  if (!result) return '미입력';
  if (result.status === '결시') return '결시';
  if (item.resultType === 'memo') return result.resultText || '미입력';
  if (result.score == null) return '미입력';
  const scores = Object.values(item.results).map((row) => row.score).filter((score): score is number => score !== null);
  const average = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2) : '-';
  return `${result.score}/${item.maxScore} (평균 ${average})`;
}

export function defaultSessionMessageTemplate(workspace: SessionWorkspace): string {
  const lines = [
    '오늘 ${CLASS_NAME} ${SESSION}차시 수업 결과입니다.',
    '${STUDENT_NAME} 학생',
    '출석: ${ATTENDANCE}',
    ...workspace.homeworks.map((item) => `숙제 ${item.title}: \${${homeworkToken(item.sortOrder)}}`),
    ...workspace.tests.map((item) => `시험 ${item.title}: \${${testToken(item.sortOrder)}}`),
  ];
  return lines.join('\n');
}

export function fillSessionMessageTemplate(template: string, student: ClassStudent, workspace: SessionWorkspace,
  classLabel: string, termLabel: string, day: string): string {
  const values: Record<string, string> = {
    STUDENT_NAME: student.fullName,
    CLASS_NAME: classLabel,
    QUARTER: termLabel,
    DAY: day,
    SESSION: String(workspace.sessionNumber),
    ATTENDANCE: workspace.attendance[student.id]?.status || '-',
    HOMEWORK: workspace.homeworks.map((item) => `${item.title}: ${item.results[student.id]?.grade || '미입력'}`).join(', ') || '-',
    TEST: workspace.tests.map((item) => `${item.title}: ${testValue(item, student.id)}`).join(', ') || '-',
  };
  for (const item of workspace.homeworks) values[homeworkToken(item.sortOrder)] = item.results[student.id]?.grade || '미입력';
  for (const item of workspace.tests) values[testToken(item.sortOrder)] = testValue(item, student.id);
  return template.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (match, key: string) => values[key] ?? match).trim();
}
