import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * 계약서 PDF 만들기: 엑셀이 만든 빈 계약서 PDF 위에 계약 값을 찍는다.
 *
 * 디자인(표·선·글꼴·직인)은 엑셀 PDF 그대로이고, 여기서는 값 글자만 얹는다.
 * 값 자리는 '값 자리 지도'(ContractTemplatePdf.map)에 있다. 지도는 값 칸마다 표시(C001…)를 넣어 뽑은 PDF에서 읽었다.
 *
 * 맞춤: 셀이 왼쪽 맞춤이면 표시가 시작한 곳에서, 오른쪽 맞춤이면 표시가 끝난 곳에, 가운데면 표시 가운데에 맞춘다.
 * 값이 쓸 수 있는 폭(같은 줄 다음 글까지)보다 길면 글자를 줄인다(최소 5pt). 그래도 길면 뒤를 자른다.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(here, '..', 'assets', 'fonts');
// 글꼴은 전체를 넣는다(PDF 약 3MB). pdf-lib의 '쓴 글자만 넣기'(subset)는 이 한글 글꼴에서 글자가 빠졌다(2026-10-23 확인)
const SUBSET = false;
let fontBytes = null;
const loadFonts = () => {
  if (!fontBytes) {
    fontBytes = {
      regular: fs.readFileSync(path.join(FONT_DIR, 'Pretendard-Regular.ttf')),
      bold: fs.readFileSync(path.join(FONT_DIR, 'Pretendard-Bold.ttf'))
    };
  }
  return fontBytes;
};

const toNumber = (s) => Number(String(s ?? '').replace(/[^\d.-]/g, ''));
const won = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '');
const ymdDots = (d) => {
  const t = new Date(d || Date.now());
  const k = new Date(t.getTime() + 9 * 3600e3);
  return `${k.getUTCFullYear()}. ${k.getUTCMonth() + 1}. ${k.getUTCDate()}.`;
};

/** 양식 수식 칸의 값(화면 contractSheetUtils.resolveBinding과 같은 규칙) */
const makeResolver = (template, values, documentDate) => {
  const fieldByCell = Object.fromEntries((template.fields || []).map((f) => [f.cell, f]));
  const sheetCells = {};
  for (const s of template.sheets || []) sheetCells[s.name] = Object.fromEntries(s.cells.map((c) => [c.a, c]));
  const resolve = (bind, depth = 0) => {
    if (!bind || depth > 6) return '';
    const refValue = (ref) => {
      if (ref.sheet === '법인정보') {
        const field = fieldByCell[ref.cell];
        return field ? String(values[field.key] ?? '') : '';
      }
      const cell = sheetCells[ref.sheet]?.[ref.cell];
      if (!cell) return '';
      return cell.bind ? resolve(cell.bind, depth + 1) : cell.t ?? '';
    };
    switch (bind.op) {
      case 'ref': return refValue(bind);
      case 'concat': {
        const parts = bind.parts.map((p) => (p.lit !== undefined ? p.lit : refValue(p)));
        // 값이 비면 붙는 글('대')만 남지 않게 한다
        return bind.parts.some((p) => p.lit === undefined && refValue(p)) ? parts.join('') : '';
      }
      case 'mul': {
        const a = toNumber(refValue(bind.a));
        const b = toNumber(refValue(bind.b));
        return a && b ? won(a * b) : '';
      }
      case 'ifeq': return String(refValue(bind.test)).trim() === bind.eq ? bind.yes : bind.no;
      case 'today': return ymdDots(documentDate);
      default: return '';
    }
  };
  return { resolve, sheetCells };
};

const NO_FEATURES = { calt: false, liga: false, clig: false, dlig: false, kern: false, ccmp: false, locl: false, case: false, tnum: false, frac: false, sups: false, ordn: false };

/**
 * 엑셀 표시 형식 중 계약서에 쓰인 것만 흉내 낸다.
 *  - #0"대" → 숫자 뒤에 '대'   - 0% → 숫자면 %를 붙임   - 회계 형식의 0 → '-'
 * 값은 대부분 이미 '942,000'처럼 모양을 갖춘 글이라, 숫자일 때만 손댄다.
 */
const formatLikeExcel = (text, z) => {
  if (!text || !z) return text;
  const first = z.split(';')[0];
  const plainNumber = /^-?[\d,]+(\.\d+)?$/.test(text);
  if (/^\*?_?-?\*?\s*#?,?#*0/.test(first) || /^#0/.test(first)) {
    const suffix = (/"([^"]+)"\s*$/.exec(first) || [])[1];
    if (plainNumber && suffix && !text.endsWith(suffix)) return `${text}${suffix}`;
  }
  if (/0%$/.test(first) && plainNumber) return `${text}%`;
  if (/_-\*/.test(first) && /^0+$/.test(text.replace(/,/g, ''))) return '-';
  return text;
};

const hexColor = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/**
 * @param {object} args
 * @param {object} args.template ContractTemplate (sheets, styles, fields)
 * @param {object} args.base ContractTemplatePdf (blank, map)
 * @param {object} args.values 계약서 입력 칸 값 (ContractDocument.values)
 * @param {Date} [args.documentDate]
 * @returns {Promise<Uint8Array>}
 */
export const buildContractPdf = async ({ template, base, values, documentDate }) => {
  const pdf = await PDFDocument.load(Buffer.from(base.blank.buffer || base.blank));
  pdf.registerFontkit(fontkit);
  const fonts = loadFonts();
  // 글꼴 자동 대체(calt 등)를 끈다. Pretendard는 숫자 사이 하이픈을 다른 글리프로 바꾸는데,
  // pdf-lib가 그 글리프의 글자 정보를 '㏄'로 적어 "211-86"이 "211㏄86"·넓은 간격으로 찍혔다(2026-10-23).
  const regular = await pdf.embedFont(fonts.regular, { subset: SUBSET, features: NO_FEATURES });
  const bold = await pdf.embedFont(fonts.bold, { subset: SUBSET, features: NO_FEATURES });
  const pages = pdf.getPages();
  const { resolve, sheetCells } = makeResolver(template, values || {}, documentDate);
  const styles = template.styles || [];

  for (const f of base.map.fields || []) {
    const cell = sheetCells[f.sheet]?.[f.a];
    const page = pages[f.page - 1];
    if (!cell?.bind || !page) continue;
    const text = formatLikeExcel(String(resolve(cell.bind) ?? '').replace(/\s+/g, ' ').trim(), cell.z);
    if (!text) continue;
    const st = styles[cell.s] || {};
    const font = st.b ? bold : regular;
    // 맞춤이 정해지지 않은 칸의 숫자는 엑셀처럼 오른쪽에 붙인다(회계 형식도 오른쪽)
    const numeric = /^[-\d,.%\s]+$/.test(text) || /\*/.test(cell.z || '');
    const align = st.h === 'right' || (!st.h && numeric) ? 'right'
      : st.h === 'center' || st.h === 'centerContinuous' ? 'center' : 'left';
    // 오른쪽 맞춤의 오른쪽 끝: 셀에 원래 맞춤이 있으면 표시가 끝난 곳, 숫자 기본 맞춤이면 같은 줄 다음 글 앞
    const rightEdge = st.h === 'right' ? f.x + f.tokenW : f.x + f.roomRight;
    // 쓸 수 있는 폭: 왼쪽 맞춤은 오른쪽으로, 오른쪽 맞춤은 왼쪽으로, 가운데는 양쪽 중 좁은 쪽의 두 배
    const room = align === 'left' ? f.roomRight
      : align === 'right' ? rightEdge - (f.x + f.tokenW - f.roomLeft)
        : Math.min(f.roomRight - f.tokenW / 2, f.roomLeft - f.tokenW / 2) * 2 + f.tokenW;
    let size = f.size;
    let shown = text;
    while (font.widthOfTextAtSize(shown, size) > room && size > 5) size -= 0.25;
    while (font.widthOfTextAtSize(shown, size) > room && shown.length > 1) shown = shown.slice(0, -1);
    const w = font.widthOfTextAtSize(shown, size);
    const x = align === 'left' ? f.x : align === 'right' ? rightEdge - w : f.x + f.tokenW / 2 - w / 2;
    page.drawText(shown, { x, y: f.y, size, font, color: hexColor(st.color) });
  }

  // 체크 칸: 네모 칸은 글 바로 왼쪽에 있다
  const checks = base.map.checks || {};
  const mark = (pos, pageNo) => {
    const page = pages[pageNo - 1];
    if (!pos || !page) return;
    const size = Math.max(pos.size * 1.35, 8);
    page.drawText('V', { x: pos.x - size * 0.95, y: pos.y - 0.3, size, font: bold, color: rgb(0.88, 0, 0) });
  };
  const payDay = String(values?.payDay || '').replace(/일$/, '');
  if (payDay) mark(checks.payDay?.[payDay === '말' || payDay === '31' ? '말일' : payDay], 2);
  if (values?.driverScope) mark(checks.driverScope?.[values.driverScope], 2);
  if (values?.blackbox) mark(checks.blackbox?.[values.blackbox], 3);

  pdf.setTitle(`자동차 임대차 계약서 ${values?.contractNo || ''}`.trim());
  pdf.setProducer('렌트베네핏 사내 프로그램');
  return pdf.save();
};
