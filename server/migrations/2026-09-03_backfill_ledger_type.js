// 이미 만들어진 갑지에 '구분(ledgerType)'과 '거래완료' 상태를 채워 넣는 일회성 스크립트.
//
// 배경: 엑셀 이관 당시에는 갑지에 성격 구분이 없어 전부 장기렌트/운용중으로 들어갔다.
// 사고대차 갑지와 거래완료 갑지를 따로 보게 되면서 두 축이 생겼으므로,
// 이미 연결된 렌트차량 DB 상태를 보고 한 번 맞춰 준다.
//
// 차량이 연결되지 않은 갑지는 판단 근거가 없으므로 건드리지 않는다.
//
// 실행:
//   cd server && node migrations/2026-09-03_backfill_ledger_type.js --dry-run
//   cd server && node migrations/2026-09-03_backfill_ledger_type.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import VehicleLedger from '../models/VehicleLedger.js';
import Vehicle from '../models/Vehicle.js';

dotenv.config();

const isDryRun = process.argv.includes('--dry-run');

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  // 차량이 연결되지 않은 갑지도 대상에 넣는다.
  // ledgerType 필드가 생기기 전에 만들어진 문서에는 그 필드가 아예 없는데,
  // lean() 조회는 스키마 기본값을 채워 주지 않아 "구분: 장기렌트" 필터가 한 건도 못 찾는다.
  const ledgers = await VehicleLedger.find()
    .select('ledgerNo vehicle ledgerType status').lean();
  const vehicles = await Vehicle.find({ _id: { $in: ledgers.map((l) => l.vehicle) } })
    .select('status').lean();
  const statusOf = new Map(vehicles.map((v) => [String(v._id), v.status]));

  const changes = [];
  for (const l of ledgers) {
    const vs = l.vehicle ? statusOf.get(String(l.vehicle)) : undefined;
    const ledgerType = vs === '사고대차' ? '사고대차' : '장기렌트';
    const status = vs === '거래완료' ? '거래완료' : l.status;
    if (ledgerType === l.ledgerType && status === l.status) continue;

    changes.push({ ledgerNo: l.ledgerNo, vehicleStatus: vs, ledgerType, status });
    if (!isDryRun) {
      await VehicleLedger.updateOne({ _id: l._id }, { ledgerType, status });
    }
  }

  console.log(`\n[대상] 차량이 연결된 갑지 ${ledgers.length}장`);
  console.log(`[변경] ${changes.length}장`);
  changes.forEach((c) => console.log(`  ${c.ledgerNo}: 차량상태 ${c.vehicleStatus} -> 구분 ${c.ledgerType} / 상태 ${c.status}`));

  const byType = await VehicleLedger.aggregate([{ $group: { _id: '$ledgerType', n: { $sum: 1 } } }]);
  const byStatus = await VehicleLedger.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  console.log(`\n[구분별] ${byType.map((r) => `${r._id || '(없음)'} ${r.n}`).join(' / ')}`);
  console.log(`[상태별] ${byStatus.map((r) => `${r._id || '(없음)'} ${r.n}`).join(' / ')}`);

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('오류:', err);
  await mongoose.disconnect();
  process.exit(1);
});
