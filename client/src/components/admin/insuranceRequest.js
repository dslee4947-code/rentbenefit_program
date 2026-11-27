// 출고 준비 > 보험 가입 요청 문구.
//
// 보험방(카카오톡)에 보내던 양식을 차량 정보로 채운다. 매번 옮겨 적다 차대번호·금액을 틀리는 일을 없앤다.
// 고객명은 보험 계약자인 우리 회사다(차량 소유자). 빈 값은 칸만 남겨 두어 보내기 전에 채울 수 있게 한다.

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const won = (n) => (Number(n) > 0 ? Number(n).toLocaleString() : '');

/** '2026-11-27' → '2026-11-27(금)' */
export const dateWithWeekday = (ymd) => {
  if (!ymd) return '';
  const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(ymd) : `${String(ymd).slice(0, 10)}(${WEEKDAYS[d.getDay()]})`;
};

/** 임직원 → '임직원으로', 누구나 → '누구나로' (받침이 없거나 ㄹ이면 '로') */
export const withRo = (word) => {
  const w = String(word || '').trim();
  const code = w.charCodeAt(w.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${w}(으)로`;
  const jong = code % 28;
  return `${w}${jong === 0 || jong === 8 ? '로' : '으로'}`;
};

/** '만26세이상' → '만 26세 이상' (보험방에 보내던 표기) */
const ageText = (v) => String(v || '').replace(/만\s*(\d+)\s*세\s*이상/, '만 $1세 이상').trim();

/**
 * 차량 정보로 입력칸 기본값을 만든다. 화면에서 고친 뒤 buildInsuranceRequest로 문구를 만든다.
 *
 * @param {object} vehicle 렌트차량 DB 차량
 * @param {{vin?: string, registrationDate?: string}} form 출고 준비 입력값(아직 저장 안 했을 수 있다)
 */
export const insuranceRequestDefaults = (vehicle = {}, form = {}) => {
  const ins = vehicle.insurance || {};
  const base = Number(vehicle.carPrice) || 0;
  const option = Number(vehicle.optionPrice) || 0;
  return {
    customerName: '주식회사 렌트베네핏',
    vin: form.vin || vehicle.vin || '',
    carModel: vehicle.carModel || '',
    basePrice: base || '',
    optionPrice: option || '',
    options: vehicle.options || '',
    exteriorColor: vehicle.exteriorColor || '',
    interiorColor: vehicle.interiorColor || '',
    totalPrice: base + option || '',
    driverAge: ageText(ins.driverAge) || '만 26세 이상',
    propertyLimit: ins.propertyLimit || '',
    personalInjury: ins.personalInjury || '',
    uninsuredInjury: ins.uninsuredInjury || '',
    registrationDate: form.registrationDate || (vehicle.registrationDate ? String(vehicle.registrationDate).slice(0, 10) : ''),
    driverRange: ins.driverRange || '임직원'
  };
};

/**
 * 보험방에 보낼 문구.
 * @param {ReturnType<typeof insuranceRequestDefaults>} f
 * @returns {string}
 */
export const buildInsuranceRequest = (f) => {
  const conditions = [
    f.driverAge,
    f.propertyLimit && `대물 ${f.propertyLimit}`,
    f.personalInjury && `자기신체사고 ${f.personalInjury}`,
    f.uninsuredInjury && `무보험차상해 ${f.uninsuredInjury}`
  ].filter(Boolean).join(' / ');

  return [
    `- 고객명 : ${f.customerName || ''}`,
    `- 차대번호 : ${f.vin || ''}`,
    `- 차종 : ${f.carModel || ''}`,
    '',
    `1)\t차량기본금액 : ${won(f.basePrice)}`,
    `2)\t옵션금액(옵션+파츠+색상) : ${won(f.optionPrice)}`,
    ` - 옵션 : ${f.options || ''}`,
    ` - 외장 : ${f.exteriorColor || ''}`,
    ` - 내장 : ${f.interiorColor || ''}`,
    `3)\t총가격 : ${won(f.totalPrice)}`,
    '',
    `- ${conditions}`,
    `- 등록일자 : ${dateWithWeekday(f.registrationDate)}`,
    '',
    `이거는 ${withRo(f.driverRange || '임직원')} 요청드립니다.`,
    '보험가입요청드립니다.'
  ].join('\n');
};
