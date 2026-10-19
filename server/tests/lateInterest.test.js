import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryInto } from '../controllers/billingScheduleController.js';
import { calcLateInterest, daysBetween } from '../utils/billingDate.js';

// 연체 이자 규칙(2026-10-18 확정): 안 낸 돈은 전부 넘기되, 이자는 원금에만 붙인다(이자에 이자 없음).
// 숫자는 동춘푸드(월 1,367,000원, 연 20%, 25일 결제)로 맞춘다.
const RENT = 1367000;
const RATE = 20;
const due = (m) => new Date(2026, m - 1, 25);

/** 앞 회차부터 차례로 이월·이자를 채운다(applyCarryForward와 같은 순서). */
const roll = (rounds) => {
  for (const r of rounds) {
    const prev = rounds.find((x) => x.no === r.no - 1);
    if (!prev) { r.total = r.monthlyRent; continue; }
    const { carried, interestBase } = carryInto(rounds, r.no);
    r.prevUnpaid = carried;
    r.interest = calcLateInterest({ unpaid: interestBase, annualRate: RATE, days: daysBetween(prev.dueDate, r.dueDate) });
    r.total = r.monthlyRent + r.prevUnpaid + r.interest;
  }
  return rounds;
};

test('한 달 밀리면 다음 청구서에 원금 기준 한 달치 이자', () => {
  const rounds = roll([
    { no: 34, dueDate: due(8), monthlyRent: RENT, status: '미납', paidAmount: 0 },
    { no: 35, dueDate: due(9), monthlyRent: RENT, status: '예정', paidAmount: 0 }
  ]);
  assert.equal(rounds[1].prevUnpaid, RENT);
  assert.equal(rounds[1].interest, 23220); // 31일
});

test('계속 밀려도 이자에는 이자가 붙지 않는다', () => {
  const rounds = roll([
    { no: 34, dueDate: due(8), monthlyRent: RENT, status: '미납', paidAmount: 0 },
    { no: 35, dueDate: due(9), monthlyRent: RENT, status: '미납', paidAmount: 0 },
    { no: 36, dueDate: due(10), monthlyRent: RENT, status: '예정', paidAmount: 0 }
  ]);
  // 35회: 34회분 원금 1,367,000에 31일 이자
  assert.equal(rounds[1].interest, 23220);
  // 36회: 넘어오는 돈은 35회 안 낸 돈 전부(이자 포함), 이자는 원금 2,734,000에만 30일
  assert.equal(rounds[2].prevUnpaid, rounds[1].total);
  assert.equal(rounds[2].interest, calcLateInterest({ unpaid: 2 * RENT, annualRate: RATE, days: 30 }));
  assert.equal(rounds[2].interest, 44940);
});

test('한 달치만 내면 원금부터 갚은 것으로 보고 남은 이자는 넘기되 이자를 낳지 않는다', () => {
  const rounds = [
    { no: 34, dueDate: due(8), monthlyRent: RENT, status: '미납', paidAmount: 0 },
    { no: 35, dueDate: due(9), monthlyRent: RENT, status: '미납', paidAmount: 0 },
    { no: 36, dueDate: due(10), monthlyRent: RENT, status: '예정', paidAmount: 0 }
  ];
  roll(rounds);
  // 35회 청구액(2,757,220) 중 한 달치(1,367,000)만 들어왔다
  rounds[1].paidAmount = RENT;
  roll(rounds);
  const owe = rounds[1].total - RENT; // 1,367,000 + 23,220
  assert.equal(rounds[2].prevUnpaid, owe);
  // 이자는 남은 원금 1,367,000에만 (23,220원 이자에는 붙지 않는다)
  assert.equal(rounds[2].interest, calcLateInterest({ unpaid: RENT, annualRate: RATE, days: 30 }));
});

test('입금완료·청구됨 회차는 넘어가지 않는다', () => {
  const rounds = roll([
    { no: 34, dueDate: due(8), monthlyRent: RENT, status: '입금완료', paidAmount: RENT },
    { no: 35, dueDate: due(9), monthlyRent: RENT, status: '청구됨', paidAmount: 0 },
    { no: 36, dueDate: due(10), monthlyRent: RENT, status: '예정', paidAmount: 0 }
  ]);
  assert.equal(rounds[1].prevUnpaid, 0);
  assert.equal(rounds[2].prevUnpaid, 0);
  assert.equal(rounds[2].interest, 0);
});
