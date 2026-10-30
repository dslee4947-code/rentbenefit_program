import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepairInvoice } from '../utils/repairInvoice.js';

// 정비소 점검·정비 명세서 (부품·공임 칸이 따로)
const SHEET = `자동차 점검·정비 명세서
차량번호 125호2370   차종 E350   주행거리 82,410 km
입고일자 2026-10-20   출고일자 2026.10.22
상호 한성모터스 성동  사업자등록번호 123-45-67890
번호 작업내용 수량 단가 부품 공임
1 엔진오일 1 45,000 45,000 20,000
2 오일필터 1 18,000 18,000 0
3 브레이크패드(앞) 1 120,000 120,000 50,000
부품계 183,000
공임계 70,000
공급가액 253,000
부가세 25,300
합계 278,300`;

test('명세서: 차량·날짜·업체·줄·합계를 읽는다', () => {
  const r = parseRepairInvoice(SHEET);
  assert.equal(r.plateNo, '125호2370');
  assert.equal(r.inDate, '2026-10-20');
  assert.equal(r.outDate, '2026-10-22');
  assert.equal(r.mileage, 82410);
  assert.equal(r.bizNo, '123-45-67890');
  assert.equal(r.shop, '한성모터스 성동');
  assert.equal(r.lines.length, 3);
  assert.deepEqual(r.lines[0], { name: '엔진오일', qty: 1, unitPrice: 45000, parts: 45000, labor: 20000, amount: 65000 });
  assert.equal(r.supply, 253000);
  assert.equal(r.vat, 25300);
  assert.equal(r.total, 278300);
  assert.deepEqual(r.warnings, []);
});

// 사고 수리 견적서 (금액 한 칸, 합계만 적힘)
const QUOTE = `수리 견적서
삼성화재 사고접수번호 2026-1234567
차량번호: 101호2197
작업일자 2026년 10월 3일
앞범퍼 교환 1 380,000 380,000
앞범퍼 도장  220,000
헤드램프(좌) 1 640,000
합계 1,364,000원`;

test('견적서: 보험사·접수번호·사고수리를 알아보고 공급가·부가세를 나눈다', () => {
  const r = parseRepairInvoice(QUOTE);
  assert.equal(r.insurer, '삼성화재');
  assert.equal(r.claimNo, '2026-1234567');
  assert.equal(r.kindGuess, '사고수리');
  assert.equal(r.outDate, '2026-10-03');
  assert.equal(r.lines.length, 3);
  assert.equal(r.lines[1].labor, 220000); // 도장은 공임
  assert.equal(r.lines[2].amount, 640000);
  assert.equal(r.total, 1364000);
  assert.equal(r.supply, 1240000); // 줄 합
  assert.equal(r.vat, 124000);
});

test('빈 글자는 경고만 준다', () => {
  const r = parseRepairInvoice('');
  assert.equal(r.lines.length, 0);
  assert.ok(r.warnings.length >= 1);
});
