// 갑지 K9-001 (101하5040)을 차량에 연결하고 계약 구간을 바로잡는 스크립트.
//
// 배경: 엑셀에서 옮겨 온 K9-001은 차량과 연결되지 않아(차량미배정) 수익성 검토가 비어 있었다.
//       갑지의 입출금 줄은 첫 계약(2022-03 구매, 48개월, 월 1,690,000원) 것인데
//       계약 구간에는 2026년 12개월 재계약(22030013)이 1구간으로 적혀 있었다.
//       대표님 결정(2026-09-29): 한 갑지에 두 계약 - 첫 계약이 최초 계약, 2026년 계약이 1차 연장.
//
// 연결 버튼(link-vehicle)을 쓰지 않는 이유: 연결하면서 자동 연동이 돌아 차량 DB의 차량가 87,000,000원이
// 새 줄로 들어간다. 갑지에는 이미 실제 차량가 81,586,141원 줄이 있어 차를 두 번 산 것이 된다.
// 그래서 연결 정보와 구간만 고치고 입출금 줄은 건드리지 않는다.
//
// 첫 계약 48개월: 대표님 확인(2026-09-29) - 48회차를 2026-03-25에 납부 완료하고 재계약했다.
//
// 실행:
//   cd server && node migrations/2026-09-29_fix_k9_001_periods.js --dry-run
//   cd server && node migrations/2026-09-29_fix_k9_001_periods.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import VehicleLedger from '../models/VehicleLedger.js';
import Vehicle from '../models/Vehicle.js';
import Contract from '../models/Contract.js';

dotenv.config();

mongoose.set('autoIndex', false);

const isDryRun = process.argv.includes('--dry-run');
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '-');

const run = async () => {
  await connectDB();
  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}`);

  const ledger = await VehicleLedger.findOne({ ledgerNo: 'K9-001' });
  const first = await Vehicle.findOne({ code: 'K9-001_1', plateNo: '101하5040' }).lean(); // 첫 계약 차량 (거래완료)
  const current = await Vehicle.findOne({ code: 'K9-001', plateNo: '101하5040' }).lean(); // 2026년 재계약 차량
  const contract = await Contract.findOne({ contractNo: '22030013' }).lean();
  if (!ledger || !first || !current || !contract) throw new Error('갑지·차량·계약 중 찾지 못한 것이 있습니다.');
  if (ledger.vehicle) throw new Error(`이미 차량이 연결되어 있습니다 (${ledger.vehicle}). 손대지 않습니다.`);

  const periods = [
    {
      seq: 1,
      contract: null,
      contractNo: '',
      startDate: first.registrationDate,
      endDate: new Date('2026-03-30T00:00:00.000Z'),
      termMonths: 48,
      monthlyRent: Number(first.monthlyFee) || 1690000,
      deposit: Number(first.deposit) || 0,
      advancePayment: Number(first.advancePayment) || 0,
      takeoverPrice: Number(first.takeoverPrice) || 0,
      note: '엑셀 갑지의 첫 계약. 48회차 2026-03-25 납부 완료 후 재계약'
    },
    {
      seq: 2,
      contract: contract._id,
      contractNo: contract.contractNo,
      startDate: contract.contractDate,
      endDate: contract.endDate,
      termMonths: Number(contract.termMonths) || 12,
      // 계약서에 금액이 비어 있어 렌트차량 DB(K9-001)의 월 렌트료를 쓴다
      monthlyRent: Number(contract.pricing?.monthlyFee) || Number(current.monthlyFee) || 0,
      deposit: Number(contract.pricing?.deposit) || Number(current.deposit) || 0,
      advancePayment: Number(contract.pricing?.advancePayment) || Number(current.advancePayment) || 0,
      takeoverPrice: Number(contract.pricing?.takeoverPrice) || Number(current.takeoverPrice) || 0
    }
  ];

  console.log('\n바꾸기 전');
  console.log(`  차량 ${ledger.vehicle || '없음'} · 계약 ${ledger.contract || '없음'} · 상태 ${ledger.status}`);
  ledger.contractPeriods.forEach((p) => console.log(`  구간 ${p.seq}: ${d(p.startDate)} ~ ${d(p.endDate)} · 월 ${p.monthlyRent?.toLocaleString()} · ${p.termMonths || '-'}개월`));
  console.log(`  고정 조건: ${JSON.stringify(ledger.terms)}`);

  console.log('\n바꾼 뒤');
  console.log(`  차량 ${first.code} (첫 계약 차량) · 계약 ${contract.contractNo} · 상태 운용중`);
  periods.forEach((p) => console.log(`  구간 ${p.seq}: ${d(p.startDate)} ~ ${d(p.endDate)} · 월 ${p.monthlyRent.toLocaleString()} · ${p.termMonths}개월 · 인수가 ${p.takeoverPrice.toLocaleString()}`));
  console.log(`  고정 조건: 월 ${periods[1].monthlyRent.toLocaleString()} · ${periods[1].termMonths}개월 (지금 유효한 연장 계약 조건)`);
  console.log(`  입출금 줄 ${ledger.entries.length}개는 그대로 (모두 최초 계약 구간)`);

  if (!isDryRun) {
    ledger.vehicle = first._id;
    ledger.contract = contract._id;
    if (!ledger.company) ledger.company = contract.companyId || null;
    if (!ledger.customer && contract.customer) ledger.customer = contract.customer;
    ledger.status = '운용중';
    ledger.contractPeriods = periods;
    ledger.terms.monthlyRent = periods[1].monthlyRent;
    ledger.terms.termMonths = periods[1].termMonths;
    if (periods[1].takeoverPrice) ledger.terms.takeoverPrice = periods[1].takeoverPrice;
    await ledger.save();
    console.log('\n저장했습니다.');
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
