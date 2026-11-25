import { recalcRound } from './roundTotal.js';

/**
 * 지난 회차들의 '받지 않은 연체 이자'(unbilledInterest)를 target 회차의 기타 청구 한 줄로 모은다.
 * 연체 이자 칸에 이미 청구한 회차(interest)와 다른 회차에서 이미 모아 청구한 이자는 빼고, 같은 회차에 다시 부르면 내역을 새로 맞춘다.
 *
 * @param {Array<object>} rounds 회차들
 * @param {object} target 이자를 넣을 회차(발행 전)
 * @returns {{ items: Array<object>, amount: number, label: string }}
 */
export const collectHeldInterest = (rounds, target) => {
  const elsewhere = new Set(rounds.filter((r) => r.no !== target.no)
    .flatMap((r) => (r.pastInterestCharge?.items || []).map((it) => `${it.onNo}:${it.fromNo}`)));
  const items = [...rounds].sort((a, b) => a.no - b.no)
    .filter((r) => r.no <= target.no && !(Number(r.interest) > 0))
    .flatMap((r) => (r.unbilledInterest?.items || []).map((it) => ({
      onNo: r.no, fromNo: it.fromNo, principal: it.principal, from: it.from, to: it.to, days: it.days, rate: it.rate, amount: it.amount
    })))
    .filter((it) => !elsewhere.has(`${it.onNo}:${it.fromNo}`) && Number(it.amount) > 0);
  const amount = items.reduce((s, it) => s + it.amount, 0);
  const label = items.length
    ? `지난 연체 이자 (${items[0].onNo}~${items[items.length - 1].onNo}회차 청구서 미청구분 ${items.length}건)`
    : '';
  return { items, amount, label };
};

/** 모은 이자를 target 회차 청구액에 넣는다. 모은 이자가 없으면 넣어 둔 줄을 뺀다. */
export const putHeldInterest = (target, { items, amount, label }) => {
  const oldLabel = target.pastInterestCharge?.label;
  const extras = (target.extras || [])
    .filter((e) => !oldLabel || e.label !== oldLabel)
    .map((e) => ({ label: e.label, amount: e.amount }));
  // 기타 청구가 비어 있으면서 other만 적혀 있던 예전 방식이면, 그 금액을 줄로 살려 둔다(합계가 extras로 다시 계산되므로)
  if (!(target.extras || []).length && Number(target.other) > 0) extras.push({ label: '기타 청구', amount: target.other });
  if (items.length) extras.push({ label, amount });
  target.extras = extras;
  if (!extras.length) target.other = 0;
  target.pastInterestCharge = items.length ? { label, amount, chargedAt: new Date(), items } : undefined;
  recalcRound(target);
};

/**
 * 이자를 적어만 두는 계약(schedule.interestHold)은 마지막 회차 청구서에 모아 넣는다(대표님 2026-11-25).
 * 마지막 회차를 이미 발행했으면 그대로 둔다.
 * @returns {boolean} 값이 바뀌었는지 (저장은 부르는 쪽에서)
 */
export const syncHeldInterestToLastRound = (schedule) => {
  if (!schedule.interestHold) return false;
  const rounds = [...schedule.rounds].sort((a, b) => a.no - b.no);
  const last = rounds[rounds.length - 1];
  if (!last || last.issuedAt || last.status !== '예정') return false;
  const held = collectHeldInterest(rounds, last);
  if ((last.pastInterestCharge?.amount || 0) === held.amount && (last.pastInterestCharge?.label || '') === held.label) return false;
  putHeldInterest(last, held);
  return true;
};
