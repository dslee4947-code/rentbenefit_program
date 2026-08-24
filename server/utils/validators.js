// 공통 필드 검증기 모음.

// 한국 주민등록번호 형식: 숫자 6자리 - 숫자 7자리 (예: 680215-1234567)
// 사업자등록번호 형식(3-2-5, 000-00-00000)과는 자릿수 구성이 달라 서로 겹치지 않는다.
export const RESIDENT_REGISTRATION_NUMBER_PATTERN = /^\d{6}-\d{7}$/;

// 사업자등록번호 형식: 000-00-00000
export const BUSINESS_REGISTRATION_NUMBER_PATTERN = /^\d{3}-\d{2}-\d{5}$/;

// bizNo류 필드(사업자번호 자리에 실수로 주민등록번호가 들어가면 안 되는 필드)에
// 붙이는 검증기. 값이 없으면 통과(선택 필드), 있으면 주민등록번호 형식만 거부한다
// (정확한 사업자번호 형식까지 강제하지는 않음 - 기존 데이터 중 형식이 다른 값이 있을 수 있음).
export const rejectResidentRegistrationNumber = {
  validator: function (v) {
    if (!v) return true;
    return !RESIDENT_REGISTRATION_NUMBER_PATTERN.test(v);
  },
  message: (props) => `"${props.value}"는 주민등록번호 형식으로 보입니다. 사업자번호 자리에는 저장할 수 없습니다. (사업자번호는 000-00-00000 형식)`,
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
