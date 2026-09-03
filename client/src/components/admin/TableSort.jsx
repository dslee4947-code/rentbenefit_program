import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';

/**
 * 표 정렬 화면 조각.
 *
 * 정렬 상태는 useTableSort.js가 들고 있고, 여기서는 그 상태를 눌러서 바꾸는
 * 머리글·선택 상자·초기화 단추만 그린다.
 */

/** 머리글 옆 화살표. 정렬 중인 열은 진하게, 나머지는 "누르면 정렬된다"는 흐린 표시. */
export function SortArrow({ active, order }) {
  const style = { verticalAlign: '-2px', marginLeft: '3px', flexShrink: 0 };
  if (!active) return <ChevronsUpDown size={11} style={{ ...style, opacity: 0.3 }} />;
  return order === 'asc'
    ? <ArrowUp size={12} style={style} />
    : <ArrowDown size={12} style={style} />;
}

/** 눌러서 정렬되는 표 머리글. 기존 th의 style·className을 그대로 받는다. */
export function SortableTh({ sort, columnKey, style, className, children, title, ...rest }) {
  const sortable = Boolean(columnKey) && sort.isSortable(columnKey);
  const active = sortable && sort.sortKey === columnKey;
  return (
    <th
      {...rest}
      className={className}
      onClick={sortable ? () => sort.toggle(columnKey) : undefined}
      title={title || (sortable ? '눌러서 정렬 (다시 누르면 반대 방향)' : undefined)}
      style={{
        ...style,
        cursor: sortable ? 'pointer' : style?.cursor,
        userSelect: 'none',
        whiteSpace: style?.whiteSpace || 'nowrap',
        color: active ? 'var(--primary)' : style?.color
      }}
    >
      {children}
      {sortable && <SortArrow active={active} order={sort.sortOrder} />}
    </th>
  );
}

const controlStyle = {
  padding: '0.5rem 0.6rem',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  fontSize: '0.83rem',
  background: '#fff',
  color: 'var(--text-bright)',
  cursor: 'pointer'
};

/** 정렬 기준을 고르는 상자. 표 머리글을 누르는 것과 같은 상태를 공유한다. */
export function SortSelect({ sort, style, defaultLabel = '기본 정렬' }) {
  return (
    <select
      value={sort.sortKey ? `${sort.sortKey}:${sort.sortOrder}` : ''}
      onChange={(e) => {
        const [key, order] = e.target.value.split(':');
        sort.setSort(key, order);
      }}
      title="표 머리글을 눌러도 같은 기준으로 정렬됩니다"
      style={{ ...controlStyle, ...style }}
    >
      <option value="">{defaultLabel}</option>
      {sort.columns.flatMap((c) => ([
        <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} 오름차순</option>,
        <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} 내림차순</option>
      ]))}
    </select>
  );
}

/** 정렬(과 화면이 넘겨준 다른 조건)을 되돌리는 단추. 되돌릴 게 없으면 그리지 않는다. */
export function SortResetButton({ sort, onReset, show, style, label = '초기화' }) {
  const visible = show !== undefined ? show : sort?.active;
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => { sort?.reset(); onReset?.(); }}
      style={{ ...controlStyle, color: 'var(--text-muted)', fontWeight: '600', ...style }}
    >
      {label}
    </button>
  );
}

/** 정렬 상자 + 초기화 단추를 한 번에. 화면마다 두 줄로 쓰지 않도록 묶어 둔 것. */
export function SortControls({ sort, onReset, show, selectStyle, defaultLabel }) {
  return (
    <>
      <SortSelect sort={sort} style={selectStyle} defaultLabel={defaultLabel} />
      <SortResetButton sort={sort} onReset={onReset} show={show} />
    </>
  );
}
