import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQuickEntryValue } from './sessionQuickEntry.ts';

const column = (kind, maxScore = null) => ({ key: kind, label: kind, kind, maxScore, width: 120 });

test('빠른 입력은 출석·숙제 상태를 정해진 값으로만 받는다', () => {
  assert.equal(normalizeQuickEntryValue(column('attendance'), '보강'), '보강');
  assert.equal(normalizeQuickEntryValue(column('attendance'), '지각'), null);
  assert.equal(normalizeQuickEntryValue(column('homework'), 'b'), 'B');
  assert.equal(normalizeQuickEntryValue(column('homework'), '미제출'), '미제출');
  assert.equal(normalizeQuickEntryValue(column('homework'), 'D'), null);
});

test('점수는 만점과 소수점 둘째 자리 제한을 확인하고 결시·미입력을 허용한다', () => {
  const score = column('score', 20);
  for (const value of ['0', '19.25', '20', '결시', '']) assert.equal(normalizeQuickEntryValue(score, value), value);
  for (const value of ['20.01', '-1', '2.345', '1.', 'abc']) assert.equal(normalizeQuickEntryValue(score, value), null);
});

test('결과 메모형은 결시와 200자 이내의 결과를 허용한다', () => {
  const memo = column('memo');
  assert.equal(normalizeQuickEntryValue(memo, '재시'), '재시');
  assert.equal(normalizeQuickEntryValue(memo, '결시'), '결시');
  assert.equal(normalizeQuickEntryValue(memo, '가'.repeat(201)), null);
});
