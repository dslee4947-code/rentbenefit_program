import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findStreaks, rentDepositsOf, verdictOf } from '../utils/paymentStreaks.js';

const d = (s) => new Date(`${s}T00:00:00+09:00`);
const until = d('2026-11-15');

test('미납이 다음 청구서로 넘어가면 마지막 회차만 센다', () => {
  const rows = [
    { contract: 'A', no: 55, dueDate: d('2026-07-25'), unpaid: 376700 },
    { contract: 'A', no: 56, dueDate: d('2026-08-25'), unpaid: 753400 },
    { contract: 'A', no: 57, dueDate: d('2026-09-25'), unpaid: 1130100 },
    { contract: 'A', no: 58, dueDate: d('2026-10-25'), unpaid: 1506800 }
  ];
  const [s] = findStreaks(rows, until);
  assert.equal(s.months, 4);
  assert.equal(s.amount, 1506800);
  assert.equal(+new Date(s.since), +d('2026-07-25'));
});

test('넘어가지 않은 회차는 더한다, 한 회차뿐이면 끊김 아님, 기록 기준일 뒤는 뺀다', () => {
  const rows = [
    { contract: 'B', no: 7, dueDate: d('2026-10-15'), unpaid: 640000 },
    { contract: 'B', no: 8, dueDate: d('2026-11-15'), unpaid: 640000 },
    { contract: 'C', no: 3, dueDate: d('2026-10-25'), unpaid: 500000 },
    { contract: 'D', no: 4, dueDate: d('2026-10-25'), unpaid: 500000 },
    { contract: 'D', no: 5, dueDate: d('2026-11-25'), unpaid: 500000 }
  ];
  const s = findStreaks(rows, until);
  assert.equal(s.length, 1);
  assert.equal(s[0].contractId, 'B');
  assert.equal(s[0].amount, 1280000);
});

test('원장 입금으로 미납 의심 / 반영 누락 의심을 가른다', () => {
  const streak = { since: d('2026-07-25') };
  const ledgers = [{ contract: 'A', entries: [
    { side: '입금', category: '렌트료', date: d('2026-07-21'), amount: 376494 },
    { side: '입금', category: '보증금', date: d('2026-08-01'), amount: 999 }
  ] }];
  const deps = rentDepositsOf(ledgers, 'A');
  assert.equal(deps.length, 1);
  assert.equal(verdictOf(streak, deps).kind, '미납 의심');
  deps.push({ date: d('2026-08-26'), amount: 376700 });
  assert.equal(verdictOf(streak, deps).kind, '반영 누락 의심');
  assert.equal(verdictOf(streak, []).kind, '원장 없음');
});

test('계약 구간이 있는 원장은 그 계약 구간 줄만', () => {
  const ledgers = [{ contract: 'X', contractPeriods: [{ seq: 1, contract: 'X' }, { seq: 2, contract: 'Y' }], entries: [
    { side: '입금', label: '렌트료 3회차', date: d('2026-01-01'), amount: 1, periodSeq: 1 },
    { side: '입금', label: '렌트료 1회차', date: d('2026-02-01'), amount: 2, periodSeq: 2 }
  ] }];
  assert.deepEqual(rentDepositsOf(ledgers, 'Y').map((x) => x.amount), [2]);
});
