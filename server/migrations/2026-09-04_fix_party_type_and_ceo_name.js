// 이미 올려 둔 렌트차량 자료의 '계약사 · 대표자 · 계약구분'을 지금 규칙에 맞춰 바로잡는 스크립트.
//
// 1) 사고대차 고정
//    사고대차는 계약자가 따로 없고 우리가 내주는 차다. 계약사는 '렌트베네핏', 대표자는 '이두식'으로
//    고정한다. 엑셀에는 대차를 받은 고객 이름이 계약자 자리에 적혀 오는 일이 많았다.
//
// 2) 대표자 채우기
//    운영 엑셀의 E열 '책임담당자'는 계약의 '책임담당자'(Contract.managerMain)로만 들어갔다.
//    화면의 '대표자' 칸은 법인의 대표자명(Company.ceoName)을 읽는 자리라, 값이 DB에 있는데도
//    비어 보였다. 직함("유영석 사장님")은 떼고 이름만 넣는다.
//    ※ 계약이 만들어지지 않은 줄(사고대차·거래완료 등)은 그 값이 DB 어디에도 남지 않아
//      여기서 채울 수 없다. 그런 차량은 엑셀을 다시 올리거나 화면에서 직접 넣어야 한다.
//
// 3) 계약구분 3분류
//    예전 규칙은 사업자번호만 있으면 법인으로 봤다. 개인사업자도 사업자번호가 있으므로
//    엑셀에 법인이라고 쓴 적이 없는 계약자까지 모두 법인이 됐다.
//    지금 규칙(utils/partyType.js): 법인등록번호나 상호의 법인 표기(㈜·주식회사 등)면 법인,
//    아니면 사업자번호가 있으면 개인사업자, 그것도 없으면 일반개인.
//
// 덮어쓰지 않는 것: 이미 채워져 있는 대표자명(법인 관리에서 정리해 둔 값이 정본).
//
// 실행:
//   cd server && node migrations/2026-09-04_fix_party_type_and_ceo_name.js --dry-run
//   cd server && node migrations/2026-09-04_fix_party_type_and_ceo_name.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Vehicle from '../models/Vehicle.js';
import Company from '../models/Company.js';
import Contract from '../models/Contract.js';
import { inferPartyType, bizTypeFor } from '../utils/partyType.js';
import { stripHonorific } from '../utils/personName.js';
import {
  ACCIDENT_RENTAL_STATUS,
  ACCIDENT_RENTAL_PARTY,
  ensureAccidentRentalCompany
} from '../utils/accidentRentalCompany.js';

dotenv.config();

// 색인은 앱이 이미 만들어 두었다. 정리 스크립트가 색인을 새로 만들려다 실패하는 일이 없도록 끈다
// (--dry-run은 아무것도 쓰지 않아야 한다).
mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  // ── 1. 사고대차 계약사·대표자 고정 ──────────────────────
  const accidentVehicles = await Vehicle.find({ status: ACCIDENT_RENTAL_STATUS })
    .select('code carModel plateNo company contractorName partyType')
    .lean();

  console.log(`\n[1] 사고대차 -> 계약사 "${ACCIDENT_RENTAL_PARTY.name}" · 대표자 "${ACCIDENT_RENTAL_PARTY.ceoName}"`);
  let accidentCompanyId = null;
  if (accidentVehicles.length) {
    // DRY-RUN에서는 만들지 않고 찾기만 한다. 그래야 "이미 다 맞춰져 있음"을 제대로 센다.
    const company = isDryRun
      ? await Company.findOne({ name: ACCIDENT_RENTAL_PARTY.name }).select('_id').lean()
      : await ensureAccidentRentalCompany();
    accidentCompanyId = company?._id || null;
  }
  let accidentChanges = 0;
  for (const v of accidentVehicles) {
    const already = accidentCompanyId && String(v.company) === String(accidentCompanyId);
    if (already && v.partyType === '법인' && !v.contractorName) continue;
    console.log(`  ${v.code || v.carModel} ${v.plateNo || ''}`);
    accidentChanges += 1;
    if (!isDryRun) {
      await Vehicle.updateOne(
        { _id: v._id },
        { $set: { company: accidentCompanyId, contractorName: '', partyType: '법인' } }
      );
    }
  }
  if (accidentChanges === 0) console.log('  바꿀 차량이 없습니다.');

  // ── 2. 대표자 채우기 ────────────────────────────────────
  //
  // 값의 출처는 계약의 책임담당자다. 차량 -> 계약 -> 법인으로 이어지는 경우와
  // 계약이 법인을 직접 들고 있는 경우가 모두 있어 두 갈래를 다 본다.
  const ceoNameByCompany = new Map(); // companyId -> 채울 이름

  const vehicles = await Vehicle.find({ company: { $ne: null } })
    .populate('contract', 'managerMain')
    .populate('company', 'name ceoName')
    .lean();
  for (const v of vehicles) {
    // 담당자 칸은 "유영석 사장님"처럼 직함이 붙어 있다. 대표자 칸에는 이름만 넣는다.
    const name = stripHonorific(v.contract?.managerMain);
    if (!name || !v.company || v.company.ceoName) continue;
    if (!ceoNameByCompany.has(String(v.company._id))) {
      ceoNameByCompany.set(String(v.company._id), { name, company: v.company.name });
    }
  }

  const contracts = await Contract.find({
    companyId: { $ne: null },
    managerMain: { $nin: [null, ''] }
  }).populate('companyId', 'name ceoName').lean();
  for (const c of contracts) {
    const name = stripHonorific(c.managerMain);
    if (!name || !c.companyId || c.companyId.ceoName) continue;
    if (!ceoNameByCompany.has(String(c.companyId._id))) {
      ceoNameByCompany.set(String(c.companyId._id), { name, company: c.companyId.name });
    }
  }

  console.log(`\n[2] 대표자 채우기: ${ceoNameByCompany.size}개 법인`);
  for (const [companyId, { name, company }] of ceoNameByCompany) {
    console.log(`  ${company} -> 대표자 "${name}"`);
    if (!isDryRun) await Company.updateOne({ _id: companyId }, { $set: { ceoName: name } });
  }
  if (ceoNameByCompany.size === 0) console.log('  채울 것이 없습니다.');

  // 아직 대표자가 없는 법인을 알려 준다. 출처가 DB에 없어 여기서는 채울 수 없는 곳들이다.
  const stillMissing = await Company.find({ $or: [{ ceoName: { $exists: false } }, { ceoName: '' }] })
    .select('name')
    .lean();
  const missingNames = stillMissing
    .filter((c) => !ceoNameByCompany.has(String(c._id)))
    .map((c) => c.name);
  if (missingNames.length) {
    console.log(`\n  [확인 필요] 대표자를 채우지 못한 법인 ${missingNames.length}곳 (엑셀 재업로드 또는 직접 입력 필요)`);
    missingNames.forEach((n) => console.log(`    - ${n}`));
  }

  // ── 3. 계약구분 3분류로 다시 매기기 ─────────────────────
  //
  // 상호에 ㈜를 안 쓰는 실제 법인이 있을 수 있으므로, 먼저 --dry-run으로 목록을 확인할 것.
  const companies = await Company.find({}).lean();
  const expectedByCompany = new Map(); // companyId -> '법인' | '개인사업자' | '일반개인'
  let bizTypeChanges = 0;

  console.log('\n[3] 계약구분 다시 매기기');
  for (const c of companies) {
    // 사고대차 계약사는 우리 회사라 판단 대상이 아니다
    const expected = c.name === ACCIDENT_RENTAL_PARTY.name ? '법인' : inferPartyType(c.name, c);
    expectedByCompany.set(String(c._id), expected);

    const expectedBizType = bizTypeFor(expected, c);
    if (c.bizType && c.bizType !== expectedBizType) {
      console.log(`  [법인구분] ${c.name}: ${c.bizType} -> ${expectedBizType}`);
      bizTypeChanges += 1;
      if (!isDryRun) await Company.updateOne({ _id: c._id }, { $set: { bizType: expectedBizType } });
    }
  }

  // 차량: 연결된 법인이 있으면 그 판단을 따르고, 법인이 없으면 일반개인이다
  let vehicleChanges = 0;
  const allVehicles = await Vehicle.find({})
    .select('code carModel status partyType company contractorName')
    .lean();
  for (const v of allVehicles) {
    if (v.status === ACCIDENT_RENTAL_STATUS) continue; // 1단계에서 법인으로 고정했다
    const expected = v.company ? (expectedByCompany.get(String(v.company)) || '법인') : '일반개인';
    if (!v.partyType || v.partyType === expected) continue;
    console.log(`  [차량] ${v.code || v.carModel}: ${v.partyType} -> ${expected}`);
    vehicleChanges += 1;
    if (!isDryRun) await Vehicle.updateOne({ _id: v._id }, { $set: { partyType: expected } });
  }

  // 계약: 차량과 같은 기준으로 맞춘다
  let contractChanges = 0;
  const allContracts = await Contract.find({}).select('contractNo partyType companyId').lean();
  for (const c of allContracts) {
    const expected = c.companyId ? (expectedByCompany.get(String(c.companyId)) || '법인') : '일반개인';
    if (!c.partyType || c.partyType === expected) continue;
    console.log(`  [계약] ${c.contractNo}: ${c.partyType} -> ${expected}`);
    contractChanges += 1;
    if (!isDryRun) await Contract.updateOne({ _id: c._id }, { $set: { partyType: expected } });
  }

  console.log(`\n[요약] 사고대차 ${accidentChanges}대 · 대표자 ${ceoNameByCompany.size}건 · 법인구분 ${bizTypeChanges}건 · 차량 계약구분 ${vehicleChanges}건 · 계약 계약구분 ${contractChanges}건`);
  console.log(isDryRun ? '(DRY-RUN이라 아무것도 바꾸지 않았습니다)' : '(반영 완료)');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
