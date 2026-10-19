import assert from 'node:assert/strict';
import { nextInspection, nextMaintenance, maintenanceIntervalMonths, addMonths } from '../utils/vehicleServicePlan.js';

/**
 * 정비·검사 계획 계산(utils/vehicleServicePlan.js)이 정한 규칙대로 나오는지 확인한다.
 * DB를 읽지 않는다. 규칙을 고친 뒤 한 번 돌려 보면 된다.
 *
 *   node scripts/vehicle-service-plan-check.js
 */

const TODAY = '2026-10-07';
const check = (name, fn) => {
  fn();
  console.log(`통과  ${name}`);
};

check('말일 + 1개월은 다음 달 말일', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});

check('검사: 기록이 없으면 등록 2년 뒤가 첫 검사', () => {
  const r = nextInspection({ registrationDate: '2025-12-03' }, [], TODAY);
  assert.equal(r.date, '2027-12-03');
  assert.equal(r.windowStart, '2027-11-02');
  assert.equal(r.windowEnd, '2028-01-03');
  assert.equal(r.status, '예정');
});

check('검사: 받은 기록이 있으면 다음 해로 넘어간다', () => {
  const r = nextInspection({ registrationDate: '2021-11-02' }, [{ kind: '자동차검사', date: '2026-09-17' }], TODAY);
  assert.equal(r.date, '2027-11-02');
  assert.equal(r.round, 5);
});

check('검사: 기간보다 며칠 앞선 납부일도 그 회차로 친다', () => {
  const r = nextInspection({ registrationDate: '2021-12-15' }, [{ kind: '자동차검사', date: '2025-11-09' }], TODAY);
  assert.equal(r.date, '2026-12-15');
});

check('검사: 기간 끝(검사일 + 31일)이 지나면 지남', () => {
  const r = nextInspection({ registrationDate: '2021-10-24' }, [{ kind: '자동차검사', date: '2024-10-30' }], TODAY);
  assert.equal(r.date, '2025-10-24');
  assert.equal(r.status, '지남');
});

check('검사: 검사일은 지났어도 기간 안이면 30일 이내', () => {
  const r = nextInspection({ registrationDate: '2024-09-20' }, [], TODAY);
  assert.equal(r.date, '2026-09-20');
  assert.equal(r.status, '30일 이내');
});

check('점검 주기: 2만km 6개월, 3만km 4개월, 4만km 3개월, 미기재 6개월, 1.5만km 8개월', () => {
  assert.equal(maintenanceIntervalMonths(20000), 6);
  assert.equal(maintenanceIntervalMonths(30000), 4);
  assert.equal(maintenanceIntervalMonths(40000), 3);
  assert.equal(maintenanceIntervalMonths(undefined), 6);
  assert.equal(maintenanceIntervalMonths(15000), 8);
  assert.equal(maintenanceIntervalMonths(200000), 2); // 너무 짧으면 2개월로
});

check('점검: 미가입 차는 계산하지 않는다', () => {
  assert.equal(nextMaintenance({ maintenance: { generalMaintenance: '미가입' }, deliveryDate: '2026-01-01' }, [], TODAY), null);
});

check('점검: 기록이 없으면 인도일 + 주기', () => {
  const r = nextMaintenance({ maintenance: { generalMaintenance: '가입', mileage: 30000 }, deliveryDate: '2026-08-01' }, [], TODAY);
  assert.equal(r.date, '2026-12-01');
  assert.equal(r.status, '예정');
});

check('점검: 실제로 더 많이 타면 주행거리 기준 날짜가 앞선다', () => {
  const v = { maintenance: { generalMaintenance: '가입', mileage: 20000 }, deliveryDate: '2026-01-01' };
  const records = [
    { kind: '정기점검', date: '2026-07-01', mileage: 15000 },
    { kind: '고장수리', date: '2026-09-01', mileage: 20000 } // 두 달에 5천km → 월 2,500km
  ];
  const r = nextMaintenance(v, records, TODAY);
  assert.ok(r.date < addMonths('2026-07-01', 6), `주행거리 기준이 더 일러야 한다: ${r.date}`);
  assert.match(r.basis, /실제 주행/);
});

console.log('\n모두 통과했습니다.');
