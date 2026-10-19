// 기존 자료 정리 — 차는 한 대에 기록 하나, 원장은 그 차와 계약에 연결.
//
// 2026-09-03 엑셀 이관 때 정산 리스트의 기간별 시트가 차량 문서로 따로 생겨(GV80-003_1, Benz-003_2 …)
// 같은 번호판 차량이 여러 개가 되었고, 원장 다수는 차량·계약과 연결되지 않은 채 남았다("차량미배정").
// 그래서 원장의 실제 입금이 청구 회차표로 옮겨지지 못하고, 대시보드에 "입금 기록이 끊긴 계약"으로 떴다
// (예: ㈜한촌 S500 — 원장에는 55회차 입금이 다 있다).
//
// 세 갈래로 나눈다.
//   A. 원장 연결 (자동)      번호판으로 차량을 찾아 원장을 그 차(와 그 차의 지금 계약)에 연결
//   B. 중복 차량 합치기 (자동) 같은 번호판 차량 문서를 하나로. 남길 차 = 진행 중 계약이 있는 차, 없으면 가장 최근 출고
//   C. 재계약 구간 나누기 (확인 필요) 원장 입금이 지금 계약 회차표보다 60일 넘게 먼저 시작되는 차.
//      최초 계약 조건을 원장 입금에서 추정해 보여만 준다. 반영하지 않는다(대표님·자금팀 확인 뒤 따로 한다).
//      C에 걸린 원장은 A에서 차량만 연결하고 계약은 연결하지 않는다(계약을 붙이면 최초 계약 회차가 재계약 회차에 붙는다).
//
// 실행
//   cd server && node migrations/2026-10-05_cleanup_vehicle_chains.js                      미리보기(쓰지 않음)
//   cd server && node migrations/2026-10-05_cleanup_vehicle_chains.js --export <파일.xlsx>  미리보기를 엑셀로
//   cd server && node migrations/2026-10-05_cleanup_vehicle_chains.js --apply              A·B 반영(백업 후)

import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const EXPORT_PATH = process.argv.includes('--export') ? process.argv[process.argv.indexOf('--export') + 1] : null;
const DAY = 864e5;
const RECONTRACT_LEAD_DAYS = 60;

const norm = (p) => String(p || '').replace(/\s/g, '');
const ymd = (d) => (d ? new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : '');
const mode = (nums) => {
  const count = {};
  nums.forEach((n) => { count[n] = (count[n] || 0) + 1; });
  return Number(Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0]) || 0;
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  console.log(`[모드] ${APPLY ? '실제 반영 (--apply, A·B만)' : '미리보기 (쓰지 않음)'}  DB: ${db.databaseName}`);

  const vehicles = await db.collection('vehicles').find({}).toArray();
  const ledgers = await db.collection('vehicleledgers').find({}).toArray();
  const contracts = new Map((await db.collection('contracts').find({}).toArray()).map((c) => [String(c._id), c]));
  const schedules = new Map((await db.collection('billingschedules').find({}).toArray()).map((s) => [String(s.contract), s]));
  const partyOf = new Map();
  for (const c of contracts.values()) {
    const name = c.companyId
      ? (await db.collection('companies').findOne({ _id: c.companyId }, { projection: { name: 1 } }))?.name
      : (await db.collection('customers').findOne({ _id: c.customer }, { projection: { name: 1 } }))?.name;
    partyOf.set(String(c._id), name || '');
  }

  const byPlate = {};
  vehicles.forEach((v) => { if (norm(v.plateNo)) (byPlate[norm(v.plateNo)] ||= []).push(v); });

  // 번호판마다 남길 차 = 진행 중 계약이 있는 차 → 계약이 있는 차 → 가장 최근 출고·등록
  const keepOf = {};
  for (const [plate, list] of Object.entries(byPlate)) {
    const rank = (v) => {
      const c = v.contract ? contracts.get(String(v.contract)) : null;
      return [c && ['진행중', '보관됨'].includes(c.status) ? 2 : c ? 1 : 0, new Date(v.deliveryDate || v.createdAt || 0).getTime()];
    };
    keepOf[plate] = [...list].sort((a, b) => {
      const [ra, ta] = rank(a); const [rb, tb] = rank(b);
      return rb - ra || tb - ta;
    })[0];
  }

  const rentsOf = (l) => (l.entries || [])
    .filter((e) => e.category === '렌트료' && e.side === '입금' && e.amount > 0)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  // ── C. 재계약 구간 나누기가 필요한 원장 (확인 필요, 반영 안 함)
  const recontract = [];
  const recontractLedgerIds = new Set();
  for (const l of ledgers) {
    const plate = norm(l.header?.plateNo);
    const keep = plate ? keepOf[plate] : null;
    const contractId = l.contract || keep?.contract;
    const c = contractId ? contracts.get(String(contractId)) : null;
    const s = c ? schedules.get(String(c._id)) : null;
    const rents = rentsOf(l);
    if (!c || !s?.rounds?.length || !rents.length || (l.contractPeriods || []).length > 1) continue;
    const scheduleStart = new Date(s.rounds[0].dueDate);
    const firstRent = new Date(rents[0].date);
    if ((scheduleStart - firstRent) / DAY <= RECONTRACT_LEAD_DAYS) continue;
    const before = rents.filter((e) => new Date(e.date) < new Date(scheduleStart.getTime() - 20 * DAY));
    const after = rents.filter((e) => !before.includes(e));
    recontractLedgerIds.add(String(l._id));
    recontract.push({
      원장: l.ledgerNo,
      번호판: plate,
      계약자: partyOf.get(String(c._id)),
      지금계약: c.contractNo,
      '지금 계약일(프로그램)': ymd(c.contractDate),
      '지금 회차표 시작': ymd(scheduleStart),
      '지금 회차표 회차': s.rounds.length,
      '추정 최초 계약: 첫 입금': ymd(firstRent),
      '추정 최초 계약: 입금 회차 수': before.length,
      '추정 최초 계약: 주된 월 렌트료': mode(before.map((e) => e.amount)),
      '재계약 뒤 입금 회차 수': after.length,
      '재계약 뒤 주된 월 렌트료': mode(after.map((e) => e.amount)),
      '같은 번호판 이전 차량 문서': (byPlate[plate] || []).filter((v) => String(v._id) !== String(keep?._id))
        .map((v) => `${v.code}(출고 ${ymd(v.deliveryDate)}, 월 ${v.monthlyFee || '-'})`).join(' / '),
      '확인할 것': '최초 계약 시작일·기간·월 렌트료, 재계약 시작일'
    });
  }

  // ── A. 원장 연결
  const linkPlan = [];
  const contractTaken = new Set(ledgers.filter((l) => l.contract).map((l) => String(l.contract)));
  for (const l of ledgers) {
    if (l.vehicle && l.contract) continue;
    const plate = norm(l.header?.plateNo);
    const keep = plate ? keepOf[plate] : null;
    if (!keep) continue;
    const setVehicle = !l.vehicle ? keep._id : null;
    let setContract = null;
    let contractNote = '';
    if (!l.contract && keep.contract) {
      if (recontractLedgerIds.has(String(l._id))) contractNote = '재계약 구간 확인 뒤 연결 (C)';
      else if (contractTaken.has(String(keep.contract))) contractNote = '다른 원장이 이미 이 계약에 연결됨';
      else setContract = keep.contract;
    }
    if (!setVehicle && !setContract) continue;

    // 계약을 연결하면 원장 입금으로 회차표를 몇 회차 채울 수 있는지 미리 센다(입금일이 출금일보다 45일 넘게 앞서면 제외)
    let fillable = 0;
    if (setContract) {
      const s = schedules.get(String(setContract));
      const rents = rentsOf(l);
      for (const r of s?.rounds || []) {
        if (r.status !== '예정' || r.issuedAt) continue;
        const paid = rents.filter((e) => e.round === r.no);
        const amount = paid.reduce((a, e) => a + e.amount, 0);
        const last = paid.map((e) => new Date(e.date)).sort((a, b) => b - a)[0];
        if (!amount || !last || (new Date(r.dueDate) - last) / DAY > 45) continue;
        if (amount >= (r.total || 0) * 0.999 && amount < (r.total || 0) * 1.9) fillable += 1;
      }
    }
    linkPlan.push({
      ledgerId: l._id, setVehicle, setContract,
      row: {
        원장: l.ledgerNo,
        번호판: plate,
        '원장 상태': l.status,
        '연결할 차량': setVehicle ? `${keep.code} [${keep.status}]` : '(이미 연결됨)',
        '연결할 계약': setContract ? `${contracts.get(String(setContract))?.contractNo} ${partyOf.get(String(setContract))}` : (contractNote || '(없음)'),
        '연결 뒤 회차표에 채울 수 있는 입금(예상)': setContract ? fillable : ''
      }
    });
  }

  // ── B. 중복 차량 합치기
  const mergePlan = [];
  for (const [plate, list] of Object.entries(byPlate)) {
    if (list.length < 2) continue;
    const keep = keepOf[plate];
    for (const dup of list.filter((v) => String(v._id) !== String(keep._id))) {
      const refs = {
        원장: await db.collection('vehicleledgers').countDocuments({ vehicle: dup._id }),
        계약: await db.collection('contracts').countDocuments({ $or: [{ vehicle: dup._id }, { vehicles: dup._id }] }),
        일정: await db.collection('schedules').countDocuments({ targetVehicle: dup._id }),
        대여기록: await db.collection('rentalrecords').countDocuments({ vehicle: dup._id })
      };
      mergePlan.push({
        keep, dup, refs,
        row: {
          번호판: plate,
          차종: keep.carModel,
          '남길 차량': `${keep.code} [${keep.status}] 출고 ${ymd(keep.deliveryDate)}${keep.contract ? ` · 계약 ${contracts.get(String(keep.contract))?.contractNo}` : ''}`,
          '합칠(지울) 차량': `${dup.code} [${dup.status}] 출고 ${ymd(dup.deliveryDate)} 월 ${dup.monthlyFee || '-'}${dup.contract ? ` · 계약 ${contracts.get(String(dup.contract))?.contractNo}` : ''}`,
          '옮길 연결': Object.entries(refs).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || '없음'
        }
      });
    }
  }

  // ── 출력
  console.log(`\nA. 원장 연결: ${linkPlan.length}장 (차량 연결 ${linkPlan.filter((p) => p.setVehicle).length} · 계약 연결 ${linkPlan.filter((p) => p.setContract).length})`);
  linkPlan.forEach((p) => console.log(`   ${p.row.원장} ${p.row.번호판} → 차량 ${p.row['연결할 차량']} / 계약 ${p.row['연결할 계약']}${p.setContract ? ` · 입금 반영 예상 ${p.row['연결 뒤 회차표에 채울 수 있는 입금(예상)']}회차` : ''}`));
  console.log(`\nB. 중복 차량 합치기: 번호판 ${new Set(mergePlan.map((m) => m.row.번호판)).size}개, 지울 차량 문서 ${mergePlan.length}개`);
  mergePlan.forEach((m) => console.log(`   ${m.row.번호판} 남김 ${m.row['남길 차량']} ← ${m.row['합칠(지울) 차량']} (옮길 연결: ${m.row['옮길 연결']})`));
  console.log(`\nC. 재계약 구간 나누기 (확인 필요, 반영 안 함): ${recontract.length}대`);
  recontract.forEach((r) => console.log(`   ${r.원장} ${r.계약자} ${r.지금계약}: 첫 입금 ${r['추정 최초 계약: 첫 입금']} · 최초 ${r['추정 최초 계약: 입금 회차 수']}회 월 ${r['추정 최초 계약: 주된 월 렌트료']} → 회차표 시작 ${r['지금 회차표 시작']} · 재계약 뒤 ${r['재계약 뒤 입금 회차 수']}회 월 ${r['재계약 뒤 주된 월 렌트료']}`));

  if (EXPORT_PATH) {
    const wb = XLSX.utils.book_new();
    const sheet = (rows, name, widths) => {
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 내용: '해당 없음' }]);
      ws['!cols'] = widths.map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    sheet(linkPlan.map((p) => p.row), 'A 원장 연결', [14, 12, 12, 26, 34, 18]);
    sheet(mergePlan.map((m) => m.row), 'B 중복 차량 합치기', [12, 26, 48, 44, 24]);
    sheet(recontract, 'C 재계약 확인 필요', [14, 12, 20, 12, 14, 14, 10, 14, 12, 14, 12, 14, 60, 30]);
    XLSX.writeFile(wb, EXPORT_PATH);
    console.log(`\n미리보기 엑셀: ${EXPORT_PATH}`);
  }

  if (!APPLY) {
    console.log('\n미리보기만 했습니다. A·B를 반영하려면 --apply를 붙여 다시 실행하세요. C는 확인 뒤 따로 반영합니다.');
    await mongoose.disconnect();
    return;
  }

  // ── 반영 (A·B). 바꾸기 전에 관련 문서를 모두 백업한다.
  const backupDir = path.join(os.homedir(), 'rentbenefit-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `vehicle_chains_before_cleanup_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({
    ledgers: ledgers.filter((l) => linkPlan.some((p) => String(p.ledgerId) === String(l._id))),
    vehicles: mergePlan.map((m) => m.dup)
  }));
  console.log(`\n백업: ${backupFile}`);

  for (const p of linkPlan) {
    const set = {};
    if (p.setVehicle) set.vehicle = p.setVehicle;
    if (p.setContract) set.contract = p.setContract;
    await db.collection('vehicleledgers').updateOne({ _id: p.ledgerId }, { $set: set });
  }
  for (const m of mergePlan) {
    // 지울 차를 가리키던 것들을 남길 차로 옮긴다
    await db.collection('vehicleledgers').updateMany({ vehicle: m.dup._id }, { $set: { vehicle: m.keep._id } });
    await db.collection('contracts').updateMany({ vehicle: m.dup._id }, { $set: { vehicle: m.keep._id } });
    await db.collection('contracts').updateMany({ vehicles: m.dup._id }, { $set: { 'vehicles.$': m.keep._id } });
    await db.collection('schedules').updateMany({ targetVehicle: m.dup._id }, { $set: { targetVehicle: m.keep._id } });
    await db.collection('rentalrecords').updateMany({ vehicle: m.dup._id }, { $set: { vehicle: m.keep._id } });
    await db.collection('vehicles').deleteOne({ _id: m.dup._id });
  }
  console.log(`반영: 원장 ${linkPlan.length}장 연결, 중복 차량 ${mergePlan.length}개 합침. 이어서 입금 채우기 스크립트(2026-10-04_backfill…)를 미리보기로 돌려 보세요.`);
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error('실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
