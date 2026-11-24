import test from 'node:test';
import assert from 'node:assert/strict';
import { changeRoundDueDate, keepRoundEdits, roundSnapshot } from '../controllers/billingScheduleController.js';

const kst = (ymd) => new Date(`${ymd}T12:00:00+09:00`);
const rounds = () => [
  { no: 1, dueDate: kst('2026-11-25') },
  { no: 2, dueDate: kst('2026-12-25') },
  { no: 3, dueDate: kst('2027-01-25') }
];

test('한 회차만 출금일을 바꾸고 원래 날짜를 남긴다. 되돌리면 표시가 없어진다', () => {
  const rs = rounds();
  const c = changeRoundDueDate(rs, rs[0], '2026-11-30');
  assert.equal(c.changed, true);
  assert.equal(c.summary, '출금일 2026-11-25 → 2026-11-30');
  assert.deepEqual(rs[0].dueDate, kst('2026-11-30'));
  assert.deepEqual(rs[0].dueDateOriginal, kst('2026-11-25'));
  assert.deepEqual(rs[1].dueDate, kst('2026-12-25'));
  changeRoundDueDate(rs, rs[0], '2026-11-25');
  assert.equal(rs[0].dueDateOriginal, undefined);
});

test('없는 날짜와 앞뒤 회차를 넘는 날짜는 막는다', () => {
  const rs = rounds();
  assert.ok(changeRoundDueDate(rs, rs[0], '2026-11-31').error);
  assert.ok(changeRoundDueDate(rs, rs[0], '2026-12-25').error);
  assert.ok(changeRoundDueDate(rs, rs[1], '2026-11-25').error);
  assert.equal(changeRoundDueDate(rs, rs[0], '2026-11-25').changed, false);
  assert.deepEqual(rs[0].dueDate, kst('2026-11-25'));
});

test('회차표를 다시 만들어도 바꾼 출금일·비고·추가 청구가 남는다', () => {
  const fresh = { no: 1, dueDate: kst('2026-11-25'), monthlyRent: 500000, total: 500000, status: '예정' };
  const kept = keepRoundEdits(fresh, {
    dueDate: kst('2026-11-30'), dueDateOriginal: kst('2026-11-25'), monthlyRent: 435000, invoiceNote: '안내',
    extras: [{ label: '키', amount: 80000 }], autoSend: { status: '승인' }
  });
  assert.deepEqual(kept.dueDate, kst('2026-11-30'));
  assert.equal(kept.invoiceNote, '안내');
  assert.equal(kept.total, 580000);
  assert.equal(kept.autoSend, undefined);
});

test('비고가 바뀌면 승인 지문이 달라지고, 비고가 없으면 예전 지문과 같다', () => {
  const r = { dueDate: kst('2026-11-25'), monthlyRent: 1 };
  assert.equal(roundSnapshot(r, 'a@b.c'), roundSnapshot({ ...r, invoiceNote: '' }, 'a@b.c'));
  assert.notEqual(roundSnapshot(r, 'a@b.c'), roundSnapshot({ ...r, invoiceNote: '안내' }, 'a@b.c'));
});
