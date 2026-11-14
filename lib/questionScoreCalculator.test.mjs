import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('./questionScoreCalculator.ts', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`;
const { previewQuestionScores, mergeCalculatedTestScores } = await import(moduleUrl);
const snapshot = {
  testId: 'test1', title: '시험', maxScore: 10, objectiveCount: 2, essayCount: 1,
  questionNotes: { 3: '서술형' }, students: [
    { id: '1', fullName: '학생1', studentCode: 'S1', wrongNumbers: [1, 3] },
    { id: '2', fullName: '학생2', studentCode: 'S2', wrongNumbers: [] },
    { id: '3', fullName: '학생3', studentCode: 'S3', wrongNumbers: null },
    { id: '4', fullName: '학생4', studentCode: 'S4', wrongNumbers: [1, 2, 3] },
  ],
};

test('weighted objective and essay scores use exact cents; unentered students are excluded', () => {
  const before = structuredClone(snapshot);
  const preview = previewQuestionScores(snapshot, ['1.15', '2.85', '6']);
  assert.equal(preview.error, '');
  assert.equal(preview.totalPoints, 10);
  assert.deepEqual(preview.scores, { 1: 2.85, 2: 10, 4: 0 });
  assert.deepEqual(snapshot, before);
});

test('duplicate wrong numbers deduct once; zero-point questions are allowed', () => {
  const copy = structuredClone(snapshot);
  copy.students[0].wrongNumbers = [1, 1, 3];
  const preview = previewQuestionScores(copy, ['0', '5', '5']);
  assert.equal(preview.error, '');
  assert.equal(preview.scores['1'], 5);
});

test('mismatched total can be previewed but is rejected for application', () => {
  const preview = previewQuestionScores(snapshot, ['1', '2', '6']);
  assert.equal(preview.totalPoints, 9);
  assert.equal(preview.scores['1'], 2);
  assert.match(preview.error, /만점/);
});

test('incomplete, negative, nonnumeric and excess-precision points cannot calculate', () => {
  for (const value of ['', ' ', '-1', '1.234', 'NaN', 'Infinity', '1000000', '1e2']) {
    const preview = previewQuestionScores(snapshot, ['1', '2', value]);
    assert.ok(preview.error, value);
    assert.deepEqual(preview.scores, {});
  }
  assert.match(previewQuestionScores(snapshot, ['1', '2', '-3']).error, /서1번/);
});

test('invalid question ranges and maximums are rejected', () => {
  assert.ok(previewQuestionScores({ ...snapshot, objectiveCount: -1, essayCount: 4 }, ['1', '2', '7']).error);
  assert.ok(previewQuestionScores({ ...snapshot, maxScore: 0 }, ['1', '2', '7']).error);
  assert.ok(previewQuestionScores(snapshot, ['1', '2']).error);
  for (const number of [0, 4, 1.5]) {
    const copy = structuredClone(snapshot);
    copy.students[0].wrongNumbers = [number];
    assert.match(previewQuestionScores(copy, ['1', '2', '7']).error, /오답 번호/);
  }
});

test('applying scores changes only the selected test for entered students and preserves notes', () => {
  const drafts = Object.fromEntries(['1', '2', '3', '4'].map((id) => [id, {
    attendance: { status: '출석', notes: '출석 메모' }, homework: { h1: { grade: 'A' } },
    tests: {
      test1: { mode: 'absent', score: '', resultText: '', notes: '시험 메모' },
      test2: { mode: 'score', score: '80', resultText: '', notes: '다른 시험 메모' },
    },
  }]));
  const original = structuredClone(drafts);
  const next = mergeCalculatedTestScores(drafts, 'test1', { 1: 2.85, 2: 10, 4: 0, missing: 5 });
  assert.deepEqual(next['1'].tests.test1, { mode: 'score', score: '2.85', resultText: '', notes: '시험 메모' });
  assert.equal(next['4'].tests.test1.score, '0');
  assert.strictEqual(next['3'], drafts['3']);
  assert.strictEqual(next['1'].attendance, drafts['1'].attendance);
  assert.strictEqual(next['1'].homework, drafts['1'].homework);
  assert.strictEqual(next['1'].tests.test2, drafts['1'].tests.test2);
  assert.equal(next.missing, undefined);
  assert.deepEqual(drafts, original);
});
