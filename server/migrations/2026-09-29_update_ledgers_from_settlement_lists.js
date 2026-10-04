// 정산 리스트 엑셀 3개로 차량 손익 원장(갑지)을 갱신하는 스크립트.
//
// 원본 (2026-09-29 대표님 업로드):
//   렌트베네핏 장기렌트 정산 리스트 추가_260811.xlsx  -> 형태 장기 (ledgerType 장기렌트)
//   렌트베네핏 사고대차 정산 리스트_260811.xlsx       -> 형태 단기 (ledgerType 단기렌트)
//   렌트베네핏 판매완료 정산 리스트_260420.xlsx       -> 형태 완료 (status 거래완료)
// 차량 시트 구조는 2026-09-03 이관 때의 "장기렌트_갑지"와 같다(3~6행 상단 정보, 9~11행 집계, 14행부터 3개 블록).
//
// 갑지가 이미 있으면 지우지 않고 고친다. 차량·계약 연결, 계약 구간, 만기 처리, 수익성 검토 메모는
// 사람이 앱에서 정리한 것이라 그대로 두고, 입출금 줄과 상단 정보만 엑셀 최종본으로 바꾼다.
// (2026-09-29 기준 앱에서 손으로 추가한 줄은 한 줄도 없어 줄을 통째로 바꿔도 잃는 것이 없다.)
//
// 같은 이름의 시트가 판매완료 파일과 다른 파일에 함께 있으면(Ray-054, Ray-055, Sorento-001)
// 차량번호가 다른 별개의 차다. 판매완료 쪽은 "이름_1"로 따로 만든다(대표님 확인 2026-09-29).
// 렌트차량 DB가 같은 코드의 앞선 차를 K9-001_1로 부르는 것과 같은 방식이다.
//
// 사고대차 파일의 "공통지출내역" 시트(차 한 대가 아닌 회사 공통 비용)도 갑지 한 장으로 넣는다(대표님 요청 2026-09-29).
//
// 실행 전에 지금 갑지 전체를 JSON으로 백업한다(되돌릴 때 쓴다).
//
// 실행:
//   cd server && node migrations/2026-09-29_update_ledgers_from_settlement_lists.js --dry-run
//   cd server && node migrations/2026-09-29_update_ledgers_from_settlement_lists.js

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import connectDB from '../config/db.js';
import VehicleLedger, { summarizeLedger, pickLedgerCategory } from '../models/VehicleLedger.js';
import Vehicle from '../models/Vehicle.js';
import Contract from '../models/Contract.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');

const DIR = 'C:/Users/RentBenefit/OneDrive - CEO/rentbenefit/5. 렌트카_정산서';
const BACKUP_DIR = path.join(DIR, '_백업');

// 뒤에 오는 파일이 형태를 정한다. 판매완료를 마지막에 두어, 같은 차가 두 파일에 있으면 완료로 끝나게 한다.
const FILES = [
  { kind: '장기', file: '렌트베네핏 장기렌트 정산 리스트 추가_260811.xlsx' },
  { kind: '단기', file: '렌트베네핏 사고대차 정산 리스트_260811.xlsx' },
  { kind: '완료', file: '렌트베네핏 판매완료 정산 리스트_260420.xlsx' }
];

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

// 2026-09-03 이관 스크립트와 같은 규칙. 줄 열쇠(source + category + round)가 자동 연동과 맞아야 중복이 안 생긴다.
const pickSource = (category, round) => {
  if (category === '렌트료' && round) return 'billing';
  if (category === '할부금' && round) return 'loan';
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
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'string') {
    const d = new Date(v.trim());
    if (!Number.isNaN(d.getTime()) && /\d{4}/.test(v)) return d;
  }
  return undefined;
};

const text = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
  return s === '-' ? '' : s;
};

const cell = (rows, r, c) => (rows[r] ? rows[r][c] : undefined);

// 차량 한 대의 갑지가 아닌 회사 공통 비용 시트
const COMMON_SHEET = '공통지출내역';

// 한 번 "_판매완료"로 만들었던 이름을 "_1"로 바꾼다 (2026-09-29 첫 실행 때 만든 이름)
const RENAMES = {
  'Ray-054_판매완료': 'Ray-054_1',
  'Ray-055_판매완료': 'Ray-055_1',
  'Sorento-001_판매완료': 'Sorento-001_1'
};

/**
 * 공통지출내역 시트. 6행이 4개 블록(렌콜 캐시 충전 / 렌콜 탁송료.IMS커넥트 / 기타 비용 / 급여 및 탁송보험)의
 * 제목이고 7행부터 [내용, 금액, 은행, 날짜]가 이어진다. 전부 회사가 낸 돈이다.
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
        category: pickLedgerCategory(label),
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
const plateKey = (p) => String(p || '').replace(/\s/g, '');

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

      const category = pickLedgerCategory(label);
      const roundMatch = /(\d+)\s*회차/.exec(label);
      const round = roundMatch ? Number(roundMatch[1]) : undefined;

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
        source: pickSource(category, round),
        locked: true,
        memo: `엑셀 갑지 ${sheetName} 시트에서 이관 (${fileName})`
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
const splitByPeriods = (entries, periods) => {
  const sorted = [...periods].sort((a, b) => a.seq - b.seq);
  if (sorted.length < 2) return 0;
  let moved = 0;
  entries.forEach((e) => {
    if (e.category === '렌트료' && e.round) {
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
    if (!e.date) return;
    const later = sorted.filter((p) => p.seq > 1 && p.startDate && e.date >= new Date(p.startDate));
    if (later.length) {
      e.periodSeq = later[later.length - 1].seq;
      moved += 1;
    }
  });
  return moved;
};

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  // 1. 시트 읽기
  const sheets = [];
  for (const f of FILES) {
    const wb = XLSX.readFile(path.join(DIR, f.file), { cellDates: true });
    wb.SheetNames.filter((n) => !NON_VEHICLE_SHEETS.has(n)).forEach((name) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      const parsed = name === COMMON_SHEET ? parseCommonSheet(rows, f.file) : parseSheet(rows, name, f.file);
      sheets.push({ ...f, name, common: name === COMMON_SHEET, ...parsed });
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

  const byKind = FILES.map((f) => `${f.kind} ${sheets.filter((s) => s.kind === f.kind).length}장`).join(' · ');
  console.log(`[대상] 차량 시트 ${sheets.length}장 (${byKind})`);

  // 2. 차량 DB 색인 (차량번호가 정확히 하나일 때만 잇는다)
  const vehicles = await Vehicle.find({ plateNo: { $nin: [null, ''] } }).select('plateNo contract company code status').lean();
  const byPlate = new Map();
  vehicles.forEach((v) => {
    const key = plateKey(v.plateNo);
    byPlate.set(key, byPlate.has(key) ? 'AMBIGUOUS' : v);
  });
  const linkedVehicleIds = new Set((await VehicleLedger.find({ vehicle: { $ne: null } }).select('vehicle').lean()).map((l) => String(l.vehicle)));

  // 예전 이름으로 만들어 둔 갑지를 새 이름으로 바꾼다 (새 이름이 비어 있을 때만)
  for (const [from, to] of Object.entries(RENAMES)) {
    const old = await VehicleLedger.findOne({ ledgerNo: from }).select('_id').lean();
    if (!old || await VehicleLedger.exists({ ledgerNo: to })) continue;
    console.log(`[이름 변경] ${from} -> ${to}`);
    if (!isDryRun) await VehicleLedger.updateOne({ _id: old._id }, { $set: { ledgerNo: to } });
  }

  const existingAll = await VehicleLedger.find({}).lean();
  // DRY-RUN에서는 이름 변경이 저장되지 않으므로 바뀐 이름으로 보이게 맞춘다
  if (isDryRun) existingAll.forEach((l) => { if (RENAMES[l.ledgerNo]) l.ledgerNo = RENAMES[l.ledgerNo]; });
  const existingByNo = new Map(existingAll.map((l) => [l.ledgerNo, l]));

  // 3. 백업
  if (!isDryRun) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `vehicle_ledgers_before_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(existingAll));
    console.log(`[백업] ${existingAll.length}장 -> ${file}`);
  }

  const stats = { updated: [], created: [], plateConflict: [], mismatched: [], split: [], unlinked: [], kindChanged: [] };
  const seen = new Set();

  for (const s of sheets) {
    seen.add(s.ledgerNo);

    // 검산: 옮긴 줄로 다시 계산한 집계가 시트 집계와 같아야 한다
    const got = summarizeLedger({ entries: s.entries });
    const off = (a, b) => Math.abs((a || 0) - (b || 0)) > 1;
    if (off(got.paidOut, s.expected.paidOut) || off(got.paidIn, s.expected.paidIn) || off(got.balance, s.expected.balance)) {
      stats.mismatched.push(`${s.ledgerNo} [${s.kind}]: 정산 엑셀 ${Math.round(s.expected.balance).toLocaleString()} / 이관 ${Math.round(got.balance).toLocaleString()}`);
    }

    const ledgerType = s.kind === '단기' ? '단기렌트' : '장기렌트';
    const existing = existingByNo.get(s.ledgerNo);

    if (existing) {
      // 같은 이름인데 차량번호가 다르면 다른 차다. 덮어쓰지 않는다.
      if (existing.header?.plateNo && s.header.plateNo && plateKey(existing.header.plateNo) !== plateKey(s.header.plateNo)) {
        stats.plateConflict.push(`${s.ledgerNo}: 원장 ${existing.header.plateNo} / 엑셀 ${s.header.plateNo} (${s.kind})`);
        continue;
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
      const nextForm = s.kind;
      const prevForm = existing.status === '거래완료' ? '완료' : (existing.ledgerType === '단기렌트' ? '단기' : '장기');
      if (prevForm !== nextForm) stats.kindChanged.push(`${s.ledgerNo}: ${prevForm} -> ${nextForm}`);

      stats.updated.push(s.ledgerNo);
      if (!isDryRun) {
        await VehicleLedger.updateOne({ _id: existing._id }, {
          $set: { header, terms, entries: s.entries, ledgerType, status }
        });
      }
      continue;
    }

    // 새 갑지 - 공통지출내역은 차가 없으므로 연결하지 않고 보류로 둔다
    if (s.common) {
      stats.created.push(`${s.ledgerNo} [공통]`);
      if (!isDryRun) {
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
    if (!isDryRun) {
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

  const untouched = existingAll.filter((l) => !seen.has(l.ledgerNo)).map((l) => l.ledgerNo);

  console.log('\n[결과]');
  console.log(`  고친 갑지  : ${stats.updated.length}장`);
  console.log(`  새 갑지    : ${stats.created.length}장  ${stats.created.join(', ')}`);
  if (stats.kindChanged.length) console.log(`  형태 바뀜  : ${stats.kindChanged.length}장  ${stats.kindChanged.join(' · ')}`);
  if (stats.split.length) console.log(`  구간 나눔  : ${stats.split.join(' · ')}`);
  if (stats.unlinked.length) console.log(`  차량 미연결(새 갑지): ${stats.unlinked.length}장  ${stats.unlinked.join(', ')}`);
  if (untouched.length) console.log(`  엑셀에 없는 기존 갑지(그대로 둠): ${untouched.join(', ')}`);
  if (stats.plateConflict.length) {
    console.log(`\n[차량번호 불일치 - 건너뜀] ${stats.plateConflict.length}장`);
    stats.plateConflict.forEach((m) => console.log(`  ${m}`));
  }
  if (stats.mismatched.length) {
    console.log(`\n[검산 불일치] ${stats.mismatched.length}장`);
    stats.mismatched.forEach((m) => console.log(`  ${m}`));
  } else {
    console.log('\n[검산] 모든 시트가 엑셀 집계와 일치합니다.');
  }
  if (!isDryRun) console.log(`\n[최종] 차량 손익 원장 총 ${await VehicleLedger.countDocuments()}장`);

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('갱신 중 오류:', err);
  await mongoose.disconnect();
  process.exit(1);
});
