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

test('거래완료 차에 인수가 줄 없이 남은 보증금은 인수가와 상계한 돈으로 본다 (Benz-018)', async () => {
  const { summarizeLedger } = await import('../models/VehicleLedger.js');
  const entries = [
    { side: '입금', category: '보증금', amount: 42330000, bank: 'B' },
    { side: '입금', category: '렌트료', amount: 131732100, bank: 'B' },
    { side: '지출', category: '차량가', amount: 135456000, bank: 'B' }
  ];
  const done = summarizeLedger({ status: '거래완료', entries });
  assert.equal(done.takeoverOffset, 42330000);
  assert.equal(done.depositHeld, 0);
  assert.equal(done.balance, 42330000 + 131732100 - 135456000);
  // 운용 중이면 아직 돌려줄 보증금이다
  const running = summarizeLedger({ status: '운용중', entries });
  assert.equal(running.takeoverOffset, 0);
  assert.equal(running.balance, 131732100 - 135456000);
  // 인수가 줄이 따로 있으면 보증금은 돌려줄 돈 그대로다
  const withTakeover = summarizeLedger({ status: '거래완료', entries: [...entries, { side: '입금', category: '인수가', amount: 42330000, bank: 'B' }] });
  assert.equal(withTakeover.takeoverOffset, 0);
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

test('단기렌트 월 목표: 견적 3년·인수가 30%·정비 포함, 원장 고객입금과 달마다 비교', async () => {
  const { calculateShortTermTarget, shortTermPerformance, isShortTermIncome, SHORT_TERM_TARGET_TERMS, SHORT_TERM_COMPARE_TERMS } = await import('../../shared/shortTermTarget.js');
  const car = { carPrice: 35550000, cc: 1598, carModel: 'K5 하이브리드' };
  const t = calculateShortTermTarget(car, { annualRate: 0.06 });
  assert.equal(t.ok, true);
  // 같은 조건을 견적 식에 직접 넣은 값과 같아야 한다(수수료 0, 영업이익 0)
  const q = calculateQuoteOption(
    { termYears: 3, mileage: 20000, depositRate: 0, advancePaymentRate: 0, residualRate: 0.3, calcMode: 'auto', targetProfitInput: 0, isMaintenanceEnabled: true,
      maintenanceItems: undefined },
    { carPrice: 35550000, carOptionPrice: 0, discountPrice: 0, consignmentFee: 0, isBondExempt: false, globalInsuranceFee: 800000, cc: 1598,
      baseInterestRate: 0.06, dealerCommissionRateP: 0, commissionRateP: 0, isPandanbiEnabled: true, isMaintenanceEnabled: true, globalRegistrationAgencyFee: 100000 }
  );
  // 단기렌트는 선수금을 받지 않는다(선수금을 넣으면 조달이자가 빠진다). 인수가는 차량가의 30%
  assert.equal(t.advancePayment, 0);
  assert.equal(t.takeoverPrice, q.takeoverPrice);
  assert.equal(t.takeoverPrice, 10665000);
  assert.ok(t.monthlyTarget > 900000 && t.monthlyTarget < 1200000, `K5 월 목표 ${t.monthlyTarget}`);
  assert.ok(t.maintenanceCost > 0, '정비 포함');
  // 36개월 렌트료 + 3년 뒤 인수가(30%)가 3년 원가를 덮는다(1000원 절사만큼만 모자람)
  assert.ok(t.monthlyTarget * 36 + t.takeoverPrice >= t.totalCost - 36 * 1000);
  // 비교: 5년·인수가 0%는 월 목표가 더 낮고, 60개월 렌트료만으로 5년 원가를 덮는다
  const five = calculateShortTermTarget(car, { annualRate: 0.06, terms: SHORT_TERM_COMPARE_TERMS });
  assert.equal(five.takeoverPrice, 0);
  assert.ok(five.monthlyTarget < t.monthlyTarget);
  assert.ok(five.monthlyTarget * 60 >= five.totalCost - 60 * 1000);
  assert.equal(SHORT_TERM_TARGET_TERMS.termMonths, 36);
  assert.equal(calculateShortTermTarget({ carPrice: 0 }).ok, false);

  // 매출로 세는 줄: 고객입금 열의 대여 입금. 보증금·장기 렌트료·과태료 대납·수수료(기타 열)는 뺀다
  assert.equal(isShortTermIncome({ side: '입금', group: '고객입금', category: '기타', amount: 300000 }), true);
  assert.equal(isShortTermIncome({ side: '입금', group: '고객입금', category: '보증금', amount: 300000 }), false);
  assert.equal(isShortTermIncome({ side: '입금', group: '고객입금', category: '과태료·통행료', amount: 30000 }), false);
  assert.equal(isShortTermIncome({ side: '입금', group: '기타', category: '수수료', amount: 30000 }), false);
  assert.equal(isShortTermIncome({ side: '지출', group: '회사출금', category: '기타', amount: 30000 }), false);

  // 6월 16일(30일 중 15일 남음) 출고, 오늘 8월 10일. 6월 목표는 절반, 8월은 10/31
  const ledger = {
    header: { deliveredAt: '2026-06-16T00:00:00+09:00' },
    entries: [
      { side: '입금', group: '고객입금', category: '기타', amount: 600000, date: '2026-06-20T00:00:00+09:00' },
      { side: '입금', group: '고객입금', category: '기타', amount: 1200000, date: '2026-07-05T00:00:00+09:00' },
      { side: '입금', group: '고객입금', category: '보증금', amount: 5000000, date: '2026-07-05T00:00:00+09:00' },
      { side: '입금', group: '고객입금', category: '기타', amount: 100000, date: '2026-08-03T00:00:00+09:00' }
    ]
  };
  const p = shortTermPerformance(ledger, 1000000, new Date('2026-08-10T12:00:00+09:00'));
  assert.equal(p.ok, true);
  assert.deepEqual(p.months.map((m) => m.month), ['2026-06', '2026-07', '2026-08']);
  // 새 차(1년차)라 목표를 10% 더 잡는다
  assert.equal(p.ageYear, 1);
  assert.equal(p.currentTarget, 1100000);
  assert.equal(p.months[0].target, 550000);
  assert.equal(p.months[1].target, 1100000);
  assert.equal(p.months[2].target, Math.round(1100000 * 10 / 31));
  assert.deepEqual(p.months.map((m) => m.actual), [600000, 1200000, 100000]);
  assert.equal(p.metMonths, 2); // 이번 달은 진행 중이라 세지 않는다
  assert.equal(p.doneMonths, 2);
  assert.equal(p.cumActual, 1900000);

  // 장기렌트를 마친 차는 마지막 렌트료 다음 달부터 센다
  const converted = { header: { deliveredAt: '2023-01-10' }, entries: [
    { side: '입금', group: '고객입금', category: '렌트료', amount: 900000, date: '2026-03-10T00:00:00+09:00' },
    { side: '입금', group: '고객입금', category: '기타', amount: 400000, date: '2026-03-20T00:00:00+09:00' },
    { side: '입금', group: '고객입금', category: '기타', amount: 700000, date: '2026-04-20T00:00:00+09:00' }
  ] };
  const c = shortTermPerformance(converted, 1000000, new Date('2026-05-31T12:00:00+09:00'));
  assert.equal(c.start.source, 'afterLongTerm');
  assert.equal(c.months[0].month, '2026-04');
  assert.equal(c.cumActual, 700000); // 3월 단기 입금은 장기 기간이라 뺀다
  // 직접 정한 시작일이 먼저다
  const manual = shortTermPerformance({ ...converted, shortTerm: { startDate: '2026-03-01T00:00:00+09:00' } }, 1000000, new Date('2026-05-31T12:00:00+09:00'));
  assert.equal(manual.start.source, 'manual');
  assert.equal(manual.cumActual, 1100000);
});

test('단기렌트 차령 가감: 1년차 ×1.1 · 2년차 ×1.0 · 3년차 ×0.9, 3년 합계는 그대로', async () => {
  const { ageFactorFor, ageAdjustedTarget, shortTermPerformance, SHORT_TERM_AGE_FACTORS } = await import('../../shared/shortTermTarget.js');
  assert.equal(ageFactorFor(0).factor, 1.1);
  assert.equal(ageFactorFor(11).ageYear, 1);
  assert.equal(ageFactorFor(12).factor, 1.0);
  assert.equal(ageFactorFor(35).factor, 0.9);
  assert.equal(ageFactorFor(40).factor, 0.8);
  assert.equal(ageFactorFor(200).factor, SHORT_TERM_AGE_FACTORS[SHORT_TERM_AGE_FACTORS.length - 1]);
  // 월 120만 원: 1년차 132만 · 2년차 120만 · 3년차 108만 → 36개월 합계 4,320만 원 그대로
  const total = Array.from({ length: 36 }, (_, i) => ageAdjustedTarget(1200000, i)).reduce((a, b) => a + b, 0);
  assert.equal(ageAdjustedTarget(1200000, 0), 1320000);
  assert.equal(ageAdjustedTarget(1200000, 30), 1080000);
  assert.equal(total, 1200000 * 36);
  // 장기렌트를 마치고 넘어온 차는 처음 들인 날로 차령을 센다(2022년 차를 2026년에 단기로 돌리면 5년차)
  const p = shortTermPerformance(
    { header: { registeredAt: '2022-01-10T00:00:00+09:00' }, shortTerm: { startDate: '2026-03-01T00:00:00+09:00' }, entries: [] },
    1000000, new Date('2026-04-15T12:00:00+09:00')
  );
  assert.equal(p.months[0].ageYear, 5);
  assert.equal(p.months[0].target, 700000);
});

test('단기렌트 단가표: 1일=1개월×10%(2,500원 올림)·1주=1일×4, 대여료·탁송료 계산', async () => {
  const { deriveRates, quoteRental, insurerGradeFor, insurerAmountFor, mergeRatePolicy, DEFAULT_RATE_POLICY } = await import('../../shared/shortTermRates.js');
  // 엑셀 단가표와 같은 규칙: K5 1,096,000 → 110,000 / 440,000, 레이 439,000 → 45,000, S500 5,871,000 → 587,500
  assert.deepEqual(deriveRates(1096000), { day: 110000, week: 440000, month: 1096000 });
  assert.equal(deriveRates(439000).day, 45000);
  assert.equal(deriveRates(5871000).day, 587500);
  const rates = deriveRates(1096000);
  const policy = mergeRatePolicy(null);
  // 1일 대여(평일, 서울): 렌트료 + 1일 탁송료 3만 원
  const one = quoteRental({ rates, start: '2026-10-06T10:00', end: '2026-10-07T10:00', region: '서울', holidays: [], policy });
  assert.equal(one.rent, 110000);
  assert.equal(one.delivery, 30000);
  // 목(평일)·금(한글날)·토 3일: 공휴일·토요일은 10% 할증, 일요일 반납은 휴일 회수 탁송 추가
  const three = quoteRental({ rates, start: '2026-10-08T10:00', end: '2026-10-11T10:00', region: '서울', holidays: ['2026-10-09'], policy });
  assert.equal(three.rent, 110000 + 121000 + 121000);
  assert.equal(three.delivery, DEFAULT_RATE_POLICY.delivery.holidayFee);
  // 6일은 1일 요금 합보다 1주 요금이 싸서 1주로
  const six = quoteRental({ rates, start: '2026-10-12T10:00', end: '2026-10-18T10:00', region: '서울', holidays: [], policy });
  assert.equal(six.rent, 440000);
  assert.equal(six.weeks, 1);
  assert.equal(six.allowanceKm, 1050);
  // 26일은 1개월 요금으로 끊고, 주행 한도도 1개월(2,500km). 경기·인천은 왕복 탁송료
  const month = quoteRental({ rates, start: '2026-10-06T10:00', end: '2026-11-01T09:00', region: '경기·인천', holidays: [], policy, expectedKm: 3000 });
  assert.equal(month.rent, 1096000);
  assert.equal(month.allowanceKm, 2500);
  assert.equal(month.excess, 500 * 200);
  assert.equal(month.delivery, 40000 + DEFAULT_RATE_POLICY.delivery.holidayFee); // 11/1은 일요일
  // 그 밖의 지역은 별도 협의
  assert.equal(quoteRental({ rates, start: '2026-10-06T10:00', end: '2026-10-09T09:00', region: '기타', holidays: [], policy }).deliveryKnown, false);
  // 사고대차 보험사 기준: 1,598cc는 소형 B, 7일 = 77,000×2 + 69,300×2 + 65,800×2 + 61,600
  assert.equal(insurerGradeFor(1598).grade, 'B');
  assert.equal(insurerGradeFor(2497).grade, 'D');
  assert.equal(insurerGradeFor(0), null);
  assert.equal(insurerAmountFor(insurerGradeFor(1598), 7), 77000 * 2 + 69300 * 2 + 65800 * 2 + 61600);
});

test('사고대차 하이브리드 기준·렌터카 차령', async () => {
  const { insurerCcFor, insurerGradeFor, rentalLifeFor } = await import('../../shared/shortTermRates.js');
  // 하이브리드는 같은 모델 내연기관 기준(2022-10~): 그랜저·쏘렌토 HEV 1.6 → 2.5 기준 D, K5 HEV → 2.0 기준 C
  assert.equal(insurerGradeFor(insurerCcFor({ cc: 1598, carModel: 'Sorento(H) HEV 2WD' }).cc).grade, 'D');
  assert.equal(insurerGradeFor(insurerCcFor({ cc: 1600, carModel: '그랜저(H) 1.6T' }).cc).grade, 'D');
  assert.equal(insurerGradeFor(insurerCcFor({ cc: 1999, carModel: 'K5(H) 하이브리드' }).cc).grade, 'C');
  assert.equal(insurerCcFor({ cc: 2999, carModel: 'E450 4M' }).basis, 'cc');
  // 차령은 실제 배기량 규모: 레이 2021-11-02 → 5년 2026-11-02, S400d(2,999cc 대형) → 8년
  assert.equal(rentalLifeFor({ cc: 998, ageStart: new Date(2021, 10, 2) }).until.getFullYear(), 2026);
  assert.equal(rentalLifeFor({ cc: 2999, ageStart: new Date(2021, 11, 26) }).years, 8);
  assert.equal(rentalLifeFor({ cc: 1598, ageStart: new Date(2025, 11, 29) }).years, 5); // 하이브리드 1.6도 소형 5년
});

// 돈이 나가고 들어오는 때를 그대로 조달금리로 할인해 구한 손익분기 렌트료(기준 답).
// 렌트료는 매달 말, 보험료·자동차세는 매년 초에 낸다고 본다.
const breakEvenByCashFlow = (calc, vehicle, opt) => {
  const i = calc.interestRate / 12;
  const n = Math.round(opt.termYears * 12);
  const upfront = calc.netVehiclePrice + calc.acquisitionTax + calc.publicBond + vehicle.globalRegistrationAgencyFee + calc.companyCommission + calc.pandanbi;
  const yearly = vehicle.globalInsuranceFee + calc.ownCarInsuranceFee + calc.carTaxAnnual;
  let pvYearly = 0;
  for (let y = 0; y < opt.termYears; y++) pvYearly += yearly / (1 + i) ** (12 * y);
  const annuity = (1 - (1 + i) ** -n) / i;
  return (upfront + pvYearly - calc.deposit - calc.advancePayment - (calc.takeoverPrice - calc.deposit) / (1 + i) ** n) / annuity;
};

test('만기 인수가 상환은 현금흐름 기준 손익분기 렌트료와 맞는다 (G90 60개월·인수가 50%, 2026-10-28)', () => {
  const vehicle = baseVehicle({ carPrice: 101780000, consignmentFee: 360000, cc: 3470, isMaintenanceEnabled: false, fundingRepaymentMode: 'balloon' });
  const fees = {};
  for (const [name, depositRate, advancePaymentRate] of [['무보증', 0, 0], ['선납', 0, 0.3], ['보증', 0.3, 0]]) {
    const opt = baseOption({ termYears: 5, residualRate: 0.5, depositRate, advancePaymentRate, calcMode: 'auto', targetProfitInput: 0, isMaintenanceEnabled: false });
    const calc = calculateQuoteOption(opt, vehicle);
    const reference = breakEvenByCashFlow(calc, vehicle, opt);
    near(calc.monthlyLeaseFee, reference, 25000, `${name} 손익분기 렌트료`);
    fees[name] = { calc: calc.monthlyLeaseFee, reference };
  }
  // 선수금·보증금으로 깎이는 몫은 기준 답과 1천 원 단위 절사 범위 안에서 같다(경쟁사 591,400 / 156,200)
  near(fees.무보증.calc - fees.선납.calc, fees.무보증.reference - fees.선납.reference, 2000, '선수금 30% 할인폭');
  near(fees.무보증.calc - fees.보증.calc, fees.무보증.reference - fees.보증.reference, 2000, '보증금 30% 할인폭');
});

test('선수금분이자는 0원, 상환방식이 없는 예전 견적은 균등상환 그대로 (2026-10-28)', () => {
  const calc = calculateQuoteOption(baseOption({ depositRate: 0, advancePaymentRate: 0.3 }), baseVehicle());
  assert.equal(calc.advancePaymentInterest, 0);
  assert.equal(calc.fundingRepaymentMode, 'equal');
  assert.equal(calc.fundingBalloon, 0);
});
