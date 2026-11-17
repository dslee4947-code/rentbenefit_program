import { selectOptions } from './serviceHistoryFilter.js';

/**
 * 렌트 차량 AS '지난 이력' 표의 칸별 필터 줄과 '필터 결과' 표시 (대표님 2026-11-17).
 * 달력 일정 창 아래 표와 정비 기록 상세 페이지 아래 표가 같이 쓴다. 계산은 serviceHistoryFilter.js.
 */

const inputStyle = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '0.2rem 0.3rem', border: '1px solid var(--border-color)',
  borderRadius: '5px', fontSize: '0.74rem', fontWeight: 400, background: '#fff', color: 'var(--text-bright)', fontFamily: 'inherit'
};
const stack = { display: 'flex', flexDirection: 'column', gap: '0.15rem' };

/**
 * 표 머리 아래에 놓는 필터 줄 (<tr>). 칸 순서는 표 머리와 같아야 한다.
 * @param {object} props
 * @param {object[]} props.rows 기록 전체 (목록 칸의 값을 뽑는다)
 * @param {object[]} props.columns 칸 정의
 * @param {object} props.value 지금 필터
 * @param {(next: object) => void} props.onChange
 */
export function HistoryFilterRow({ rows, columns, value, onChange }) {
  const set = (key, patch) => onChange({ ...value, [key]: { ...value[key], ...patch } });
  return (
    // 줄을 누르면 기록이 열리는 표라, 필터 칸을 누른 것이 줄 클릭으로 번지지 않게 막는다
    <tr onClick={(e) => e.stopPropagation()}>
      {columns.map((c) => {
        const v = value[c.key] || {};
        let control = null;
        if (c.type === 'date') {
          control = (
            <div style={stack}>
              <input type="date" aria-label={`${c.key} 부터`} title="부터" style={inputStyle} value={v.from || ''} onChange={(e) => set(c.key, { from: e.target.value })} />
              <input type="date" aria-label={`${c.key} 까지`} title="까지" style={inputStyle} value={v.to || ''} onChange={(e) => set(c.key, { to: e.target.value })} />
            </div>
          );
        } else if (c.type === 'select') {
          control = (
            <select aria-label={`${c.key} 고르기`} style={inputStyle} value={v.value || ''} onChange={(e) => set(c.key, { value: e.target.value })}>
              <option value="">전체</option>
              {selectOptions(rows, c).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        } else if (c.type === 'range') {
          control = (
            <div style={stack}>
              <input inputMode="numeric" aria-label={`${c.key} 이상`} placeholder="이상" style={inputStyle} value={v.from || ''} onChange={(e) => set(c.key, { from: e.target.value })} />
              <input inputMode="numeric" aria-label={`${c.key} 이하`} placeholder="이하" style={inputStyle} value={v.to || ''} onChange={(e) => set(c.key, { to: e.target.value })} />
            </div>
          );
        } else if (c.type === 'text') {
          control = <input aria-label={`${c.key} 검색`} placeholder="검색" style={inputStyle} value={v.value || ''} onChange={(e) => set(c.key, { value: e.target.value })} />;
        }
        return (
          <th key={c.key} style={{ padding: '0.25rem 0.35rem', background: 'var(--bg-main)', verticalAlign: 'top', borderTop: '1px solid var(--border-color)' }}>
            {control}
          </th>
        );
      })}
    </tr>
  );
}

/** 표 제목 옆 '필터 결과 n / 전체건 · 필터 지우기' */
export function FilterBadge({ active, shown, total, onReset }) {
  if (!active) return null;
  return (
    <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--primary)', marginLeft: '0.5rem' }}>
      필터 결과 {shown} / {total}건
      <button type="button" onClick={onReset} style={{ marginLeft: '0.4rem', border: '1px solid var(--border-color)', background: '#fff', borderRadius: '5px', padding: '0.05rem 0.45rem', fontSize: '0.74rem', cursor: 'pointer', color: 'var(--text-muted)' }}>필터 지우기</button>
    </span>
  );
}
