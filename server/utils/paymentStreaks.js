/**
 * 대시보드 "입금 기록이 끊긴 계약"의 계산과 근거(대표님 2026-11-18: 근거를 보고, 언제부터 안 들어왔는지 확인).
 *
 * 끊긴 계약 = 입금 기록이 들어와 있는 기간(recordedUntil) 안에서, 가장 최근 회차부터 거꾸로
 * 두 회차 이상 연달아 입금완료가 아닌 계약. 실제 미납이거나 원장 입금이 회차표에 반영되지 않은 경우다.
 *
 * 근거로는 계약마다 ① 끊긴 회차 목록(출금일·청구액·상태) ② 회차표에서 마지막으로 입금완료된 회차
 * ③ 차량 손익 원장(갑지)의 렌트료 입금 중 마지막 입금과, 끊긴 첫 출금일 뒤에 들어온 입금을 함께 보여 준다.
 * 원장에도 입금이 없으면 실제 미납, 원장에는 있으면 회차표 반영 누락으로 본다.
 */

const RENT_LABEL = /렌트료|렌트\s*\d+\s*회차/;
export const isRentDeposit = (e) => e?.side === '입금' && !!e.date && Number(e.amount) > 0
  && (e.category === '렌트료' || RENT_LABEL.test(e.label || ''));

/**
 * @param {Array<{contract, no, dueDate, status, unpaid}>} overdueRows 출금일이 지났고 입금완료가 아닌 회차
 * @param {Date} recordedUntil 입금 기록이 들어와 있는 마지막 날
 * @returns {Array<{contractId, months, amount, rounds, latest, since}>} 금액 큰 순
 */
export function findStreaks(overdueRows, recordedUntil) {
  const byContract = new Map();
  for (const r of overdueRows) {
    if (new Date(r.dueDate) > recordedUntil) continue;
    const key = String(r.contract);
    if (!byContract.has(key)) byContract.set(key, []);
    byContract.get(key).push(r);
  }
  const out = [];
  for (const [contractId, list] of byContract) {
    list.sort((a, b) => b.no - a.no);
    // 가장 최근 회차부터 거꾸로 끊기지 않고 이어진 만큼
    let run = 1;
    while (run < list.length && list[run].no === list[run - 1].no - 1) run += 1;
    if (run < 2) continue;
    const rounds = list.slice(0, run).reverse(); // 오래된 회차부터
    // 미납이 다음 청구서로 넘어가면(전월 미결제) 마지막 회차 청구액에 앞 회차 미납이 이미 들어 있다.
    // 그대로 더하면 두 번 센다(카멜 55~58회: 376,700+753,400+1,130,100+1,506,800). 그때는 마지막 회차만 센다.
    // 넘어갔는지는 마지막 회차가 바로 앞 회차 미납 + 제 몫(첫 회차 금액의 절반 이상)을 담고 있는지로 본다.
    // 같은 금액이 매달 따로 청구된 경우(640,000 → 640,000)는 넘어간 것이 아니다.
    const last = rounds[rounds.length - 1];
    const prev = rounds[rounds.length - 2];
    const carried = prev.unpaid > 0 && last.unpaid >= prev.unpaid + rounds[0].unpaid * 0.5;
    for (const r of rounds) r.inAmount = !carried || r === last;
    out.push({
      contractId,
      months: run,
      carried,
      amount: rounds.filter((r) => r.inAmount).reduce((a, r) => a + r.unpaid, 0),
      rounds,
      latest: list[0],
      since: rounds[0].dueDate // 끊긴 첫 회차의 출금일 = 이때부터 입금 기록이 없다
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * 계약에 이어진 원장(갑지)의 렌트료 입금 줄. 차가 여러 대면 원장도 여러 개라 모두 모은다.
 * 원장에 계약 구간(contractPeriods)이 있으면 그 계약 구간의 줄만, 없으면 원장 전체를 쓴다.
 */
export function rentDepositsOf(ledgers, contractId) {
  const id = String(contractId);
  const out = [];
  for (const l of ledgers) {
    const periods = (l.contractPeriods || []).filter((p) => String(p.contract?._id || p.contract || '') === id);
    const seqs = periods.length ? new Set(periods.map((p) => p.seq || 1)) : null;
    if (!seqs && String(l.contract || '') !== id) continue;
    for (const e of l.entries || []) {
      if (!isRentDeposit(e)) continue;
      if (seqs && !seqs.has(e.periodSeq || 1)) continue;
      out.push({ date: new Date(e.date), amount: Number(e.amount) || 0, label: e.label || '', plateNo: l.header?.plateNo || '' });
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

/**
 * 원장 입금과 견주어 이 끊김이 실제 미납인지 기록 누락인지 한 줄로.
 * 끊긴 첫 출금일 7일 전부터의 입금을 본다(25일 출금분이 며칠 일찍 들어오기도 한다).
 * 다만 그 입금이 모두 첫 출금일 전이면 앞 회차 몫을 늦게 낸 것일 수 있어 '미납 의심'으로 둔다.
 */
export function verdictOf(streak, deposits) {
  const since = new Date(streak.since);
  const after = deposits.filter((d) => d.date >= new Date(since.getTime() - 7 * 864e5));
  const sum = after.reduce((a, d) => a + d.amount, 0);
  if (!deposits.length) return { kind: '원장 없음', after, sum, text: '이 계약에 이어진 원장 렌트료 입금이 없습니다. 원장 연결부터 확인' };
  if (!after.some((d) => d.date >= since)) {
    return { kind: '미납 의심', after, sum, text: after.length
      ? '끊긴 첫 출금일 뒤로 원장 렌트료 입금이 없습니다(직전 입금은 앞 회차 몫일 수 있음) → 실제 미납 가능성'
      : '원장에도 이 기간 렌트료 입금이 없습니다 → 실제 미납 가능성' };
  }
  return { kind: '반영 누락 의심', after, sum, text: `원장에는 이 기간 렌트료 입금 ${after.length}건이 있습니다 → 회차표 입금 처리 누락 가능성` };
}
