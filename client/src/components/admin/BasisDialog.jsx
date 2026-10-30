import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

/**
 * 숫자 카드의 근거 창 (대표님 2026-10-30).
 * 카드 숫자에 들어간 줄을 엑셀처럼 표로 보여 주고, 구분별 합계와 누적, 카드 숫자와 맞는지를 함께 보여 준다.
 *
 * spec:
 *   title, formula: 제목과 계산 방법
 *   rows: 근거 줄 (불러오는 중이면 null)
 *   columns: [{ h, get(row), money?, num?, strong?, wrap? }]
 *   amount(row): 합계·누적에 더할 값 (없으면 줄 수를 센다)
 *   counted(row): 카드 숫자에 넣는 줄인지 (기본: 전부). 안 넣는 줄은 흐리게 보인다
 *   groupBy(row): 구분별 합계의 묶음 이름
 *   expected, expectedLabel: 카드에 보이는 값. 합계와 맞는지 표시한다
 *   warn(row): 빨갛게 표시할 줄 (월 렌트료 0원 등)
 *   goLabel, onGo: 해당 화면으로 가는 버튼
 */
const won = (n) => (n ? Math.round(n).toLocaleString() : '-');
const th = { padding: '0.45rem 0.55rem', fontSize: '0.76rem', fontWeight: 800, background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', whiteSpace: 'nowrap', position: 'sticky', top: 0, textAlign: 'right' };
const td = { padding: '0.35rem 0.55rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', whiteSpace: 'nowrap', textAlign: 'right' };
const btn = { padding: '0.4rem 0.9rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-surface)', fontWeight: 700, cursor: 'pointer', color: 'var(--text-main)' };
const all = () => true;

function BasisDialog({ spec, onClose }) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { rows, columns, amount, counted = all, groupBy } = spec;
  const hasAmount = !!amount;

  // 누적은 표에 보이는 순서대로 쌓는다. 카드에 넣지 않는 줄은 누적에 더하지 않는다
  const list = useMemo(() => {
    const out = [];
    for (const r of rows || []) {
      const inc = counted(r);
      const v = inc && hasAmount ? amount(r) : 0;
      out.push({ r, inc, v, run: (out.length ? out[out.length - 1].run : 0) + v });
    }
    return out;
  }, [rows, counted, amount, hasAmount]);

  const groups = useMemo(() => {
    if (!groupBy) return [];
    const m = new Map();
    // 카드에 넣지 않는 줄도 묶음으로 보여 준다(출고 대기 차 몇 대인지 등). 금액은 카드에 넣는 줄만
    for (const x of list) {
      const k = `${groupBy(x.r)}${x.inc ? '' : ' (카드 숫자에 안 넣음)'}`;
      const g = m.get(k) || { k, n: 0, v: 0, inc: x.inc };
      g.n += 1;
      g.v += x.inc && hasAmount ? amount(x.r) : 0;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.inc - a.inc);
  }, [list, groupBy, amount, hasAmount]);

  const words = q.trim().toLowerCase();
  const shown = words ? list.filter((x) => columns.map((c) => String(c.get(x.r) ?? '')).join(' ').toLowerCase().includes(words)) : list;
  const inc = list.filter((x) => x.inc);
  const total = hasAmount ? inc.reduce((s, x) => s + x.v, 0) : inc.length;
  const matches = spec.expected === undefined || Math.round(total) === Math.round(spec.expected);

  const download = () => {
    const wb = XLSX.utils.book_new();
    const head = ['번호', ...columns.map((c) => c.h), ...(hasAmount ? ['누적'] : []), '카드에 포함'];
    const body = list.map((x, i) => [i + 1, ...columns.map((c) => c.get(x.r) ?? ''), ...(hasAmount ? [x.run] : []), x.inc ? 'O' : 'X']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[spec.title], [`계산: ${spec.formula}`], [`합계: ${total}`], [], head, ...body]), '근거 줄');
    if (groups.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['구분', '건수', ...(hasAmount ? ['금액'] : [])], ...groups.map((g) => [g.k, g.n, ...(hasAmount ? [g.v] : [])])]), '구분별');
    }
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `대시보드_근거_${spec.title.replace(/[\\/:*?"<>|\s]+/g, '_')}_${stamp}.xlsx`);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3vh 1rem', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem 1.2rem', width: 'min(1300px, 100%)', display: 'flex', flexDirection: 'column', gap: '0.9rem', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.8rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 400px' }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-bright)' }}>{spec.title} — 근거</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.6 }}>{spec.formula}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-bright)' }}>{hasAmount ? `${won(total)}원` : `${total.toLocaleString()}${spec.unit || '건'}`}</div>
            {rows && spec.expected !== undefined && (
              <div style={{ fontSize: '0.74rem', color: matches ? '#15803d' : '#b91c1c', fontWeight: 700 }}>
                {matches ? `✓ 카드 숫자(${spec.expectedLabel})와 같습니다` : `카드 숫자 ${spec.expectedLabel}와 다릅니다 — 새로고침 후 다시 확인해 주세요`}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={btn} disabled={!rows?.length} onClick={download}>엑셀로 받기</button>
          {spec.onGo && <button type="button" style={btn} onClick={() => { onClose(); spec.onGo(); }}>{spec.goLabel || '화면으로 가기'}</button>}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="차종·번호·계약자 찾기" style={{ ...btn, fontWeight: 400, width: '200px', cursor: 'text' }} />
          <button type="button" onClick={onClose} style={{ ...btn, marginLeft: 'auto', border: 'none', background: 'var(--primary)', color: '#fff' }}>닫기</button>
        </div>

        {rows === null ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>근거 줄을 불러오는 중…</div>
        ) : (
          <>
            {groups.length > 0 && (
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.84rem', marginBottom: '0.3rem' }}>구분별 합계</div>
                <div style={{ overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, textAlign: 'left', width: '40%' }}>구분</th>
                        <th style={th}>건수</th>
                        {hasAmount && <th style={th}>금액</th>}
                        {hasAmount && <th style={th}>비율</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.k} style={{ opacity: g.inc ? 1 : 0.55 }}>
                          <td style={{ ...td, textAlign: 'left' }}>{g.k}</td>
                          <td style={td}>{g.n.toLocaleString()}</td>
                          {hasAmount && <td style={{ ...td, fontWeight: 700 }}>{won(g.v)}</td>}
                          {hasAmount && <td style={{ ...td, color: 'var(--text-muted)' }}>{total && g.inc ? `${Math.round((g.v / total) * 100)}%` : '-'}</td>}
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 800, background: 'var(--bg-main)' }}>
                        <td style={{ ...td, textAlign: 'left' }}>카드 숫자 합계</td>
                        <td style={td}>{inc.length.toLocaleString()}</td>
                        {hasAmount && <td style={td}>{won(total)}</td>}
                        {hasAmount && <td style={td}>100%</td>}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <div style={{ fontWeight: 800, fontSize: '0.84rem', marginBottom: '0.3rem' }}>
                {spec.rowsLabel || '더한 줄'} {inc.length.toLocaleString()}개
                {list.length > inc.length && <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}> · 흐린 줄 {list.length - inc.length}개는 {spec.excludedNote || '카드 숫자에 넣지 않은 줄'}입니다</span>}
                {words && <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}> · 찾은 줄 {shown.length}개</span>}
              </div>
              <div style={{ overflow: 'auto', maxHeight: '60vh', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={th}>#</th>
                      {columns.map((c) => <th key={c.h} style={{ ...th, textAlign: c.money || c.num ? 'right' : 'left' }}>{c.h}</th>)}
                      {hasAmount && <th style={th}>누적</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.length === 0 && <tr><td colSpan={columns.length + 2} style={{ ...td, textAlign: 'left', color: 'var(--text-muted)' }}>해당하는 줄이 없습니다.</td></tr>}
                    {shown.map((x) => {
                      const i = list.indexOf(x);
                      return (
                        <tr key={i} style={{ opacity: x.inc ? 1 : 0.45, background: spec.warn?.(x.r) ? '#fef2f2' : undefined }}>
                          <td style={{ ...td, color: 'var(--text-muted)' }}>{i + 1}</td>
                          {columns.map((c) => {
                            const v = c.get(x.r);
                            return <td key={c.h} style={{ ...td, textAlign: c.money || c.num ? 'right' : 'left', fontWeight: c.strong ? 700 : undefined, whiteSpace: c.wrap ? 'normal' : 'nowrap' }}>{c.money ? won(v) : v}</td>;
                          })}
                          {hasAmount && <td style={td}>{won(x.run)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {spec.note && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{spec.note}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export default BasisDialog;
