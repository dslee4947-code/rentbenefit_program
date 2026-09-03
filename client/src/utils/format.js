// 숫자만 남긴 뒤 000-00-00000(사업자번호) 형식으로 하이픈을 자동 삽입한다.
export const formatBizNo = (raw) => {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};

// 개인(사업자등록 없음) 식별번호 입력 포맷터.
// 주민등록번호 뒷자리는 성별 구분 한 자리까지만 받는다(예: 950101-1).
// 뒷자리 전체는 보관할 이유가 없고, 남겨 두면 유출 시 피해가 커진다.
export const formatPersonalIdPrefix = (raw) => {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 7);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
};

// 법인등록번호 (000000-0000000, 13자리) 입력 포맷터. 사업자번호와 자릿수 구성이 달라 별도 처리.
export const formatCorporateRegistrationNo = (raw) => {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
};

// 가격 입력 필드에 보여줄 때 천 단위 콤마를 넣는다 (예: 1234567 -> "1,234,567").
export const toCommaString = (num) => {
  if (num === undefined || num === null || num === '' || isNaN(num)) return '';
  return Math.round(Number(num)).toLocaleString('ko-KR');
};

// 콤마가 섞인 입력값에서 숫자만 뽑아낸다 (예: "1,234,567원" -> 1234567).
export const parseNumber = (val) => {
  if (typeof val === 'number') return val;
  if (!val) return '';
  const num = Number(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? '' : num;
};

// 월 대여료 결제일로 실제 쓰는 날짜.
//
// 말일은 '몇 일'로 못 박을 수 없다. 2월은 28(29)일, 어떤 달은 30일, 어떤 달은 31일이라
// 달마다 실제 결제일이 달라지기 때문이다.
// 그래서 숫자로 바꾸지 않고 '말일'이라는 값 그대로 저장한다.
// (예전에는 31로 저장했는데, 2월에는 없는 날짜라 실제 날짜를 계산하는 순간 어긋난다)
export const PAYMENT_DAY_LAST = '말일';

export const PAYMENT_DAY_OPTIONS = [
  { value: '5', label: '5일' },
  { value: '10', label: '10일' },
  { value: '15', label: '15일' },
  { value: '25', label: '25일' },
  { value: PAYMENT_DAY_LAST, label: '말일' }
];

// 저장된 결제일을 화면에 보여줄 말로 바꾼다.
// 예전에 31로 저장된 값도 '말일'로 읽어 준다.
export const formatPaymentDay = (day) => {
  if (day === '' || day === null || day === undefined) return '';
  if (String(day) === PAYMENT_DAY_LAST || String(day) === '31') return '말일';
  const matched = PAYMENT_DAY_OPTIONS.find((o) => String(o.value) === String(day));
  return matched ? matched.label : `${day}일`;
};

/**
 * 결제일 설정을 특정 달의 실제 날짜로 바꾼다.
 *
 * '말일'이면 그 달의 마지막 날(2월이면 28 또는 29)을 돌려준다.
 * 일반 날짜라도 그 달에 없는 날이면(예: 31일 설정에 2월) 그 달 마지막 날로 당겨 준다.
 * new Date(2026, 1, 31)처럼 그냥 넘기면 3월로 넘어가 버리므로 반드시 이 함수를 쓴다.
 *
 * 시각을 정오(12:00)로 맞추는 이유:
 * 자정으로 만들면 UTC로 저장될 때 한국 시간(+9)만큼 당겨져 전날이 된다.
 * (2026-02-28 00:00 KST -> 2026-02-27T15:00Z) 이 코드베이스는 날짜를 화면에 낼 때
 * String(date).slice(0, 10)처럼 앞 10자를 쓰는 곳이 많아, 그대로 두면 하루 전 날짜가 보인다.
 * 정오로 두면 어느 쪽으로 9시간이 밀려도 날짜가 바뀌지 않는다.
 *
 * @param {number} year 연도
 * @param {number} monthIndex 0부터 시작하는 월 (0 = 1월)
 * @param {string|number} paymentDay 저장된 결제일 설정
 * @returns {Date|null} 실제 결제일
 */
export const resolvePaymentDate = (year, monthIndex, paymentDay) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  if (paymentDay === '' || paymentDay === null || paymentDay === undefined) return null;
  if (String(paymentDay) === PAYMENT_DAY_LAST || String(paymentDay) === '31') {
    return new Date(year, monthIndex, lastDay, 12);
  }
  const day = Number(paymentDay);
  if (!day) return null;
  return new Date(year, monthIndex, Math.min(day, lastDay), 12);
};

// 고객 검색/선택 UI에서 "성 이름" 형태로 통일해서 보여준다.
// 아웃룩 연동 고객은 surname/givenName이 실제 사람 이름이고, name은 "차량정보"
// 필드(회사 P)가 비어있을 때 표시 방법(E)에서 파생된 값이라 사람 이름 표시에는
// 부적합하다. 수동 등록 고객은 surname/givenName이 없으므로 name으로 대체한다.
export const formatCustomerName = (c) => {
  if (!c) return '-';
  const surname = c.surname || c.name || '-';
  const givenName = c.givenName || '';
  return givenName ? `${surname} ${givenName}` : surname;
};

// 견적 화면은 값이 없을 때 '-'를 넣어 두는 자리가 있다. 그 표기는 화면용이라 계약서로 넘기지 않는다.
export const cleanSpecValue = (v) => {
  const s = String(v ?? '').trim();
  return s === '-' ? '' : s;
};

// 견적서에 저장된 차량 세부 항목(유종/배기량/납기/외장·내장 색상)을 꺼낸다.
// vehicleDetail이 정본이고, 그 필드가 생기기 전에 저장된 견적서는
// "옵션명 / 연료: .. / 배기량: ..cc / 납기: .. / 외장: .. / 내장: .." 형태의
// vehicleSpec 문자열에서 되살린다. 값이 없는 항목은 undefined로 둔다.
export const extractQuoteVehicleDetail = (quote) => {
  const detail = quote?.vehicleDetail || {};
  const parsed = {};
  (quote?.vehicleSpec || '').split(' / ').forEach((part) => {
    if (part.startsWith('연료: ')) parsed.fuelType = part.replace('연료: ', '');
    else if (part.startsWith('배기량: ')) parsed.cc = part.replace('배기량: ', '').replace('cc', '');
    else if (part.startsWith('납기: ')) parsed.deliveryPeriod = part.replace('납기: ', '');
    else if (part.startsWith('외장: ')) parsed.exteriorColor = part.replace('외장: ', '');
    else if (part.startsWith('내장: ')) parsed.interiorColor = part.replace('내장: ', '');
  });

  const pick = (key) => cleanSpecValue(detail[key]) || cleanSpecValue(parsed[key]);
  const cc = Number(pick('cc'));

  return {
    fuelType: pick('fuelType') || undefined,
    cc: cc > 0 ? cc : undefined,
    deliveryPeriod: pick('deliveryPeriod') || undefined,
    exteriorColor: pick('exteriorColor') || undefined,
    interiorColor: pick('interiorColor') || undefined
  };
};
