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

test('다음 청구서가 이미 나갔으면 그다음 미발행 청구서에 원금과 한 달치 이자가 붙는다', () => {
  const s = schedule();
  s.rounds[2].issuedAt = due(10); // 10회차가 이미 나갔다
  s.rounds[1].status = '미납';
  applyCarryForward(s, RATE, 9);
  assert.equal(s.rounds[2].total, RENT); // 나간 청구서는 그대로
  const r11 = s.rounds[3];
  // 10/25 → 11/25 = 31일, 1,367,000 × 20% ÷ 365 × 31 = 23,220.0… → 23,220원
  assert.equal(r11.prevUnpaid, RENT);
  assert.equal(r11.interest, 23220);
  assert.equal(r11.total, RENT + RENT + 23220);
});

test('건너뛴 미납이 입금되거나 취소되면 그다음 청구서도 원래대로 돌아간다', () => {
  const s = schedule();
  s.rounds[2].issuedAt = due(10);
  s.rounds[1].status = '미납';
  applyCarryForward(s, RATE, 9);
  s.rounds[1].status = '입금완료';
  s.rounds[1].paidAmount = RENT;
  applyCarryForward(s, RATE, 9);
  assert.equal(s.rounds[3].prevUnpaid, 0);
  assert.equal(s.rounds[3].interest, 0);
  assert.equal(s.rounds[3].total, RENT);
});

test('건너뛴 미납과 나간 청구서의 미납이 함께 있으면 둘 다 넘어가고 이자는 원금에만 붙는다', () => {
  const s = schedule();
  s.rounds[2].issuedAt = due(10);
  s.rounds[1].status = '미납';
  s.rounds[2].status = '미납';
  applyCarryForward(s, RATE, 9);
  const r11 = s.rounds[3];
  assert.equal(r11.prevUnpaid, RENT * 2);
  assert.equal(r11.interest, 46440); // 2,734,000 × 20% ÷ 365 × 31 = 46,440.5… → 46,440원
});

test('이미 전월 미결제를 담고 나간 청구서가 있으면 앞 회차 미납을 또 넘기지 않는다', () => {
  const s = schedule();
  s.rounds[1].status = '미납';
  s.rounds[2].issuedAt = due(10);
  s.rounds[2].prevUnpaid = RENT; // 10회차가 9회차 미납을 담아 나갔다
  s.rounds[2].total = RENT * 2;
  applyCarryForward(s, RATE, 9);
  assert.equal(s.rounds[3].prevUnpaid, 0);
  assert.equal(s.rounds[3].total, RENT);
});

test('기타 청구에 직접 넣은 미납은 두 번 청구하지 않는다(번호가 일부만 같은 19회차 줄과 헷갈리지 않는다)', () => {
  const s = schedule();
  s.rounds[2].issuedAt = due(10);
  s.rounds[1].status = '미납';
  s.rounds[3].extras = [{ label: '9/25 9회차 미납 렌트료', amount: RENT }];
  applyCarryForward(s, RATE, 9);
  assert.equal(s.rounds[3].prevUnpaid, 0);
  assert.equal(s.rounds[3].interest, 0);

  const t = schedule();
  t.rounds[2].issuedAt = due(10);
  t.rounds[1].status = '미납';
  t.rounds[3].extras = [{ label: '9/30 19회차 미납 렌트료', amount: 1000 }];
  applyCarryForward(t, RATE, 9);
  assert.equal(t.rounds[3].prevUnpaid, RENT);
});
