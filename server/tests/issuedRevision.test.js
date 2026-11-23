/**
 * 발행한 청구서를 고칠 때의 규칙 점검 (utils/issuedRevision.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteIssuedRevision, needsReissue } from '../utils/issuedRevision.js';

const issued = (over = {}) => ({ no: 4, issuedAt: new Date('2026-11-13'), status: '청구됨', total: 681000, paidAmount: 0, ...over });

test('발행 전 회차는 기록하지 않는다', () => {
  const round = { no: 5, total: 649000 };
  assert.equal(noteIssuedRevision(round, { totalBefore: 681000, summary: 'x' }), null);
  assert.equal(round.revisions, undefined);
});

test('발행한 회차를 고치면 기록이 남고 다시 보내야 한다고 표시된다', () => {
  const round = issued({ total: 649000 });
  const now = new Date('2026-11-23T10:00:00Z');
  const rev = noteIssuedRevision(round, { totalBefore: 681000, summary: '과태료 빼기', by: '이두식', now });
  assert.equal(round.revisions.length, 1);
  assert.deepEqual(round.revisions[0], { at: now, by: '이두식', summary: '과태료 빼기', totalBefore: 681000, totalAfter: 649000 });
  assert.equal(needsReissue(round), true);
  assert.match(rev.message, /681,000원 → 649,000원/);
  // 정정 청구서를 다시 발행하면 풀린다
  round.issuedAt = new Date('2026-11-23T11:00:00Z');
  assert.equal(needsReissue(round), false);
});

test('이미 받은 돈보다 청구액이 줄면 입금완료로 두고 초과 금액을 알린다', () => {
  const round = issued({ status: '입금완료', paidAmount: 681000, total: 649000 });
  const rev = noteIssuedRevision(round, { totalBefore: 681000, summary: '고객 직접 납부' });
  assert.equal(round.status, '입금완료');
  assert.equal(rev.overpaid, 32000);
  assert.match(rev.message, /전월 초과입금/);
});

test('받은 돈보다 청구액이 커지면 미납으로 바꾼다', () => {
  const round = issued({ status: '입금완료', paidAmount: 649000, total: 681000 });
  const rev = noteIssuedRevision(round, { totalBefore: 649000, summary: '과태료 추가' });
  assert.equal(round.status, '미납');
  assert.equal(rev.unpaid, 32000);
});

test('입금 결과를 적지 않은 회차는 상태를 그대로 둔다', () => {
  const round = issued({ total: 649000 });
  noteIssuedRevision(round, { totalBefore: 681000, summary: 'x' });
  assert.equal(round.status, '청구됨');
});
