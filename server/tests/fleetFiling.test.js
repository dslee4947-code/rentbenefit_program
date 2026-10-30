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

test('구청 처리 알림: 민원번호·처리일·대수를 읽고, 문장과 표가 다르면 증감과 맞는 쪽을 쓴다', async () => {
  const { parseFleetNoticeText } = await import('../utils/fleetNoticeParse.js');
  const a = parseFleetNoticeText(`1. 서초구 민원-117457(2026.10.21.)호 및 교통행정과-126095(2026.10.29.)호와 관련입니다
○ 주사무소 승용차 1대 증차(141대 → 142대)
- 차종: 제네시스 GV80 1대
나. 차량 및 차고지 현황
합계 141 141 0 142 142 0 455 860 86 369
시행 교통행정과-126213 ( 2026. 10. 29. ) 접수 ( )`);
  assert.equal(a.minwonNo, '117457');
  assert.equal(a.appliedAt.toISOString().slice(0, 10), '2026-10-21');
  assert.equal(a.processedAt.toISOString().slice(0, 10), '2026-10-29');
  assert.deepEqual([a.before, a.after, a.increase, a.decrease], [141, 142, 1, 0]);

  // 2026-07-15 알림: 표는 136 → 136 그대로, 문장은 136 → 139(3대 증차)
  const b = parseFleetNoticeText(`민원-81033(2026.07.08.)호
○ 주사무소 승용 3대 증차 (136→139대) - 그랜저 1대
나. 차량
합계 136 136 0 136 136 0 455 860 86 369
시행 교통행정과-83034 ( 2026. 7. 15. )`);
  assert.deepEqual([b.before, b.after], [136, 139]);

  // 감차 차량번호는 감차 줄에서만, 장기차량 감면 줄의 번호는 빼고
  const c = parseFleetNoticeText(`민원-1(2025.06.02.)
○ 주사무소 승용 1대 감차 - 125호3053 ○ 주사무소 장기차량 27대 적용, 감면율 수정 101하5045, 125호8766
나. 차량
합계 112 112 0 111 111 0
시행 교통행정과-2 ( 2025. 6. 11. )`);
  assert.deepEqual(c.plates, ['125호3053']);
});

test('렌트차량 DB 차를 대비표 차종에 맞춘다', async () => {
  const { carTypeOfVehicle, compareFleet } = await import('../../shared/fleetFiling.js');
  const types = ['Ray van', 'S450', 'G80', '그랜저', '그랜저(신)', 'GV80', 'GV80(H)', 'K5(H)', 'E350', 'Benz-G', 'May S580', 'S580', '코나(전기차)', '코나(H)'].map((name) => ({ name, count: 1 }));
  const cases = {
    'Ray Van 스탠다드 A/T': 'Ray van', '더 뉴 레이 가솔린 시그니처(A/T 2026MY)': 'Ray van', 'G80 2.5T AWD': 'G80',
    'Grander 르블랑': '그랜저', '그랜저(H) 1.6T 하이브리드 프리미엄': '그랜저(신)', 'Grander GN7 하이브리드 1.6T 2WD 프리미엄': '그랜저(신)',
    'GV80 Coupe 3.5 AWD': 'GV80', 'GV80 HEV 27MY 5인승 AWD 19인치': 'GV80(H)', 'K5(H) 하이브리드 프레스티지': 'K5(H)',
    'E350 4Matic AV': 'E350', 'G63 Edition': 'Benz-G', 'MAYBACH S580 4Matic L': 'May S580', 'S580 4Matic L': 'S580',
    'Cona SX2 런칭 전기모터 2WD 롱레인지': '코나(전기차)', '코나 하이브리드 2WD H-Pick': '코나(H)', 'Model Y Premium': null
  };
  Object.entries(cases).forEach(([model, want]) => assert.equal(carTypeOfVehicle(model, types), want, model));

  // 같은 이름 줄이 둘이면 신고 대수만큼 나눠 담고, 계약중은 출고 전으로 따로
  const { rows } = compareFleet([{ name: 'S450', count: 1 }, { name: 'S450', count: 1 }], [
    { carModel: 'S450', status: '장기렌트' }, { carModel: 'S450 4matic', status: '단기렌트' }, { carModel: 'S450', status: '계약중' }
  ]);
  assert.deepEqual(rows.map((r) => [r.running.length, r.diff]), [[1, 0], [1, 0]]);
  assert.equal(rows[0].pending.length, 1);
});
