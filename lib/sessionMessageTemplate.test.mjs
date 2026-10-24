import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultSessionMessageTemplate, fillSessionMessageTemplate } from './sessionMessageTemplate.ts';

const student = { id: 'student-1', fullName: '김연주' };
const workspace = {
  sessionNumber: 2,
  attendance: { 'student-1': { status: '출석' } },
  homeworks: [
    { sortOrder: 1, title: '교재', results: { 'student-1': { grade: 'A' } } },
    { sortOrder: 2, title: '2심', results: {} },
  ],
  tests: [
    { sortOrder: 1, title: '단원평가', resultType: 'score', maxScore: 20,
      results: { 'student-1': { score: 18, status: '' }, 'student-2': { score: 16, status: '' } } },
    { sortOrder: 2, title: '서술', resultType: 'memo', maxScore: null,
      results: { 'student-1': { resultText: '통과', status: '' } } },
    { sortOrder: 3, title: '추가 시험', resultType: 'score', maxScore: 10,
      results: { 'student-1': { score: null, status: '결시' } } },
  ],
};

test('차시 템플릿은 항목 순서 번호를 변수로 제공한다', () => {
  const template = defaultSessionMessageTemplate(workspace);
  assert.match(template, /숙제 교재: \$\{HW1\}/);
  assert.match(template, /숙제 2심: \$\{HW2\}/);
  assert.match(template, /시험 단원평가: \$\{TEST1\}/);
  assert.match(template, /시험 서술: \$\{TEST2\}/);
});

test('학생별 숙제·점수·평균·결시·결과형 내용을 치환한다', () => {
  const template = '${STUDENT_NAME} ${ATTENDANCE} ${HW1} ${HW2} ${TEST1} ${TEST2} ${TEST3}';
  assert.equal(fillSessionMessageTemplate(template, student, workspace, '경기고 통합과학 토 오후', '2026-2F', '토'),
    '김연주 출석 A 미입력 18/20 (평균 17.00) 통과 결시');
});

test('알 수 없는 변수는 그대로 남겨 발송 전 검증할 수 있다', () => {
  assert.equal(fillSessionMessageTemplate('${UNKNOWN}', student, workspace, '', '', ''), '${UNKNOWN}');
});
