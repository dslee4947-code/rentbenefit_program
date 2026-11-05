import { parseRepairInvoice, spaced, labeledAmount, mileageOf, lastKoreanDate } from './repairInvoice.js';
import { findPlateNumbers } from './fineNoticeOcr.js';
import { kstYmd } from './vehicleServicePlan.js';

// 렌트 차량 AS에 올리는 서류(자동차검사 진단서·결과표, 수리·점검 내역서)를 읽어 기록 칸에 넣을 값으로 바꾼다.
// 고지서·내역서 읽기와 같은 원칙: 바로 저장하지 않는다. 칸을 채워 주고 사람이 확인한 뒤 저장한다.

const REPAIR_FORM = /점검\s*[·ㆍ.]?\s*정비\s*(명세|견적)|수리\s*(내역|견적|명세)|정비\s*(내역|명세|견적)/;
const INSPECTION_FORM = /기능\s*종합\s*진단서|(정기|종합)\s*검사\s*결과|검사\s*결과\s*(표|서|통지)|자동차\s*검사\s*(증|결과)|자동차\s*검사소/;

/** @returns {'inspection'|'repair'} 서류 종류. 정비 양식 이름이 있으면 정비다(정비 명세서에도 '검사' 글자가 나온다) */
export const serviceDocTypeOf = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ');
  if (REPAIR_FORM.test(flat)) return 'repair';
  return INSPECTION_FORM.test(flat) ? 'inspection' : 'repair';
};

const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const DATE = '(20\\d{2})\\s*[년.\\-/]\\s*(\\d{1,2})\\s*[월.\\-/]\\s*(\\d{1,2})';

/** 검사일: 검사일자 라벨 → 결과표 머리의 'YYYY-MM-DD HH:MM' → 접수번호 안 날짜 → 맨 아래 발급일 */
const inspectionDateOf = (flat) => {
  const labeled = new RegExp(`${spaced('검사일자')}\\s*[:：]?\\s*${DATE}`).exec(flat);
  if (labeled) return ymd(labeled[1], labeled[2], labeled[3]);
  const stamped = /(20\d{2})-(\d{2})-(\d{2})\s+\d{2}:\d{2}/.exec(flat);
  if (stamped) return ymd(stamped[1], stamped[2], stamped[3]);
  const receipt = /접수번호\s*[:：]?\s*[A-Za-z0-9]+-(20\d{2})(\d{2})(\d{2})-/.exec(flat);
  if (receipt) return ymd(receipt[1], receipt[2], receipt[3]);
  return lastKoreanDate(flat);
};

/** 다음 검사일: 'YYYY-MM-DD ~ YYYY-MM-DD'(기간이면 끝 날) 또는 '다음(종합) 검사일 … YYYY-MM-DD' */
const nextInspectionOf = (flat) => {
  const range = new RegExp(`${spaced('검사주기')}[^0-9]{0,10}${DATE}\\s*[~-]\\s*${DATE}`).exec(flat);
  if (range) return ymd(range[4], range[5], range[6]);
  // OCR이 '종합'을 '좀환'처럼 잘못 읽기도 하고, 라벨과 날짜 사이에 차대번호가 끼기도 한다
  const after = new RegExp(`(?:다음|종합|좀환)\\s*검사\\s*일.{0,60}?(20\\d{2})-(\\d{2})-(\\d{2})`).exec(flat);
  return after ? ymd(after[1], after[2], after[3]) : '';
};

/** 판정. '부적합 내용(재검사 대상)'은 모든 서류에 찍히는 제목이라 판정으로 보지 않는다 */
const inspectionResultOf = (flat) => {
  const labeled = /(?:최종\s*판정|종합\s*판정)\s*[:：]?\s*(부적합|적합|불합격|합격)/.exec(flat);
  const word = labeled?.[1] || (/(?:^|\s)불합격(?:\s|$)/.test(flat) ? '불합격' : /(?:^|\s)합격(?:\s|$)/.test(flat) ? '합격' : '');
  if (!word) return '';
  return ['부적합', '불합격'].includes(word) ? '부적합' : '적합';
};

/** 검사소: '○○ 자동차검사소' → 지정정비사업자 → 공업사·정비소 이름 */
const inspectionShopOf = (text) => {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  const station = lines.find((l) => /자동차\s*검사소/.test(l) && !/제\s*\d+\s*조|법|받은 검사소/.test(l));
  if (station) return station.replace(/\s*(검사책임자|검사\s*책임자|\d{2,3}-\d{3,4}-\d{4}).*$/, '').trim().slice(0, 30);
  const agent = /지\s*정\s*정\s*비\s*사\s*업\s*자\s*\)?\s*([^\n]{2,30})/.exec(text);
  if (agent) return agent[1].trim();
  const shop = lines.find((l) => /^[가-힣()A-Za-z0-9\s]{2,24}(공업사|공업|정비사업소|모터스|오토|카센터|정비)$/.test(l) && !/부분|계통/.test(l));
  return shop || '';
};

/**
 * 자동차검사 서류(기능 종합 진단서, 정기검사 결과표)를 읽는다.
 * @returns {{docType: 'inspection', kindGuess: string, plateNo: string, date: string, nextDate: string, mileage: number,
 *   shop: string, result: string, amount: number, warnings: string[]}}
 */
export const parseInspectionDoc = (text) => {
  const raw = String(text || '');
  const flat = raw.replace(/\s+/g, ' ');
  const result = inspectionResultOf(flat);
  const parsed = {
    docType: 'inspection',
    kindGuess: '자동차검사',
    plateNo: findPlateNumbers(raw)[0] || '',
    date: inspectionDateOf(flat),
    nextDate: nextInspectionOf(flat),
    mileage: mileageOf(flat),
    shop: inspectionShopOf(raw),
    result,
    amount: labeledAmount(flat, ['검사수수료', '수수료', '결제금액', '납부금액']),
    warnings: []
  };
  if (!parsed.date) parsed.warnings.push('검사일을 찾지 못했습니다. 직접 적어 주세요.');
  if (!parsed.plateNo) parsed.warnings.push('차량번호를 찾지 못했습니다. 차를 직접 골라 주세요.');
  if (result === '부적합') parsed.warnings.push('부적합 판정입니다. 재검사가 끝나기 전에는 완료로 저장하지 않습니다.');
  return parsed;
};

/** 수리·점검 내역서를 같은 모양으로 맞춰 읽는다. 기록 날짜는 출고(완료)일, 없으면 발급일 */
export const parseRepairDoc = (text) => {
  const p = parseRepairInvoice(text);
  const forms = String(text || '').match(/별지\s*제\s*89\s*호의\s*\d/g)?.length || 0;
  const warnings = forms > 1 ? [...p.warnings, `한 파일에 내역서가 ${forms}장 있습니다. 첫 장 기준으로 읽었으니 건마다 나눠 올려 주세요.`] : p.warnings;
  return { ...p, warnings, docType: 'repair', date: p.outDate || p.issuedDate || p.inDate, amount: p.total };
};

/** 서류 종류를 가려 읽는다 */
export const parseServiceDocument = (text) => (serviceDocTypeOf(text) === 'inspection' ? parseInspectionDoc(text) : parseRepairDoc(text));

const OPEN_WINDOW_DAYS = 45; // 예약일과 실제 받은 날이 이만큼 어긋나도 그 일정으로 본다
const DONE_WINDOW_DAYS = 3; // 캘린더·원장에서 옮겨 온 완료 기록과 같은 건으로 보는 날수
const REPAIR_FAMILY = ['정기점검', '고장수리', '사고수리', '소모품교환', '기타'];
const gapDays = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;

/**
 * 올린 서류를 넣을 기존 기록을 고른다.
 *  1) 아직 안 끝난 일정(예정·입고·수리 중) 중 가장 가까운 것
 *  2) 파일이 없는 완료 기록 중 며칠 안의 것(캘린더·원장에서 옮겨 와 서류만 없는 건). 새로 만들면 같은 일이 두 번 잡힌다
 * 없으면 null(새 기록으로 저장).
 *
 * @param {object[]} records 그 차의 기록
 * @param {{kind: string, date: string}} doc 서류 종류(자동차검사면 검사만, 그 밖에는 정비 쪽 전부)와 날짜
 */
export const pickServiceTarget = (records, { kind, date }) => {
  const kinds = kind === '자동차검사' ? ['자동차검사'] : REPAIR_FAMILY;
  const near = (list, days) => list
    .map((r) => ({ r, gap: date ? gapDays(kstYmd(r.date), date) : 0 }))
    .filter((x) => x.gap <= days)
    // 같은 거리면 서류의 종류와 같은 일정을 먼저
    .sort((a, b) => a.gap - b.gap || Number(b.r.kind === kind) - Number(a.r.kind === kind))[0]?.r;
  const same = (records || []).filter((r) => kinds.includes(r.kind));
  const open = near(same.filter((r) => r.status && r.status !== '완료'), OPEN_WINDOW_DAYS);
  if (open) return open;
  if (!date) return null;
  return near(same.filter((r) => (!r.status || r.status === '완료') && !r.savedPath && !(r.attachments || []).length), DONE_WINDOW_DAYS) || null;
};
