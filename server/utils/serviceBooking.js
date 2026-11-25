import { kstYmd, addDays } from './vehicleServicePlan.js';

/**
 * 차 한 대의 정기점검·자동차검사 예약 상태 (2026-11-25).
 *
 * 예약은 두 곳에 있다: 프로그램에서 잡은 '예정' 기록과, 직원이 구글 업무캘린더에 적은 일정('확인 대기').
 * 전에는 구글 일정이 '확인 대기'에만 있어 예약한 차가 [정기점검 지남]에 그대로 남았다.
 * DB를 읽지 않는 순수 함수만 둔다.
 */

// 같은 일로 보는 날짜 폭(예약일과 실제 날짜 차이). calendarInboxSync도 이 값을 쓴다
export const SAME_JOB_DAYS = 14;

// 날짜 칸에 올려 두었을 뿐 아직 잡히지 않았거나 취소된 일정
const NOT_BOOKED = /일정\s*잡기|일정\s*취소|진행\s*취소|미입고|미정/;
export const isBookedTitle = (title) => !NOT_BOOKED.test(String(title || ''));

/** '점검 내용' 칸에 실제 결과가 적혔는지. 양식의 빈 번호("1.")는 결과가 아니다 */
export const hasResult = (done) => /[가-힣A-Za-z]{2,}/.test(String(done || ''));

export const isOpenRecord = (r) => Boolean(r?.status) && r.status !== '완료';
const near = (a, b) => a >= addDays(b, -SAME_JOB_DAYS) && a <= addDays(b, SAME_JOB_DAYS);

/**
 * @param {string} kind '정기점검' | '자동차검사'
 * @param {object[]} records 이 차의 기록 {_id, kind, date, status, shop, calendarEventId}
 * @param {object[]} pending 구글 '확인 대기' {_id, eventId, start, title, parsed: {kinds, done, shop}}
 * @param {string} [today]
 * @returns {object|null} {state, date, status, shop, recordId, inboxId, title}
 *   state: 'done' 구글에 결과가 적힘(기록만 남기면 끝) · 'working' 입고·수리 중 · 'booked' 오늘 이후 예약 · 'late' 예약일이 지났는데 결과 없음
 */
export const bookingStateOf = (kind, records, pending, today = kstYmd(new Date())) => {
  const same = (records || []).filter((r) => r.kind === kind);
  const lastDone = same.filter((r) => !isOpenRecord(r)).map((r) => kstYmd(r.date)).sort().pop() || '';
  const open = same.filter(isOpenRecord).map((r) => ({
    id: r._id, date: kstYmd(r.date), status: r.status, shop: r.shop || '', eventId: String(r.calendarEventId || '').split('#')[0]
  }));
  const used = new Set();
  const list = [];
  for (const w of pending || []) {
    if (!(w.parsed?.kinds || []).includes(kind) || !isBookedTitle(w.title) || !w.start) continue;
    const date = kstYmd(w.start);
    if (date <= lastDone) continue; // 이미 받은 점검의 일정
    const rec = open.find((r) => !used.has(r.id) && (r.eventId ? r.eventId === w.eventId : near(r.date, date)));
    if (rec) used.add(rec.id);
    const state = hasResult(w.parsed?.done) && date <= today ? 'done'
      : rec && rec.status !== '예정' ? 'working'
        : date >= today ? 'booked' : 'late';
    list.push({ state, date, status: rec?.status || '예정', shop: w.parsed?.shop || rec?.shop || '', recordId: rec?.id || null, inboxId: w._id, title: w.title || '' });
  }
  for (const r of open) {
    if (used.has(r.id)) continue;
    list.push({ state: r.status !== '예정' ? 'working' : r.date >= today ? 'booked' : 'late', date: r.date, status: r.status, shop: r.shop, recordId: r.id, inboxId: null, title: '' });
  }
  const rank = { done: 0, working: 1, booked: 2, late: 3 };
  list.sort((a, b) => rank[a.state] - rank[b.state] || (a.date < b.date ? -1 : 1));
  return list[0] || null;
};
