/**
 * 고지서 중복 판정 점검.
 *
 * 2026-11-23 아이엠앤티 101호1811: 수지구청 과태료 두 장(10/02, 10/29 위반)이 기관부서코드 56400270112를
 * 고지번호로 읽혀 두 번째 장이 '이미 올린 고지서'로 막혔다. 같은 일이 다시 생기지 않는지 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNoticeNo } from '../utils/fineNoticeOcr.js';
import { isSameNotice } from '../utils/noticeIdentity.js';

// 수지구청 주정차위반 과태료 고지서를 OCR로 읽으면 나오는 글자 순서를 줄인 것
const suji = (electronic, code) => `주정차위반 과태료 영수증 전 자 납 부 번 호 ${electronic} 가 상 계 좌 번 호 (농협)790270-02-928078
  납 부 번 호 56400270112 2026 61 234006 ${code} 납 부 자 : 주식회사 렌트베네핏 부과대상 : 101호1811`;

test('수지구청 고지서는 장마다 다른 번호를 읽는다', () => {
  const first = findNoticeNo(suji('4146022661455297117', '05019700 9'));
  const second = findNoticeNo(suji('4146022661455796580', '05435400 0'));
  assert.equal(first, '4146022661455297117');
  assert.equal(second, '4146022661455796580');
  assert.notEqual(first, second);
});

test('전자납부번호가 없으면 납부번호 덩어리를 모두 이어 붙인다', () => {
  const text = '납 부 번 호 56400270112 2026 61 234006 05435400 0 납 부 자';
  assert.equal(findNoticeNo(text), '56400270112202661234006054354000');
});

test('기관부서코드만 따로 읽히면 고지번호로 쓰지 않는다', () => {
  assert.equal(findNoticeNo('납부번호 56400270112 2026 납부자'), '');
});

test('다른 서식의 고지번호는 그대로 읽는다', () => {
  assert.equal(findNoticeNo('고지번호: 2026-123456-78 위반일시'), '2026-123456-78');
});

test('번호가 같아도 위반일이나 차량번호가 다르면 다른 고지서', () => {
  const old = { noticeNo: '56400270112', occurredAt: new Date('2026-10-02'), plateNo: '101호1811' };
  assert.equal(isSameNotice(old, { noticeNo: '56400270112', occurredAt: '2026-10-29', plateNo: '101호1811' }), false);
  assert.equal(isSameNotice(old, { noticeNo: '56400270112', occurredAt: '2026-10-02', plateNo: '125호8668' }), false);
  // 같은 고지서를 다시 스캔한 경우는 막는다
  assert.equal(isSameNotice(old, { noticeNo: '56400270112', occurredAt: '2026-10-02', plateNo: '101호1811' }), true);
  assert.equal(isSameNotice(old, { noticeNo: '564-0027-0112' }), true);
  assert.equal(isSameNotice(old, { noticeNo: '' }), false);
});
