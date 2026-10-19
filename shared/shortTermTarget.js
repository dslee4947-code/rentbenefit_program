/**
 * 단기렌트 차량의 월 목표 매출 (2026-10-05 대표님 결정).
 *
 * 단기렌트 차는 고객과 장기 계약을 맺지 않고 우리가 번갈아 빌려준다. 그래서 "견적서로 3년 계약을 잡았다면
 * 매달 얼마를 받아야 3년 동안 이 차에 나간 돈을 벌어 오는가"를 목표로 삼는다.
 *
 *   견적 조건: 3년(36개월) · 선수금 0 · 보증금 0 · 인수가 30% · 정비 포함 · 영업이익 0
 *   월 목표 = 그 견적의 월 렌트료
 *   원가 = 견적서와 같은 식(차량가·취득세·공채·보험·자동차세·조달이자·판관비·정비·타이어)
 *          베네핏 수수료는 넣지 않는다. 회사가 가져가는 몫이지 나간 돈이 아니다.
 *   선수금을 넣지 않는 이유: 선수금을 넣으면 그만큼 조달이자가 빠지는데, 단기렌트는 선수금을 받지 않는다.
 *   인수가 30% = 3년 뒤 차를 팔아 차량가의 30%를 받는다고 보고, 나머지를 3년 동안 매달 벌어 온다.
 *   (처음 정한 '선수금 30% · 잔가 0%'는 같은 날 이렇게 바꿨다.)
 *
 * 실제 매출은 원장(갑지)의 고객입금 줄을 달마다 더한다. 대차 기록(RentalRecord)은 아직 IMS 동기화 전이라 비어 있다.
 * 장기렌트를 마치고 단기렌트로 돌린 차는 마지막 장기 렌트료 다음 달부터 센다.
 *
 * 화면(원장)과 서버(경영 요약)가 같은 식을 쓰도록 여기에만 둔다.
 */
import { calculateQuoteOption } from './quoteCalc.js';
import { detectVehicleGrade, buildMaintenanceItemsFromRates, mergeMaintenanceRates, GRADE_LABEL } from './maintenanceRates.js';

export const SHORT_TERM_TARGET_TERMS = {
  termMonths: 36,
  advancePaymentRate: 0,
  residualRate: 0.3,
  targetProfit: 0,
  annualMileage: 20000,
  insuranceFeeAnnual: 800000, // 대인·대물 등 기본 보험료(연). 견적서 기본값
  registrationAgencyFee: 100000,
  pandanbiRate: 0.03
};

/**
 * 차령(차를 들인 뒤 몇 년째인지)에 따른 월 목표 가감 (2026-10-05 대표님 결정).
 *
 * 고객은 같은 값이면 새 차를 달라고 하지, 4년 된 차·많이 달린 차를 고르지 않는다.
 * 그래서 새 차일 때 더 받고 오래될수록 덜 받는다. 1~3년차 평균이 1.0이라 3년 동안 벌어 올 돈의 합은 그대로다
 * (월 목표 120만 원이면 1년차 132만 · 2년차 120만 · 3년차 108만, 3년 합계 4,320만 원 같음).
 * 4년차부터는 처음 계획(3년 뒤 인수가 30%에 매각)보다 오래 굴리는 기간이라 더 낮춘다. 마지막 값을 그 뒤에도 쓴다.
 * 주행거리는 원장에 계기판 기록이 없어 차령으로만 본다.
 */
export const SHORT_TERM_AGE_FACTORS = [1.1, 1.0, 0.9, 0.8, 0.7];

/** 차를 들인 지 ageMonths개월째일 때의 가감 비율과 몇 년차인지. */
export const ageFactorFor = (ageMonths) => {
  const idx = Math.max(0, Math.floor((Number(ageMonths) || 0) / 12));
  return { ageYear: idx + 1, factor: SHORT_TERM_AGE_FACTORS[Math.min(idx, SHORT_TERM_AGE_FACTORS.length - 1)] };
};

/** 기준 월 목표에 차령 가감 비율을 곱한 월 목표. 1,000원 단위로 끊는다. */
export const ageAdjustedTarget = (baseTarget, ageMonths) => Math.round((baseTarget * ageFactorFor(ageMonths).factor) / 1000) * 1000;

// 비교해 보는 조건: 5년 · 인수가 0%. 5년 동안 차값까지 다 벌고, 5년 뒤 중고차 값은 순수익으로 본다.
export const SHORT_TERM_COMPARE_TERMS = { termMonths: 60, residualRate: 0 };

/**
 * 단기렌트 매출로 세지 않는 입금. 보증금은 돌려줄 돈, 렌트료는 장기렌트 시절 렌트료,
 * 판매 수수료·캐시백·환급·대출금은 차를 빌려줘서 번 돈이 아니다. 과태료·통행료는 고객이 대신 낸 돈을 돌려받은 것이다.
 */
export const NOT_SHORT_TERM_INCOME = new Set(['보증금', '렌트료', '선납금', '인수가', '대출금', '수수료', '캐시백', '환급', '과태료·통행료', '할부금', '할부이자']);

/** 이 입금 줄이 단기렌트로 번 돈인지. 고객입금 열에 적힌 줄만 센다(기타 열은 수수료·캐시백·환급 자리다). */
export const isShortTermIncome = (e) => e.side === '입금'
  && (e.group || '고객입금') === '고객입금'
  && !NOT_SHORT_TERM_INCOME.has(e.category)
  && Number(e.amount) !== 0;

// 한국 날짜 기준 'YYYY-MM'. 서버(UTC)와 화면(한국)에서 같은 달로 묶이게 9시간을 더해 자른다.
export const monthKeyKst = (d) => new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7);
const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthDiff = (a, b) => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
};

/**
 * 월 목표를 견적서 식으로 낸다.
 *
 * @param {object} car 차량 정보 { carPrice, optionPrice, discount, deliveryFee, cc, carModel, fuelType, mileage, tireType }
 * @param {object} [opts] { annualRate: 내부 금리(연, 소수), maintenanceRates: 정비 단가표, terms: 조건 바꿔 보기(기간·인수가 비교용) }
 * @returns {{ ok: boolean, reason?: string, monthlyTarget?: number, totalCost?: number, takeoverPrice?: number, assumptions?: string[] }}
 */
export const calculateShortTermTarget = (car, opts = {}) => {
  const T = { ...SHORT_TERM_TARGET_TERMS, ...(opts.terms || {}) };
  const carPrice = Number(car?.carPrice) || 0;
  if (!carPrice) return { ok: false, reason: '차량가가 없어 목표를 낼 수 없습니다' };

  const annualRate = Number(opts.annualRate) > 0 ? Number(opts.annualRate) : 0.06;
  const rates = opts.maintenanceRates || mergeMaintenanceRates(null);
  const grade = detectVehicleGrade({ carModel: car.carModel, fuelType: car.fuelType });
  const mileage = Number(car.mileage) || T.annualMileage;
  const termYears = T.termMonths / 12;

  const opt = {
    termYears,
    mileage,
    depositRate: 0,
    advancePaymentRate: T.advancePaymentRate,
    residualRate: T.residualRate,
    calcMode: 'auto',
    targetProfitInput: T.targetProfit,
    isMaintenanceEnabled: true,
    maintenanceItems: grade ? buildMaintenanceItemsFromRates(rates, grade) : undefined,
    tireUnitCost: grade ? (car.tireType === 'premium' ? rates.grades[grade].tire.premium : rates.grades[grade].tire.standard) : 160000,
    tireAlignmentCost: grade ? rates.grades[grade].tire.alignment : 0
  };
  const vehicle = {
    carPrice,
    carOptionPrice: Number(car.optionPrice) || 0,
    discountPrice: Number(car.discount) || 0,
    consignmentFee: Number(car.deliveryFee) || 0,
    isBondExempt: false,
    globalInsuranceFee: T.insuranceFeeAnnual,
    cc: Number(car.cc) || 0,
    baseInterestRate: annualRate,
    dealerCommissionRateP: 0,
    commissionRateP: 0,
    isPandanbiEnabled: true,
    isMaintenanceEnabled: true,
    globalRegistrationAgencyFee: T.registrationAgencyFee
  };
  const r = calculateQuoteOption(opt, vehicle);

  return {
    ok: true,
    monthlyTarget: r.monthlyLeaseFee,
    totalCost: r.totalCost,
    advancePayment: r.advancePayment,
    takeoverPrice: r.takeoverPrice,
    fundingInterest: r.fundingInterest,
    maintenanceCost: r.maintenanceFeeTotal + r.tireCostTotal,
    termMonths: T.termMonths,
    assumptions: [
      `견적 조건: ${T.termMonths}개월 · 선수금 ${Math.round(T.advancePaymentRate * 100)}% · 인수가 ${Math.round(T.residualRate * 100)}% · 정비 포함 · 영업이익 0 · 베네핏 수수료 제외`,
      `금리: 연 ${(annualRate * 100).toFixed(2)}% (회사 내부 금리) + 기간 가산`,
      `기본 보험료 연 ${T.insuranceFeeAnnual.toLocaleString()}원 · 판관비 차량가의 ${T.pandanbiRate * 100}%`,
      grade
        ? `정비: 정비 단가표 ${GRADE_LABEL[grade]} 기준, 연 ${mileage.toLocaleString()}km`
        : `정비: 차종 등급을 몰라 견적서 기본 정비 내역, 연 ${mileage.toLocaleString()}km`,
      ...(Number(car.cc) ? [] : ['자동차세: 배기량을 몰라 연 2만 원'])
    ]
  };
};

/**
 * 단기렌트를 시작한 날. 장기렌트를 마치고 넘어온 차면 마지막 장기 렌트료 다음 달 1일, 아니면 출고(등록)일.
 * 원장에 직접 적어 둔 시작일(shortTerm.startDate)이 있으면 그것을 쓴다.
 */
export const shortTermStartOf = (ledger) => {
  if (ledger?.shortTerm?.startDate) return { date: new Date(ledger.shortTerm.startDate), source: 'manual' };
  const rents = (ledger?.entries || []).filter((e) => e.side === '입금' && e.category === '렌트료' && e.date);
  const periodEnds = (ledger?.contractPeriods || []).map((p) => p.endDate).filter(Boolean).map((d) => new Date(d));
  if (rents.length || periodEnds.length) {
    const last = new Date(Math.max(...rents.map((e) => new Date(e.date).getTime()), ...periodEnds.map((d) => d.getTime())));
    const key = addMonths(monthKeyKst(last), 1);
    return { date: new Date(`${key}-01T00:00:00+09:00`), source: 'afterLongTerm' };
  }
  const h = ledger?.header || {};
  const first = (ledger?.entries || []).filter((e) => e.date).map((e) => new Date(e.date)).sort((a, b) => a - b)[0];
  const d = h.deliveredAt || h.registeredAt || first;
  return d ? { date: new Date(d), source: h.deliveredAt ? 'delivered' : h.registeredAt ? 'registered' : 'firstEntry' } : { date: null, source: 'unknown' };
};

/**
 * 차령을 셀 기준일. 차를 처음 들인 날(등록일 → 출고일)이다. 장기렌트를 마치고 넘어온 차도 단기렌트 시작일이 아니라
 * 처음 들인 날부터 센다. 고객이 보는 건 차가 몇 년 됐느냐이기 때문이다.
 */
export const vehicleAgeStartOf = (ledger, vehicle) => {
  const h = ledger?.header || {};
  const d = vehicle?.registrationDate || h.registeredAt || vehicle?.deliveryDate || h.deliveredAt;
  return d ? new Date(d) : null;
};

/**
 * 달마다 목표 대비 실제 매출.
 *
 * 시작한 달과 이번 달은 한 달을 다 채우지 못해 목표를 날짜만큼 나눠 잡는다(시작 달은 남은 날, 이번 달은 오늘까지).
 * 그래야 15일에 들어온 차가 첫 달에 '50% 미달'로 찍히지 않는다.
 * 달마다 그때의 차령으로 목표를 가감한다(SHORT_TERM_AGE_FACTORS).
 *
 * @param {object} ledger 원장(entries, header, contractPeriods, shortTerm)
 * @param {number} monthlyTarget 기준 월 목표(1~3년 평균, 차령 가감 전)
 * @param {Date} [asOf]
 * @param {{ ageStart?: Date|null }} [opts] 차령 기준일. 없으면 원장 상단 등록일·출고일, 그것도 없으면 단기렌트 시작일
 */
export const shortTermPerformance = (ledger, monthlyTarget, asOf = new Date(), opts = {}) => {
  const start = shortTermStartOf(ledger);
  if (!start.date || !(monthlyTarget > 0)) return { ok: false, start, months: [] };
  const ageStart = opts.ageStart || vehicleAgeStartOf(ledger) || start.date;
  const ageKey = monthKeyKst(ageStart);

  const startKey = monthKeyKst(start.date);
  const nowKey = monthKeyKst(asOf);
  const byMonth = new Map();
  let undated = 0;
  for (const e of ledger.entries || []) {
    if (!isShortTermIncome(e)) continue;
    if (!e.date) { undated += Number(e.amount); continue; }
    const key = monthKeyKst(e.date);
    if (key < startKey) continue;
    byMonth.set(key, (byMonth.get(key) || 0) + Number(e.amount));
  }

  const daysIn = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const kstDay = (d) => Number(new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(8, 10));

  const months = [];
  const count = monthDiff(startKey, nowKey);
  for (let i = 0; i <= count; i += 1) {
    const key = addMonths(startKey, i);
    const days = daysIn(key);
    const fromDay = key === startKey ? kstDay(start.date) : 1;
    const toDay = key === nowKey ? kstDay(asOf) : days;
    const share = Math.max(0, Math.min(1, (toDay - fromDay + 1) / days));
    const ageMonths = Math.max(0, monthDiff(ageKey, key));
    const { ageYear, factor } = ageFactorFor(ageMonths);
    const fullMonthTarget = ageAdjustedTarget(monthlyTarget, ageMonths);
    const target = Math.round(fullMonthTarget * share);
    const actual = byMonth.get(key) || 0;
    months.push({ month: key, seq: i + 1, ageYear, factor, fullMonthTarget, target, actual, rate: target ? actual / target : null, partial: share < 1, current: key === nowKey });
  }

  const sum = (list, k) => list.reduce((s, m) => s + m[k], 0);
  const done = months.filter((m) => !m.current);
  const last3 = done.slice(-3);
  const cumTarget = sum(months, 'target');
  const cumActual = sum(months, 'actual') + undated;
  const fullTarget = monthlyTarget * SHORT_TERM_TARGET_TERMS.termMonths;
  return {
    ok: true,
    start,
    monthlyTarget,
    ageStart,
    // 이번 달 차령과 그에 맞춘 월 목표(한 달 전체 기준)
    ageYear: months[months.length - 1]?.ageYear || 1,
    ageFactor: months[months.length - 1]?.factor || 1,
    currentTarget: months[months.length - 1]?.fullMonthTarget || monthlyTarget,
    months,
    undated,
    elapsedMonths: months.length,
    thisMonth: months[months.length - 1] || null,
    lastMonth: done[done.length - 1] || null,
    avg3: last3.length ? Math.round(sum(last3, 'actual') / last3.length) : null,
    avg3Rate: last3.length && sum(last3, 'target') ? sum(last3, 'actual') / sum(last3, 'target') : null,
    metMonths: done.filter((m) => m.rate !== null && m.rate >= 1).length,
    doneMonths: done.length,
    cumTarget,
    cumActual,
    gap: cumActual - cumTarget, // 음수면 지금까지 목표보다 덜 벌었다
    // 3년 동안 벌어 와야 할 돈 중 얼마나 벌었나
    fullTarget,
    recoveryRate: fullTarget ? cumActual / fullTarget : null,
    beyondTerm: months.length > SHORT_TERM_TARGET_TERMS.termMonths
  };
};
