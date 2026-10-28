import XLSX from 'xlsx';
import VehicleLedger, { summarizeLedger, pickLedgerCategory, parseLoanRound, saleEntryOf, hasSaleEntry } from '../models/VehicleLedger.js';
import Vehicle from '../models/Vehicle.js';
import Contract from '../models/Contract.js';
import { excelCellDate } from './excelDate.js';

/**
 * 자금팀 정산 리스트 엑셀(장기렌트 / 사고대차 / 판매완료)로 차량 손익 원장(갑지)을 갱신한다.
 *
 * 엑셀이 원장 입출금의 원본이다. 직원은 OneDrive의 엑셀만 고치고, 프로그램은 그것을 받아 온다
 * (utils/excelAutoSync.js가 10분마다 확인해 부른다. 2026-10-18 대표님 결정).
 *
 * 규칙은 2026-09-29 이관 스크립트(migrations/2026-09-29_update_ledgers_from_settlement_lists.js)와 같다.
 * - 갑지가 이미 있으면 지우지 않고, 입출금 줄과 상단 정보만 엑셀 내용으로 바꾼다.
 *   차량·계약 연결, 계약 구간, 만기 처리, 수익성 검토 메모는 사람이 앱에서 정리한 것이라 그대로 둔다.
 * - 같은 이름 시트가 판매완료 파일과 다른 파일에 함께 있으면 차량번호가 다른 별개의 차다. 판매완료 쪽은 "이름_1".
 * - 같은 이름인데 차량번호가 다르면 덮어쓰지 않고 건너뛴다.
 * - 옮긴 줄로 다시 계산한 집계가 시트 집계와 다르면 검산 불일치로 알린다(그래도 엑셀 내용대로 넣는다).
 *
 * 차량 시트 구조: 3~6행 상단 정보, 9~11행 집계, 14행부터 3개 블록(회사출금 / 고객입금 / 기타).
 */

export const LEDGER_FILE_KINDS = ['장기', '단기', '완료'];

// 차량 시트가 아닌 것들 (목록·백업·양식·집계표)
const NON_VEHICLE_SHEETS = new Set([
  '갑지_Backpu (원본)', '계약금', '장기렌트_갑지', '양식', '신동호',
  '갑지_DB', '사고대차_갑지',
  '판매완료 결산_DB', '판매완료_갑지'
]);

const BLOCKS = [
  { startCol: 1, group: '회사출금', side: '지출' },
  { startCol: 6, group: '고객입금', side: '입금' },
  { startCol: 11, group: '기타', side: '입금' }
];

/**
 * 대표님이 따로 확인해 준 사실. 엑셀보다 이 값이 맞다.
 *   K9-001 48회차: 2026-03-25 납부 완료 후 재계약 (2026-09-29 확인)
 */
const OVERRIDES = {
  'K9-001': (entries) => {
    const r48 = entries.find((e) => e.category === '렌트료' && e.round === 48 && (e.periodSeq || 1) === 1);
    if (r48) r48.date = new Date('2026-03-25T00:00:00.000Z');
  }
};

// 한 번 "_판매완료"로 만들었던 이름을 "_1"로 바꾼다 (2026-09-29 첫 실행 때 만든 이름)
const RENAMES = {
  'Ray-054_판매완료': 'Ray-054_1',
  'Ray-055_판매완료': 'Ray-055_1',
  'Sorento-001_판매완료': 'Sorento-001_1'
};

// 줄 열쇠(source + category + round)가 자동 연동과 맞아야 중복이 안 생긴다.
const pickSource = (category, round, label = '') => {
  if (category === '렌트료' && round) return 'billing';
  // 앱이 만든 "할부금 n회차"만 자동 연동 줄이다. 엑셀의 "메리츠12차 상환" 같은 줄은 사람이 적은 줄로 둔다.
  if (category === '할부금' && round && /^할부금\s*\d+\s*회차$/.test(label)) return 'loan';
  if (category === '보험' && round === 1) return 'vehicle';
  if (['차량가', '보증금', '선납금', '인수가'].includes(category)) return 'contract';
  return 'manual';
};

const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[,\s원]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const toDate = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return excelCellDate(v);
  if (typeof v === 'string') {
    const d = new Date(v.trim());
    if (!Number.isNaN(d.getTime()) && /\d{4}/.test(v)) return d;
  }
  return undefined;
};

const text = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? excelCellDate(v).toISOString().slice(0, 10) : String(v).trim();
  return s === '-' ? '' : s;
};

const cell = (rows, r, c) => (rows[r] ? rows[r][c] : undefined);
const plateKey = (p) => String(p || '').replace(/\s/g, '');

// 차량 한 대의 갑지가 아닌 회사 공통 비용 시트
const COMMON_SHEET = '공통지출내역';

/**
 * 공통지출내역 시트. 6행이 4개 블록의 제목이고 7행부터 [내용, 금액, 은행, 날짜]가 이어진다. 전부 회사가 낸 돈이다.
 * 3행 D열의 회사출금액 합계로 검산한다.
 */
const parseCommonSheet = (rows, fileName) => {
  const entries = [];
  [1, 6, 11, 16].forEach((startCol) => {
    const title = text(cell(rows, 5, startCol));
    for (let r = 6; r < rows.length; r += 1) {
      const amount = toNumber(cell(rows, r, startCol + 1));
      if (!amount) continue;
      // 내용이 비어 있으면(같은 항목이 이어지는 줄) 블록 제목을 쓴다
      const label = text(cell(rows, r, startCol)) || title;
      entries.push({
        side: '지출',
        group: '회사출금',
        category: pickLedgerCategory(label, '지출'),
        label,
        amount,
        bank: text(cell(rows, r, startCol + 2)),
        date: toDate(cell(rows, r, startCol + 3)),
        periodSeq: 1,
        source: 'manual',
        locked: true,
        memo: `공통지출내역 · ${title} (${fileName})`
      });
    }
  });
  const paidOut = toNumber(cell(rows, 2, 3));
  return {
    header: { carModel: '공통 지출 (사고대차)', customerName: '회사 공통' },
    expected: { paidOut, paidIn: 0, balance: -paidOut },
    entries
  };
};

const parseSheet = (rows, sheetName, fileName) => {
  const header = {
    customerName: text(cell(rows, 3, 7)),
    contractorName: text(cell(rows, 3, 12)),
    plateNo: text(cell(rows, 4, 2)),
    carModel: text(cell(rows, 4, 7)),
    carSpec: text(cell(rows, 4, 12)),
    registeredAt: toDate(cell(rows, 5, 2)),
    contractedAt: toDate(cell(rows, 5, 7)),
    contractEndAt: toDate(cell(rows, 5, 12)),
    carPrice: toNumber(cell(rows, 6, 2)) || undefined,
    cc: toNumber(cell(rows, 6, 7)) || undefined
  };

  const expected = {
    paidOut: toNumber(cell(rows, 10, 3)),
    paidIn: toNumber(cell(rows, 10, 8)),
    balance: toNumber(cell(rows, 10, 13))
  };

  const entries = [];
  for (let r = 14; r < rows.length; r += 1) {
    BLOCKS.forEach((block) => {
      const label = text(cell(rows, r, block.startCol));
      const amount = toNumber(cell(rows, r, block.startCol + 1));
      if (!amount) return;

      // 대출 줄은 입금·출금에 따라 분류가 갈린다(대출금 / 차량가)
      const category = pickLedgerCategory(label, block.side);
      const roundMatch = /(\d+)\s*회차/.exec(label);
      // 할부금 상환 줄은 "12차", "상환2차"처럼 적혀 있어 따로 읽는다.
      const round = roundMatch ? Number(roundMatch[1]) : (category === '할부금' ? parseLoanRound(label) : undefined);

      entries.push({
        side: block.side,
        group: block.group,
        category,
        label: label || category,
        amount,
        bank: text(cell(rows, r, block.startCol + 2)),
        date: toDate(cell(rows, r, block.startCol + 3)),
        round,
        periodSeq: 1,
        source: pickSource(category, round, label),
        locked: true,
        memo: `엑셀 갑지 ${sheetName} 시트 (${fileName})`
      });
    });
  }

  return { header, expected, entries };
};

const deriveTerms = (entries) => {
  const sumOf = (category) => entries
    .filter((e) => e.category === category && e.group !== '회사출금')
    .reduce((s, e) => s + e.amount, 0);
  const rents = entries.filter((e) => e.category === '렌트료' && e.amount > 0).map((e) => e.amount);
  const freq = new Map();
  rents.forEach((a) => freq.set(a, (freq.get(a) || 0) + 1));
  return {
    monthlyRent: [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    deposit: sumOf('보증금') || undefined,
    advancePayment: sumOf('선납금') || undefined,
    takeoverPrice: sumOf('인수가') || undefined
  };
};

/**
 * 계약 구간이 여럿인 갑지는 엑셀의 연속 회차(1~53)를 구간별 회차로 다시 나눈다.
 * 최초 계약이 48개월이면 49회차는 1차 연장 1회차다. 렌트료가 아닌 줄은 날짜가 연장 시작일 이후면 그 구간으로 보낸다.
 */
export const splitByPeriods = (entries, periods) => {
  const sorted = [...periods].sort((a, b) => a.seq - b.seq);
  if (sorted.length < 2) return 0;
  let moved = 0;

  // 연장할 때 회차 번호를 1부터 다시 붙인 갑지(예: Benz-003 화우 1~36 → 1~12 → 1~10, 대표님 2026-10-23)는
  // 번호로는 구간을 못 가른다. 날짜 순으로 보다가 1회차가 다시 나오는 곳에서 끊어 앞 구간부터 차례로 넣는다.
  const rents = entries.filter((e) => e.category === '렌트료' && e.round && e.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const blocks = [];
  rents.forEach((e) => {
    if (!blocks.length || (e.round === 1 && blocks[blocks.length - 1].length)) blocks.push([]);
    blocks[blocks.length - 1].push(e);
  });
  const restarted = blocks.length > 1 && blocks.length <= sorted.length;
  if (restarted) {
    blocks.forEach((block, i) => block.forEach((e) => {
      const p = sorted[i];
      e.periodSeq = p.seq;
      if (p.seq !== 1) {
        e.label = `렌트료 ${e.round}회차 (${p.seq - 1}차 연장)`;
        moved += 1;
      }
    }));
  }

  entries.forEach((e) => {
    if (e.category === '렌트료' && e.round) {
      if (restarted) return;
      let offset = 0;
      for (const p of sorted) {
        const term = Number(p.termMonths) || 0;
        if (p === sorted[sorted.length - 1] || e.round <= offset + term) {
          if (p.seq !== 1) {
            e.periodSeq = p.seq;
            e.round -= offset;
            e.label = `렌트료 ${e.round}회차 (${p.seq - 1}차 연장)`;
            moved += 1;
          }
          break;
        }
        offset += term;
      }
      return;
    }
    // 인수가는 차를 넘길 때 마지막 구간에서 들어온다. 최초 계약에 남으면 동기화가 마지막 구간에 한 줄 더 만든다
    if (e.category === '인수가') {
      e.periodSeq = sorted[sorted.length - 1].seq;
      moved += 1;
      return;
    }
    // 할부금은 차를 살 때 낸 대출 상환이라 연장 뒤에 나가도 최초 계약 몫
    if (e.category === '할부금') return;
    if (!e.date) return;
    const later = sorted.filter((p) => p.seq > 1 && p.startDate && e.date >= new Date(p.startDate));
    if (later.length) {
      e.periodSeq = later[later.length - 1].seq;
      moved += 1;
    }
  });
  return moved;
};

/** 엑셀 파일들을 시트 단위로 읽는다. 판매완료를 마지막에 두어, 같은 차가 두 파일에 있으면 완료로 끝나게 한다. */
const readSheets = (files) => {
  const ordered = [...files].sort((a, b) => LEDGER_FILE_KINDS.indexOf(a.kind) - LEDGER_FILE_KINDS.indexOf(b.kind));
  const sheets = [];
  for (const f of ordered) {
    const wb = XLSX.read(f.buffer, { type: 'buffer', cellDates: true });
    wb.SheetNames.filter((n) => !NON_VEHICLE_SHEETS.has(n)).forEach((name) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      const parsed = name === COMMON_SHEET ? parseCommonSheet(rows, f.fileName) : parseSheet(rows, name, f.fileName);
      sheets.push({ kind: f.kind, file: f.fileName, name, common: name === COMMON_SHEET, ...parsed });
    });
  }

  // 판매완료 시트 이름이 다른 파일과 겹치면 별개의 차다 -> 이름을 따로 붙인다
  const nonDone = new Set(sheets.filter((s) => s.kind !== '완료').map((s) => s.name));
  const taken = new Set(sheets.map((s) => s.name));
  sheets.forEach((s) => {
    s.ledgerNo = s.name;
    if (s.kind !== '완료' || !nonDone.has(s.name)) return;
    let n = 1;
    while (taken.has(`${s.name}_${n}`)) n += 1;
    s.ledgerNo = `${s.name}_${n}`;
    taken.add(s.ledgerNo);
  });
  return sheets;
};

/**
 * 정산 리스트 엑셀로 원장을 갱신한다.
 *
 * @param {{kind: '장기'|'단기'|'완료', fileName: string, buffer: Buffer}[]} files 세 종류가 모두 있어야 한다.
 *   하나만 넘기면 판매완료 이름 붙이기(_1)가 다른 파일을 몰라 어긋난다.
 * @param {{dryRun?: boolean, beforeWrite?: (existingAll: object[]) => Promise<void>}} [options]
 *   beforeWrite: 쓰기 직전에 지금 원장 전체를 넘겨받아 백업한다. 실패하면 쓰지 않는다.
 * @returns {Promise<object>} 결과 요약(고친 갑지, 새 갑지, 검산 불일치 등)
 */
export const importLedgersFromExcel = async (files, { dryRun = false, beforeWrite } = {}) => {
  const missing = LEDGER_FILE_KINDS.filter((k) => !files.some((f) => f.kind === k));
  if (missing.length) throw new Error(`정산 리스트 엑셀이 빠졌습니다: ${missing.join(', ')}`);

  const sheets = readSheets(files);

  // 차량 DB 색인 (차량번호가 정확히 하나일 때만 잇는다)
  const vehicles = await Vehicle.find({ plateNo: { $nin: [null, ''] } }).select('plateNo contract company code status').lean();
  const byPlate = new Map();
  vehicles.forEach((v) => {
    const key = plateKey(v.plateNo);
    byPlate.set(key, byPlate.has(key) ? 'AMBIGUOUS' : v);
  });
  const linkedVehicleIds = new Set((await VehicleLedger.find({ vehicle: { $ne: null } }).select('vehicle').lean()).map((l) => String(l.vehicle)));

  const existingAll = await VehicleLedger.find({}).lean();
  const renamed = [];
  for (const [from, to] of Object.entries(RENAMES)) {
    const old = existingAll.find((l) => l.ledgerNo === from);
    if (!old || existingAll.some((l) => l.ledgerNo === to)) continue;
    renamed.push({ id: old._id, from, to });
  }

  if (!dryRun && beforeWrite) await beforeWrite(existingAll);

  // 직원이 엑셀에서 시트 이름을 바꾸면(예: 셀토스1 -> Seltos-001, 2026-10) 새 갑지를 만들지 않고
  // 차량번호가 같은 기존 갑지의 이름을 바꿔 이어 쓴다. 기존 갑지 이름이 엑셀에 더는 없고, 같은 번호가 하나일 때만.
  const sheetNos = new Set(sheets.map((s) => s.ledgerNo));
  const known = new Set(existingAll.map((l) => l.ledgerNo).concat(renamed.map((r) => r.to)));
  for (const s of sheets) {
    if (s.common || known.has(s.ledgerNo) || !plateKey(s.header.plateNo)) continue;
    const candidates = existingAll.filter((l) => plateKey(l.header?.plateNo) === plateKey(s.header.plateNo)
      && !sheetNos.has(l.ledgerNo) && !renamed.some((r) => String(r.id) === String(l._id)));
    if (candidates.length !== 1) continue;
    renamed.push({ id: candidates[0]._id, from: candidates[0].ledgerNo, to: s.ledgerNo });
    known.add(s.ledgerNo);
  }

  for (const r of renamed) {
    if (!dryRun) await VehicleLedger.updateOne({ _id: r.id }, { $set: { ledgerNo: r.to } });
    const l = existingAll.find((x) => String(x._id) === String(r.id));
    if (l) l.ledgerNo = r.to;
  }
  const existingByNo = new Map(existingAll.map((l) => [l.ledgerNo, l]));

  const stats = {
    sheets: sheets.length,
    byKind: Object.fromEntries(LEDGER_FILE_KINDS.map((k) => [k, sheets.filter((s) => s.kind === k).length])),
    updated: [], unchanged: [], created: [], plateConflict: [], mismatched: [], split: [], unlinked: [], kindChanged: [],
    renamed: renamed.map((r) => `${r.from} -> ${r.to}`)
  };
  const seen = new Set();

  for (const s of sheets) {
    seen.add(s.ledgerNo);

    // 검산: 옮긴 줄로 다시 계산한 집계가 시트 집계와 같아야 한다
    const got = summarizeLedger({ entries: s.entries });
    const off = (a, b) => Math.abs((a || 0) - (b || 0)) > 1;
    if (off(got.paidOut, s.expected.paidOut) || off(got.paidIn, s.expected.paidIn) || off(got.cashBalance, s.expected.balance)) {
      stats.mismatched.push(`${s.ledgerNo} [${s.kind}]: 엑셀 정산 ${Math.round(s.expected.balance).toLocaleString()} / 읽은 줄 합계 ${Math.round(got.cashBalance).toLocaleString()}`);
    }

    const ledgerType = s.kind === '단기' ? '단기렌트' : '장기렌트';
    const existing = existingByNo.get(s.ledgerNo);

    if (existing) {
      // 같은 이름인데 차량번호가 다르면 다른 차다. 덮어쓰지 않는다.
      if (existing.header?.plateNo && s.header.plateNo && plateKey(existing.header.plateNo) !== plateKey(s.header.plateNo)) {
        stats.plateConflict.push(`${s.ledgerNo}: 원장 ${existing.header.plateNo} / 엑셀 ${s.header.plateNo} (${s.kind})`);
        continue;
      }

      // 프로그램 '판매 대금' 칸에서 넣은 판매는 엑셀에 아직 없을 수 있다. 덮어써도 판매 대금 줄은 남긴다.
      if (existing.sale?.at && !hasSaleEntry(s.entries, existing.sale.amount)) {
        const seq = existing.contractPeriods?.length ? Math.max(...existing.contractPeriods.map((p) => p.seq)) : 1;
        s.entries.push(saleEntryOf(existing.sale, seq));
      }
      const moved = splitByPeriods(s.entries, existing.contractPeriods || []);
      if (moved) stats.split.push(`${s.ledgerNo}: ${moved}줄을 연장 구간으로`);
      OVERRIDES[s.ledgerNo]?.(s.entries);

      const header = { ...(existing.header || {}) };
      Object.entries(s.header).forEach(([k, v]) => { if (v !== undefined && v !== '') header[k] = v; });

      // 구간이 여럿이면 고정 조건은 지금 유효한 연장 계약 값이라 엑셀(첫 계약 기준)로 덮지 않는다
      const terms = { ...(existing.terms || {}) };
      if ((existing.contractPeriods || []).length < 2) {
        Object.entries(deriveTerms(s.entries)).forEach(([k, v]) => { if (v !== undefined) terms[k] = v; });
      }

      const status = s.kind === '완료' ? '거래완료' : existing.status;
      const prevForm = existing.status === '거래완료' ? '완료' : (existing.ledgerType === '단기렌트' ? '단기' : '장기');
      if (prevForm !== s.kind) stats.kindChanged.push(`${s.ledgerNo}: ${prevForm} -> ${s.kind}`);

      // 줄이 그대로면 쓰지 않는다. 10분마다 도는데 매번 179장을 다시 쓰면 수정 시각이 의미를 잃는다.
      const comparable = (list) => JSON.stringify((list || []).map((e) => [
        e.side, e.group, e.category, e.label, e.amount, e.bank, e.date ? new Date(e.date).toISOString().slice(0, 10) : '', e.round ?? null, e.periodSeq || 1
      ]));
      const same = comparable(existing.entries) === comparable(s.entries)
        && JSON.stringify(existing.header || {}) === JSON.stringify(header)
        && existing.ledgerType === ledgerType && existing.status === status;
      if (same) { stats.unchanged.push(s.ledgerNo); continue; }

      stats.updated.push(s.ledgerNo);
      if (!dryRun) {
        await VehicleLedger.updateOne({ _id: existing._id }, {
          $set: { header, terms, entries: s.entries, ledgerType, status }
        });
      }
      continue;
    }

    // 새 갑지 - 공통지출내역은 차가 없으므로 연결하지 않고 보류로 둔다
    if (s.common) {
      stats.created.push(`${s.ledgerNo} [공통]`);
      if (!dryRun) {
        await VehicleLedger.create({
          ledgerNo: s.ledgerNo,
          ledgerType,
          status: '보류',
          header: s.header,
          entries: s.entries,
          note: `엑셀 "${s.file}"의 "${s.name}" 시트. 차 한 대가 아닌 회사 공통 비용 (${new Date().toISOString().slice(0, 10)})`
        });
      }
      continue;
    }

    const match = byPlate.get(plateKey(s.header.plateNo));
    const vehicle = (match && match !== 'AMBIGUOUS' && !linkedVehicleIds.has(String(match._id))) ? match : null;
    const contract = vehicle?.contract ? await Contract.findById(vehicle.contract).select('customer companyId').lean() : null;
    if (vehicle) linkedVehicleIds.add(String(vehicle._id));
    else stats.unlinked.push(`${s.ledgerNo}${s.header.plateNo ? ` (${s.header.plateNo})` : ''}`);

    stats.created.push(`${s.ledgerNo} [${s.kind}]`);
    if (!dryRun) {
      await VehicleLedger.create({
        ledgerNo: s.ledgerNo,
        vehicle: vehicle?._id || null,
        contract: vehicle?.contract || null,
        company: contract?.companyId || vehicle?.company || null,
        customer: contract?.customer || null,
        ledgerType,
        status: s.kind === '완료' ? '거래완료' : (vehicle ? '운용중' : '차량미배정'),
        header: s.header,
        terms: deriveTerms(s.entries),
        entries: s.entries,
        note: `엑셀 "${s.file}"의 "${s.name}" 시트에서 이관 (${new Date().toISOString().slice(0, 10)})`
      });
    }
  }

  // 엑셀에 없는 기존 갑지는 지우지 않고 그대로 둔다(시트를 실수로 지웠을 때 원장까지 사라지지 않게)
  stats.untouched = existingAll.filter((l) => !seen.has(l.ledgerNo)).map((l) => l.ledgerNo);
  return stats;
};
