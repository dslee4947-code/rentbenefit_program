// 렌트차량 DB를 "1. 렌트카 매입차량 리스트 관리.xlsx"의 DB_렌트_차량관리 시트(최신본)로 고치는 스크립트.
//
// 대표님 요청(2026-10-18): 이 시트가 최신 버전이니 프로그램 DB에 반영.
//
// 이미 있는 차량만 고친다. 새 차량·계약·법인은 만들지 않고 목록으로만 알려 준다
// (그건 화면의 "엑셀 업로드"나 계약 등록으로 한다).
//
//   찾는 순서: 차대번호 -> 차량번호 -> 차량코드. 같은 차대번호가 둘이면(재계약으로 생긴 K9-001 / K9-001_1)
//             차량코드가 같은 쪽을 고른다.
//   덮어쓰는 기준: 엑셀 칸에 값이 있고 DB와 다를 때만 엑셀 값으로 바꾼다.
//             엑셀 칸이 비어 있거나 '-'면 DB 값을 그대로 둔다(앱에서 적어 둔 값이 지워지지 않게).
//   열 해석: 화면의 "엑셀 업로드"와 같은 열 정의(VEHICLE_EXCEL_COLUMNS)를 쓰되, 이 시트에서 뜻이 다른 열은 바로잡는다.
//             - 53열 '타이어', 54열 '정기점검'은 금액 칸이라 쓰지 않는다
//             - 68열 '타이어'는 타이어 규격이라 타이어 정보(accessories.tireInfo)로 넣는다
//             - 83열 '기간'은 월 납입금 기간이라 납입개월수(paymentTerm)로 넣는다 (74열 '기간'은 할부 기간)
//   계약 쪽 값(계약번호·계약일·계약자·책임담당자 등 '_'로 시작하는 항목)과 차량코드는 바꾸지 않는다.
//   계약서가 보관된 계약의 차량은 화면에서도 고칠 수 없게 막혀 있어 건너뛴다.
//
// 고친 뒤: 이익금을 다시 계산하고, 인도일이 바뀌면 계약 만기를, 청구에 쓰는 값이 바뀌면 청구 회차표를 다시 맞춘다.
// 실행 전에 렌트차량 DB 전체를 JSON으로 백업한다.
//
// 실행:
//   cd server && node migrations/2026-10-18_update_vehicles_from_purchase_list.js --dry-run
//   cd server && node migrations/2026-10-18_update_vehicles_from_purchase_list.js
//   ... --file "경로"  다른 파일에서 읽는다 (엑셀이 열려 있어 잠겨 있으면 복사본 경로를 준다)

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import connectDB from '../config/db.js';
import Vehicle from '../models/Vehicle.js';
import Contract from '../models/Contract.js';
import {
  VEHICLE_EXCEL_COLUMNS, STATUS_BY_LABEL, normalizeHeader, parseCellValue,
  PERCENT_KEYS, normalizePercent, normalizePaymentDay, setNestedValue, refreshVehicleProfit
} from '../controllers/vehicleController.js';
import { buildScheduleForContract } from '../controllers/billingScheduleController.js';
import { refreshContractEndDate } from '../utils/contractEndDate.js';
import { normalizeMaintenance } from '../utils/maintenance.js';
import { applySupplyPrice, normalizeSellingAdminExpense } from '../utils/vehiclePricing.js';
import { mergeCarModel } from '../utils/carModel.js';
import { applyColorSplit } from '../utils/vehicleColor.js';

dotenv.config();
mongoose.set('autoIndex', false);

const DIR = 'C:/Users/RentBenefit/OneDrive - CEO/rentbenefit/5. 렌트카_정산서';
const DEFAULT_FILE = path.join(DIR, '1. 렌트카 매입차량 리스트 관리.xlsx');
const SHEET = 'DB_렌트_차량관리';
const HEADER_ROW = 2; // 3행이 열 제목

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
};
const isDryRun = process.argv.includes('--dry-run');
const filePath = argValue('--file') || DEFAULT_FILE;

// 이 시트에서 열 번호로 뜻을 바로잡는 칸 (0부터 센 열 번호)
const COLUMN_OVERRIDES = {
  53: null, // 타이어 비용
  54: null, // 정기점검 비용
  68: { key: 'accessories.tireInfo', type: 'text' },
  83: { key: 'paymentTerm', type: 'number' }
};

// 이 스크립트가 바꾸지 않는 항목
const SKIP_KEYS = new Set(['code', 'partyType', 'supplyPrice', 'maintenance.regularCheck', 'maintenance.consumables']);

// 청구 회차표에 쓰이는 값. 바뀌면 회차표를 다시 맞춘다.
const BILLING_KEYS = new Set(['deliveryDate', 'rentBillingDate', 'monthlyPaymentDay', 'monthlyFee', 'paymentTerm']);

const key = (s) => String(s ?? '').replace(/\s/g, '').toUpperCase();
const isBlankCell = (v) => v === undefined || v === null || ['', '-', '--'].includes(String(v).trim());

/** 중첩 객체를 'a.b' 경로로 편다 */
const flatten = (obj, prefix = '', out = {}) => {
  Object.entries(obj || {}).forEach(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) flatten(v, p, out);
    else out[p] = v;
  });
  return out;
};
const readPath = (obj, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);

const ymd = (d) => {
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
};

/** 같은 값인지. 날짜는 날짜만, 숫자는 숫자로, 글자는 앞뒤 공백을 빼고 견준다 */
const same = (a, b) => {
  if (a instanceof Date || b instanceof Date) return ymd(a) === ymd(b);
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 0.5;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return String(a ?? '').trim() === String(b ?? '').trim();
};

const show = (v) => (v instanceof Date ? ymd(v) : (v === undefined || v === null || v === '' ? '(빈칸)' : String(v)));

/** 엑셀 한 줄을 차량 값으로 바꾼다. 화면의 엑셀 업로드와 같은 다듬기를 거친다. */
const parseRow = (row, columnByIndex) => {
  const payload = {};
  Object.entries(columnByIndex).forEach(([index, columns]) => {
    if (isBlankCell(row[index])) return;
    columns.forEach((column) => {
      let value = parseCellValue(row[index], column.type);
      if (value === undefined || value === '') return;
      if (PERCENT_KEYS.has(column.key)) value = normalizePercent(value);
      if (column.key === 'monthlyPaymentDay') value = normalizePaymentDay(value);
      if (typeof column.transform === 'function') value = column.transform(value);
      setNestedValue(payload, column.key, value);
    });
  });

  if (payload.maintenance) payload.maintenance = normalizeMaintenance(payload.maintenance);
  normalizeSellingAdminExpense(payload);
  if (payload.carSpec) {
    payload.carModel = mergeCarModel(payload.carModel, payload.carSpec);
    delete payload.carSpec;
  }
  applyColorSplit(payload);
  if (payload.status) payload.status = STATUS_BY_LABEL[payload.status] || undefined;
  if (payload.insurance?.type) {
    payload.insurance.type = ['고급형', 'premium'].includes(payload.insurance.type) ? 'premium' : 'standard';
  }
  // 계약 쪽 값은 차량에 넣지 않는다
  Object.keys(payload).filter((k) => k.startsWith('_')).forEach((k) => delete payload[k]);
  return payload;
};

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);
  console.log(`[파일] ${filePath} / ${SHEET}`);

  const wb = XLSX.readFile(filePath, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, raw: true, defval: '' });
  const header = rows[HEADER_ROW] || [];

  const columnByIndex = {};
  header.forEach((h, index) => {
    if (index in COLUMN_OVERRIDES) {
      if (COLUMN_OVERRIDES[index]) columnByIndex[index] = [COLUMN_OVERRIDES[index]];
      return;
    }
    const n = normalizeHeader(h);
    if (!n) return;
    const cols = VEHICLE_EXCEL_COLUMNS.filter((c) => c.labels.some((l) => normalizeHeader(l) === n));
    if (cols.length) columnByIndex[index] = cols;
  });

  const col = (label) => header.findIndex((h) => normalizeHeader(h) === normalizeHeader(label));
  const C = { code: col('구분'), vin: col('차대 번호'), plate: col('차량 번호'), model: col('차종') };
  const data = rows.slice(HEADER_ROW + 1)
    .map((r, i) => ({ r, excelRow: HEADER_ROW + 2 + i }))
    .filter(({ r }) => String(r[C.model] ?? '').trim());
  console.log(`[대상] 차종이 적힌 줄 ${data.length}줄`);

  const vehicles = await Vehicle.find({}).lean();
  const index = (field) => {
    const m = new Map();
    vehicles.forEach((v) => { const k = key(v[field]); if (k) m.set(k, [...(m.get(k) || []), v]); });
    return m;
  };
  const byVin = index('vin'); const byPlate = index('plateNo'); const byCode = index('code');

  const lockedContracts = new Set((await Contract.find({ status: '보관됨' }).select('_id').lean()).map((c) => String(c._id)));

  const stats = { matched: 0, changedVehicles: 0, fields: {}, notFound: [], ambiguous: [], locked: [], statusChanges: [], examples: [] };
  const plans = [];
  const used = new Set();

  for (const { r, excelRow } of data) {
    const code = key(r[C.code]);
    let hits = byVin.get(key(r[C.vin])) || byPlate.get(key(r[C.plate])) || byCode.get(code) || [];
    if (hits.length > 1) hits = hits.filter((v) => key(v.code) === code);
    const label = `${r[C.code] || '(코드 없음)'} ${r[C.plate] || ''}`.trim();
    if (!hits.length) { stats.notFound.push(`${excelRow}행 ${label}`); continue; }
    if (hits.length > 1) { stats.ambiguous.push(`${excelRow}행 ${label}`); continue; }
    const v = hits[0];
    if (used.has(String(v._id))) { stats.ambiguous.push(`${excelRow}행 ${label} (다른 줄과 같은 차)`); continue; }
    used.add(String(v._id));
    stats.matched += 1;

    const payload = flatten(parseRow(r, columnByIndex));
    const set = {};
    Object.entries(payload).forEach(([p, val]) => {
      if (SKIP_KEYS.has(p) || val === undefined || val === '') return;
      const cur = readPath(v, p);
      if (same(cur, val)) return;
      set[p] = val;
    });
    // 차량가·옵션가·탁송료·할인이 바뀌면 공급가액도 다시 계산한다
    if (['carPrice', 'optionPrice', 'deliveryFee', 'discount'].some((k) => k in set)) {
      const merged = { carPrice: v.carPrice, optionPrice: v.optionPrice, deliveryFee: v.deliveryFee, discount: v.discount };
      ['carPrice', 'optionPrice', 'deliveryFee', 'discount'].forEach((k) => { if (k in set) merged[k] = set[k]; });
      applySupplyPrice(merged);
      if (merged.supplyPrice !== undefined && !same(merged.supplyPrice, v.supplyPrice)) set.supplyPrice = merged.supplyPrice;
    }
    if (!Object.keys(set).length) continue;

    if (v.contract && lockedContracts.has(String(v.contract))) {
      stats.locked.push(`${v.code} (${Object.keys(set).length}개 항목)`);
      continue;
    }

    stats.changedVehicles += 1;
    Object.keys(set).forEach((p) => { stats.fields[p] = (stats.fields[p] || 0) + 1; });
    if (set.status) stats.statusChanges.push(`${v.code}: ${v.status} -> ${set.status}`);
    if (stats.examples.length < 12) {
      stats.examples.push(`${v.code}: ${Object.entries(set).slice(0, 4).map(([p, val]) => `${p} ${show(readPath(v, p))} -> ${show(val)}`).join(' · ')}${Object.keys(set).length > 4 ? ` 외 ${Object.keys(set).length - 4}개` : ''}`);
    }
    plans.push({ v, set });
  }

  const notInSheet = vehicles.filter((v) => !used.has(String(v._id))).map((v) => `${v.code}/${v.status}`);

  console.log('\n[결과]');
  console.log(`  엑셀 줄과 맞은 차량: ${stats.matched}대`);
  console.log(`  고칠 차량: ${stats.changedVehicles}대`);
  console.log('  항목별 고칠 대수:');
  Object.entries(stats.fields).sort((a, b) => b[1] - a[1]).forEach(([p, n]) => console.log(`    ${p}: ${n}`));
  if (stats.statusChanges.length) console.log(`  상태가 바뀌는 차량 ${stats.statusChanges.length}대: ${stats.statusChanges.join(' · ')}`);
  console.log('  예시:');
  stats.examples.forEach((e) => console.log(`    ${e}`));
  if (stats.locked.length) console.log(`  계약서 보관됨이라 건너뜀: ${stats.locked.join(', ')}`);
  if (stats.notFound.length) console.log(`  DB에 없는 엑셀 줄(새로 만들지 않음): ${stats.notFound.join(', ')}`);
  if (stats.ambiguous.length) console.log(`  어느 차인지 정할 수 없어 건너뜀: ${stats.ambiguous.join(', ')}`);
  if (notInSheet.length) console.log(`  엑셀에 없는 DB 차량(그대로 둠): ${notInSheet.join(', ')}`);

  if (!isDryRun && plans.length) {
    const backupDir = path.join(DIR, '_백업');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `vehicles_before_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(vehicles));
    console.log(`\n[백업] 렌트차량 DB ${vehicles.length}대 -> ${backupFile}`);

    const contractsToRebuild = new Set();
    const contractsEndDate = new Set();
    for (const { v, set } of plans) {
      await Vehicle.updateOne({ _id: v._id }, { $set: set }, { runValidators: true });
      await refreshVehicleProfit(v._id);
      if (v.contract) {
        if ('deliveryDate' in set) contractsEndDate.add(String(v.contract));
        if (Object.keys(set).some((p) => BILLING_KEYS.has(p))) contractsToRebuild.add(String(v.contract));
      }
    }
    for (const id of contractsEndDate) {
      try { await refreshContractEndDate(id); } catch (err) { console.log(`  [계약 만기] ${id}: ${err.message}`); }
    }
    const billingIssues = [];
    for (const id of contractsToRebuild) {
      try { await buildScheduleForContract(id); } catch (err) { billingIssues.push(`${id}: ${err.message}`); }
    }
    console.log(`[반영] 차량 ${plans.length}대 수정 · 계약 만기 다시 계산 ${contractsEndDate.size}건 · 청구 회차표 다시 맞춤 ${contractsToRebuild.size - billingIssues.length}건`);
    if (billingIssues.length) {
      console.log(`  회차표를 맞추지 못한 계약 ${billingIssues.length}건 (값이 덜 찬 경우가 대부분):`);
      billingIssues.forEach((m) => console.log(`    ${m}`));
    }
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('갱신 중 오류:', err);
  await mongoose.disconnect();
  process.exit(1);
});
