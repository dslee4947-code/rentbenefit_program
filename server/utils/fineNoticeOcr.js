import { randomUUID } from 'crypto';

// 범칙금·과태료·미납통행료 고지서에서 차량번호와 금액을 읽어 낸다.
//
// 읽은 값을 그대로 청구하지 않는다. 화면의 입력칸을 미리 채워 주기만 하고 사람이 확인한다.
// 잘못 읽은 금액이 청구서로 나가면 되돌리기 어렵다.

const FORMAT_BY_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff'
};

// 차량번호. 2006년 이후 '12가3456', 그 이전 '서울12가3456' 두 가지를 본다.
// OCR이 글자 사이를 띄워 읽는 일이 잦아 공백을 허용하고 뒤에서 지운다.
const PLATE_PATTERNS = [
  /(\d{2,3})\s*([가-힣])\s*(\d{4})/g,
  /([가-힣]{2})\s*(\d{2})\s*([가-힣])\s*(\d{4})/g
];

// 금액 앞에 붙는 말. 앞에 있을수록 그 금액일 가능성이 높다.
const AMOUNT_LABELS = [
  '납부할금액', '납부금액', '총납부액', '납부액', '부과액', '합계금액', '합계',
  '과태료', '범칙금', '통행료', '미납통행료', '부가통행료', '금액'
];

// 금액이 아닌 숫자를 걸러 낸다. 사업자번호·전화번호·고지번호가 자주 걸린다.
const NOT_AMOUNT = /^(0|00|000)$/;

// 고지서 종류. 어느 청구 항목으로 합산되는지가 갈리므로 먼저 나오는 말을 따른다.
// '과태료 및 범칙금 안내'처럼 둘 다 적힌 서식이 있어, 앞에 나온 쪽을 고른다.
const KIND_WORDS = [
  ['통행료', /미납\s*통행료|부가\s*통행료|통행료/],
  ['과태료', /과태료/],
  ['범칙금', /범칙금|통고처분/]
];

// 위반일시 라벨. 서식마다 말이 달라 쓰이는 것을 모두 본다.
const VIOLATION_LABELS = [
  '위반일시', '위반일자', '위반년월일', '위반일', '단속일시', '단속일자',
  '발생일시', '발생일자', '통행일시', '통행일자', '이용일시'
];
// 납부기한 라벨. '자진납부기한'은 감경 기한이라 실제 기한보다 이르다. 이른 쪽을 알려 주는 편이 안전하다.
const DUE_LABELS = ['자진납부기한', '납부기한', '납부기간', '납기일', '납기'];
// 고지번호 라벨. 같은 고지서를 다시 스캔했는지 판정하는 열쇠다.
const NOTICE_NO_LABELS = ['고지번호', '납부번호', '전자납부번호', '문서번호', '접수번호', '사건번호', '위반번호'];

/** 공백과 쉼표를 지운다. OCR은 같은 글자를 조각내 읽는 일이 많다. */
const squeeze = (text) => String(text || '').replace(/\s+/g, '');

/**
 * 고지서 글자에서 차량번호를 찾는다.
 *
 * @param {string} text OCR이 읽은 전체 글자
 * @returns {string[]} 찾은 차량번호 (중복 제거, 나온 순서)
 */
export const findPlateNumbers = (text) => {
  const found = [];
  for (const pattern of PLATE_PATTERNS) {
    pattern.lastIndex = 0;
    let m = pattern.exec(text);
    while (m) {
      found.push(squeeze(m[0]));
      m = pattern.exec(text);
    }
  }
  return [...new Set(found)];
};

/**
 * 고지서 글자에서 금액을 찾는다.
 *
 * 숫자만 보면 고지번호·전화번호까지 잡히므로, '납부할 금액' 같은 말 뒤에 오는 숫자를 먼저 본다.
 * 라벨을 못 찾으면 '원'이 붙은 숫자 중 가장 큰 값을 후보로 준다.
 *
 * @param {string} text OCR이 읽은 전체 글자
 * @returns {{amount: number, candidates: Array<{label: string, amount: number}>}} 가장 그럴듯한 금액과 후보들
 */
export const findAmounts = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const candidates = [];

  // ① 라벨 뒤에 오는 숫자
  for (const label of AMOUNT_LABELS) {
    const re = new RegExp(`${label.split('').join('\\s*')}\\s*[:\\-]?\\s*([0-9][0-9,\\s]{2,})`, 'g');
    let m = re.exec(flat);
    while (m) {
      const n = Number(squeeze(m[1]).replace(/,/g, ''));
      if (Number.isFinite(n) && n >= 1000 && n <= 100000000) candidates.push({ label, amount: n });
      m = re.exec(flat);
    }
  }

  // ② '원'이 붙은 숫자
  const wonRe = /([0-9][0-9,\s]{2,})\s*원/g;
  let w = wonRe.exec(flat);
  while (w) {
    const n = Number(squeeze(w[1]).replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 1000 && n <= 100000000 && !NOT_AMOUNT.test(String(n))) {
      candidates.push({ label: '원', amount: n });
    }
    w = wonRe.exec(flat);
  }

  // 라벨이 앞쪽에 있는 것을 먼저 고른다. 같은 라벨이면 큰 금액(가산금 포함 총액)을 고른다.
  const rank = (c) => {
    const i = AMOUNT_LABELS.indexOf(c.label);
    return i === -1 ? AMOUNT_LABELS.length : i;
  };
  const sorted = [...candidates].sort((a, b) => (rank(a) - rank(b)) || (b.amount - a.amount));

  return {
    amount: sorted[0]?.amount || 0,
    candidates: sorted.slice(0, 8)
  };
};

// 날짜. 2026-09-02 / 2026.9.2 / 2026년 9월 2일 / 26.09.02 를 모두 본다.
const DATE_RE = '((?:19|20)?\\d{2})\\s*[.\\-/년]\\s*(\\d{1,2})\\s*[.\\-/월]\\s*(\\d{1,2})\\s*일?';
// 날짜 뒤에 붙는 시각. 14:20 / 14시 20분.
const TIME_RE = '(?:\\s*(\\d{1,2})\\s*[:시]\\s*(\\d{1,2}))?';

/** 라벨 글자 사이에 공백이 끼어도 걸리게 한다. OCR은 '위 반 일 시'처럼 읽는 일이 많다. */
const spaced = (label) => label.split('').join('\\s*');

/**
 * 정규식으로 잡은 연·월·일을 날짜로 만든다. 말이 안 되는 값이면 null을 준다.
 * @returns {{date: string, time: string}|null} date는 YYYY-MM-DD
 */
const toDate = (y, m, d, hh, mm) => {
  let year = Number(y);
  if (year < 100) year += 2000;
  const month = Number(m);
  const day = Number(d);
  if (!(year >= 1990 && year <= 2100) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;

  const pad = (n) => String(n).padStart(2, '0');
  const time = (hh !== undefined && Number(hh) <= 23 && Number(mm) <= 59)
    ? `${pad(Number(hh))}:${pad(Number(mm))}`
    : '';
  return { date: `${year}-${pad(month)}-${pad(day)}`, time };
};

/**
 * 라벨 뒤에 오는 날짜를 찾는다.
 *
 * 고지서에는 날짜가 서너 개 적혀 있다(위반일·발급일·납부기한). 아무 날짜나 집으면
 * 엉뚱한 계약자에게 청구되므로, 반드시 라벨 뒤에 붙은 것만 본다.
 *
 * @param {string} flat 공백을 한 칸으로 줄인 글자
 * @param {string[]} labels 찾을 라벨들 (앞에 있을수록 먼저 본다)
 * @returns {{date: string, time: string, label: string}|null}
 */
const findLabeledDate = (flat, labels) => {
  for (const label of labels) {
    const re = new RegExp(`${spaced(label)}\\s*[:\\-]?\\s*${DATE_RE}${TIME_RE}`);
    const m = re.exec(flat);
    if (!m) continue;
    const parsed = toDate(m[1], m[2], m[3], m[4], m[5]);
    if (parsed) return { ...parsed, label };
  }
  return null;
};

/**
 * 고지서 종류를 고른다. 과태료·범칙금이 함께 적힌 서식이 있어 먼저 나오는 말을 따른다.
 * @param {string} text OCR이 읽은 전체 글자
 * @returns {string} '과태료' | '범칙금' | '통행료' | '' (모르면 빈 값)
 */
export const findNoticeKind = (text) => {
  const flat = String(text || '').replace(/\s+/g, '');
  const hits = KIND_WORDS
    .map(([kind, re]) => ({ kind, at: flat.search(re) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  return hits[0]?.kind || '';
};

/**
 * 위반일시를 찾는다. 어느 계약자 건인지 가르는 값이라 라벨이 없으면 비워 둔다.
 * @param {string} text OCR이 읽은 전체 글자
 * @returns {{date: string, time: string, label: string}|null}
 */
export const findViolationDate = (text) => findLabeledDate(String(text || '').replace(/\s+/g, ' '), VIOLATION_LABELS);

/**
 * 납부기한을 찾는다. 기한이 지나면 렌트료에 얹어 청구하므로 추적에 쓴다.
 * @param {string} text OCR이 읽은 전체 글자
 * @returns {{date: string, time: string, label: string}|null}
 */
export const findDueDate = (text) => findLabeledDate(String(text || '').replace(/\s+/g, ' '), DUE_LABELS);

/**
 * 고지번호를 찾는다.
 *
 * 중복 판정을 파일 지문(sha256)만으로 하면 같은 고지서를 다시 스캔했을 때 지문이 달라져
 * 이중 청구가 된다. 고지서에 적힌 번호가 진짜 열쇠다.
 *
 * @param {string} text OCR이 읽은 전체 글자
 * @returns {string} 찾은 번호 (없으면 빈 값)
 */
export const findNoticeNo = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ');
  for (const label of NOTICE_NO_LABELS) {
    const re = new RegExp(`${spaced(label)}\\s*[:\\-]?\\s*([0-9][0-9\\-]{6,29})`);
    const m = re.exec(flat);
    if (m) return m[1].replace(/-+$/, '');
  }
  return '';
};

/**
 * 고지서 파일을 CLOVA OCR로 읽어 차량번호와 금액을 뽑는다.
 *
 * @param {Buffer} fileBuffer 파일 내용
 * @param {string} mimeType 파일 종류
 * @param {string} [originalName] 원래 파일명
 * @returns {Promise<{plateNos: string[], amount: number, candidates: object[], text: string}>}
 */
export const readFineNotice = async (fileBuffer, mimeType, originalName) => {
  const invokeUrl = process.env.CLOVA_OCR_INVOKE_URL;
  const secret = process.env.CLOVA_OCR_SECRET;
  if (!invokeUrl || !secret) {
    throw new Error('OCR이 설정되지 않았습니다. CLOVA_OCR_INVOKE_URL과 CLOVA_OCR_SECRET을 확인해 주세요.');
  }

  const format = FORMAT_BY_MIME[mimeType];
  if (!format) {
    throw new Error(`읽을 수 없는 파일 형식입니다(${mimeType}). JPG, PNG, TIFF, PDF만 됩니다.`);
  }

  const res = await fetch(invokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': secret },
    body: JSON.stringify({
      version: 'V2',
      requestId: randomUUID(),
      timestamp: Date.now(),
      lang: 'ko',
      images: [{ format, name: originalName || 'notice', data: fileBuffer.toString('base64') }]
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[고지서 OCR] CLOVA 응답 ${res.status}: ${detail.slice(0, 300)}`);
    throw new Error(`글자를 읽지 못했습니다. (CLOVA 응답 ${res.status})`);
  }

  const payload = await res.json();
  const image = payload?.images?.[0];
  if (!image || image.inferResult === 'ERROR') {
    throw new Error('고지서를 인식하지 못했습니다. 더 선명한 사진으로 다시 올려 주세요.');
  }

  const text = (image.fields || []).map((f) => f.inferText || '').join(' ');
  const plateNos = findPlateNumbers(text);
  const { amount, candidates } = findAmounts(text);
  const kind = findNoticeKind(text);
  const violation = findViolationDate(text);
  const due = findDueDate(text);
  const noticeNo = findNoticeNo(text);
  console.log(`[고지서 OCR] ${text.length}자 · 차량번호 ${plateNos.length}건 · 금액 후보 ${candidates.length}건 · 종류 ${kind || '미상'} · 위반일 ${violation?.date || '미상'}`);

  return {
    plateNos,
    amount,
    candidates,
    kind,
    violationDate: violation?.date || '',
    violationTime: violation?.time || '',
    dueDate: due?.date || '',
    noticeNo,
    text
  };
};
