// 전자계약서 화면에서 함께 쓰는 계산. 컴포넌트 파일과 나눠 둔다(react-refresh 규칙).

const won = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '');
const toNumber = (s) => Number(String(s ?? '').replace(/[^\d.-]/g, ''));

export const ymdDots = (d) => {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const k = new Date(t.getTime() + 9 * 3600e3);
  return `${k.getUTCFullYear()}. ${k.getUTCMonth() + 1}. ${k.getUTCDate()}.`;
};

/**
 * 수식 칸의 값을 계산한다. 서버 parseBinding이 풀어 둔 모양만 다룬다.
 * @param {object} bind
 * @param {{fieldByCell: object, sheetCells: object, values: object, documentDate: any}} ctx
 */
export const resolveBinding = (bind, ctx, depth = 0) => {
  if (!bind || depth > 6) return '';
  const refValue = (ref) => {
    if (ref.sheet === '법인정보') {
      const field = ctx.fieldByCell[ref.cell];
      return field ? ctx.values[field.key] ?? '' : '';
    }
    const cell = ctx.sheetCells[ref.sheet]?.[ref.cell];
    if (!cell) return '';
    return cell.bind ? resolveBinding(cell.bind, ctx, depth + 1) : cell.t ?? '';
  };
  switch (bind.op) {
    case 'ref': return refValue(bind);
    case 'concat': return bind.parts.map((p) => (p.lit !== undefined ? p.lit : refValue(p))).join('');
    case 'mul': {
      const a = toNumber(refValue(bind.a));
      const b = toNumber(refValue(bind.b));
      return Number.isFinite(a * b) && (a || b) ? won(a * b) : '';
    }
    case 'ifeq': return String(refValue(bind.test)).trim() === bind.eq ? bind.yes : bind.no;
    case 'today': return ymdDots(ctx.documentDate || new Date());
    default: return '';
  }
};

/** 양식 + 입력값 → 장을 그릴 때 쓰는 묶음 */
export const buildSheetContext = (template, values, documentDate) => {
  const fieldByCell = Object.fromEntries((template?.fields || []).map((f) => [f.cell, f]));
  const sheetCells = {};
  for (const s of template?.sheets || []) {
    sheetCells[s.name] = Object.fromEntries(s.cells.filter((c) => c.t !== undefined || c.bind).map((c) => [c.a, c]));
  }
  return { fieldByCell, sheetCells, values: values || {}, documentDate };
};

// 입력 칸 묶음(화면 왼쪽 입력란). 양식의 순서를 따르되 보기 쉽게 나눈다.
export const FIELD_GROUPS = [
  { title: '계약자', keys: ['contractNo', 'vehicleCode', 'partyName', 'ceoName', 'bizNo', 'corpRegNo', 'address', 'phone', 'email'] },
  { title: '담당자·운전자', keys: ['managerName', 'managerPhone', 'payerName', 'driverName'] },
  { title: '출금 계좌(CMS)', keys: ['bankName', 'bankAccount', 'bankHolder'] },
  { title: '차량', keys: ['carModel', 'origin', 'quantity', 'exteriorColor', 'interiorColor', 'options'] },
  { title: '계약 조건', keys: ['termMonths', 'carPrice', 'monthlyFee', 'deposit', 'advancePayment', 'takeoverPrice', 'annualMileage', 'penaltyRate', 'overdueRate'] },
  { title: '보험·정비', keys: ['propertyLimit', 'personalInjury', 'personalInjury_2', 'uninsuredInjury', 'deductible', 'emergencyService', 'maintenance', 'tire'] }
];

export const SOURCE_LABEL = { contract: '계약', quote: '견적', customer: '고객', company: '법인', vehicle: '차량', manual: '직접 입력' };
