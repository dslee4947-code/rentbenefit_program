/**
 * 견적 계산식 점검.
 *
 *   cd server && npm test
 *
 * 견적 화면(shared/quoteCalc.js)과 렌트차량 DB 이익 계산(server/utils/vehicleProfit.js)이 같은 식을 쓰는지,
 * 엑셀 원본과 숫자가 맞는지, 한 번 고친 문제가 다시 생기지 않는지 본다. DB에 붙지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PMT, calculateQuoteOption, getMaintenanceBreakdown, getTireCount, describeTireProvision,
  fundingInterestFor, acquisitionTaxFor, publicBondFor, defaultMaintenanceItems
} from '../../shared/quoteCalc.js';
import { calculateVehicleProfit } from '../utils/vehicleProfit.js';
import { pickLedgerCategory, parseLoanRound } from '../models/VehicleLedger.js';

test('원장 대출·상환 줄 분류', () => {
  assert.equal(pickLedgerCategory('차량가-렌공대출', '입금'), '대출금');
  assert.equal(pickLedgerCategory('차량가-렌공대출', '지출'), '차량가');
  assert.equal(pickLedgerCategory('메리츠12차 상환', '지출'), '할부금');
  assert.equal(pickLedgerCategory('원리금 상환1차', '지출'), '할부금');
  assert.equal(pickLedgerCategory('1차 상환+이자', '지출'), '할부금');
  assert.equal(pickLedgerCategory('중도 상환 수수료', '지출'), '수수료');
  assert.equal(pickLedgerCategory('렌공대출 이자', '지출'), '할부이자');
  // 대출과 상관없는 줄은 예전 규칙 그대로
  assert.equal(pickLedgerCategory('렌터카보험 보증금', '지출'), '공제조합');
  assert.equal(pickLedgerCategory('삼성보험료 환급', '입금'), '환급');
  assert.equal(pickLedgerCategory('렌트료 3회차', '입금'), '렌트료');
  assert.equal(parseLoanRound('메리츠12차 상환'), 12);
  assert.equal(parseLoanRound('원리금 상환2차'), 2);
  assert.equal(parseLoanRound('할부 1회'), 1);
  assert.equal(parseLoanRound('대출 상환'), undefined);
});

// 견적 화면에서 새 차량을 만들 때의 기본값(QuoteInputView createNewVehicle)
const baseVehicle = (overrides = {}) => ({
  carPrice: 50000000, carOptionPrice: 0, discountPrice: 0, consignmentFee: 0, isBondExempt: false,
  globalInsuranceFee: 800000, cc: 1999, baseInterestRate: 0.06, commissionRateP: 0.03, dealerCommissionRateP: 0,
  isPandanbiEnabled: true, isMaintenanceEnabled: true, globalRegistrationAgencyFee: 100000, maintenanceItems: null,
  ...overrides
});
const baseOption = (overrides = {}) => ({
  termYears: 4, mileage: 20000, residualRate: 0.55, depositRate: 0.30, advancePaymentRate: 0,
  tireUnitCost: 160000, calcMode: 'manual', monthlyFeeInput: 700000, targetProfitInput: 0, isMaintenanceEnabled: true,
  ...overrides
});
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} (기대 ${expected} ± ${tolerance})`);

test('엑셀 ver4 마이바흐 1안의 조달이자와 같다', () => {
  // 엑셀 '견적서(단일셀)' C13 조달원금, C77 만기 잔액, 금리 6.1%, 60개월
  const principal = 191495642.04081634;
  near(fundingInterestFor({ annualRate: 0.061, months: 60, principal, balloon: 6340000 }), 32069644.11, 0.01, '만기 인수가 상환');
  near(fundingInterestFor({ annualRate: 0.061, months: 60, principal }), 31162601, 60000, '원리금 균등상환(엑셀 2안과 같은 크기)');
  assert.equal(acquisitionTaxFor(317000000), 11527270); // 엑셀 C21
  assert.equal(publicBondFor(317000000), 1383270);      // 엑셀 C22
});

test('PMT는 엑셀과 같다', () => {
  // 엑셀 ver4 '견적서(단일셀)' C70 = PMT(5.27%/12, 60, -337,235,061, 101,440,000)
  near(PMT(0.0527 / 12, 60, -337235061, 101440000), 4924460.849951597, 0.001, 'PMT');
});

test('타이어는 계약 기간 주행거리 6만km마다 4본', () => {
  assert.equal(getTireCount({ termYears: 4, mileage: 20000 }), 4);  // 8만km
  assert.equal(getTireCount({ termYears: 5, mileage: 30000 }), 8);  // 15만km
  assert.equal(getTireCount({ termYears: 3, mileage: 10000 }), 0);  // 3만km
  assert.equal(describeTireProvision(60, 30000), '계약 기간 동안 8본 제공');
  assert.equal(describeTireProvision(36, 10000), '제공 없음 (총 주행거리 6만km 미만)');
  assert.equal(describeTireProvision(48, ''), '계약 기간 주행거리에 따라 제공');
});

test('타이어 교체비가 원가에 한 번만 들어간다', () => {
  const vehicle = baseVehicle();
  const opt = baseOption();
  const withMaintenance = calculateQuoteOption(opt, vehicle);
  const without = calculateQuoteOption({ ...opt, isMaintenanceEnabled: false }, vehicle);
  const plan = getMaintenanceBreakdown(opt, vehicle);

  assert.equal(withMaintenance.tireCostTotal, 4 * 160000);
  // 정비 원가 전체 = 화면의 월 정비비(타이어 포함) × 개월 수. 여기에 타이어를 한 번 더 더하면 안 된다.
  near(withMaintenance.totalCost - without.totalCost, plan.monthlyFee * 48, 0.001, '정비 원가');
  near(withMaintenance.maintenanceFeeTotal + withMaintenance.tireCostTotal, plan.monthlyFee * 48, 0.001, '정비비 + 타이어');
});

test('정비 내역에서 타이어 교체를 끄면 타이어비는 0원', () => {
  const items = defaultMaintenanceItems.map((item) => (item.name === '타이어 교체' ? { ...item, checked: false } : item));
  const calc = calculateQuoteOption(baseOption({ maintenanceItems: items }), baseVehicle());
  assert.equal(calc.tireCostTotal, 0);
});

test('렌트차량 DB 이익 계산이 견적서와 같은 조달이자·정비비를 쓴다', () => {
  const vehicle = baseVehicle();
  const opt = baseOption();
  const quote = calculateQuoteOption(opt, vehicle);

  // 견적서와 같은 조건의 차량 문서. 견적서는 보증금·인수가를 1000원 단위로 버리므로 그 값을 그대로 넣는다.
  const profit = calculateVehicleProfit({
    carPrice: 50000000, optionPrice: 0, deliveryFee: 0, discount: 0, cc: 1999,
    deposit: quote.deposit, advancePayment: 0, takeoverPrice: quote.takeoverPrice, monthlyFee: 700000,
    acquisitionTax: quote.acquisitionTax, publicBond: quote.publicBond, registrationAgencyFee: 100000,
    interestRate: 6, maintenance: { generalMaintenance: '가입', mileage: 20000 }
  }, 48);

  assert.ok(profit.ok);
  near(profit.breakdown.maintenanceFee, quote.maintenanceFeeTotal, 0.001, '정비비');
  near(profit.breakdown.tireFee, quote.tireCostTotal, 0.001, '타이어비');
  // 차량 DB 이익 = 견적 영업이익 + 회사수수료 (회사가 가져가는 몫)
  near(profit.profitAmount, quote.profitMargin + quote.companyCommission, 1, '이익금');
});
