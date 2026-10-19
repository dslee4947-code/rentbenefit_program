// 선납금(선수금)을 청구서에 보여 주는 계산.
//
// 계약 조건: 선납금을 계약기간으로 균등하게 나눈 금액을 월 렌트료에서 차감하고 청구한다.
// 시스템의 월 렌트료(차량 monthlyFee)는 이미 차감한 뒤의 금액, 즉 실제 청구액이다.
// 청구액은 바꾸지 않고, 고객이 "어떻게 나온 금액인지" 알 수 있게 차감 전 월 렌트료·차감액·잔액만 계산한다.
//
// 잔액 기준은 업계 장기렌터카 약관과 같다: 잔여 선납금 = 선납금 ÷ 총 개월 수 × 아직 청구하지 않은 개월 수.
// 10원 미만은 버리고, 버린 끝전은 마지막 회차에 몰아 넣어 합계가 선납금과 정확히 맞게 한다.

/** 회차당 차감액(마지막 회차 제외)과 마지막 회차 차감액 */
const splitOf = (total, months) => {
  const per = Math.floor(total / months / 10) * 10;
  return { per, last: total - per * (months - 1) };
};

/**
 * 차량 한 대의 n회차 선납금 차감.
 * @param {number} total 선납금
 * @param {number} months 계약 개월 수
 * @param {number} no 회차 (1부터)
 * @returns {{deduction: number, deducted: number, balance: number, remaining: number}|null}
 *   deduction: 이번 회차 차감액, deducted: 이번 회차까지 차감 누계, balance: 남은 선납금, remaining: 남은 회차 수
 */
export const advanceForRound = (total, months, no) => {
  const amount = Number(total) || 0;
  const term = Number(months) || 0;
  const n = Number(no) || 0;
  if (amount <= 0 || term <= 0 || n <= 0) return null;
  const { per } = splitOf(amount, term);
  const counted = Math.min(n, term);
  // 청구 렌트료(monthlyFee)는 매달 같으므로 차감액도 매달 같게 보여 준다. 10원 미만 끝전(마지막 회차 몫)은
  // 따로 청구서에 찍지 않고 잔액 계산에서만 마지막 회차에 정리한다(그래야 '월 렌트료'가 달마다 흔들리지 않는다).
  const deduction = n <= term ? per : 0;
  const deducted = counted < term ? per * counted : amount;
  return { deduction, deducted, balance: amount - deducted, remaining: Math.max(0, term - counted) };
};

/**
 * 계약(차량 여러 대 포함)의 n회차 선납금 내역. 선납금이 없으면 null.
 * @param {Array<object>} vehicles 차량 (advancePayment, advanceMonths, monthlyFee, plateNo)
 * @param {number} no 회차
 */
export const advanceSummary = (vehicles, no) => {
  const rows = (vehicles || [])
    .map((v) => {
      const a = advanceForRound(v.advancePayment, v.advanceMonths || v.paymentTerm, no);
      return a ? { ...a, plateNo: v.plateNo, total: Number(v.advancePayment), months: Number(v.advanceMonths || v.paymentTerm), billed: Number(v.monthlyFee) || 0 } : null;
    })
    .filter(Boolean);
  if (!rows.length) return null;
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  return {
    rows,
    total: sum('total'),
    deduction: sum('deduction'),
    deducted: sum('deducted'),
    balance: sum('balance'),
    remaining: Math.max(...rows.map((r) => r.remaining)),
    months: Math.max(...rows.map((r) => r.months))
  };
};
