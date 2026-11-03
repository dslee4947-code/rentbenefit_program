/**
 * 개인 계약자의 주민등록번호는 앞 6자리(생년월일)만 받고 뒷자리는 가려서 찍는다(대표님 2026-11-03).
 * 서버 server/utils/personName.js maskResidentNo와 같은 규칙이다.
 */
export const maskResidentNo = (value) => {
  const m = /^\s*(\d{6})(?:\s*-?\s*[\d*]{1,7})?\s*$/.exec(String(value ?? ''));
  return m ? `${m[1]}-*******` : '';
};

/** 입력 중인 앞자리를 미리보기의 계약자 번호에 반영한다. 사업자번호가 있는 계약자(법인·개인사업자)는 그대로 */
export const partyWithResidentFront = (party, front) => (
  party?.personal && party.bizNoLabel === '주민등록번호' ? { ...party, bizNo: maskResidentNo(front) } : party
);
