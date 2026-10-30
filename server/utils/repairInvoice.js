import { randomUUID } from 'crypto';
import { PDFParse } from 'pdf-parse';
import XLSX from 'xlsx';
import { findPlateNumbers, findLabeledDate } from './fineNoticeOcr.js';

// 정비소가 주는 수리 내역서(점검·정비 명세서, 견적서)에서 글자를 읽어 정비 기록 양식에 채운다.
//
// 고지서 읽기와 같은 원칙: 읽은 값을 바로 저장하지 않는다. 양식 칸을 채워 주고 사람이 확인한 뒤 저장한다.
// 읽은 글자(text)도 함께 돌려줘 화면에서 고쳐 다시 정리할 수 있게 한다. 글자가 기준이다.

const CLOVA_FORMAT_BY_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff'
};
const XLSX_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
];

/** PDF 글자층. 스캔본이면 빈 값 */
const pdfText = async (buffer) => {
  const parser = new PDFParse({ data: buffer });
  try {
    return (await parser.getText()).text || '';
  } catch {
    return '';
  } finally {
    await parser.destroy();
  }
};

/** 엑셀 내역서. 시트마다 한 줄에 칸을 띄어 이어 붙인다 */
const xlsxText = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.SheetNames.map((name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
    .map((row) => row.map((c) => String(c).trim()).filter(Boolean).join('  '))
    .filter(Boolean)
    .join('\n')).join('\n');
};

/**
 * CLOVA OCR. 조각마다 lineBreak가 붙어 와 줄을 되살린다(표의 한 줄이 한 줄로 남아야 부품·공임을 가를 수 있다).
 */
const clovaText = async (buffer, mimeType, originalName) => {
  const invokeUrl = process.env.CLOVA_OCR_INVOKE_URL;
  const secret = process.env.CLOVA_OCR_SECRET;
  if (!invokeUrl || !secret) throw new Error('OCR이 설정되지 않아 사진·스캔본은 읽을 수 없습니다. 글자를 붙여 넣어 주세요.');
  const format = CLOVA_FORMAT_BY_MIME[mimeType];
  if (!format) throw new Error(`읽을 수 없는 파일 형식입니다(${mimeType}). PDF, 엑셀, JPG, PNG만 됩니다.`);

  const res = await fetch(invokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': secret },
    body: JSON.stringify({
      version: 'V2', requestId: randomUUID(), timestamp: Date.now(), lang: 'ko',
      images: [{ format, name: originalName || 'invoice', data: buffer.toString('base64') }]
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[수리 내역서 OCR] CLOVA 응답 ${res.status}: ${detail.slice(0, 300)}`);
    throw new Error(`글자를 읽지 못했습니다. (CLOVA 응답 ${res.status})`);
  }
  const payload = await res.json();
  return (payload?.images || []).map((image) => (image.fields || [])
    .map((f) => `${f.inferText || ''}${f.lineBreak ? '\n' : ' '}`).join('')).join('\n');
};

/**
 * 파일에서 글자를 꺼낸다. PDF·엑셀은 글자층을 먼저 보고(무료·즉시), 스캔본·사진은 CLOVA로 읽는다.
 * @returns {Promise<{text: string, source: 'pdf-text'|'xlsx'|'clova'}>}
 */
export const readInvoiceText = async (buffer, mimeType, originalName = '') => {
  const isXlsx = XLSX_MIMES.includes(mimeType) || /\.xlsx?$/i.test(originalName);
  if (isXlsx) return { text: xlsxText(buffer), source: 'xlsx' };
  if (mimeType === 'application/pdf') {
    const text = await pdfText(buffer);
    if (text.replace(/\s/g, '').length > 30) return { text, source: 'pdf-text' };
  }
  return { text: await clovaText(buffer, mimeType, originalName), source: 'clova' };
};

// ── 글자 정리 ──────────────────────────────────────────────────────────

/** 라벨 글자 사이 공백 허용 ('공 급 가 액') */
const spaced = (label) => label.split('').join('\\s*');
const NUM = '([0-9][0-9,]*)';
const toNum = (s) => Number(String(s || '').replace(/[,\s]/g, '')) || 0;

// 합계 줄 라벨. 앞에 있을수록 먼저 본다. 이 말이 든 줄은 작업 내역으로 세지 않는다.
const TOTAL_LABELS = {
  parts: ['부품비합계', '부품합계', '부품계', '부품비', '부품금액', '부품대'],
  labor: ['공임비합계', '공임합계', '공임계', '공임비', '공임료', '기술료', '공임'],
  supply: ['공급가액', '공급가', '소계'],
  vat: ['부가가치세', '부가세', '세액'],
  discount: ['할인금액', '할인액', '할인'],
  total: ['청구금액', '결제금액', '총합계', '합계금액', '총금액', '총액', '견적금액', '정비비합계', '합계']
};
const SUMMARY_WORD = /(합\s*계|소\s*계|공급\s*가|부가\s*가치\s*세|부가세|세\s*액|총\s*액|총\s*금액|청구\s*금액|결제\s*금액|할\s*인|부품\s*계|공임\s*계|부품비\s*합계|공임비\s*합계|견적\s*금액|잔\s*액|입금|계좌|은행|사업자|등록번호|전화|TEL|FAX|대표|주소|주행\s*거리|차량\s*번호|차\s*대\s*번호|입고|출고|일\s*자|일\s*시)/i;

/** '부가세 18,000' 처럼 라벨 바로 뒤 금액. 같은 라벨이 여럿이면 마지막(대개 맨 아래 합계)을 쓴다 */
const labeledAmount = (flat, labels) => {
  for (const label of labels) {
    const re = new RegExp(`${spaced(label)}\\s*(?:\\(\\s*[^)]{0,8}\\))?\\s*[:：]?\\s*₩?\\s*${NUM}\\s*원?`, 'g');
    let last = 0;
    let m = re.exec(flat);
    while (m) {
      const n = toNum(m[1]);
      if (n >= 100 || n === 0) last = n || last;
      m = re.exec(flat);
    }
    if (last) return last;
  }
  return 0;
};

/**
 * 라벨 뒤 글자 (상호 등). 줄 단위로 보고, 칸 사이 두 칸 이상 공백이나 다음 라벨(사업자·대표·전화…)에서 끊는다.
 * 'OO모터스 성동'처럼 띄어 쓴 이름이 한 칸에 들어 있어서다.
 */
const NEXT_LABEL = /\s{2,}|\s*(?:사업자|등록번호|대표|성명|전화|TEL|FAX|주소|차량|차종|주행|입고|출고|일자|[0-9]{3}\s*-\s*[0-9]{2}\s*-)/i;
const labeledText = (lines, labels) => {
  for (const label of labels) {
    const re = new RegExp(`${spaced(label)}\\s*[:：]?\\s*`);
    for (const line of lines) {
      const m = re.exec(line);
      if (!m) continue;
      const rest = line.slice(m.index + m[0].length);
      const value = rest.split(NEXT_LABEL)[0].trim().slice(0, 30);
      if (value && !SUMMARY_WORD.test(value)) return value;
    }
  }
  return '';
};

const INSURERS = ['삼성화재', '현대해상', 'DB손해보험', 'DB손보', 'KB손해보험', 'KB손보', '메리츠화재', '한화손해보험', '롯데손해보험', '흥국화재',
  'MG손해보험', '하나손해보험', 'AXA', '악사', '캐롯', '렌터카공제', '전국렌터카공제조합', '택시공제', '버스공제', '화물공제'];

/**
 * 한 줄을 작업 내역으로 읽는다. 끝에 붙은 숫자 묶음을 수량·단가·부품·공임·금액으로 가른다.
 * 숫자 개수마다 서식이 달라 곱·합이 맞는 쪽을 고른다.
 * @returns {{name: string, qty: number, unitPrice: number, parts: number, labor: number, amount: number}|null}
 */
const lineItemOf = (line) => {
  const tokens = line.replace(/[₩|]/g, ' ').replace(/(\d)\s*원(?=\s|$)/g, '$1').trim().split(/\s+/);
  const nums = [];
  while (tokens.length && /^\d[\d,]*(\.\d+)?$/.test(tokens[tokens.length - 1])) nums.unshift(toNum(tokens.pop()));
  const name = tokens.join(' ').replace(/^\d{1,3}[.)]?\s+/, '').trim(); // 앞 순번 '1.' 떼기
  if (!nums.length || !/[가-힣A-Za-z]{2,}/.test(name) || SUMMARY_WORD.test(name)) return null;

  const near = (a, b) => Math.abs(a - b) <= Math.max(10, b * 0.01);
  const item = { name, qty: 1, unitPrice: 0, parts: 0, labor: 0, amount: 0 };
  const [a, b, c, d] = nums;
  if (nums.length === 1) {
    item.amount = a;
  } else if (nums.length === 2) {
    if (a <= 100) { item.qty = a; item.amount = b; } else { item.unitPrice = a; item.amount = b; }
  } else if (nums.length === 3) {
    if (near(a * b, c)) { item.qty = a; item.unitPrice = b; item.amount = c; }
    else if (near(a + b, c)) { item.parts = a; item.labor = b; item.amount = c; }
    else { item.qty = a <= 100 ? a : 1; item.unitPrice = b; item.amount = c; }
  } else {
    // 수량 단가 부품 공임 (합계) — 넷이면 부품+공임, 다섯이면 끝이 합계
    const last = nums[nums.length - 1];
    if (near(a * b, c)) {
      item.qty = a; item.unitPrice = b; item.parts = c; item.labor = d || 0;
      item.amount = nums.length >= 5 && near(c + d, last) ? last : c + (d || 0);
    } else {
      item.amount = last;
    }
  }
  if (item.amount < 100 && !item.parts && !item.labor) return null; // 금액이 아닌 숫자(부품번호 끝자리 등)
  if (!item.parts && !item.labor) {
    // 줄 이름으로 부품·공임을 가른다. 모르면 부품으로 둔다(정비 명세서는 대개 부품 줄이 많다)
    if (/공임|탈부착|교환작업|작업비|기술료|점검료|진단|판금|도장|도색|광택|얼라인먼트|휠\s*밸런스/.test(name)) item.labor = item.amount;
    else item.parts = item.amount;
  }
  return item;
};

/**
 * 내역서 글자를 정비 기록 양식 값으로 정리한다.
 *
 * @param {string} text 내역서 전체 글자 (줄바꿈 유지)
 * @returns {{plateNo: string, shop: string, bizNo: string, inDate: string, outDate: string, issuedDate: string,
 *   mileage: number, insurer: string, claimNo: string, kindGuess: string,
 *   lines: object[], partsTotal: number, laborTotal: number, supply: number, vat: number, discount: number, total: number,
 *   warnings: string[]}}
 */
export const parseRepairInvoice = (text) => {
  const raw = String(text || '');
  const flat = raw.replace(/\s+/g, ' ');
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\t+/g, '  ').trim()).filter(Boolean);
  const warnings = [];

  const plateNo = findPlateNumbers(raw)[0] || '';
  const bizNo = (flat.match(/(?<!\d)(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{5})(?!\d)/) || []).slice(1).join('-');
  const shop = labeledText(lines, ['상호명', '상호', '업체명', '정비업체', '정비소', '공급자상호', '공급자', '업소명']);
  const inDate = findLabeledDate(flat, ['입고일자', '입고일시', '입고일', '입고'])?.date || '';
  const outDate = findLabeledDate(flat, ['출고일자', '출고일시', '출고일', '출고', '완료일자', '완료일', '정비일자', '작업일자', '정비일'])?.date || '';
  const issuedDate = findLabeledDate(flat, ['발행일자', '발행일', '작성일자', '작성일', '견적일자', '견적일', '거래일자'])?.date || '';
  const mileageMatch = new RegExp(`(?:${spaced('주행거리')}|${spaced('적산거리')}|${spaced('주행')})\\s*[:：]?\\s*${NUM}\\s*(?:km|KM|㎞)?`).exec(flat);
  const mileage = mileageMatch ? toNum(mileageMatch[1]) : 0;
  const insurer = INSURERS.find((name) => flat.replace(/\s/g, '').includes(name)) || '';
  const claimNo = (new RegExp(`(?:${spaced('사고접수번호')}|${spaced('접수번호')}|${spaced('보상접수')})\\s*[:：]?\\s*([0-9A-Za-z][0-9A-Za-z\\-]{4,24})`).exec(flat) || [])[1] || '';

  const items = lines.map(lineItemOf).filter(Boolean);

  let partsTotal = labeledAmount(flat, TOTAL_LABELS.parts);
  let laborTotal = labeledAmount(flat, TOTAL_LABELS.labor);
  let supply = labeledAmount(flat, TOTAL_LABELS.supply);
  let vat = labeledAmount(flat, TOTAL_LABELS.vat);
  const discount = labeledAmount(flat, TOTAL_LABELS.discount);
  let total = labeledAmount(flat, TOTAL_LABELS.total);

  // 빈 합계는 아는 값으로 채운다. 내역서마다 적힌 칸이 달라서다.
  const sumParts = items.reduce((s, i) => s + i.parts, 0);
  const sumLabor = items.reduce((s, i) => s + i.labor, 0);
  if (!partsTotal && sumParts) partsTotal = sumParts;
  if (!laborTotal && sumLabor) laborTotal = sumLabor;
  if (!supply && (partsTotal || laborTotal)) supply = partsTotal + laborTotal - discount;
  if (!supply && total && vat) supply = total - vat;
  if (!vat && total && supply && total > supply) vat = total - supply;
  if (!total && supply) total = supply + vat;
  // '합계'가 부가세 빠진 값으로 적힌 서식: 합계 = 공급가액이면 부가세를 더한다
  if (total && supply && vat && total === supply) total = supply + vat;

  const itemSum = items.reduce((s, i) => s + i.amount, 0);
  if (items.length && supply && Math.abs(itemSum - (supply + discount)) > Math.max(100, supply * 0.01)) {
    warnings.push(`작업 내역 합(${itemSum.toLocaleString()}원)과 공급가액(${supply.toLocaleString()}원)이 다릅니다. 줄을 확인해 주세요.`);
  }
  if (!items.length) warnings.push('작업 내역 줄을 찾지 못했습니다. 글자를 고쳐 다시 정리하거나 직접 적어 주세요.');
  if (!total) warnings.push('합계 금액을 찾지 못했습니다.');
  if (vat && supply && Math.abs(vat - supply * 0.1) > Math.max(100, supply * 0.02)) {
    warnings.push(`부가세(${vat.toLocaleString()}원)가 공급가액의 10%와 다릅니다.`);
  }

  const kindGuess = insurer || /사고|보험\s*수리|판금|도장|도색/.test(flat) ? '사고수리'
    : /정기\s*점검/.test(flat) ? '정기점검'
      : items.length ? '고장수리' : '';

  return {
    plateNo, shop, bizNo, inDate, outDate, issuedDate, mileage, insurer, claimNo, kindGuess,
    lines: items, partsTotal, laborTotal, supply, vat, discount, total, warnings
  };
};
