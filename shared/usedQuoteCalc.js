/**
 * 중고렌트(연장·재렌트) 견적 계산식과 렌터카 차령 한도.
 *
 * 계산식은 렌트팀 엑셀 '0. 중고렌트_견적서 양식_수정(다른 견적서 복사 금지_1)_251126.xlsx'의
 * '견적서 보고용' 시트를 그대로 옮겼다(대표님 2026-11-02 "그 시트 보고 진행").
 * 신차 견적(quoteCalc.js)과 다른 점:
 *   - 차량가격은 중고차 가격(연장이면 직전 인수가). 취득세·공채는 보통 없다(칸은 남겨 둔다).
 *   - 자차 보험비는 신차가격 기준(차 값이 내려가도 수리비는 신차 부품값으로 든다).
 *   - 조달원금에서 보증금·선수금을 빼고 원리금 균등(PMT)으로 이자를 잡는다.
 *   - 판관비·수수료는 중고차 가격 기준, 정비는 월 정기점검비 × 개월 + 타이어.
 * 엑셀과 숫자가 같아야 렌트팀이 두 곳을 오가며 검산할 수 있다(tests/usedQuoteCalc.test.js에 GLE450 실견적으로 맞춰 둠).
 */
import { PMT, addedRateForTerm, annualCarTax, ownCarInsuranceRate, TIRES_PER_REPLACEMENT, TIRE_REPLACE_INTERVAL_KM } from './quoteCalc.js';

// 엑셀 기본값. 견적 화면의 '공통 조건'에서 고칠 수 있다.
export const USED_QUOTE_DEFAULTS = {
  baseInterestRate: 0.08, // AF25 이자율
  insuranceFee: 800000, // E25 보험(연)
  registrationFee: 100000, // E28 등록비용
  commissionRate: 0.03, // AD5 렌트베네핏 수수료(중고차 가격 기준)
  dealerRate: 0, // AD9 딜러 인센(차량가격 기준)
  pandanbiRate: 0.03, // E30 판관비/노무비(중고차 가격 기준)
  advanceInterestRate: 0.03, // E18 선수금분이자(연)
  inspectionMonthly: 30000, // AD23 정기점검 비용(월)
  tireUnitCost: 150000 // AD18 타이어 1본
};

// 엑셀 E26: 신차가격을 천만 원 단위로 올린 값 × 자차 보험율
export const usedOwnCarInsurance = (newCarPrice) => {
  const price = Number(newCarPrice) || 0;
  if (price <= 0) return 0;
  return Math.ceil(price / 10000000) * 10000000 * ownCarInsuranceRate(price);
};

/**
 * 중고렌트 견적 한 안을 계산한다.
 *
 * @param {object} opt 안 하나
 *   termMonths, mileage(연 약정거리), discountRate, consignmentFee, acquisitionTax, publicBond,
 *   deposit, advancePayment, takeoverPrice(금액), maintenance(정비 가입), calcMode('manual'|'auto'),
 *   monthlyFee(manual), targetProfit(auto)
 * @param {object} car 차와 공통 조건
 *   usedPrice(중고차 가격), newCarPrice(신차가격), cc, 그리고 USED_QUOTE_DEFAULTS의 항목들
 */
export const calculateUsedQuoteOption = (opt = {}, car = {}) => {
  const c = { ...USED_QUOTE_DEFAULTS, ...Object.fromEntries(Object.entries(car).filter(([, v]) => v !== undefined && v !== null && v !== '')) };
  const num = (v) => Number(v) || 0;

  const usedPrice = num(c.usedPrice); // E9
  const months = Math.max(0, Math.round(num(opt.termMonths))); // E34
  const years = months / 12; // E35

  const discount = usedPrice * num(opt.discountRate); // E11
  const consignmentFee = num(opt.consignmentFee); // E12
  const vehiclePrice = usedPrice - discount + consignmentFee; // E13

  const acquisitionTax = num(opt.acquisitionTax); // E23
  const publicBond = num(opt.publicBond); // E24
  const insuranceFee = num(c.insuranceFee); // E25
  const ownCarInsuranceFee = usedOwnCarInsurance(c.newCarPrice); // E26
  const carTaxAnnual = annualCarTax(c.cc); // E27
  const registrationFee = num(c.registrationFee); // E28

  const deposit = num(opt.deposit); // E40
  const advancePayment = num(opt.advancePayment); // E42
  const takeoverPrice = num(opt.takeoverPrice); // E38

  // E15 조달원금, E16 이자부담율(기간별 가산), E17 조달이자(원리금 균등)
  const fundingPrincipal = vehiclePrice - deposit - advancePayment + acquisitionTax + publicBond + insuranceFee + ownCarInsuranceFee;
  const interestRate = num(c.baseInterestRate) + addedRateForTerm(months);
  const fundingInterest = months > 0 ? PMT(interestRate / 12, months, -fundingPrincipal) * months - fundingPrincipal : 0;
  const advancePaymentInterest = advancePayment * num(c.advanceInterestRate) * years; // E18
  const monthlyInstallmentSum = fundingPrincipal + fundingInterest - advancePaymentInterest; // E20
  const totalBuyPriceWithFinancing = vehiclePrice + fundingInterest + advancePaymentInterest; // E21

  const pandanbi = usedPrice * num(c.pandanbiRate); // E30
  const companyCommission = usedPrice * num(c.commissionRate); // AD4
  const dealerCommission = vehiclePrice * num(c.dealerRate); // AD8

  // 정비 가입(AD22 정기점검, AD19 타이어). 타이어는 회사 기준(5만km마다 4본, 2026-10-04 대표님 결정)을 따른다.
  // 엑셀은 6만km로 남아 있다.
  const maintenance = opt.maintenance === true;
  const inspectionCost = maintenance ? num(c.inspectionMonthly) * months : 0;
  const tireCount = maintenance ? Math.floor((num(opt.mileage) * years) / TIRE_REPLACE_INTERVAL_KM) * TIRES_PER_REPLACEMENT : 0;
  const tireCost = tireCount * num(c.tireUnitCost);

  // E32 총구입가(원가)
  const totalCost = (insuranceFee + ownCarInsuranceFee) * years + carTaxAnnual * years + totalBuyPriceWithFinancing
    + registrationFee + publicBond + acquisitionTax + companyCommission + pandanbi + dealerCommission + inspectionCost + tireCost;

  // E43~E46: 월 렌트료를 넣으면 이익을, 목표 이익을 넣으면 월 렌트료를 구한다(천 원 미만 버림)
  let monthlyFee;
  if (opt.calcMode === 'auto') {
    monthlyFee = months > 0 ? Math.floor((totalCost + num(opt.targetProfit) - takeoverPrice - advancePayment) / months / 1000) * 1000 : 0;
  } else {
    monthlyFee = num(opt.monthlyFee);
  }
  const totalRevenue = monthlyFee * months + takeoverPrice + advancePayment; // E45
  const profit = totalRevenue - totalCost; // E46

  return {
    usedPrice, months, years, discount, consignmentFee, vehiclePrice,
    acquisitionTax, publicBond, insuranceFee, ownCarInsuranceFee, carTaxAnnual, registrationFee,
    deposit, advancePayment, takeoverPrice,
    fundingPrincipal, interestRate, fundingInterest, advancePaymentInterest, monthlyInstallmentSum,
    monthlyInstallment: months > 0 ? monthlyInstallmentSum / months : 0,
    totalBuyPriceWithFinancing, pandanbi, companyCommission, dealerCommission,
    inspectionCost, tireCount, tireCost, totalCost,
    monthlyFee, totalRevenue, profit,
    // 회사 몫 = 영업이익 + 수수료(엑셀 'P 기준' AD37과 같은 뜻)
    profitRate: usedPrice > 0 ? (profit + companyCommission) / usedPrice : 0
  };
};

// ───── 렌터카 차령 한도

/**
 * 대여사업용 승용차 차령(여객자동차 운수사업법 시행령): 경형·소형·중형 5년, 대형 8년, 검사 받으면 2년까지 연장.
 * 연장 가능한 최대 기간까지 계약할 수 있다(대표님 2026-11-04). 2000cc 미만 7년, 이상 10년의 전날이 마지막 날이다.
 * 지금 연장이 어디까지 됐는지와 상관없이 법정 끝으로 본다. 남은 연장은 차령이 끝나기 2개월 전부터 검사를 받으며 신청한다.
 * 전기·수소는 배기량이 없어 일단 7년으로 본다.
 */
export const AGE_LIMIT_YEARS = { small: 7, large: 10 };

const toDate = (v) => {
  if (!v) return null;
  const s = typeof v === 'string' ? v.slice(0, 10) : null;
  const d = s ? new Date(`${s}T00:00:00Z`) : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const ymd = (d) => d.toISOString().slice(0, 10);
const addMonthsUtc = (d, n) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d.getUTCDate(), last));
  return x;
};
const KST_OFFSET_MS = 9 * 3600 * 1000;
// DB 날짜는 한국 자정이 UTC 전날 15시로 저장돼 있다. 문자열이 아니면 한국 날짜로 읽는다.
const toKstDate = (v) => {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return toDate(v);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return toDate(new Date(d.getTime() + KST_OFFSET_MS).toISOString());
};

/**
 * 차가 렌터카로 쓸 수 있는 마지막 날과, 시작일부터 최대 몇 개월 계약할 수 있는지.
 *
 * @param {{registrationDate: string|Date, cc?: number, fuelType?: string}} vehicle
 * @param {string|Date} [startDate] 계약(연장) 시작일
 * @returns {null|{large: boolean, years: number, lastDay: string, maxMonths: number|null, label: string}}
 */
export const vehicleAgeLimit = (vehicle, startDate) => {
  const reg = toKstDate(vehicle?.registrationDate);
  if (!reg) return null;
  const large = (Number(vehicle?.cc) || 0) >= 2000;
  const years = large ? AGE_LIMIT_YEARS.large : AGE_LIMIT_YEARS.small;
  // 등록일 + N년의 전날이 마지막 날(2021-11-03 등록 → 7년이면 2028-11-02까지)
  const end = addMonthsUtc(reg, years * 12);
  end.setUTCDate(end.getUTCDate() - 1);

  let maxMonths = null;
  const start = toKstDate(startDate);
  if (start) {
    // 시작일 + m개월의 전날이 마지막 날을 넘지 않는 가장 큰 m
    maxMonths = 0;
    while (maxMonths < 240) {
      const finish = addMonthsUtc(start, maxMonths + 1);
      finish.setUTCDate(finish.getUTCDate() - 1);
      if (finish > end) break;
      maxMonths += 1;
    }
  }
  const kind = large ? '2000cc 이상' : (Number(vehicle?.cc) > 0 ? '2000cc 미만' : '배기량 없음(전기·수소 등)');
  return {
    large,
    years,
    firstRegistered: ymd(reg),
    lastDay: ymd(end),
    maxMonths,
    label: `${kind} · 연장 포함 최대 ${years}년 · ${ymd(end)}까지`
  };
};

/** 개월 수를 'N년 M개월'로 */
export const monthsLabel = (m) => {
  const n = Math.max(0, Math.floor(Number(m) || 0));
  const y = Math.floor(n / 12);
  const r = n % 12;
  if (!y) return `${r}개월`;
  return r ? `${y}년 ${r}개월` : `${y}년`;
};
