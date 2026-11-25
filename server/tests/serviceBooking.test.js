import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingStateOf, hasResult, isBookedTitle } from '../utils/serviceBooking.js';

const d = (ymd) => new Date(`${ymd}T00:00:00+09:00`);
const ev = (date, { title = '센터픽딜-고객 차량 점검', ...parsed } = {}) => ({ _id: 'w', eventId: 'e1', start: d(date), title, parsed: { kinds: ['정기점검'], done: '', ...parsed } });
const rec = (date, status, extra = {}) => ({ _id: 'r', kind: '정기점검', date: d(date), status, ...extra });
const state = (records, pending) => bookingStateOf('정기점검', records, pending, '2026-11-25');

test('구글에 앞으로 잡힌 일정은 예약이다', () => {
  assert.equal(state([], [ev('2026-12-02')]).state, 'booked');
  assert.equal(state([], [ev('2026-11-25')]).state, 'booked');
});

test('결과가 적혔으면 완료 대기, 결과 없이 날짜가 지났으면 late', () => {
  assert.equal(state([], [ev('2026-11-23', { done: '1.엔진오일,오일필터' })]).state, 'done');
  assert.equal(state([], [ev('2026-11-23')]).state, 'late');
  assert.equal(hasResult('1.'), false);
});

test('일정잡기·취소와 다른 종류는 예약이 아니다', () => {
  assert.equal(state([], [ev('2026-12-02', { title: '일정잡기-고객 차량 점검' })]), null);
  assert.equal(state([], [ev('2026-12-02', { title: '일정취소-고객' })]), null);
  assert.equal(state([], [ev('2026-12-02', { kinds: ['기타'] })]), null);
  assert.equal(isBookedTitle('청방예정-고객'), true);
});

test('화면에서 먼저 잡은 예정과 구글 일정은 한 건으로 합치고 구글 날짜를 쓴다', () => {
  const b = state([rec('2026-11-30', '예정')], [ev('2026-12-02')]);
  assert.deepEqual([b.state, b.date, b.recordId, b.inboxId], ['booked', '2026-12-02', 'r', 'w']);
  // 다른 구글 일정에 이어진 기록과는 합치지 않는다
  assert.equal(state([rec('2026-11-30', '예정', { calendarEventId: 'e9' })], [ev('2026-12-02')]).inboxId, null);
});

test('이미 받은 점검의 일정은 세지 않고, 프로그램 예약만 있어도 예약이다', () => {
  assert.equal(state([rec('2026-11-24', '완료')], [ev('2026-11-23')]), null);
  assert.equal(state([rec('2026-11-26', '예정')], []).state, 'booked');
  assert.equal(state([rec('2026-11-20', '예정')], []).state, 'late');
  assert.equal(state([rec('2026-11-20', '입고')], []).state, 'working');
});
