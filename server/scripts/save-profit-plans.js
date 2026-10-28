import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import VehicleLedger from '../models/VehicleLedger.js';
import { computeProfitPlan } from '../utils/ledgerProfitPlan.js';

dotenv.config();

/**
 * 장기렌트 원장에 '계약 손익 기준표'를 한 번에 저장한다(구상안 2단계, 2026-10-28).
 *
 * 정비비는 단가표 처음 값(지난 계약 기준)으로 낸다. 2026-10-28에 오른 단가로 지난 계약을 저장하지 않는다(utils/ledgerProfitPlan.js).
 * 기준표가 이미 있는 원장은 건드리지 않는다. 바꾸려면 화면의 [다시 계산](관리자)을 쓴다.
 * 기본은 보여 주기만 한다. 운영 DB에 쓰므로 결과를 보고 --apply를 붙인다.
 * 기존 값을 바꾸지 않고 profitPlans만 새로 넣지만, 쓰기 전에 대상 원장의 기준표 계산 결과를 backups/에 남긴다.
 *
 *   node scripts/save-profit-plans.js           무엇이 저장될지 보기
 *   node scripts/save-profit-plans.js --apply   저장
 */
const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);
try {
  const ledgers = await VehicleLedger.find({ ledgerType: '장기렌트', 'profitPlans.0': { $exists: false } })
    .select('ledgerNo status contract contractPeriods vehicle terms header profitPlans entries.side entries.category entries.amount entries.label').lean();

  const saved = [];
  const failed = [];
  for (const ledger of ledgers) {
    const result = await computeProfitPlan(ledger);
    if (!result.ok) { failed.push(`${ledger.ledgerNo} (${ledger.status}): ${result.reason}`); continue; }
    saved.push({ ledger, plan: { ...result.plan, savedAt: new Date(), savedBy: '프로그램(일괄 저장)', history: [] } });
  }

  const sum = (k) => saved.reduce((t, s) => t + (s.plan[k] || 0), 0);
  console.log(`장기렌트 원장 중 기준표 없는 ${ledgers.length}장 → 저장 ${saved.length} · 계산 못 함 ${failed.length}`);
  console.log(`  견적서 ${saved.filter((s) => s.plan.source === '견적서').length} · 추정 ${saved.filter((s) => s.plan.source === '추정').length}`);
  console.log(`  매출 ${sum('revenue').toLocaleString()}원 · 총 이자 ${sum('interestTotal').toLocaleString()}원 · 남는 금액 ${sum('operatingProfit').toLocaleString()}원`);
  failed.forEach((f) => console.log(`  계산 못 함 ${f}`));

  if (!apply) {
    console.log('시험 실행입니다. 저장하려면 --apply를 붙이세요.');
  } else if (saved.length) {
    const dir = path.resolve('backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `profit-plans_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(saved.map((s) => ({ _id: s.ledger._id, ledgerNo: s.ledger.ledgerNo, before: s.ledger.profitPlans || [], plan: s.plan })), null, 2));
    console.log(`  백업 ${file}`);
    // 기준표가 없는 원장만 바꾼다(그 사이 화면에서 저장한 원장은 건너뜀)
    const res = await VehicleLedger.bulkWrite(saved.map((s) => ({
      updateOne: { filter: { _id: s.ledger._id, 'profitPlans.0': { $exists: false } }, update: { $set: { profitPlans: [s.plan] } } }
    })));
    console.log(`  저장함 ${res.modifiedCount}장`);
  }
} finally {
  await mongoose.disconnect();
}
