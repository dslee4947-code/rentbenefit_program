// 렌트차량 DB의 이익금과 이익률(회사수수료)을 계산해 채우는 스크립트.
//
// 계산식은 견적서와 같다(utils/vehicleProfit.js).
//
//   매출   = 월 렌트료 x 개월수 + 인수가 + 선수금
//   원가   = 보험료(기본 연 80만 + 자차) + 자동차세 + 할부 시 총구입가(기간별 금리 반영)
//            + 등록비용 + 판관비(차량가 3%) + 딜러수수료 (+ 정비 가입이면 월 5만 · 타이어 16만/본)
//   이익금 = 매출 - 원가
//   이익률 = 이익금 / 차량가   -> 화면의 '회사수수료' 칸
//
// 렌트 기간은 차량에 없어 계약에서 가져온다. 기간이나 월 렌트료가 없는 차량은 건너뛴다.
//
// 실행:
//   cd server && node migrations/2026-09-04_fill_vehicle_profit.js --dry-run
//   cd server && node migrations/2026-09-04_fill_vehicle_profit.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Vehicle from '../models/Vehicle.js';
import Contract from '../models/Contract.js';
import { calculateVehicleProfit } from '../utils/vehicleProfit.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');
const won = (n) => `${Math.round(n).toLocaleString()}원`;

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const vehicles = await Vehicle.find({})
    .populate({ path: 'contract', model: Contract, select: 'termMonths rentPeriodYears' })
    .lean();

  const skipped = {};
  const done = [];

  for (const v of vehicles) {
    const termMonths = Number(v.paymentTerm)
      || Number(v.contract?.termMonths)
      || Number(v.contract?.rentPeriodYears || 0) * 12;

    const profit = calculateVehicleProfit(v, termMonths);
    if (!profit.ok) {
      skipped[profit.reason] = (skipped[profit.reason] || 0) + 1;
      continue;
    }

    const rate = Math.round(profit.profitRatePercent * 100) / 100;
    const amount = Math.round(profit.profitAmount);
    done.push({ v, profit, rate, amount });

    if (!isDryRun) {
      await Vehicle.updateOne({ _id: v._id }, { $set: { profitAmount: amount, companyCommission: rate } });
    }
  }

  const sorted = [...done].sort((a, b) => b.amount - a.amount);
  console.log(`\n[계산 결과] ${done.length}대`);
  sorted.forEach(({ v, profit, rate, amount }) => {
    const mark = amount < 0 ? ' ⚠ 적자' : '';
    console.log(`  ${(v.code || v.carModel || '').padEnd(14)} ${String(profit.termMonths).padStart(2)}개월 · 월 ${won(v.monthlyFee).padStart(12)}`
      + ` -> 이익금 ${won(amount).padStart(14)} · 이익률 ${rate.toFixed(2).padStart(7)}%${mark}`);
  });

  console.log('\n[건너뛴 차량]');
  if (Object.keys(skipped).length === 0) console.log('  없음');
  Object.entries(skipped).forEach(([reason, count]) => console.log(`  ${count}대  ${reason}`));

  const negative = done.filter((d) => d.amount < 0);
  const rates = done.map((d) => d.rate).sort((a, b) => a - b);
  console.log(`\n[요약] 채움 ${done.length}대 · 적자 ${negative.length}대`);
  if (rates.length) {
    console.log(`  이익률 ${rates[0].toFixed(2)}% ~ ${rates[rates.length - 1].toFixed(2)}% (가운데값 ${rates[Math.floor(rates.length / 2)].toFixed(2)}%)`);
  }
  if (done[0]) {
    console.log('\n[가정한 값]');
    done[0].profit.assumptions.forEach((a) => console.log(`  - ${a}`));
  }
  console.log(isDryRun ? '\n(DRY-RUN이라 아무것도 바꾸지 않았습니다)' : '\n(반영 완료)');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
