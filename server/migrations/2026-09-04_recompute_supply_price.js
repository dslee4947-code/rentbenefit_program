// 렌트차량 DB의 공급가액을 다시 계산하는 스크립트.
//
//   공급가액 = 차량가 + 옵션가 + 탁송료 - 할인금액
//
// 배경: 예전에는 견적서가 계산한 값을 그대로 받아 적기만 했다. 차량 DB에서 차량가나 할인금액을
//       고쳐도 공급가액은 옛 값 그대로 남아, 표에서 계산이 맞지 않는 줄이 생겼다.
//       이제 저장할 때마다 서버가 다시 계산하므로, 이미 들어 있는 값도 한 번 맞춰 준다.
//
// 옵션가는 이번에 새로 생긴 항목이라 기존 차량에는 없다(0으로 본다).
// 예전 계약서는 차량가에 옵션가를 합쳐서 넘겼기 때문에, 차량가 안에 이미 옵션가가 들어 있다.
// 그래서 여기서 차량가를 건드리지 않고 공급가액만 맞춘다.
//
// 실행:
//   cd server && node migrations/2026-09-04_recompute_supply_price.js --dry-run
//   cd server && node migrations/2026-09-04_recompute_supply_price.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Vehicle from '../models/Vehicle.js';
import { computeSupplyPrice } from '../utils/vehiclePricing.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');
const won = (n) => (n === undefined || n === null ? '(없음)' : `${Number(n).toLocaleString()}원`);

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const vehicles = await Vehicle.find({})
    .select('code carModel plateNo carPrice optionPrice deliveryFee discount supplyPrice')
    .lean();

  let changed = 0;
  let same = 0;
  let bigGap = 0;

  for (const v of vehicles) {
    const next = computeSupplyPrice(v);
    if (next === undefined) continue;
    if (next === v.supplyPrice) { same += 1; continue; }

    const gap = next - (v.supplyPrice || 0);
    // 차이가 큰 줄은 눈에 띄게 표시한다. 예전 값이 다른 기준으로 들어갔을 수 있다.
    if (Math.abs(gap) >= 1000000) bigGap += 1;

    changed += 1;
    console.log(`  ${v.code || v.carModel}${v.plateNo ? ` (${v.plateNo})` : ''}${Math.abs(gap) >= 1000000 ? '  ⚠ 차이 큼' : ''}`);
    console.log(`    차량가 ${won(v.carPrice)} + 옵션가 ${won(v.optionPrice)} + 탁송료 ${won(v.deliveryFee)} - 할인 ${won(v.discount)}`);
    console.log(`    공급가액 ${won(v.supplyPrice)} -> ${won(next)}`);

    if (!isDryRun) {
      await Vehicle.updateOne({ _id: v._id }, { $set: { supplyPrice: next } });
    }
  }

  console.log(`\n[요약] 고침 ${changed}대 · 그대로 ${same}대 (전체 ${vehicles.length}대)`);
  if (bigGap) console.log(`  ⚠ 100만원 이상 달라지는 차량이 ${bigGap}대 있습니다. 위 목록을 확인해 주세요.`);
  console.log(isDryRun ? '(DRY-RUN이라 아무것도 바꾸지 않았습니다)' : '(반영 완료)');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
