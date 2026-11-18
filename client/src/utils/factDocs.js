/**
 * 계약사실 증명원 입력 칸 안내용: 입력 칸을 비우면 들어갈 렌트차량 DB 값.
 * 차가 여러 대면 값이 같을 때만 그 값을, 다르면 '차마다 다름'을 돌려준다.
 * @param {object} open buildDeliveryDocs 결과
 * @param {'driverRange'|'accidentRepair'} field
 */
export const dbValue = (open, field) => {
  const values = [...new Set((open?.docs || []).map((d) => d.db?.[field] || ''))];
  if (values.length > 1) return '차마다 다름';
  return values[0] || '없음';
};

// 계약사실 증명원에서 손으로 고칠 수 있는 칸 (서버 FACT_PARTY_FIELDS · FACT_VEHICLE_FIELDS와 같다)
export const FACT_PARTY_FIELDS = [
  ['name', '개인/법인명'], ['bizNo', '사업자번호'], ['corpNo', '법인번호'],
  ['address', '주소'], ['ceoName', '대표자명'], ['phone', '연락처']
];
export const FACT_VEHICLE_GROUPS = [
  ['차량', [['plateNo', '차량번호'], ['vin', '차대번호'], ['carModel', '대여차종'], ['color', '외장 색상'], ['options', '옵션사항']]],
  ['상품조건', [
    ['carPrice', '차량가격 (원)'], ['takeoverPrice', '인수가 (원)'], ['takeoverText', '인수가능여부'], ['mileage', '주행약정 (km)'],
    ['deposit', '보증금 (원)'], ['advancePayment', '선납금 (원)'], ['termMonths', '대여기간 (개월)'], ['monthlyFee', '월대여료 (원)'],
    ['earlyRate', '위약금률'], ['lateRate', '연체이율'], ['paymentDay', '대여료결제일'],
    ['deliveryDate', '차량인도일'], ['endDate', '계약종료일'], ['firstDueDate', '첫달 결제일']
  ]],
  ['정비', [['emergency', '긴급출동'], ['regularCheck', '검사정비'], ['generalMaintenance', '일반정비'], ['consumables', '소모품교환'], ['tireText', '타이어본수']]],
  ['보험', [['driverAge', '운전자 연령'], ['liability', '대인배상'], ['property', '대물배상'], ['personalInjury', '자기신체사고'], ['uninsured', '무보험차상해'], ['deductible', '고객부담금']]]
];
const NUMBER_FIELDS = new Set(['carPrice', 'takeoverPrice', 'mileage', 'deposit', 'advancePayment', 'termMonths', 'monthlyFee']);
const INSURANCE_FIELDS = new Set(['driverAge', 'liability', 'property', 'personalInjury', 'uninsured', 'deductible']);

/** 증명원 차 한 대의 칸 값(보험 칸은 insurance 안에 있다) */
export const factValueOf = (doc, key) => {
  const v = INSURANCE_FIELDS.has(key) ? doc?.insurance?.[key] : doc?.[key];
  return v === undefined || v === null ? '' : String(v);
};

const asValue = (key, v) => (NUMBER_FIELDS.has(key) ? Number(String(v).replace(/[^\d]/g, '')) || 0 : v);

/** 서버가 만든 증명원 값에 손으로 고친 값을 덮는다 */
export const applyFactEdits = (open, edits) => {
  if (!open) return open;
  const filled = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== ''));
  const party = { ...open.party, ...filled(edits?.party) };
  const docs = open.docs.map((d) => {
    const e = filled(edits?.vehicles?.[d.vehicleId]);
    const next = { ...d, insurance: { ...d.insurance } };
    Object.entries(e).forEach(([k, v]) => {
      if (INSURANCE_FIELDS.has(k)) next.insurance[k] = v;
      else next[k] = asValue(k, v);
    });
    // 인수가를 넣었는데 인수가능여부를 따로 안 고쳤으면 그에 맞춘다
    if (e.takeoverPrice !== undefined && e.takeoverText === undefined) next.takeoverText = next.takeoverPrice > 0 ? '만기시 선택' : '만기시 반납';
    return next;
  });
  return { ...open, party, docs };
};
