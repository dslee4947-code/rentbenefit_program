import CompanyTransaction from '../models/CompanyTransaction.js';
import { parseCompanyBookWorkbook } from './companyBookImport.js';

/**
 * "렌트베네핏 입출금 리스트" 엑셀을 회사 장부에 맞춘다.
 *
 * 화면의 엑셀 올리기(companyBookController.importExcel)와 OneDrive 자동 갱신(excelAutoSync)이 같이 쓴다.
 * - 줄마다 importKey가 있어 같은 줄은 두 번 들어가지 않는다.
 * - 엑셀에서 사라진 줄은 지운다(그 시트가 이번 파일에 있을 때만).
 * - 화면에서 사람이 바꾼 계정(accountEdited)은 덮어쓰지 않는다. 화면에서 직접 적은 줄(source='manual')은 건드리지 않는다.
 *
 * @param {Buffer} buffer 엑셀 파일
 * @param {{apply?: boolean, userId?: any}} [options] apply가 false면 바뀔 내용만 계산한다
 * @returns {Promise<object>} 요약. rows가 하나도 없으면 empty=true
 */
export const applyCompanyBookExcel = async (buffer, { apply = false, userId } = {}) => {
  const { rows, skipped, sheets } = parseCompanyBookWorkbook(buffer);
  if (!rows.length) return { empty: true, sheets, skipped, total: 0, added: 0, kept: 0, removed: 0, excluded: 0 };

  const fileSheets = [...new Set(rows.map((r) => r.sourceSheet))];
  const existing = await CompanyTransaction.find({ source: 'excel' })
    .select('importKey account accountEdited sourceSheet description amount date direction').lean();
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
  if (!apply) return summary;

  const now = { createdBy: userId, updatedBy: userId };
  if (added.length) {
    await CompanyTransaction.insertMany(added.map((r) => ({ ...r, source: 'excel', ...now })), { ordered: false });
  }
  if (kept.length) {
    await CompanyTransaction.bulkWrite(kept.map((r) => {
      const prev = byKey.get(r.importKey);
      const set = { memo: r.memo, excluded: !!r.excluded, excludeReason: r.excludeReason || '', sourceRow: r.sourceRow, sourceColumn: r.sourceColumn, updatedBy: userId };
      if (!prev.accountEdited) set.account = r.account;
      return { updateOne: { filter: { importKey: r.importKey }, update: { $set: set } } };
    }));
  }
  if (removed.length) {
    await CompanyTransaction.deleteMany({ source: 'excel', importKey: { $in: removed.map((r) => r.importKey) } });
  }
  return summary;
};
