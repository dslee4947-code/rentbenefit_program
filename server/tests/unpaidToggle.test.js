import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCarryForward } from '../controllers/billingScheduleController.js';

// [미납으로 처리] / [미납 취소] (2026-10-21): 전달 회차를 미납으로 누르면 다음 미발행 청구서에
// 미납 원금 + 이자(원금 × 연 이율 × 출금일 사이 일수, 10원 미만 버림)가 붙고, 취소하면 원래대로 돌아간다.
// 숫자는 동춘푸드(월 1,367,000원, 연 20%, 25일 결제)로 맞춘다.
const RENT = 1367000;
const RATE = 20;
const due = (m) => new Date(2026, m - 1, 25);

const schedule = () => ({
  rounds: [
    { no: 8, dueDate: due(8), monthlyRent: RENT, total: RENT, status: '입금완료', paidAmount: RENT, issuedAt: due(8) },
    { no: 9, dueDate: due(9), monthlyRent: RENT, total: RENT, status: '청구됨', paidAmount: 0, issuedAt: due(9) },
    { no: 10, dueDate: due(10), monthlyRent: RENT, total: RENT, status: '예정', paidAmount: 0 },
    { no: 11, dueDate: due(11), monthlyRent: RENT, total: RENT, status: '예정', paidAmount: 0 }
  ]
});

test('미납 처리: 다음 미발행 청구서에 원금과 한 달치 이자가 붙는다', () => {
  const s = schedule();
  s.rounds[1].status = '미납';
  applyCarryForward(s, RATE, 9);
  const r10 = s.rounds[2];
  // 9/25 → 10/25 = 30일, 1,367,000 × 20% ÷ 365 × 30 = 22,471.2 → 22,470원
  assert.equal(r10.prevUnpaid, RENT);
  assert.equal(r10.interest, 22470);
  assert.equal(r10.total, RENT + RENT + 22470);
  // 그다음 회차는 10회차가 아직 안 들어온 게 아니므로 그대로
  assert.equal(s.rounds[3].total, RENT);
});

test('미납 취소: 다음 청구서가 원래 렌트료로 돌아간다', () => {
  const s = schedule();
  s.rounds[1].status = '미납';
  applyCarryForward(s, RATE, 9);
  s.rounds[1].status = '청구됨';
  applyCarryForward(s, RATE, 9);
  assert.equal(s.rounds[2].prevUnpaid, 0);
  assert.equal(s.rounds[2].interest, 0);
  assert.equal(s.rounds[2].total, RENT);
});

test('이미 발행한 청구서는 금액을 바꾸지 않는다', () => {
  const s = schedule();
  s.rounds[2].issuedAt = due(10); // 10회차가 이미 나갔다
  s.rounds[1].status = '미납';
  applyCarryForward(s, RATE, 9);
  assert.equal(s.rounds[2].total, RENT);
});
