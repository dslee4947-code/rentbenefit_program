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
  // 띄어쓰기에서만 줄을 바꾼다(단어 가운데서 끊지 않는다)
  const wrap = (s, maxW, size, font = regular) => {
    const out = [];
    let line = '';
    for (const word of String(s).split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > maxW) { out.push(line); line = word; } else line = next;
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

  // ── 표: 모든 줄이 같은 격자를 쓴다(이름 칸 폭 하나, 두 짝이면 가운데에서 나눔). 칸마다 테두리, 값은 왼쪽 맞춤 ──
  const LW = 86; // 이름 칸 폭
  const M = L + (R - L) / 2; // 두 짝 줄의 가운데
  const PAD = 8;
  const mid = (bottom, h, size) => bottom + h / 2 - size * 0.36; // 칸 가운데에 오는 글자 아랫줄
  const vline = (x, y1, y2) => page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: 0.5, color: LINE });

  const section = (no, title) => {
    const w = text(`${no}.`, L, y, { size: 13, font: bold, color: RED });
    text(title, L + w + 5, y + 0.5, { size: 10.5, font: bold });
    y -= 7;
    hline(L, R, y, 1.3, BLACK);
  };

  /**
   * 표 한 줄. pairs = [[이름, 값, 옵션], ...] 한 줄에 하나(값이 끝까지) 또는 둘.
   * 옵션: { size, bold, color, align: 'left'|'right'|'center', draw(x, bottom, w, h) }
   */
  const row = (pairs, h = 26) => {
    const top = y;
    const bottom = y - h;
    const cells = pairs.length === 1 ? [[L, R]] : [[L, M], [M, R]];
    pairs.forEach(([label, value, opt = {}], i) => {
      const [x0, x1] = cells[i];
      page.drawRectangle({ x: x0, y: bottom, width: LW, height: h, color: GRAY_BG });
      text(label, x0 + LW / 2, mid(bottom, h, 8.8), { size: 8.8, font: bold, align: 'center', maxW: LW - 8 });
      const vx0 = x0 + LW;
      const vw = x1 - vx0;
      if (value !== undefined && value !== null && value !== '') {
        const size = opt.size ?? 9.2;
        const align = opt.align ?? 'left';
        const x = align === 'right' ? x1 - PAD - 4 : align === 'center' ? vx0 + vw / 2 : vx0 + PAD;
        text(value, x, mid(bottom, h, size), { size, font: opt.bold ? bold : regular, color: opt.color ?? BLACK, align, maxW: vw - PAD * 2 });
      }
      if (opt.draw) opt.draw(vx0, bottom, vw, h);
      vline(x0 + LW, top, bottom); // 이름 칸과 값 칸 사이
    });
    vline(L, top, bottom);
    vline(R, top, bottom);
    if (pairs.length === 2) vline(M, top, bottom);
    hline(L, R, bottom);
    y = bottom;
  };
  const GAP = 24;
  const paragraph = (lines, size, lead) => {
    y -= size + 6;
    for (const ln of lines) { text(ln.t, L + 4 + (ln.indent || 0), y, { size }); y -= lead; }
    y += lead - 4;
  };

  // 1. 보증하는 계약
  section(1, '보증하는 계약');
  row([['계약번호', info.contractNo], ['계약일', info.contractDate ? kDate(info.contractDate) : '']]);
  row([['임차인(법인)', info.partyName], ['등록번호', info.regNo]]);
  row([['차종', info.carModel], ['차량번호', info.plateNo]]);
  row([
    ['계약기간', info.termMonths ? `${info.termMonths}개월${info.period ? ` (${info.period})` : ''}` : ''],
    ['월 대여료', info.monthlyFee ? `${comma(info.monthlyFee)}원 (VAT 포함)` : '']
  ]);
  y -= GAP;

  // 2. 보증 내용
  section(2, '보증 내용');
  const body = '보증인은 위 계약(임대차 계약 약관과 부속 약정을 포함합니다)에 따라 임차인이 주식회사 렌트베네핏(이하 "회사")에 부담하는 '
    + '대여료, 연체이자, 중도해지 위약금, 손해배상금, 차량 반환 지연에 따른 대여료, 범칙금·과태료 등 대납금 및 그 밖의 일체의 채무를 '
    + '아래 보증 최고액 범위에서 임차인과 연대하여 보증합니다.';
  paragraph(wrap(body, R - L - 8, 9.4).map((t) => ({ t })), 9.4, 15.5);
  y -= GAP;

  // 3. 보증 최고액 · 기간
  section(3, '보증 최고액 · 보증 기간');
  row([['보증 최고액', `금 ${koreanAmount(info.max)}원정 (₩${comma(info.max)})`, { bold: true, color: RED, size: 10.5 }]], 30);
  row([['보증인 자필 기재', '', {
    draw: (x, b, w, h) => {
      const base = mid(b, h, 9.5);
      const note = '(위 최고액을 보증인이 직접 씁니다)';
      const noteW = regular.widthOfTextAtSize(note, 7.5);
      const wonW = regular.widthOfTextAtSize('원정', 9.5);
      text('금', x + PAD, base, { size: 9.5 });
      const lineEnd = x + w - PAD - noteW - 12 - wonW - 6;
      hline(x + PAD + 16, lineEnd, base - 2.5, 0.6, BLACK);
      text('원정', lineEnd + 6, base, { size: 9.5 });
      text(note, x + w - PAD, base, { size: 7.5, color: MUTED, align: 'right' });
    }
  }]], 34);
  row([['보증 기간', '위 계약 체결일부터 계약이 끝나고(중도해지 포함) 차량 반환과 정산이 모두 끝날 때까지']]);
  y -= GAP;

  // 4. 확인 사항
  section(4, '확인 사항');
  const notes = [
    '① 보증인은 위 계약의 내용과 임대차 계약 약관을 충분히 설명 듣고 이해하였으며, 본인의 의사로 이 보증서에 서명·날인합니다.',
    '② 이 보증서는 위 계약서의 일부이며, 계약이 연장되거나 조건이 바뀌면 보증서를 새로 받습니다.',
    '③ 보증인의 주소·연락처가 바뀌면 지체 없이 회사에 알립니다.'
  ];
  paragraph(notes.flatMap((n) => wrap(n, R - L - 20, 9).map((t, i) => ({ t, indent: i ? 11 : 0 }))), 9, 15);
  y -= GAP;

  // 5. 연대보증인 (날짜는 표 위 오른쪽, 보증인이 씀)
  section(5, '연대보증인 (법인 대표자 개인)');
  row([['작성일', '20          년          월          일', { size: 10 }]], 28);
  row([['성명', info.guarantor, { bold: true, size: 11 }], ['생년월일', '']], 32);
  row([['주소', '']], 32);
  row([['연락처', ''], ['임차인과의 관계', '대표이사']], 32);
  row([['자필 서명', ''], ['개인 인감', '(인)', { align: 'right', color: MUTED }]], 62);
  y -= 15;
  text('※ 첨부: 보증인 인감증명서(최근 3개월, 본인 발급) 1통 또는 본인서명사실확인서 1통. 법인 인감이 아닌 대표자 개인 인감을 찍습니다.', L, y, { size: 7.5, color: MUTED, maxW: R - L });
  y -= 11;
  text('※ 원본을 회사로 보내 주세요(스캔본만으로는 접수되지 않습니다).', L, y, { size: 7.5, color: MUTED });
  y -= 28;
  text('주식회사 렌트베네핏 귀중', R, y, { size: 12, font: bold, align: 'right' });

  if (pageLabel) text(pageLabel, W / 2, 22, { size: 9, color: MUTED, align: 'center' });
  return page;
};
