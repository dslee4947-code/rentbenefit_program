import CompanyTransaction from '../models/CompanyTransaction.js';
import VehicleLedger from '../models/VehicleLedger.js';
import { depreciationOf, DEPRECIATION_RULE } from '../../shared/vehicleDepreciation.js';
import { COMPANY_ACCOUNTS, isCompanyAccount, accountOf } from '../../shared/companyAccounts.js';
import { applyCompanyBookExcel } from '../utils/companyBookApply.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';

/**
 * 회사 장부 (관리 > 회사 장부). 월급·임대료·대출이자·대표 차입금처럼 차 한 대에 속하지 않는 회사의 돈.
 * 급여가 사람별로 보이므로 라우트에서 관리자만 열어 둔다.
 */

const EDITABLE = ['date', 'direction', 'amount', 'account', 'description', 'memo', 'excluded', 'excludeReason'];

/** 화면에서 보낸 값을 장부 줄로 다듬는다. 틀린 값이면 오류 문구를 던진다. */
const sanitize = (body, { partial = false } = {}) => {
  const out = {};
  for (const key of EDITABLE) if (body[key] !== undefined) out[key] = body[key];
  if (out.date !== undefined) {
    const d = new Date(out.date);
    if (Number.isNaN(d.getTime())) throw new Error('날짜를 확인해 주세요.');
    out.date = d;
  }
  if (out.amount !== undefined) {
    const n = Number(out.amount);
    if (!(n > 0)) throw new Error('금액은 0보다 커야 합니다.');
    out.amount = n;
  }
  if (out.direction !== undefined && !['출금', '입금'].includes(out.direction)) throw new Error('입금/출금을 골라 주세요.');
  if (out.account !== undefined && !isCompanyAccount(out.account)) throw new Error('계정을 다시 골라 주세요.');
  if (!partial) {
    for (const key of ['date', 'direction', 'amount', 'account']) {
      if (out[key] === undefined) throw new Error('날짜·입출금·금액·계정은 꼭 적어야 합니다.');
    }
  }
  return out;
};

/**
 * @route GET /api/company-book/transactions?year=2025&account=salary&q=급여
 * year를 비우면 전체. 합계에서 뺀 줄(excluded)도 같이 준다(화면에서 흐리게 보여 준다).
 */
export const listTransactions = async (req, res) => {
  try {
    const { year, account, section, q } = req.query;
    const filter = {};
    if (year && /^\d{4}$/.test(year)) {
      filter.date = { $gte: new Date(Date.UTC(+year, 0, 1) - 9 * 3600000), $lt: new Date(Date.UTC(+year + 1, 0, 1) - 9 * 3600000) };
    }
    if (account) filter.account = account;
    else if (section) filter.account = { $in: COMPANY_ACCOUNTS.filter((a) => a.section === section).map((a) => a.key) };
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ description: rx }, { memo: rx }, { sourceColumn: rx }];
    }
    const items = await CompanyTransaction.find(filter).sort({ date: -1, _id: -1 }).lean();
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route GET /api/company-book/summary
 * 연·월·계정·입출금별 합계. 화면이 이걸로 연도별 표와 월별 표를 만든다. 합계에서 뺀 줄은 넣지 않는다.
 * 월은 한국 날짜 기준으로 나눈다(엑셀 날짜는 그날 0시 UTC로 들어 있어 어느 쪽이든 같은 날이다).
 */
export const getSummary = async (req, res) => {
  try {
    const rows = await CompanyTransaction.aggregate([
      { $match: { excluded: { $ne: true } } },
      { $addFields: { local: { $dateToParts: { date: '$date', timezone: 'Asia/Seoul' } } } },
      {
        $group: {
          _id: { year: '$local.year', month: '$local.month', account: '$account', direction: '$direction' },
          amount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);
    const first = await CompanyTransaction.findOne().sort({ date: 1 }).select('date').lean();
    const last = await CompanyTransaction.findOne().sort({ date: -1 }).select('date').lean();
    const lastImport = await CompanyTransaction.findOne({ source: 'excel' }).sort({ updatedAt: -1 }).select('updatedAt').lean();
    res.json({
      success: true,
      rows: rows.map((r) => ({ ...r._id, amount: r.amount, count: r.count })),
      range: { from: first?.date || null, to: last?.date || null },
      lastImportAt: lastImport?.updatedAt || null
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route GET /api/company-book/depreciation
 * 운용 중인 차마다 감가상각(관리용). 계산 규칙은 shared/vehicleDepreciation.js.
 * 원장 구입 줄이 없거나 시작일이 없어 못 센 차는 skipped로 따로 보낸다.
 */
export const getDepreciation = async (req, res) => {
  try {
    const ledgers = await VehicleLedger.find({ status: '운용중' })
      .select('ledgerNo ledgerType header terms contractPeriods entries.side entries.category entries.amount entries.date')
      .lean();
    const asOf = new Date();
    const rows = [];
    const skipped = [];
    for (const l of ledgers) {
      const d = depreciationOf(l, asOf);
      const base = {
        id: l._id,
        ledgerNo: l.ledgerNo,
        customerName: l.header?.customerName || '',
        car: [l.header?.carModel, l.header?.plateNo].filter(Boolean).join(' ')
      };
      if (d.skip) skipped.push({ ...base, reason: d.skip });
      else rows.push({ ...base, ...d });
    }
    res.json({ success: true, asOf, rule: DEPRECIATION_RULE, rows, skipped });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 돈 흐름도의 비용 묶음. 원장 분류와 회사 장부 계정을 대표님이 보시는 이름 8개로 모은다. 여기 없는 것은 '기타 운영비'
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
const flowGroupOf = (side, key) => FLOW_COST_GROUPS.find(([, g]) => (g[side] || []).includes(key))?.[0] || OTHER_COST;
const SKIP_COST = ['할부금', '할부이자', '차량가', '계약금', '등록비용', '제세공과', '대출금', '보증금', '환급'];

/**
 * @route GET /api/company-book/money-flow
 * "렌트베네핏은 이렇게 벌고 쓴다" 흐름도 자료. 차량 손익 원장(렌트료·단기 매출·차량 운영비)과 회사 장부(판관비·이자)를 기간별로 더한다(만 원 아님, 원).
 * 기간: 연도마다 + 최근 12개월(이번 달 포함). 월은 한국 날짜 기준.
 * 차 구입·할부 상환·인수·매각 대금은 매출·비용이 아니라 흐름 밖 참고 값으로 따로 보낸다.
 * 원장의 '이자' 줄(갑지 이자)은 회사 장부 대출이자와 같은 돈이라 넣지 않는다(이자 두 번 금지, 2026-10-28).
 */
export const getMoneyFlow = async (req, res) => {
  try {
    const monthOf = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 7);
    const now = monthOf(new Date());
    const [ny, nm] = now.split('-').map(Number);
    const from12 = `${nm === 12 ? ny : ny - 1}-${String(nm === 12 ? 1 : nm + 1).padStart(2, '0')}`;
    const buckets = new Map();
    const bucketsOf = (m) => {
      const keys = [m.slice(0, 4)];
      if (m >= from12 && m <= now) keys.push('last12');
      return keys.map((k) => {
        if (!buckets.has(k)) buckets.set(k, { income: {}, costs: {}, refund: 0, interest: 0, carBuy: 0, loanRepay: 0, sale: 0 });
        return buckets.get(k);
      });
    };
    const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };

    const ledgers = await VehicleLedger.find({})
      .select('ledgerType entries.side entries.category entries.amount entries.date entries.label')
      .lean();
    for (const l of ledgers) {
      for (const e of l.entries || []) {
        if (!e.date) continue;
        const m = monthOf(e.date);
        if (m < '2020-01' || m > now) continue; // 날짜를 잘못 적은 줄(1902년·2505년)은 뺀다
        const a = Number(e.amount) || 0;
        for (const b of bucketsOf(m)) {
          if (e.side === '입금') {
            if (l.ledgerType === '장기렌트' && e.category === '렌트료') add(b.income, '장기 렌트료', a);
            else if (l.ledgerType === '단기렌트' && !['보증금', '대출금', '인수가', '차량가'].includes(e.category)) add(b.income, '단기·사고대차', a);
            else if (['수수료', '캐시백'].includes(e.category) && l.ledgerType === '장기렌트') add(b.income, '판매수수료·캐시백', a);
            else if (e.category === '인수가' || /판매\s*(금|대금)|매각/.test(e.label || '')) b.sale += a;
          } else if (['할부금', '할부이자'].includes(e.category)) {
            if (e.label !== '이자') b.loanRepay += a;
          } else if (['차량가', '계약금', '등록비용', '제세공과'].includes(e.category)) b.carBuy += a;
          else if (e.category === '환급') b.refund -= a; // 환급은 지출 쪽에 마이너스로 적혀 있다
          else if (!SKIP_COST.includes(e.category)) add(b.costs, flowGroupOf('ledger', e.category), a);
        }
      }
    }

    const txs = await CompanyTransaction.find({ excluded: { $ne: true } }).select('date direction amount account').lean();
    for (const t of txs) {
      const m = monthOf(t.date);
      if (m > now) continue;
      const section = accountOf(t.account).section;
      const v = t.direction === '출금' ? t.amount : -t.amount;
      for (const b of bucketsOf(m)) {
        if (section === 'opex') add(b.costs, flowGroupOf('book', t.account), v);
        if (section === 'finance') b.interest += v;
      }
    }

    // 환급보다 되돌려 준 돈이 많은 해(2021·2022)는 영업외 수익이 아니라 운영비로 본다
    for (const b of buckets.values()) if (b.refund < 0) { add(b.costs, OTHER_COST, -b.refund); b.refund = 0; }
    const order = [...FLOW_COST_GROUPS.map(([n]) => n), OTHER_COST];
    const periods = [...buckets.entries()]
      .sort(([a], [b]) => (a === 'last12' ? 1 : b === 'last12' ? -1 : a.localeCompare(b)))
      .map(([key, b]) => ({
        key,
        label: key === 'last12' ? '최근 12개월' : `${key}년${key === now.slice(0, 4) ? ` (${Number(now.slice(5))}월까지)` : ''}`,
        range: key === 'last12' ? `${from12} ~ ${now}` : key,
        income: ['장기 렌트료', '단기·사고대차', '판매수수료·캐시백'].map((n) => [n, Math.round(b.income[n] || 0)]).filter(([, v]) => v > 0),
        costs: order.map((n) => [n, Math.round(b.costs[n] || 0)]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]),
        refund: Math.round(b.refund),
        interest: Math.round(b.interest),
        carBuy: Math.round(b.carBuy),
        loanRepay: Math.round(b.loanRepay),
        sale: Math.round(b.sale)
      }))
      .filter((p) => p.income.length);
    res.json({ success: true, periods });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** @route POST /api/company-book/transactions */
export const createTransaction = async (req, res) => {
  try {
    const data = sanitize(req.body);
    const tx = await CompanyTransaction.create({ ...data, source: 'manual', createdBy: req.user?._id, updatedBy: req.user?._id });
    logActivity({ req, dept: '재무부', action: ACTIONS.COMPANY_BOOK_EDIT, target: { model: 'CompanyTransaction', id: tx._id }, summary: `회사 장부 줄 추가: ${tx.description || ''} ${tx.amount.toLocaleString()}원`.trim() });
    res.status(201).json({ success: true, item: tx });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/** @route PUT /api/company-book/transactions/:id */
export const updateTransaction = async (req, res) => {
  try {
    const tx = await CompanyTransaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: '장부 줄을 찾을 수 없습니다.' });
    const data = sanitize(req.body, { partial: true });
    // 엑셀에서 온 줄의 계정을 사람이 바꾸면, 엑셀을 다시 올려도 그 계정을 지킨다
    if (data.account && data.account !== tx.account && tx.source === 'excel') tx.accountEdited = true;
    Object.assign(tx, data, { updatedBy: req.user?._id });
    await tx.save();
    logActivity({ req, dept: '재무부', action: ACTIONS.COMPANY_BOOK_EDIT, target: { model: 'CompanyTransaction', id: tx._id }, summary: `회사 장부 줄 수정: ${tx.description || ''}`.trim() });
    res.json({ success: true, item: tx });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/** @route DELETE /api/company-book/transactions/:id */
export const deleteTransaction = async (req, res) => {
  try {
    const tx = await CompanyTransaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: '장부 줄을 찾을 수 없습니다.' });
    // 엑셀 줄을 지우면 다음에 엑셀을 올릴 때 다시 들어온다. 그래서 엑셀 줄은 지우지 않고 '합계에서 빼기'로 안내한다
    if (tx.source === 'excel') {
      return res.status(400).json({ success: false, message: '엑셀에서 온 줄은 지울 수 없습니다. 합계에서 빼려면 "합계에서 빼기"를 쓰거나 엑셀에서 지운 뒤 다시 올려 주세요.' });
    }
    await tx.deleteOne();
    logActivity({ req, dept: '재무부', action: ACTIONS.COMPANY_BOOK_EDIT, target: { model: 'CompanyTransaction', id: tx._id }, summary: `회사 장부 줄 삭제: ${tx.description || ''} ${tx.amount.toLocaleString()}원`.trim() });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route POST /api/company-book/import (file, apply=1)
 *
 * 자금팀 엑셀 "렌트베네핏 입출금 리스트"를 올린다. apply가 없으면 바뀔 내용만 보여 주고(미리보기), apply=1이면 반영한다.
 * - 새 줄: 넣는다
 * - 이미 있는 줄(같은 importKey): 메모·합계 제외 여부·계정을 엑셀 기준으로 맞춘다. 사람이 계정을 바꾼 줄은 계정을 그대로 둔다
 * - 엑셀에서 사라진 줄: 지운다. 엑셀에서 금액·날짜를 고치면 열쇠가 바뀌어 옛 줄이 남기 때문이다.
 *   올린 파일에 있는 시트의 줄만 지운다(시트 한 장만 올려도 다른 시트 줄이 사라지지 않게).
 */
export const importExcel = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '엑셀 파일을 골라 주세요.' });
    // 반영 규칙은 OneDrive 자동 갱신(utils/excelAutoSync.js)과 같은 함수를 쓴다
    const apply = String(req.body?.apply || req.query?.apply) === '1';
    const summary = await applyCompanyBookExcel(req.file.buffer, { apply, userId: req.user?._id });
    if (summary.empty) {
      return res.status(400).json({ success: false, message: '읽을 줄이 없습니다. "렌트베네핏 입출금 리스트" 엑셀(고정비용·부대비용·기타비용 시트)이 맞는지 확인해 주세요.' });
    }
    if (!apply) return res.json({ success: true, preview: true, ...summary });

    logActivity({
      req, dept: '재무부', action: ACTIONS.COMPANY_BOOK_EDIT,
      summary: `회사 장부 엑셀 반영: 새 줄 ${summary.added}건, 지운 줄 ${summary.removed}건`,
      meta: { added: summary.added, kept: summary.kept, removed: summary.removed }
    });
    res.json({ success: true, preview: false, ...summary, message: `엑셀을 반영했습니다. 새 줄 ${summary.added}건, 그대로 ${summary.kept}건, 엑셀에서 사라져 지운 줄 ${summary.removed}건.` });
  } catch (error) {
    res.status(500).json({ success: false, message: `엑셀을 읽지 못했습니다: ${error.message}` });
  }
};
