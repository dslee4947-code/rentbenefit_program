// 최초 계약과 연장·재계약·승계 계약이 한 구간으로 묶인 갑지 8장을 계약 구간별로 나누는 스크립트.
//
// 배경(대표님 2026-10-28): 특허법인 엠에이피에스(K8-002_2)는 4년 계약으로 48회차를 받고 2026-07에 연장했는데,
//   엑셀에서 옮겨 올 때 계약 구간이 1개(지금 계약 26060142)만 생겨 렌트료 1~52회가 모두 그 1년짜리 구간에 들어갔다.
//   그래서 원장 화면이 2022년 입금을 지금 계약 회차에 맞추려 했고, 계약 손익 기준표도 12개월로 계산됐다.
//   같은 모양인 갑지 7장도 함께 고친다(지금 구간 시작일보다 45일 넘게 앞선 렌트료가 있거나 회차가 계약 개월을 넘는 갑지).
//
// 구간을 가르는 기준은 지금 계약 회차표다. 회차표 1회차와 날짜가 맞는 갑지 회차부터 지금 계약이다
//   (예: K8-002_2 49회 2026-07-09 입금 = 26060142 회차표 1회차 2026-07-05 출금).
// 나누는 일은 엑셀 갱신과 같은 함수(splitByPeriods)로 한다. 그래야 10분 갱신 때 같은 결과가 나와 다시 쓰지 않는다.
// 금액·날짜는 건드리지 않는다. 보증금은 승계라 뒤 구간에는 0으로 둔다(넣으면 동기화가 보증금 줄을 한 번 더 만든다).
// 앞 구간 계약서는 프로그램에 없어 contract를 비워 둔다.
//
// 실행:
//   cd server && node migrations/2026-10-28_split_merged_contract_periods.js --dry-run
//   cd server && node migrations/2026-10-28_split_merged_contract_periods.js --backup <백업 파일 경로>

import fs from 'fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import VehicleLedger from '../models/VehicleLedger.js';
import Contract from '../models/Contract.js';
import { splitByPeriods } from '../utils/ledgerExcelImport.js';
import { computeProfitPlan } from '../utils/ledgerProfitPlan.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');
const backupPath = process.argv[process.argv.indexOf('--backup') + 1];
const day = (s) => new Date(`${s}T00:00:00Z`);
const d = (x) => (x ? new Date(new Date(x).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : '-');

// first: 앞 구간(최초 계약). last: 지금 계약. rents: 구간별 렌트료 줄 수(검산)
const TARGETS = [
  {
    ledgerNo: 'K8-002_2', contractNo: '26060142', rents: [48, 4],
    first: { start: '2022-07-01', end: '2026-06-30', termMonths: 48, monthlyRent: 563255, deposit: 7020000, note: '최초 계약(4년). 계약서는 프로그램에 없음' },
    last: { start: '2026-07-01', end: '2027-06-30', termMonths: 12, monthlyRent: 522725, note: '1차 연장(1년) · 보증금 승계' }
  },
  {
    ledgerNo: 'G90-003', contractNo: '22080031', rents: [48, 2],
    first: { start: '2022-08-16', end: '2026-08-15', termMonths: 48, monthlyRent: 2398725, deposit: 35860000, advancePayment: 14240000, note: '최초 계약(4년). 계약서는 프로그램에 없음' },
    last: { start: '2026-08-16', end: '2028-08-15', termMonths: 24, monthlyRent: 648725, note: '1차 연장(2년) · 보증금 승계' }
  },
  {
    ledgerNo: 'Benz-013', contractNo: '22040014', rents: [36, 18],
    first: { start: '2022-04-04', end: '2025-04-03', termMonths: 36, monthlyRent: 2975445, deposit: 90872000, advancePayment: 105608000, note: '최초 계약(3년). 계약서는 프로그램에 없음' },
    last: { start: '2025-04-04', end: '2027-04-04', termMonths: 24, monthlyRent: 468725, note: '1차 연장(2년) · 보증금 승계' }
  },
  {
    ledgerNo: 'Benz-016', contractNo: '22040024', rents: [24, 29],
    first: { start: '2022-05-02', end: '2024-04-18', termMonths: 24, monthlyRent: 3915725, deposit: 65280000, note: '최초 계약(2년). 계약서는 프로그램에 없음' },
    last: { start: '2024-04-19', end: '2027-04-19', termMonths: 36, monthlyRent: 3915725, advancePayment: 65280000, note: '재계약(3년) · 선납금 65,280,000' }
  },
  {
    ledgerNo: 'Ray-035', contractNo: '21110029', rents: [24, 34],
    first: { start: '2021-11-25', end: '2023-11-24', termMonths: 24, monthlyRent: 376425, note: '최초 계약. 2023-11 청담건설로 승계(승계수수료 2023-11-30). 계약서는 프로그램에 없음' },
    last: { start: '2023-11-25', end: '2026-11-24', termMonths: 36, monthlyRent: 376700, note: '승계 후 계약(3년)' }
  },
  {
    ledgerNo: 'G80-001', contractNo: '22070030', rents: [40, 8],
    first: { start: '2022-08-05', end: '2025-11-03', termMonths: 40, monthlyRent: 1284725, deposit: 18600000, note: '최초 계약(48개월 중 40회차까지). 계약서는 프로그램에 없음' },
    last: { start: '2025-11-04', end: '2026-08-04', termMonths: 9, monthlyRent: 1284725, note: '남은 9개월 계약 · 보증금 승계' }
  },
  {
    ledgerNo: 'G80-002', contractNo: '22100034', rents: [37, 8],
    first: { start: '2022-12-01', end: '2025-12-31', termMonths: 37, monthlyRent: 1207725, deposit: 27389000, note: '최초 계약(48개월 중 37회차까지). 2026-01 ㈜다성테크로 승계. 계약서는 프로그램에 없음' },
    last: { start: '2026-01-01', end: '2026-12-01', termMonths: 11, monthlyRent: 1207725, note: '승계 후 남은 11개월 · 보증금 승계' }
  },
  {
    // 엑셀이 새 계약에서 회차를 1부터 다시 셌다. splitByPeriods가 1회차가 다시 나오는 곳에서 끊는다
    ledgerNo: 'Avante-001', contractNo: '22030011', rents: [15, 10],
    first: { start: '2022-11-01', end: '2024-01-17', termMonths: 15, monthlyRent: 399725, note: '앞 고객 계약. 2024-01 중도 해지(위약금 3,439,600). 계약서는 프로그램에 없음' },
    last: { start: '2025-12-01', end: '2028-12-01', termMonths: 36, monthlyRent: 269725, advancePayment: 6960000, note: '새 계약(3년)' }
  }
];

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);
  if (!isDryRun && !backupPath) throw new Error('--backup <파일> 을 주세요. 바꾸기 전 갑지를 저장해 둡니다.');

  const ready = [];
  for (const t of TARGETS) {
    const ledger = await VehicleLedger.findOne({ ledgerNo: t.ledgerNo });
    const contract = await Contract.findOne({ contractNo: t.contractNo }).select('_id contractNo').lean();
    if (!ledger || !contract) throw new Error(`${t.ledgerNo}: 갑지 또는 계약을 찾지 못했습니다.`);
    if ((ledger.contractPeriods || []).length !== 1) {
      console.log(`\n${t.ledgerNo}: 구간이 이미 ${ledger.contractPeriods.length}개입니다. 건너뜁니다.`);
      continue;
    }

    const periods = [
      {
        seq: 1, contract: null, contractNo: '',
        startDate: day(t.first.start), endDate: day(t.first.end), termMonths: t.first.termMonths,
        monthlyRent: t.first.monthlyRent, deposit: t.first.deposit || 0, advancePayment: t.first.advancePayment || 0, takeoverPrice: 0,
        note: t.first.note
      },
      {
        seq: 2, contract: contract._id, contractNo: contract.contractNo,
        startDate: day(t.last.start), endDate: day(t.last.end), termMonths: t.last.termMonths,
        monthlyRent: t.last.monthlyRent, deposit: 0, advancePayment: t.last.advancePayment || 0,
        takeoverPrice: Number(ledger.terms?.takeoverPrice) || 0,
        note: t.last.note
      }
    ];

    const before = ledger.entries.map((e) => `${e.periodSeq || 1}:${e.round ?? ''}:${e.label}`);
    splitByPeriods(ledger.entries, periods);
    const rents = periods.map((p) => ledger.entries.filter((e) => e.category === '렌트료' && e.round && (e.periodSeq || 1) === p.seq)
      .sort((a, b) => a.date - b.date));
    if (rents[0].length !== t.rents[0] || rents[1].length !== t.rents[1]) {
      throw new Error(`${t.ledgerNo}: 렌트료 묶음이 예상과 다릅니다 ${rents.map((r) => r.length).join('/')} (예상 ${t.rents.join('/')})`);
    }

    console.log(`\n${t.ledgerNo} ${ledger.header?.customerName}`);
    periods.forEach((p, i) => {
      const r = rents[i];
      console.log(`  구간 ${p.seq}: ${d(p.startDate)} ~ ${d(p.endDate)} · ${p.termMonths}개월 · 월 ${p.monthlyRent.toLocaleString()} · ${p.contractNo || '계약서 없음'}`
        + ` · 렌트료 ${r[0].round}~${r[r.length - 1].round}회 (${d(r[0].date)} ~ ${d(r[r.length - 1].date)})`);
    });
    ledger.entries.forEach((e, i) => {
      if ((e.periodSeq || 1) === 2 && !(e.category === '렌트료' && e.round)) console.log(`      → 2구간: ${e.category} ${e.label} ${e.amount?.toLocaleString()} ${d(e.date)}`);
    });
    const changed = ledger.entries.filter((e, i) => `${e.periodSeq || 1}:${e.round ?? ''}:${e.label}` !== before[i]).length;
    console.log(`  바뀌는 줄 ${changed}개`);
    ready.push({ ledger, periods, original: null });
  }

  if (!isDryRun && ready.length) {
    const originals = await VehicleLedger.find({ _id: { $in: ready.map((r) => r.ledger._id) } }).lean();
    fs.writeFileSync(backupPath, JSON.stringify(originals, null, 1));
    console.log(`\n백업: ${backupPath}`);
    for (const { ledger, periods } of ready) {
      ledger.contractPeriods = periods;
      ledger.terms.monthlyRent = periods[1].monthlyRent;
      ledger.terms.termMonths = periods[1].termMonths;
      ledger.markModified('entries');
      await ledger.save();

      // 계약 손익 기준표(최초 계약)는 12개월짜리 지금 계약으로 계산돼 있었다. 다시 계산하고 전 값은 이력으로 둔다.
      const result = await computeProfitPlan(ledger.toObject());
      const old = (ledger.profitPlans || []).find((p) => p.periodSeq === 1);
      if (result.ok) {
        const now = new Date();
        const history = old
          ? [...(old.history || []), {
            savedAt: old.savedAt, savedBy: old.savedBy, source: old.source, revenue: old.revenue, operatingProfit: old.operatingProfit,
            replacedAt: now, replacedBy: '프로그램', reason: '최초 계약과 연장 계약이 한 구간으로 묶여 있던 것을 나눔(2026-10-28)'
          }]
          : [];
        const plan = { ...result.plan, savedAt: now, savedBy: '프로그램(계약 구간 분리)', history };
        const others = (ledger.profitPlans || []).filter((p) => (p.periodSeq || 1) !== 1).map((p) => p.toObject?.() || p);
        await VehicleLedger.updateOne({ _id: ledger._id }, { $set: { profitPlans: [...others, plan] } });
        console.log(`  ${ledger.ledgerNo}: 기준표 ${result.plan.values.months}개월 · 예상 이익 ${old?.operatingProfit?.toLocaleString() ?? '-'} → ${result.plan.operatingProfit.toLocaleString()}`);
      } else if (old) {
        await VehicleLedger.updateOne({ _id: ledger._id }, { $set: { profitPlans: [] } });
        console.log(`  ${ledger.ledgerNo}: 기준표를 다시 세우지 못해 지웠습니다(${result.reason})`);
      }
    }
    console.log('저장했습니다.');
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
