// 렌트차량 DB의 정비 항목을 '일반정비' 하나 기준으로 맞추는 스크립트.
//
// 배경: 일반정비에 가입하면 순회정비·소모품교환도 함께 가입되는 상품인데, 세 칸이 따로 저장돼
//       칸마다 값이 어긋나 있었다. '정비가입'이라는 칸까지 따로 있어 무엇이 정본인지도 불분명했다.
//       (실제로 163대 전부 '정비가입'이 꺼져 있는데 55대는 일반정비가 '가입'이었다)
//
//   일반정비 '가입'   -> 순회정비 '가입',   소모품교환 '가입'
//   그 외(미가입·빈값) -> 순회정비 '미가입', 소모품교환 '미가입'
//
// 화면에서 '정비가입' 열은 없앴고, 값은 일반정비를 따라 자동으로 맞춰진다.
//
// 실행:
//   cd server && node migrations/2026-09-04_normalize_maintenance.js --dry-run
//   cd server && node migrations/2026-09-04_normalize_maintenance.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Vehicle from '../models/Vehicle.js';
import { normalizeMaintenance } from '../utils/maintenance.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');

const show = (m = {}) =>
  `정비가입 ${m.enabled ? '가입' : '미가입'} · 순회 ${m.regularCheck || '(없음)'}`
  + ` · 소모품 ${m.consumables || '(없음)'} · 일반 ${m.generalMaintenance || '(없음)'}`;

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const vehicles = await Vehicle.find({}).select('code carModel plateNo maintenance').lean();

  let changed = 0;
  const overwritten = []; // 순회정비 칸에 가입/미가입이 아닌 값(금액 등)이 들어 있던 차량

  for (const v of vehicles) {
    const before = v.maintenance || {};
    const after = normalizeMaintenance(before);

    const same = ['enabled', 'regularCheck', 'consumables', 'generalMaintenance']
      .every((key) => before[key] === after[key]);
    if (same) continue;

    // 가입/미가입이 아닌 값이 적혀 있었다면 지워지므로 따로 알려 준다
    for (const key of ['regularCheck', 'consumables']) {
      const raw = String(before[key] ?? '').trim();
      if (raw && raw !== '가입' && raw !== '미가입' && raw !== '-') {
        overwritten.push(`${v.code || v.carModel} · ${key === 'regularCheck' ? '순회정비' : '소모품교환'}에 적혀 있던 "${raw}"`);
      }
    }

    changed += 1;
    console.log(`  ${v.code || v.carModel}${v.plateNo ? ` (${v.plateNo})` : ''}`);
    console.log(`    이전: ${show(before)}`);
    console.log(`    이후: ${show(after)}`);

    if (!isDryRun) {
      await Vehicle.updateOne({ _id: v._id }, { $set: { maintenance: after } });
    }
  }

  if (overwritten.length) {
    console.log(`\n[확인 필요] 가입/미가입이 아닌 값이 적혀 있어 지워지는 칸 ${overwritten.length}건`);
    overwritten.forEach((line) => console.log(`  - ${line}`));
  }

  console.log(`\n[요약] ${changed}대 정리 (전체 ${vehicles.length}대)`);
  console.log(isDryRun ? '(DRY-RUN이라 아무것도 바꾸지 않았습니다)' : '(반영 완료)');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
