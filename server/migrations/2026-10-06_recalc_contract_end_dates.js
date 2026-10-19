// 계약 만기일을 인도일 기준으로 다시 계산하는 스크립트.
//
// 배경: 만기일(Contract.endDate)이 '계약일 + 개월수'로 계산되고 있었다. 장기렌트 기간은 차량을 인도한 날부터
//       흐르므로(대표님 확인, 2026-10-06) 출고가 늦은 계약은 만기가 그만큼 앞당겨져 있었다.
//       예: 22040018(신흥정보통신 Ray Van 프레스티지 5대) 계약일 2022-04-14 · 인도 2022-06-27 → 만기 2027-04-14.
//
// 하는 일 (계약마다, utils/contractEndDate.js의 refreshContractEndDate와 같다):
// - 만기일: 가장 먼저 인도한 차의 인도일 + 개월수. 연장 계약은 계약일 + 개월수 그대로.
// - 계약의 인도일: 가장 먼저 인도한 차의 날짜로 맞춘다(비어 있거나 다를 때).
// - 캘린더 '렌트만료' 일정(예정인 것만): 차마다 자기 인도일 + 개월수.
//
// 고치지 않는 것: 원장(갑지)의 계약종료일. 엑셀에서 옮겨 온 값이 섞여 있어 따로 본다.
//
// 실행:
//   cd server && node migrations/2026-10-06_recalc_contract_end_dates.js --dry-run
//   cd server && node migrations/2026-10-06_recalc_contract_end_dates.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Contract from '../models/Contract.js';
import { planContractEndDate, refreshContractEndDate } from '../utils/contractEndDate.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '-');

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const contracts = await Contract.find({ termMonths: { $gt: 0 } })
    .select('contractNo status contractKind contractDate deliveryDate termMonths endDate vehicles vehicle')
    .sort({ contractNo: 1 })
    .lean();

  let changed = 0;
  for (const c of contracts) {
    const plan = await planContractEndDate(c);
    if (!Object.keys(plan.changes).length) continue;
    changed++;
    const parts = [];
    if (plan.changes.endDate) parts.push(`만기 ${d(c.endDate)} → ${d(plan.changes.endDate)}`);
    if (plan.changes.deliveryDate) parts.push(`인도일 ${d(c.deliveryDate)} → ${d(plan.changes.deliveryDate)}`);
    console.log(`  ${c.contractNo} [${c.status}${c.contractKind && c.contractKind !== '신규' ? '·' + c.contractKind : ''}] 계약일 ${d(c.contractDate)} · ${c.termMonths}개월 · ${parts.join(' · ')}`);
    if (!isDryRun) await refreshContractEndDate(c._id);
  }

  // 만기는 그대로여도 차마다 인도일이 달라 렌트만료 일정만 바뀌는 계약이 있다. 실제 실행 때는 모두 맞춘다.
  if (!isDryRun) {
    for (const c of contracts) await refreshContractEndDate(c._id);
  }

  console.log(`\n[요약] 계약 ${contracts.length}건 중 만기·인도일이 바뀌는 계약 ${changed}건${isDryRun ? ' (쓰지 않음)' : ' 반영 + 렌트만료 일정 정리'}`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
