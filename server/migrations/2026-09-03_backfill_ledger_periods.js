// 이미 만들어진 갑지에 '계약 구간(contractPeriods)'과 줄별 periodSeq를 채우는 일회성 스크립트.
//
// 배경: 연장 기능이 생기기 전에 만들어진 갑지에는 구간 개념이 없다. 전부 최초 계약(1구간)이므로
// 1구간을 하나 심고 모든 줄에 periodSeq=1을 박아 둔다.
//
// 이걸 해 두지 않으면 나중에 연장을 붙였을 때, 구간이 없는 기존 줄과 연장 줄이
// 같은 열쇠(source+category+round)로 묶여 자동 연동이 서로를 덮어쓴다.
//
// 실행:
//   cd server && node migrations/2026-09-03_backfill_ledger_periods.js --dry-run
//   cd server && node migrations/2026-09-03_backfill_ledger_periods.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import VehicleLedger from '../models/VehicleLedger.js';
import Contract from '../models/Contract.js';

dotenv.config();

const isDryRun = process.argv.includes('--dry-run');

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const ledgers = await VehicleLedger.find().lean();
  const contractIds = ledgers.map((l) => l.contract).filter(Boolean);
  const contracts = await Contract.find({ _id: { $in: contractIds } })
    .select('contractNo contractDate endDate termMonths').lean();
  const contractById = new Map(contracts.map((c) => [String(c._id), c]));

  let periodAdded = 0;
  let entriesTagged = 0;

  for (const l of ledgers) {
    const needPeriod = !l.contractPeriods?.length;
    const untagged = (l.entries || []).filter((e) => !e.periodSeq).length;
    if (!needPeriod && !untagged) continue;

    const update = {};
    if (needPeriod) {
      const c = l.contract ? contractById.get(String(l.contract)) : null;
      update.contractPeriods = [{
        seq: 1,
        contract: l.contract || undefined,
        contractNo: c?.contractNo,
        startDate: c?.contractDate || l.header?.contractedAt,
        endDate: c?.endDate || l.header?.contractEndAt,
        termMonths: c?.termMonths ?? l.terms?.termMonths,
        monthlyRent: l.terms?.monthlyRent,
        deposit: l.terms?.deposit,
        advancePayment: l.terms?.advancePayment,
        takeoverPrice: l.terms?.takeoverPrice
      }];
      periodAdded += 1;
    }
    if (untagged) {
      update.entries = (l.entries || []).map((e) => ({ ...e, periodSeq: e.periodSeq || 1 }));
      entriesTagged += untagged;
    }

    if (!isDryRun) await VehicleLedger.updateOne({ _id: l._id }, { $set: update });
  }

  console.log(`\n[대상] 갑지 ${ledgers.length}장`);
  console.log(`  최초 계약 구간을 심은 갑지 : ${periodAdded}장`);
  console.log(`  periodSeq를 박은 줄        : ${entriesTagged}줄`);

  if (!isDryRun) {
    const noPeriod = await VehicleLedger.countDocuments({ contractPeriods: { $size: 0 } });
    console.log(`\n[확인] 구간이 없는 갑지 ${noPeriod}장 (0이어야 정상)`);
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('오류:', err);
  await mongoose.disconnect();
  process.exit(1);
});
