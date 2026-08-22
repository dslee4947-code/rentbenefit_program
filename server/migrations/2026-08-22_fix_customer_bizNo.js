// 일회성 데이터 정정 스크립트.
//
// 배경: Outlook 연락처 동기화 로직이 신규 고객 생성 시 bizNo(사업자/주민번호) 필드에
// "OUTLOOK-" + outlookId 뒤 12자리 로 만든 placeholder 값을 넣어왔다. 이건 사업자번호가
// 아니다. 진짜 Outlook 연락처 ID는 별도의 outlookId 필드에 항상 정확히 저장되어 있으므로
// (매 동기화마다 $set), bizNo의 조각값을 outlookId로 옮기면 오히려 멀쩡한 값을 훼손한다.
// 따라서: outlookId가 이미 있으면 그대로 두고 bizNo 필드 자체를 $unset하고, outlookId가
// 없는 예외적인 경우에만 bizNo 값을 outlookId로 백필한 뒤 bizNo를 $unset한다.
// (bizNo에는 unique 인덱스가 없음을 사전 확인했으므로 $unset해도 인덱스 충돌 없음)
//
// 실행: cd server && node migrations/2026-08-22_fix_customer_bizNo.js
//   --dry-run 플래그를 주면 아무것도 쓰지 않고 통계만 출력한다.
//
// 사전 조건: server/models/Customer.js 의 bizNo가 required 아닌 plain String이어야 한다
// (그렇지 않으면 이 스크립트 자체는 성공해도, 이후 고객 수정 시 저장이 막힌다).

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Customer from '../models/Customer.js';

dotenv.config();

const BACKUP_COLLECTION = 'customers_backup_20260822';
const isDryRun = process.argv.includes('--dry-run');

const run = async () => {
  await connectDB();
  const db = mongoose.connection.db;
  const conn = mongoose.connection;

  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  console.log(`\n[0. 접속 대상 DB 확인]`);
  console.log(`  host   : ${conn.host}`);
  console.log(`  db name: ${conn.name}`);
  console.log(`  env var: ${process.env.MONGODB_ATLAS_URL ? 'MONGODB_ATLAS_URL' : (process.env.MONGO_URI ? 'MONGO_URI' : '(none set)')}`);
  console.log('  -> 이 값이 Heroku(운영)에서 쓰는 MONGODB_ATLAS_URL/MONGO_URI 값과 같은 클러스터/DB인지');
  console.log('     반드시 위 host/db name을 실제 값과 대조 후 진행할 것.');

  // ---------------------------------------------------------------
  // 1) 백업: customers 전체를 customers_backup_20260822 로 복제
  // ---------------------------------------------------------------
  const existingBackup = await db.listCollections({ name: BACKUP_COLLECTION }).toArray();
  if (existingBackup.length > 0) {
    console.error(`\n[중단] 백업 컬렉션 "${BACKUP_COLLECTION}" 이 이미 존재합니다.`);
    console.error('재실행 시 최신 상태로 덮어써서 원본 백업의 목적이 훼손될 수 있습니다.');
    console.error('의도한 것이 맞다면 기존 백업 컬렉션을 수동으로 이름 변경/삭제 후 다시 실행하세요.');
    process.exit(1);
  }

  const originalCount = await Customer.countDocuments({});

  if (!isDryRun) {
    await Customer.aggregate([{ $out: BACKUP_COLLECTION }]);
  }

  console.log(`\n[1. 백업]`);
  console.log(`  원본 customers 문서 수                    : ${originalCount}`);

  if (!isDryRun) {
    const backupCount = await db.collection(BACKUP_COLLECTION).countDocuments({});
    console.log(`  백업(${BACKUP_COLLECTION}) 문서 수 : ${backupCount}`);
    if (backupCount !== originalCount) {
      console.error('  [경고] 백업 건수가 원본과 일치하지 않습니다! 이후 단계를 중단합니다.');
      process.exit(1);
    }
    console.log('  건수 일치 확인 완료.');
  } else {
    console.log('  (dry-run이라 백업을 생성하지 않았습니다)');
  }

  // ---------------------------------------------------------------
  // 2) bizNo 정리: "OUTLOOK-"로 시작하는 값 처리
  // ---------------------------------------------------------------
  const targets = await Customer.find(
    { bizNo: /^OUTLOOK-/ },
    { bizNo: 1, outlookId: 1 }
  ).lean();

  const missingOutlookId = targets.filter(t => !t.outlookId);

  console.log(`\n[2. bizNo 정리]`);
  console.log(`  bizNo가 "OUTLOOK-"으로 시작하는 문서 수    : ${targets.length}`);
  console.log(`  그 중 outlookId가 비어있는 예외(백필 대상)  : ${missingOutlookId.length}`);
  console.log(`  나머지(outlookId 보존, bizNo만 비움)        : ${targets.length - missingOutlookId.length}`);

  if (!isDryRun && targets.length > 0) {
    if (missingOutlookId.length > 0) {
      // 예외 케이스: outlookId가 비어있으면 bizNo 값을 백필한 뒤 bizNo는 제거
      const backfillOps = missingOutlookId.map(t => ({
        updateOne: {
          filter: { _id: t._id },
          update: { $set: { outlookId: t.bizNo }, $unset: { bizNo: '' } }
        }
      }));
      const backfillResult = await Customer.bulkWrite(backfillOps);
      console.log(`  -> outlookId 백필 + bizNo 제거 완료 (modified: ${backfillResult.modifiedCount})`);
    }

    // 나머지(outlookId 이미 정상 보유): bizNo 필드 자체를 제거 ($unset)
    const clearResult = await Customer.updateMany(
      { bizNo: /^OUTLOOK-/ },
      { $unset: { bizNo: '' } }
    );
    console.log(`  -> bizNo 필드 제거 완료 (matched: ${clearResult.matchedCount}, modified: ${clearResult.modifiedCount})`);
  }

  // ---------------------------------------------------------------
  // 3) (Outlook 동기화 코드 재발 방지는 outlookSyncService.js에서 별도 수정)
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // 4) 실제 사업자번호 형태(숫자만 추출 시 10자리)가 남아있는 건수 리포트
  // ---------------------------------------------------------------
  const remaining = await Customer.find({}, { bizNo: 1 }).lean();
  const digits10 = remaining.filter(c => (c.bizNo || '').replace(/[^0-9]/g, '').length === 10);
  const strictFormat = remaining.filter(c => /^\d{3}-\d{2}-\d{5}$/.test(c.bizNo || ''));

  console.log(`\n[4. 사업자번호 형태 점검]`);
  console.log(`  bizNo 숫자만 추출 시 정확히 10자리인 문서 수 : ${digits10.length}`);
  console.log(`  그 중 "000-00-00000" 표준 하이픈 형식        : ${strictFormat.length}`);

  await mongoose.connection.close();
  console.log('\n완료.');
};

run().catch((err) => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
