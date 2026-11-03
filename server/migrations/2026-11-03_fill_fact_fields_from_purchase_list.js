// 계약사실 증명원에 들어가는데 9월 엑셀 업로드 때 DB로 옮겨지지 않은 칸을 "1. 렌트카 매입차량 리스트 관리.xlsx"
// DB_렌트_차량관리 시트에서 채운다(대표님 2026-11-03 "출고된 차는 정보가 다 DB에 있는데 왜 입력하게 하냐").
//
//   차량: 보험종류(=운전자 범위) → insurance.driverRange, 사고수리 → insurance.accidentRepair,
//         자손 → insurance.personalInjury, 고객부담금 → insurance.deductible, 긴급출동 → insurance.emergencyService
//   계약: 책임담당자 연락처 → managerMainPhone, 실무담당자 연락처 → managerOpsPhone
//   계약자 주소·연락처: 법인 계약은 법인 주소(사업자 주소), 개인 계약은 고객 주소(사업자 주소, 없으면 출고지 주소)·휴대폰
//
// 비어 있는 칸만 채운다. 프로그램에서 이미 적어 둔 값은 바꾸지 않는다.
// 주민등록번호 칸(사업자/주민번호)은 읽지 않는다.
// 실행 전에 바꿀 차량·계약·고객·법인 기록을 JSON으로 백업한다.
//
// 실행:
//   cd server && node migrations/2026-11-03_fill_fact_fields_from_purchase_list.js --dry-run
//   cd server && node migrations/2026-11-03_fill_fact_fields_from_purchase_list.js
//   ... --file "경로"  다른 파일에서 읽는다 (엑셀이 열려 있어 잠겨 있으면 복사본 경로를 준다)

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import connectDB from '../config/db.js';
import Vehicle from '../models/Vehicle.js';
import Contract from '../models/Contract.js';
import Customer from '../models/Customer.js';
import Company from '../models/Company.js';

dotenv.config();
mongoose.set('autoIndex', false);

const DIR = 'C:/Users/RentBenefit/OneDrive - CEO/rentbenefit/5. 렌트카_정산서';
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
};
const isDryRun = process.argv.includes('--dry-run');
const filePath = argValue('--file') || path.join(DIR, '1. 렌트카 매입차량 리스트 관리.xlsx');

const key = (s) => String(s ?? '').replace(/\s/g, '').toUpperCase();
const text = (v) => {
  const s = String(v ?? '').trim();
  return ['', '-', '--', '0', '주소 없음', '주소없음'].includes(s) ? '' : s;
};
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
// '50만원' → 500000, '300000' → 300000
const toWon = (v) => {
  const s = text(v).replace(/[,\s]/g, '');
  if (!s) return null;
  const man = /^(\d+(?:\.\d+)?)만원?$/.exec(s);
  if (man) return Math.round(Number(man[1]) * 10000);
  const n = Number(s.replace(/원$/, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const main = async () => {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.DB_렌트_차량관리, { header: 1, defval: '' });
  const head = rows[2].map((h) => String(h ?? '').trim());
  const col = (label, after) => head.findIndex((h, i) => h === label && (after === undefined || i > after));
  const C = {
    code: col('구분'), vin: col('차대 번호'), plate: col('차량 번호'),
    managerMain: col('책임담당자'), managerOps: col('실무담당자'),
    deliveryAddr: col('출고지 주소'), bizAddr: col('사업자 주소'),
    personalInjury: col('자손'), deductible: col('고객부담금'), driverRange: col('보험종류'),
    emergency: col('긴급출동'), accidentRepair: col('사고수리')
  };
  C.mainPhone = col('연락처', C.managerMain);
  C.opsPhone = col('연락처', C.managerOps);
  const lost = Object.entries(C).filter(([, i]) => i < 0).map(([k]) => k);
  if (lost.length) throw new Error(`엑셀에서 열을 찾지 못했습니다: ${lost.join(', ')}`);

  await connectDB();
  const vehicles = await Vehicle.find({}).select('code vin plateNo contract insurance').lean();
  const byVin = new Map(); const byPlate = new Map(); const byCode = new Map();
  vehicles.forEach((v) => {
    if (v.vin) byVin.set(key(v.vin), [...(byVin.get(key(v.vin)) || []), v]);
    if (v.plateNo) byPlate.set(key(v.plateNo), v);
    if (v.code) byCode.set(key(v.code), v);
  });

  const vehicleSets = new Map(); const contractSets = new Map(); const customerSets = new Map(); const companySets = new Map();
  const add = (map, id, field, value) => {
    if (blank(value)) return;
    const m = map.get(String(id)) || {};
    if (m[field] === undefined) m[field] = value;
    map.set(String(id), m);
  };
  const unmatched = [];

  for (const r of rows.slice(3)) {
    const code = text(r[C.code]);
    if (!code) continue;
    const sameVin = byVin.get(key(r[C.vin])) || [];
    const v = (sameVin.length > 1 ? sameVin.find((x) => key(x.code) === key(code)) : sameVin[0])
      || byPlate.get(key(r[C.plate])) || byCode.get(key(code));
    if (!v) { unmatched.push(`${code} ${text(r[C.plate])}`); continue; }

    const ins = v.insurance || {};
    if (blank(ins.driverRange)) add(vehicleSets, v._id, 'insurance.driverRange', text(r[C.driverRange]));
    if (blank(ins.accidentRepair)) add(vehicleSets, v._id, 'insurance.accidentRepair', text(r[C.accidentRepair]));
    if (blank(ins.personalInjury)) add(vehicleSets, v._id, 'insurance.personalInjury', text(r[C.personalInjury]));
    if (blank(ins.deductible)) add(vehicleSets, v._id, 'insurance.deductible', toWon(r[C.deductible]));
    if (blank(ins.emergencyService)) add(vehicleSets, v._id, 'insurance.emergencyService', text(r[C.emergency]));
    if (v.contract) {
      add(contractSets, v.contract, 'managerMainPhone', text(r[C.mainPhone]));
      add(contractSets, v.contract, 'managerOpsPhone', text(r[C.opsPhone]));
      add(contractSets, v.contract, '_bizAddr', text(r[C.bizAddr]));
      add(contractSets, v.contract, '_deliveryAddr', text(r[C.deliveryAddr]));
    }
  }

  // 계약 쪽: 비어 있는 연락처만 넣고, 계약자 주소·휴대폰은 법인 또는 고객 기록에 넣는다
  const contracts = await Contract.find({ _id: { $in: [...contractSets.keys()] } })
    .select('contractNo managerMainPhone managerOpsPhone companyId customer partyType').lean();
  const companies = new Map((await Company.find({ _id: { $in: contracts.map((k) => k.companyId).filter(Boolean) } }).select('name address').lean()).map((c) => [String(c._id), c]));
  const customers = new Map((await Customer.find({ _id: { $in: contracts.map((k) => k.customer).filter(Boolean) } }).select('name address mobilePhone').lean()).map((c) => [String(c._id), c]));
  const contractUpdates = new Map();
  for (const k of contracts) {
    const s = contractSets.get(String(k._id));
    if (blank(k.managerMainPhone) && s.managerMainPhone) add(contractUpdates, k._id, 'managerMainPhone', s.managerMainPhone);
    if (blank(k.managerOpsPhone) && s.managerOpsPhone) add(contractUpdates, k._id, 'managerOpsPhone', s.managerOpsPhone);
    const company = k.companyId ? companies.get(String(k.companyId)) : null;
    const customer = k.customer ? customers.get(String(k.customer)) : null;
    if (company) {
      if (blank(company.address)) add(companySets, company._id, 'address', s._bizAddr);
    } else if (customer && k.partyType !== '법인') {
      if (blank(customer.address)) add(customerSets, customer._id, 'address', s._bizAddr || s._deliveryAddr);
      if (blank(customer.mobilePhone)) add(customerSets, customer._id, 'mobilePhone', s.managerMainPhone || s.managerOpsPhone);
    }
  }

  const count = (m) => [...m.values()].reduce((n, x) => n + Object.keys(x).length, 0);
  console.log(`차량 ${vehicleSets.size}대(${count(vehicleSets)}칸), 계약 ${contractUpdates.size}건(${count(contractUpdates)}칸), 고객 ${customerSets.size}명(${count(customerSets)}칸), 법인 ${companySets.size}곳(${count(companySets)}칸)`);
  if (unmatched.length) console.log(`DB에서 못 찾은 엑셀 줄 ${unmatched.length}개: ${unmatched.slice(0, 20).join(', ')}`);
  const sample = [...vehicleSets.entries()].slice(0, 3);
  sample.forEach(([id, s]) => console.log('  예)', vehicles.find((v) => String(v._id) === id)?.code, JSON.stringify(s)));

  if (isDryRun) { console.log('--dry-run: 바꾸지 않았습니다.'); await mongoose.disconnect(); return; }

  // 백업
  const backupDir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const ids = (m) => [...m.keys()].map((id) => new mongoose.Types.ObjectId(id));
  const backup = {
    vehicles: await Vehicle.find({ _id: { $in: ids(vehicleSets) } }).lean(),
    contracts: await Contract.find({ _id: { $in: ids(contractUpdates) } }).select('managerMainPhone managerOpsPhone').lean(),
    customers: await Customer.find({ _id: { $in: ids(customerSets) } }).select('address mobilePhone').lean(),
    companies: await Company.find({ _id: { $in: ids(companySets) } }).select('address').lean()
  };
  const file = path.join(backupDir, `fill_fact_fields_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(backup));
  console.log(`백업: ${file}`);

  const apply = async (Model, m) => {
    for (const [id, set] of m) {
      // eslint-disable-next-line no-await-in-loop
      await Model.updateOne({ _id: id }, { $set: set }, { runValidators: false, strict: false });
    }
  };
  await apply(Vehicle, vehicleSets);
  await apply(Contract, contractUpdates);
  await apply(Customer, customerSets);
  await apply(Company, companySets);
  console.log('채웠습니다.');
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
