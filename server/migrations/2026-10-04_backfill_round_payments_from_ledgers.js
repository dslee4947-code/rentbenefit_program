// 차량 손익 원장의 렌트료 입금 기록으로 청구 회차표의 지난 입금 상태를 채우는 일회성 스크립트.
//
// 왜 필요한가
//   과거 청구는 엑셀로 해 와서 회차표는 대부분 "예정"으로 남아 있다(2026-10-04 기준 4,261회차 중 4,261건 가까이).
//   그런데 원장에는 정산 리스트(2026-09-29 대표님 업로드)에서 옮긴 실제 렌트료 입금이 회차·날짜·금액까지 들어 있다.
//   두 장부가 다른 말을 하니 대시보드의 입금률·미납을 보여 줄 수 없었다. 원장의 입금을 회차표로 옮긴다.
//
// 짝 짓는 법
//   원장은 차량 1대 단위이고 계약 구간(최초·연장)마다 어느 계약인지 적혀 있다(contractPeriods).
//   렌트료 줄의 periodSeq로 구간을 찾고 → 그 구간의 계약 → 그 계약 회차표의 같은 회차로 간다.
//   한 계약에 차가 여러 대면 원장도 여러 장이라, 같은 회차의 입금을 모두 더해 회차 청구액과 견준다.
//
// 바꾸는 것
//   "예정"이고 발행하지 않은 회차 중, 원장 입금 합계가 청구액 이상인 회차만 "입금완료"로 바꾼다.
//   일부만 들어온 회차는 차가 여러 대인데 원장이 일부만 연결됐을 수도 있어 바꾸지 않고 목록으로만 보여 준다.
//   원장에 기록이 없는 회차는 그대로 둔다(안 들어온 것인지 기록이 없는 것인지 알 수 없다).
//
// 실행 (기본은 미리보기, 쓰지 않는다)
//   cd server && node migrations/2026-10-04_backfill_round_payments_from_ledgers.js
//   cd server && node migrations/2026-10-04_backfill_round_payments_from_ledgers.js --apply
//   --apply 때는 바꾸기 전 회차표 전체를 JSON으로 백업한다.

import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';

dotenv.config();

const APPLY = process.argv.includes('--apply');
// --export <파일.xlsx>: 사람이 확인할 회차 목록을 엑셀로 남긴다
const EXPORT_PATH = process.argv.includes('--export') ? process.argv[process.argv.indexOf('--export') + 1] : null;
// 같은 금액으로 보는 차이. 한 계약의 렌트료를 차량 대수로 나눠 원장에 적으면서 원 단위가 남는다
// (레이 20대 계약: 청구 6,853,000 / 원장 합계 6,852,740). 0.1% 안쪽은 반올림 차이로 본다.
const sameAmount = (paid, total) => paid >= total || (total > 0 && (total - paid) / total <= 0.001);

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
const won = (n) => `${Math.round(n || 0).toLocaleString()}원`;

const main = async () => {
  await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  console.log(`[모드] ${APPLY ? '실제 반영 (--apply)' : '미리보기 (쓰지 않음)'}  DB: ${db.databaseName}`);

  // 1) 원장 렌트료 입금을 (계약, 회차)별로 모은다
  const ledgers = await db.collection('vehicleledgers')
    .find({}, { projection: { ledgerNo: 1, contract: 1, contractPeriods: 1, entries: 1 } })
    .toArray();

  const paidBy = new Map(); // `${contractId}:${round}` -> { amount, lastDate, ledgers: Set }
  let rentLines = 0;
  let unlinkedLines = 0;
  for (const l of ledgers) {
    const periods = l.contractPeriods?.length ? l.contractPeriods : [{ seq: 1, contract: l.contract }];
    for (const e of l.entries || []) {
      if (e.category !== '렌트료' || e.side !== '입금' || !(e.amount > 0) || !(e.round > 0)) continue;
      rentLines += 1;
      const period = periods.find((p) => (p.seq || 1) === (e.periodSeq || 1));
      if (!period?.contract) { unlinkedLines += 1; continue; }
      const key = `${period.contract}:${e.round}`;
      const slot = paidBy.get(key) || { amount: 0, lastDate: null, ledgers: new Set() };
      slot.amount += e.amount;
      if (e.date && (!slot.lastDate || new Date(e.date) > slot.lastDate)) slot.lastDate = new Date(e.date);
      slot.ledgers.add(l.ledgerNo);
      paidBy.set(key, slot);
    }
  }

  // 2) 회차표와 견준다
  const schedules = await db.collection('billingschedules').find({}).toArray();
  const contracts = new Map((await db.collection('contracts')
    .find({ _id: { $in: schedules.map((s) => s.contract) } }, { projection: { contractNo: 1 } })
    .toArray()).map((c) => [String(c._id), c.contractNo]));

  const today = new Date();
  const stats = { full: 0, fullAmount: 0, partial: [], over: 0, alreadyDone: 0, pastNoRecord: 0, matchedKeys: 0 };
  const updates = []; // { scheduleId, no, paidAmount, paidAt }

  for (const s of schedules) {
    for (const r of s.rounds || []) {
      const slot = paidBy.get(`${s.contract}:${r.no}`);
      if (slot) stats.matchedKeys += 1;
      if (r.status !== '예정' || r.issuedAt) { if (slot) stats.alreadyDone += 1; continue; }
      if (!slot) {
        if (new Date(r.dueDate) < today) stats.pastNoRecord += 1;
        continue;
      }
      const total = r.total || 0;
      // 입금일이 출금일보다 45일 넘게 앞서면 같은 회차가 아니다. 재계약하면서 계약일이 바뀐 계약에서
      // 최초 계약의 N회차 입금이 재계약 회차표의 N회차에 붙는 일이 있었다(2026-10-04, 93건 되돌림).
      if (slot.lastDate && (new Date(r.dueDate) - slot.lastDate) / 864e5 > 45) {
        stats.partial.push({
          contractNo: contracts.get(String(s.contract)) || String(s.contract),
          no: r.no, dueDate: r.dueDate, paidAt: slot.lastDate, total, paid: slot.amount, ledgers: [...slot.ledgers].join(','), mismatch: true
        });
        continue;
      }
      // 청구액의 1.9배 이상 들어왔으면 두 달치를 한 번에 냈거나 다른 회차 입금이 섞인 것일 수 있다. 사람이 본다.
      if (total > 0 && slot.amount >= total * 1.9) {
        stats.partial.push({
          contractNo: contracts.get(String(s.contract)) || String(s.contract),
          no: r.no, dueDate: r.dueDate, paidAt: slot.lastDate, total, paid: slot.amount, ledgers: [...slot.ledgers].join(','), tooMuch: true
        });
        continue;
      }
      if (sameAmount(slot.amount, total)) {
        stats.full += 1;
        stats.fullAmount += slot.amount;
        if (slot.amount > total * 1.001) {
          stats.over += 1;
          stats.overSamples = stats.overSamples || [];
          stats.overSamples.push({ contractNo: contracts.get(String(s.contract)), no: r.no, total, paid: slot.amount, ratio: slot.amount / total });
        }
        updates.push({ scheduleId: s._id, no: r.no, paidAmount: slot.amount, paidAt: slot.lastDate || r.dueDate });
      } else {
        stats.partial.push({
          contractNo: contracts.get(String(s.contract)) || String(s.contract),
          no: r.no, dueDate: r.dueDate, paidAt: slot.lastDate, total, paid: slot.amount, ledgers: [...slot.ledgers].join(',')
        });
      }
    }
  }

  // 원장 입금 중 회차표와 짝을 못 찾은 것(회차표가 없는 계약, 회차표보다 큰 회차 번호 등)
  const scheduleKeys = new Set(schedules.flatMap((s) => (s.rounds || []).map((r) => `${s.contract}:${r.no}`)));
  const orphan = [...paidBy.keys()].filter((k) => !scheduleKeys.has(k));

  console.log(`\n원장 렌트료 입금 줄 ${rentLines.toLocaleString()}개 (계약 구간을 못 찾은 줄 ${unlinkedLines})`);
  console.log(`(계약, 회차)로 묶으면 ${paidBy.size.toLocaleString()}건 · 회차표와 짝지은 것 ${stats.matchedKeys.toLocaleString()}건 · 회차표에 없는 것 ${orphan.length}건`);
  console.log(`\n▶ 입금완료로 바꿀 회차: ${stats.full.toLocaleString()}건 (${won(stats.fullAmount)}) — 그중 청구액보다 많이 들어온 회차 ${stats.over}건`);
  console.log(`▶ 사람이 확인할 회차: ${stats.partial.length}건 (일부만 들어옴 ${stats.partial.filter((p) => !p.tooMuch && !p.mismatch).length} · 1.9배 이상 들어옴 ${stats.partial.filter((p) => p.tooMuch).length} · 입금일이 출금일보다 한참 앞섬(재계약 의심) ${stats.partial.filter((p) => p.mismatch).length})`);
  console.log(`▶ 이미 발행·입금 처리된 회차(건드리지 않음): ${stats.alreadyDone}건`);
  console.log(`▶ 출금일이 지났는데 원장에 입금 기록이 없는 회차: ${stats.pastNoRecord.toLocaleString()}건 (그대로 둠)`);
  // 청구액보다 많이 들어온 회차가 왜 그런지 보도록 배율 분포를 보인다
  const buckets = {};
  (stats.overSamples || []).forEach((o) => {
    const k = o.ratio < 1.12 ? '~1.1배(부가세 등)' : o.ratio < 1.9 ? '1.1~1.9배' : o.ratio < 2.1 ? '약 2배(두 달치)' : '2배 초과';
    buckets[k] = (buckets[k] || 0) + 1;
  });
  console.log('   청구액보다 많이 들어온 회차의 배율:', buckets);
  (stats.overSamples || []).slice(0, 6).forEach((o) => console.log(`   + ${o.contractNo} ${o.no}회차: 청구 ${won(o.total)} / 원장 ${won(o.paid)} (${o.ratio.toFixed(2)}배)`));
  const pr = {};
  stats.partial.forEach((p) => { const k = p.paid / p.total < 0.5 ? '절반 미만' : p.paid / p.total < 0.9 ? '50~90%' : '90% 이상'; pr[k] = (pr[k] || 0) + 1; });
  console.log('   일부만 들어온 회차의 비율:', pr);
  stats.partial.slice(0, 15).forEach((p) => console.log(`   - ${p.contractNo} ${p.no}회차: 청구 ${won(p.total)} / 원장 입금 ${won(p.paid)} [${p.ledgers}]`));
  if (stats.partial.length > 15) console.log(`   … 외 ${stats.partial.length - 15}건`);

  if (EXPORT_PATH) {
    const reason = (p) => (p.mismatch ? '입금일이 출금일보다 한참 앞섬(재계약 회차 의심)' : p.tooMuch ? '청구액의 1.9배 이상 입금' : '일부만 입금');
    const rows = stats.partial.map((p) => ({
      계약번호: p.contractNo, 회차: p.no, 출금일: ymd(p.dueDate), 원장입금일: ymd(p.paidAt),
      청구액: p.total, 원장입금합계: p.paid, 차이: p.paid - p.total, 구분: reason(p), 원장: p.ledgers
    })).sort((a, b) => String(a.계약번호).localeCompare(String(b.계약번호)) || a.회차 - b.회차);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [12, 6, 11, 11, 12, 12, 12, 34, 40].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, '확인필요');
    XLSX.writeFile(wb, EXPORT_PATH);
    console.log(`
확인 목록 ${rows.length}줄을 저장했습니다: ${EXPORT_PATH}`);
  }

  if (!APPLY) {
    console.log('\n미리보기만 했습니다. 반영하려면 --apply를 붙여 다시 실행하세요.');
    await mongoose.disconnect();
    return;
  }

  // 3) 백업하고 반영한다
  const backupDir = path.join(os.homedir(), 'rentbenefit-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `billingschedules_before_ledger_backfill_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(schedules));
  console.log(`\n백업: ${backupFile}`);

  const bySchedule = new Map();
  for (const u of updates) {
    if (!bySchedule.has(String(u.scheduleId))) bySchedule.set(String(u.scheduleId), []);
    bySchedule.get(String(u.scheduleId)).push(u);
  }
  let written = 0;
  for (const [id, list] of bySchedule) {
    // 쓰기 직전에 다시 읽는다. 미리보기 뒤에 누가 발행·입금 처리한 회차는 건드리지 않는다.
    const fresh = await db.collection('billingschedules').findOne({ _id: new mongoose.Types.ObjectId(id) });
    const set = {};
    let count = 0;
    for (const u of list) {
      const idx = fresh.rounds.findIndex((r) => r.no === u.no);
      const r = fresh.rounds[idx];
      if (idx === -1 || r.status !== '예정' || r.issuedAt) continue;
      set[`rounds.${idx}.status`] = '입금완료';
      set[`rounds.${idx}.paidAmount`] = u.paidAmount;
      set[`rounds.${idx}.paidAt`] = u.paidAt;
      count += 1;
    }
    if (!count) continue;
    const res = await db.collection('billingschedules').updateOne({ _id: fresh._id }, { $set: set });
    written += res.modifiedCount ? count : 0;
  }
  console.log(`반영: 회차표 ${bySchedule.size}개, 회차 ${written.toLocaleString()}건을 입금완료로 바꿨습니다.`);
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error('실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
