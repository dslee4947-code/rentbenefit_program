// 갑지 Benz-003 (법무법인(유)화우 GLE450 125호2333)을 계약 구간 3개로 나누는 스크립트.
//
// 배경: 3년 계약 후 1년 연장, 다시 1년 연장한 차인데(대표님 2026-10-23) 엑셀에서 옮겨 올 때
//       계약 구간이 1개(지금 계약 24110003)만 생겼다. 렌트료 줄 58개가 전부 그 구간에 들어가
//       원장 화면이 58줄을 지금 계약 청구서 12회차에 맞추려다 표가 엉켰다. 구간 월 렌트료도
//       최초 계약 금액(2,931,725원)으로 적혀 있었다.
//
//   최초 계약  2021-11-12 ~ 2024-11-12  36개월  월 2,931,725  렌트료 1~36회 (2021-12-30 ~ 2024-11-28)
//   1차 연장   2024-11-13 ~ 2025-11-12  12개월  월 2,024,725  렌트료 1~12회 (2024-12-31 ~ 2025-11-28)
//   2차 연장   2025-11-13 ~ 2026-11-13  12개월  월 1,356,725  렌트료 1~10회 (2025-12-31 ~ ) · 계약 24110003
//
// 렌트료 줄은 갑지 회차 번호가 1로 돌아가는 곳에서 끊어 구간을 나눈다. 그 밖의 줄은 날짜로 나눈다
// (할부금은 날짜와 상관없이 최초 계약, 인수가는 마지막 구간). 금액·날짜는 건드리지 않는다.
// 보증금은 승계라 연장 구간에는 0으로 둔다 — 넣으면 동기화가 보증금 줄을 한 번 더 만든다.
//
// 실행:
//   cd server && node migrations/2026-10-23_split_benz_003_extensions.js --dry-run
//   cd server && node migrations/2026-10-23_split_benz_003_extensions.js --backup <백업 파일 경로>

import fs from 'fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import VehicleLedger from '../models/VehicleLedger.js';
import Contract from '../models/Contract.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');
const backupPath = process.argv[process.argv.indexOf('--backup') + 1];
const kst = (s) => new Date(`${s}T00:00:00+09:00`);
const d = (x) => (x ? new Date(new Date(x).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : '-');

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);
  if (!isDryRun && !backupPath) throw new Error('--backup <파일> 을 주세요. 바꾸기 전 갑지를 저장해 둡니다.');

  const ledger = await VehicleLedger.findOne({ ledgerNo: 'Benz-003' });
  const contract = await Contract.findOne({ contractNo: '24110003' }).lean();
  if (!ledger || !contract) throw new Error('갑지 또는 계약을 찾지 못했습니다.');
  if ((ledger.contractPeriods || []).length !== 1) throw new Error(`구간이 이미 ${ledger.contractPeriods.length}개입니다. 손대지 않습니다.`);

  const periods = [
    {
      seq: 1, contract: null, contractNo: '',
      startDate: kst('2021-11-12'), endDate: kst('2024-11-12'), rentStartDate: kst('2021-12-31'),
      termMonths: 36, monthlyRent: 2931725, deposit: 12360000, advancePayment: 0, takeoverPrice: 0,
      note: '엑셀 갑지의 최초 계약(3년). 계약서는 프로그램에 없음'
    },
    {
      seq: 2, contract: null, contractNo: '',
      startDate: kst('2024-11-13'), endDate: kst('2025-11-12'), rentStartDate: kst('2024-12-31'),
      termMonths: 12, monthlyRent: 2024725, deposit: 0, advancePayment: 0, takeoverPrice: 0,
      note: '1차 연장(1년) · 보증금 승계. 계약서는 프로그램에 없음'
    },
    {
      seq: 3, contract: contract._id, contractNo: contract.contractNo,
      startDate: contract.deliveryDate || kst('2025-11-13'), endDate: ledger.header?.contractEndAt || contract.endDate,
      termMonths: 12, monthlyRent: 1356725, deposit: 0, advancePayment: 0, takeoverPrice: Number(ledger.terms?.takeoverPrice) || 0,
      note: '2차 연장(1년) · 보증금 승계'
    }
  ];

  // 렌트료 줄: 회차 번호가 1로 돌아가는 곳에서 끊는다
  const rents = ledger.entries.filter((e) => e.category === '렌트료' && e.round).sort((a, b) => a.date - b.date);
  const blocks = [[]];
  rents.forEach((e) => {
    const cur = blocks[blocks.length - 1];
    if (cur.length && e.round === 1) blocks.push([]);
    blocks[blocks.length - 1].push(e);
  });
  if (blocks.length !== 3 || blocks[0].length !== 36 || blocks[1].length !== 12) {
    throw new Error(`렌트료 묶음이 예상과 다릅니다: ${blocks.map((b) => b.length).join('/')}`);
  }
  const rentSeq = new Map();
  blocks.forEach((b, i) => b.forEach((e) => rentSeq.set(String(e._id), i + 1)));

  const seqByDate = (date) => (date >= kst('2025-11-13') ? 3 : (date >= kst('2024-11-13') ? 2 : 1));
  const plan = ledger.entries.map((e) => {
    let seq;
    if (rentSeq.has(String(e._id))) seq = rentSeq.get(String(e._id));
    else if (e.category === '인수가') seq = 3;
    else if (e.category === '할부금') seq = 1; // 차를 살 때 낸 대출 상환. 36차가 연장 뒤에 나가도 최초 계약 몫

    else seq = e.date ? seqByDate(e.date) : 1;
    const tag = seq > 1 ? ` (${seq - 1}차 연장)` : '';
    const label = rentSeq.has(String(e._id)) && seq > 1 ? `렌트료 ${e.round}회차${tag}` : e.label;
    return { e, seq, label };
  });

  console.log('\n바꾸기 전');
  ledger.contractPeriods.forEach((p) => console.log(`  구간 ${p.seq}: ${d(p.startDate)} ~ ${d(p.endDate)} · 월 ${p.monthlyRent?.toLocaleString()} · ${p.termMonths || '-'}개월`));
  console.log(`  고정 조건: ${JSON.stringify(ledger.terms)}`);
  console.log('\n바꾼 뒤');
  periods.forEach((p) => {
    const rows = plan.filter((x) => x.seq === p.seq);
    const rent = rows.filter((x) => rentSeq.has(String(x.e._id)));
    console.log(`  구간 ${p.seq}: ${d(p.startDate)} ~ ${d(p.endDate)} · 월 ${p.monthlyRent.toLocaleString()} · ${p.termMonths}개월 · 줄 ${rows.length}개 (렌트료 ${rent.length}개 ${d(rent[0]?.e.date)} ~ ${d(rent[rent.length - 1]?.e.date)})`);
    rows.filter((x) => !rentSeq.has(String(x.e._id)) && p.seq > 1).forEach((x) => console.log(`      ${x.e.category} ${x.e.label} ${x.e.amount?.toLocaleString()} ${d(x.e.date)}`));
  });

  if (!isDryRun) {
    fs.writeFileSync(backupPath, JSON.stringify(ledger.toObject(), null, 1));
    console.log(`\n백업: ${backupPath}`);
    ledger.contractPeriods = periods;
    plan.forEach(({ e, seq, label }) => { e.periodSeq = seq; e.label = label; });
    ledger.terms.monthlyRent = periods[2].monthlyRent;
    ledger.terms.termMonths = periods[2].termMonths;
    await ledger.save();
    console.log('저장했습니다.');
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
