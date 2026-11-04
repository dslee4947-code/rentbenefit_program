import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depositAmountsOf, noticeItemOf, noticeLabel, receivedOf } from '../utils/depositNotice.js';

test('차량 DB 합계를 쓰고, 0이면 계약 금액을 쓴다', () => {
  // 엑셀에서 옮긴 계약: 계약 금액 칸이 0
  assert.deepEqual(depositAmountsOf([{ deposit: 8000000, advancePayment: 2000000 }], { deposit: 0, advancePayment: 0 }), { deposit: 8000000, advancePayment: 2000000 });
  // 한 계약에 차 두 대면 더한다(셀토스 2대)
  assert.equal(depositAmountsOf([{ deposit: 8541000 }, { deposit: 8541000 }], {}).deposit, 17082000);
  // 출고 전 계약: 차량 칸이 비어 있음
  assert.deepEqual(depositAmountsOf([{}], { deposit: 5685000 }), { deposit: 5685000, advancePayment: 0 });
  assert.deepEqual(depositAmountsOf([], undefined), { deposit: 0, advancePayment: 0 });
});

test('이름은 받을 돈만 적는다', () => {
  assert.equal(noticeLabel({ deposit: 1, advancePayment: 1 }), '보증금·선수금');
  assert.equal(noticeLabel({ deposit: 1, advancePayment: 0 }), '보증금');
  assert.equal(noticeLabel({ deposit: 0, advancePayment: 1 }), '선수금');
  assert.equal(noticeLabel({ deposit: 0, advancePayment: 0 }), '');
});

test('원장 입금은 보증금·선납금 입금 줄만 더하고 돌려준 줄은 빼지 않는다', () => {
  const ledgers = [{ entries: [
    { side: '입금', category: '보증금', amount: 3825000 },
    { side: '입금', category: '보증금', amount: -3825000 },
    { side: '입금', category: '선납금', amount: 2000000 },
    { side: '지출', category: '보증금', amount: 500000 },
    { side: '입금', category: '렌트료', amount: 700000 }
  ] }];
  assert.deepEqual(receivedOf(ledgers), { depositIn: 3825000, advanceIn: 2000000 });
});

test('받을 돈이 원장에 다 들어와야 입금 완료다', () => {
  const base = { contract: { _id: 'c', contractNo: 'N', depositNotices: [] }, vehicles: [{ deposit: 100, advancePayment: 50 }], partyName: 'P', to: 'a@b.c' };
  const part = noticeItemOf({ ...base, ledgers: [{ entries: [{ side: '입금', category: '보증금', amount: 100 }] }] });
  assert.equal(part.paid, false);
  const full = noticeItemOf({ ...base, ledgers: [{ entries: [{ side: '입금', category: '보증금', amount: 100 }, { side: '입금', category: '선납금', amount: 50 }] }] });
  assert.equal(full.paid, true);
});

test('보낸 기록은 가장 최근 것을 보여 준다', () => {
  const item = noticeItemOf({
    contract: { _id: 'c', contractNo: 'N', depositNotices: [{ sentAt: '2026-11-01', sentTo: 'old@x.y' }, { sentAt: '2026-11-03', sentTo: 'new@x.y' }] },
    vehicles: [{ deposit: 100 }],
    ledgers: [],
    partyName: 'P',
    to: ''
  });
  assert.equal(item.lastSent.sentTo, 'new@x.y');
});
