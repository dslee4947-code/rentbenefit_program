/**
 * 공급가액(총 차량가) 계산.
 *
 *   공급가액 = 차량가 + 옵션가 + 탁송료 - 할인금액
 *
 * 견적서가 쓰는 식과 같다(QuoteInputView의 netVehiclePrice).
 * 예전에는 견적서에서 계산한 값을 그대로 받아 적기만 해서, 차량 DB에서 차량가나 할인금액을
 * 고치면 공급가액이 옛 값 그대로 남았다. 이제 저장할 때마다 여기서 다시 계산한다.
 */

const toNumber = (value) => {
  if (value === '' || value === null || value === undefined) return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

/**
 * @param {{carPrice?: number, optionPrice?: number, deliveryFee?: number, discount?: number}} price
 * @returns {number|undefined} 넷 다 비어 있으면 undefined(값 없음)를 그대로 둔다
 */
export const computeSupplyPrice = ({ carPrice, optionPrice, deliveryFee, discount } = {}) => {
  const parts = [carPrice, optionPrice, deliveryFee, discount];
  if (parts.every((v) => v === '' || v === null || v === undefined)) return undefined;

  return toNumber(carPrice) + toNumber(optionPrice) + toNumber(deliveryFee) - toNumber(discount);
};

/**
 * 판관비 칸에 비율이 들어온 경우 금액으로 바꾼다.
 *
 * 운영 엑셀의 판관비 칸에는 "3%"가 0.03으로 적혀 있어 그대로 저장됐고, 화면에 '0.03원'으로 보였다.
 * 1보다 작은 값은 금액일 수 없으므로(1원짜리 판관비는 없다) 비율로 보고 차량가에 곱한다.
 */
export const normalizeSellingAdminExpense = (payload) => {
  if (!payload) return payload;

  const rate = Number(payload.sellingAdminExpense);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) return payload;

  const carPrice = Number(payload.carPrice) || 0;
  const optionPrice = Number(payload.optionPrice) || 0;
  if (!carPrice && !optionPrice) return payload;

  payload.sellingAdminExpense = Math.round((carPrice + optionPrice) * rate);
  return payload;
};

/**
 * 차량 저장 값의 공급가액을 다시 계산해 넣는다.
 * 가격 항목이 하나도 안 넘어온 부분 수정에서는 건드리지 않는다.
 */
export const applySupplyPrice = (payload) => {
  if (!payload) return payload;

  const touched = ['carPrice', 'optionPrice', 'deliveryFee', 'discount']
    .some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (!touched) return payload;

  const supplyPrice = computeSupplyPrice(payload);
  if (supplyPrice !== undefined) payload.supplyPrice = supplyPrice;
  return payload;
};
