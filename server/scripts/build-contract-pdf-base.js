import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import ContractTemplate from '../models/ContractTemplate.js';
import ContractTemplateFile from '../models/ContractTemplateFile.js';
import ContractTemplatePdf from '../models/ContractTemplatePdf.js';

dotenv.config();

/**
 * 전자계약서 'PDF 바탕'을 만든다. (Excel이 설치된 Windows PC에서만 돌린다)
 *
 * 1) 양식(ContractTemplate)에서 값 칸(수식 칸) 목록을 뽑는다
 * 2) Excel로 빈 PDF(blank)와 표시 PDF(marker: 값 칸마다 C001…)를 뽑는다 (export-contract-pdf-base.ps1)
 * 3) 표시 PDF에서 표시가 찍힌 자리를 읽어 '값 자리 지도'를 만든다
 * 4) 빈 PDF와 지도를 DB(ContractTemplatePdf)에 저장한다. 운영 서버는 이것으로 계약서 PDF를 만든다
 *
 * 양식을 새로 올렸거나 엑셀 칸 위치가 바뀌면 다시 돌린다.
 *
 *   node scripts/build-contract-pdf-base.js                 사용 중 양식
 *   node scripts/build-contract-pdf-base.js <templateId>    특정 양식
 *   (--dry-run: DB에 저장하지 않고 결과만 보여 준다)
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const templateId = process.argv.slice(2).find((a) => !a.startsWith('--'));
const SHEETS = ['계약서_1', '계약서_2', '계약서_3', '계약서_4', '계약서_5', '계약서_6', '계약서_7', '계약서_8', '계약서_9', '계약서_10', '계약서_11', '계약서_12'];

const textItems = async (pdfjs, file) => {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    for (const it of (await page.getTextContent()).items) {
      if (!it.str) continue;
      const [a, b, , d, e, f] = it.transform;
      out.push({ page: n, str: it.str, x: e, y: f, w: it.width, size: Math.hypot(a || 0, b || 0) || Math.abs(d), pageW: vp.width, pageH: vp.height });
    }
  }
  return { items: out, pages: doc.numPages };
};

const run = async () => {
  if (process.platform !== 'win32') throw new Error('Excel이 있는 Windows PC에서 돌려야 합니다.');
  await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);
  const template = templateId
    ? await ContractTemplate.findById(templateId).lean()
    : await ContractTemplate.findOne({ kind: '장기렌트', active: true }).lean();
  if (!template) throw new Error('양식을 찾지 못했습니다.');
  const file = await ContractTemplateFile.findOne({ template: template._id }).lean();
  if (!file) throw new Error('양식 엑셀 원본이 없습니다.');
  console.log(`양식: ${template.name} (v${template.version})`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-pdf-'));
  const xlsx = path.join(work, 'template.xlsx');
  fs.writeFileSync(xlsx, Buffer.from(file.data.buffer || file.data));

  // 1) 값 칸
  const cells = [];
  for (const s of template.sheets) {
    if (!SHEETS.includes(s.name)) continue;
    for (const c of s.cells) if (c.bind) cells.push({ token: `C${String(cells.length + 1).padStart(3, '0')}`, sheet: s.name, a: c.a });
  }
  const cellsFile = path.join(work, 'bound-cells.json');
  fs.writeFileSync(cellsFile, JSON.stringify(cells));
  console.log(`값 칸 ${cells.length}개`);

  // 2) Excel로 PDF 두 벌
  // 한글 장 이름이 든 스크립트라 PowerShell 7(pwsh)로 돌린다(Windows PowerShell 5는 UTF-8 스크립트를 깨뜨린다)
  execFileSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'export-contract-pdf-base.ps1'),
    '-Xlsx', xlsx, '-Cells', cellsFile, '-OutDir', work], { stdio: 'inherit' });

  // 3) 값 자리 지도
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const marker = await textItems(pdfjs, path.join(work, 'marker.pdf'));
  const blank = await textItems(pdfjs, path.join(work, 'blank.pdf'));
  const fields = [];
  const missing = [];
  for (const c of cells) {
    const it = marker.items.find((x) => x.str.includes(c.token));
    if (!it) { missing.push(`${c.sheet}!${c.a}`); continue; }
    const charW = it.w / Math.max(it.str.length, 1);
    fields.push({ sheet: c.sheet, a: c.a, page: it.page, x: +(it.x + charW * it.str.indexOf(c.token)).toFixed(2), y: +it.y.toFixed(2), size: +it.size.toFixed(2), tokenW: +(charW * c.token.length).toFixed(2) });
  }
  const pageW = marker.items[0]?.pageW || 595;
  // 값 자리마다 쓸 수 있는 폭: 같은 줄에서 오른쪽(오른쪽 맞춤 칸은 왼쪽)의 가장 가까운 글까지
  for (const f of fields) {
    const line = blank.items.filter((x) => x.page === f.page && Math.abs(x.y - f.y) < 3 && x.str.trim());
    const right = line.filter((x) => x.x > f.x + 1).sort((p, q) => p.x - q.x)[0];
    const left = line.filter((x) => x.x + x.w < f.x + f.tokenW - 1).sort((p, q) => (q.x + q.w) - (p.x + p.w))[0];
    f.roomRight = +((right ? right.x : pageW - 28) - f.x - 3).toFixed(2);
    f.roomLeft = +((f.x + f.tokenW) - (left ? left.x + left.w : 28) - 3).toFixed(2);
  }
  // 체크 칸(네모는 글 바로 왼쪽). 결제일은 "5" "일"처럼 쪼개져 있어 '말일' 줄의 숫자를 찾는다
  const find = (page, str) => blank.items.find((x) => x.page === page && x.str.trim() === str);
  const pos = (it) => (it ? { x: +it.x.toFixed(2), y: +it.y.toFixed(2), size: +it.size.toFixed(2) } : null);
  const lastDay = find(2, '말일');
  const dayAt = (s) => (lastDay ? blank.items.find((x) => x.page === 2 && x.str.trim() === s && Math.abs(x.y - lastDay.y) < 2) : null);
  const checks = {
    payDay: { 5: pos(dayAt('5')), 10: pos(dayAt('10')), 15: pos(dayAt('15')), 25: pos(dayAt('25')), 말일: pos(lastDay) },
    driverScope: { 법인: pos(find(2, '법인')), 개인: pos(find(2, '개인')) },
    blackbox: { 장착: pos(find(3, '장착')), '장착하지 않음': pos(find(3, '장착하지 않음')) }
  };
  const map = { pageSize: { w: pageW, h: marker.items[0]?.pageH, pages: marker.pages }, fields, checks };
  console.log(`PDF ${marker.pages}쪽 · 값 자리 ${fields.length}/${cells.length}${missing.length ? ` · 못 찾음 ${missing.join(', ')}` : ''}`);
  const nullChecks = Object.entries(checks).flatMap(([k, v]) => Object.entries(v).filter(([, p]) => !p).map(([n]) => `${k}.${n}`));
  if (nullChecks.length) console.log(`체크 칸 못 찾음: ${nullChecks.join(', ')}`);
  if (marker.pages !== SHEETS.length) throw new Error(`쪽 수가 ${SHEETS.length}이 아닙니다(${marker.pages}). 엑셀 인쇄 설정을 확인하세요.`);

  // 4) 저장
  if (!dryRun) {
    await ContractTemplatePdf.findOneAndUpdate(
      { template: template._id },
      { $set: { blank: fs.readFileSync(path.join(work, 'blank.pdf')), map, sheets: SHEETS, builtBy: os.userInfo().username } },
      { upsert: true }
    );
    console.log('DB에 저장했습니다.');
  } else {
    console.log('저장하지 않았습니다(--dry-run).');
  }
  fs.rmSync(work, { recursive: true, force: true });
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('실패:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
