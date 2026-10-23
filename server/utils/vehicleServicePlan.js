/**
 * 차량마다 다음 자동차검사·정기점검이 언제인지 계산한다.
 *
 * DB를 읽지 않는 순수 함수만 둔다. 화면(GET /api/vehicle-services/plan), 매일 캘린더를 맞추는 작업,
 * 확인용 스크립트(scripts/vehicle-service-plan-check.js)가 모두 같은 답을 내야 해서 한곳에 모았다.
 *
 * 날짜는 모두 한국 날짜('YYYY-MM-DD')로 바꿔서 센다. 운영 서버는 UTC로 도는데,
 * DB에 한국 자정으로 저장된 날짜(전날 15:00Z)를 그대로 쓰면 하루씩 당겨진다.
 */

/**
 * 법정 자동차검사 주기 (사업용 대여 승용차 기준).
 *
 * 대표님 결정(2026-10): 최초등록일부터 2년 뒤 첫 검사, 그 뒤로 1년마다.
 * 검사 기간은 검사일(유효기간 만료일) 2개월 전부터 1개월 뒤까지 석 달이다(대표님 2026-10-19).
 * 회사 방침은 검사일 전에 끝내는 것이다. 검사일이 지나면 남은 1개월은 유예로 보고 따로 알린다.
 * 법 조항(자동차관리법 시행규칙 별표15의2)으로 한 번 더 확인해야 하는 값이라 숫자를 여기에만 둔다.
 * 승합·화물·경차 등 차종에 따라 달라지면 이 묶음만 고치면 된다.
 */
export const INSPECTION_RULE = Object.freeze({
  firstAfterMonths: 24, // 최초등록일부터 첫 검사까지
  everyMonths: 12, // 그 뒤 검사 주기
  windowBeforeMonths: 2, // 검사 기간: 검사일 전
  windowAfterMonths: 1 // 검사 기간: 검사일 후. 이 날이 지나면 과태료 대상이다
});

/**
 * 정기점검 주기 (일반정비 '가입' 차량만).
 *
 * 1만 km마다 점검한다. 주행거리 기록이 아직 없어서 연간 약정 주행거리로 월 주행을 어림한다.
 * 약정 2만 km면 월 1,667km → 6개월, 3만 km면 4개월, 4만 km면 3개월.
 * 너무 짧거나 길게 나오지 않게 2~12개월로 묶는다.
 */
export const MAINTENANCE_RULE = Object.freeze({
  everyKm: 10000,
  defaultAnnualKm: 20000, // 약정 주행거리가 비어 있는 차
  minMonths: 2,
  maxMonths: 12
});

// 이 날수 안으로 들어오면 '30일 이내'로 묶어 미리 챙기게 한다
export const SOON_DAYS = 30;

export const SERVICE_KINDS = ['자동차검사', '정기점검', '고장수리', '사고수리', '소모품교환', '기타'];
// 누적 수리비에 넣는 종류. 검사·점검은 정해진 비용이라 고장·사고와 섞으면 차의 상태가 안 보인다.
export const REPAIR_KINDS = ['고장수리', '사고수리'];

const DAY = 24 * 60 * 60 * 1000;
const KST_OFFSET = 9 * 60 * 60 * 1000;

/**
 * 날짜를 한국 날짜 문자열로.
 * @param {Date|string|number} d
 * @returns {string} 'YYYY-MM-DD', 날짜가 아니면 ''
 */
export const kstYmd = (d) => {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return '';
  return new Date(t + KST_OFFSET).toISOString().slice(0, 10);
};

/** 'YYYY-MM-DD'를 날짜 번호(일 단위)로. 두 날짜의 차이를 빼기 한 번으로 셀 수 있다. */
const dayNo = (ymd) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / DAY;
const fromDayNo = (n) => new Date(n * DAY).toISOString().slice(0, 10);

export const addDays = (ymd, days) => fromDayNo(dayNo(ymd) + days);

/**
 * 몇 달 뒤 같은 날. 1월 31일 + 1개월은 2월 말일로 맞춘다(3월 3일로 넘어가지 않게).
 * 소수 개월(1만 km 주기를 실제 주행으로 나눈 값)은 30.44일로 바꿔 더한다.
 */
export const addMonths = (ymd, months) => {
  const whole = Math.trunc(months);
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7)) - 1 + whole;
  const d = Number(ymd.slice(8, 10));
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const base = new Date(Date.UTC(y, m, Math.min(d, lastDay))).toISOString().slice(0, 10);
  const rest = months - whole;
  return rest ? addDays(base, Math.round(rest * 30.44)) : base;
};

/** today 기준 남은 날. 지났으면 음수. */
export const ddayOf = (ymd, today) => dayNo(ymd) - dayNo(kstYmd(today));

const statusOf = (dday, overdue) => {
  if (overdue) return '지남';
  return dday <= SOON_DAYS ? '30일 이내' : '예정';
};

const sortedDates = (records, kind) => (records || [])
  .filter((r) => r.kind === kind)
  .map((r) => kstYmd(r.date))
  .filter(Boolean)
  .sort();

/**
 * 다음 자동차검사.
 *
 * 최초등록일 + 2년, 그 뒤 1년마다 검사일이 정해져 있다. 검사 기록이 그 검사일을 '덮으면'
 * 다음 해로 넘어간다. 기록은 검사일이 가장 가까운 회차를 받은 것으로 본다(앞뒤 반 주기 안).
 * 원장에서 옮긴 기록은 돈을 낸 날이라 검사 기간보다 며칠 앞서거나 늦기도 하고,
 * 기간을 넘겨 늦게 받은 검사도 그 회차를 받은 것이기 때문이다.
 * 반 주기 넘게 떨어진 기록(출고 때 신규검사 등)은 어느 회차로도 세지 않는다.
 *
 * 마지막으로 덮인 회차보다 앞선 회차는 이미 받은 것으로 본다. 원장 이관 전의 검사는
 * 기록이 빠져 있는 경우가 많아, 이걸 '지남'으로 띄우면 진짜 놓친 차가 묻힌다.
 *
 * @param {object} vehicle registrationDate가 있어야 한다
 * @param {object[]} records 이 차의 정비·검사 기록 ({kind, date})
 * @param {Date|string} [today]
 * @returns {object|null} {date, dday, status, windowStart, windowEnd, round, missed} 등록일이 없으면 null
 */
export const nextInspection = (vehicle, records, today = new Date()) => {
  const reg = kstYmd(vehicle?.registrationDate);
  if (!reg) return null;
  const R = INSPECTION_RULE;
  const todayYmd = kstYmd(today);
  const done = sortedDates(records, '자동차검사');

  const dueOf = (round) => addMonths(reg, R.firstAfterMonths + (round - 1) * R.everyMonths);
  const startOf = (round) => addMonths(dueOf(round), -R.windowBeforeMonths);
  const halfCycle = Math.round((R.everyMonths * 30.44) / 2);

  // 기록이 덮는 가장 늦은 회차. 기록이 없으면 0회차(아직 한 번도 안 받음).
  let covered = 0;
  let last = '';
  for (const d of done) {
    for (let round = 1; round < 200; round += 1) {
      const gap = dayNo(d) - dayNo(dueOf(round));
      if (gap < -halfCycle) break; // 이 회차보다 한참 앞선 기록
      if (Math.abs(gap) <= halfCycle) {
        if (round >= covered) { covered = round; last = d; }
        break;
      }
    }
  }

  // 검사 기록이 한 건도 없는 차는 첫 회차부터 '지남'으로 잡으면 전부 빨갛게 떠서 진짜 급한 차가 묻힌다.
  // 이 경우는 지난 회차를 받았다고 보고 올해 회차(기간이 아직 안 끝난 첫 회차)를 보여 주되,
  // unverified로 표시해 사이트에서 확인하게 한다. 기록이 있는데 다음 회차를 넘긴 차는 그대로 '지남'이다.
  let round = covered + 1;
  let unverified = false;
  if (covered === 0 && addMonths(dueOf(round), R.windowAfterMonths) < todayYmd) {
    while (addMonths(dueOf(round), R.windowAfterMonths) < todayYmd) round += 1;
    unverified = true;
  }
  const date = dueOf(round);
  const windowStart = startOf(round);
  const windowEnd = addMonths(date, R.windowAfterMonths);
  const dday = ddayOf(date, todayYmd);

  // 기간이 이미 지났는데 그 뒤 회차의 기간도 지나 있으면, 기록이 몇 번 빠졌는지 함께 알린다
  let missed = 0;
  while (addMonths(dueOf(round + missed + 1), R.windowAfterMonths) < todayYmd) missed += 1;

  return {
    date,
    dday,
    status: statusOf(dday, windowEnd < todayYmd),
    windowStart,
    windowEnd,
    round, // 몇 번째 검사인지 (1 = 등록 2년 뒤 첫 검사)
    missed, // 이 회차 뒤로도 기간이 지나 버린 회차 수
    lastDone: last || '',
    unverified // 검사 기록이 없어 지난 회차는 받은 것으로 본 경우. 사이트·영수증으로 확인이 필요하다
  };
};

/**
 * 연간 약정 주행거리로 정한 정기점검 주기(개월).
 * @param {number} [annualKm]
 * @returns {number}
 */
export const maintenanceIntervalMonths = (annualKm) => {
  const M = MAINTENANCE_RULE;
  const km = Number(annualKm) > 0 ? Number(annualKm) : M.defaultAnnualKm;
  const months = M.everyKm / (km / 12);
  return Math.min(M.maxMonths, Math.max(M.minMonths, Math.round(months * 10) / 10));
};

/**
 * 기록에 적힌 주행거리로 실제 월 주행거리를 어림한다.
 *
 * 주행거리가 적힌 기록이 두 건 이상이고 날짜가 30일 넘게 떨어져 있어야 센다.
 * 날짜가 너무 붙어 있으면 하루 이틀 차이로 월 주행이 수만 km로 튄다.
 *
 * @returns {{kmPerMonth: number, lastYmd: string, lastKm: number}|null}
 */
export const estimateMonthlyKm = (records) => {
  const readings = (records || [])
    .filter((r) => Number(r.mileage) > 0 && kstYmd(r.date))
    .map((r) => ({ ymd: kstYmd(r.date), km: Number(r.mileage) }))
    .sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : a.km - b.km));
  if (readings.length < 2) return null;
  const first = readings[0];
  const last = readings[readings.length - 1];
  const days = dayNo(last.ymd) - dayNo(first.ymd);
  if (days < 30 || last.km <= first.km) return null;
  return { kmPerMonth: Math.round(((last.km - first.km) / days) * 30.44), lastYmd: last.ymd, lastKm: last.km };
};

/**
 * 다음 정기점검. 일반정비 '가입' 차량만 계산하고, 아니면 null.
 *
 * 기준일은 마지막 정기점검 기록, 없으면 인도일 → 렌트료 게시일 → 최초등록일 순.
 * 거기에 약정 주행거리로 정한 주기를 더한다.
 *
 * 주행거리가 적힌 기록이 두 건 이상이면 실제 주행 속도로도 1만 km가 차는 날을 어림해
 * 둘 중 이른 날을 쓴다. 약정보다 많이 타는 차를 늦게 부르지 않기 위해서다.
 *
 * @param {object} vehicle maintenance.generalMaintenance, maintenance.mileage, 각종 날짜
 * @param {object[]} records 이 차의 정비·검사 기록 ({kind, date, mileage})
 * @param {Date|string} [today]
 * @returns {object|null} {date, dday, status, intervalMonths, basis, baseDate, kmPerMonth}
 */
export const nextMaintenance = (vehicle, records, today = new Date()) => {
  if (vehicle?.maintenance?.generalMaintenance !== '가입') return null;
  const M = MAINTENANCE_RULE;

  const checks = (records || []).filter((r) => r.kind === '정기점검' && kstYmd(r.date))
    .sort((a, b) => (kstYmd(a.date) < kstYmd(b.date) ? -1 : 1));
  const lastCheck = checks[checks.length - 1];
  const [baseLabel, baseDate] = lastCheck
    ? ['지난 점검', kstYmd(lastCheck.date)]
    : [['인도일', vehicle.deliveryDate], ['렌트료 게시일', vehicle.rentBillingDate], ['최초등록일', vehicle.registrationDate]]
      .map(([label, d]) => [label, kstYmd(d)])
      .find(([, d]) => d) || ['', ''];
  if (!baseDate) return null;

  const annualKm = Number(vehicle.maintenance?.mileage) > 0 ? Number(vehicle.maintenance.mileage) : null;
  const intervalMonths = maintenanceIntervalMonths(annualKm);
  let date = addMonths(baseDate, intervalMonths);
  let basis = `${baseLabel} + 약정 ${((annualKm || M.defaultAnnualKm) / 10000)}만km/년 → ${intervalMonths}개월${annualKm ? '' : ' (약정 미기재, 2만km 가정)'}`;

  const pace = estimateMonthlyKm(records);
  let kmDate = '';
  if (pace && pace.kmPerMonth > 0) {
    // 기준일의 주행거리: 지난 점검에 적혀 있으면 그 값, 없으면 실제 주행 속도로 거꾸로 짐작한다
    const baseKm = Number(lastCheck?.mileage) > 0
      ? Number(lastCheck.mileage)
      : pace.lastKm - (pace.kmPerMonth * (dayNo(pace.lastYmd) - dayNo(baseDate))) / 30.44;
    const remainKm = baseKm + M.everyKm - pace.lastKm;
    kmDate = addDays(pace.lastYmd, Math.round((remainKm / pace.kmPerMonth) * 30.44));
    if (kmDate < date) {
      date = kmDate;
      basis = `실제 주행 월 ${pace.kmPerMonth.toLocaleString()}km 기준 1만km 도달 예상 (약정 기준이면 ${addMonths(baseDate, intervalMonths)})`;
    }
  }

  const dday = ddayOf(date, today);
  return {
    date,
    dday,
    status: statusOf(dday, dday < 0),
    intervalMonths,
    basis,
    baseDate,
    kmPerMonth: pace?.kmPerMonth || null,
    lastDone: lastCheck ? kstYmd(lastCheck.date) : ''
  };
};

/**
 * 차 한 대의 계획을 한 번에. 화면과 캘린더 작업이 이것만 부른다.
 * @returns {{inspection: object|null, maintenance: object|null, lastRecord: object|null, repairTotal: number}}
 */
export const planVehicle = (vehicle, records, today = new Date()) => {
  // 다음 날짜는 실제로 끝난 기록으로만 센다. '예정'·'입고'·'수리 중'을 받은 것으로 치면 아직 안 받은 검사의 색이 빠진다.
  // 예전 기록에는 status가 없다(모두 끝난 건).
  records = (records || []).filter((r) => !r.status || r.status === '완료');
  const sorted = [...records].sort((a, b) => (kstYmd(a.date) < kstYmd(b.date) ? 1 : -1));
  const last = sorted[0];
  return {
    inspection: nextInspection(vehicle, records, today),
    maintenance: nextMaintenance(vehicle, records, today),
    lastRecord: last ? { kind: last.kind, date: kstYmd(last.date), description: last.description || '', amount: last.amount || 0 } : null,
    repairTotal: (records || []).filter((r) => REPAIR_KINDS.includes(r.kind)).reduce((s, r) => s + (Number(r.amount) || 0), 0)
  };
};
