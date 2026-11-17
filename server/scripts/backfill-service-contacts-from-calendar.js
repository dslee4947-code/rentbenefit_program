import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import VehicleService from '../models/VehicleService.js';
import Vehicle from '../models/Vehicle.js';
import { listEventsBetween } from '../utils/googleCalendar.js';
import { parseServiceEvent } from '../utils/calendarInboxSync.js';

/**
 * 구글 캘린더에서 옮겨 온 정비 기록에 연락처·픽업지·전화 기록을 채운다 (2026-11-17).
 *
 * 예전 이관은 양식 위의 "유현승 교수님 / 010-…"와 주소 줄을 옮기지 않았다.
 * 다음 정기점검을 새로 적을 때 지난 기록에서 연락처·픽업지가 따라오게 하려면 예전 기록에도 값이 있어야 한다.
 * 비어 있는 칸만 채운다. 정비소 칸에 양식 안내 글자("입고지 / 담당자")만 남은 것은 비운다.
 *
 *   node scripts/backfill-service-contacts-from-calendar.js          # 미리 보기
 *   node scripts/backfill-service-contacts-from-calendar.js --apply  # 반영 (먼저 backups/에 백업)
 */
const apply = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);

const records = await VehicleService.find({ source: 'calendar', calendarEventId: { $nin: [null, ''] } }).lean();
const events = await listEventsBetween(new Date('2020-01-01T00:00:00Z'), new Date(Date.now() + 365 * 864e5));
const byId = new Map(events.map((e) => [e.id, e]));
console.log(`기록 ${records.length}건 · 캘린더 일정 ${events.length}건`);

const PLACEHOLDER = /^\s*입고지\s*\/\s*담당자\s*$/;
const updates = [];
let missing = 0;
for (const r of records) {
  const set = {};
  if (PLACEHOLDER.test(r.shop || '')) set.shop = '';
  const ev = byId.get(String(r.calendarEventId).split('#')[0]);
  if (!ev) { missing += 1; if (Object.keys(set).length) updates.push({ r, set }); continue; }
  const p = parseServiceEvent(ev);
  // 본문의 차량번호가 이 차가 아니면(대차로 적힌 차 등) 연락처·주소를 옮기지 않는다
  if (p.plateNo && r.plateNo && p.plateNo !== String(r.plateNo).replace(/\s+/g, '')) { if (Object.keys(set).length) updates.push({ r, set }); continue; }
  for (const k of ['contactName', 'contactPhone', 'callAfterIn', 'callGuide', 'callAfterOut']) if (!r[k] && p[k]) set[k] = p[k];
  if (p.pickupPlace && !r.transport?.in?.from) set['transport.in.from'] = p.pickupPlace;
  if (p.pickupPlace && !r.transport?.out?.to) set['transport.out.to'] = p.pickupPlace;
  if (p.notes && !String(r.memo || '').includes(p.notes)) set.memo = [`특이사항: ${p.notes}`, r.memo].filter(Boolean).join(' / ');
  // 주행거리가 빠진 기록(방문정비의 '방문 :' 줄 등, 2026-11-17 142호8391)
  if (!r.mileage && !r.mileageIn && !r.mileageOut && (p.mileageOut || p.mileageIn)) {
    set.mileage = p.mileageOut || p.mileageIn;
    if (p.mileageIn) set.mileageIn = p.mileageIn;
    if (p.mileageOut) set.mileageOut = p.mileageOut;
  }
  if (Object.keys(set).length) updates.push({ r, set });
}

const count = (k) => updates.filter((u) => u.set[k] !== undefined).length;
console.log(`일정을 못 찾음 ${missing}건 · 고칠 기록 ${updates.length}건`);
console.log(`연락처 ${count('contactName') || count('contactPhone')} · 픽업지 ${count('transport.in.from')} · 특이사항 ${count('memo')} · 정비소 안내 글자 비움 ${count('shop')} · 주행거리 ${count('mileage')}`);
updates.filter((u) => u.set.mileage).forEach(({ r, set }) => console.log('  주행거리', r.plateNo, r.date.toISOString().slice(0, 10), r.kind, set.mileage));
updates.slice(0, 8).forEach(({ r, set }) => console.log(' ', r.plateNo, String(r.date.toISOString()).slice(0, 10), r.kind, JSON.stringify(set).slice(0, 200)));

if (apply && updates.length) {
  fs.mkdirSync('backups', { recursive: true });
  // 같은 날 여러 번 돌려도 앞 백업을 덮어쓰지 않게 시각까지 붙인다
  const file = `backups/vehicleservices-before-contacts-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  fs.writeFileSync(file, JSON.stringify(updates.map((u) => u.r)));
  await VehicleService.bulkWrite(updates.map(({ r, set }) => ({ updateOne: { filter: { _id: r._id }, update: { $set: set } } })));
  console.log(`반영했습니다. 백업: ${file}`);
  // 차량의 지금 주행거리는 더 큰 값으로만 올린다
  for (const { r, set } of updates.filter((u) => u.set.mileage)) {
    // eslint-disable-next-line no-await-in-loop
    await Vehicle.updateOne({ _id: r.vehicle, $or: [{ currentMileage: { $lt: set.mileage } }, { currentMileage: null }] }, { $set: { currentMileage: set.mileage } });
  }
}
await mongoose.disconnect();
