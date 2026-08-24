// 숫자만 남긴 뒤 000-00-00000(사업자번호) 형식으로 하이픈을 자동 삽입한다.
export const formatBizNo = (raw) => {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};
