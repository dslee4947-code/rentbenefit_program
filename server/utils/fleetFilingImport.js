import XLSX from 'xlsx';
import { DEFAULT_FLEET_INFO } from '../../shared/fleetFiling.js';

/**
 * 증차공문 엑셀을 읽는다(대표님 2026-10-30 "모든 시트가 올라가면 좋고").
 *
 * "증차공문 서류_*.xlsx"
 * - 신구사업대비표: 15행부터 차종(A)·가로(D)·세로(H)·신고 대수(L)·이번 변경 대수(AA), 차고지(D9·J9·AK15·AK16·AK18)
 * - 증차: 법인명(H6)·전화(N6)·주소(H7)·전화(T7)
 * - 차량정보: 매매계약서 칸(계약번호·차종·색상·차량가격·탁송료·대수·계약금)
 * "구청 등록현황(참고용)_*.xlsx"
 * - 구청 메일 온 날짜(A)·증차(B)/감차(C)·차종(D)·총대수(E) → 지난 처리 기록
 * 계산식 칸은 엑셀이 저장해 둔 값을 읽는다.
 */

const cell = (ws, addr) => {
  const c = ws?.[addr];
  if (!c) return undefined;
  return c.v;
};
const text = (v) => (v == null ? '' : String(v).trim());
const number = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const phoneIn = (v) => (text(v).match(/[\d-]{9,}/) || [''])[0];

const readCarTypes = (ws) => {
  const carTypes = [];
  const pending = [];
  for (let r = 15; r <= 300; r += 1) {
    const name = text(cell(ws, `A${r}`));
    if (!name) {
      if (!text(cell(ws, `A${r + 1}`)) && !text(cell(ws, `A${r + 2}`))) break;
      continue;
    }
    const width = number(cell(ws, `D${r}`));
    const length = number(cell(ws, `H${r}`));
    carTypes.push({ name, width, length, count: number(cell(ws, `L${r}`)) });
    const delta = number(cell(ws, `AA${r}`));
    if (delta) pending.push({ name, width, length, delta });
  }
  return { carTypes, pending };
};

const readGarage = (ws) => {
  const g = { ...DEFAULT_FLEET_INFO.garage };
  if (text(cell(ws, 'D9'))) g.location = text(cell(ws, 'D9'));
  if (number(cell(ws, 'J9'))) g.area = number(cell(ws, 'J9'));
  if (number(cell(ws, 'AK15'))) g.requiredArea = number(cell(ws, 'AK15'));
  // AK16 = 감면 면적(소요면적 × 90%)
  if (number(cell(ws, 'AK15')) && number(cell(ws, 'AK16'))) {
    g.reductionRate = Math.round((number(cell(ws, 'AK16')) / number(cell(ws, 'AK15'))) * 1000) / 1000;
  }
  if (number(cell(ws, 'AK18'))) g.contractArea = number(cell(ws, 'AK18'));
  return g;
};

const readCompany = (form, sheet) => {
  const c = { ...DEFAULT_FLEET_INFO.company };
  if (form) {
    if (text(cell(form, 'H6'))) c.name = text(cell(form, 'H6'));
    if (phoneIn(cell(form, 'N6'))) c.phone = phoneIn(cell(form, 'N6'));
    if (text(cell(form, 'H7'))) c.address = text(cell(form, 'H7'));
    if (phoneIn(cell(form, 'T7'))) c.officePhone = phoneIn(cell(form, 'T7'));
  }
  if (sheet && text(cell(sheet, 'F4'))) c.officeAddress = text(cell(sheet, 'F4'));
  return c;
};

// '차량정보' 시트: A열 이름, B열 값
const readContract = (ws) => {
  if (!ws) return null;
  const byLabel = {};
  for (let r = 1; r <= 30; r += 1) {
    const label = text(cell(ws, `A${r}`)).replace(/\s+/g, '');
    if (label) byLabel[label] = cell(ws, `B${r}`);
  }
  if (!text(byLabel['차종'])) return null;
  return {
    maker: /기아|^k\d|쏘렌토|스포티지|카니발|레이|셀토스|니로|ev\d/i.test(text(byLabel['차종'])) ? '기아' : '현대',
    contractNo: text(byLabel['계약번호']),
    model: text(byLabel['차종']),
    color: text(byLabel['색상']),
    price: number(byLabel['차량가격']) || undefined,
    deliveryFee: number(byLabel['탁송료']) || undefined,
    qty: text(byLabel['대수']) || '1대',
    deposit: number(byLabel['계약금']) || undefined
  };
};

// '26.06.24' → 2026-06-24
const ymdOf = (v) => {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000));
  const m = text(v).match(/^(\d{2,4})\.(\d{1,2})\.(\d{1,2})/);
  if (!m) return null;
  const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
};

const readHistory = (ws) => {
  const rows = [];
  for (let r = 3; r <= 500; r += 1) {
    const date = ymdOf(cell(ws, `A${r}`));
    const name = text(cell(ws, `D${r}`));
    if (!date || !name) continue;
    const kind = text(cell(ws, `C${r}`)) === '감차' ? '감차' : (text(cell(ws, `B${r}`)) === '증차' ? '증차' : '');
    if (!kind) continue;
    rows.push({ date, kind, name, total: number(cell(ws, `E${r}`)) || null });
  }
  return rows;
};

/**
 * @param {Buffer} buffer
 * @returns {{info?: object, pending: object[], contract: object|null, history: object[]}}
 */
export const parseFleetWorkbook = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets['신구사업대비표'];
  const result = { pending: [], contract: null, history: [] };

  if (sheet) {
    const { carTypes, pending } = readCarTypes(sheet);
    result.info = { company: readCompany(wb.Sheets['증차'], sheet), garage: readGarage(sheet), carTypes };
    result.pending = pending;
    result.contract = readContract(wb.Sheets['차량정보']);
  }

  wb.SheetNames.forEach((name) => {
    const ws = wb.Sheets[name];
    if (text(cell(ws, 'A2')).replace(/\s+/g, '') === '구청메일온날짜') result.history.push(...readHistory(ws));
  });

  if (!sheet && !result.history.length) {
    throw new Error('신구사업대비표 시트나 구청 등록현황 표를 찾지 못했습니다. 증차공문 엑셀이 맞는지 확인해 주세요.');
  }
  return result;
};
