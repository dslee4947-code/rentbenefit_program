// 렌트차량 DB의 '외장색상' 칸에 외장·내장이 같이 들어 있는 것을 두 칸으로 나누는 스크립트.
//
// 배경: 운영 엑셀이 색상을 한 칸에 "외장 / 내장"으로 적어 왔다. 그대로 올라와
//       외장색상 칸에 둘이 붙어 있고 내장색상 칸은 비어 있다.
//
//   마칼루 그레이 / 슬레이트그래이(보르도브라운 시트)/올리브애쉬
//     -> 외장: 마칼루 그레이
//     -> 내장: 슬레이트그래이(보르도브라운 시트)/올리브애쉬
//
// 나누는 기준은 '첫 번째 /' 하나다. 두 번째 뒤부터는 내장 색상이 여러 개인 것이므로
// 내장 색상 안에 그대로 둔다.
//
// 건드리지 않는 것:
//   - '/'가 없는 값
//   - 내장색상 칸에 이미 다른 값이 적혀 있는 차량 (어느 쪽이 맞는지는 사람이 봐야 한다 - 목록으로 알려 준다)
//
// 실행:
//   cd server && node migrations/2026-09-04_split_vehicle_colors.js --dry-run
//   cd server && node migrations/2026-09-04_split_vehicle_colors.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Vehicle from '../models/Vehicle.js';
import { splitColorValue } from '../utils/vehicleColor.js';

dotenv.config();

// 색인은 앱이 이미 만들어 두었다. 정리 스크립트가 색인을 새로 만들려다 실패하는 일이 없도록 끈다
// (--dry-run은 아무것도 쓰지 않아야 한다).
mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const vehicles = await Vehicle.find({ exteriorColor: /\// })
    .select('code carModel plateNo exteriorColor interiorColor')
    .lean();

  console.log(`\n외장색상에 '/'가 들어 있는 차량: ${vehicles.length}대`);

  let changed = 0;
  const conflicts = [];

  for (const v of vehicles) {
    const { exteriorColor, interiorColor } = splitColorValue(v.exteriorColor);
    if (!interiorColor) continue; // 나눌 수 없는 값

    const existing = String(v.interiorColor ?? '').trim();
    if (existing && existing !== interiorColor) {
      conflicts.push({ v, interiorColor, existing });
      continue;
    }

    const label = `${v.code || v.carModel}${v.plateNo ? ` (${v.plateNo})` : ''}`;
    console.log(`  ${label}`);
    console.log(`    "${v.exteriorColor}"`);
    console.log(`    -> 외장 "${exteriorColor}" · 내장 "${interiorColor}"`);
    changed += 1;

    if (!isDryRun) {
      await Vehicle.updateOne({ _id: v._id }, { $set: { exteriorColor, interiorColor } });
    }
  }

  if (conflicts.length) {
    console.log(`\n[확인 필요] 내장색상 칸에 이미 다른 값이 있어 두지 않은 차량 ${conflicts.length}대`);
    for (const { v, interiorColor, existing } of conflicts) {
      console.log(`  ${v.code || v.carModel}: 외장칸에서 떼면 "${interiorColor}" / 내장칸에는 "${existing}"`);
    }
  }

  console.log(`\n[요약] ${changed}대를 나눴습니다. (확인 필요 ${conflicts.length}대)`);
  console.log(isDryRun ? '(DRY-RUN이라 아무것도 바꾸지 않았습니다)' : '(반영 완료)');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
