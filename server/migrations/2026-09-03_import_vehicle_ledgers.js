// 엑셀 갑지 -> 차량 손익 원장(VehicleLedger) 일회성 이관 스크립트.
//
// 원본: "렌트베네핏 장기렌트_갑지.xlsx" 의 차량별 시트 한 장 = 갑지 한 장.
// 시트 구조는 127장 모두 같다.
//   3행  구분(C) / 고객명(H) / 계약자명(M)
//   4행  차량번호(C) / 차종(H) / 차량 사양(M)
//   5행  등록일(C) / 계약일(H) / 계약종료일(M)
//   6행  차량가(C) / 배기량(H)
//   9~11행  집계(회사출금액 / 고객입금액 / 정산금액) - 시트가 스스로 계산해 둔 값
//   14행 이후  3개 블록(회사출금 / 고객입금 / 기타)의 [내용, 금액, 은행, 날짜]
//
// 검증: 시트가 스스로 계산해 둔 9~11행 집계와, 이관한 줄로 다시 계산한 집계를 대조한다.
//       한 장이라도 어긋나면 그 시트를 이름과 차액까지 찍어 준다. 장부는 1원도 틀리면 안 된다.
//
// 실행:
//   cd server && node migrations/2026-09-03_import_vehicle_ledgers.js --dry-run
//   cd server && node migrations/2026-09-03_import_vehicle_ledgers.js
//   ... --force        이미 이관한 갑지를 지우고 다시 넣는다
//   ... --file "경로"  다른 파일에서 읽는다

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import connectDB from '../config/db.js';
import VehicleLedger, { summarizeLedger } from '../models/VehicleLedger.js';
import Vehicle from '../models/Vehicle.js';
import Contract from '../models/Contract.js';

dotenv.config();

const DEFAULT_FILE = 'C:/Users/RentBenefit/OneDrive - CEO/RENT/렌터카 DB/렌트베네핏 장기렌트_갑지.xlsx';

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
};
const isDryRun = process.argv.includes('--dry-run');
const isForce = process.argv.includes('--force');
const filePath = argValue('--file') || DEFAULT_FILE;

// 차량 시트가 아닌 것들. 인덱스·양식·백업·계약금 집계표라 갑지가 아니다.
const NON_VEHICLE_SHEETS = new Set(['갑지_Backpu (원본)', '계약금', '장기렌트_갑지', '양식', '신동호']);

// 엑셀 3개 블록의 시작 열과, 그 블록이 갑지에서 갖는 뜻
const BLOCKS = [
  { startCol: 1, group: '회사출금', side: '지출' },
  { startCol: 6, group: '고객입금', side: '입금' },
  { startCol: 11, group: '기타', side: '입금' }
];

/**
 * 항목명에서 분류를 고른다.
 *
 * 엑셀의 항목명은 사람이 그때그때 적은 자유 문구라 464가지나 된다
 * ("과태료", "미납 통행료", "미납통행료", "미남통행료" …).
 * 그래서 이름 자체는 그대로 보존하고, 통계를 낼 수 있게 꼬리표만 붙인다.
 *
 * 순서가 중요하다. "삼성보험료 환급"은 보험이 아니라 환급이고,
 * "렌터카보험 보증금"은 보증금이 아니라 공제조합 출자금이다.
 */
const CATEGORY_RULES = [
  [/환급|환입|환불|취소/, '환급'],
  [/캐시백/, '캐시백'],
  [/수수료/, '수수료'],
  [/렌공|공제조합|공제조함|렌터카\s*공제|렌트카공제|렌트\s*보험|렌터카보험|출자금/, '공제조합'],
  [/과태료|통행료|범칙|속도위반|주정차/, '과태료·통행료'],
  [/자동차세|교육세/, '자동차세'],
  [/검사/, '검사비'],
  [/정기\s*점검|정기점검/, '정기점검'],
  [/썬팅|선팅|블박|블랙박스|PPF|유리막|코팅|매트|타이어|캐리어|번호판\s*교체/, '차량작업'],
  [/수리|사고|면책|본인\s*부담|고객부담|휴차|유리복원/, '수리·사고'],
  [/주유|세차|충전|워셔/, '유류·세차'],
  [/탁송/, '탁송'],
  [/취득세|개별\s*소비세|개소세|가산세|형식변경|구조변경/, '제세공과'],
  [/할부/, '할부금'],
  [/^이자|이자$/, '할부이자'],
  [/보험/, '보험'],
  [/등록비용/, '등록비용'],
  [/계약금/, '계약금'],
  [/차량가|차량\s*대금/, '차량가'],
  [/보증금/, '보증금'],
  [/선납금|선수금/, '선납금'],
  [/인수가/, '인수가'],
  [/렌트료|렌트\s*\d+\s*회차/, '렌트료']
];

const pickCategory = (label) => {
  const text = String(label || '');
  const hit = CATEGORY_RULES.find(([rx]) => rx.test(text));
  return hit ? hit[1] : '기타';
};

/**
 * 이관한 줄에 붙일 source.
 *
 * 나중에 "계약·청구에서 가져오기"를 눌렀을 때, 자동 연동이 만들려는 줄과
 * 같은 열쇠(source + category + round)를 갖게 해 둔다. 그러면 이미 있는 줄로 인식되고,
 * locked가 켜져 있으므로 건드리지 않고 지나간다 - 즉 중복 줄이 생기지 않는다.
 */
const pickSource = (category, round) => {
  if (category === '렌트료' && round) return 'billing';
  if (category === '할부금' && round) return 'loan';
  if (category === '보험' && round === 1) return 'vehicle';
  if (['차량가', '보증금', '선납금', '인수가'].includes(category)) return 'contract';
  return 'manual';
};

const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[,\s원]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const toDate = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'string') {
    const d = new Date(v.trim());
    if (!Number.isNaN(d.getTime()) && /\d{4}/.test(v)) return d;
  }
  return undefined;
};

const text = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
  return s === '-' ? '' : s;
};

const cell = (rows, r, c) => (rows[r] ? rows[r][c] : undefined);

/** 시트 한 장을 갑지 한 장 분량의 값으로 바꾼다. */
const parseSheet = (rows, sheetName) => {
  const header = {
    customerName: text(cell(rows, 3, 7)),
    contractorName: text(cell(rows, 3, 12)),
    plateNo: text(cell(rows, 4, 2)),
    carModel: text(cell(rows, 4, 7)),
    carSpec: text(cell(rows, 4, 12)),
    registeredAt: toDate(cell(rows, 5, 2)),
    contractedAt: toDate(cell(rows, 5, 7)),
    contractEndAt: toDate(cell(rows, 5, 12)),
    carPrice: toNumber(cell(rows, 6, 2)) || undefined,
    cc: toNumber(cell(rows, 6, 7)) || undefined
  };

  // 시트가 스스로 계산해 둔 집계. 이관 결과를 여기에 맞춰 검산한다.
  const expected = {
    paidOut: toNumber(cell(rows, 10, 3)),
    paidIn: toNumber(cell(rows, 10, 8)),
    balance: toNumber(cell(rows, 10, 13))
  };

  const entries = [];
  for (let r = 14; r < rows.length; r += 1) {
    BLOCKS.forEach((block) => {
      const label = text(cell(rows, r, block.startCol));
      const amount = toNumber(cell(rows, r, block.startCol + 1));
      // 금액이 없는 줄은 양식에 미리 찍혀 있는 빈 항목이다(계약금·보증금·선납금 …). 옮기지 않는다.
      if (!amount) return;

      const category = pickCategory(label);
      const roundMatch = /(\d+)\s*회차/.exec(label);
      const round = roundMatch ? Number(roundMatch[1]) : undefined;

      entries.push({
        side: block.side,
        group: block.group,
        category,
        label: label || category,
        amount,
        bank: text(cell(rows, r, block.startCol + 2)),
        date: toDate(cell(rows, r, block.startCol + 3)),
        round,
        source: pickSource(category, round),
        // 옮겨 온 줄은 전부 잠근다. 이미 끝난 장부의 사실이라 어떤 자동 연동도 다시 쓰면 안 된다.
        locked: true,
        memo: `엑셀 갑지 ${sheetName} 시트에서 이관`
      });
    });
  }

  return { header, expected, entries };
};

/** 옮겨 온 줄에서 고정 조건을 추려 낸다. 월 렌트료는 회차 금액 중 가장 많이 나온 값으로 본다. */
const deriveTerms = (entries) => {
  const sumOf = (category) => entries
    .filter((e) => e.category === category && e.group !== '회사출금')
    .reduce((s, e) => s + e.amount, 0);

  const rents = entries.filter((e) => e.category === '렌트료' && e.amount > 0).map((e) => e.amount);
  const freq = new Map();
  rents.forEach((a) => freq.set(a, (freq.get(a) || 0) + 1));
  const monthlyRent = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    monthlyRent,
    deposit: sumOf('보증금') || undefined,
    advancePayment: sumOf('선납금') || undefined,
    takeoverPrice: sumOf('인수가') || undefined
  };
};

const run = async () => {
  await connectDB();
  const conn = mongoose.connection;

  console.log(`\n[모드] ${isDryRun ? 'DRY-RUN (쓰기 없음)' : '실제 실행'}${isForce ? ' + FORCE(기존 갑지 삭제 후 재이관)' : ''}`);
  console.log(`[DB] ${conn.host} / ${conn.name}`);
  console.log(`[파일] ${filePath}`);

  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetNames = wb.SheetNames.filter((n) => !NON_VEHICLE_SHEETS.has(n));
  console.log(`[대상] 차량 시트 ${sheetNames.length}장 (전체 ${wb.SheetNames.length}장 중)\n`);

  // 차량번호로 렌트차량 DB와 이어 붙이기 위한 색인.
  // 같은 차량번호를 쓰는 차가 둘 이상이면 어느 쪽인지 알 수 없으므로 잇지 않는다.
  const vehicles = await Vehicle.find({ plateNo: { $nin: [null, ''] } })
    .select('plateNo contract company code').lean();
  const byPlate = new Map();
  vehicles.forEach((v) => {
    const key = v.plateNo.replace(/\s/g, '');
    byPlate.set(key, byPlate.has(key) ? 'AMBIGUOUS' : v);
  });
  const alreadyLinked = new Set(
    (await VehicleLedger.find({ vehicle: { $ne: null } }).select('vehicle').lean())
      .map((l) => String(l.vehicle))
  );

  const stats = { imported: 0, skipped: 0, linked: 0, entries: 0, mismatched: [], unlinked: [], failed: [] };

  for (const name of sheetNames) {
    try {
      const existing = await VehicleLedger.findOne({ ledgerNo: name }).select('_id').lean();
      if (existing && !isForce) {
        stats.skipped += 1;
        continue;
      }

      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      const { header, expected, entries } = parseSheet(rows, name);

      // 검산: 옮긴 줄로 다시 계산한 집계가 시트의 집계와 같아야 한다.
      const got = summarizeLedger({ entries });
      const off = (a, b) => Math.abs((a || 0) - (b || 0)) > 1; // 엑셀 수식의 소수점 오차만 허용
      if (off(got.paidOut, expected.paidOut) || off(got.paidIn, expected.paidIn) || off(got.balance, expected.balance)) {
        stats.mismatched.push({
          name,
          지출: [Math.round(expected.paidOut), Math.round(got.paidOut)],
          입금: [Math.round(expected.paidIn), Math.round(got.paidIn)],
          정산: [Math.round(expected.balance), Math.round(got.balance)]
        });
      }

      // 렌트차량 DB에 같은 차량번호가 딱 하나 있으면 이어 붙인다
      const plateKey = header.plateNo.replace(/\s/g, '');
      const match = plateKey ? byPlate.get(plateKey) : null;
      const vehicle = (match && match !== 'AMBIGUOUS' && !alreadyLinked.has(String(match._id))) ? match : null;
      const contract = vehicle?.contract
        ? await Contract.findById(vehicle.contract).select('customer companyId').lean()
        : null;

      if (!isDryRun) {
        if (existing) await VehicleLedger.deleteOne({ _id: existing._id });

        await VehicleLedger.create({
          ledgerNo: name,
          vehicle: vehicle?._id || null,
          contract: vehicle?.contract || null,
          company: contract?.companyId || vehicle?.company || null,
          customer: contract?.customer || null,
          status: vehicle ? '운용중' : '차량미배정',
          header,
          terms: deriveTerms(entries),
          entries,
          note: `엑셀 갑지 "${name}" 시트에서 이관 (${new Date().toISOString().slice(0, 10)})`
        });
      }

      if (vehicle) {
        alreadyLinked.add(String(vehicle._id));
        stats.linked += 1;
      } else {
        // 차량번호가 없거나, 렌트차량 DB에 없거나, 같은 번호가 둘 이상인 경우.
        // 억지로 잇지 않고 이름을 남긴다. 화면에서 "차량 연결"로 직접 고르면 된다.
        stats.unlinked.push(`${name}${header.plateNo ? ` (${header.plateNo})` : ' (차량번호 없음)'}`);
      }
      stats.imported += 1;
      stats.entries += entries.length;
    } catch (err) {
      stats.failed.push({ name, message: err.message });
    }
  }

  console.log('[결과]');
  console.log(`  이관한 갑지        : ${stats.imported}장`);
  console.log(`  옮긴 내역 줄       : ${stats.entries}줄`);
  console.log(`  렌트차량 DB 연결   : ${stats.linked}장 (차량번호가 정확히 하나 일치한 경우만)`);
  console.log(`  건너뜀(이미 있음)  : ${stats.skipped}장  ${stats.skipped ? '- 다시 넣으려면 --force' : ''}`);

  if (stats.unlinked.length) {
    console.log(`
[차량 미연결] ${stats.unlinked.length}장 - 화면에서 "차량 연결"로 직접 이어 주세요`);
    stats.unlinked.forEach((u) => console.log(`  ${u}`));
  }

  if (stats.mismatched.length) {
    console.log(`\n[검산 불일치] ${stats.mismatched.length}장 - 엑셀 집계 vs 이관 결과`);
    stats.mismatched.forEach((m) => {
      console.log(`  ${m.name}: 지출 ${m.지출[0]} → ${m.지출[1]} / 입금 ${m.입금[0]} → ${m.입금[1]} / 정산 ${m.정산[0]} → ${m.정산[1]}`);
    });
  } else {
    console.log(`\n[검산] ${stats.imported}장 모두 엑셀 집계와 일치합니다.`);
  }

  if (stats.failed.length) {
    console.log(`\n[실패] ${stats.failed.length}장`);
    stats.failed.forEach((f) => console.log(`  ${f.name}: ${f.message}`));
  }

  if (!isDryRun) {
    console.log(`\n[최종] 차량 손익 원장 총 ${await VehicleLedger.countDocuments()}장`);
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('이관 중 오류:', err);
  await mongoose.disconnect();
  process.exit(1);
});
