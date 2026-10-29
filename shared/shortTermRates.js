/**
 * 단기렌트 단가표와 대여료 계산 (2026-10-05).
 *
 * 엑셀 "12. 단기 렌트비용.xls"의 '렌트베네핏 단기렌트표'를 프로그램으로 옮겼다.
 *   1개월 = 엑셀 '단기렌트 계산식'(excelMonthlyRate, 2026-10-28부터 기본) 또는 단기렌트 월 목표(policy.monthly.method = 'quote')
 *   1일(평일) = 1개월 × 10%를 2,500원 단위로 올림   ← 엑셀 단가표 17대가 모두 이 규칙과 맞는다
 *   1주 = 1일 × 4
 * 비율·주행거리·탁송 규칙은 관리자가 화면에서 바꾼다(설정 shortTermRateCard). 여기 값은 처음 기본값이다.
 *
 * 사고대차는 우리가 값을 정하지 않는다. 보험사가 피해 차량 배기량 등급으로 정한 대차료(통상의 요금)를 준다.
 * 엑셀 '사고대차 보험사 기준표'를 INSURER_RENTAL_TABLE로 옮겼다.
 *
 * 화면(계산기)과 서버(단가표)가 같은 식을 쓰도록 여기에만 둔다. 공휴일 목록은 서버가 내려 준다.
 */

export const DEFAULT_RATE_POLICY = {
  dayRatio: 0.1, // 1일 = 1개월 × 이 비율
  dayRoundUnit: 5000, // 1일 요금을 이 단위로 반올림
  weekRoundUnit: 10000, // 1주 요금을 이 단위로 반올림
  monthRoundUnit: 10000, // 1개월 요금을 이 단위로 반올림
  weekDays: 4, // 1주 = 1일 × 이 값
  weekendSurchargeRate: 0.1, // 주말(토·일)·공휴일에 1일 요금으로 빌리면 더 받는 비율
  kmPerDay: 150,
  kmPerWeek: 1050,
  kmPerMonth: 2500,
  excessPerKm: 200, // 초과 km당
  minAge: 26,
  insurance: {
    bodily: '무한', // 대인
    property: '2억 원', // 대물
    selfInjury: '1,500만 원', // 자손
    ownDamageLimit: '500만 원', // 자차 수리 한도
    deductible: '건당 50만 원' // 면책금
  },
  /**
   * 탁송(배달·회수). 회사가 서울이라 서울은 기본 무료, 1일 대여·주말·공휴일·서울 밖은 따로 받는다.
   *   oneDayFee: 1일만 빌릴 때 받는 탁송료(엑셀 특이사항 "1일 렌트료 시 탁송료 3만원 추가")
   *   holidayFee: 인도·회수 날이 공휴일(그리고 holidayIncludesSunday면 일요일, holidayIncludesSaturday면 토요일)이면 한 번에 더 받는 돈
   *   regionFees: 서울 밖 왕복 탁송료. null이면 '별도 협의'
   */
  delivery: {
    seoulFree: true,
    oneDayFee: 30000,
    holidayFee: 20000,
    holidayIncludesSaturday: false,
    holidayIncludesSunday: true,
    regionFees: { 서울: 0, '경기·인천': 40000, 기타: null }
  },
  notes: ['절대 금연', '선불 결제 · 계좌이체만 가능', '자차·부가세 포함 금액', '26세 이상 보험'],
  /**
   * 1개월 요금 계산 방식 (2026-10-28 대표님: 엑셀 '단기렌트 계산식'을 따른다).
   *   excel: 차량가를 36개월에 회수하는 엑셀 식(SHORT_TERM_EXCEL 주석). 등록 후 반기마다 기준 요금의 3%씩 내린다.
   *   quote: 견적 식(3년 · 인수가 30% · 정비 포함, 1년마다 ×1.1/1.0/0.9/0.8/0.7). 손익 원장 단기렌트 월 목표와 같은 값.
   */
  monthly: {
    method: 'excel',
    termMonths: 36,
    interestRate: 0.06, // 이자: 차량가를 이 금리로 36개월 원리금 균등상환
    registrationRate: 0.05, // 등록비용 = 차량가 ÷ 1.1 × 이 비율
    insuranceAnnual: 800000, // 보험료(연)
    residualRate: 0, // 중고차 감가율. 0이면 차량가 전체를 36개월에 회수한다
    stepRate: 0.03, // 반기마다 내리는 폭 = 기준 요금 × 이 비율(1,000원 올림)
    maxSteps: 5 // 3년 하반기(5번 내림)부터는 더 내리지 않는다
  }
};

export const REGIONS = ['서울', '경기·인천', '기타'];

/** 저장된 정책과 기본값을 합친다. 저장 값에 없는 항목은 기본값을 쓴다. */
export const mergeRatePolicy = (saved) => ({
  ...DEFAULT_RATE_POLICY,
  ...(saved || {}),
  insurance: { ...DEFAULT_RATE_POLICY.insurance, ...(saved?.insurance || {}) },
  delivery: {
    ...DEFAULT_RATE_POLICY.delivery,
    ...(saved?.delivery || {}),
    regionFees: { ...DEFAULT_RATE_POLICY.delivery.regionFees, ...(saved?.delivery?.regionFees || {}) }
  },
  notes: Array.isArray(saved?.notes) ? saved.notes : DEFAULT_RATE_POLICY.notes,
  monthly: { ...DEFAULT_RATE_POLICY.monthly, ...(saved?.monthly || {}) }
});

// 반올림 (소수 오차를 먼저 지움)
const roundTo = (v, unit) => Math.round(Math.round(v * 100) / 100 / unit) * unit;
const roundUp = (v, unit) => Math.ceil(Math.round(v * 100) / 100 / unit) * unit;

/**
 * 엑셀 '단기렌트 계산식'(12. 단기 렌트비용.xls) 그대로.
 *   F 등록비용 = 차량가 ÷ 1.1 × 5%
 *   G 자차 수리 예비비(연) = 차량가를 1천만 원 단위로 올린 값 × 자차보험료율(견적의 ownCarInsuranceRate와 같은 식)
 *   H 보험료(연) = 80만 원
 *   I 이자 = 차량가를 연 6%·36개월 원리금 균등상환할 때의 이자 합계
 *   J 총비용 = F + 차량가 + H×3 + G×3 + I
 *   O 기준 월 요금 = (J ÷ 36 + 차량가 × 감가율 ÷ 36)을 1,000원 올림
 *   P 반기 감가 = O × 3%를 1,000원 올림
 *   적용 = O − P × (등록 후 지난 반기 수, 최대 5)
 * 엑셀의 적용 칸(AD)은 INDEX 범위가 한 칸 밀리고 TODAY()를 반기 수로 써서, 모든 차가 연식과 상관없이
 * '3년 상반기'(O − 4P)로 나왔다. 여기서는 원래 뜻대로 차를 등록한 뒤 지난 반기 수로 내린다.
 */
export const excelMonthlyBase = (carPrice, policy = DEFAULT_RATE_POLICY) => {
  const m = { ...DEFAULT_RATE_POLICY.monthly, ...(policy?.monthly || {}) };
  const price = Number(carPrice) || 0;
  if (!(price > 0)) return null;
  const n = m.termMonths;
  const rate = m.interestRate / 12;
  const registration = (price / 1.1) * m.registrationRate;
  const insRate = price <= 10000000 ? 0.022 : price >= 500000000 ? 0.012 : 0.017 - (price - 10000000) * (0.01 / (500000000 - 10000000));
  const ownDamageReserve = Math.ceil(price / 10000000) * 10000000 * insRate;
  const interest = rate ? (price * rate) / (1 - (1 + rate) ** -n) * n - price : 0;
  const years = n / 12;
  const total = registration + price + m.insuranceAnnual * years + ownDamageReserve * years + interest;
  const base = roundUp(total / n + (price * m.residualRate) / n, 1000);
  const step = roundUp(base * m.stepRate, 1000);
  return { price, registration, ownDamageReserve, insurance: m.insuranceAnnual, interest, total, base, step, maxSteps: m.maxSteps };
};

/** 엑셀 식 1개월 요금. ageStart(등록일)부터 asOf까지 지난 반기 수(엑셀처럼 30일 = 1개월)만큼 내린다. */
export const excelMonthlyRate = ({ carPrice, ageStart, asOf = new Date(), policy = DEFAULT_RATE_POLICY }) => {
  const b = excelMonthlyBase(carPrice, policy);
  if (!b) return null;
  const months = ageStart ? Math.max(0, (new Date(asOf) - new Date(ageStart)) / (30 * 24 * 3600 * 1000)) : 0;
  const steps = Math.min(b.maxSteps, Math.floor(months / 6));
  return { ...b, ageMonths: months, steps, halfLabel: `${Math.floor(steps / 2) + 1}년 ${steps % 2 ? '하반기' : '상반기'}${Math.floor(months / 6) > b.maxSteps ? ' 이후' : ''}`, month: b.base - b.step * steps };
};

/** 1개월 요금에서 1일·1주 요금을 낸다. */
export const deriveRates = (monthly, policy = DEFAULT_RATE_POLICY) => {
  const month = roundTo(Number(monthly) || 0, Number(policy.monthRoundUnit) || 10000);
  const day = roundTo(month * (Number(policy.dayRatio) || 0.1), Number(policy.dayRoundUnit) || 5000);
  const week = roundTo(day * (Number(policy.weekDays) || 4), Number(policy.weekRoundUnit) || 10000);
  return { day, week, month };
};

const DAY_MS = 24 * 3600 * 1000;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 주말·공휴일 할증 대상인 날인지(1일 요금 할증). 토·일·공휴일. */
export const isSurchargeDay = (date, holidays) => {
  const d = new Date(date);
  return d.getDay() === 0 || d.getDay() === 6 || holidays.has(ymd(d));
};

/** 탁송 할증 대상인 날인지(정책에 따라 공휴일, 일요일, 토요일). */
export const isDeliveryHoliday = (date, holidays, delivery) => {
  const d = new Date(date);
  if (holidays.has(ymd(d))) return true;
  if (d.getDay() === 0 && delivery.holidayIncludesSunday) return true;
  if (d.getDay() === 6 && delivery.holidayIncludesSaturday) return true;
  return false;
};

/**
 * 대여료 견적.
 *
 * 기간을 1개월(30일) → 1주(7일) → 1일 순으로 쪼갠다. 남은 날의 1일 요금 합이 1주 요금보다 크면 1주 요금으로,
 * 1주·1일 합이 1개월 요금보다 크면 1개월 요금으로 끊는다(고객이 더 긴 상품을 고르는 게 싸면 그걸로 준다).
 * 1일 요금으로 받는 날 중 토·일·공휴일은 할증한다.
 *
 * @param {object} p
 * @param {{day:number,week:number,month:number}} p.rates
 * @param {Date|string} p.start 인도 일시
 * @param {Date|string} p.end 반납 일시
 * @param {string} p.region 서울 / 경기·인천 / 기타
 * @param {string[]|Set<string>} p.holidays 공휴일 'YYYY-MM-DD'
 * @param {object} [p.policy]
 * @param {number} [p.expectedKm] 예상 주행거리. 넣으면 초과 요금을 계산한다
 */
export const quoteRental = ({ rates, start, end, region = '서울', holidays = [], policy = DEFAULT_RATE_POLICY, expectedKm }) => {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return { ok: false, reason: '반납 일시가 인도 일시보다 뒤여야 합니다' };
  const hol = holidays instanceof Set ? holidays : new Set(holidays);
  const days = Math.max(1, Math.ceil((e - s) / DAY_MS));

  const months = Math.floor(days / 30);
  const rem = days % 30;
  const weeks = Math.floor(rem / 7);
  const restDays = rem % 7;

  // 1일 요금으로 받는 날은 기간의 마지막 restDays일. 그날이 토·일·공휴일이면 할증
  const surchargeRate = Number(policy.weekendSurchargeRate) || 0;
  const dayLines = [];
  for (let i = days - restDays; i < days; i += 1) {
    const date = new Date(s.getTime() + i * DAY_MS);
    const surcharge = isSurchargeDay(date, hol);
    dayLines.push({ date: ymd(date), amount: Math.round(rates.day * (surcharge ? 1 + surchargeRate : 1)), surcharge });
  }
  let dayCost = dayLines.reduce((sum, l) => sum + l.amount, 0);

  // 화면에 보여 줄 계산 과정(대표님 2026-10-28: 금액이 어떻게 나왔는지 식으로 보이게)
  const won = (n) => `${Math.round(n).toLocaleString()}원`;
  const steps = [];
  const wd = (date) => '일월화수목금토'[new Date(`${date}T12:00:00`).getDay()];
  steps.push({ label: '기간 나누기', formula: `${days}일 = ${[months && `1개월(30일) × ${months}`, weeks && `1주(7일) × ${weeks}`, restDays && `${restDays}일`].filter(Boolean).join(' + ')}` });
  if (months) steps.push({ label: `1개월 요금 × ${months}`, formula: `${won(rates.month)} × ${months}`, amount: rates.month * months });
  if (weeks) steps.push({ label: `1주 요금 × ${weeks}`, formula: `${won(rates.week)} × ${weeks}`, amount: rates.week * weeks });
  if (restDays) {
    steps.push({
      label: `남은 ${restDays}일 1일 요금`,
      formula: dayLines.map((l) => (l.surcharge
        ? `${l.date.slice(5)}(${wd(l.date)}) ${won(rates.day)}×${1 + surchargeRate}=${won(l.amount)}`
        : `${l.date.slice(5)}(${wd(l.date)}) ${won(l.amount)}`)).join(' + '),
      amount: dayCost,
      note: dayLines.some((l) => l.surcharge) ? `토·일·공휴일은 1일 요금에 ${Math.round(surchargeRate * 100)}% 추가` : null
    });
  }
  // 실제로 요금을 매긴 단위 수. 더 긴 상품으로 끊으면 주행거리 한도도 그 상품 기준이 된다.
  let chargedMonths = months;
  let chargedWeeks = weeks;
  let chargedDays = restDays;
  const notes = [];
  if (restDays && dayCost > rates.week) {
    notes.push(`남은 ${restDays}일은 1일 요금(${dayCost.toLocaleString()}원)보다 1주 요금이 싸서 1주로 계산`);
    steps.push({ label: `→ 남은 ${restDays}일은 1주 요금으로`, formula: `1일 요금 합계 ${won(dayCost)} > 1주 요금 ${won(rates.week)}이라 1주로 바꿈`, amount: rates.week, swap: true });
    dayCost = rates.week;
    chargedDays = 0;
    chargedWeeks += 1;
  }
  let weekCost = weeks * rates.week;
  let monthCost = months * rates.month;
  if (rem && weekCost + dayCost > rates.month) {
    notes.push(`남은 ${rem}일은 주·일 요금(${(weekCost + dayCost).toLocaleString()}원)보다 1개월 요금이 싸서 1개월로 계산`);
    steps.push({
      label: `→ 남은 ${rem}일은 1개월 요금으로`,
      formula: `주·일 요금 ${[chargedWeeks && `1주 ${won(rates.week)} × ${chargedWeeks}`, chargedDays && `1일 요금 ${won(dayCost)}`].filter(Boolean).join(' + ')} = ${won(weekCost + dayCost)} > 1개월 요금 ${won(rates.month)}이라 1개월로 바꿈`,
      amount: rates.month,
      swap: true
    });
    monthCost += rates.month;
    weekCost = 0;
    dayCost = 0;
    chargedMonths += 1;
    chargedWeeks = 0;
    chargedDays = 0;
  }
  const rent = monthCost + weekCost + dayCost;
  steps.push({
    label: '대여료',
    formula: [chargedMonths && `1개월 ${won(rates.month)} × ${chargedMonths}`, chargedWeeks && `1주 ${won(rates.week)} × ${chargedWeeks}`, chargedDays && `1일 요금 ${won(dayCost)}`].filter(Boolean).join(' + '),
    amount: rent,
    total: true
  });

  // 탁송
  const d = policy.delivery || DEFAULT_RATE_POLICY.delivery;
  const deliveryLines = [];
  const regionFee = d.regionFees?.[region];
  if (region === '서울') {
    if (days === 1 && d.oneDayFee) deliveryLines.push({ label: '1일 대여 탁송료', amount: d.oneDayFee });
    else if (!d.seoulFree) deliveryLines.push({ label: '서울 탁송료', amount: d.oneDayFee || 0 });
  } else if (regionFee === null || regionFee === undefined) {
    deliveryLines.push({ label: `${region} 탁송료(별도 협의)`, amount: null });
  } else {
    deliveryLines.push({ label: `${region} 왕복 탁송료`, amount: regionFee });
    if (days === 1 && d.oneDayFee) deliveryLines.push({ label: '1일 대여 탁송료', amount: d.oneDayFee });
  }
  if (d.holidayFee) {
    if (isDeliveryHoliday(s, hol, d)) deliveryLines.push({ label: `인도일(${ymd(s)}) 휴일 탁송`, amount: d.holidayFee });
    if (isDeliveryHoliday(e, hol, d)) deliveryLines.push({ label: `반납일(${ymd(e)}) 휴일 회수`, amount: d.holidayFee });
  }
  const deliveryKnown = deliveryLines.every((l) => l.amount !== null);
  const delivery = deliveryLines.reduce((sum, l) => sum + (l.amount || 0), 0);

  // 주행거리
  const allowanceKm = chargedMonths * policy.kmPerMonth + chargedWeeks * policy.kmPerWeek + chargedDays * policy.kmPerDay;
  const excessKm = expectedKm ? Math.max(0, Number(expectedKm) - allowanceKm) : 0;
  const excess = excessKm * (Number(policy.excessPerKm) || 0);

  return {
    ok: true,
    days,
    months: chargedMonths,
    weeks: chargedWeeks,
    restDays: chargedDays,
    monthCost,
    weekCost,
    dayCost,
    dayLines,
    rent,
    deliveryLines,
    delivery,
    deliveryKnown,
    allowanceKm,
    excessKm,
    excess,
    total: rent + delivery + excess,
    steps,
    notes
  };
};

/**
 * 사고대차 보험사 기준 대차료 (엑셀 '사고대차 보험사 기준표', 통상의 요금, 원/일).
 * 보험사는 피해 차량의 배기량 등급으로 대차료를 준다. 피해 차량이 운행연한(경·소·중형 5년, 대형 8년)을 넘으면
 * 그 규모의 최저 등급으로 준다.
 */
export const INSURER_RENTAL_TABLE = [
  { grade: 'A', size: '경형', ccMax: 1000, lifeYears: 5, d1: 66500, d3: 60200, d5: 56700, d7: 53200, h6: 37100, h10: 47600, h12: 53200 },
  { grade: 'B', size: '소형', ccMax: 1600, lifeYears: 5, d1: 77000, d3: 69300, d5: 65800, d7: 61600, h6: 43400, h10: 55300, h12: 61600 },
  { grade: 'C', size: '중형', ccMax: 2000, lifeYears: 5, d1: 119000, d3: 107100, d5: 101500, d7: 95200, h6: 66500, h10: 85400, h12: 95200 },
  { grade: 'D', size: '대형', ccMax: 2500, lifeYears: 8, d1: 199500, d3: 179200, d5: 170100, d7: 159600, h6: 112000, h10: 143500, h12: 159600 },
  { grade: 'E', size: '대형', ccMax: 3000, lifeYears: 8, d1: 217000, d3: 195300, d5: 184800, d7: 173600, h6: 121800, h10: 156100, h12: 173600 },
  { grade: 'F', size: '대형', ccMax: 3500, lifeYears: 8, d1: 279300, d3: 251300, d5: 237300, d7: 223300, h6: 156100, h10: 200900, h12: 223300 },
  { grade: 'G', size: '대형', ccMax: 4000, lifeYears: 8, d1: 312900, d3: 281400, d5: 266000, d7: 250600, h6: 175700, h10: 255400, h12: 250600 },
  { grade: 'H', size: '대형', ccMax: Infinity, lifeYears: 8, d1: 406000, d3: 365400, d5: 345100, d7: 324800, h6: 227500, h10: 292600, h12: 324800 }
];

/**
 * 하이브리드는 2022-10-11부터 배기량이 아니라 같은 모델의 내연기관 차 기준으로 대차료를 준다
 * (예: K8 1.6 HEV → K8 2.5 기준, 아시아경제 2023-12-21·뉴시스 2022-09-29). 모델명으로 내연기관 배기량을 잡는다.
 * 목록에 없는 하이브리드는 배기량 그대로 두고 '확인 필요'로 표시한다. 화면에서 차마다 등급을 직접 고를 수 있다.
 */
export const HYBRID_EQUIVALENT_CC = [
  [/그랜저|grandeur|k8|쏘렌토|sorento|싼타페|santa\s*fe|팰리세이드|palisade|카니발|carnival/i, 2497],
  [/k5|쏘나타|sonata/i, 1999],
  [/스포티지|sportage|투싼|tucson|아반떼|avante|니로|niro|코나|kona/i, 1598]
];
export const isHybrid = (carModel, fuelType) => /\(H\)|하이브리드|HEV|hybrid/i.test(`${carModel || ''} ${fuelType || ''}`);

/** 보험사 대차료를 볼 때 쓰는 배기량. { cc, basis: 'cc' | 'hybrid' | 'hybridUnknown' } */
export const insurerCcFor = ({ cc, carModel, fuelType }) => {
  if (!isHybrid(carModel, fuelType)) return { cc: Number(cc) || 0, basis: 'cc' };
  const hit = HYBRID_EQUIVALENT_CC.find(([rx]) => rx.test(carModel || ''));
  return hit ? { cc: hit[1], basis: 'hybrid' } : { cc: Number(cc) || 0, basis: 'hybridUnknown' };
};

/**
 * 렌터카 차령(대여사업용으로 쓸 수 있는 기간). 여객자동차운수사업법 시행령 별표2: 승용 경형·소형·중형 5년, 대형 8년
 * (검사를 받으면 최대 2년 연장). 차령은 실제 배기량 규모로 본다(하이브리드 1.6도 소형 5년).
 * @returns {{ years: number, until: Date } | null}
 */
export const rentalLifeFor = ({ cc, ageStart }) => {
  const g = insurerGradeFor(cc);
  if (!g || !ageStart) return null;
  const s = new Date(ageStart);
  return { years: g.lifeYears, until: new Date(s.getFullYear() + g.lifeYears, s.getMonth(), s.getDate()) };
};

/** 배기량으로 보험사 기준 등급을 찾는다. 배기량을 모르면(전기차 포함) null. */
export const insurerGradeFor = (cc) => {
  const v = Number(cc) || 0;
  if (!v) return null;
  return INSURER_RENTAL_TABLE.find((g) => v <= g.ccMax) || null;
};

/** 사고대차 n일의 보험사 기준 대차료 합계(1~2일차·3~4일차·5~6일차·7일 이상 단가를 날마다 적용). */
export const insurerAmountFor = (grade, days) => {
  if (!grade) return 0;
  let sum = 0;
  for (let i = 1; i <= days; i += 1) sum += i <= 2 ? grade.d1 : i <= 4 ? grade.d3 : i <= 6 ? grade.d5 : grade.d7;
  return sum;
};
