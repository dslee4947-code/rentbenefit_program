// 렌트 차량 AS '지난 이력' 표의 칸별 필터 계산 (대표님 2026-11-17). 화면 부품은 ServiceHistoryFilter.jsx.
//
// 칸 종류
//   date    기간(from·to)
//   select  목록에서 고르기(차량번호·작업·상태)
//   range   숫자 범위(주행거리·금액)
//   text    글자 검색(작업 내용·정비소)

/** 한국 날짜 YYYY-MM-DD. 기록 날짜는 한국 0시(UTC 전날 15시)로 저장돼 앞 10자만 자르면 하루 앞당겨진다 */
export const kstYmd = (d) => {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  return new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
};

const numOf = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {object[]} rows 기록
 * @param {{key: string, type?: 'date'|'select'|'range'|'text', get?: (row) => any}[]} columns
 * @param {object} value 칸마다 { from, to } 또는 { value }
 */
export const filterHistory = (rows, columns, value) => rows.filter((r) => columns.every((c) => {
  const v = value?.[c.key];
  if (!c.type || !v) return true;
  const val = c.get(r);
  if (c.type === 'date') {
    const d = String(val || '');
    if (v.from && (!d || d < v.from)) return false;
    if (v.to && (!d || d > v.to)) return false;
    return true;
  }
  if (c.type === 'select') return !v.value || String(val ?? '') === v.value;
  if (c.type === 'range') {
    const n = numOf(val);
    const lo = numOf(v.from);
    const hi = numOf(v.to);
    if (lo !== null && (n === null || n < lo)) return false;
    if (hi !== null && (n === null || n > hi)) return false;
    return true;
  }
  if (c.type === 'text') {
    const q = String(v.value || '').trim().toLowerCase();
    return !q || String(val ?? '').toLowerCase().includes(q);
  }
  return true;
}));

/** 걸린 필터가 하나라도 있는지 */
export const filterActive = (value) => Object.values(value || {})
  .some((v) => v && Object.values(v).some((x) => String(x ?? '').trim() !== ''));

/** 목록 칸에 보일 값들 */
export const selectOptions = (rows, column) => [...new Set(rows.map((r) => String(column.get(r) ?? '')).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'ko'));
