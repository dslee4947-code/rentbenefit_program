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
