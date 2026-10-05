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

test('타이어는 계약 기간 주행거리 5만km마다 4본', () => {
  assert.equal(getTireCount({ termYears: 4, mileage: 20000 }), 4);   // 8만km
  assert.equal(getTireCount({ termYears: 5, mileage: 20000 }), 8);   // 10만km
  assert.equal(getTireCount({ termYears: 5, mileage: 30000 }), 12);  // 15만km
  assert.equal(getTireCount({ termYears: 2, mileage: 20000 }), 0);   // 4만km
  assert.equal(getTireCount({ termYears: 5, mileage: 10000 }), 4);   // 5만km 딱 맞으면 제공
  assert.equal(describeTireProvision(60, 30000), '계약 기간 동안 12본 제공');
  assert.equal(describeTireProvision(36, 10000), '제공 없음 (총 주행거리 5만km 미만)');
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

// ───────── 차종 등급별 정비 단가표
import {
  detectVehicleGrade, buildMaintenanceItemsFromRates, mergeMaintenanceRates, DEFAULT_MAINTENANCE_RATES, VEHICLE_GRADES
} from '../../shared/maintenanceRates.js';

test('차종 이름으로 등급을 고른다', () => {
  const cases = {
    'Ray Van 스탠다드 A/T': 'compact', '아반떼 1.6 Modern': 'small', 'K5(H)': 'mid', '그랜저 2.5T 프리미엄': 'large',
    'G80 2.5T AWD': 'large', 'GV80 5인승 2.5T': 'suv', '니로 HEV 프레스티지': 'suv', '코나 하이브리드 2WD': 'suv',
    'Cona SX2 런칭 전기모터 2WD': 'ev', '아이오닉6 2WD': 'ev', 'Model S Plaid': 'ev',
    'S580 4Matic L': 'import', 'GLE450 4M': 'import', 'ES300h EXECUTIVE': 'import', 'CLE 200 Carbriolet': 'import'
  };
  for (const [name, grade] of Object.entries(cases)) assert.equal(detectVehicleGrade({ carModel: name }), grade, name);
  assert.equal(detectVehicleGrade({ carModel: '코나', fuelType: '전기' }), 'ev');
  assert.equal(detectVehicleGrade({ carModel: '' }), null);
});

test('단가표 기본값에 7등급 모두 근거가 있다', () => {
  for (const { key } of VEHICLE_GRADES) {
    const g = DEFAULT_MAINTENANCE_RATES.grades[key];
    assert.ok(g && g.basis && g.basis.length > 10, `${key} 근거`);
    assert.ok(g.tire.standard > 0 && g.tire.premium >= g.tire.standard, `${key} 타이어`);
  }
});

test('단가표로 낸 정비 원가 = 항목별 1회 단가 × 계약 기간 횟수 (대형 세단 48개월·연 2만km)', () => {
  const rates = mergeMaintenanceRates(null);
  const items = buildMaintenanceItemsFromRates(rates, 'large');
  const opt = baseOption({ maintenanceItems: items, tireUnitCost: rates.grades.large.tire.standard });
  const plan = getMaintenanceBreakdown(opt, baseVehicle());
  const byKey = Object.fromEntries(plan.lines.map((l) => [l.key, l]));
  // 총 8만km, 48개월
  assert.equal(byKey.regularCheck.times, 8);     // 1만km마다
  assert.equal(byKey.acFilter.times, 4);         // 12개월마다
  assert.equal(byKey.brakeFront.times, 2);       // 4만km마다
  assert.equal(byKey.brakeRear.times, 1);        // 6만km마다
  assert.equal(byKey.battery.times, 1);          // 48개월마다
  assert.equal(byKey.coolant.times, 0);         // 10만km마다 → 0회
  assert.equal(byKey.tire.times, 4);
  const expectedOther = 8 * 85000 + 4 * 50000 + 4 * 35000 + 4 * 30000 + 2 * 180000 + 1 * 150000 + 1 * 180000 + 1 * 230000 + 1 * 150000;
  assert.equal(plan.otherSum, expectedOther);
  assert.equal(plan.tireCost, 4 * 270000);
});

test('단가표를 고쳐도 이미 낸 견적(저장된 정비 내역)의 숫자는 그대로', () => {
  const rates = mergeMaintenanceRates(null);
  const items = buildMaintenanceItemsFromRates(rates, 'compact'); // 견적 낼 때 저장된 정비 내역
  const before = getMaintenanceBreakdown(baseOption({ maintenanceItems: items }), baseVehicle()).otherSum;
  const edited = mergeMaintenanceRates({ grades: { compact: { items: { regularCheck: 999999 } } } });
  assert.equal(edited.grades.compact.items.regularCheck, 999999);
  const after = getMaintenanceBreakdown(baseOption({ maintenanceItems: items }), baseVehicle()).otherSum;
  assert.equal(after, before);
});

test('전기차는 점화플러그가 꺼져 있고 브레이크 주기가 길다', () => {
  const items = buildMaintenanceItemsFromRates(mergeMaintenanceRates(null), 'ev');
  assert.equal(items.find((i) => i.key === 'sparkPlug').checked, false);
  assert.equal(items.find((i) => i.key === 'brakeFront').cycleKm, 60000);
});

test('렌트차량 DB 이익은 차종 등급의 단가표를 쓴다', () => {
  const profit = calculateVehicleProfit({
    carModel: 'G80 2.5T AWD', carPrice: 65250000, monthlyFee: 1135000, deposit: 19575000, takeoverPrice: 36540000, cc: 2497,
    maintenance: { generalMaintenance: '가입', mileage: 20000 }
  }, 48, { maintenanceRates: mergeMaintenanceRates(null) });
  assert.equal(profit.breakdown.grade, 'large');
  assert.equal(profit.breakdown.tireCount, 4);
  assert.equal(profit.breakdown.tireFee, 4 * 270000 + 90000); // 4본 + 얼라이먼트 1회
  assert.ok(profit.assumptions.some((a) => a.includes('대형 세단')));
});

test('타이어 교체 때마다 얼라이먼트 1회 (예전 견적은 얼라이먼트 0원)', () => {
  // 60개월·연 2만km = 10만km → 8본, 교체 2회
  const opt = baseOption({ termYears: 5, tireUnitCost: 270000, tireAlignmentCost: 90000 });
  const plan = getMaintenanceBreakdown(opt, baseVehicle());
  assert.equal(plan.tireCount, 8);
  assert.equal(plan.tireReplacements, 2);
  assert.equal(plan.tireCost, 8 * 270000 + 2 * 90000);
  // 얼라이먼트 값이 없는 예전 견적은 숫자가 그대로
  const old = getMaintenanceBreakdown(baseOption({ termYears: 5, tireUnitCost: 270000 }), baseVehicle());
  assert.equal(old.tireCost, 8 * 270000);
  // 단가표 7등급 모두 얼라이먼트 7~10만 원
  for (const g of Object.values(DEFAULT_MAINTENANCE_RATES.grades)) assert.ok(g.tire.alignment >= 70000 && g.tire.alignment <= 100000);
});

test('보증금 이자 이득 = 보증금 × 금리 × 기간', () => {
  // 보증금 1,500만·48개월·금리 6.14% → 3,684,000원 (예전 식은 1,955,474원)
  const calc = calculateQuoteOption(baseOption({ depositRate: 0.30 }), baseVehicle());
  assert.equal(calc.deposit, 15000000);
  near(calc.interestRate, 0.0614, 1e-9, '금리');
  near(calc.depositInterestBenefit, 3684000, 0.5, '보증금 이자 이득');
  near(calc.fundingInterest, calc.grossFundingInterest - 3684000, 0.5, '실제 조달 부담');
  // 보증금이 없으면 이득도 0
  assert.equal(calculateQuoteOption(baseOption({ depositRate: 0 }), baseVehicle()).depositInterestBenefit, 0);
});

test('정산금액은 보증금을 뺀다 (보증금 포함 값은 cashBalance)', async () => {
  const { summarizeLedger } = await import('../models/VehicleLedger.js');
  const s = summarizeLedger({ entries: [
    { side: '입금', category: '보증금', amount: 15000000, bank: 'B' },
    { side: '입금', category: '렌트료', amount: 700000, bank: 'B' },
    { side: '지출', category: '보험', amount: 1000000, bank: 'B' },
    { side: '지출', category: '보증금', amount: 100000, bank: 'B' } // 회사가 낸 이행보증금
  ] });
  assert.equal(s.cashBalance, 14600000); // 15,000,000 + 700,000 − 1,000,000 − 100,000
  assert.equal(s.depositHeld, 14900000);
  assert.equal(s.balance, 700000 - 1000000);
});

test('회사 내부 금리와 차별 내부 이자', async () => {
  const { computeInternalRate, internalInterestFor, hasOwnLoan } = await import('../../shared/companyFunding.js');
  // 잔액 가중 평균: (1억×5% + 3억×6%) ÷ 4억 = 5.75%
  const r = computeInternalRate({ loans: [{ balance: 100000000, annualRate: 0.05 }, { balance: 300000000, annualRate: 0.06 }] });
  near(r.rate, 0.0575, 1e-12, '내부 금리');
  assert.equal(computeInternalRate({ loans: [] }).source, 'default');
  assert.equal(computeInternalRate({ loans: [], manualRate: 0.058 }).rate, 0.058);
  // 1월에 1,200만 원으로 차를 사고 보증금 200만 원 받음 → 묶인 돈 1,000만 원, 3개월(1~3월) × 연 6% ÷ 12
  const entries = [
    { side: '지출', category: '차량가', amount: 12000000, date: '2026-01-10' },
    { side: '입금', category: '보증금', amount: 2000000, date: '2026-01-10' },
    { side: '지출', category: '할부금', amount: 999999, date: '2026-02-10' } // 대출 줄은 묶인 돈에서 뺀다
  ];
  const x = internalInterestFor(entries, 0.06, new Date('2026-03-20'));
  assert.equal(x.months, 3);
  near(x.interest, 10000000 * 0.06 / 12 * 3, 0.01, '내부 이자');
  assert.equal(hasOwnLoan(entries), true);
});
