// 일회성 데이터 정정 스크립트 (bizNo 정리 작업과 동일한 패턴).
//
// 배경: Customer.email이 required:true였는데, Outlook 연락처 중 이메일이 없는 경우
// outlookSyncService가 email: '' 로 저장해왔다. Mongoose는 빈 문자열도 required 위반으로
// 취급하고 .save() 시 문서 전체를 재검증하므로, 이 12,818건은 다른 필드 하나만 고쳐도
// 저장이 막히는 상태였다. bizNo 건과 마찬가지로 email이 없다는 사실 자체가 정상 상태이므로
// 필드를 $unset한다. (email에 unique 인덱스 없음을 사전 확인했으므로 충돌 없음)
//
// 이번엔 별도 백업 컬렉션을 새로 만들지 않는다 (customers_backup_20260822가 이미 존재).
// 대신 작업 전후 문서 총수만 대조해 side-effect(문서 유실/추가)가 없는지 확인한다.
//
// 실행: cd server && node migrations/2026-08-22_fix_customer_email.js
//   --dry-run 플래그를 주면 아무것도 쓰지 않고 통계만 출력한다.
//
// 사전 조건: server/models/Customer.js 의 email이 required 아닌 plain String이어야 한다.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Customer from '../models/Customer.js';

dotenv.config();

const isDryRun = process.argv.includes('--dry-run');

const run = async () => {
  await connectDB();
  const conn = mongoose.connection;

  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  console.log(`\n[0. 접속 대상 DB 확인]`);
  console.log(`  host   : ${conn.host}`);
  console.log(`  db name: ${conn.name}`);
  console.log(`  env var: ${process.env.MONGODB_ATLAS_URL ? 'MONGODB_ATLAS_URL' : (process.env.MONGO_URI ? 'MONGO_URI' : '(none set)')}`);

  // ---------------------------------------------------------------
  // 1) 작업 전 건수
  // ---------------------------------------------------------------
  const countBefore = await Customer.countDocuments({});
  const emptyEmailBefore = await Customer.countDocuments({ email: '' });

  console.log(`\n[1. 작업 전 건수]`);
  console.log(`  customers 전체 문서 수      : ${countBefore}`);
  console.log(`  email이 빈 문자열인 문서 수 : ${emptyEmailBefore}`);

  // ---------------------------------------------------------------
  // 2) email 정리: 빈 문자열인 email 필드 제거
  // ---------------------------------------------------------------
  if (!isDryRun && emptyEmailBefore > 0) {
    const clearResult = await Customer.updateMany(
      { email: '' },
      { $unset: { email: '' } }
    );
    console.log(`\n[2. email 필드 제거]`);
    console.log(`  matched: ${clearResult.matchedCount}, modified: ${clearResult.modifiedCount}`);
  } else {
    console.log(`\n[2. email 필드 제거] dry-run이라 실행하지 않음 (대상: ${emptyEmailBefore}건)`);
  }

  // ---------------------------------------------------------------
  // 3) 작업 후 건수 대조 (문서 유실/추가 없는지)
  // ---------------------------------------------------------------
  const countAfter = await Customer.countDocuments({});
  const emptyEmailAfter = await Customer.countDocuments({ email: '' });
  const missingEmailAfter = await Customer.countDocuments({ email: { $exists: false } });

  console.log(`\n[3. 작업 후 대조]`);
  console.log(`  customers 전체 문서 수      : ${countAfter} (전: ${countBefore}, 차이: ${countAfter - countBefore})`);
  console.log(`  email이 빈 문자열인 문서 수 : ${emptyEmailAfter}`);
  console.log(`  email 필드 자체가 없는 수   : ${missingEmailAfter}`);

  if (countAfter !== countBefore) {
    console.error('\n  [경고] 문서 총수가 변경되었습니다! 확인이 필요합니다.');
  } else {
    console.log('\n  문서 총수 일치 확인 완료.');
  }

  await mongoose.connection.close();
  console.log('\n완료.');
};

run().catch((err) => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
