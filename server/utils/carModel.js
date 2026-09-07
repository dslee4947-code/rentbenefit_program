/**
 * 차종과 사양을 한 칸으로 합친다.
 *
 * 렌트차량 DB는 '차량'과 '사양'을 따로 두고 있었는데, 실제로는 "G80 3.5T AWD"처럼
 * 둘을 붙여야 한 대를 가리킬 수 있어 두 칸을 오가며 보게 됐다. 차량 한 칸으로 합친다.
 *
 * 계약서(Contract)는 사양을 따로 들고 있어야 서류에 나눠 찍을 수 있으므로 그대로 두고,
 * 차량 문서(Vehicle)에 넣을 때만 합친다.
 */

/**
 * @param {string} carModel 차종 "G80"
 * @param {string} carSpec  사양 "3.5T AWD"
 * @returns {string} "G80 3.5T AWD"
 */
export const mergeCarModel = (carModel, carSpec) => {
  const model = String(carModel ?? '').trim();
  let spec = String(carSpec ?? '').trim();

  // 사양 칸을 '-'로 비워 둔 자료가 있다. 화면에 "S500 -"이 되지 않게 빈 값으로 본다.
  if (spec === '-' || spec === '--') spec = '';

  if (!spec) return model;
  if (!model) return spec;
  // 이미 사양까지 적어 둔 차종이면 두 번 붙이지 않는다
  if (model.includes(spec)) return model;

  return `${model} ${spec}`;
};
