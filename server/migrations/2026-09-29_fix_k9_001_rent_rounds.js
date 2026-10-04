// 갑지 K9-001 (101하5040)의 렌트료 회차를 계약 구간에 맞게 옮기는 스크립트.
//
// 대표님 확인(2026-09-29): 최초 계약 48회차를 2026-03-25에 납부 완료했고, 그 뒤 재계약(22030013)을 했다.
//
//   - 48회차 입금일: 갑지에 2026-03-30으로 적혀 있던 것을 2026-03-25로 고친다.
//   - 49~53회차(2026-04 ~ 2026-08, 1,599,725원 = 1,600,000원 - CMS 275원)는 재계약의 렌트료다.
//     최초 계약 구간에 49~53회차로 붙어 있던 것을 1차 연장 구간의 1~5회차로 옮긴다.
//
// 금액·은행·잠금 상태는 그대로 둔다. 구간·회차·이름만 바꾼다.
//
// 실행:
//   cd server && node migrations/2026-09-29_fix_k9_001_rent_rounds.js --dry-run
//   cd server && node migrations/2026-09-29_fix_k9_001_rent_rounds.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import VehicleLedger from '../models/VehicleLedger.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '-');
const LAST_ROUND = 48;
const LAST_PAID_AT = new Date('2026-03-25T00:00:00.000Z');

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const ledger = await VehicleLedger.findOne({ ledgerNo: 'K9-001' });
  if (!ledger) throw new Error('갑지 K9-001을 찾을 수 없습니다.');
  if (!ledger.contractPeriods.some((p) => p.seq === 2)) throw new Error('1차 연장 구간이 없습니다. 구간 정리 스크립트를 먼저 실행하세요.');

  const rents = ledger.entries.filter((e) => e.category === '렌트료' && (e.periodSeq || 1) === 1);

  const last = rents.find((e) => e.round === LAST_ROUND);
  if (!last) throw new Error('48회차 줄을 찾을 수 없습니다.');
  console.log(`\n48회차 입금일: ${d(last.date)} -> ${d(LAST_PAID_AT)}`);

  const moving = rents.filter((e) => e.round > LAST_ROUND).sort((a, b) => a.round - b.round);
  console.log(`\n1차 연장으로 옮길 줄: ${moving.length}개`);
  moving.forEach((e) => console.log(`  ${e.label} (${d(e.date)}, ${e.amount.toLocaleString()}원) -> 렌트료 ${e.round - LAST_ROUND}회차 (1차 연장)`));

  if (!isDryRun) {
    last.date = LAST_PAID_AT;
    moving.forEach((e) => {
      const round = e.round - LAST_ROUND;
      e.periodSeq = 2;
      e.round = round;
      e.label = `렌트료 ${round}회차 (1차 연장)`;
    });
    await ledger.save();
    console.log('\n저장했습니다.');
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
