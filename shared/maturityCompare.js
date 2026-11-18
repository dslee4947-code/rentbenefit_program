/**
 * 계약 만기 처리 비교표(대표님 2026-11-17): 만기가 다가온 계약자에게 세 길을 한 장에 나란히 보여 준다.
 *   1안 계약 연장 · 2안 인수 · 3안 반납(만기 반납, 중도해지 아님)
 *
 * 세 길 모두 지금 계약의 남은 회차(아직 입금 안 된 청구서)는 그대로 낸다. 그 위에
 *   연장: 보증금은 연장 계약으로 승계, 새 월 렌트료를 낸다.
 *   인수: 인수가에서 보증금을 빼고 낸다. 제3자가 인수하면 약관의 승계 수수료가 붙는다.
 *   반납: 보증금을 돌려드린다. 반납 뒤 외관 상태에 따라 수리비를 빼고 돌려드린다.
 *
 * 만기에는 계약 기간의 렌트료가 모두 정산돼야 한다(대표님 2026-11-17 "상환스케줄표의 날짜·회차와 계약기간을 보면 회차를 알 수 있다").
 * 회차표가 만기 전에 끝나 있으면 빠진 결제일을 월 렌트료로 채워 넣고 missing으로 표시한다.
 */

import { acquisitionTaxOf } from './usedCarTax.js';

// 계약서 약관의 제3자 인수 승계 수수료(대표님 2026-11-09)
export const SUCCESSION_FEE = 330000;

const num = (v) => Number(v) || 0;
const KST_MS = 9 * 3600 * 1000;
// 'YYYY-MM-DD' 또는 DB 날짜(한국 자정 = UTC 전날 15시)를 한국 날짜로
const toYmd = (v) => {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
};
// 같은 날짜로 n개월 뒤(말일 넘치면 그달 말일)
const addMonthsYmd = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

/**
 * 아직 입금 안 된 회차와 그 회차의 남은 금액.
 * 미납을 다음 청구서로 넘기면 다음 회차 합계에 앞 회차 미납(prevUnpaid)이 들어가므로, 그 몫을 빼고 회차마다 제 몫만 센다.
 */
export const remainingRoundsOf = (rounds = []) => rounds
  .filter((r) => r && r.status !== '입금완료')
  .map((r) => {
    const own = num(r.total) - num(r.prevUnpaid) + num(r.prevOverpaid);
    return { no: r.no, dueDate: toYmd(r.dueDate), status: r.status, fine: num(r.fine), amount: Math.max(0, own - num(r.paidAmount)) };
  })
  .filter((r) => r.amount > 0)
  .sort((a, b) => num(a.no) - num(b.no));

/**
 * 회차표 마지막 결제일 다음 결제일이 계약 만기(저장값 = 기간 다음 날)보다 앞이면 회차표에 빠진 회차다.
 * @returns {{no, dueDate, status: '회차표 없음', amount, missing: true}[]}
 */
export const missingRoundsOf = (rounds = [], contractEnd, monthlyRent) => {
  const end = toYmd(contractEnd);
  const last = [...rounds].filter((r) => r?.dueDate).sort((a, b) => num(a.no) - num(b.no)).pop();
  if (!end || !last || !(num(monthlyRent) > 0)) return [];
  const out = [];
  const base = toYmd(last.dueDate);
  for (let k = 1; k <= 120; k += 1) {
    const due = addMonthsYmd(base, k);
    if (due >= end) break;
    out.push({ no: num(last.no) + k, dueDate: due, status: '회차표 없음', fine: 0, amount: num(monthlyRent), missing: true });
  }
  return out;
};

/**
 * @param {object} p
 *   rounds 회차표 회차들, contractEnd 계약 만기(저장값), monthlyRent 월 렌트료(빠진 회차를 채울 금액),
 *   deposit 지금 보증금, takeoverPrice 만기 인수가,
 *   extensions [{months, monthlyFee, takeoverPrice, maintenance}] 연장 견적의 안들,
 *   thirdParty 제3자 인수 여부, successionFee 승계 수수료, repairEstimate 반납 때 예상 수리비(모르면 0)
 * @returns 남은 회차와 세 길의 금액. settle가 +면 고객이 납부할 돈, -면 반환할 돈.
 */
export const compareMaturity = ({ rounds = [], contractEnd = '', monthlyRent = 0, deposit = 0, takeoverPrice = 0, extensions = [], thirdParty = false, successionFee = SUCCESSION_FEE, repairEstimate = 0 } = {}) => {
  const missing = missingRoundsOf(rounds, contractEnd, monthlyRent);
  const remaining = [...remainingRoundsOf(rounds), ...missing];
  const remainingSum = remaining.reduce((s, r) => s + r.amount, 0);
  const all = [...rounds.map((r) => ({ no: num(r.no), dueDate: toYmd(r.dueDate) })), ...missing];
  const lastNo = all.length ? Math.max(...all.map((r) => r.no)) : 0;
  const dep = num(deposit);

  const fee = thirdParty ? num(successionFee) : 0;
  const takeoverPay = num(takeoverPrice) - dep + fee;

  const repair = Math.max(0, num(repairEstimate));
  const depositBack = dep - repair;

  return {
    remaining,
    remainingSum,
    missingCount: missing.length,
    lastNo,
    deposit: dep,
    extension: {
      options: extensions.map((o) => ({ ...o, months: num(o.months), monthlyFee: num(o.monthlyFee), takeoverPrice: num(o.takeoverPrice) })),
      settle: remainingSum
    },
    takeover: { price: num(takeoverPrice), fee, pay: takeoverPay, settle: remainingSum + takeoverPay },
    return: { repair, depositBack, settle: remainingSum - depositBack }
  };
};

const wonText = (n) => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;

/**
 * 비교표의 열(안)과 줄. 한 칸에는 한 가지 내용만 넣는다(대표님 2026-11-17 "한 셀에 여러 내용을 담지 말고 줄을 나눠서").
 * 연장 견적 안이 여럿이면 연장 열이 그만큼 생기고, 인수·반납은 그 뒤 번호를 받는다.
 * 만기 정산은 '마지막 렌트료 / 인수 금액 / 보증금 반환'을 따로 적는다. '납부 금액'처럼 합쳐 쓰면 다른 돈을 또 내는 것처럼 보인다.
 *
 * @param {object} p m(compareMaturity 결과), ext(연장 안 [{months, monthlyFee, takeoverPrice, maintenance, endDate}]),
 *   startDate 연장 시작일, thirdParty 제3자 인수, repairKnown 반납 수리비를 넣었는지,
 *   tax 취득세 계산용 차 정보 {registrationDate, model, cc, newCarPrice, contractEnd, standardValueNow, standardYear}(없으면 줄을 뺀다)
 * @returns {{ cols: {kind: 'ext'|'takeover'|'return', title: string}[], rows: {label: string, section?: 'settle', cells: string[], notes?: string[]}[] }}
 *   notes는 칸 아래, labelNote는 줄 이름 아래에 작게 붙는 설명. 괄호로 덧붙이지 않는다(대표님 2026-11-17)
 */
export const maturityTable = ({ m, ext = [], startDate = '', thirdParty = false, repairKnown = false, tax = null }) => {
  const exts = ext.length ? ext : [null];
  const cols = [
    ...exts.map((o, i) => ({ kind: 'ext', o, title: `${i + 1}안 계약 연장` })),
    { kind: 'takeover', title: `${exts.length + 1}안 인수` },
    { kind: 'return', title: `${exts.length + 2}안 반납` }
  ];
  const row = (label, pick, section) => ({ label, section, cells: cols.map((c) => pick[c.kind](c.o)) });
  const t = m.takeover;
  const takeoverTax = tax ? acquisitionTaxOf({ ...tax, onDate: tax.contractEnd, takeoverPrice: t.price }) : null;
  // 인수 금액(인수가 - 보증금 + 승계 수수료, 음수면 0) + 취득세
  const takeoverTotal = Math.max(0, t.pay) + (takeoverTax ? takeoverTax.tax : 0);
  const rows = [
    row('방법', { ext: (o) => (o ? `${o.months}개월 연장` : '연장 견적 없음'), takeover: () => (thirdParty ? '제3자 인수' : '인수'), return: () => '반납' }),
    row('기간', { ext: (o) => (o ? `${startDate} ~ ${o.endDate}` : '-'), takeover: () => '만기 종료', return: () => '만기 종료' }),
    row('월 렌트료', { ext: (o) => (o ? wonText(o.monthlyFee) : '-'), takeover: () => '없음', return: () => '없음' }),
    row('정비', { ext: (o) => (o ? (o.maintenance ? '포함' : '미포함') : '-'), takeover: () => '없음', return: () => '없음' }),
    // 보증금은 금액을 적고, 어떻게 처리되는지는 아래에 작게(대표님 2026-11-17)
    {
      ...row('보증금', { ext: () => (m.deposit ? wonText(m.deposit) : '없음'), takeover: () => (m.deposit ? wonText(m.deposit) : '없음'), return: () => (m.deposit ? wonText(m.deposit) : '없음') }),
      notes: cols.map((c) => (!m.deposit ? '' : { ext: '연장 계약으로 승계', takeover: '인수가와 상계', return: '반납 후 반환' }[c.kind]))
    },
    // 괄호로 덧붙이던 설명은 칸 아래에 작게(notes)
    {
      ...row('인수가', { ext: (o) => (o?.takeoverPrice > 0 ? wonText(o.takeoverPrice) : '없음'), takeover: () => wonText(t.price), return: () => '없음' }),
      notes: cols.map((c) => (c.kind === 'ext' && c.o?.takeoverPrice > 0 ? '연장 만기 때' : ''))
    },
    // 인수자가 이전등록 때 구청에 내는 취득세(예상, shared/usedCarTax.js).
    // 지금 돈이 나가는 2안 인수만 계산한다. 1안 연장은 당장 내는 돈이 아니라 뺀다(대표님 2026-11-18)
    ...(tax ? [{
      label: '인수 시 취득세',
      labelNote: '구청 납부 · 예상',
      cells: cols.map((c) => (c.kind !== 'takeover' ? '없음' : takeoverTax ? wonText(takeoverTax.tax) : '계산 불가')),
      // 구청 과표율(경과연수별 잔가율)을 함께 적는다(대표님 2026-11-17). 두 줄: 연도·과표율 / 과표
      notes: cols.map((c) => (c.kind === 'takeover' && takeoverTax ? `${takeoverTax.year}년 ${takeoverTax.years}년차 과표율 ${(takeoverTax.rate * 100).toFixed(1)}%\n${takeoverTax.basis} 과표 ${wonText(takeoverTax.taxBase)}${takeoverTax.light ? ' · 경차 감면' : ''}` : ''))
    }] : []),
    ...(thirdParty ? [row('승계 수수료', { ext: () => '없음', takeover: () => wonText(t.fee), return: () => '없음' })] : []),
    // 반납 수리비 줄은 표에서 뺀다(대표님 2026-11-18). 수리비 공제는 비고에 적는다
    { ...row(m.remaining.length > 1 ? '잔여 렌트료' : '마지막 렌트료', {
      ext: () => (m.remainingSum ? wonText(m.remainingSum) : '없음'),
      takeover: () => (m.remainingSum ? wonText(m.remainingSum) : '없음'),
      return: () => (m.remainingSum ? wonText(m.remainingSum) : '없음')
    }, 'settle'), labelNote: m.remaining.length > 1 ? `${m.remaining.length}회` : '' },
    row('인수 금액', { ext: () => '없음', takeover: () => (t.pay >= 0 ? wonText(t.pay) : '없음'), return: () => '없음' }, 'settle'),
    row('보증금 반환', { ext: () => '없음', takeover: () => (t.pay < 0 ? wonText(-t.pay) : '없음'), return: () => wonText(m.return.depositBack) }, 'settle'),
    // 결론: 이것만 봐도 얼마를 내는지 알 수 있게(대표님 2026-11-18). 마지막 렌트료는 세 안이 같으니 따로 둔다
    //   1안 연장 월 렌트료 · 2안 인수 금액 + 취득세(+ 승계 수수료) · 3안 0원
    {
      label: '만기 시 청구 비용',
      labelNote: m.remainingSum ? '마지막 렌트료 별도' : '',
      section: 'total',
      cells: cols.map((c) => (c.kind === 'ext' ? (c.o ? wonText(c.o.monthlyFee) : '-') : c.kind === 'takeover' ? wonText(takeoverTotal) : '0원')),
      notes: cols.map((c) => {
        if (c.kind === 'ext') return c.o ? `월 렌트료 · ${c.o.months}개월` : '';
        if (c.kind === 'takeover') {
          const parts = [`인수 금액 ${wonText(Math.max(0, t.pay))}`, ...(takeoverTax ? [`취득세 ${wonText(takeoverTax.tax)}`] : [])];
          return `${parts.join(' + ')}${t.pay < 0 ? `\n보증금 ${wonText(-t.pay)} 반환` : ''}`;
        }
        return m.return.depositBack > 0 ? `보증금 ${wonText(m.return.depositBack)} 반환` : '';
      })
    }
  ];
  return { cols, rows };
};
