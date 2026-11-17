import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareMaturity, remainingRoundsOf, SUCCESSION_FEE } from '../../shared/maturityCompare.js';

// 청담건설 101호2198 (2026-11-09): 35회 입금완료, 36회 예정 377,550원(렌트료 376,700 + 통행료 850), 인수가 2,506,900, 보증금 0
const CHEONGDAM = [
  { no: 35, status: '입금완료', total: 376700, paidAmount: 376700 },
  { no: 36, status: '예정', total: 377550, fine: 850, paidAmount: 0 }
];

test('만기 비교: 청담건설 인수는 어제 안내문 합계 2,884,450원, 제3자면 승계 수수료 33만원이 붙는다', () => {
  const m = compareMaturity({ rounds: CHEONGDAM, deposit: 0, takeoverPrice: 2506900 });
  assert.equal(m.remainingSum, 377550);
  assert.equal(m.takeover.settle, 2884450);
  const third = compareMaturity({ rounds: CHEONGDAM, deposit: 0, takeoverPrice: 2506900, thirdParty: true });
  assert.equal(third.takeover.fee, SUCCESSION_FEE);
  assert.equal(third.takeover.settle, 3214450);
});

test('만기 비교: 인수가에서 보증금을 빼고, 반납은 보증금에서 남은 회차·수리비를 빼 돌려드린다', () => {
  const m = compareMaturity({ rounds: CHEONGDAM, deposit: 3000000, takeoverPrice: 2506900, repairEstimate: 200000 });
  assert.equal(m.takeover.pay, -493100);
  assert.equal(m.takeover.settle, 377550 - 493100);
  assert.equal(m.return.depositBack, 2800000);
  assert.equal(m.return.settle, 377550 - 2800000);
  assert.equal(m.extension.settle, 377550);
});

test('남은 회차: 다음 청구서로 넘긴 앞 회차 미납은 두 번 세지 않는다', () => {
  const rounds = [
    { no: 35, status: '미납', total: 376700, paidAmount: 0 },
    { no: 36, status: '청구됨', total: 376700 + 376700 + 5000, prevUnpaid: 376700, paidAmount: 0 }
  ];
  const r = remainingRoundsOf(rounds);
  assert.deepEqual(r.map((x) => x.amount), [376700, 381700]);
});
