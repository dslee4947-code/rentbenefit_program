import { calcLateInterest, daysBetween } from './billingDate.js';

/**
 * 연체 이자 내역을 원장 입금일로 다시 센다.
 *
 * 대표님 지시(2026-10-20): 출금일에 돈이 안 들어온 회차는 나중에 들어왔어도 '미납'이었던 것이고,
 * 그 회차가 다음 청구서를 만들 때까지 안 들어왔으면 그 청구서에 이자가 붙어야 한다.
 * 엑셀 시절에는 이자를 받지 않았으므로 지난 청구서에는 '받지 않은 이자'로 명시만 한다.
 *
 * 규칙
 *  - 미납: 출금일 + 15일(연체 유예) 안에 입금이 없던 회차
 *  - 이자를 붙이는 청구서: 그 회차가 아직 안 들어온 상태에서 만든 다음 회차 청구서들
 *    (청구서 작성일이 없으면 출금일 12일 전에 만든 것으로 본다)
 *  - 이자: 그 회차 원금(렌트료·범칙금·정비·기타) × 연이율 × (직전 출금일 → 이번 출금일 일수) / 365, 10원 미만 버림
 *  - 이자에는 이자를 붙이지 않는다
 */
export const LATE_GRACE_DAYS = 15;
const ISSUE_LEAD_DAYS = 12;
const DAY = 864e5;

/** 회차 자기 몫(이월·이자 제외) */
export const ownAmountOf = (r) => (r.monthlyRent || 0) + (r.fine || 0) + (r.maintenance || 0)
  + (r.other || 0) - (r.prevOverpaid || 0);

/** 출금일 + 15일 안에 입금이 없던 회차인지 (나중에 들어왔어도 true) */
export const wasLate = (r, now = new Date()) => {
  const due = new Date(r.dueDate);
  if (r.paidAt) return (new Date(r.paidAt) - due) / DAY > LATE_GRACE_DAYS;
  // 입금 기록이 없으면 '미납'으로 확인된 회차만 늦은 것으로 본다(입금 짝을 못 찾은 '청구됨'은 모른다로 둔다)
  return r.status === '미납' && (now - due) / DAY > LATE_GRACE_DAYS;
};

/**
 * 회차표 전체의 연체 이자 내역.
 * @param {Array<object>} rounds 회차들
 * @param {number} rate 연 이율(%)
 * @param {Date} [now]
 * @returns {Map<number, Array<object>>} 이자가 붙는 회차 번호 -> 내역
 *   내역: { fromNo, fromDue, principal, from, to, days, rate, amount }
 */
export const lateInterestByRound = (rounds, rate, now = new Date()) => {
  const rs = [...(rounds || [])].sort((a, b) => a.no - b.no);
  const out = new Map();
  rs.forEach((k, ki) => {
    if (!wasLate(k, now)) return;
    const principal = ownAmountOf(k);
    if (!(principal > 0)) return;
    const paid = k.paidAt ? new Date(k.paidAt) : null;
    for (let ji = ki + 1; ji < rs.length; ji += 1) {
      const j = rs[ji];
      const due = new Date(j.dueDate);
      const made = j.issuedAt ? new Date(j.issuedAt) : new Date(due.getTime() - ISSUE_LEAD_DAYS * DAY);
      if (made > now) break; // 아직 만들지 않은 청구서
      if (paid && paid <= made) break; // 이 청구서를 만들기 전에 들어왔다
      const prev = rs[ji - 1];
      const days = daysBetween(prev.dueDate, j.dueDate);
      const amount = calcLateInterest({ unpaid: principal, annualRate: rate, days });
      if (!amount) continue;
      const list = out.get(j.no) || [];
      list.push({ fromNo: k.no, fromDue: k.dueDate, principal, from: prev.dueDate, to: j.dueDate, days, rate, amount });
      out.set(j.no, list);
    }
  });
  return out;
};
