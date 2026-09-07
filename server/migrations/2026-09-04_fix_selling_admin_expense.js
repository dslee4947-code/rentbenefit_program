// 렌트차량 DB의 판관비를 비율에서 금액으로 바꾸는 스크립트.
//
// 배경: 운영 엑셀의 판관비 칸에 "3%"가 0.03으로 적혀 있었고 그대로 저장돼,
//       표에 '0.03원'으로 보였다. 판관비는 차량가의 3%에 해당하는 금액이다.
//
//   판관비 0.03  ->  (차량가 + 옵션가) x 0.03
//
// 1보다 작은 값만 비율로 본다. 1원짜리 판관비는 없기 때문이다.
// 이미 금액으로 들어 있는 값은 건드리지 않는다.
//
// 실행:
//   cd server && node migrations/2026-09-04_fix_selling_admin_expense.js --dry-run
//   cd server && node migrations/2026-09-04_fix_selling_admin_expense.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Vehicle from '../models/Vehicle.js';
import { normalizeSellingAdminExpense } from '../utils/vehiclePricing.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');
const won = (n) => `${Math.round(n).toLocaleString()}원`;

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const vehicles = await Vehicle.find({ sellingAdminExpense: { $gt: 0, $lt: 1 } })
    .select('code carModel carPrice optionPrice sellingAdminExpense')
    .lean();

  console.log(`\n판관비에 비율이 들어 있는 차량: ${vehicles.length}대`);

  let changed = 0;
  const noPrice = [];

  for (const v of vehicles) {
    const before = v.sellingAdminExpense;
    const payload = { ...v };
    normalizeSellingAdminExpense(payload);

    if (payload.sellingAdminExpense === before) {
      noPrice.push(v.code || v.carModel);
      continue;
    }

    changed += 1;
    console.log(`  ${(v.code || v.carModel || '').padEnd(14)} 차량가 ${won(v.carPrice).padStart(14)}`
      + ` · 판관비 ${before} -> ${won(payload.sellingAdminExpense)}`);

    if (!isDryRun) {
      await Vehicle.updateOne({ _id: v._id }, { $set: { sellingAdminExpense: payload.sellingAdminExpense } });
    }
  }

  if (noPrice.length) {
    console.log(`\n[건너뜀] 차량가가 없어 금액을 낼 수 없는 차량 ${noPrice.length}대: ${noPrice.join(', ')}`);
  }

  console.log(`\n[요약] ${changed}대 고침`);
  console.log(isDryRun ? '(DRY-RUN이라 아무것도 바꾸지 않았습니다)' : '(반영 완료)');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
