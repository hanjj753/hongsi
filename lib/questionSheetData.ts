import { getSupabase } from './supabase';

export type QuestionSheet = {
  testId: string;
  objectiveCount: number;
  essayCount: number;
  wrongByStudent: Record<string, number[]>;
};

export function questionLabel(number: number, objectiveCount: number): string {
  return number <= objectiveCount ? String(number) : `서${number - objectiveCount}`;
}

export function parseWrongQuestionList(text: string, objectiveCount: number, essayCount: number): number[] {
  const total = objectiveCount + essayCount;
  const seen = new Set<number>();
  for (const raw of text.trim().split(/[,，、\s]+/).filter(Boolean)) {
    const essay = /^서([1-9]\d*)$/.exec(raw);
    const objective = /^([1-9]\d*)$/.exec(raw);
    const number = essay ? objectiveCount + Number(essay[1]) : objective ? Number(objective[1]) : NaN;
    if (!Number.isInteger(number) || number < 1 || number > total || (essay && Number(essay[1]) > essayCount)
      || (objective && number > objectiveCount)) {
      throw new Error(`문항 번호 ${raw}을(를) 확인해 주세요. 객관식 1~${objectiveCount}, 서술형 서1~서${essayCount}만 입력할 수 있습니다.`);
    }
    if (seen.has(number)) throw new Error(`${raw} 문항이 중복되었습니다.`);
    seen.add(number);
  }
  return [...seen].sort((a, b) => a - b);
}

export async function getQuestionSheet(testId: string): Promise<QuestionSheet | null> {
  const { data: config, error } = await getSupabase().from('test_question_sheets')
    .select('test_id,objective_count,essay_count').eq('test_id', testId).maybeSingle();
  if (error) throw error;
  if (!config) return null;
  const { data: rows, error: rowsError } = await getSupabase().from('test_question_mistakes')
    .select('student_id,wrong_numbers').eq('test_id', testId);
  if (rowsError) throw rowsError;
  return {
    testId: String(config.test_id),
    objectiveCount: Number(config.objective_count),
    essayCount: Number(config.essay_count),
    wrongByStudent: Object.fromEntries((rows ?? []).map((row) => [String(row.student_id),
      (row.wrong_numbers ?? []).map(Number)])),
  };
}

export async function saveQuestionSheet(classId: string, sessionId: string, sheet: QuestionSheet): Promise<void> {
  const { error } = await getSupabase().rpc('save_test_question_sheet', {
    target_class_id: classId,
    target_session_id: sessionId,
    target_test_id: sheet.testId,
    new_objective_count: sheet.objectiveCount,
    new_essay_count: sheet.essayCount,
    student_rows: Object.entries(sheet.wrongByStudent).map(([studentId, wrongNumbers]) => ({
      student_id: studentId, wrong_numbers: wrongNumbers,
    })),
  });
  if (error) throw error;
}
