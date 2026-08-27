// 숫자만 남긴 뒤 000-00-00000(사업자번호) 형식으로 하이픈을 자동 삽입한다.
export const formatBizNo = (raw) => {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};

// 법인등록번호 (000000-0000000, 13자리) 입력 포맷터. 사업자번호와 자릿수 구성이 달라 별도 처리.
export const formatCorporateRegistrationNo = (raw) => {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
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
