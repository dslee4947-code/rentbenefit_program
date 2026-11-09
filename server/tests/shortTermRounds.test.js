import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planShortTermRounds } from '../utils/shortTermBilling.js';

// 2026-11-09 레이 그랜저 142호9185: 3회차(발행 전)에 올린 통행료 3건이 청구 화면을 열 때마다 사라졌다
const contract = {
  rentalKind: '단기렌트',
  rentStartDate: new Date('2026-09-16T12:00:00+09:00'),
  pricing: { monthlyFee: 1190000, billingDay: 25 }
};
const now = new Date('2026-11-09T16:00:00+09:00');
const toll = (amount) => ({ kind: '통행료', amount, plateNo: '142호9185' });
const existing = () => [
  { no: 1, status: '입금완료', monthlyRent: 1189725, total: 1189725, paidAmount: 1189450, attachments: [], extras: [] },
  { no: 2, status: '입금완료', monthlyRent: 1189725, total: 1189725, paidAmount: 1189725, attachments: [], extras: [] },
  { no: 3, status: '예정', monthlyRent: 1189725, total: 1189725, fine: 0, attachments: [toll(1900), toll(19400), toll(2800)], extras: [] }
];

test('발행 전 회차에 붙인 고지서가 남고 합계에 더해진다', () => {
  const { rounds } = planShortTermRounds(contract, existing(), now);
  const r3 = rounds.find((r) => r.no === 3);
  assert.equal(r3.attachments.length, 3);
  assert.equal(r3.fine, 24100);
  assert.equal(r3.monthlyRent, 1190000);
  assert.equal(r3.total, 1190000 + 24100);
});

test('입금된 회차는 금액을 바꾸지 않는다', () => {
  const { rounds } = planShortTermRounds(contract, existing(), now);
  assert.equal(rounds.find((r) => r.no === 1).monthlyRent, 1189725);
  assert.equal(rounds.find((r) => r.no === 2).total, 1189725);
});

test('반납으로 필요 없어진 회차도 고지서가 붙어 있으면 지우지 않는다', () => {
  const ended = { ...contract, returnDate: new Date('2026-10-20T12:00:00+09:00') };
  const { rounds } = planShortTermRounds(ended, existing(), now);
  assert.ok(rounds.some((r) => r.no === 3 && r.attachments.length === 3));
});

test('새 회차는 월 대여료로 만든다', () => {
  const { rounds } = planShortTermRounds(contract, existing().slice(0, 2), now);
  assert.deepEqual(rounds.map((r) => r.no), [1, 2, 3]);
  assert.equal(rounds[2].total, 1190000);
});
