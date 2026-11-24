// 선납금(선수금)을 청구서에 보여 주는 계산.
//
// 계약 조건: 선납금을 계약기간으로 균등하게 나눈 금액을 월 렌트료에서 차감하고 청구한다.
// 시스템의 월 렌트료(차량 monthlyFee)는 이미 차감한 뒤의 금액, 즉 실제 청구액이다.
// 청구액(출금액)은 바꾸지 않는다. 세금계산서는 '월 렌트료 + 선납금 안분액'으로 발행하므로 그 금액을 함께 안내한다(대표님 2026-11-24).
// 청구서(InvoiceSheet)와 청구 메일(billingScheduleController)이 같은 계산을 쓴다.
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
  const { per, last } = splitOf(amount, term);
  const counted = Math.min(n, term);
  // 세금계산서 합계가 선납금과 맞아야 하므로 끝전은 마지막 회차 안분액에 넣는다
  const deduction = n < term ? per : n === term ? last : 0;
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

/** 안분 개월 수: 이번 계약 기간이 먼저다. 차량의 기간 칸에는 처음부터 쓴 전체 기간이 남은 차가 있다(차량 96개월, 계약 60개월) */
export const advanceMonthsOf = (vehicle, contract, totalRounds) => Number(contract?.termMonths) || Number(vehicle?.paymentTerm) || Number(totalRounds) || 0;

/**
 * 이번 회차 세금계산서 안내. 선납금이 없거나 안분이 끝났으면 null.
 * @param {object[]} vehicles advanceMonths까지 넣은 차량
 * @param {{no: number, monthlyRent: number}} round
 * @returns {{rent: number, advance: number, taxInvoice: number, basis: string, summary: object}|null}
 */
export const advanceTaxInvoice = (vehicles, round) => {
  const summary = advanceSummary(vehicles, round?.no);
  if (!summary?.deduction) return null;
  const rent = Number(round?.monthlyRent) || 0;
  // 차마다 개월 수가 다르면 'n/60회차'를 한 줄로 적을 수 없다
  const sameTerm = summary.rows.every((r) => r.months === summary.months);
  return {
    rent,
    advance: summary.deduction,
    taxInvoice: rent + summary.deduction,
    basis: `${summary.total.toLocaleString('ko-KR')}원${sameTerm ? ` ${round.no}/${summary.months}회차` : ''}`,
    summary
  };
};

export const ADVANCE_NOTE = '선납금 안분액은 선납금에서 충당되는 금액으로, 별도로 출금되지 않습니다.';

/** 청구 메일 본문에 붙일 글. 선납금이 없으면 '' */
export const advanceMailText = (vehicles, round) => {
  const t = advanceTaxInvoice(vehicles, round);
  if (!t) return '';
  const won = (n) => `${n.toLocaleString('ko-KR')}원`;
  return [
    '[선납금 및 세금계산서 안내]',
    `월 렌트료 : ${won(t.rent)}`,
    `선납금 안분액 : ${won(t.advance)} (${t.basis})`,
    `월 세금계산서 발행금액 : ${won(t.taxInvoice)}`,
    `※ ${ADVANCE_NOTE}`
  ].join('\n');
};
