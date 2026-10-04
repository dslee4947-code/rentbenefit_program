// 갑지 고정 조건의 인수가를 렌트차량 DB 값으로 채우는 스크립트.
//
// 배경: 엑셀에서 옮겨 온 갑지는 고정 조건의 인수가가 비어 있다(2026-09-29 기준 111장).
//       렌트차량 DB에는 계약 내용으로 인수가가 들어 있어, 수익성 검토의 예상 매출에 쓸 수 있다.
//
// 비어 있는 갑지만 채운다. 갑지에 이미 적힌 인수가는 자금팀이 맞춰 둔 값일 수 있어 건드리지 않고,
// 차량 DB와 다르면 목록으로만 보여 준다.
//
// 실행:
//   cd server && node migrations/2026-09-29_fill_ledger_takeover_price.js --dry-run
//   cd server && node migrations/2026-09-29_fill_ledger_takeover_price.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import VehicleLedger from '../models/VehicleLedger.js';
import Vehicle from '../models/Vehicle.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');
const won = (n) => `${Math.round(n).toLocaleString()}원`;

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const ledgers = await VehicleLedger.find({ vehicle: { $ne: null } })
    .select('ledgerNo vehicle terms')
    .lean();

  const fill = [];
  const differ = [];
  let noVehicleValue = 0;

  for (const l of ledgers) {
    const v = await Vehicle.findById(l.vehicle).select('takeoverPrice').lean();
    const fromVehicle = Number(v?.takeoverPrice) || 0;
    const current = Number(l.terms?.takeoverPrice) || 0;
    if (!fromVehicle) { noVehicleValue += 1; continue; }
    if (!current) fill.push({ id: l._id, ledgerNo: l.ledgerNo, value: fromVehicle });
    else if (current !== fromVehicle) differ.push(`${l.ledgerNo}: 갑지 ${won(current)} / 차량 DB ${won(fromVehicle)}`);
  }

  console.log(`\n차량이 연결된 갑지: ${ledgers.length}장`);
  console.log(`인수가를 채울 갑지: ${fill.length}장`);
  console.log(`차량 DB에도 인수가가 없는 갑지: ${noVehicleValue}장`);
  fill.slice(0, 10).forEach((f) => console.log(`  ${f.ledgerNo} -> ${won(f.value)}`));
  if (fill.length > 10) console.log(`  … 외 ${fill.length - 10}장`);

  if (differ.length) {
    console.log(`\n갑지와 차량 DB의 인수가가 다른 갑지 (그대로 둠): ${differ.length}장`);
    differ.forEach((d) => console.log(`  ${d}`));
  }

  if (!isDryRun && fill.length) {
    const result = await VehicleLedger.bulkWrite(fill.map((f) => ({
      updateOne: {
        filter: { _id: f.id, $or: [{ 'terms.takeoverPrice': null }, { 'terms.takeoverPrice': 0 }] },
        update: { $set: { 'terms.takeoverPrice': f.value } }
      }
    })));
    console.log(`\n갱신: ${result.modifiedCount}장`);
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
