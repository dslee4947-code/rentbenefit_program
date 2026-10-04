/**
 * 차종 등급별 정비 단가표.
 *
 * 예전에는 정비 항목 18개의 금액이 모든 차종에 같아서 G80과 코나가 같은 정비비·타이어 값으로 견적이 나갔다.
 * 실제 원장을 보면 G90·S클래스 타이어는 견적(4본 64만 원)의 2~4배였다.
 * 그래서 등급마다 항목별 1회 단가를 두고, 계약 기간·주행거리에 따라 몇 번 하는지를 곱해 정비 원가를 낸다.
 *
 * 여기 값은 처음 시작할 때 쓰는 기본값이다. 관리자가 '정비 단가표' 화면에서 실제 단가표로 고치면
 * 그 값(설정 maintenanceRates)이 이 기본값보다 먼저 쓰인다.
 * 견적서에는 견적을 낸 그때의 단가가 함께 저장되므로, 나중에 단가표를 고쳐도 지난 견적 숫자는 바뀌지 않는다.
 *
 * 근거(SOURCES)는 각 값 옆에 남긴다. 근거 없는 숫자는 맞는지 틀린지 검토할 수가 없다.
 */

export const MAINTENANCE_RATES_VERSION = '2026-10-04 초기값';

// 차종 등급 (2026-10-04 대표님 결정: 7등급)
export const VEHICLE_GRADES = [
  { key: 'compact', label: '경차', examples: '레이, 모닝, 캐스퍼' },
  { key: 'small', label: '준중형', examples: '아반떼, K3' },
  { key: 'mid', label: '중형', examples: '쏘나타, K5' },
  { key: 'large', label: '대형 세단', examples: '그랜저, K8, K9, G80, G90' },
  { key: 'suv', label: 'SUV', examples: '코나, 스포티지, 쏘렌토, 팰리세이드, GV70, GV80, 카니발' },
  { key: 'import', label: '수입 프리미엄', examples: '벤츠, BMW, 아우디, 렉서스, 알파드' },
  { key: 'ev', label: '전기차', examples: '아이오닉, EV6, 코나 일렉트릭, 테슬라' }
];
export const GRADE_LABEL = Object.fromEntries(VEHICLE_GRADES.map((g) => [g.key, g.label]));

/**
 * 정비 항목. basis는 횟수를 세는 기준이다.
 *   km: 계약 기간 총 주행거리 ÷ cycleKm 번 (5만km 계약에 1만km 주기면 5번)
 *   months: 계약 개월 수 ÷ cycleMonths 번 (48개월에 12개월 주기면 4번)
 * 타이어 교체는 여기 넣지 않는다. 본수는 getTireCount(5만km마다 4본), 1본 가격은 등급의 tire 값을 쓴다.
 */
export const MAINTENANCE_ITEMS = [
  { key: 'regularCheck', name: '정기점검·엔진오일', basis: 'km', cycleKm: 10000, desc: '순회정비(카랑) 방문 1회. 엔진오일·오일필터·에어클리너 포함' },
  { key: 'acFilter', name: '에어컨 필터', basis: 'months', cycleMonths: 12, desc: '향균필터' },
  { key: 'wiper', name: '와이퍼', basis: 'months', cycleMonths: 12, desc: '앞 와이퍼 1세트' },
  { key: 'tireRotation', name: '타이어 위치 교환', basis: 'km', cycleKm: 20000, desc: '로테이션·휠 밸런스' },
  { key: 'brakeFront', name: '앞 브레이크 패드', basis: 'km', cycleKm: 40000, desc: '좌우 1세트, 공임 포함' },
  { key: 'brakeRear', name: '뒤 브레이크 패드·라이닝', basis: 'km', cycleKm: 60000, desc: '좌우 1세트, 공임 포함' },
  { key: 'transmissionOil', name: '변속기·브레이크 오일', basis: 'km', cycleKm: 60000, desc: '전기차는 감속기 오일' },
  { key: 'battery', name: '배터리', basis: 'months', cycleMonths: 48, desc: '전기차는 12V 보조배터리' },
  { key: 'sparkPlug', name: '점화플러그', basis: 'km', cycleKm: 80000, desc: '전기차·디젤은 해당 없음(0원)' },
  { key: 'coolant', name: '부동액·냉각수', basis: 'km', cycleKm: 100000, desc: '전기차는 배터리 냉각수' }
];
export const TIRE_ITEM_NAME = '타이어 교체';

/**
 * 등급별 1회 단가(원)와 타이어 1본 가격.
 * 원장 = 렌트베네핏 차량 손익 원장 실적(2026-10-04 운영 DB 조회). 시세 = 아래 SOURCES의 공개 자료.
 */
export const DEFAULT_MAINTENANCE_RATES = {
  version: MAINTENANCE_RATES_VERSION,
  grades: {
    compact: {
      items: { regularCheck: 56000, acFilter: 30000, wiper: 25000, tireRotation: 20000, brakeFront: 70000, brakeRear: 60000, transmissionOil: 100000, battery: 150000, sparkPlug: 60000, coolant: 70000 },
      tire: { standard: 75000, premium: 100000 },
      basis: '정기점검: 원장 레이 카랑 56,000원(6건). 타이어: 원장 레이 4본 285,000~300,000원(1본 약 7.5만). 엔진오일 시세 경차 6~7만(오토큐).'
    },
    small: {
      items: { regularCheck: 65000, acFilter: 35000, wiper: 25000, tireRotation: 20000, brakeFront: 100000, brakeRear: 80000, transmissionOil: 120000, battery: 170000, sparkPlug: 80000, coolant: 80000 },
      tire: { standard: 100000, premium: 150000 },
      basis: '정기점검: 원장 K3 59,500~67,000원. 브레이크: 시세 K3 앞뒤 9~16만. 배터리: 원장 K3 222,200원.'
    },
    mid: {
      items: { regularCheck: 75000, acFilter: 40000, wiper: 30000, tireRotation: 25000, brakeFront: 120000, brakeRear: 100000, transmissionOil: 150000, battery: 200000, sparkPlug: 100000, coolant: 90000 },
      tire: { standard: 130000, premium: 190000 },
      basis: '정기점검: 원장 K5(H) 카랑, 시세 K5 엔진오일 10~12만(오토큐). 브레이크: 시세 국산 승용 앞 7~16만. 타이어: 원장 K8 4본 506,000원(1본 약 12.7만).'
    },
    large: {
      items: { regularCheck: 85000, acFilter: 50000, wiper: 35000, tireRotation: 30000, brakeFront: 180000, brakeRear: 150000, transmissionOil: 180000, battery: 230000, sparkPlug: 150000, coolant: 100000 },
      tire: { standard: 270000, premium: 350000 },
      basis: '정기점검: 원장 G80 86,000원·K9 80,619원·K8 68,000~78,320원. 타이어: 원장 G80 4본 970,000원, G90 1,130,000~1,490,000원, K9 1,200,000원(1본 24~37만). 배터리: 원장 국산 약 22만.'
    },
    suv: {
      items: { regularCheck: 90000, acFilter: 45000, wiper: 35000, tireRotation: 30000, brakeFront: 180000, brakeRear: 150000, transmissionOil: 180000, battery: 230000, sparkPlug: 150000, coolant: 100000 },
      tire: { standard: 180000, premium: 260000 },
      basis: '정기점검: 원장 모하비 91,300원, 시세 쏘렌토·카니발 엔진오일 13~15만. 브레이크: 시세 국산 SUV 앞 10~22만. 타이어: 원장 모하비 4본+점검 1,308,530원. GV80·팰리세이드 같은 대형 SUV는 더 비쌀 수 있어 견적에서 확인.'
    },
    import: {
      items: { regularCheck: 300000, acFilter: 120000, wiper: 60000, tireRotation: 50000, brakeFront: 400000, brakeRear: 350000, transmissionOil: 400000, battery: 360000, sparkPlug: 300000, coolant: 200000 },
      tire: { standard: 280000, premium: 450000 },
      basis: '엔진오일·필터: 원장 E350 325,970원, S400d 657,800원, 시세 수입차 20~30만. 브레이크: 시세 수입차 앞 20~60만. 배터리: 원장 S400d 360,000원·S500 350,000원. 타이어: 원장 S클래스 4본 1,000,000~1,060,000원(1본 25~27만, 1본만 52~72만인 건도 있음).'
    },
    ev: {
      items: { regularCheck: 65000, acFilter: 40000, wiper: 30000, tireRotation: 25000, brakeFront: 120000, brakeRear: 100000, transmissionOil: 100000, battery: 150000, sparkPlug: 0, coolant: 120000 },
      overrides: { brakeFront: { cycleKm: 60000 }, brakeRear: { cycleKm: 80000 } },
      tire: { standard: 150000, premium: 220000 },
      basis: '정기점검: 원장 아이오닉6 카랑 65,000원(엔진오일 없음). 회생제동으로 브레이크 교체 주기를 늘려 잡음. 점화플러그 없음. 전기차 전용 타이어는 같은 급 내연기관보다 비싸게 잡음.'
    }
  },
  sources: [
    '렌트베네핏 차량 손익 원장 179장 실제 지출 (2026-10-04 조회)',
    '기아 오토큐 엔진오일 교환 가격: https://normen.co.kr/informative-information/기아-오토큐-엔진오일-교환-가격',
    '엔진오일 교체 비용 정리(2026): https://kfzautohaus.com/blog/자동차-엔진-오일-교체-비용',
    '브레이크 패드 교체 비용 2026: https://car.finance-information.net/brake-pad-replacement-cost-2026',
    '브레이크 패드 교체 비용(국산·수입): https://brunch.co.kr/@241a534def2b4cf/1021'
  ]
};

// 차종 이름으로 등급을 고른다. 못 고르면 null을 돌려주고, 견적 화면에서 사람이 고르게 한다.
const GRADE_RULES = [
  // "니로 HEV"(하이브리드)가 전기차로 잡히지 않게 EV는 단어 처음에서만 본다
  ['ev', /전기|\bEV\d*\b|아이오닉|ioniq|일렉트릭|electric|테슬라|tesla|model\s*[sy3x]\b|타이칸|\beq[a-z]\b|e-?tron|폴스타|polestar/i],
  ['import', /벤츠|benz|mercedes|bmw|아우디|audi|렉서스|lexus|포르쉐|porsche|볼보|volvo|알파드|alphard|마이바흐|maybach|\bG\s?63\b|\b(?:S|E|C|CLE|CLS|GLA|GLB|GLC|GLE|GLS)\s?\d{3}|\b[XM]\d\b|\b[1-8]\s?시리즈|\bES\s?\d{3}|\bRX\s?\d{3}|\bNX\s?\d{3}/i],
  ['compact', /레이|ray|모닝|morning|캐스퍼|casper|스파크|spark/i],
  ['suv', /코나|kona|cona|셀토스|seltos|니로|niro|스포티지|sportage|투싼|tucson|쏘렌토|sorento|싼타페|santa\s?fe|팰리세이드|펠리세이드|palisade|모하비|mojave|mohave|GV60|GV70|GV80|카니발|carnival|토레스|qm6|트랙스|트레일블레이저/i],
  ['large', /그랜저|그랜져|grander|grandeur|K8|K9|G80|G90|EQ900|스팅어|stinger/i],
  ['mid', /쏘나타|소나타|sonata|K5|SM6|말리부|malibu/i],
  ['small', /아반떼|avante|K3|i30|SM3/i]
];

export const detectVehicleGrade = ({ carModel, fuelType } = {}) => {
  if (/전기|수소/.test(String(fuelType || ''))) return 'ev';
  const name = String(carModel || '');
  if (!name.trim()) return null;
  const hit = GRADE_RULES.find(([, rx]) => rx.test(name));
  return hit ? hit[0] : null;
};

// 저장된 단가표(관리자 수정본)를 기본값 위에 얹는다. 저장본에 빠진 등급·항목은 기본값으로 채운다.
export const mergeMaintenanceRates = (saved) => {
  const base = DEFAULT_MAINTENANCE_RATES;
  const grades = {};
  for (const { key } of VEHICLE_GRADES) {
    const d = base.grades[key];
    const s = saved?.grades?.[key] || {};
    grades[key] = {
      items: { ...d.items, ...(s.items || {}) },
      overrides: { ...(d.overrides || {}), ...(s.overrides || {}) },
      tire: { ...d.tire, ...(s.tire || {}) },
      basis: s.basis ?? d.basis
    };
  }
  return { version: saved?.version || base.version, grades, sources: saved?.sources || base.sources };
};

const cycleText = (item) => (item.basis === 'km'
  ? `${(item.cycleKm / 10000).toLocaleString('ko-KR')}만km마다`
  : `${item.cycleMonths}개월마다`);

/**
 * 견적의 정비 내역 표에 넣을 줄을 단가표에서 만든다.
 * unitPrice와 basis가 있는 줄은 계산할 때 계약 기간·주행거리로 횟수를 세어 금액을 낸다(getMaintenanceBreakdown).
 * gradeKey가 단가표에 없으면 null.
 */
export const buildMaintenanceItemsFromRates = (rates, gradeKey) => {
  const grade = rates?.grades?.[gradeKey];
  if (!grade) return null;
  const items = MAINTENANCE_ITEMS.map((def) => {
    const item = { ...def, ...(grade.overrides?.[def.key] || {}) };
    const unitPrice = Number(grade.items?.[def.key]) || 0;
    return {
      key: def.key,
      name: def.name,
      cycle: cycleText(item),
      desc: def.desc,
      basis: item.basis,
      cycleKm: item.cycleKm,
      cycleMonths: item.cycleMonths,
      unitPrice,
      price: 0,
      // 단가가 0원인 항목(전기차 점화플러그 등)은 처음부터 꺼 둔다
      checked: unitPrice > 0
    };
  });
  items.push({ key: 'tire', name: TIRE_ITEM_NAME, cycle: '5만km마다 4본', desc: '타이어 마모 한계 도래 시 교체', price: 0, checked: true });
  return items;
};
