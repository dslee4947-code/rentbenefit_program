import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Vehicle from '../models/Vehicle.js';
import VehicleLedger from '../models/VehicleLedger.js';
import VehicleService from '../models/VehicleService.js';
import { planVehicle, kstYmd } from '../utils/vehicleServicePlan.js';
import { SERVICE_ACTIVE_STATUSES } from '../utils/vehicleServiceScheduleJob.js';

dotenv.config();

/**
 * 원장(갑지)에 적힌 검사비·정기점검·수리비 줄을 정비·검사 기록(VehicleService)으로 옮긴다.
 *
 * 다음 검사·점검 날짜는 기록으로 계산하는데, 지금까지의 기록은 원장에 돈으로만 남아 있다.
 * 옮기지 않으면 모든 차가 '한 번도 검사 안 받음'으로 떠서 진짜 놓친 차를 가려낼 수 없다.
 *
 * 원장 줄 하나는 한 번만 옮긴다(ledgerEntryId). 두 번 돌려도 겹치지 않는다.
 * 기본은 보여 주기만 한다. 운영 DB에 쓰므로 결과를 보고 --apply를 붙여 다시 돌린다.
 *
 *   node scripts/import-vehicle-services-from-ledger.js            무엇을 옮길지 보기만 (저장 안 함)
 *   node scripts/import-vehicle-services-from-ledger.js --apply    실제로 옮긴다
 */

const apply = process.argv.includes('--apply');

// 원장 분류 → 기록 종류
const KIND_BY_CATEGORY = { 검사비: '자동차검사', 정기점검: '정기점검', '수리·사고': '고장수리' };

// 수리·사고 줄 중 사고로 고친 것. 나머지는 고장수리로 본다.
const ACCIDENT_PATTERN = /사고|면책|본인\s*부담/;

// 정비가 아닌 줄. 휴차료·대차비는 차를 고친 게 아니라 못 쓴 기간의 돈이고,
// 상대방 수리비·손해보상금은 남의 차에 낸 돈, 쿠폰은 미리 산 것이라 그날 정비한 게 아니다.
const NOT_SERVICE_PATTERN = /휴차|대차|쿠폰|보상금|상대방/;

// 부가세만 따로 적은 줄. 정비 한 건이 두 줄로 들어간 것이라 옮기되 메모로 표시한다.
const VAT_PATTERN = /부가세/;

/**
 * 원장 줄 하나를 기록으로 바꾼다. 옮기지 않을 줄이면 { skip: 이유 }.
 */
const toService = (entry) => {
  const label = String(entry.label || '');
  if (entry.side === '입금') return { skip: '들어온 돈(고객 부담금 입금 등)' };
  if (!entry.date) return { skip: '날짜 없음' };
  if (!(Number(entry.amount) > 0)) return { skip: '0원·마이너스(상계)' };
  if (NOT_SERVICE_PATTERN.test(label)) return { skip: '정비 아님(휴차·대차·보상금·쿠폰)' };

  let kind = KIND_BY_CATEGORY[entry.category];
  if (kind === '고장수리' && ACCIDENT_PATTERN.test(`${label} ${entry.memo || ''}`)) kind = '사고수리';
  const vat = VAT_PATTERN.test(label);
  return {
    kind,
    vat,
    date: entry.date,
    amount: Number(entry.amount),
    description: label,
    memo: vat ? '부가세 줄 (원장 이관, 본 금액은 다른 줄)' : '원장 이관'
  };
};

const main = async () => {
  // 시험 실행에서는 색인도 만들지 않는다. 모델을 불러오기만 해도 운영 DB에 색인을 만들려 하기 때문이다.
  mongoose.set('autoIndex', apply);
  mongoose.set('autoCreate', apply);
  await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI, { autoIndex: apply, autoCreate: apply });
  if (apply) await VehicleService.init(); // ledgerEntryId 유일 색인을 먼저 세워 겹침을 막는다

  const ledgers = await VehicleLedger.find({ 'entries.category': { $in: Object.keys(KIND_BY_CATEGORY) } })
    .select('ledgerNo vehicle header.plateNo entries')
    .lean();
  const vehicles = await Vehicle.find({}).select('plateNo status registrationDate deliveryDate rentBillingDate maintenance carModel').lean();
  const byId = new Map(vehicles.map((v) => [String(v._id), v]));
  const byPlate = new Map(vehicles.filter((v) => v.plateNo).map((v) => [v.plateNo.replace(/\s+/g, ''), v]));
  const already = new Set((await VehicleService.find({ ledgerEntryId: { $ne: null } }).select('ledgerEntryId').lean())
    .map((r) => String(r.ledgerEntryId)));

  // 같은 검사·점검이 캘린더 이관 기록이나 앞서 고른 원장 줄(본 금액·부가세 두 줄)에 이미 있으면 건너뛴다.
  // 원장은 돈을 낸 날이라 실제 날짜와 며칠 어긋나므로 10일 안이면 같은 건으로 본다.
  // 두 번 세면 정기점검 횟수가 부풀고 회차가 어긋난다.
  const SAME_WITHIN_DAYS = 10;
  const DEDUPE_KINDS = ['자동차검사', '정기점검'];
  const seen = (await VehicleService.find({ kind: { $in: DEDUPE_KINDS } }).select('vehicle kind date').lean())
    .map((r) => ({ vehicle: String(r.vehicle), kind: r.kind, t: new Date(r.date).getTime() }));
  const isDuplicate = (vehicleId, kind, date) => DEDUPE_KINDS.includes(kind) && seen.some((s) => s.vehicle === String(vehicleId)
    && s.kind === kind && Math.abs(s.t - new Date(date).getTime()) <= SAME_WITHIN_DAYS * 864e5);

  const toCreate = [];
  const skipped = {};
  const noVehicle = new Set();
  let existing = 0;
  let viaPlate = 0;

  for (const ledger of ledgers) {
    // 원장이 차량과 이어지지 않은 것이 있다(엑셀에서 옮긴 갑지). 차량번호로 찾는다.
    let vehicle = ledger.vehicle ? byId.get(String(ledger.vehicle)) : null;
    if (!vehicle && ledger.header?.plateNo) {
      vehicle = byPlate.get(String(ledger.header.plateNo).replace(/\s+/g, ''));
      if (vehicle) viaPlate += 1;
    }

    for (const entry of ledger.entries || []) {
      if (!KIND_BY_CATEGORY[entry.category]) continue;
      if (already.has(String(entry._id))) { existing += 1; continue; }
      if (!vehicle) { noVehicle.add(`${ledger.ledgerNo} ${ledger.header?.plateNo || '(차량번호 없음)'}`); skipped['차량 못 찾음'] = (skipped['차량 못 찾음'] || 0) + 1; continue; }
      const svc = toService(entry);
      if (svc.skip) { skipped[svc.skip] = (skipped[svc.skip] || 0) + 1; continue; }
      if (isDuplicate(vehicle._id, svc.kind, svc.date)) { skipped['이미 있는 같은 검사·점검(10일 안)'] = (skipped['이미 있는 같은 검사·점검(10일 안)'] || 0) + 1; continue; }
      seen.push({ vehicle: String(vehicle._id), kind: svc.kind, t: new Date(svc.date).getTime() });
      toCreate.push({
        vehicle: vehicle._id,
        plateNo: vehicle.plateNo || '',
        kind: svc.kind,
        date: svc.date,
        amount: svc.amount,
        description: svc.description,
        memo: `${svc.memo} · ${ledger.ledgerNo}`,
        source: 'ledger',
        ledgerEntryId: entry._id,
        createdBy: '원장 이관',
        _vat: svc.vat
      });
    }
  }

  const perKind = {};
  let vatCount = 0;
  for (const r of toCreate) {
    perKind[r.kind] = (perKind[r.kind] || 0) + 1;
    if (r._vat) vatCount += 1;
  }

  console.log(`\n=== 원장 → 정비·검사 기록 ${apply ? '(실제 저장)' : '(시험 실행, 저장 안 함)'} ===`);
  console.log(`원장 ${ledgers.length}개 (차량번호로 이은 원장 ${viaPlate}개)`);
  console.log('옮길 기록:', toCreate.length, perKind, `(그중 부가세 줄 ${vatCount})`);
  console.log('이미 옮긴 줄:', existing);
  console.log('건너뛴 줄:', skipped);
  if (noVehicle.size) console.log('차량을 못 찾은 원장:', [...noVehicle].slice(0, 20).join(' / '));
  console.log('\n예시:');
  for (const kind of Object.keys(perKind)) {
    toCreate.filter((r) => r.kind === kind).slice(0, 3)
      .forEach((r) => console.log(`  [${r.kind}] ${r.plateNo} ${kstYmd(r.date)} ${r.amount.toLocaleString()}원 "${r.description}"`));
  }

  // 옮긴 뒤 운행 중인 차의 다음 검사·점검이 어떻게 보일지 미리 센다.
  const current = await VehicleService.find({}).select('vehicle kind date mileage amount description').lean();
  const recordsOf = new Map();
  for (const r of [...current, ...toCreate]) {
    const k = String(r.vehicle);
    if (!recordsOf.has(k)) recordsOf.set(k, []);
    recordsOf.get(k).push(r);
  }
  const active = vehicles.filter((v) => SERVICE_ACTIVE_STATUSES.includes(v.status));
  const summary = { 검사: {}, 점검: {} };
  const plans = active.map((v) => ({ v, plan: planVehicle(v, recordsOf.get(String(v._id)) || []) }));
  for (const { plan } of plans) {
    const i = plan.inspection?.status || '등록일 없음';
    summary.검사[i] = (summary.검사[i] || 0) + 1;
    const m = plan.maintenance?.status || '미가입';
    summary.점검[m] = (summary.점검[m] || 0) + 1;
  }
  console.log(`\n옮긴 뒤 운행 중인 차 ${active.length}대의 상태:`, summary);
  console.log('\n차 몇 대의 계획:');
  plans.filter(({ plan }) => plan.maintenance).slice(0, 3)
    .concat(plans.filter(({ plan }) => plan.inspection?.status === '지남').slice(0, 2))
    .forEach(({ v, plan }) => console.log(`  ${v.plateNo} ${v.carModel} 등록 ${kstYmd(v.registrationDate)}`,
      JSON.stringify({ inspection: plan.inspection, maintenance: plan.maintenance, repairTotal: plan.repairTotal })));

  if (apply && toCreate.length) {
    const docs = toCreate.map(({ _vat, ...rest }) => rest);
    // 겹치는 줄(동시에 두 번 돌린 경우)은 유일 색인에서 걸러지고 나머지는 계속 넣는다
    const res = await VehicleService.insertMany(docs, { ordered: false }).catch((err) => {
      if (err.code === 11000 || err.writeErrors) return err.insertedDocs || [];
      throw err;
    });
    console.log(`\n저장했습니다: ${res.length}건`);
  } else if (!apply) {
    console.log('\n저장하지 않았습니다. 옮기려면 --apply를 붙여 다시 실행하세요.');
  }

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error('이관 실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
