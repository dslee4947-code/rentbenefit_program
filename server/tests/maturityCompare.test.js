import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareMaturity, remainingRoundsOf, settleLabel, SUCCESSION_FEE } from '../../shared/maturityCompare.js';

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

test('만기 비교: 회차표가 만기 전에 끝나 있으면 빠진 결제일을 월 렌트료로 채운다', () => {
  // 다성테크 125호5288: 11회 2026-11-25가 마지막, 만기 2026-12-02 → 다음 결제일 12-25는 만기 뒤라 빠진 회차 없음
  const ds = [{ no: 10, status: '입금완료', total: 1208000, paidAmount: 1208000, dueDate: '2026-10-25' }, { no: 11, status: '청구됨', total: 1208000, dueDate: '2026-11-25' }];
  const ok = compareMaturity({ rounds: ds, contractEnd: '2026-12-02', monthlyRent: 1208000 });
  assert.equal(ok.missingCount, 0);
  assert.equal(ok.lastNo, 11);
  assert.equal(ok.remainingSum, 1208000);
  // 회차표가 10회에서 멈췄다면 11회(11-25)를 채운다
  const cut = compareMaturity({ rounds: ds.slice(0, 1), contractEnd: '2026-12-02', monthlyRent: 1208000 });
  assert.equal(cut.missingCount, 1);
  assert.deepEqual(cut.remaining.map((r) => [r.no, r.dueDate, r.missing]), [[11, '2026-11-25', true]]);
  // DB 날짜(한국 자정 = UTC 전날 15시)도 한국 날짜로 센다
  const db = compareMaturity({ rounds: [{ no: 10, status: '입금완료', dueDate: new Date('2026-10-24T15:00:00Z') }], contractEnd: new Date('2026-12-01T15:00:00Z'), monthlyRent: 1000 });
  assert.equal(db.remaining[0].dueDate, '2026-11-25');
});

test('정산 문구: 납부 금액 / 보증금 반환 / 보증금 차액 반환', () => {
  assert.deepEqual(settleLabel(1208000, 'extension'), { title: '납부 금액', amount: 1208000 });
  assert.deepEqual(settleLabel(-26181000, 'return'), { title: '보증금 반환', amount: 26181000 });
  assert.deepEqual(settleLabel(-115550, 'takeover'), { title: '보증금 차액 반환', amount: 115550 });
  assert.equal(settleLabel(0, 'takeover').title, '추가 납부 없음');
});
