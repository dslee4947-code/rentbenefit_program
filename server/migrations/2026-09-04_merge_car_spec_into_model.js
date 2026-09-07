// 렌트차량 DB의 '사양'을 '차량'에 합치는 스크립트.
//
// 배경: 차량과 사양이 따로 있었는데 "G80"과 "3.5T AWD"처럼 둘을 붙여야 한 대를 가리킬 수 있어
//       두 칸을 오가며 봐야 했다. 차량 한 칸으로 합치고 사양 칸은 비운다.
//
//   차량 "G80" + 사양 "3.5T AWD"  ->  차량 "G80 3.5T AWD"
//
// 이미 차량 칸에 사양까지 적혀 있으면 두 번 붙이지 않는다.
// 계약서(Contract)의 사양은 서류에 나눠 찍어야 해서 그대로 둔다. 차량 문서만 합친다.
//
// 실행:
//   cd server && node migrations/2026-09-04_merge_car_spec_into_model.js --dry-run
//   cd server && node migrations/2026-09-04_merge_car_spec_into_model.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Vehicle from '../models/Vehicle.js';
import { mergeCarModel } from '../utils/carModel.js';

dotenv.config();

// 색인은 앱이 이미 만들어 두었다. 정리 스크립트가 색인을 새로 만들려다 실패하는 일이 없도록 끈다.
mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const vehicles = await Vehicle.find({ carSpec: { $nin: [null, ''] } })
    .select('code carModel carSpec plateNo')
    .lean();

  console.log(`\n사양이 적혀 있는 차량: ${vehicles.length}대`);

  let merged = 0;
  let alreadyIncluded = 0;

  for (const v of vehicles) {
    const carModel = mergeCarModel(v.carModel, v.carSpec);
    const label = `${v.code || ''}${v.plateNo ? ` (${v.plateNo})` : ''}`.trim();

    if (carModel === String(v.carModel ?? '').trim()) {
      // 붙일 게 없는 경우다. 사양이 '-'처럼 빈 표시이거나, 차량 칸에 이미 들어 있다.
      alreadyIncluded += 1;
      const spec = String(v.carSpec ?? '').trim();
      const reason = (spec === '-' || spec === '--') ? '사양이 빈 표시' : '차량 칸에 이미 포함';
      console.log(`  ${label} 차량 "${v.carModel}" · 사양 "${v.carSpec}" (${reason}) - 사양 칸만 비움`);
    } else {
      merged += 1;
      console.log(`  ${label} "${v.carModel}" + "${v.carSpec}" -> "${carModel}"`);
    }

    if (!isDryRun) {
      await Vehicle.updateOne({ _id: v._id }, { $set: { carModel, carSpec: '' } });
    }
  }

  console.log(`\n[요약] 합침 ${merged}대 · 사양 칸만 비움 ${alreadyIncluded}대`);
  console.log(isDryRun ? '(DRY-RUN이라 아무것도 바꾸지 않았습니다)' : '(반영 완료)');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
