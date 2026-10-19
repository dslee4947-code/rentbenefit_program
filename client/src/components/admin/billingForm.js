// 청구 회차의 입력값과 합계를 만드는 식.
//
// 청구서 화면(MonthlyBillingView)에서 한 건씩 열어 발행할 때와, 자동 발송 화면(AutoSendView)에서
// 여러 건을 한꺼번에 승인할 때 같은 식을 써야 한다. 둘이 따로 계산하면 같은 회차인데
// 화면에서 본 금액과 자동으로 나간 금액이 달라진다.

import { isMaintenanceKind, sumAmount, isBilledNotice } from './InvoiceSheet.jsx';

/**
 * 직전 회차에서 아직 안 받은 금액.
 * 미납으로 찍은 회차만 이월한다. 청구만 나간 상태(청구됨)는 아직 입금 기한 안이라 미결제가 아니다.
 */
export const unpaidOfPrevRound = (rounds, no) => {
  const prev = (rounds || []).find((r) => r.no === no - 1);
  if (!prev || prev.status !== '미납') return 0;
  return Math.max(0, (prev.total || 0) - (prev.paidAmount || 0));
};

/**
 * 회차를 열 때의 입력값. 전월을 미결제로 찍어 두었으면 미수금과 연체 이자를 서버 계산값으로 채운다.
 *
 * @param {object} item 청구 대상 목록의 한 줄 (prevRound, suggestedInterest, lateInterestRate, overdueDays)
 * @param {object} round 저장된 회차
 * @param {object[]} rounds 그 계약의 전체 회차
 */
export const buildRoundForm = (item, round, rounds) => {
  const carried = item.prevRound?.unpaid || unpaidOfPrevRound(rounds, round.no);
  const suggestedInterest = item.suggestedInterest || 0;
  return {
    no: round.no,
    monthlyRent: round.monthlyRent ?? 0,
    prevUnpaid: round.prevUnpaid || carried,
    prevOverpaid: round.prevOverpaid || 0,
    interest: round.interest || suggestedInterest,
    fine: round.fine || 0,
    maintenance: round.maintenance || 0,
    other: round.other || 0,
    extras: (round.extras || []).map((e) => ({ label: e.label || '', amount: e.amount || 0 })),
    note: round.note || '',
    carried,
    suggestedInterest,
    interestRate: item.lateInterestRate || 0,
    interestDays: item.overdueDays || 0,
    issuedAt: round.issuedAt || null // 발행한 회차는 서류 상태를 바꿀 수 없다
  };
};

/**
 * 입력값과 붙은 서류로 항목별 금액과 합계를 낸다.
 *
 * 서류에 금액을 적어 두면 그 합계가 청구 금액이 된다(사람이 더하다 틀리는 일을 없앤다).
 * 고객이 직접 냈거나 명의가 넘어간 건은 뺀다. 서버 recalcRound와 같은 규칙이다.
 */
export const formTotals = (form, attachments) => {
  if (!form) {
    return { fineTotal: 0, maintenanceTotal: 0, otherTotal: 0, total: 0, docFine: 0, docMaintenance: 0, hasDocFine: false, hasDocMaintenance: false, extrasTotal: 0 };
  }
  const docs = attachments || [];
  const docFine = sumAmount(docs.filter((a) => !isMaintenanceKind(a.kind) && isBilledNotice(a)));
  const docMaintenance = sumAmount(docs.filter((a) => isMaintenanceKind(a.kind) && isBilledNotice(a)));
  const hasDocFine = docs.some((a) => !isMaintenanceKind(a.kind) && Number(a.amount) > 0);
  const hasDocMaintenance = docs.some((a) => isMaintenanceKind(a.kind) && Number(a.amount) > 0);

  const extrasTotal = (form.extras || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const otherTotal = (form.extras || []).length ? extrasTotal : Number(form.other || 0);
  const fineTotal = hasDocFine ? docFine : Number(form.fine || 0);
  const maintenanceTotal = hasDocMaintenance ? docMaintenance : Number(form.maintenance || 0);

  const total = Number(form.monthlyRent || 0) + Number(form.prevUnpaid || 0) + Number(form.interest || 0)
    + fineTotal + maintenanceTotal + otherTotal
    - Number(form.prevOverpaid || 0);

  return { fineTotal, maintenanceTotal, otherTotal, total, docFine, docMaintenance, hasDocFine, hasDocMaintenance, extrasTotal };
};

/** 회차 저장(PUT) 본문. 화면에 보이는 금액 그대로 저장되게 합산한 값을 넣는다. */
export const roundSaveBody = (form, totals) => ({
  ...form,
  fine: totals.fineTotal,
  maintenance: totals.maintenanceTotal,
  other: totals.otherTotal
});
