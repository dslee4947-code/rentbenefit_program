import { rgb } from 'pdf-lib';

/**
 * 연대보증서 한 장(대표님 2026-11-27). 법인 계약은 계약서 PDF 맨 뒤(13쪽)에 붙고, [연대보증서] 버튼은 이 장만 받는다.
 *
 * 장기렌트 계약서는 모두싸인으로 법인만 서명하고, 대표 개인 보증은 이 한 장을 종이로 받는다.
 *  - 민법 제428조의2: 보증은 보증인이 서명·기명날인한 서면이어야 하고, 전자적 형태면 효력이 없다.
 *  - 민법 제428조의3: 계속 거래(렌트)의 보증은 보증 최고액을 서면으로 정해야 한다 → 최고액을 꼭 찍는다.
 * 모양은 계약서 장(빨간 제목, 빨간 번호의 단락, 회색 이름 칸, 위 오른쪽 회사명·계약번호)을 따른다.
 */

const A4 = [595.2, 841.68];
const RED = rgb(0.88, 0, 0);
const BLACK = rgb(0, 0, 0);
const GRAY_BG = rgb(0.9, 0.9, 0.9);
const LINE = rgb(0.6, 0.6, 0.6);
const MUTED = rgb(0.45, 0.45, 0.45);

const DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL = ['', '십', '백', '천'];
const BIG = ['', '만', '억', '조'];
/** 74,070,000 → '칠천사백칠만' */
export const koreanAmount = (n) => {
  let v = Math.floor(Number(n) || 0);
  if (!v) return '영';
  const groups = [];
  while (v > 0) { groups.push(v % 10000); v = Math.floor(v / 10000); }
  return groups.map((g, gi) => {
    if (!g) return '';
    const s = String(g).padStart(4, '0').split('').map((d, i) => (d === '0' ? '' : `${DIGIT[d]}${SMALL[3 - i]}`)).join('');
    return `${s}${BIG[gi]}`;
  }).reverse().join('');
};

const toNum = (s) => Number(String(s ?? '').replace(/[^0-9]/g, '')) || 0;
const comma = (n) => Math.round(n).toLocaleString('ko-KR');
const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3);
const dots = (d) => { const x = kst(d); return `${x.getUTCFullYear()}.${String(x.getUTCMonth() + 1).padStart(2, '0')}.${String(x.getUTCDate()).padStart(2, '0')}`; };
const kDate = (d) => { const x = kst(d); return `${x.getUTCFullYear()}년 ${x.getUTCMonth() + 1}월 ${x.getUTCDate()}일`; };

/** 보증 최고액 기본값: 월 렌트료 × 계약 개월 수(만 원 단위 올림). 미납·위약금·이자가 이 안에 들어온다 */
export const defaultGuarantyMax = (values) => {
  const total = toNum(values?.monthlyFee) * toNum(values?.termMonths);
  return total ? Math.ceil(total / 10000) * 10000 : 0;
};

/**
 * 계약서 칸(values)과 계약에서 보증서에 찍을 값을 모은다.
 * @param {object} values 계약서 칸
 * @param {object} [contract] 계약(vehicles·vehicle populate, rentStartDate·endDate·contractDate)
 * @param {Date} [documentDate]
 */
export const guarantyInfoOf = (values = {}, contract = null, documentDate = null) => {
  const vehicles = (contract?.vehicles || []).filter((v) => v && typeof v === 'object');
  const plateNo = vehicles.map((v) => v.plateNo).filter(Boolean).join(', ') || contract?.vehicle?.plateNo || '';
  const termMonths = values.termMonths || contract?.termMonths || '';
  return {
    contractNo: values.contractNo || contract?.contractNo || '',
    contractDate: contract?.contractDate || documentDate || null,
    partyName: values.partyName || '',
    regNo: [values.bizNo, values.corpRegNo].filter((x) => String(x || '').trim()).join(' / '),
    carModel: values.carModel || '',
    plateNo,
    termMonths,
    period: contract?.rentStartDate && contract?.endDate ? `${dots(contract.rentStartDate)} ~ ${dots(contract.endDate)}` : '',
    monthlyFee: toNum(values.monthlyFee),
    guarantor: String(values.guarantorName ?? values.ceoName ?? '').trim(),
    max: toNum(values.guarantyMax) || defaultGuarantyMax({ ...values, termMonths })
  };
};

/**
 * PDF에 연대보증서 한 장을 더한다.
 * @param {import('pdf-lib').PDFDocument} pdf
 * @param {{regular, bold}} fonts 이미 넣은 글꼴
 * @param {ReturnType<typeof guarantyInfoOf>} info
 * @param {{ pageLabel?: string }} [opts] 아래 가운데 쪽 표시(계약서에 붙이면 '별첨')
 */
export const addGuarantyPage = (pdf, { regular, bold }, info, { pageLabel = '별첨' } = {}) => {
  const page = pdf.addPage(A4);
  const [W, H] = A4;
  const L = 42;
  const R = W - 42;
  let y = H - 40; // 위에서부터 내려가며 그린다(y는 글자 아랫줄)

  const text = (s, x, yy, { size = 9, font = regular, color = BLACK, align = 'left', maxW } = {}) => {
    let str = String(s ?? '');
    let sz = size;
    if (maxW) while (font.widthOfTextAtSize(str, sz) > maxW && sz > 5.5) sz -= 0.25;
    const w = font.widthOfTextAtSize(str, sz);
    const xx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    page.drawText(str, { x: xx, y: yy, size: sz, font, color });
    return w;
  };
  const hline = (x1, x2, yy, thickness = 0.5, color = LINE) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });
  const wrap = (s, maxW, size, font = regular) => {
    const out = [];
    let line = '';
    for (const ch of String(s)) {
      if (font.widthOfTextAtSize(line + ch, size) > maxW) { out.push(line); line = ch.trim() ? ch : ''; } else line += ch;
    }
    if (line) out.push(line);
    return out;
  };

  // 위 오른쪽: 회사명 · 계약번호 · 무효 안내 (계약서 장과 같은 자리)
  text('㈜렌트베네핏', R, y, { size: 14, font: bold, align: 'right' });
  y -= 17;
  text(`계약번호:  ${info.contractNo}`, R, y, { size: 7.5, font: bold, align: 'right' });
  y -= 9;
  text('※ 계약번호가 없는 계약서는 무효입니다.', R, y, { size: 6.5, color: RED, align: 'right' });
  y -= 30;
  text('연대보증서', W / 2, y, { size: 21, font: bold, color: RED, align: 'center' });
  y -= 15;
  text(`자동차 임대차 계약서(계약번호 ${info.contractNo})의 별첨 · 법인 대표자 개인 연대보증`, W / 2, y, { size: 8, color: MUTED, align: 'center' });
  y -= 22;

  const section = (no, title) => {
    const w = text(`${no}.`, L, y, { size: 14, font: bold, color: RED });
    text(title, L + w + 4, y + 1, { size: 10.5 });
    y -= 6;
    hline(L, R, y, 1.4, BLACK);
  };
  /** 이름 칸·값 칸 줄. cells = [[이름, 값, {이름폭, 값 스타일}], ...] 한 줄에 둘까지 */
  const ROW = 25;
  const rowLine = (pairs, { h = ROW } = {}) => {
    const top = y;
    const bottom = y - h;
    const total = R - L;
    const n = pairs.length;
    const unit = total / n;
    pairs.forEach(([label, value, opt = {}], i) => {
      const x0 = L + unit * i;
      const lw = opt.labelW ?? (n === 1 ? 92 : 78);
      page.drawRectangle({ x: x0, y: bottom, width: lw, height: h, color: GRAY_BG });
      text(label, x0 + lw / 2, bottom + h / 2 - 3.2, { size: 8.8, font: bold, align: 'center', maxW: lw - 6 });
      if (value !== undefined && value !== null && value !== '') {
        const vx = opt.align === 'left' ? x0 + lw + 8 : opt.align === 'right' ? x0 + unit - 10 : x0 + lw + (unit - lw) / 2;
        text(value, vx, bottom + h / 2 - 3.2, { size: opt.size ?? 9, font: opt.bold ? bold : regular, color: opt.color ?? BLACK, align: opt.align ?? 'center', maxW: unit - lw - 14 });
      }
      if (opt.draw) opt.draw(x0 + lw, bottom, unit - lw, h);
    });
    hline(L, R, bottom);
    y = bottom;
    return top;
  };

  // 1. 보증하는 계약
  section(1, '보증하는 계약');
  rowLine([['계약번호', info.contractNo], ['계약일', info.contractDate ? kDate(info.contractDate) : '']]);
  rowLine([['임차인(법인)', info.partyName], ['등록번호', info.regNo]]);
  rowLine([['차종', info.carModel], ['차량번호', info.plateNo]]);
  rowLine([
    ['계약기간', info.termMonths ? `${info.termMonths}개월${info.period ? ` (${info.period})` : ''}` : ''],
    ['월 대여료', info.monthlyFee ? `${comma(info.monthlyFee)}원 (VAT 포함)` : '']
  ]);
  y -= 28;

  // 2. 보증 내용
  section(2, '보증 내용');
  y -= 14;
  const body = '보증인은 위 계약(임대차 계약 약관과 부속 약정을 포함합니다)에 따라 임차인이 주식회사 렌트베네핏(이하 "회사")에 부담하는 '
    + '대여료, 연체이자, 중도해지 위약금, 손해배상금, 차량 반환 지연에 따른 대여료, 범칙금·과태료 등 대납금 및 그 밖의 일체의 채무를 '
    + '아래 보증 최고액 범위에서 임차인과 연대하여 보증합니다.';
  for (const ln of wrap(body, R - L - 8, 9.6)) { text(ln, L + 4, y, { size: 9.6 }); y -= 16; }
  y -= 16;

  // 3. 보증 최고액 · 기간
  section(3, '보증 최고액 · 보증 기간');
  rowLine([['보증 최고액', `금 ${koreanAmount(info.max)}원정 (₩${comma(info.max)})`, { align: 'left', bold: true, color: RED, size: 10.5 }]], { h: 30 });
  rowLine([['보증인 자필 기재', '', {
    draw: (x, b, w, h) => {
      text('금', x + 8, b + h / 2 - 3.2, { size: 9.5 });
      hline(x + 22, x + 260, b + 7, 0.6, BLACK);
      text('원정', x + 266, b + h / 2 - 3.2, { size: 9.5 });
      text('(위 최고액을 보증인이 직접 씁니다)', x + w - 8, b + h / 2 - 3.2, { size: 7.5, color: MUTED, align: 'right' });
    }
  }]], { h: 34 });
  rowLine([['보증 기간', '위 계약 체결일부터 계약이 끝나고(중도해지 포함) 차량 반환과 정산이 모두 끝날 때까지', { align: 'left' }]]);
  y -= 28;

  // 4. 확인 사항
  section(4, '확인 사항');
  y -= 14;
  const notes = [
    '① 보증인은 위 계약의 내용과 임대차 계약 약관을 충분히 설명 듣고 이해하였으며, 본인의 의사로 이 보증서에 서명·날인합니다.',
    '② 이 보증서는 위 계약서의 일부이며(약관: 연대보증서는 계약서의 일부로 봅니다), 계약이 연장되거나 조건이 바뀌면 보증서를 새로 받습니다.',
    '③ 보증인의 주소·연락처가 바뀌면 지체 없이 회사에 알립니다.'
  ];
  for (const n of notes) for (const [i, ln] of wrap(n, R - L - 16, 8.8).entries()) { text(ln, L + 4 + (i ? 9 : 0), y, { size: 9.2 }); y -= 15.5; }
  y -= 16;
  // 날짜(보증인이 씀)
  const dateLine = '20          년          월          일';
  text(dateLine, W / 2, y, { size: 10.5, align: 'center' });
  y -= 30;

  // 5. 연대보증인
  section(5, '연대보증인 (법인 대표자 개인)');
  rowLine([['성명', info.guarantor, { bold: true, size: 11 }], ['생년월일', '']], { h: 34 });
  rowLine([['주소', '']], { h: 34 });
  rowLine([['연락처', ''], ['임차인과의 관계', '대표이사']], { h: 34 });
  rowLine([['자필 서명', ''], ['개인 인감', '(인)', { align: 'right', color: MUTED }]], { h: 64 });
  y -= 14;
  text('※ 첨부: 보증인 인감증명서(최근 3개월, 본인 발급) 1통 또는 본인서명사실확인서 1통. 법인 인감이 아닌 대표자 개인 인감을 찍습니다.', L, y, { size: 7.5, color: MUTED, maxW: R - L });
  y -= 11;
  text('※ 원본을 회사로 보내 주세요(스캔본만으로는 접수되지 않습니다).', L, y, { size: 7.5, color: MUTED });
  y -= 24;
  text('주식회사 렌트베네핏 귀중', R, y, { size: 12, font: bold, align: 'right' });

  if (pageLabel) text(pageLabel, W / 2, 22, { size: 9, color: MUTED, align: 'center' });
  return page;
};
