/**
 * 손익 원장의 대출·상환 줄 분류를 다시 매긴다 (2026-10-04).
 *
 * 문제: "차량가-렌공대출"이 공제조합(출자금)으로, "메리츠12차 상환"이 기타로 분류되어
 * 수익성 검토가 대출 상환을 운영비로 계산했다(Benz-003은 1억 1천만 원).
 * 분류 규칙(pickLedgerCategory)은 고쳤지만, 이미 저장된 줄은 그대로라 여기서 다시 매긴다.
 *
 * 바꾸는 것 (이름에 '대출' 또는 '상환'이 들어간 줄만)
 *   - 분류: 상환 → 할부금 / 대출 입금 → 대출금 / 대출 출금 → 차량가 / 대출 이자 → 할부이자 ('수수료'가 들어간 줄은 그대로)
 *   - 할부금 줄의 회차: 이름의 "12차", "상환2차"에서 읽어 비어 있을 때만 채운다
 *   - 출처: 앱이 만든 "할부금 n회차"가 아닌데 자동 연동 줄(loan)로 잡힌 줄은 사람이 적은 줄(manual)로 돌린다
 * 금액·날짜·이름은 건드리지 않는다.
 *
 * 실행
 *   cd server
 *   node migrations/2026-10-04_reclassify_loan_entries.js            # 바뀔 내용만 보여 준다 (DB를 바꾸지 않음)
 *   node migrations/2026-10-04_reclassify_loan_entries.js --apply    # 백업을 남기고 실제로 바꾼다
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import VehicleLedger, { pickLedgerCategory, parseLoanRound } from '../models/VehicleLedger.js';

const APPLY = process.argv.includes('--apply');
const AUTO_LOAN_LABEL = /^할부금\s*\d+\s*회차$/;

const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);
  const ledgers = await VehicleLedger.find({ 'entries.label': { $regex: '대출|상환' } });

  const changes = [];
  for (const ledger of ledgers) {
    const lines = [];
    for (const e of ledger.entries) {
      const label = e.label || '';
      if (!/대출|상환/.test(label)) continue;

      const next = {
        category: pickLedgerCategory(label, e.side),
        round: e.round,
        source: e.source
      };
      if (next.category === '할부금' && !e.round) next.round = parseLoanRound(label);
      if (e.source === 'loan' && !AUTO_LOAN_LABEL.test(label)) next.source = 'manual';

      const diff = ['category', 'round', 'source'].filter((k) => (e[k] ?? null) !== (next[k] ?? null));
      if (!diff.length) continue;
      lines.push({ entry: e, next, diff });
    }
    if (lines.length) changes.push({ ledger, lines });
  }

  // 바뀔 내용 출력
  let lineCount = 0;
  for (const { ledger, lines } of changes) {
    console.log(`\n■ ${ledger.ledgerNo || ledger._id} (${ledger.ledgerType || '-'})`);
    for (const { entry, next, diff } of lines) {
      lineCount += 1;
      const parts = diff.map((k) => `${k}: ${entry[k] ?? '-'} → ${next[k] ?? '-'}`).join(', ');
      console.log(`  ${entry.side} ${won(entry.amount).padStart(13)}원  "${entry.label}"  [${parts}]`);
    }
  }
  console.log(`\n원장 ${changes.length}장, 줄 ${lineCount}개를 바꿉니다.`);

  if (!APPLY) {
    console.log('바뀔 내용만 보여 줬습니다. 실제로 바꾸려면 --apply를 붙여 다시 실행하세요.');
    await mongoose.disconnect();
    return;
  }

  // 백업: 바꾸는 원장 전체를 그대로 남긴다
  const backupDir = path.join(os.tmpdir(), 'rentbenefit-backup');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `vehicle_ledgers_before_loan_reclassify_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(changes.map(({ ledger }) => ledger.toObject()), null, 1));
  console.log(`백업: ${backupFile}`);

  for (const { ledger, lines } of changes) {
    for (const { entry, next } of lines) {
      entry.category = next.category;
      entry.round = next.round;
      entry.source = next.source;
    }
    await ledger.save();
  }
  console.log('반영했습니다.');
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
