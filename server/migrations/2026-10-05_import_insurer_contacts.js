/**
 * 엑셀 "12. 단기 렌트비용.xls"의 '사고대차 보험담당자' 시트를 단가표 화면(공업사별 보험 담당자)으로 옮긴다.
 *
 *   cd server && node migrations/2026-10-05_import_insurer_contacts.js           ← 미리보기(바꾸지 않음)
 *   cd server && node migrations/2026-10-05_import_insurer_contacts.js --apply   ← 반영
 *
 * 이미 화면에 적은 담당자가 있으면 같은 (공업사, 보험사, 담당자, 연락처) 줄은 건너뛰고 새 줄만 붙인다.
 * 연락처는 소스 코드에 넣지 않고 엑셀에서 바로 읽는다.
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import Setting from '../models/Setting.js';

const APPLY = process.argv.includes('--apply');
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../example/12. 단기 렌트비용.xls');
const KEY = 'shortTermRateCard';

const wb = XLSX.readFile(FILE);
const ws = wb.Sheets['사고대차 보험담당자'];
if (!ws) throw new Error('엑셀에 "사고대차 보험담당자" 시트가 없습니다.');
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

// 머리글(공업사 | 보험사 | 보험 담당자 | 연락처 | 비고) 아래 줄. 셀 병합 때문에 열 위치를 머리글에서 찾는다.
const headIdx = rows.findIndex((r) => r.some((c) => String(c).trim() === '공업사'));
const head = rows[headIdx].map((c) => String(c).trim());
const col = (name) => head.findIndex((c) => c === name);
const [cShop, cIns, cName, cPhone, cNote] = ['공업사', '보험사', '보험 담당자', '연락처', '비고'].map(col);
const contacts = rows.slice(headIdx + 1)
  .map((r) => ({
    shop: String(r[cShop] || '').trim(),
    insurer: String(r[cIns] || '').trim(),
    name: String(r[cName] || '').trim(),
    phone: String(r[cPhone] || '').trim(),
    note: cNote >= 0 ? String(r[cNote] || '').trim() : ''
  }))
  .filter((c) => c.shop && (c.name || c.phone));

const sameKey = (c) => [c.shop, c.insurer, c.name, c.phone].join('|');

await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);
const doc = await Setting.findOne({ key: KEY }).lean();
const existing = doc?.value?.contacts || [];
const seen = new Set(existing.map(sameKey));
const fresh = [];
for (const c of contacts) {
  if (seen.has(sameKey(c))) continue;
  seen.add(sameKey(c));
  fresh.push(c);
}

console.log(`엑셀 담당자 ${contacts.length}줄 → 화면에 이미 있는 ${existing.length}줄, 새로 붙일 줄 ${fresh.length}줄(중복 제외)`);
fresh.forEach((c) => console.log(`  ${c.shop} · ${c.insurer} · ${c.name} · ${c.phone.replace(/\d{4}$/, '****')}`));

if (!APPLY) {
  console.log('\n미리보기만 했습니다. 반영하려면 --apply를 붙여 다시 실행하세요.');
} else if (fresh.length) {
  await Setting.findOneAndUpdate(
    { key: KEY },
    { $set: { 'value.contacts': [...existing, ...fresh], updatedBy: '엑셀 가져오기(12. 단기 렌트비용.xls)' } },
    { upsert: true }
  );
  console.log(`\n${fresh.length}줄을 반영했습니다.`);
}
await mongoose.disconnect();
