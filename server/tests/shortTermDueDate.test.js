import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortTermDueDate } from '../utils/shortTermBilling.js';

// 단기렌트 결제일 (대표님 2026-11-04, 레이 그랜저 142호9185: 9/16 시작, 25일 결제)
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const start = new Date('2026-09-16T12:00:00+09:00');

test('결제일이 있으면 매달 그날이 청구일이다', () => {
  assert.equal(kst(shortTermDueDate(start, 0, 25)), '2026-09-25');
  assert.equal(kst(shortTermDueDate(start, 2, 25)), '2026-11-25');
  assert.equal(kst(shortTermDueDate(start, 4, 25)), '2027-01-25');
});

test('결제일이 없으면 시작일과 같은 날이다', () => {
  assert.equal(kst(shortTermDueDate(start, 0, 0)), '2026-09-16');
  assert.equal(kst(shortTermDueDate(start, 2, undefined)), '2026-11-16');
});

test('그 달 결제일이 시작일보다 앞이면 다음 달부터 낸다', () => {
  assert.equal(kst(shortTermDueDate(start, 0, 5)), '2026-10-05');
  assert.equal(kst(shortTermDueDate(start, 1, 5)), '2026-11-05');
});

test('말일 결제는 달마다 그 달 마지막 날이다', () => {
  assert.equal(kst(shortTermDueDate(start, 0, 31)), '2026-09-30');
  assert.equal(kst(shortTermDueDate(start, 1, 31)), '2026-10-31');
  assert.equal(kst(shortTermDueDate(start, 5, 31)), '2027-02-28');
});
