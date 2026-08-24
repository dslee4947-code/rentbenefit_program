// 일회성 데이터 정정 스크립트.
//
// customers.bizNo / customers.bizNoTransfer / companyfolders.bizNo 중 주민등록번호
// 형식(6자리-7자리)으로 저장된 값을 "앞6자리-첫자리******" 형태로 마스킹한다.
// (생년월일 6자리 + 성별 표시 1자리만 남기고 뒤 6자리는 마스킹)
//
// contracts.corporateRegistrationNo(법인등록번호)는 형식은 같지만 성격이 다른
// 필드라 이번 마스킹 대상에서 제외한다 (조사 결과 실제 값도 법인 테스트 데이터로 확인됨).
//
// 백업: companyfolders는 백업이 없어 companyfolders_backup_20260822를 새로 만든다.
// customers는 오늘 이전 작업(bizNo/email 정리) 때 만든 customers_backup_20260822를
// 재사용한다 - 재사용 전에 이번 마스킹 대상 12건의 현재 값이 백업의 값과 동일한지
// (즉 그 사이에 변경되지 않았는지) 대조해서 안전한지 확인한다.
//
// 실행: cd server && node migrations/2026-08-22_mask_resident_registration_numbers.js
//   --dry-run 플래그를 주면 아무것도 쓰지 않고 계획만 출력한다.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Customer from '../models/Customer.js';
import CompanyFolder from '../models/CompanyFolder.js';
import Contract from '../models/Contract.js';

dotenv.config();

const RRN_PATTERN = /^\d{6}-\d{7}$/;
const isDryRun = process.argv.includes('--dry-run');

const maskValue = (v) => `${v.slice(0, 6)}-${v.slice(7, 8)}******`;

const run = async () => {
  await connectDB();
  const db = mongoose.connection.db;
  const conn = mongoose.connection;

  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);
  console.log(`\n[0. 접속 대상 DB 확인]`);
  console.log(`  host   : ${conn.host}`);
  console.log(`  db name: ${conn.name}`);

  // ---------------------------------------------------------------
  // 1) 백업 확인/생성
  // ---------------------------------------------------------------
  console.log(`\n[1. 백업]`);

  // 1-a) companyfolders: 새 백업 생성
  const CF_BACKUP = 'companyfolders_backup_20260822';
  const cfBackupExists = await db.listCollections({ name: CF_BACKUP }).toArray();
  if (cfBackupExists.length > 0) {
    console.error(`  [중단] 백업 컬렉션 "${CF_BACKUP}"이 이미 존재합니다. 재실행 시 덮어쓰기 방지를 위해 중단합니다.`);
    process.exit(1);
  }
  const cfCountBefore = await CompanyFolder.countDocuments({});
  if (!isDryRun) {
    await CompanyFolder.aggregate([{ $out: CF_BACKUP }]);
  }
  const cfBackupCount = isDryRun ? null : await db.collection(CF_BACKUP).countDocuments({});
  console.log(`  companyfolders 원본 문서 수      : ${cfCountBefore}`);
  if (!isDryRun) {
    console.log(`  ${CF_BACKUP} 문서 수 : ${cfBackupCount}`);
    if (cfBackupCount !== cfCountBefore) {
      console.error('  [경고] companyfolders 백업 건수 불일치! 중단합니다.');
      process.exit(1);
    }
    console.log('  companyfolders 백업 건수 일치 확인 완료.');
  } else {
    console.log('  (dry-run이라 백업 생성 생략)');
  }

  // 1-b) customers: 기존 백업 재사용, 건수 + 대상 문서 값 대조
  const CUST_BACKUP = 'customers_backup_20260822';
  const custBackupExists = await db.listCollections({ name: CUST_BACKUP }).toArray();
  if (custBackupExists.length === 0) {
    console.error(`  [중단] 기존 백업 "${CUST_BACKUP}"을 찾을 수 없습니다.`);
    process.exit(1);
  }
  const custCountNow = await Customer.countDocuments({});
  const custBackupCount = await db.collection(CUST_BACKUP).countDocuments({});
  console.log(`\n  customers 현재 문서 수           : ${custCountNow}`);
  console.log(`  ${CUST_BACKUP} 문서 수 : ${custBackupCount}`);
  if (custBackupCount !== custCountNow) {
    console.error('  [경고] customers 백업 건수 불일치! 중단합니다.');
    process.exit(1);
  }
  console.log('  customers 백업 건수 일치 확인 완료.');

  // ---------------------------------------------------------------
  // 2) 마스킹 대상 식별
  // ---------------------------------------------------------------
  const custBizNoTargets = await Customer.find({ bizNo: RRN_PATTERN }, { bizNo: 1 }).lean();
  const custBizNoTransferTargets = await Customer.find({ bizNoTransfer: RRN_PATTERN }, { bizNoTransfer: 1 }).lean();
  const cfBizNoTargets = await CompanyFolder.find({ bizNo: RRN_PATTERN }, { bizNo: 1 }).lean();

  console.log(`\n[2. 마스킹 대상]`);
  console.log(`  customers.bizNo             : ${custBizNoTargets.length}건`);
  console.log(`  customers.bizNoTransfer     : ${custBizNoTransferTargets.length}건`);
  console.log(`  companyfolders.bizNo        : ${cfBizNoTargets.length}건`);

  // 백업 값과 현재 값이 실제로 동일한지(그 사이 변경 안 됐는지) 대조
  let backupMismatch = false;
  for (const t of custBizNoTargets) {
    const backupDoc = await db.collection(CUST_BACKUP).findOne({ _id: t._id });
    if (!backupDoc || backupDoc.bizNo !== t.bizNo) {
      backupMismatch = true;
      console.error(`  [경고] customer ${t._id} bizNo가 백업과 다릅니다.`);
    }
  }
  for (const t of custBizNoTransferTargets) {
    const backupDoc = await db.collection(CUST_BACKUP).findOne({ _id: t._id });
    if (!backupDoc || backupDoc.bizNoTransfer !== t.bizNoTransfer) {
      backupMismatch = true;
      console.error(`  [경고] customer ${t._id} bizNoTransfer가 백업과 다릅니다.`);
    }
  }
  if (backupMismatch) {
    console.error('\n  [중단] 마스킹 대상 문서 중 백업과 현재 값이 다른 건이 있어 안전하지 않습니다.');
    process.exit(1);
  }
  console.log('  마스킹 대상 전 건 백업 값과 현재 값 일치 확인 완료 (안전).');

  // ---------------------------------------------------------------
  // 3) 마스킹 실행
  // ---------------------------------------------------------------
  console.log(`\n[3. 마스킹 ${isDryRun ? '계획' : '실행'}]`);

  const previewOrApply = async (label, targets, Model, field) => {
    const ops = targets.map((t) => ({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { [field]: maskValue(t[field]) } },
      },
    }));
    targets.forEach((t) => {
      console.log(`  [${label}] ${t._id}: ${t[field].slice(0, 6)}-******* -> ${maskValue(t[field])}`);
    });
    if (!isDryRun && ops.length > 0) {
      const result = await Model.bulkWrite(ops);
      console.log(`  -> ${label} 적용 완료 (matched: ${result.matchedCount}, modified: ${result.modifiedCount})`);
    }
  };

  await previewOrApply('customers.bizNo', custBizNoTargets, Customer, 'bizNo');
  await previewOrApply('customers.bizNoTransfer', custBizNoTransferTargets, Customer, 'bizNoTransfer');
  await previewOrApply('companyfolders.bizNo', cfBizNoTargets, CompanyFolder, 'bizNo');

  // ---------------------------------------------------------------
  // 4) 사후 검증
  // ---------------------------------------------------------------
  if (!isDryRun) {
    console.log(`\n[4. 사후 검증]`);

    const stillRRN =
      (await Customer.countDocuments({ bizNo: RRN_PATTERN })) +
      (await Customer.countDocuments({ bizNoTransfer: RRN_PATTERN })) +
      (await CompanyFolder.countDocuments({ bizNo: RRN_PATTERN }));
    console.log(`  마스킹 후에도 RRN 형식으로 남아있는 건수: ${stillRRN} (0이어야 정상)`);

    const maskedFormatPattern = /^\d{6}-\d\*{6}$/;
    const maskedCustBizNo = await Customer.find({ bizNo: maskedFormatPattern }).countDocuments();
    const maskedCustBizNoTransfer = await Customer.find({ bizNoTransfer: maskedFormatPattern }).countDocuments();
    const maskedCfBizNo = await CompanyFolder.find({ bizNo: maskedFormatPattern }).countDocuments();
    console.log(`  마스킹 형식(앞6자리-1자리+******)으로 확인된 건수: customers.bizNo=${maskedCustBizNo}, customers.bizNoTransfer=${maskedCustBizNoTransfer}, companyfolders.bizNo=${maskedCfBizNo}`);

    const contracts = await Contract.find({ corporateRegistrationNo: RRN_PATTERN }, { corporateRegistrationNo: 1 }).lean();
    console.log(`  contracts.corporateRegistrationNo (제외 대상, 원본 유지 확인) : ${contracts.length}건, 샘플: ${contracts.map(c => c.corporateRegistrationNo.slice(0, 6) + '-*******').join(', ')}`);
  }

  await mongoose.connection.close();
  console.log('\n완료.');
};

run().catch((err) => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
