// 공통 필드 검증기 모음.

// 한국 주민등록번호 형식: 숫자 6자리 - 숫자 7자리 (예: 680215-1234567)
export const RESIDENT_REGISTRATION_NUMBER_PATTERN = /^\d{6}-\d{7}$/;

// 사업자등록번호 형식: 000-00-00000
export const BUSINESS_REGISTRATION_NUMBER_PATTERN = /^\d{3}-\d{2}-\d{5}$/;

/**
 * 값이 실제 주민등록번호로 보이는지 판단한다.
 *
 * 법인등록번호도 000000-0000000으로 자릿수 구성이 주민등록번호와 똑같다(예: 134611-0141189).
 * 그래서 자릿수만 보고 거르면 멀쩡한 법인등록번호까지 저장이 막힌다.
 *
 * 세 가지를 모두 만족할 때만 주민등록번호로 본다.
 *   1) 6자리-7자리 형식
 *   2) 앞 6자리가 생년월일(YYMMDD)로 읽힘
 *   3) 마지막 검증숫자가 주민등록번호 규칙에 맞음
 *
 * 이 검증기의 목적은 "실제 주민등록번호가 엉뚱한 칸에 저장되는 것"을 막는 것이므로,
 * 검증숫자가 맞지 않는 값은 주민등록번호가 아니라고 보고 통과시킨다.
 * (예: 법인등록번호 110111-8045472는 11월 01일로 읽히지만 검증숫자가 맞지 않는다)
 *
 * @param {string} value 검사할 값
 * @returns {boolean} 실제 주민등록번호로 보이면 true
 */
export const looksLikeResidentRegistrationNumber = (value) => {
  const matched = /^(\d{2})(\d{2})(\d{2})-(\d)(\d{6})$/.exec(value || '');
  if (!matched) return false;

  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // 검증숫자: 앞 12자리에 2~9,2~5 가중치를 곱해 더한 뒤 11로 나눈 나머지로 계산한다
  const digits = value.replace('-', '').split('').map(Number);
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const sum = weights.reduce((acc, weight, index) => acc + digits[index] * weight, 0);
  const checkDigit = (11 - (sum % 11)) % 10;

  return checkDigit === digits[12];
};

// bizNo류 필드(사업자번호 자리에 실수로 주민등록번호가 들어가면 안 되는 필드)에
// 붙이는 검증기. 값이 없으면 통과(선택 필드), 있으면 주민등록번호만 거부한다
// (정확한 사업자번호 형식까지 강제하지는 않음 - 기존 데이터 중 형식이 다른 값이 있을 수 있음).
export const rejectResidentRegistrationNumber = {
  validator: function (v) {
    if (!v) return true;
    return !looksLikeResidentRegistrationNumber(v);
  },
  message: (props) => `"${props.value}"는 주민등록번호로 보입니다. 이 칸에는 저장할 수 없습니다. (사업자번호는 000-00-00000 형식)`,
};

// 사업자번호 필드에 정확한 형식(000-00-00000)을 강제할 때 쓰는 검증기.
// 값이 없으면 통과(선택 필드).
export const requireBusinessRegistrationNumberFormat = {
  validator: function (v) {
    if (!v) return true;
    return BUSINESS_REGISTRATION_NUMBER_PATTERN.test(v);
  },
  message: (props) => `"${props.value}"는 올바른 사업자번호 형식이 아닙니다. (000-00-00000 형식)`,
};
