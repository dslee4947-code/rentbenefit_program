// 구글 캘린더(업무캘린더) 정비 일정을 차량 정비·검사 기록(VehicleService)으로 옮긴다.
//
// 배경: 2021-10 ~ 2026-10 업무캘린더 일정 16,970건에서 렌트베네핏 차량의 정비·검사·수리 일정을 골라냈다.
//       (차를 찾는 방법: 제목의 차량번호 / 작업 줄 "< 차종 / 차량번호 > AS" / 본문 "차량번호 : …" 줄 /
//        계약사 이름 + 차종. 고객 차를 고치는 동안 우리 차를 빌려준 대차 기록은 뺐다.)
//       골라낸 결과(JSON)는 고객 이름이 들어 있어 저장소에 두지 않고 실행할 때 경로로 넘긴다.
//       대표님 "일단 옮겨줘"(2026-10-19).
//
// - source: 'calendar', calendarEventId로 표시한다. 다시 돌려도 같은 일정은 건너뛴다.
//   되돌리려면: VehicleService.deleteMany({ source: 'calendar' })
// - 한 일정에 여러 가지를 함께 했으면 종류마다 기록을 하나씩 둔다(splitKinds,
//   calendarEventId 뒤에 '#정기점검'·'#자동차검사'). 종류 기준이 바뀌면 캘린더 기록을 지우고 다시 돌린다.
// - 정기점검은 차마다 날짜순으로 회차(checkRound)를 다시 매긴다.
// - 계약사 이름만으로 찾은 건(차종·번호 없음)은 메모에 "확인 필요"를 남긴다.
// - 오늘 이후 날짜는 '예정'으로 넣는다.
// - 기록의 주행거리가 차량의 현재 주행거리보다 크면 올린다(계기판은 거꾸로 가지 않는다).
//
// 실행:
//   cd server && node migrations/2026-10-19_import_calendar_services.js <records.json> --dry-run
//   cd server && node migrations/2026-10-19_import_calendar_services.js <records.json>

import fs from 'fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import VehicleService from '../models/VehicleService.js';
import Vehicle from '../models/Vehicle.js';
import { syncVehicleServiceSchedules } from '../utils/vehicleServiceScheduleJob.js';

dotenv.config();
mongoose.set('autoIndex', false);

const file = process.argv[2];
const isDryRun = process.argv.includes('--dry-run');
if (!file || !fs.existsSync(file)) {
  console.error('사용법: node migrations/2026-10-19_import_calendar_services.js <records.json> [--dry-run]');
  process.exit(1);
}

const BASIS = {
  plateTitle: '일정 제목의 차량번호',
  plateHeader: '작업 줄의 차량번호',
  plateBody: '본문 차량번호 줄',
  nameModel: '계약사 이름 + 차종',
  nameOnly: '확인 필요 - 계약사 이름만으로 찾음(차종·번호 없음)'
};
// 양식의 다음 칸 이름("점검 안내 전화 :")이 빈 칸에 딸려 들어온 경우는 빈 글로 본다
const FORM_LABEL = /^(\d+\.\s*)?(점검 안내 전화|픽업후 확인전화|입고후 확인전화|점검 비용|인도 확인 전화)\s*:?\s*$/;
const oneLine = (s) => {
  const t = String(s || '').replace(/고객님성향및기분[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
  return FORM_LABEL.test(t) ? '' : t;
};
// 한 일정에서 여러 가지를 함께 한 경우 종류마다 기록을 하나씩 둔다. 하나로만 두면 횟수와 다음 날짜가 틀어진다.
// - "정기점검"이나 "엔진오일"이 있으면 정기점검을 한 것으로 센다(대표님 2026-10-19).
//   소모품교환·기타로 나뉜 건은 종류를 정기점검으로 바꾸고, 검사·수리 건에는 정기점검 기록을 하나 더 둔다.
// - 점검 의뢰에 자동차검사가 있거나 점검 내용에 "검사 완료·합격"이 있으면 자동차검사 기록을 하나 더 둔다.
//   제목만 보지 않는다. 제목은 "자동차 검사 6회차"처럼 실제 작업과 다르게 붙는 일이 있다.
const CHECK_WORD = /정기\s*점검|엔진\s*오일/;
const INSPECT_WORD = /자동차\s*(정기|종합)?\s*검사|종합\s*검사|정기\s*검사/;
// 재검사·부적합·검사대행은 검사소에 다녀왔다는 뜻이라 제목에 있어도 검사로 센다(예: "자동차 검사 부적합" 일정)
const RE_INSPECT = /재검사|검사\s*부적합|검사\s*대행/;
const inspectionDone = (r) => INSPECT_WORD.test(r.ask || '')
  || (INSPECT_WORD.test(r.done || '') && /완료|합격|통과|적합/.test(r.done || ''))
  || RE_INSPECT.test(`${r.title} ${r.ask} ${r.done}`);
const splitKinds = (r) => {
  const text = `${r.title} ${r.ask} ${r.done}`;
  const kind = ['소모품교환', '기타'].includes(r.kind) && CHECK_WORD.test(text) ? '정기점검' : r.kind;
  const out = [{ ...r, kind }];
  if (kind !== '정기점검' && CHECK_WORD.test(text)) out.push({ ...r, kind: '정기점검', eventId: `${r.eventId}#정기점검` });
  if (kind !== '자동차검사' && inspectionDone(r)) out.push({ ...r, kind: '자동차검사', eventId: `${r.eventId}#자동차검사` });
  return out;
};
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);
  const { records: raw } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const records = raw.flatMap(splitKinds);
  const today = kstToday();

  // 이미 옮긴 일정은 건너뛴다
  const done = new Set((await VehicleService.find({ source: 'calendar' }).select('calendarEventId vehicle').lean())
    .map((r) => `${r.calendarEventId}|${r.vehicle}`));
  const todo = records.filter((r) => !done.has(`${r.eventId}|${r.vehicleId}`))
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.date.localeCompare(b.date));

  const docs = [];
  for (const r of todo) {
    docs.push({
      vehicle: r.vehicleId,
      plateNo: r.plateNo,
      kind: r.kind,
      date: new Date(`${r.date}T00:00:00+09:00`),
      status: r.date > today ? '예정' : '완료',
      mileage: r.mileage || undefined,
      amount: 0, // 캘린더의 비용 칸은 글("무상", "베네핏 납부 776,536원 + 45,000")이라 금액으로 옮기지 않고 메모에 둔다
      shop: oneLine(r.shop),
      staff: r.staff || '',
      request: oneLine(r.ask),
      description: oneLine(r.done),
      memo: [
        `구글 캘린더 이관: ${r.title}`,
        r.cost ? `비용: ${oneLine(r.cost)}` : '',
        `찾은 근거: ${BASIS[r.matchedBy] || r.matchedBy}`
      ].filter(Boolean).join(' / '),
      source: 'calendar',
      calendarEventId: r.eventId,
      createdBy: '구글 캘린더 이관'
    });
  }

  const kinds = {};
  docs.forEach((d) => { kinds[d.kind] = (kinds[d.kind] || 0) + 1; });
  console.log(`[대상] 넣을 기록 ${docs.length}건 (이미 넣은 ${records.length - todo.length}건 건너뜀) · 차량 ${new Set(docs.map((d) => String(d.vehicle))).size}대`);
  console.log(`[종류] ${JSON.stringify(kinds)}`);
  console.log(`[확인 필요] ${docs.filter((d) => d.memo.includes('확인 필요')).length}건 · [예정] ${docs.filter((d) => d.status === '예정').length}건`);

  // 주행거리: 차마다 가장 큰 값
  const maxKm = new Map();
  docs.forEach((d) => { if (d.mileage) maxKm.set(String(d.vehicle), Math.max(maxKm.get(String(d.vehicle)) || 0, d.mileage)); });
  let raised = 0;
  for (const [vid, km] of maxKm) {
    const v = await Vehicle.findById(vid).select('currentMileage plateNo').lean();
    if (v && (v.currentMileage || 0) < km) {
      raised += 1;
      if (!isDryRun) await Vehicle.updateOne({ _id: vid, currentMileage: { $lt: km } }, { $set: { currentMileage: km } });
    }
  }
  console.log(`[주행거리] 차량 현재 주행거리를 올릴 차 ${raised}대`);

  if (!isDryRun && docs.length) {
    await VehicleService.collection.createIndex(
      { calendarEventId: 1, vehicle: 1 },
      { unique: true, partialFilterExpression: { calendarEventId: { $type: 'string' } } }
    );
    const res = await VehicleService.insertMany(docs, { ordered: false });
    console.log(`[넣음] ${res.length}건`);
  }

  // 먼저 옮긴 기록 중 작업 내용 칸에 양식 글자만 들어간 것을 비운다
  const junk = (await VehicleService.find({ source: 'calendar' }).select('description').lean())
    .filter((r) => r.description && !oneLine(r.description));
  console.log(`[작업 내용 정리] 양식 글자만 있던 칸 ${junk.length}건 비움`);
  if (!isDryRun && junk.length) {
    await VehicleService.updateMany({ _id: { $in: junk.map((r) => r._id) } }, { $set: { description: '' } });
  }

  // 정기점검 회차는 차마다 날짜순으로 다시 매긴다(사이에 끼어 들어간 기록이 있어도 순서가 맞게)
  const vehicleIds = new Set([...docs.map((d) => String(d.vehicle)), ...(await VehicleService.distinct('vehicle', { source: 'calendar' })).map(String)]);
  let renumbered = 0;
  for (const vid of vehicleIds) {
    const checks = await VehicleService.find({ vehicle: vid, kind: '정기점검' }).sort({ date: 1, createdAt: 1 }).select('checkRound').lean();
    for (const [i, c] of checks.entries()) {
      if (c.checkRound === i + 1) continue;
      renumbered += 1;
      if (!isDryRun) await VehicleService.updateOne({ _id: c._id }, { $set: { checkRound: i + 1 } });
    }
  }
  console.log(`[회차] 정기점검 회차 ${renumbered}건 다시 매김`);

  if (!isDryRun) {
    await syncVehicleServiceSchedules();
    console.log('[캘린더] 다음 검사·점검 일정을 다시 맞췄습니다.');
  }
  console.log(`[최종] 정비·검사 기록 ${await VehicleService.countDocuments()}건 (캘린더 이관 ${await VehicleService.countDocuments({ source: 'calendar' })}건)`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('이관 중 오류:', err);
  await mongoose.disconnect();
  process.exit(1);
});
