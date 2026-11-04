import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastSentTo, recipientOf } from '../../shared/billingRecipient.js';

// 받는 주소: 계약별 → 법인 → 고객 → 지난 회차에 보낸 주소 (대표님 2026-11-04, 이승섭 변호사님 주소가 안 뜸)
const rounds = [
  { no: 50 },
  { no: 51, sentAt: new Date(), autoSend: { to: 'lss@bkl.co.kr' } },
  { no: 52 }
];

test('등록된 주소가 없으면 지난 회차에 보낸 주소를 쓴다', () => {
  assert.equal(recipientOf({ customer: { name: '이승섭' }, rounds }), 'lss@bkl.co.kr');
});

test('계약별 → 법인 → 고객 순으로 먼저 쓴다', () => {
  const company = { billingEmail: 'co@x.kr' };
  const customer = { email: 'cu@x.kr' };
  assert.equal(recipientOf({ billingEmail: 'sch@x.kr', company, customer, rounds }), 'sch@x.kr');
  assert.equal(recipientOf({ company, customer, rounds }), 'co@x.kr');
  assert.equal(recipientOf({ customer, rounds }), 'cu@x.kr');
});

test('자리표시 주소로는 보내지 않는다', () => {
  assert.equal(recipientOf({ customer: { email: 'no-email@rentbenefit.co.kr' } }), '');
  assert.equal(recipientOf({ customer: { email: 'no-email@rentbenefit.co.kr' }, rounds }), 'lss@bkl.co.kr');
});

test('버튼으로 보낸 주소(sentTo)를 가장 최근 회차부터 찾는다', () => {
  assert.equal(lastSentTo([{ no: 1, autoSend: { to: 'old@x.kr' } }, { no: 2, sentTo: 'new@x.kr' }]), 'new@x.kr');
});

test('주소가 어디에도 없으면 빈 값', () => {
  assert.equal(recipientOf({}), '');
  assert.equal(recipientOf(null), '');
});

test('법인·고객을 따로 넘길 수 있다(계약 종료·보증금 안내 화면)', () => {
  assert.equal(recipientOf({ rounds: [] }, { billingEmail: 'co@x.kr' }, null), 'co@x.kr');
  assert.equal(recipientOf(undefined, null, { email: 'cu@x.kr' }), 'cu@x.kr');
});
