import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquisitionTaxOf, taxOriginOf } from '../../shared/usedCarTax.js';

test('국산/외산: 제네시스는 국산, 벤츠는 외산', () => {
  assert.equal(taxOriginOf('G80 2.5T AWD'), '국산');
  assert.equal(taxOriginOf('Ray 스탠다드 A/T'), '국산');
  assert.equal(taxOriginOf('GLE450 4MATIC'), '외산');
});

test('다성테크 G80(2022 등록): 2026 인수는 인수가가 과표, 2028 연장 후 인수는 시가표준액이 과표', () => {
  const car = { registrationDate: '2022-12-01', model: 'G80 2.5T AWD', cc: 2497, newCarPrice: 64000000 };
  const now = acquisitionTaxOf({ ...car, onDate: '2026-12-02', takeoverPrice: 27389000 });
  // 4년 잔가율 0.437 × 64,000,000/1.1 = 25,425,000(천 원 미만 버림) < 인수가 27,389,000
  assert.equal(now.rate, 0.437);
  assert.equal(now.standardValue, 25425000);
  assert.equal(now.basis, '인수가');
  assert.equal(now.tax, 1917230);
  const later = acquisitionTaxOf({ ...car, onDate: '2028-12-01', takeoverPrice: 17389000 });
  // 6년 0.311 → 18,094,000 > 인수가 17,389,000
  assert.equal(later.standardValue, 18094000);
  assert.equal(later.basis, '시가표준액');
  assert.equal(later.tax, 1266580);
});

test('경차는 4%에 75만 원까지 감면, 위택스 조회값을 넣으면 그 값으로 센다', () => {
  const ray = acquisitionTaxOf({ registrationDate: '2021-11-03', onDate: '2026-11-25', model: 'Ray', cc: 998, newCarPrice: 13000000, takeoverPrice: 2506900 });
  assert.equal(ray.light, true);
  assert.equal(ray.grossTax, Math.floor((ray.taxBase * 0.04) / 10) * 10);
  assert.equal(ray.tax, 0);
  const looked = acquisitionTaxOf({ registrationDate: '2022-12-01', onDate: '2028-12-01', model: 'G80', cc: 2497, takeoverPrice: 0, standardValueNow: 30000000, standardYear: '2026-11-17' });
  // 2026 조회값 3,000만 ÷ 0.437 × 2028 잔가율 0.311
  assert.equal(looked.standardValue, Math.floor(((30000000 / 0.437) * 0.311) / 1000) * 1000);
  assert.equal(looked.looked, true);
});
