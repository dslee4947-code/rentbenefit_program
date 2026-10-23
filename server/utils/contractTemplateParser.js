import crypto from 'crypto';
import XLSX from 'xlsx';

/**
 * 전자계약서 엑셀 양식(.xlsx)을 프로그램이 쓸 수 있는 모양으로 읽는다.
 *
 * 양식 구조 (2025-11 "전자계약서 양식_251125_약관 수정 중.xlsx" 기준)
 *  - '법인정보' 시트: 입력 칸. A열 항목 이름, B열 값(원래는 렌트_차량관리 엑셀을 VLOOKUP).
 *  - '계약서_1' ~ '계약서_12', '계약서 작성 위임장', '보증금 안내문': 인쇄되는 장.
 *    각 장의 빈칸은 수식으로 법인정보!Bn을 가져온다(=법인정보!B4, =계약서_2!L6 처럼 한 번 더 거치기도 함).
 *  - 약관(계약서_6 ~ 계약서_12)은 두 단(왼쪽 C열, 오른쪽 P·Q열)으로 나뉘고,
 *    조항 제목(제11조 …)·계산식·동의 체크 상자 일부는 셀이 아니라 글상자(도형)에 들어 있다.
 *    약관을 나중에 분석해야 하므로 셀 글자와 글상자 글자를 모두, 원문 그대로(줄바꿈 포함) 남긴다.
 *
 * 결과는 DB에 그대로 저장한다. 화면은 이 결과만으로 장을 다시 그린다(엑셀 파일 없이).
 */

const INPUT_SHEET = '법인정보';
const EMU_PER_PX = 9525;
const DEFAULT_COL_PX = 64;
const DEFAULT_ROW_PX = 20;

// 입력 칸 이름 → 프로그램에서 쓰는 열쇠. 항목 이름이 같은 줄이 두 번 나오면(자손) 두 번째에 _2를 붙인다.
const FIELD_KEYS = {
  일련번호: 'vehicleCode',
  계약번호: 'contractNo',
  '개인/법인명': 'partyName',
  대표자명: 'ceoName',
  '주민/사업자등록번호': 'bizNo',
  '법인/식별번호': 'corpRegNo',
  주소: 'address',
  연락처: 'phone',
  은행명: 'bankName',
  계좌번호: 'bankAccount',
  예금주명: 'bankHolder',
  메일주소: 'email',
  계약담당자: 'managerName',
  '계약담당자 번호': 'managerPhone',
  '결제 담당자': 'payerName',
  '실 운전자': 'driverName',
  '국산/외산': 'origin',
  차종: 'carModel',
  수량: 'quantity',
  '계약기간(개월)': 'termMonths',
  차량가격: 'carPrice',
  보증금: 'deposit',
  선납금: 'advancePayment',
  인수가: 'takeoverPrice',
  월대여료: 'monthlyFee',
  정비: 'maintenance',
  '외장 색상': 'exteriorColor',
  '내장 색상': 'interiorColor',
  약정주행거리: 'annualMileage',
  옵션: 'options',
  대물: 'propertyLimit',
  자손: 'personalInjury',
  자기부담금: 'deductible',
  위약금율: 'penaltyRate',
  연체이율: 'overdueRate',
  무보험차상해: 'uninsuredInjury',
  긴급출동: 'emergencyService',
  '타이어 본수': 'tire'
};

const xmlDecode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? xmlDecode(m[1]) : undefined;
};

/** zip 안의 파일 하나를 글자로. 없으면 '' */
const zipText = (cfb, path) => {
  const name = path.replace(/^\//, '');
  const idx = cfb.FullPaths.findIndex((p) => p.replace(/^[^/]*\//, '') === name || p.endsWith(`/${name}`));
  if (idx < 0) return '';
  return Buffer.from(cfb.FileIndex[idx].content).toString('utf8');
};
const zipBuffer = (cfb, path) => {
  const name = path.replace(/^\//, '');
  const idx = cfb.FullPaths.findIndex((p) => p.replace(/^[^/]*\//, '') === name || p.endsWith(`/${name}`));
  return idx < 0 ? null : Buffer.from(cfb.FileIndex[idx].content);
};

/** 상대 경로(../drawings/drawing1.xml)를 xl/ 기준 경로로 */
const resolvePath = (base, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
};

const relsOf = (cfb, path) => {
  const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
  const xml = zipText(cfb, relPath);
  const map = {};
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    map[attr(m[0], 'Id')] = { target: resolvePath(path, attr(m[0], 'Target') || ''), type: attr(m[0], 'Type') || '' };
  }
  return map;
};

// ───────────────────────── 스타일 ─────────────────────────

/** 테마 색(0~11)을 RGB로. tint는 밝게/어둡게 근사한다. */
const parseTheme = (xml) => {
  const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const colors = {};
  for (const name of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
    const m = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(xml);
    const c = m && (/lastClr="([0-9A-Fa-f]{6})"/.exec(m[1]) || /val="([0-9A-Fa-f]{6})"/.exec(m[1]));
    colors[name] = c ? c[1] : name.startsWith('dk') ? '000000' : 'FFFFFF';
  }
  return order.map((n) => colors[n]);
};

const applyTint = (hex, tint) => {
  if (!tint) return hex;
  const t = Number(tint);
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).map((v) => (t < 0 ? v * (1 + t) : v + (255 - v) * t));
  return ch.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
};

const colorOf = (tag, theme) => {
  if (!tag) return null;
  const rgb = attr(tag, 'rgb');
  if (rgb) return `#${rgb.slice(-6)}`;
  const th = attr(tag, 'theme');
  if (th !== undefined && theme[Number(th)]) return `#${applyTint(theme[Number(th)], attr(tag, 'tint'))}`;
  return null;
};

const parseStyles = (xml, theme) => {
  const section = (name) => (new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml) || [])[1] || '';
  const fonts = [...section('fonts').matchAll(/<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g)].map((m) => {
    const body = m[1] || '';
    const sz = /<sz val="([\d.]+)"/.exec(body);
    const color = /<color\b[^>]*\/>/.exec(body);
    const name = /<name val="([^"]*)"/.exec(body);
    return {
      b: /<b\/>|<b val="(1|true)"\/>/.test(body),
      i: /<i\/>|<i val="(1|true)"\/>/.test(body),
      u: /<u\b/.test(body),
      sz: sz ? Number(sz[1]) : 11,
      color: color ? colorOf(color[0], theme) : null,
      name: name ? xmlDecode(name[1]) : ''
    };
  });
  const fills = [...section('fills').matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((m) => {
    if (!/patternType="solid"/.test(m[1])) return null;
    const fg = /<fgColor\b[^>]*\/>/.exec(m[1]);
    return fg ? colorOf(fg[0], theme) : null;
  });
  const borders = [...section('borders').matchAll(/<border\b[^>]*?(?:\/>|>([\s\S]*?)<\/border>)/g)].map((m) => {
    const body = m[1] || '';
    const side = (s) => {
      const t = new RegExp(`<${s}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${s}>)`).exec(body);
      if (!t) return null;
      const style = attr(`<x ${t[1]}>`, 'style');
      if (!style) return null;
      const c = t[2] ? /<color\b[^>]*\/>/.exec(t[2]) : null;
      return { style, color: c ? colorOf(c[0], theme) : '#000000' };
    };
    return { l: side('left'), r: side('right'), t: side('top'), b: side('bottom') };
  });
  const xfs = [...section('cellXfs').matchAll(/<xf\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g)].map((m) => {
    const head = `<xf ${m[1]}>`;
    const al = m[2] ? /<alignment\b[^>]*\/>/.exec(m[2]) : null;
    return {
      font: Number(attr(head, 'fontId') || 0),
      fill: Number(attr(head, 'fillId') || 0),
      border: Number(attr(head, 'borderId') || 0),
      h: al ? attr(al[0], 'horizontal') : undefined,
      v: al ? attr(al[0], 'vertical') : undefined,
      wrap: al ? attr(al[0], 'wrapText') === '1' : false,
      indent: al ? Number(attr(al[0], 'indent') || 0) : 0
    };
  });
  return { fonts, fills, borders, xfs };
};

/** 셀 스타일 번호 → 화면에 쓸 작은 묶음. 같은 스타일은 한 번만 저장한다. */
const compactStyle = (styles, idx) => {
  const xf = styles.xfs[idx] || styles.xfs[0] || {};
  const font = styles.fonts[xf.font] || {};
  const border = styles.borders[xf.border] || {};
  const st = {};
  if (font.b) st.b = 1;
  if (font.i) st.i = 1;
  if (font.u) st.u = 1;
  if (font.sz && font.sz !== 11) st.sz = font.sz;
  if (font.color && font.color !== '#000000') st.color = font.color;
  if (font.name) st.font = font.name;
  const fill = styles.fills[xf.fill];
  if (fill && fill !== '#FFFFFF') st.fill = fill;
  if (xf.h) st.h = xf.h;
  if (xf.v) st.v = xf.v;
  if (xf.wrap) st.wrap = 1;
  if (xf.indent) st.indent = xf.indent;
  for (const k of ['l', 'r', 't', 'b']) if (border[k]) st[`b${k}`] = `${border[k].style}|${border[k].color || '#000000'}`;
  return st;
};

// ───────────────────────── 글상자(도형) ─────────────────────────

/** 아주 작은 XML 나무 만들기. 도형 묶음(grpSp)처럼 같은 태그가 겹겹이 들어간 구조를 정규식으로는 못 풀어서 쓴다. */
const xmlTree = (xml) => {
  const root = { name: '#root', attrs: '', children: [] };
  const stack = [root];
  const re = /<(\/?)([\w:]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { if (m[5].trim() || top.name === 'a:t') top.children.push({ text: m[5] }); continue; }
    if (m[2].startsWith('?') || m[2].startsWith('!')) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const node = { name: m[2], attrs: m[3] || '', children: [] };
    top.children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
};
const kids = (node, name) => (node?.children || []).filter((c) => c.name === name);
const kid = (node, name) => (node?.children || []).find((c) => c.name === name);
const deep = (node, name) => {
  if (!node?.children) return null;
  for (const c of node.children) {
    if (c.name === name) return c;
    const d = deep(c, name);
    if (d) return d;
  }
  return null;
};
const nodeAttr = (node, name) => (node ? attr(`<x ${node.attrs}>`, name) : undefined);
const textOf = (node) => (node?.children || []).map((c) => (c.text !== undefined ? xmlDecode(c.text) : '')).join('');

const anchorPoint = (anchor, tag) => {
  const n = kid(anchor, `xdr:${tag}`);
  if (!n) return null;
  const num = (name) => Number(textOf(kid(n, `xdr:${name}`)) || 0);
  return { c: num('col'), dx: Math.round(num('colOff') / EMU_PER_PX), r: num('row'), dy: Math.round(num('rowOff') / EMU_PER_PX) };
};

/** 도형 하나의 글을 문단별로. 문단 안의 글조각은 그대로 잇는다(띄어쓰기 원문 유지). */
const shapeParagraphs = (sp) => {
  const body = kid(sp, 'xdr:txBody');
  if (!body) return [];
  return kids(body, 'a:p').map((p) => {
    let text = '';
    let sz;
    let b = false;
    for (const c of p.children) {
      if (c.name === 'a:r' || c.name === 'a:fld') {
        text += textOf(kid(c, 'a:t'));
        const rPr = kid(c, 'a:rPr');
        if (rPr && !sz && nodeAttr(rPr, 'sz')) sz = Number(nodeAttr(rPr, 'sz')) / 100;
        if (rPr && nodeAttr(rPr, 'b') === '1') b = true;
      } else if (c.name === 'a:br') text += '\n';
    }
    const algn = nodeAttr(kid(p, 'a:pPr'), 'algn');
    return { text, ...(algn ? { algn } : {}), ...(sz ? { sz } : {}), ...(b ? { b: 1 } : {}) };
  });
};

// 도형 색: srgbClr(직접 지정) 또는 schemeClr(테마 색)에 lumMod·lumOff(밝기 조절)·alpha(투명도)가 붙는다
const SCHEME_INDEX = { bg1: 0, lt1: 0, tx1: 1, dk1: 1, bg2: 2, lt2: 2, tx2: 3, dk2: 3, accent1: 4, accent2: 5, accent3: 6, accent4: 7, accent5: 8, accent6: 9, hlink: 10, folHlink: 11 };
const drawingColor = (fillNode, theme) => {
  if (!fillNode) return { color: null, alpha: 1 };
  const clr = kid(fillNode, 'a:srgbClr') || kid(fillNode, 'a:schemeClr');
  if (!clr) return { color: null, alpha: 1 };
  let hex = clr.name === 'a:srgbClr' ? nodeAttr(clr, 'val') : theme[SCHEME_INDEX[nodeAttr(clr, 'val')] ?? 1];
  if (!hex) return { color: null, alpha: 1 };
  const mod = Number(nodeAttr(kid(clr, 'a:lumMod'), 'val') || 100000) / 100000;
  const off = Number(nodeAttr(kid(clr, 'a:lumOff'), 'val') || 0) / 100000;
  if (mod !== 1 || off) {
    hex = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
      .map((v) => Math.round(Math.max(0, Math.min(255, v * mod + 255 * off))).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  const alpha = Number(nodeAttr(kid(clr, 'a:alpha'), 'val') || 100000) / 100000;
  return { color: `#${hex}`, alpha };
};

const xfrmOf = (node) => {
  const x = deep(node, 'a:xfrm');
  if (!x) return null;
  const pt = (name) => { const n = kid(x, name); return n ? { x: Number(nodeAttr(n, 'x') ?? nodeAttr(n, 'cx') ?? 0), y: Number(nodeAttr(n, 'y') ?? nodeAttr(n, 'cy') ?? 0) } : null; };
  return { off: pt('a:off'), ext: pt('a:ext'), chOff: pt('a:chOff'), chExt: pt('a:chExt') };
};

/**
 * 앵커(엑셀 칸 위치) 안의 도형들을 앵커 대비 비율(0~1) 위치로 편다.
 * 묶음(grpSp) 안 도형은 묶음의 자식 좌표계(chOff/chExt)를 앵커에 맞춰 옮긴다. 묶음 안 묶음도 같은 식으로 계산한다.
 */
const flattenShapes = (node, frame, rels, theme, out) => {
  for (const c of node.children || []) {
    if (c.name === 'xdr:grpSp') {
      const x = xfrmOf(kid(c, 'xdr:grpSpPr'));
      if (!x?.off || !x?.ext) { flattenShapes(c, frame, rels, theme, out); continue; }
      const rect = frame(x.off.x, x.off.y, x.ext.x, x.ext.y);
      const chOff = x.chOff || x.off;
      const chExt = x.chExt || x.ext;
      const inner = (ox, oy, cx, cy) => ({
        fx: rect.fx + ((ox - chOff.x) / (chExt.x || 1)) * rect.fw,
        fy: rect.fy + ((oy - chOff.y) / (chExt.y || 1)) * rect.fh,
        fw: (cx / (chExt.x || 1)) * rect.fw,
        fh: (cy / (chExt.y || 1)) * rect.fh
      });
      flattenShapes(c, inner, rels, theme, out);
      continue;
    }
    if (!['xdr:sp', 'xdr:pic', 'xdr:cxnSp'].includes(c.name)) continue;
    const spPr = kid(c, 'xdr:spPr');
    const x = xfrmOf(spPr);
    const rect = x?.off && x?.ext ? frame(x.off.x, x.off.y, x.ext.x, x.ext.y) : { fx: 0, fy: 0, fw: 1, fh: 1 };
    const item = { fx: +rect.fx.toFixed(4), fy: +rect.fy.toFixed(4), fw: +rect.fw.toFixed(4), fh: +rect.fh.toFixed(4) };
    if (c.name === 'xdr:pic') {
      const blip = deep(c, 'a:blip');
      const embed = nodeAttr(blip, 'r:embed');
      if (embed && rels[embed]) out.push({ ...item, image: rels[embed].target });
      continue;
    }
    const ln = kid(spPr, 'a:ln');
    const lineVisible = ln ? !kid(ln, 'a:noFill') : false;
    const lnColor = ln ? colorOf(`<x ${deep(ln, 'a:srgbClr')?.attrs || ''}>`, theme) : null;
    if (c.name === 'xdr:cxnSp') {
      if (lineVisible || !ln) out.push({ ...item, line: 1, ...(lnColor ? { color: lnColor } : {}) });
      continue;
    }
    const paragraphs = shapeParagraphs(c);
    const { color: fillColor, alpha } = drawingColor(kid(spPr, 'a:solidFill'), theme);
    const geom = nodeAttr(kid(spPr, 'a:prstGeom'), 'prst');
    const hasText = paragraphs.some((p) => p.text.trim());
    if (!hasText && !lineVisible && !fillColor) continue;
    const bodyPr = deep(c, 'a:bodyPr');
    out.push({
      ...item,
      ...(hasText ? { paragraphs } : {}),
      ...(lineVisible ? { box: 1, ...(lnColor ? { color: lnColor } : {}) } : {}),
      ...(fillColor ? { fill: fillColor } : {}),
      ...(fillColor && alpha < 1 ? { alpha } : {}),
      ...(geom && geom !== 'rect' ? { geom } : {}),
      ...(nodeAttr(bodyPr, 'anchor') ? { anchor: nodeAttr(bodyPr, 'anchor') } : {})
    });
  }
};

const parseDrawing = (cfb, path, theme) => {
  const xml = zipText(cfb, path);
  if (!xml) return [];
  const rels = relsOf(cfb, path);
  const tree = xmlTree(xml);
  const wsDr = kid(tree, 'xdr:wsDr') || tree;
  const shapes = [];
  for (const anchor of wsDr.children.filter((c) => c.name === 'xdr:twoCellAnchor' || c.name === 'xdr:oneCellAnchor')) {
    const from = anchorPoint(anchor, 'from');
    const to = anchorPoint(anchor, 'to');
    const extNode = kid(anchor, 'xdr:ext');
    // 앵커 바로 아래 도형(또는 맨 바깥 묶음)이 앵커 칸 범위를 가득 채운다
    const top = anchor.children.find((c) => ['xdr:sp', 'xdr:pic', 'xdr:cxnSp', 'xdr:grpSp'].includes(c.name));
    if (!top) continue;
    const tx = xfrmOf(top.name === 'xdr:grpSp' ? kid(top, 'xdr:grpSpPr') : kid(top, 'xdr:spPr'));
    const base = tx?.off && tx?.ext ? tx : null;
    const frame = (ox, oy, cx, cy) => (base
      ? { fx: (ox - base.off.x) / (base.ext.x || 1), fy: (oy - base.off.y) / (base.ext.y || 1), fw: cx / (base.ext.x || 1), fh: cy / (base.ext.y || 1) }
      : { fx: 0, fy: 0, fw: 1, fh: 1 });
    const items = [];
    flattenShapes({ children: [top] }, frame, rels, theme, items);
    if (!items.length) continue;
    // 원문 글은 문서 순서 그대로 모은다(약관 원문·글자 대조에 쓴다)
    const paragraphs = items.flatMap((it) => it.paragraphs || []);
    const image = items.find((it) => it.image)?.image;
    shapes.push({
      from,
      to: to || null,
      ...(extNode && !to ? { size: { w: Math.round(Number(nodeAttr(extNode, 'cx')) / EMU_PER_PX), h: Math.round(Number(nodeAttr(extNode, 'cy')) / EMU_PER_PX) } } : {}),
      paragraphs,
      ...(image ? { image } : {}),
      items
    });
  }
  return shapes;
};

// ───────────────────────── 수식 → 입력 칸 연결 ─────────────────────────

/**
 * 장의 빈칸 수식이 입력 칸(법인정보!Bn) 어디를 쓰는지 풀어 둔다.
 * 지원: 단순 참조(=법인정보!B4, =계약서_2!L6), 글자 잇기(& "대"), 곱하기(L24*L16),
 *       IF(U17="만기시 반납","만기시 반납","만기시 선택"), TODAY().
 * 못 푸는 수식은 엑셀이 마지막으로 계산해 둔 값을 그대로 보여 준다(binding 없음).
 */
const parseBinding = (formula, sheetName) => {
  const f = formula.replace(/^=/, '').trim();
  const ref = (s) => {
    const m = /^(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+)$/.exec(s.trim());
    return m ? { sheet: m[1] || sheetName, cell: `${m[2]}${m[3]}` } : null;
  };
  if (/^TODAY\(\)$/i.test(f)) return { op: 'today' };
  const r = ref(f);
  if (r) return { op: 'ref', ...r };
  const cat = f.split('&').map((s) => s.trim());
  if (cat.length > 1) {
    const parts = cat.map((s) => (/^"(.*)"$/.test(s) ? { lit: s.slice(1, -1) } : ref(s)));
    if (parts.every(Boolean)) return { op: 'concat', parts };
  }
  const mul = /^([^*]+)\*([^*]+)$/.exec(f);
  if (mul && ref(mul[1]) && ref(mul[2])) return { op: 'mul', a: ref(mul[1]), b: ref(mul[2]) };
  const iff = /^IF\(([^=]+)="([^"]*)",\s*"([^"]*)",\s*"([^"]*)"\)$/i.exec(f);
  if (iff && ref(iff[1])) return { op: 'ifeq', test: ref(iff[1]), eq: iff[2], yes: iff[3], no: iff[4] };
  return null;
};

// ───────────────────────── 본체 ─────────────────────────

/**
 * @param {Buffer} buffer 엑셀 파일
 * @param {string} fileName 원래 파일 이름
 * @returns {{sha256, sheets, fields, styles, pages, clauses, media, stats}}
 */
export const parseContractTemplate = (buffer, fileName = '') => {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellStyles: true, cellText: true });
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const theme = parseTheme(zipText(cfb, 'xl/theme/theme1.xml'));
  const styles = parseStyles(zipText(cfb, 'xl/styles.xml'), theme);

  // 시트 이름 → 시트 xml 경로
  const wbRels = relsOf(cfb, 'xl/workbook.xml');
  const sheetPath = {};
  for (const m of zipText(cfb, 'xl/workbook.xml').matchAll(/<sheet\b[^>]*\/>/g)) {
    const rid = attr(m[0], 'r:id');
    sheetPath[attr(m[0], 'name')] = wbRels[rid]?.target;
  }

  const styleTable = [];
  const styleIndex = new Map();
  const styleRef = (s) => {
    const st = compactStyle(styles, s);
    const key = JSON.stringify(st);
    if (!styleIndex.has(key)) { styleIndex.set(key, styleTable.length); styleTable.push(st); }
    return styleIndex.get(key);
  };

  const media = new Set();
  const sheets = wb.SheetNames.map((name, order) => {
    const ws = wb.Sheets[name];
    const path = sheetPath[name];
    const xml = path ? zipText(cfb, path) : '';
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');

    // 셀마다 스타일 번호(s). SheetJS 무료판은 테두리를 주지 않아 시트 xml에서 직접 읽는다.
    const sAttr = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>)/g)) {
      const s = attr(`<c ${m[2]}>`, 's');
      if (s) sAttr[m[1]] = Number(s);
    }
    const defaultRow = Number((/<sheetFormatPr\b[^>]*defaultRowHeight="([\d.]+)"/.exec(xml) || [])[1] || 15) * (4 / 3);
    const cols = [];
    for (let c = 0; c <= range.e.c; c += 1) {
      const col = (ws['!cols'] || [])[c];
      cols.push(col?.hidden ? 0 : Math.round(col?.wpx || DEFAULT_COL_PX));
    }
    const rows = [];
    for (let r = 0; r <= range.e.r; r += 1) {
      const row = (ws['!rows'] || [])[r];
      rows.push(row?.hidden ? 0 : Math.round((row?.hpx || defaultRow || DEFAULT_ROW_PX) * 10) / 10);
    }

    const cells = [];
    for (let r = 0; r <= range.e.r; r += 1) {
      for (let c = 0; c <= range.e.c; c += 1) {
        const a = XLSX.utils.encode_cell({ r, c });
        const cell = ws[a];
        const hasStyle = sAttr[a] !== undefined && sAttr[a] !== 0;
        if (!cell && !hasStyle) continue;
        const entry = { a, r, c };
        if (cell && cell.v !== undefined && cell.v !== null && String(cell.v) !== '') {
          // 글자는 원문 그대로(.v). 숫자·날짜는 엑셀이 보여 주던 모양(.w)
          entry.t = cell.t === 's' || cell.t === 'str' ? String(cell.v) : String(cell.w ?? cell.v);
        }
        if (cell?.f) {
          entry.f = cell.f;
          const bind = parseBinding(cell.f, name);
          if (bind) entry.bind = bind;
        }
        if (hasStyle) entry.s = styleRef(sAttr[a]);
        if (entry.t !== undefined || entry.f || entry.s !== undefined) cells.push(entry);
      }
    }

    let shapes = [];
    if (path) {
      const rels = relsOf(cfb, path);
      const drawing = Object.values(rels).find((x) => /\/drawing$/.test(x.type));
      if (drawing) shapes = parseDrawing(cfb, drawing.target, theme);
      shapes.forEach((sh) => (sh.items || []).forEach((it) => it.image && media.add(it.image)));
    }

    const printArea = wb.Workbook?.Names?.find((n) => n.Name === '_xlnm.Print_Area' && n.Sheet === order)?.Ref;
    return {
      name,
      order,
      range: ws['!ref'],
      cols,
      rows,
      merges: (ws['!merges'] || []).map((m) => [m.s.r, m.s.c, m.e.r, m.e.c]),
      cells,
      shapes,
      ...(printArea ? { printArea } : {})
    };
  });

  // 입력 칸
  const input = sheets.find((s) => s.name === INPUT_SHEET);
  const fields = [];
  if (input) {
    const seen = {};
    for (const cell of input.cells.filter((x) => x.c === 0 && x.r >= 1 && x.t)) {
      const label = cell.t.trim();
      const valueCell = input.cells.find((x) => x.r === cell.r && x.c === 1);
      const noteCell = input.cells.find((x) => x.r === cell.r && x.c === 2);
      let key = FIELD_KEYS[label] || `field${cell.r + 1}`;
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) key = `${key}_${seen[key]}`;
      fields.push({
        key,
        label,
        cell: `B${cell.r + 1}`,
        sample: valueCell?.t ?? '',
        ...(valueCell?.f ? { sourceFormula: valueCell.f } : {}),
        ...(noteCell?.t ? { note: noteCell.t } : {})
      });
    }
  }

  // 수식 칸은 본문에 [항목 이름] 자리표시로 남긴다(예: "계약번호 [계약번호]의 계약 법적 대리인으로 진행한다.")
  const byName = Object.fromEntries(sheets.map((s) => [s.name, s]));
  const labelOfRef = (ref, depth = 0) => {
    if (!ref || depth > 5) return '값';
    if (ref.sheet === INPUT_SHEET) return fields.find((x) => x.cell === ref.cell)?.label || ref.cell;
    const target = byName[ref.sheet]?.cells.find((x) => x.a === ref.cell);
    return target?.bind ? bindingLabel(target.bind, depth + 1) : '값';
  };
  const bindingLabel = (bind, depth = 0) => {
    if (bind.op === 'ref') return `[${labelOfRef(bind, depth)}]`;
    if (bind.op === 'concat') return bind.parts.map((p) => (p.lit !== undefined ? p.lit : `[${labelOfRef(p, depth)}]`)).join('');
    if (bind.op === 'mul') return `[${labelOfRef(bind.a, depth)} × ${labelOfRef(bind.b, depth)}]`;
    if (bind.op === 'ifeq') return `[${bind.yes} 또는 ${bind.no}]`;
    if (bind.op === 'today') return '[작성일]';
    return '[값]';
  };

  // 장과 약관 원문. 약관 장은 두 단이라 왼쪽 단(C열부터)을 끝까지 읽고 오른쪽 단(P·Q열부터)을 읽는다.
  // 두 단 여부는 글이 C열 근처와 O~Q열 근처에서만 시작하는지로 판단한다(계약서_2처럼 표인 장은 한 단).
  const pages = sheets.filter((s) => s.name !== INPUT_SHEET).map((s) => {
    const items = [
      ...s.cells.filter((x) => x.t !== undefined || x.bind).map((x) => ({
        r: x.r, c: x.c, text: x.bind ? bindingLabel(x.bind) : x.t, from: x.bind ? 'field' : 'cell', at: x.a
      })),
      ...s.shapes.filter((sh) => sh.paragraphs.length).map((sh, i) => ({
        r: sh.from.r, c: sh.from.c, text: sh.paragraphs.map((p) => p.text).join('\n'), from: 'shape', at: `도형${i + 1}`
      }))
    ];
    const body = items.filter((x) => x.r >= 3); // 머리(회사명·계약번호 줄)는 빼고 본다
    const twoColumn = body.length > 4
      && body.every((x) => x.c <= 3 || (x.c >= 13 && x.c <= 17))
      && body.some((x) => x.c >= 13) && body.some((x) => x.c <= 3);
    const split = twoColumn ? 13 : Infinity;
    items.sort((x, y) => (x.r < 3 ? 0 : 1) - (y.r < 3 ? 0 : 1)
      || (Number(x.c >= split) - Number(y.c >= split)) || (x.r - y.r) || (x.c - y.c));
    return { sheet: s.name, twoColumn, text: items.map((x) => x.text).join('\n'), items };
  });

  // 조항(제n조). 약관 장(계약서_6~)의 글을 이어 붙여 '제n조 제목' 줄에서 나눈다.
  // "제6조 제①항 후문에 따라…", "제10조 제④항에 따른 해지 시 위약금 =" 같은 줄은 다른 조항을 가리키는 문장이라 제목이 아니다.
  // 계약서_12는 별도 약관(업무전용자동차보험 특별약관)이라 조 번호가 1부터 다시 시작한다.
  const clauses = [];
  const termsPages = pages.filter((p) => /^계약서_(\d+)$/.test(p.sheet) && Number(p.sheet.split('_')[1]) >= 6);
  const HEAD = /^\s*제\s*(\d+)\s*조\s*(?:[(（]([^)）]+)[)）]|\s+([^제=\s][^=]*?))\s*$/;
  let current = null;
  let part = '자동차 임대차 계약 약관';
  for (const page of termsPages) {
    if (page.sheet === '계약서_12') { part = '업무전용자동차보험 특별약관'; current = null; }
    for (const item of page.items) {
      if (item.r < 3) continue; // 장마다 반복되는 머리
      for (const line of item.text.split('\n')) {
        const head = HEAD.exec(line);
        if (head && line.trim().length <= 40) {
          current = { part, no: Number(head[1]), title: (head[2] || head[3] || '').trim(), heading: line.trim(), page: page.sheet, text: '' };
          clauses.push(current);
          continue;
        }
        if (current) current.text += (current.text ? '\n' : '') + line;
      }
    }
  }

  const textChars = pages.reduce((n, p) => n + p.text.length, 0);
  return {
    sha256,
    fileName,
    sheets,
    styles: styleTable,
    fields,
    pages: pages.map(({ sheet, twoColumn, text }) => ({ sheet, twoColumn, text })),
    clauses,
    media: [...media],
    stats: {
      sheets: sheets.length,
      fields: fields.length,
      cells: sheets.reduce((n, s) => n + s.cells.length, 0),
      shapesWithText: sheets.reduce((n, s) => n + s.shapes.filter((x) => x.paragraphs.length).length, 0),
      textChars,
      clauses: clauses.length
    }
  };
};

/** 양식 안의 그림 파일(xl/media/…) 하나를 꺼낸다. */
export const extractTemplateMedia = (buffer, path) => {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  return zipBuffer(cfb, path);
};

export const CONTRACT_INPUT_SHEET = INPUT_SHEET;
