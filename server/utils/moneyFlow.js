import { depreciationOf } from '../../shared/vehicleDepreciation.js';
import { accountOf } from '../../shared/companyAccounts.js';

/**
 * "렌트베네핏은 이렇게 벌고 쓴다" 흐름도 계산 (대표님 2026-11-06).
 *
 * 렌트 사업과 차량 판매를 나눠서 본다.
 *   렌트 사업 = 렌트 매출 − 영업비용(차값 감가 포함). 차값 회수분까지 이익으로 보이지 않게 감가를 넣는다.
 *   차량 판매 = 판매 대금 − 판 날까지 감가하고 남은 차값
 *
 * 이자는 회사 장부 + 캐피탈·할부 이자만 쓴다.
 *   - 갑지의 날짜 없는 '이자' 줄은 담보대출 이자를 차마다 계산해 나눈 값이라 회사 장부 이자와 같은 돈이다. 넣지 않는다.
 *   - 캐피탈·할부 상환은 회사 장부에 없는 실제 출금이다. 원금은 차값을 나눠 내는 것이라 비용이 아니고 이자 몫만 비용이다.
 *
 * 금액은 원 단위. 월은 한국 날짜 기준이다.
 */

const FLOW_COST_GROUPS = [
  ['인건비 (급여·4대보험)', { book: ['salary', 'payroll'] }],
  ['차량 보험료', { ledger: ['보험'] }],
  ['차량작업·탁송', { ledger: ['차량작업', '탁송'], book: ['vehicleWork', 'delivery'] }],
  ['법인카드', { book: ['card'] }],
  ['정비·수리·검사·세금', { ledger: ['수리·사고', '자동차세', '정기점검', '검사비', '공제조합'] }],
  ['접대비', { book: ['entertainment'] }],
  ['유류·세차·통행료', { ledger: ['유류·세차', '과태료·통행료'] }]
];
const OTHER_COST = '기타 운영비';
export const DEPRECIATION_COST = '차값 감가';
const INCOME_ORDER = ['장기 렌트료', '단기·사고대차', '판매수수료·캐시백', '선납금 (나눠 반영)', '위약금·기타 수입'];
const ADVANCE = INCOME_ORDER[3];
const OTHER_INCOME = INCOME_ORDER[4];

// 현금 기준 화면: 차 사고 모자란 돈을 어디서 메웠나. 순서대로 보여 준다
const FUND = {
  deposit: '고객 보증금 (받음 − 돌려줌)',
  owner: '대표님 차입금 (빌림 − 갚음)',
  loan: '은행·공제조합 대출 (받음 − 갚음)',
  advance: '고객 선납금',
  vat: '부가세 (환급 − 납부)',
  equity: '자본금',
  asset: '회사가 맡긴 돈 (보증금·적금)'
};
const FUND_OF_SECTION = { debt: FUND.loan, vat: FUND.vat, equity: FUND.equity, asset: FUND.asset };
const flowGroupOf = (side, key) => FLOW_COST_GROUPS.find(([, g]) => (g[side] || []).includes(key))?.[0] || OTHER_COST;

const BUY = ['차량가', '계약금', '등록비용', '제세공과'];
const SKIP_COST = ['할부금', '할부이자', '차량가', '계약금', '등록비용', '제세공과', '대출금', '보증금', '환급'];
const SHORT_NOT_REVENUE = ['보증금', '대출금', '인수가', '차량가'];
const LONG_OTHER_INCOME = ['기타', '수리·사고', '공제조합', '보험', '과태료·통행료', '유류·세차'];
// 판매 대금은 대부분 분류 '차량가' 입금(이름 '차량대금')으로 적혀 있다. 이름으로만 찾으면 빠진다
const SALE_LABEL = /차량\s*판매|판매\s*(금|대금|가)|매각|해외\s*수출|차량\s*대금/;
// '메리츠' 입금은 차를 사려고 빌려 들어온 돈이다(수입 아님). '메리츠_홍길동'은 보험사가 낸 대차료라 여기 들지 않는다
const LOAN_LABEL = /^메리츠(\s*리스피)?$/;
// 이름에 '판매'가 들어가도 판매 대금이 아닌 분류('차량 판매 수수료' 등)
const NOT_SALE_BY_LABEL = ['수수료', '캐시백', '보증금', '선납금', '대출금', '렌트료', '환급'];
const FALLBACK_TERM_MONTHS = 36;

const KST = 9 * 3600e3;
const monthOf = (d) => new Date(new Date(d).getTime() + KST).toISOString().slice(0, 7);
const monthEnd = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 1) - KST - 1);
};
const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const sumOf = (list) => list.reduce((s, e) => s + (Number(e.amount) || 0), 0);

/**
 * 할부 상환 한 줄 중 이자 몫의 비율.
 * 끝난 대출은 (낸 돈 − 원금) ÷ 낸 돈, 진행 중이면 약정 (월 납입 × 개월)으로 잡는다. 원금이나 약정을 모르면 null.
 */
export const loanInterestShare = ({ paid, principal, monthly, term }) => {
  if (!(paid > 0) || !(principal > 0)) return null;
  if (paid >= principal) return (paid - principal) / paid;
  const planned = (Number(monthly) || 0) * (Number(term) || 0);
  return planned > principal ? (planned - principal) / planned : null;
};

/**
 * @param {object} args
 * @param {object[]} args.ledgers 차량 손익 원장 전체
 * @param {object[]} args.txs 회사 장부 줄 (합계에서 뺀 줄 제외)
 * @param {Date} [args.now]
 */
export const buildMoneyFlow = ({ ledgers, txs, now = new Date() }) => {
  const nowMonth = monthOf(now);
  const [ny, nm] = nowMonth.split('-').map(Number);
  const from12 = `${nm === 12 ? ny : ny - 1}-${String(nm === 12 ? 1 : nm + 1).padStart(2, '0')}`;
  const buckets = new Map();
  const bucketsOf = (m) => {
    const keys = [m.slice(0, 4)];
    if (m >= from12 && m <= nowMonth) keys.push('last12');
    return keys.map((k) => {
      if (!buckets.has(k)) {
        buckets.set(k, { income: {}, costs: {}, refund: 0, bookInterest: 0, capitalInterest: 0, carBuy: 0, loanPrincipal: 0, sale: 0, saleRevenue: 0, saleCost: 0, saleCount: 0, funding: {} });
      }
      return buckets.get(k);
    });
  };
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const usable = (d) => {
    if (!d) return false;
    const m = monthOf(d);
    return m >= '2020-01' && m <= nowMonth; // 날짜를 잘못 적은 줄(1902년·2505년)은 뺀다
  };

  // 공제조합 대출처럼 원장(대출금)과 회사 장부(은행 대출)에 같은 돈이 함께 적힌 줄이 있다. 금액이 같고 7일 안이면 장부 쪽만 센다
  const bookLoans = txs.filter((t) => t.account === 'bankLoan' && t.direction === '입금');
  const inBook = (e) => bookLoans.some((t) => t.amount === Number(e.amount) && Math.abs(new Date(t.date) - new Date(e.date)) <= 7 * 864e5);

  const checks = { noSaleRecord: [], loanInterestUnknown: [], saleOnRunningCar: [] };

  // 갑지 한 장이 차 한 대다. Ray-054와 Ray-054_1처럼 번호가 비슷해도 차량번호가 다른 별개의 차다
  for (const main of ledgers) {
    const key = main.ledgerNo;
    const entries = main.entries || [];
    const ended = main.status === '거래완료';
    const unassigned = main.status === '차량미배정';
    const isLong = main.ledgerType === '장기렌트';

    // ── 할부 원금·이자
    // 날짜가 빠진 상환 줄도 합계에는 넣어야 이자 몫 비율이 맞다(Benz-004는 47줄 중 19줄이 날짜 없음)
    const repayRows = entries.filter((e) => e.side === '지출' && e.category === '할부금');
    const paid = sumOf(repayRows);
    const loanInRows = entries.filter((e) => e.side === '입금' && (e.category === '대출금' || LOAN_LABEL.test(String(e.label || '').trim())));
    const contracted = main.loan?.amount ? main.loan : null;
    const share = loanInterestShare({
      paid,
      principal: Number(contracted?.amount) || sumOf(loanInRows),
      monthly: contracted?.monthlyPayment,
      term: contracted?.termMonths
    });
    if (repayRows.length && share === null) checks.loanInterestUnknown.push(key);

    // ── 판매 대금
    let saleTotal = 0;
    let lastSaleAt = null;
    for (const e of entries) {
      const a = Number(e.amount) || 0;
      const ok = usable(e.date);
      const m = ok ? monthOf(e.date) : null;
      const targets = ok ? bucketsOf(m) : [];

      if (e.side === '입금') {
        const label = String(e.label || '');
        const refundOfSale = ended && isLong && e.category === '환급' && /계약금/.test(label);
        const isSale = refundOfSale || e.category === '인수가' || e.category === '차량가'
          || (ended && ['계약금', '제세공과'].includes(e.category))
          || (!NOT_SALE_BY_LABEL.includes(e.category) && SALE_LABEL.test(label));
        if (isSale) {
          saleTotal += a;
          if (ok && a > 0 && (!lastSaleAt || new Date(e.date) > lastSaleAt)) lastSaleAt = new Date(e.date);
          for (const b of targets) b.sale += a;
          continue;
        }
        for (const b of targets) {
          if (isLong && e.category === '렌트료') add(b.income, '장기 렌트료', a);
          else if (!isLong && !SHORT_NOT_REVENUE.includes(e.category)) add(b.income, '단기·사고대차', a);
          else if (['수수료', '캐시백'].includes(e.category)) add(b.income, '판매수수료·캐시백', a);
          else if (e.category === '보증금') add(b.funding, FUND.deposit, a);
          else if (e.category === '선납금') add(b.funding, FUND.advance, a);
          else if (e.category === '계약금') add(b.funding, FUND.advance, a); // 아직 안 끝난 차의 고객 계약금: 받아 둔 돈
          else if (e.category === '대출금' || LOAN_LABEL.test(label.trim())) {
            if (!inBook(e)) add(b.funding, FUND.loan, a);
          } else if (e.category === '환급' && /계약금/.test(label)) add(b.funding, FUND.advance, a); // 받아 둔 계약금을 돌려준 것
          else if (e.category === '환급') b.refund += a;
          else if (LONG_OTHER_INCOME.includes(e.category)) add(b.income, OTHER_INCOME, a);
        }
      } else if (e.category === '할부금') {
        const interest = share === null ? 0 : a * share;
        for (const b of targets) { b.capitalInterest += interest; b.loanPrincipal += a - interest; }
      } else if (e.category === '할부이자') {
        // 날짜 없는 갑지 '이자' 줄은 usable에서 이미 걸러진다. 날짜가 있으면 실제로 낸 이자다
        for (const b of targets) b.capitalInterest += a;
      } else if (BUY.includes(e.category)) {
        for (const b of targets) b.carBuy += a;
      } else if (e.category === '보증금') {
        for (const b of targets) add(b.funding, FUND.deposit, -a);
      } else if (e.category === '대출금') {
        for (const b of targets) add(b.funding, FUND.loan, -a);
      } else if (e.category === '환급') {
        for (const b of targets) b.refund -= a; // 환급은 지출 쪽에 마이너스로 적혀 있다
      } else if (!SKIP_COST.includes(e.category)) {
        for (const b of targets) add(b.costs, flowGroupOf('ledger', e.category), a);
      }
    }

    // 계약이 끝난 차에 남은 보증금은 인수가와 상계한 돈이다(대표님 2026-10-28). 현금은 이미 받았으니 손익에만 더한다
    const depositHeld = sumOf(entries.filter((e) => e.category === '보증금' && e.side === '입금'))
      - sumOf(entries.filter((e) => e.category === '보증금' && e.side === '지출'));
    const offset = ended && depositHeld > 0 ? depositHeld : 0;
    saleTotal += offset;

    const lastEntryAt = entries.map((e) => e.date).filter(usable).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;
    const endAt = ended ? (lastSaleAt || lastEntryAt) : null;
    if (ended && saleTotal <= 0) checks.noSaleRecord.push(key);
    if (!ended && saleTotal !== 0) checks.saleOnRunningCar.push(key);

    // ── 감가: 산 차만, 판 날까지. 잘못 적힌 날짜(1909년 등)는 시작일로 쓰지 않는다
    const clean = (d) => (d && new Date(d).getFullYear() >= 2015 ? d : undefined);
    const periods = (main.contractPeriods || []).map((p) => ({ ...p, startDate: clean(p.startDate) }));
    const light = {
      ledgerType: main.ledgerType,
      terms: main.terms,
      header: { ...main.header, registeredAt: clean(main.header?.registeredAt), contractedAt: clean(main.header?.contractedAt) },
      contractPeriods: periods,
      entries: entries.filter((e) => e.side === '지출' && BUY.includes(e.category)).map((e) => ({ ...e, date: usable(e.date) ? e.date : undefined }))
    };
    const dep = unassigned ? { skip: '차 없음' } : depreciationOf(light, now);
    const stop = endAt && endAt < now ? endAt : now;
    if (!dep.skip && dep.start) {
      let prev = 0;
      let m = monthOf(dep.start);
      if (m < '2020-01') m = '2020-01';
      const stopMonth = monthOf(stop);
      while (m <= stopMonth) {
        const cut = m === stopMonth ? stop : monthEnd(m);
        const acc = depreciationOf(light, cut).accumulated || 0;
        if (acc > prev) {
          for (const b of bucketsOf(m)) add(b.costs, DEPRECIATION_COST, acc - prev);
          prev = acc;
        }
        m = nextMonth(m);
      }
    }

    // ── 판매 손익: 판 날에 한 번에 잡는다. 계약금·잔금 날짜가 달라도 원가와 같은 달에 놓이게 한다
    if (ended && endAt) {
      const book = dep.skip ? 0 : depreciationOf(light, stop).book;
      for (const b of bucketsOf(monthOf(endAt))) {
        b.saleRevenue += saleTotal;
        b.saleCost += book;
        b.saleCount += 1;
      }
    }

    // ── 선납금: 받은 달이 아니라 계약 기간에 나눠 렌트 매출로. 판매하면 남은 몫을 그달에 마저 넣는다
    const months = periods.reduce((s, p) => s + (Number(p.termMonths) || 0), 0) || Number(main.terms?.termMonths) || FALLBACK_TERM_MONTHS;
    for (const e of entries.filter((x) => x.side === '입금' && x.category === '선납금' && usable(x.date))) {
      const per = (Number(e.amount) || 0) / months;
      let left = Number(e.amount) || 0;
      let m = monthOf(e.date);
      const endMonth = endAt ? monthOf(endAt) : null;
      for (let i = 0; i < months && left !== 0; i += 1) {
        if (endMonth && m >= endMonth) {
          for (const b of bucketsOf(endMonth)) add(b.income, ADVANCE, left);
          left = 0;
          break;
        }
        if (m > nowMonth) break;
        for (const b of bucketsOf(m)) add(b.income, ADVANCE, per);
        left -= per;
        m = nextMonth(m);
      }
    }
  }

  for (const t of txs) {
    const m = monthOf(t.date);
    if (m > nowMonth) continue;
    const section = accountOf(t.account).section;
    const v = t.direction === '출금' ? t.amount : -t.amount;
    for (const b of bucketsOf(m)) {
      if (section === 'opex') add(b.costs, flowGroupOf('book', t.account), v);
      if (section === 'finance') b.bookInterest += v;
      // 빌리고 갚은 돈·부가세·자본금·맡긴 돈은 비용이 아니라 현금 기준 화면의 '돈을 어디서 마련했나'로 간다(들어오면 +)
      if (FUND_OF_SECTION[section]) add(b.funding, t.account === 'ownerLoan' ? FUND.owner : FUND_OF_SECTION[section], -v);
    }
  }

  // 환급보다 되돌려 준 돈이 많은 해(2021·2022)는 영업외 수익이 아니라 운영비로 본다
  for (const b of buckets.values()) if (b.refund < 0) { add(b.costs, OTHER_COST, -b.refund); b.refund = 0; }

  const order = [...FLOW_COST_GROUPS.map(([n]) => n), OTHER_COST, DEPRECIATION_COST];
  const periods = [...buckets.entries()]
    .sort(([a], [b]) => (a === 'last12' ? 1 : b === 'last12' ? -1 : a.localeCompare(b)))
    .map(([key, b]) => {
      const income = INCOME_ORDER.map((n) => [n, Math.round(b.income[n] || 0)]).filter(([, v]) => v > 0);
      const costs = order.map((n) => [n, Math.round(b.costs[n] || 0)]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
      const bookInterest = Math.round(b.bookInterest);
      const capitalInterest = Math.round(b.capitalInterest);
      const refund = Math.round(b.refund);
      const cashIn = income.filter(([n]) => n !== ADVANCE).reduce((s, [, v]) => s + v, 0);
      const cashOut = costs.filter(([n]) => n !== DEPRECIATION_COST).reduce((s, [, v]) => s + v, 0);
      return {
        key,
        label: key === 'last12' ? '최근 12개월' : `${key}년${key === nowMonth.slice(0, 4) ? ` (${Number(nowMonth.slice(5))}월까지)` : ''}`,
        range: key === 'last12' ? `${from12} ~ ${nowMonth}` : key,
        income,
        costs,
        refund,
        interest: bookInterest + capitalInterest,
        bookInterest,
        capitalInterest,
        saleRevenue: Math.round(b.saleRevenue),
        saleCost: Math.round(b.saleCost),
        saleCount: b.saleCount,
        // 현금 기준 화면용. 감가·선납금 나눔처럼 통장에 안 찍히는 값을 뺀 '장사로 남은 현금'
        cashNet: cashIn - cashOut - bookInterest - capitalInterest + refund,
        carBuy: Math.round(b.carBuy),
        loanRepay: Math.round(b.loanPrincipal),
        sale: Math.round(b.sale),
        funding: Object.values(FUND).map((n) => [n, Math.round(b.funding[n] || 0)]).filter(([, v]) => v !== 0)
      };
    })
    .filter((p) => p.income.length || p.saleRevenue);

  return { periods, checks };
};
