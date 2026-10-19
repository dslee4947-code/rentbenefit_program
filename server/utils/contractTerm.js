/**
 * 장기렌트 계약 기간의 시작일과 만기일.
 *
 * 기간은 차량을 등록하고 고객에게 인도한 날부터 흐른다. 계약일과는 상관없다(대표님 확인, 2026-10-06).
 * 출고가 계약보다 두세 달 늦는 일이 흔해서, 계약일로 세면 만기가 그만큼 앞당겨진다.
 * (예: 22040018 계약일 2022-04-14 · 인도 2022-06-27인데 만기가 2027-04-14로 잡혀 있었다)
 *
 * 연장 계약은 예외다. 연장은 앞 계약이 끝나는 날부터 이어지고 그 날을 계약일에 적는다.
 * 연장 계약의 인도일 칸에는 처음 인도한 날이 그대로 따라오므로(contractLifecycleController) 쓰면 안 된다.
 *
 * 만기일(endDate)은 '시작일 + 개월수'라 계약 기간 마지막 날의 다음 날이다.
 * 연장 시작일이 이 값을 그대로 쓰는 것과 맞춘 것이다(contractLifecycleController.defaultStartOf).
 *
 * DB를 읽지 않는 순수 함수만 둔다. Contract 모델의 pre-save 훅도 이 파일을 쓴다.
 */

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** 차량들 중 가장 먼저 인도한 날. 청구 회차표도 같은 기준이다(billingScheduleController.resolveScheduleInputs). */
export const earliestDeliveryOf = (vehicles = []) =>
  vehicles
    .map((v) => toDate(v?.deliveryDate))
    .filter(Boolean)
    .sort((a, b) => a - b)[0] || null;

/** 계약 기간이 시작되는 날. */
export const contractStartOf = (contract, vehicles = []) => {
  if (!contract) return null;
  if (contract.contractKind === '연장') return toDate(contract.contractDate);
  return earliestDeliveryOf(vehicles) || toDate(contract.deliveryDate) || toDate(contract.contractDate);
};

export const addTermMonths = (start, months) => {
  const term = Number(months);
  if (!start || !term) return null;
  const end = new Date(start);
  end.setMonth(end.getMonth() + term);
  return end;
};

/** 계약의 만기일. 차마다 인도일이 다르면 가장 먼저 인도한 차 기준이다. */
export const contractEndOf = (contract, vehicles = []) =>
  addTermMonths(contractStartOf(contract, vehicles), contract?.termMonths);

/**
 * 차량 한 대의 만기일. 같은 계약이라도 차마다 인도일이 다르다
 * (예: 22020006은 2022-02-03부터 03-01까지 나눠 인도했다).
 */
export const vehicleEndOf = (contract, vehicle) => {
  if (contract?.contractKind === '연장') return contractEndOf(contract);
  return addTermMonths(toDate(vehicle?.deliveryDate) || contractStartOf(contract), contract?.termMonths);
};
