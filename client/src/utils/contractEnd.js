/**
 * 계약종료 확인서의 종료 구분. 구분마다 날짜 칸 이름, 차량회수지 칸 여부, 안내 문구가 다르다.
 * 양식: Dropbox "09.중도해지/중도해지 위약금_260220.xlsx" '계약종료 확인서' 시트(대표님 2026-11-03)
 */

import { korDate } from './endDocStyle.js';
export const END_KINDS = {
  early: {
    label: '중도해지',
    dateLabel: '중도해지일',
    pickup: true,
    lines: (date) => [
      '고객님의 무궁한 발전을 기원합니다.',
      `렌트베네핏과 고객님의 장기렌트 계약이 ${date} 중도해지로 종료되었음을 알려 드립니다.`,
      '중도해지에 따른 정산(미납 렌트료, 위약금, 초과운행부담금, 보증금 상계 등)이 모두 끝났음을 확인합니다.',
      '그동안 렌트베네핏을 이용해 주셔서 진심으로 감사드립니다.'
    ]
  },
  takeover: {
    label: '만기 후 인수',
    dateLabel: '차량인수일',
    pickup: false,
    lines: (date) => [
      '고객님의 무궁한 발전을 기원합니다.',
      `계약기간 만료에 따라 고객님께서 ${date} 차량을 인수하시어 렌트베네핏과의 장기렌트 계약이 종료되었음을 알려 드립니다.`,
      '인수 대금과 계약에 따른 정산이 모두 끝났음을 확인합니다. 명의 이전일 이후의 자동차세·보험·과태료 등은 새 소유자께 부과됩니다.',
      '렌트베네핏과 함께 계약 기간 내 노력과 좋은 결과를 이루어 내주셔서 감사의 인사를 드립니다.'
    ]
  },
  return: {
    label: '만기 후 반납',
    dateLabel: '차량반납일',
    pickup: true,
    lines: (date) => [
      '고객님의 무궁한 발전을 기원합니다.',
      `계약기간 만료에 따라 ${date} 차량을 반납받아 렌트베네핏과 고객님의 장기렌트 계약이 종료되었음을 알려 드립니다.`,
      '반납 차량 점검과 계약에 따른 정산(보증금 반환 등)이 모두 끝났음을 확인합니다.',
      '렌트베네핏과 함께 계약 기간 내 노력과 좋은 결과를 이루어 내주셔서 감사의 인사를 드립니다.'
    ]
  }
};

const DAY = 864e5;
const ymdTime = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || '') ? Date.parse(`${ymd}T00:00:00Z`) : NaN);

const floor10 = (n) => Math.floor(n / 10) * 10;

/**
 * 중도해지 위약금. 엑셀 '중도해지_정산서261104.xlsx' 정산서상세 E항과 같은 식이다.
 *   1일 대여료 = (월 대여료 × 12 ÷ 365) + (선수금 ÷ 계약 연수 ÷ 365), 각각 10원 아래 버림
 *   1일 대여료(VAT 제외) = 1일 대여료 ÷ 1.1 (곱할 때는 끝수를 두고, 보여 줄 때만 반올림)
 *   위약금 = 1일 대여료(VAT 제외) × 미경과일수(만료일 − 해지일) × 위약금율, 원 아래 버림
 * @param {{ monthlyFee: number, advancePayment?: number, termMonths?: number, endDate: string, terminateDate: string, ratePct: number }} p  ratePct = 35 (35%)
 * @returns {{ days: number, daily: number, dailySupply: number, penalty: number, advanceMonthly: number } | null}
 */
export const earlyPenalty = ({ monthlyFee, advancePayment = 0, termMonths = 0, endDate, terminateDate, ratePct }) => {
  const end = ymdTime(endDate);
  const term = ymdTime(terminateDate);
  if (!monthlyFee || !ratePct || Number.isNaN(end) || Number.isNaN(term)) return null;
  const days = Math.max(0, Math.round((end - term) / DAY));
  const years = termMonths / 12;
  const daily = floor10((monthlyFee * 12) / 365) + (years > 0 ? floor10(advancePayment / years / 365) : 0);
  return {
    days,
    daily,
    dailySupply: Math.round(daily / 1.1),
    penalty: Math.floor((daily / 1.1) * days * (ratePct / 100)),
    advanceMonthly: termMonths > 0 ? Math.round(advancePayment / termMonths) : 0
  };
};

/** 위약금율(%). 화면에서 적은 값이 우선이고, 없으면 계약 값('35%'처럼 온다) */
export const ratePctOf = (doc, override) => Number.parseFloat(override) || Number.parseFloat(doc?.earlyRate) || 0;

/**
 * 미입금 회차 중 중도해지 정산서가 맡은 회차를 가른다(계약종료 확인서 화면).
 * 정산서의 납부 회차 뒤 회차는 이미 미납 렌트료 계산에 들어가 있어 따로 받을 돈이 아니다.
 * 회차표는 계약 전체라 차가 여러 대면 모든 차에 정산서가 있어야 한다.
 * @param {number[]} unpaidRounds 미입금 회차 번호
 * @param {{vehicleId: string}[]} docs 계약의 차
 * @param {object[]} endDocs 저장한 종료 서류(최근 것이 앞)
 * @returns {{covered: number[], left: number[], settlements: object[]}} 정산서가 맡은 회차, 남은 회차, 차마다 최근 정산서
 */
export const unpaidCoverage = (unpaidRounds = [], docs = [], endDocs = []) => {
  const settlements = docs.map((d) => endDocs.find((f) => f.kind === 'settlement' && String(f.vehicleId) === String(d.vehicleId)));
  if (!settlements.length || settlements.some((f) => !Number.isFinite(f?.paidCount))) return { covered: [], left: unpaidRounds, settlements: [] };
  const paid = Math.min(...settlements.map((f) => f.paidCount));
  return { covered: unpaidRounds.filter((no) => no > paid), left: unpaidRounds.filter((no) => no <= paid), settlements };
};

const ymdOf = (time) => new Date(time).toISOString().slice(0, 10);
/** 엑셀 EDATE: n달 뒤 같은 날. 그 달에 없는 날이면 말일 */
const edate = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return ymdOf(Date.UTC(y, m - 1 + n, Math.min(d, last)));
};
const addDays = (ymd, n) => ymdOf(ymdTime(ymd) + n * DAY);
const daysBetween = (from, to) => Math.round((ymdTime(to) - ymdTime(from)) / DAY);
/** 엑셀 DATEDIF(from, to, "m"): 다 채운 달 수 */
const fullMonths = (from, to) => {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.max(0, (by - ay) * 12 + bm - am - (bd < ad ? 1 : 0));
};

// 초과운행료가 국산 100원, 수입 200원이라 나눈다. 차량 DB에 제조사·딜러사 칸이 없어 차종 이름으로 본다(화면에서 고칠 수 있다)
const DOMESTIC_MODEL = /^(ray|레이|avante|아반떼|sonata|쏘나타|grander|그랜저|casper|캐스퍼|kona|cona|코나|tucson|투싼|santa|싼타페|palisade|팰리세이드|펠리세이드|staria|스타리아|porter|포터|ioniq|아이오닉|nexo|넥쏘|morning|모닝|k[3-9]\b|seltos|셀토스|sportage|스포티지|sorento|쏘렌토|carnival|카니발|mohave|mojave|모하비|niro|니로|ev\d|bongo|봉고|g70|g80|g90|gv\d0|genesis|제네시스|grand koleos|그랑\s*콜레오스|koleos|qm6|xm3|sm6|torres|토레스|rexton|렉스턴|trail|트레일블레이저)/i;
export const originOf = (carModel) => (DOMESTIC_MODEL.test(String(carModel || '').trim().replace(/^(더|디)\s+(올\s+)?(뉴\s+)?/, '')) ? '국산' : '외산');

/** 중도해지 정산서 양식. 엑셀의 세 시트다 */
export const SETTLEMENT_LAYOUTS = { split: '구분형 (정산 안내)', summary: '요약형', detail: '상세' };

/** 범칙금·과태료 예치금. 30만원 고정이고 반납 3개월 후 최종 부과를 확인해 잔액을 돌려준다(대표님 2026-11-04) */
export const FINE_DEPOSIT = 300000;

const toNum = (v) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;

/**
 * 중도해지 정산. 엑셀 '중도해지_정산서261104.xlsx'(대표님 2026-11-04) 정산서상세 시트의 식 그대로다.
 *   A 미납 렌트료 = 월 렌트료 × 미납 회차 + 1일 렌트료 × 잔여 일수 (납부 회차는 청구 회차표의 입금완료 수, 인도일부터 한 달씩 충당)
 *     원장 금액으로 계산하지 않는다. 원장에는 CMS 수수료가 빠진 금액이 적혀 있다(대표님 2026-11-04).
 *   B 초과운행 부담금 = (실주행 − 연 약정 ÷ 365 × 이용일 − 기본 제공) × km당 요금
 *   C 면책금(수리비) = 수리내역 합계
 *   D 미납 청구금액 = 미납 통행료 + 범칙금 + 미납 수리비
 *   E 위약금 = earlyPenalty
 *   최종 정산금 = A + B + C + D + E − 보증금 − 선수금 미경과분 − 초과 납부 렌트료
 * @param {object} doc 서버 buildDeliveryDocs의 차 한 대
 * @param {object} form 화면 입력값(문자열이어도 된다)
 * @returns {object | null} 반납일·인도일·만료일이 날짜가 아니면 null
 */
export const settlementOf = (doc, form) => {
  const { returnDate } = form;
  const start = doc?.deliveryDate;
  const end = doc?.endDate;
  if ([returnDate, start, end].some((x) => Number.isNaN(ymdTime(x)))) return null;

  const fee = Number(doc.monthlyFee) || 0;
  const deposit = Number(doc.deposit) || 0;
  const advance = Number(doc.advancePayment) || 0;
  const termMonths = Number(doc.termMonths) || 0;
  const paidCount = toNum(form.paidCount);
  const ratePct = ratePctOf(doc, form.ratePct);
  const annualKm = toNum(form.annualKm) || Number(doc.mileage) || 0;
  const origin = form.origin || originOf(doc.carModel);

  const usedDays = daysBetween(start, returnDate) + 1;
  const remainDays = Math.max(0, daysBetween(returnDate, end));
  const totalDays = daysBetween(start, end) + 1;

  // A. 미납 렌트료: 납부한 회차 다음 날부터 반납일까지
  const paidUntil = addDays(edate(start, paidCount), -1);
  const unpaidFrom = addDays(paidUntil, 1);
  const hasUnpaid = returnDate > paidUntil;
  const unpaidDays = hasUnpaid ? daysBetween(paidUntil, returnDate) : 0;
  const unpaidRounds = hasUnpaid ? fullMonths(unpaidFrom, addDays(returnDate, 1)) : 0;
  const roundRent = fee * unpaidRounds;
  const leftFrom = edate(unpaidFrom, unpaidRounds);
  const leftDays = hasUnpaid ? Math.max(0, daysBetween(leftFrom, returnDate) + 1) : 0;
  const dailyRent = Math.floor((fee * 12) / 365);
  const leftRent = dailyRent * leftDays;
  const unpaidRent = roundRent + leftRent;
  const firstRoundEnd = addDays(edate(start, 1), -1);

  // 납부한 회차가 반납일을 넘었으면 반납일 다음 날부터 그 회차 끝까지가 돌려줄 렌트료다(미납과 같은 셈법)
  const overFrom = addDays(returnDate, 1);
  const overMonths = hasUnpaid ? 0 : fullMonths(overFrom, addDays(paidUntil, 1));
  const overDays = hasUnpaid ? 0 : Math.max(0, daysBetween(edate(overFrom, overMonths), paidUntil) + 1);
  const overpaidRent = fee * overMonths + dailyRent * overDays;

  // B. 초과운행 부담금
  const contractKm = (annualKm / 365) * usedDays;
  const actualKm = toNum(form.actualKm);
  const baseKm = toNum(form.baseKm);
  const excessKm = Math.max(0, actualKm - contractKm - baseKm);
  const kmRate = origin === '외산' ? 200 : 100;
  const excessFee = Math.floor(excessKm * kmRate);

  // C·D. 면책금, 미납 청구금액
  const repairs = (form.repairs || []).map(toNum);
  const repairTotal = repairs.reduce((s, n) => s + n, 0);
  const toll = toNum(form.toll);
  const fine = FINE_DEPOSIT;
  const unpaidRepair = toNum(form.unpaidRepair);
  const unpaidClaim = toll + fine + unpaidRepair;

  // E. 위약금
  const pen = earlyPenalty({ monthlyFee: fee, advancePayment: advance, termMonths, endDate: end, terminateDate: returnDate, ratePct });
  const penalty = pen?.penalty || 0;

  // 선수금 미경과분
  const advanceDaily = totalDays > 0 ? advance / totalDays : 0;
  const advanceRemain = Math.floor(advanceDaily * remainDays);
  const advanceUsed = advance - advanceRemain;

  const claimTotal = unpaidRent + excessFee + repairTotal + unpaidClaim + penalty;
  // 선수금은 이용기간만큼 빼고 나머지를, 반납일 뒤까지 낸 렌트료는 그만큼을 돌려줄 돈으로 보고 위약금 등과 상계한다(대표님 2026-11-04)
  const final = claimTotal - deposit - advanceRemain - overpaidRent;

  return {
    fee, deposit, advance, termMonths, paidCount, ratePct, annualKm, origin, returnDate, start, end,
    usedDays, remainDays, totalDays,
    paidUntil, unpaidFrom, hasUnpaid, unpaidDays, unpaidRounds, roundRent, roundsUntil: addDays(leftFrom, -1), leftFrom, leftDays, dailyRent, leftRent, unpaidRent,
    firstRoundEnd, firstRoundDays: daysBetween(start, firstRoundEnd) + 1,
    overFrom, overMonths, overDays, overpaidRent,
    contractKm, actualKm, baseKm, excessKm, kmRate, excessFee,
    repairs, repairTotal, toll, fine, unpaidRepair, unpaidClaim,
    penaltyDaily: pen?.daily || 0, penaltyDailySupply: pen ? pen.daily / 1.1 : 0, advanceMonthly: pen?.advanceMonthly || 0, penalty,
    advanceDaily, advanceUsed, advanceRemain,
    claimTotal, final
  };
};

/**
 * '2. 계약 종료 안내'의 기본 문구. 종료 구분과 날짜로 만든다.
 * @returns {string[]}
 */
export const defaultEndNotice = (form) => {
  const type = END_KINDS[form.kind] || END_KINDS.return;
  return [...type.lines(korDate(form.endDate) || '        '), '기타 문의 사항은 렌트베네핏(☎ 02-547-0303)으로 연락 주시기 바랍니다. 감사합니다.'];
};

// 화면에서 고친 문구(form.notice, 한 줄에 한 항목)가 있으면 그것을, 없으면 기본 문구를 쓴다. 번호는 확인서에서 붙인다.
export const endNoticeLines = (form) => (typeof form.notice === 'string'
  ? form.notice.split('\n').map((t) => t.trim()).filter(Boolean)
  : defaultEndNotice(form));
