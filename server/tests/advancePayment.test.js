import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceForRound, advanceMonthsOf, advanceTaxInvoice, advanceMailText } from '../../shared/advancePayment.js';
import { insertAfterFirstParagraph } from '../utils/mailService.js';

const car = { plateNo: 'A', monthlyFee: 435000, advancePayment: 14331000, advanceMonths: 60 };

test('선납 14,331,000원 60개월: 안분액 238,850원, 세금계산서 673,850원', () => {
  const t = advanceTaxInvoice([car], { no: 1, monthlyRent: 435000 });
  assert.deepEqual([t.rent, t.advance, t.taxInvoice, t.basis], [435000, 238850, 673850, '14,331,000원 1/60회차']);
  assert.match(advanceMailText([car], { no: 1, monthlyRent: 435000 }), /월 세금계산서 발행금액 : 673,850원/);
  assert.ok(advanceMailText([car], { no: 1, monthlyRent: 435000 }).includes("세금계산서는 월 렌트료에 선납금(선수금) 안분액을 포함한 금액으로 발행됩니다"));
});

test('안분액을 모두 더하면 선납금과 같고 끝전은 마지막 회차에 들어간다', () => {
  for (const [total, months] of [[29280000, 51], [7767000, 48], [4000000, 60], [2000000, 12]]) {
    let sum = 0;
    for (let no = 1; no <= months; no += 1) sum += advanceForRound(total, months, no).deduction;
    assert.equal(sum, total);
    assert.equal(advanceForRound(total, months, months).balance, 0);
  }
});

test('선납금이 없거나 안분이 끝난 회차에는 안내가 없다', () => {
  assert.equal(advanceMailText([{ ...car, advancePayment: 0 }], { no: 1, monthlyRent: 1 }), '');
  assert.equal(advanceTaxInvoice([car], { no: 61, monthlyRent: 435000 }), null);
});

test('안분 개월 수는 이번 계약 기간이 먼저', () => {
  assert.equal(advanceMonthsOf({ paymentTerm: 96 }, { termMonths: 60 }, 60), 60);
  assert.equal(advanceMonthsOf({}, { termMonths: 60 }, 60), 60);
  assert.equal(advanceMonthsOf({ paymentTerm: 24 }, {}, 25), 24);
});

test('메일 안내는 첫 문단 다음에 들어가고, 안내가 없으면 본문은 그대로다', () => {
  assert.equal(insertAfterFirstParagraph('보내드립니다.\n\n감사합니다.', '안내'), '보내드립니다.\n\n안내\n\n감사합니다.');
  assert.equal(insertAfterFirstParagraph('가\n\n나', ''), '가\n\n나');
});
