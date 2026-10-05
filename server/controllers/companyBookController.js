import CompanyTransaction from '../models/CompanyTransaction.js';
import { COMPANY_ACCOUNTS, isCompanyAccount } from '../../shared/companyAccounts.js';
import { parseCompanyBookWorkbook } from '../utils/companyBookImport.js';
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
    const { rows, skipped, sheets } = parseCompanyBookWorkbook(req.file.buffer);
    if (!rows.length) {
      return res.status(400).json({ success: false, message: '읽을 줄이 없습니다. "렌트베네핏 입출금 리스트" 엑셀(고정비용·부대비용·기타비용 시트)이 맞는지 확인해 주세요.' });
    }

    const fileSheets = [...new Set(rows.map((r) => r.sourceSheet))];
    const existing = await CompanyTransaction.find({ source: 'excel' }).select('importKey account accountEdited sourceSheet description amount date direction').lean();
    const byKey = new Map(existing.map((e) => [e.importKey, e]));
    const fileKeys = new Set(rows.map((r) => r.importKey));

    const added = rows.filter((r) => !byKey.has(r.importKey));
    const kept = rows.filter((r) => byKey.has(r.importKey));
    const removed = existing.filter((e) => fileSheets.includes(e.sourceSheet) && !fileKeys.has(e.importKey));

    const summary = {
      sheets,
      total: rows.length,
      added: added.length,
      kept: kept.length,
      removed: removed.length,
      excluded: rows.filter((r) => r.excluded).length,
      skipped,
      addedSample: added.slice(0, 20),
      removedSample: removed.slice(0, 20)
    };

    if (String(req.body?.apply || req.query?.apply) !== '1') {
      return res.json({ success: true, preview: true, ...summary });
    }

    const now = { createdBy: req.user?._id, updatedBy: req.user?._id };
    if (added.length) {
      await CompanyTransaction.insertMany(added.map((r) => ({ ...r, source: 'excel', ...now })), { ordered: false });
    }
    if (kept.length) {
      await CompanyTransaction.bulkWrite(kept.map((r) => {
        const prev = byKey.get(r.importKey);
        const set = { memo: r.memo, excluded: !!r.excluded, excludeReason: r.excludeReason || '', sourceRow: r.sourceRow, sourceColumn: r.sourceColumn, updatedBy: req.user?._id };
        if (!prev.accountEdited) set.account = r.account;
        return { updateOne: { filter: { importKey: r.importKey }, update: { $set: set } } };
      }));
    }
    if (removed.length) {
      await CompanyTransaction.deleteMany({ source: 'excel', importKey: { $in: removed.map((r) => r.importKey) } });
    }

    logActivity({
      req, dept: '재무부', action: ACTIONS.COMPANY_BOOK_EDIT,
      summary: `회사 장부 엑셀 반영: 새 줄 ${added.length}건, 지운 줄 ${removed.length}건`,
      meta: { added: added.length, kept: kept.length, removed: removed.length }
    });
    res.json({ success: true, preview: false, ...summary, message: `엑셀을 반영했습니다. 새 줄 ${added.length}건, 그대로 ${kept.length}건, 엑셀에서 사라져 지운 줄 ${removed.length}건.` });
  } catch (error) {
    res.status(500).json({ success: false, message: `엑셀을 읽지 못했습니다: ${error.message}` });
  }
};
