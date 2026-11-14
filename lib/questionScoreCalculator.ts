export type QuestionScoreStudent = {
  id: string; fullName: string; studentCode: string; wrongNumbers: number[] | null;
};
export type QuestionScoreSnapshot = {
  testId: string; title: string; maxScore: number; objectiveCount: number; essayCount: number;
  questionNotes: Record<string, string>; students: QuestionScoreStudent[];
};
export type TestScoreDraft = { mode: 'blank' | 'score' | 'memo' | 'absent'; score: string; resultText: string; notes: string };

export function previewQuestionScores(snapshot: QuestionScoreSnapshot, inputs: string[]): {
  totalPoints: number | null; scores: Record<string, number>; error: string;
} {
  const invalid = (error: string) => ({ totalPoints: null, scores: {}, error });
  const count = snapshot.objectiveCount + snapshot.essayCount;
  if (![snapshot.objectiveCount, snapshot.essayCount].every((value) => Number.isInteger(value) && value >= 0)
    || count < 1 || count > 100 || inputs.length !== count) return invalid('문항 구성을 확인해 주세요.');
  if (!Number.isFinite(snapshot.maxScore) || snapshot.maxScore <= 0) return invalid('시험 만점을 확인해 주세요.');
  const cents: number[] = [];
  for (let index = 0; index < inputs.length; index++) {
    const value = inputs[index].trim();
    if (!value) return invalid('모든 문항의 배점을 입력해 주세요. 배점이 없는 문항은 0을 입력합니다.');
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) > 999999.99) {
      const label = index < snapshot.objectiveCount ? String(index + 1) : `서${index + 1 - snapshot.objectiveCount}`;
      return invalid(`${label}번 배점은 0 이상, 소수점 둘째 자리까지 입력해 주세요.`);
    }
    cents.push(Math.round(Number(value) * 100));
  }
  const totalCents = cents.reduce((sum, value) => sum + value, 0);
  const scores: Record<string, number> = {};
  for (const student of snapshot.students) {
    if (student.wrongNumbers === null) continue;
    const wrongs = new Set(student.wrongNumbers);
    if ([...wrongs].some((number) => !Number.isInteger(number) || number < 1 || number > count)) {
      return invalid(`${student.fullName} 학생의 오답 번호가 문항 범위를 벗어났습니다. 오답표를 확인해 주세요.`);
    }
    const lost = [...wrongs].reduce((sum, number) => sum + cents[number - 1], 0);
    scores[student.id] = (totalCents - lost) / 100;
  }
  return { totalPoints: totalCents / 100, scores,
    error: totalCents !== Math.round(snapshot.maxScore * 100)
      ? `배점 합계 ${totalCents / 100}점과 시험 만점 ${snapshot.maxScore}점이 같아야 반영할 수 있습니다.` : '' };
}

/** Merge only calculated students and the selected test into the current unsaved form. */
export function mergeCalculatedTestScores<T extends { tests: Record<string, TestScoreDraft> }>(
  drafts: Record<string, T>, testId: string, scores: Record<string, number>,
): Record<string, T> {
  const next = { ...drafts };
  for (const [studentId, score] of Object.entries(scores)) {
    const current = drafts[studentId];
    if (!current) continue;
    next[studentId] = { ...current, tests: { ...current.tests,
      [testId]: { mode: 'score', score: String(score), resultText: '', notes: current.tests[testId]?.notes ?? '' },
    } };
  }
  return next;
}
