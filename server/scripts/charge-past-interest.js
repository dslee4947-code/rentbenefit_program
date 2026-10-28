import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import BillingSchedule from '../models/BillingSchedule.js';
import Contract from '../models/Contract.js';
import { recalcRound } from '../controllers/billingScheduleController.js';

dotenv.config();

/**
 * 지난 회차들의 '받지 않은 연체 이자'(unbilledInterest)를 모아 아직 발행하지 않은 청구서 한 장에 넣는다.
 *
 * 대표님 지시(2026-10-28): 동춘푸드 미청구 이자 총합을 청구서에 넣고, 보관함에서 내역을 볼 수 있게.
 * 금액은 기타 청구 한 줄(extras)로 들어가 합계에 잡히고, 어느 회차 이자인지는 pastInterestCharge에 남는다.
 * 지난 회차의 unbilledInterest는 지우지 않는다(그때 청구하지 않은 것은 사실이고, 보관함이 'n회차에서 청구'로 보여 준다).
 *
 * 이미 다른 청구서에 모아 청구한 이자는 다시 넣지 않는다. 같은 회차에 다시 돌리면 내역을 새로 맞춘다.
 * 기본은 보여 주기만 한다. 운영 DB에 쓰므로 결과를 보고 --apply를 붙인다. 쓰기 전에 회차표를 backups/에 남긴다.
 *
 *   node scripts/charge-past-interest.js 23090033            다음 미발행 회차에 넣으면 어떻게 되는지 보기
 *   node scripts/charge-past-interest.js 23090033 37 --apply  37회차 청구서에 넣는다
 */

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const [contractNo, roundArg] = args;
if (!contractNo) {
  console.error('사용법: node scripts/charge-past-interest.js <계약번호> [회차] [--apply]');
  process.exit(1);
}

const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);
try {
  const contract = await Contract.findOne({ contractNo }).select('contractNo contractorName leaseCompany').lean();
  if (!contract) throw new Error(`계약 ${contractNo}을(를) 찾지 못했습니다.`);
  const schedule = await BillingSchedule.findOne({ contract: contract._id });
  if (!schedule) throw new Error('회차표가 없습니다.');

  const rounds = [...schedule.rounds].sort((a, b) => a.no - b.no);
  const target = roundArg
    ? rounds.find((r) => r.no === Number(roundArg))
    : rounds.find((r) => !r.issuedAt && r.status === '예정');
  if (!target) throw new Error('넣을 회차를 찾지 못했습니다.');
  if (target.issuedAt) throw new Error(`${target.no}회차는 이미 발행했습니다. 보낸 청구서 금액은 바꾸지 않습니다.`);

  // 다른 회차에서 이미 모아 청구한 이자는 뺀다
  const elsewhere = new Set(rounds.filter((r) => r.no !== target.no)
    .flatMap((r) => (r.pastInterestCharge?.items || []).map((it) => `${it.onNo}:${it.fromNo}`)));
  const items = rounds
    .filter((r) => r.no < target.no)
    .flatMap((r) => (r.unbilledInterest?.items || []).map((it) => ({
      onNo: r.no, fromNo: it.fromNo, principal: it.principal, from: it.from, to: it.to, days: it.days, rate: it.rate, amount: it.amount
    })))
    .filter((it) => !elsewhere.has(`${it.onNo}:${it.fromNo}`) && Number(it.amount) > 0);
  if (!items.length) throw new Error('모아 청구할 미청구 이자가 없습니다.');

  const amount = items.reduce((s, it) => s + it.amount, 0);
  const firstNo = Math.min(...items.map((it) => it.onNo));
  const lastNo = Math.max(...items.map((it) => it.onNo));
  const label = `지난 연체 이자 (${firstNo}~${lastNo}회차 청구서 미청구분 ${items.length}건)`;

  console.log(`${contract.leaseCompany || contract.contractorName} (${contract.contractNo}) → ${target.no}회차 (${kst(target.dueDate)}) 청구서`);
  for (const it of items) {
    console.log(`  ${it.onNo}회 청구서 · ${it.fromNo}회분 ${it.principal.toLocaleString()}원 × ${it.rate}% × ${it.days}일 (${kst(it.from)}~${kst(it.to)}) = ${it.amount.toLocaleString()}원`);
  }
  console.log(`  합계 ${amount.toLocaleString()}원 · 줄 이름 "${label}"`);

  const before = target.total;
  const oldLabel = target.pastInterestCharge?.label;
  const extras = (target.extras || []).filter((e) => e.label !== oldLabel).map((e) => ({ label: e.label, amount: e.amount }));
  // 기타 청구가 비어 있으면서 other만 적혀 있던 예전 방식이면, 그 금액을 줄로 살려 둔다(합계가 extras로 다시 계산되므로)
  if (!(target.extras || []).length && Number(target.other) > 0) extras.push({ label: '기타 청구', amount: target.other });
  extras.push({ label, amount });

  if (!apply) {
    console.log(`  청구 합계 ${before.toLocaleString()}원 → ${(before - (target.pastInterestCharge?.amount || 0) + amount).toLocaleString()}원 (시험 실행, 저장 안 함. --apply로 저장)`);
  } else {
    const dir = path.resolve('backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `billing-schedule_${contract.contractNo}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(schedule.toObject(), null, 2));
    console.log(`  백업 ${file}`);

    target.extras = extras;
    target.pastInterestCharge = { label, amount, chargedAt: new Date(), items };
    recalcRound(target);
    schedule.markModified('rounds');
    await schedule.save();
    console.log(`  저장함 · 청구 합계 ${before.toLocaleString()}원 → ${target.total.toLocaleString()}원`);
  }
} finally {
  await mongoose.disconnect();
}
