/**
 * 원장 렌트료 입금을 청구서 회차에 맞춘다(날짜·금액 기준).
 *
 * 갑지(엑셀)의 '렌트료 n회차'는 사람이 들어온 순서대로 번호를 붙여서, 입금이 빠진 달이 있어도
 * 번호가 이어진다. 그래서 원장만 보면 몇 회차가 안 들어왔는지 알 수 없었다(대표님 2026-10-23, 동춘푸드).
 * 청구서 회차(출금일·그 달 몫)를 기준으로 칸을 만들고, 입금을 날짜로 그 회차에 넣는다.
 *
 * 규칙(대표님 2026-10-23): 25일 출금 → 영업일 2일 뒤 입금, 주말·공휴일이면 4~5일 뒤.
 *   1) 출금일 7일 전 ~ 7일 뒤, 또는 출금일과 같은 달(7일 전부터)에 그 달 몫(90% 이상)이 들어오면 그 회차
 *      몇 달 몫이 한꺼번에 들어왔으면 앞의 빈 회차도 함께 낸 것(미납 → 합산)
 *   2) 회차 번호가 맞고 출금일 +15일 안이면 연휴로 늦은 것으로 그 회차
 *   3) 그 달 몫보다 적게 들어온 입금은 일부 입금
 *   4) 남은 입금은 오래된 빈 회차부터(늦게 입금)
 */

const DAY = 864e5;
const KST = 9 * 3600e3;
const dayNo = (d) => Math.floor((new Date(d).getTime() + KST) / DAY);
const ymdOf = (d) => new Date(new Date(d).getTime() + KST).toISOString().slice(0, 10);
const gapOf = (due, date) => dayNo(date) - dayNo(due);

const carriedExtra = (r) => (r.extras || [])
  .filter((e) => /미납|연체\s*이자/.test(e.label || ''))
  .reduce((a, e) => a + (Number(e.amount) || 0), 0);

/** 그 회차 몫 = 월 렌트료 + 범칙금·정비·기타 (앞 회차에서 넘어온 미납·연체 이자는 뺀다) */
export const ownAmountOf = (r) => Math.max(0, (r.monthlyRent || 0) + (r.fine || 0) + (r.maintenance || 0)
  + (r.other || 0) - carriedExtra(r) - (r.prevOverpaid || 0));

/**
 * @param {Array<object>} rounds 청구서 회차(no, dueDate, monthlyRent, fine …)
 * @param {Array<{_id, date, amount, round?}>} deposits 원장 렌트료 입금 줄(date는 'YYYY-MM-DD' 또는 Date)
 * @param {Date} [now]
 * @returns {{ rows: Array<object>, unmatched: Array<object> }}
 *   rows: { no, dueDate, own, kind, entryIds, paidAmount, paidDate, note, due, overdue }
 *   kind: 정상 · 늦게 입금 · 미납→합산 · 일부 입금 · 미입금 · 예정 · 청구 없음
 */
export function matchRentToRounds(rounds, deposits, now = new Date()) {
  const deps = deposits
    .filter((d) => d.date && Number(d.amount) > 0)
    .map((d) => ({ ...d, t: new Date(`${String(d.date).slice(0, 10)}T00:00:00+09:00`), used: [] }))
    .sort((a, b) => a.t - b.t);
  const rows = [...rounds].sort((a, b) => a.no - b.no).map((r) => ({
    no: r.no, dueDate: r.dueDate, own: ownAmountOf(r), kind: null, deps: [], note: ''
  }));
  const free = (d) => !d.used.length;
  const covers = (amount, own) => own > 0 && amount >= own * 0.9;
  const times = (amount, own) => (own > 0 ? Math.max(1, Math.round(amount / own)) : 1);
  const inWin = (d, row, wide) => {
    const g = gapOf(row.dueDate, d.t);
    return g >= -7 && (g <= (wide ? 15 : 7) || ymdOf(d.t).slice(0, 7) === ymdOf(row.dueDate).slice(0, 7));
  };
  // 원장 회차 번호와 청구서 회차 번호의 차이(차 한 대 기준 번호라 계약이 바뀐 차는 다르다)
  const diffs = new Map();
  for (const row of rows) {
    const d = deps.find((x) => x.round && inWin(x, row, false) && covers(x.amount, row.own));
    if (d) diffs.set(d.round - row.no, (diffs.get(d.round - row.no) || 0) + 1);
  }
  const offset = [...diffs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const labelOf = (d) => (d.round ? d.round - offset : null);
  const take = (row, d, kind, note = '') => { d.used.push(row.no); row.deps.push(d); row.kind = kind; if (note) row.note = note; };

  for (const row of rows) {
    if (!(row.own > 0)) { row.kind = '청구 없음'; continue; }
    const d = deps.find((x) => free(x) && covers(x.amount, row.own)
      && (inWin(x, row, false) || (labelOf(x) === row.no && inWin(x, row, true))));
    if (!d) continue;
    const g = gapOf(row.dueDate, d.t);
    take(row, d, '정상', g > 7 ? `+${g}일(연휴 등)` : '');
    let k = times(d.amount, row.own) - 1;
    for (let j = rows.indexOf(row) - 1; j >= 0 && k > 0; j -= 1) {
      const p = rows[j];
      if (p.kind || !(p.own > 0)) continue;
      take(p, d, '미납→합산', `${row.no}회차 때 함께 입금`);
      k -= 1;
    }
  }
  for (const row of rows) {
    if (row.kind || !(row.own > 0)) continue;
    const d = deps.find((x) => free(x) && labelOf(x) === row.no && inWin(x, row, true) && x.amount >= row.own * 0.3);
    if (d) take(row, d, '일부 입금', `${(row.own - d.amount).toLocaleString()}원 부족`);
  }
  for (const d of deps.filter(free)) {
    const first = rows.find((r) => !r.kind && r.own > 0 && d.t >= new Date(new Date(r.dueDate).getTime() - 7 * DAY));
    if (!first || !covers(d.amount, first.own)) continue;
    let k = times(d.amount, first.own);
    for (const row of rows) {
      if (k <= 0) break;
      if (row.kind || !(row.own > 0) || d.t < new Date(new Date(row.dueDate).getTime() - 7 * DAY)) continue;
      take(row, d, '늦게 입금', `+${gapOf(row.dueDate, d.t)}일 늦게`);
      k -= 1;
    }
  }
  const today = dayNo(now);
  for (const row of rows) {
    if (row.kind) continue;
    row.kind = dayNo(row.dueDate) > today ? '예정' : '미입금';
  }

  return {
    offset,
    rows: rows.map((r) => {
      const dates = r.deps.map((d) => ymdOf(d.t)).sort();
      return {
        no: r.no,
        due: ymdOf(r.dueDate),
        own: r.own,
        kind: r.kind,
        note: r.note,
        entryIds: r.deps.map((d) => d._id),
        // 한꺼번에 들어온 돈은 회차 몫만큼만 이 회차에 보인다
        paidAmount: r.deps.reduce((a, d) => a + (d.used.length > 1 ? Math.round(d.amount / d.used.length) : d.amount), 0),
        paidDate: dates[dates.length - 1] || '',
        overdue: r.kind === '미입금' && today - dayNo(r.dueDate) > 7
      };
    }),
    unmatched: deps.filter(free).map((d) => ({ _id: d._id, date: ymdOf(d.t), amount: d.amount, round: d.round }))
  };
}
