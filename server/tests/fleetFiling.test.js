import test from 'node:test';
import assert from 'node:assert/strict';
import { filingSheetOf, applyFilingToCarTypes } from '../../shared/fleetFiling.js';

// 2026-10-21 구청에 낸 GV80(H) 증차 공문과 같은 값이 나와야 한다
const info = {
  garage: { location: '서울시 강서구 마곡동 797-4', area: 455, requiredArea: 860, reductionRate: 0.9, contractArea: 455 },
  carTypes: [
    { name: 'Ray van', width: 1.595, length: 3.595, count: 50 },
    { name: 'G90', width: 1.915, length: 5.205, count: 6 },
    { name: 'GV80(H)', width: 1.975, length: 4.94, count: 0 }
  ]
};

test('신구사업대비표: 변경 전·후 대수, 늘어난 면적, 변경 사유', () => {
  const s = filingSheetOf(info, { items: [{ name: 'GV80(H)', delta: 1 }] });
  assert.equal(s.beforeTotal, 56);
  assert.equal(s.afterTotal, 57);
  assert.equal(s.increase, 1);
  assert.equal(s.reason, '증차 1대\n감차 0대');
  assert.equal(s.registrationLabel, '렌터카 증차');
  assert.equal(s.changeArea.toFixed(3), '9.757');
  assert.equal(s.garage.reduction, 774);
  assert.equal(Math.round(s.garage.remaining), 369);
});

test('표에 없는 차종은 새 줄, 감차는 음수로 센다', () => {
  const s = filingSheetOf(info, { items: [{ name: '투싼', width: 1.865, length: 4.64, delta: 1 }, { name: ' g90 ', delta: -1 }] });
  assert.equal(s.rows.at(-1).name, '투싼');
  assert.equal(s.rows.at(-1).isNew, true);
  assert.equal(s.afterTotal, 56);
  assert.equal(s.registrationLabel, '렌터카 증차·감차');
});

test('구청 처리 완료: 대수를 더하고, 되돌리면 뺀다', () => {
  const after = applyFilingToCarTypes(info.carTypes, [{ name: 'GV80(H)', delta: 1 }, { name: '투싼', width: 1.865, length: 4.64, delta: 1 }]);
  assert.equal(after.find((t) => t.name === 'GV80(H)').count, 1);
  assert.equal(after.find((t) => t.name === '투싼').count, 1);
  assert.equal(info.carTypes[2].count, 0); // 원본은 그대로
  const back = applyFilingToCarTypes(after, [{ name: 'GV80(H)', delta: 1 }], -1);
  assert.equal(back.find((t) => t.name === 'GV80(H)').count, 0);
  assert.throws(() => applyFilingToCarTypes(info.carTypes, [{ name: 'GV80(H)', delta: -1 }]), /0대 아래/);
});
