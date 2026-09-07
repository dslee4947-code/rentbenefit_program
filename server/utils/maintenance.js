/**
 * 정비 서비스 가입 여부.
 *
 * 일반정비에 가입하면 순회정비·소모품교환도 함께 가입되는 상품이다.
 * 세 칸을 따로 두면 같은 계약인데 칸마다 값이 어긋나고, '정비가입'이라는 칸까지 있어
 * 무엇이 정본인지 알 수 없었다. 일반정비 하나를 기준으로 삼고 나머지는 여기서 맞춘다.
 */

export const JOINED = '가입';
export const NOT_JOINED = '미가입';

/**
 * 일반정비 값에 맞춰 정비 항목을 정리한다.
 * @param {object} maintenance 차량의 maintenance 값
 * @returns {object} 타이어등급·주행거리는 그대로 두고 가입 여부만 맞춘 새 값
 */
export const normalizeMaintenance = (maintenance = {}) => {
  const joined = String(maintenance.generalMaintenance ?? '').trim() === JOINED;
  const value = joined ? JOINED : NOT_JOINED;

  return {
    ...maintenance,
    // enabled는 화면에서 없앤 '정비가입' 칸이다. 예전 자료·계약서가 아직 읽으므로 값은 맞춰 둔다.
    enabled: joined,
    regularCheck: value,
    consumables: value,
    generalMaintenance: value
  };
};

// 서류에 적은 금액이 어느 청구 항목으로 가는지.
//
// 정비내역만 '정기점검/정비'로 가고, 나머지는 모두 '범칙금/과태료'로 묶는다.
// 이름을 목록에서 고르지 않고 직접 적을 수 있어서(주차위반, 견인료 등),
// 정해진 이름 목록으로 판정하면 새로 적은 이름은 금액이 어디에도 안 들어간다.
export const MAINTENANCE_KINDS = ['정비내역', '정비'];

/**
 * 이 서류가 정비 건인지.
 * @param {string} kind 서류 종류
 * @returns {boolean}
 */
export const isMaintenanceKind = (kind) => MAINTENANCE_KINDS.includes(String(kind || '').trim());
