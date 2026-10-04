// 2026-10-04_backfill_round_payments_from_ledgers.js가 잘못 짝지은 회차를 되돌리는 일회성 스크립트.
//
// 재계약한 계약 4건(21110022_1, 21110029, 22040024, 22030011)은 프로그램의 계약일이 재계약 날짜로 바뀌어 있는데,
// 원장의 1~N회차는 최초 계약 때의 입금이었다. 그래서 2023년에 들어온 11회차 입금이 재계약 회차표의
// 11회차(2026-10 출금)에 붙었다. 입금일이 출금일보다 1년 넘게 앞선 회차 93건이 모두 이 4건에 있었다.
//
// 그 회차를 반영 전 백업 그대로(예정, 입금액 없음) 되돌린다.
//
// 실행 (기본은 미리보기)
//   cd server && node migrations/2026-10-04_revert_mismatched_backfill.js <백업 JSON 경로>
//   cd server && node migrations/2026-10-04_revert_mismatched_backfill.js <백업 JSON 경로> --apply

import fs from 'fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const backupPath = process.argv.find((a) => a.endsWith('.json'));
// 입금일이 출금일보다 이만큼 넘게 앞서면 같은 회차가 아니다(미리 낸 렌트료도 한두 달 앞이 고작이었다)
const MAX_LEAD_DAYS = 45;

const main = async () => {
  if (!backupPath || !fs.existsSync(backupPath)) throw new Error('반영 전 백업 JSON 경로를 주세요.');
  const backup = new Map(JSON.parse(fs.readFileSync(backupPath, 'utf-8')).map((s) => [String(s._id), s]));

  await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  console.log(`[모드] ${APPLY ? '실제 되돌리기 (--apply)' : '미리보기 (쓰지 않음)'}  DB: ${db.databaseName}`);

  const schedules = await db.collection('billingschedules').find({}).toArray();
  let total = 0;
  for (const s of schedules) {
    const before = backup.get(String(s._id));
    const set = {};
    const unset = {};
    s.rounds.forEach((r, idx) => {
      if (r.status !== '입금완료' || !r.paidAt) return;
      const lead = (new Date(r.dueDate) - new Date(r.paidAt)) / 864e5;
      if (lead <= MAX_LEAD_DAYS) return;
      const old = before?.rounds?.find((x) => x.no === r.no);
      // 반영 전에 이미 입금완료였던 회차는 이 스크립트가 만든 것이 아니므로 건드리지 않는다
      if (!old || old.status === '입금완료') return;
      set[`rounds.${idx}.status`] = old.status;
      set[`rounds.${idx}.paidAmount`] = old.paidAmount || 0;
      if (old.paidAt) set[`rounds.${idx}.paidAt`] = old.paidAt;
      else unset[`rounds.${idx}.paidAt`] = '';
      total += 1;
    });
    if (!Object.keys(set).length) continue;
    if (APPLY) {
      await db.collection('billingschedules').updateOne(
        { _id: s._id },
        { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }
      );
    }
  }
  console.log(`${APPLY ? '되돌림' : '되돌릴 회차'}: ${total}건`);
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error('실패:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
