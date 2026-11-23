// 고지서 두 장이 같은 건인지 가른다.
//
// 고지번호가 같으면 같은 고지서로 보지만, 위반일이나 차량번호가 서로 다르면 다른 고지서다.
// 고지번호를 잘못 읽는 일이 있기 때문이다. 수지구청 고지서의 납부번호는
// '56400270112 2026 61 234006 05019700 9'처럼 여러 덩어리인데, 앞 덩어리(기관부서코드)만 읽으면
// 그 구청의 모든 고지서가 같은 번호가 된다(2026-11-23 아이엠앤티 5회차 고지서가 막힌 일).
// 금액은 감경(40,000 → 32,000) 때문에 같은 고지서도 다르게 적힐 수 있어 가르는 데 쓰지 않는다.

/** 고지번호를 비교할 수 있게 숫자만 남긴다. */
export const normalizeNoticeNo = (value) => String(value || '').replace(/[^0-9]/g, '');

/** 날짜를 'YYYY-MM-DD'로. 없거나 잘못된 값이면 빈 값. */
const dayOf = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const plateOf = (value) => String(value || '').replace(/\s+/g, '');

/**
 * 두 고지서가 같은 건인지 본다.
 *
 * @param {{noticeNo?: string, occurredAt?: any, plateNo?: string}} a 이미 올린 고지서
 * @param {{noticeNo?: string, occurredAt?: any, plateNo?: string}} b 새로 올리는 고지서
 * @returns {boolean}
 */
export const isSameNotice = (a, b) => {
  const na = normalizeNoticeNo(a?.noticeNo);
  const nb = normalizeNoticeNo(b?.noticeNo);
  if (!na || na !== nb) return false;
  const da = dayOf(a.occurredAt);
  const db = dayOf(b.occurredAt);
  if (da && db && da !== db) return false;
  const pa = plateOf(a.plateNo);
  const pb = plateOf(b.plateNo);
  if (pa && pb && pa !== pb) return false;
  return true;
};
