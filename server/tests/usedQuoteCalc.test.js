import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateUsedQuoteOption, usedOwnCarInsurance, vehicleAgeLimit, monthsLabel } from '../../shared/usedQuoteCalc.js';

// 방기태 변호사님 GLE450 견적(2026-10-26 엑셀 '견적서 보고용'). 수수료·딜러 0%로 낸 견적이다.
const GLE = { usedPrice: 22105860, newCarPrice: 118600000, cc: 3000, commissionRate: 0, dealerRate: 0 };
const near = (actual, expected, tol = 1) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} ≠ ${expected}`);

test('자차 보험비는 신차가격을 천만 원 단위로 올려 요율을 곱한다 (엑셀 E26)', () => {
  near(usedOwnCarInsurance(118600000), 1774041);
});

test('GLE450 12개월·보증금=인수가 1,236만·월 1,143,000 → 엑셀 1안과 같은 원가·이익', () => {
  const r = calculateUsedQuoteOption(
    { termMonths: 12, mileage: 20000, deposit: 12360000, takeoverPrice: 12360000, calcMode: 'manual', monthlyFee: 1143000 },
    GLE
  );
  near(r.fundingPrincipal, 12319901);
  near(r.fundingInterest, 561565);
  near(r.pandanbi, 663176);
  near(r.totalCost, 26076642);
  near(r.profit, -642);
});

test('목표 이익 0으로 24개월 → 월 703,000 (엑셀 기본 계산식 열)', () => {
  const r = calculateUsedQuoteOption(
    { termMonths: 24, mileage: 20000, deposit: 12360000, takeoverPrice: 12360000, calcMode: 'auto', targetProfit: 0 },
    GLE
  );
  near(r.totalCost, 29247653);
  assert.equal(r.monthlyFee, 703000);
});

test('보증금·인수가 없이 60개월 → 엑셀 3안 원가', () => {
  const r = calculateUsedQuoteOption({ termMonths: 60, mileage: 20000, calcMode: 'manual', monthlyFee: 0 }, GLE);
  near(r.totalCost, 41515422);
});

test('수수료 3%(양식 기본값)를 넣으면 원가에 중고차 가격의 3%가 더해진다', () => {
  const base = calculateUsedQuoteOption({ termMonths: 12, deposit: 12360000, takeoverPrice: 12360000, calcMode: 'auto' }, GLE);
  const withFee = calculateUsedQuoteOption({ termMonths: 12, deposit: 12360000, takeoverPrice: 12360000, calcMode: 'auto' }, { ...GLE, commissionRate: 0.03 });
  near(withFee.totalCost - base.totalCost, 663176);
  assert.equal(withFee.monthlyFee, 1198000);
});

test('차령: 2000cc 미만은 등록 후 6년 전날까지, 레이 2021-11-03 등록이면 2026-11-03부터 12개월', () => {
  const a = vehicleAgeLimit({ registrationDate: '2021-11-03', cc: 998 }, '2026-11-03');
  assert.equal(a.years, 6);
  assert.equal(a.lastDay, '2027-11-02');
  assert.equal(a.maxMonths, 12);
});

test('차령: 2000cc 이상은 9년, GLE450 2021-11-12 등록·2026-11-13 시작이면 47개월', () => {
  const a = vehicleAgeLimit({ registrationDate: '2021-11-12', cc: 2999 }, '2026-11-13');
  assert.equal(a.years, 9);
  assert.equal(a.lastDay, '2030-11-11');
  assert.equal(a.maxMonths, 47);
});

test('차령: DB 날짜(한국 자정 = UTC 전날 15시)도 한국 날짜로 읽는다', () => {
  const a = vehicleAgeLimit({ registrationDate: new Date('2021-11-02T15:00:00Z'), cc: 998 }, new Date('2026-11-02T15:00:00Z'));
  assert.equal(a.firstRegistered, '2021-11-03');
  assert.equal(a.maxMonths, 12);
});

test('차령: 이미 한도를 지난 차는 0개월, 등록일이 없으면 null', () => {
  assert.equal(vehicleAgeLimit({ registrationDate: '2019-01-01', cc: 1600 }, '2026-11-01').maxMonths, 0);
  assert.equal(vehicleAgeLimit({ cc: 1600 }, '2026-11-01'), null);
});

test('개월 표시', () => {
  assert.equal(monthsLabel(47), '3년 11개월');
  assert.equal(monthsLabel(12), '1년');
  assert.equal(monthsLabel(5), '5개월');
});
