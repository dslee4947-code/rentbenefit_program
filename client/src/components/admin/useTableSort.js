import { useState, useMemo, isValidElement } from 'react';

/**
 * 표 정렬 공통 도구.
 *
 * 차량 손익 원장(갑지) 목록이 쓰던 "머리글을 누르면 그 기준으로 정렬" 방식을
 * 다른 표에서도 똑같이 쓰기 위해 한 곳에 모았다. 화면마다 정렬 코드를 따로 쓰면
 * 방향 표시나 빈 값 처리가 화면마다 달라져 같은 표인데 결과가 달라 보인다.
 *
 * 쓰는 법:
 *   const COLUMNS = [{ key: 'carModel', label: '차종' }, { key: 'monthlyFee', label: '월렌트료', numeric: true }];
 *   const sort = useTableSort(rows, COLUMNS);
 *   sort.rows.map(...)                        // 정렬된 줄
 *   <SortableTh sort={sort} columnKey="carModel">차종</SortableTh>   // TableSort.jsx
 *   <SortControls sort={sort} />              // 정렬 고르는 상자 + 초기화 단추
 */

/** 빈 칸으로 볼 표시들. 정렬할 때는 방향과 상관없이 항상 뒤로 보낸다. */
const EMPTY_TEXTS = new Set(['', '-', '--', '—', 'null', 'undefined']);

/** 숫자 뒤에 흔히 붙는 단위. 떼어 내면 금액·기간도 숫자로 비교할 수 있다. */
const NUMERIC_SUFFIX = /(원|%|개월|개|회|건|명|대|장|cc|km|일|년|월)$/;

/**
 * 화면에 그린 내용(React 노드)에서 글자만 뽑아낸다.
 * 배지·아이콘이 섞인 칸도 눈에 보이는 글자 그대로 정렬 기준이 되도록 하기 위한 것이다.
 */
export function nodeText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).filter(Boolean).join(' ');
  if (isValidElement(node)) return nodeText(node.props?.children);
  return '';
}

/**
 * 비교할 수 있는 형태로 바꾼다.
 * - 날짜(ISO 또는 Date)와 숫자는 크기로, 나머지는 글자로 비교한다.
 * - 빈 값은 { empty: true }로 표시해 두고 정렬할 때 뒤로 보낸다.
 */
export function toComparable(raw) {
  if (raw === null || raw === undefined) return { empty: true };
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? { empty: true } : { num: raw.getTime() };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { num: raw } : { empty: true };
  if (typeof raw === 'boolean') return { num: raw ? 1 : 0 };

  const text = String(raw).trim();
  if (EMPTY_TEXTS.has(text)) return { empty: true };

  // 2026-09-03, 2026-09-03T12:00:00Z 같은 날짜 문자열
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const t = Date.parse(text);
    if (!Number.isNaN(t)) return { num: t };
  }
  // 2026. 9. 3. (toLocaleDateString 결과)
  const localeDate = text.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/);
  if (localeDate) {
    return { num: Date.UTC(Number(localeDate[1]), Number(localeDate[2]) - 1, Number(localeDate[3])) };
  }
  // 1,234,000원 / 36개월 / 4.9%
  const bare = text.replace(NUMERIC_SUFFIX, '').replace(/[\s,]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(bare)) return { num: Number(bare) };

  return { text };
}

/** 두 값을 견준다. 빈 값은 여기서 다루지 않고 정렬 쪽에서 뒤로 보낸다. */
function compareComparable(a, b) {
  if ('num' in a && 'num' in b) return a.num - b.num;
  const x = 'text' in a ? a.text : String(a.num);
  const y = 'text' in b ? b.text : String(b.num);
  return x.localeCompare(y, 'ko');
}

/** 열 정의에서 그 줄의 정렬 기준값을 꺼낸다. */
function readValue(col, row, idx) {
  if (typeof col.sortValue === 'function') return col.sortValue(row, idx);
  if (typeof col.render === 'function') return nodeText(col.render(row, idx));
  if (!col.key) return null;
  // 'contract.contractNo' 처럼 점으로 이어진 경로도 읽을 수 있게 한다
  return col.key.split('.').reduce((acc, part) => (acc === null || acc === undefined ? acc : acc[part]), row);
}

/**
 * 금액·날짜 열인지 본다. 처음 누를 때의 정렬 방향을 정하는 데만 쓴다.
 * 열 정의에 numeric을 적어 두면 그대로 따르고, 없으면 실제 값이 숫자·날짜인지로 판단한다.
 */
function isNumericColumn(col, rows) {
  if (col.numeric !== undefined) return col.numeric;
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length && i < 20; i += 1) {
    const value = toComparable(readValue(col, list[i], i));
    if (value.empty) continue;
    return 'num' in value;
  }
  return false;
}

/**
 * 표 정렬 상태와 정렬된 줄을 돌려준다.
 *
 * @param {Array} rows      정렬할 줄 (검색·필터를 이미 거친 목록)
 * @param {Array} columns   [{ key, label, numeric?, sortable?, sortValue?, render? }]
 * @param {Object} options  { defaultKey, defaultOrder }
 */
export function useTableSort(rows, columns, options = {}) {
  const { defaultKey = '', defaultOrder = 'asc' } = options;
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortOrder, setSortOrder] = useState(defaultOrder);

  const sortableColumns = useMemo(
    () => (columns || []).filter((c) => c.key && c.sortable !== false),
    [columns]
  );

  const sortedRows = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    const col = sortKey ? sortableColumns.find((c) => c.key === sortKey) : null;
    if (!col) return list;

    const dir = sortOrder === 'desc' ? -1 : 1;
    return list
      .map((row, idx) => ({ row, idx, value: toComparable(readValue(col, row, idx)) }))
      .sort((a, b) => {
        // 값이 없는 줄은 오름차순이든 내림차순이든 항상 아래로 내린다.
        if (a.value.empty && b.value.empty) return a.idx - b.idx;
        if (a.value.empty) return 1;
        if (b.value.empty) return -1;
        const diff = compareComparable(a.value, b.value);
        // 같은 값이면 원래 순서를 지킨다(줄이 이유 없이 튀지 않게)
        return diff !== 0 ? diff * dir : a.idx - b.idx;
      })
      .map((entry) => entry.row);
  }, [rows, sortableColumns, sortKey, sortOrder]);

  /**
   * 머리글을 눌렀을 때. 같은 열을 다시 누르면 방향이 뒤집힌다.
   * 처음 누를 때 방향은 이름이면 가나다순(오름), 금액·날짜면 큰 값·최근 순(내림)으로 둔다.
   */
  const toggle = (key) => {
    const col = sortableColumns.find((c) => c.key === key);
    if (!col) return;
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortOrder(isNumericColumn(col, rows) ? 'desc' : 'asc');
  };

  const setSort = (key, order) => {
    setSortKey(key || '');
    setSortOrder(order === 'desc' ? 'desc' : 'asc');
  };

  const reset = () => {
    setSortKey(defaultKey);
    setSortOrder(defaultOrder);
  };

  return {
    rows: sortedRows,
    columns: sortableColumns,
    sortKey,
    sortOrder,
    toggle,
    setSort,
    reset,
    isSortable: (key) => sortableColumns.some((c) => c.key === key),
    active: sortKey !== defaultKey || sortOrder !== defaultOrder
  };
}

/**
 * 서버가 정렬해 주는 표(고객 DB처럼 페이지를 나눠 받는 목록)용.
 *
 * 줄은 건드리지 않고 정렬 상태만 들고 있는다. 화면에서 정렬하면 지금 보고 있는
 * 한 페이지 안에서만 순서가 바뀌어, 목록 전체를 정렬한 것처럼 보이지만 실제로는 아니다.
 * 정렬 기준이 바뀌면 화면이 다시 불러오도록 sortKey·sortOrder를 조회 조건에 넣어 준다.
 */
export function useServerTableSort(columns, options = {}) {
  // onChange: 정렬이 바뀔 때 알려 준다. 페이지를 1로 되돌리는 데 쓴다
  // (5쪽을 보던 중에 정렬을 바꾸면 5쪽부터 보이는 것이 아니라 처음부터 보여야 한다).
  const { defaultKey = '', defaultOrder = 'desc', onChange } = options;
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortOrder, setSortOrder] = useState(defaultOrder);

  const sortableColumns = useMemo(
    () => (columns || []).filter((c) => c.key && c.sortable !== false),
    [columns]
  );

  const toggle = (key) => {
    const col = sortableColumns.find((c) => c.key === key);
    if (!col) return;
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      onChange?.();
      return;
    }
    setSortKey(key);
    setSortOrder(col.numeric ? 'desc' : 'asc');
    onChange?.();
  };

  return {
    columns: sortableColumns,
    sortKey,
    sortOrder,
    toggle,
    setSort: (key, order) => { setSortKey(key || ''); setSortOrder(order === 'asc' ? 'asc' : 'desc'); onChange?.(); },
    reset: () => { setSortKey(defaultKey); setSortOrder(defaultOrder); onChange?.(); },
    isSortable: (key) => sortableColumns.some((c) => c.key === key),
    active: sortKey !== defaultKey || sortOrder !== defaultOrder
  };
}

export default useTableSort;
