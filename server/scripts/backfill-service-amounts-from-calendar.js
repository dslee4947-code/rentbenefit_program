import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import VehicleService from '../models/VehicleService.js';
import { listEventsBetween } from '../utils/googleCalendar.js';
import { parseServiceEvent, costPaidOf } from '../utils/calendarInboxSync.js';

/**
 * 구글 캘린더에서 옮겨 온 정비 기록 중 금액이 0인 것에 '점검 비용' 칸의 금액을 넣는다 (2026-11-17).
 * 정비포함(풀정비)이라도 회사가 냈으면 금액에 넣어야 차마다 얼마 썼는지 보인다(대표님).
 *
 * 넣지 않는 것:
 *  - 한 일정에서 나눈 둘째 칸(정기점검+자동차검사 등): 금액은 첫 칸에만 둔다
 *  - 같은 차·같은 종류의 원장 기록이 14일 안에 금액과 함께 있으면: 같은 돈을 두 번 세게 된다
 *  - 고객이 직접 낸 금액, 자기부담금만 적힌 경우(utils/calendarInboxSync.js costPaidOf)
 *
 *   node scripts/backfill-service-amounts-from-calendar.js          # 미리 보기
 *   node scripts/backfill-service-amounts-from-calendar.js --apply  # 반영 (먼저 backups/에 백업)
 */
const apply = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);

const records = await VehicleService.find({ source: 'calendar', calendarEventId: { $nin: [null, ''] }, $or: [{ amount: 0 }, { amount: null }] }).lean();
const ledger = await VehicleService.find({ source: 'ledger', amount: { $gt: 0 } }).select('vehicle plateNo kind date amount').lean();
const events = await listEventsBetween(new Date('2020-01-01T00:00:00Z'), new Date(Date.now() + 365 * 864e5));
const byId = new Map(events.map((e) => [e.id, e]));
const DAY = 864e5;

const updates = [];
const skipped = { second: 0, ledger: 0, none: 0, zero: 0 };
for (const r of records) {
  if (String(r.calendarEventId).includes('#')) { skipped.second += 1; continue; }
  const ev = byId.get(r.calendarEventId);
  if (!ev) continue;
  const p = parseServiceEvent(ev);
  const costText = (p.text.match(/^\s*점검 비용\s*:(.*)$/m) || [])[1] || '';
  const amount = costPaidOf(costText);
  if (amount === undefined) { skipped.none += 1; continue; }
  if (!amount) { skipped.zero += 1; continue; }
  // 같은 차(예전 차량 문서에 붙은 원장 기록도 번호판으로)·같은 묶음(고장·사고 수리는 한 묶음)의 원장 금액이 14일 안에 있으면 뺀다
  const group = (k) => (['고장수리', '사고수리'].includes(k) ? '수리' : k);
  const dup = ledger.find((l) => (String(l.vehicle) === String(r.vehicle) || (l.plateNo && l.plateNo === r.plateNo)) && group(l.kind) === group(r.kind) && Math.abs(new Date(l.date) - new Date(r.date)) <= 14 * DAY);
  if (dup) { skipped.ledger += 1; continue; }
  updates.push({ r, amount, costText: costText.trim() });
}

console.log(`금액 0인 캘린더 기록 ${records.length}건 → 넣을 것 ${updates.length}건`);
console.log(`뺀 것: 둘째 칸 ${skipped.second} · 원장에 같은 금액 ${skipped.ledger} · 금액 못 읽음 ${skipped.none} · 무상 ${skipped.zero}`);
updates.forEach(({ r, amount, costText }) => console.log(`  ${r.plateNo} ${r.date.toISOString().slice(0, 10)} ${r.kind} ${amount.toLocaleString()}원 ← ${costText.slice(0, 70)}`));

if (apply && updates.length) {
  fs.mkdirSync('backups', { recursive: true });
  const file = `backups/vehicleservices-before-amounts-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  fs.writeFileSync(file, JSON.stringify(updates.map((u) => u.r)));
  await VehicleService.bulkWrite(updates.map(({ r, amount }) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { amount, payer: r.payer || '회사 부담' } } } })));
  console.log(`반영했습니다. 백업: ${file}`);
}
await mongoose.disconnect();
