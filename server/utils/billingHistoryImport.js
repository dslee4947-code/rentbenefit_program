import XLSX from 'xlsx';
import BillingSchedule from '../models/BillingSchedule.js';
import Contract from '../models/Contract.js';

// 엑셀로 관리하던 과거 청구 내역을 회차표에 채워 넣는다.
//
// 지금까지 청구서를 엑셀 '월대여료' 시트로 만들어 오셨다. 그 시트의 회차 번호가
// 시스템의 회차 번호와 같아서(1회차 = 렌트료 개시일), 회차로 짝을 지어 금액만 옮기면 된다.
//
// 이미 발행한 회차는 건드리지 않는다. 보낸 청구서 금액이 나중에 바뀌면 안 되기 때문이다.

/** 열 제목을 비교하기 좋게 다듬는다. 띄어쓰기·괄호가 제각각이다. */
const norm = (v) => String(v ?? '').replace(/[\s()·/_-]/g, '').toLowerCase();

/** '₩ 190,000', '-', 빈 칸을 숫자로 바꾼다. '-'는 0으로 본다. */
const toNumber = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const text = String(v).trim();
  if (!text || text === '-' || text === '₩') return null;
  const n = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// 우리가 알아보는 열 이름. 사장님 시트 제목을 그대로 넣었다.
const COLUMN_KEYS = {
  회차: 'roundNo',
  날짜: 'dueDate',
  월렌트료: 'monthlyRent',
  전월미결제금액: 'prevUnpaid',
  전월미결제: 'prevUnpaid',
  전월초과입금액: 'prevOverpaid',
  이자: 'interest',
  연체이자: 'interest',
  범칙금: 'fine',
  범칙금과태료: 'fine',
  과태료: 'fine',
  정기점검: 'maintenance',
  정비: 'maintenance',
  기타청구: 'other',
  기타: 'other',
  기타항목명: 'otherLabel',
  계약번호: 'contractNo'
};

/**
 * 시트에서 열 위치를 찾는다.
 *
 * 사장님 시트는 '범칙금' 아래에 개별 금액 칸이 제목 없이 이어진다.
 * 그래서 범칙금 열 다음의 제목 없는 칸들은 모두 범칙금 상세로 본다.
 *
 * @param {Array} header 제목 줄
 * @returns {{map: object, fineDetailCols: number[]}} 열 위치
 */
const readHeader = (header) => {
  const map = {};
  const fineDetailCols = [];
  let fineAt = -1;

  header.forEach((h, i) => {
    const key = COLUMN_KEYS[norm(h)];
    if (!key) return;
    if (map[key] === undefined) map[key] = i;
    if (key === 'fine' && fineAt === -1) fineAt = i;
  });

  if (fineAt !== -1) {
    const stopAt = Object.entries(map)
      .filter(([, i]) => i > fineAt)
      .reduce((min, [, i]) => Math.min(min, i), header.length);
    for (let i = fineAt + 1; i < stopAt; i += 1) {
      if (!norm(header[i])) fineDetailCols.push(i);
    }
  }
  return { map, fineDetailCols };
};

/**
 * 엑셀 파일을 읽어 계약별 회차 금액으로 정리한다.
 *
 * @param {Buffer} fileBuffer 엑셀 파일
 * @param {string} [defaultContractNo] 시트에 계약번호 열이 없을 때 쓸 계약번호
 * @returns {{rows: object[], warnings: string[]}} 읽은 줄과 확인할 점
 */
export const parseHistoryWorkbook = (fileBuffer, defaultContractNo) => {
  const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  const rows = [];
  const warnings = [];

  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false });
    if (grid.length < 2) continue;

    // 제목 줄을 찾는다. 첫 줄이 숫자만 있는 시트가 있어 위에서 5줄까지 살핀다.
    let headerAt = -1;
    for (let i = 0; i < Math.min(5, grid.length); i += 1) {
      if (grid[i].some((c) => norm(c) === '회차') && grid[i].some((c) => norm(c) === '월렌트료')) {
        headerAt = i;
        break;
      }
    }
    if (headerAt === -1) continue;

    const { map, fineDetailCols } = readHeader(grid[headerAt]);
    if (map.roundNo === undefined) continue;

    for (let i = headerAt + 1; i < grid.length; i += 1) {
      const row = grid[i] || [];
      const roundNo = toNumber(row[map.roundNo]);
      if (!roundNo) continue;

      const contractNo = map.contractNo !== undefined
        ? String(row[map.contractNo] ?? '').trim() || defaultContractNo
        : defaultContractNo;
      if (!contractNo) {
        warnings.push(`${sheetName} ${i + 1}행: 계약번호를 알 수 없어 건너뛰었습니다.`);
        continue;
      }

      const fineDetails = fineDetailCols
        .map((c) => toNumber(row[c]))
        .filter((n) => n !== null && n !== 0);

      rows.push({
        sheetName,
        excelRow: i + 1,
        contractNo,
        roundNo,
        prevUnpaid: map.prevUnpaid !== undefined ? toNumber(row[map.prevUnpaid]) : null,
        prevOverpaid: map.prevOverpaid !== undefined ? toNumber(row[map.prevOverpaid]) : null,
        interest: map.interest !== undefined ? toNumber(row[map.interest]) : null,
        fine: map.fine !== undefined ? toNumber(row[map.fine]) : null,
        fineDetails,
        maintenance: map.maintenance !== undefined ? toNumber(row[map.maintenance]) : null,
        other: map.other !== undefined ? toNumber(row[map.other]) : null,
        otherLabel: map.otherLabel !== undefined ? String(row[map.otherLabel] ?? '').trim() : ''
      });
    }
  }

  return { rows, warnings };
};

/**
 * 읽은 줄을 회차표에 넣는다.
 *
 * @param {object[]} rows parseHistoryWorkbook이 읽은 줄
 * @param {boolean} dryRun true면 저장하지 않고 무엇이 바뀔지만 돌려준다
 * @returns {Promise<object>} 처리 결과
 */
export const applyHistoryRows = async (rows, dryRun = false) => {
  const byContract = new Map();
  for (const r of rows) {
    if (!byContract.has(r.contractNo)) byContract.set(r.contractNo, []);
    byContract.get(r.contractNo).push(r);
  }

  const applied = [];
  const skipped = [];
  const notFound = [];

  for (const [contractNo, list] of byContract) {
    const contract = await Contract.findOne({ contractNo }).select('_id leaseCompany').lean();
    if (!contract) { notFound.push(`계약번호 ${contractNo}를 찾을 수 없습니다. (${list.length}줄)`); continue; }

    const schedule = await BillingSchedule.findOne({ contract: contract._id });
    if (!schedule) { notFound.push(`${contractNo}: 회차표가 없습니다. (${list.length}줄)`); continue; }

    for (const r of list) {
      const round = schedule.rounds.find((x) => x.no === r.roundNo);
      if (!round) { skipped.push(`${contractNo} ${r.roundNo}회차: 회차표에 없는 회차입니다.`); continue; }

      // 이미 발행한 회차는 그대로 둔다. 보낸 청구서 금액이 바뀌면 안 된다.
      if (round.issuedAt) { skipped.push(`${contractNo} ${r.roundNo}회차: 이미 발행되어 건너뛰었습니다.`); continue; }

      const before = round.total;
      if (r.prevUnpaid !== null) round.prevUnpaid = r.prevUnpaid;
      if (r.prevOverpaid !== null) round.prevOverpaid = r.prevOverpaid;
      if (r.interest !== null) round.interest = r.interest;
      if (r.fine !== null) round.fine = r.fine;
      if (r.maintenance !== null) round.maintenance = r.maintenance;
      if (r.other !== null) {
        round.other = r.other;
        // 항목명이 있으면 청구서에 그 이름이 찍히도록 남긴다
        round.extras = r.other ? [{ label: r.otherLabel || '기타 청구', amount: r.other }] : [];
      }

      // 개별 범칙금 금액을 적어 두면 청구서 명세에 줄별로 찍힌다
      if (r.fineDetails.length > 1) {
        round.note = `범칙금 내역 ${r.fineDetails.map((n) => n.toLocaleString()).join(' / ')}`;
      }

      round.total = (round.monthlyRent || 0) + (round.prevUnpaid || 0) + (round.interest || 0)
        + (round.fine || 0) + (round.maintenance || 0) + (round.other || 0) - (round.prevOverpaid || 0);

      applied.push({
        contractNo,
        partyName: contract.leaseCompany,
        roundNo: r.roundNo,
        fine: round.fine,
        other: round.other,
        maintenance: round.maintenance,
        interest: round.interest,
        before,
        after: round.total
      });
    }

    if (!dryRun) await schedule.save();
  }

  return { applied, skipped, notFound };
};
