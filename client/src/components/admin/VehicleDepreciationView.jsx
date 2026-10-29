import { useEffect, useMemo, useState } from 'react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * 차량별 감가상각 (관리용).
 *
 * 차를 산 돈을 쓰는 동안 매달 나눠 비용으로 본다. 현금으로는 남아도 차값이 줄어드는 것까지 치면 남는지 보려는 화면이다.
 * 계산 규칙은 shared/vehicleDepreciation.js 하나에 있다(대표님 2026-10-28: 인수가 없는 차는 5년·잔존 20%).
 */

const man = (n) => {
  const v = Math.round((Number(n) || 0) / 10000);
  return v ? v.toLocaleString() : '-';
};
const won = (n) => (Number(n) ? Math.round(n).toLocaleString() : '-');
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

const card = { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.1rem' };
const th = { padding: '0.45rem 0.55rem', fontSize: '0.76rem', fontWeight: '800', background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', textAlign: 'right', whiteSpace: 'nowrap', position: 'sticky', top: 0, cursor: 'pointer', userSelect: 'none' };
const td = { padding: '0.35rem 0.55rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', textAlign: 'right', whiteSpace: 'nowrap' };
const tabBtn = (active) => ({ padding: '0.45rem 1rem', border: 'none', borderBottom: active ? '3px solid var(--primary)' : '3px solid transparent', background: 'none', fontWeight: active ? '800' : '600', color: active ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem' });

const KINDS = ['인수형', '반납형', '단기'];
const KIND_COLOR = { 인수형: '#1e3a8a', 반납형: '#b45309', 단기: '#047857' };

const COLUMNS = [
  { key: 'ledgerNo', label: '갑지', left: true },
  { key: 'customerName', label: '고객', left: true },
  { key: 'car', label: '차량', left: true },
  { key: 'kind', label: '구분', left: true },
  { key: 'cost', label: '취득원가' },
  { key: 'residual', label: '잔존가치' },
  { key: 'months', label: '기간' },
  { key: 'elapsed', label: '지난 개월' },
  { key: 'monthly', label: '월 감가상각' },
  { key: 'book', label: '장부가' },
  { key: 'revenue', label: '월 매출' },
  { key: 'margin', label: '매출 − 감가' }
];

function Kpi({ label, value, sub }) {
  return (
    <div style={card}>
      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: '600' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: '800' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function VehicleDepreciationView({ showToast }) {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'monthly', desc: true });

  useEffect(() => {
    fetch(`${API_HOST}/api/company-book/depreciation`)
      .then((r) => r.json())
      .then((d) => { if (!d.success) throw new Error(d.message); setData(d); })
      .catch((err) => showToast(err.message || '감가상각을 불러오지 못했습니다.', 'error'));
  }, [showToast]);

  const rows = useMemo(() => (data?.rows || []).map((r) => ({ ...r, margin: r.kind === '단기' ? null : r.revenue - r.monthly })), [data]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    const list = rows.filter((r) => (!kind || r.kind === kind)
      && (!words || `${r.ledgerNo} ${r.customerName} ${r.car}`.toLowerCase().includes(words)));
    const { key, desc } = sort;
    return list.sort((a, b) => {
      const x = a[key] ?? -Infinity; const y = b[key] ?? -Infinity;
      const c = typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y;
      return desc ? -c : c;
    });
  }, [rows, kind, q, sort]);

  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>감가상각을 계산하는 중…</div>;

  const sum = (k, list = rows) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const longRows = rows.filter((r) => r.kind !== '단기');
  const longMargin = sum('revenue', longRows) - sum('monthly', longRows);
  const { returnMonths, residualRate } = data.rule;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ ...card, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <b style={{ color: 'var(--text-main)' }}>계산 기준</b> (관리용 · 세무 장부와 다름 · {ymd(data.asOf)} 기준 운용 중인 차)
        <div>· <b style={{ color: KIND_COLOR.인수형 }}>인수형</b> — 장기렌트·인수가 있음: (취득원가 − 인수가) ÷ 계약 개월, 첫 계약 시작일부터</div>
        <div>· <b style={{ color: KIND_COLOR.반납형 }}>반납형</b>·<b style={{ color: KIND_COLOR.단기 }}>단기</b> — {returnMonths / 12}년({returnMonths}개월), 끝에 취득원가의 {Math.round(residualRate * 100)}%가 남는다고 보고 등록일부터</div>
        <div>· 취득원가 = 원장의 차량가·계약금·등록비용·제세공과 · 할부 원금은 차값을 나눠 내는 것이라 비용 아님 · 월 매출 = 월 렌트료 + 선납금 ÷ 계약 개월</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.7rem' }}>
        <Kpi label="한 달 감가상각" value={`${man(sum('monthly'))}만`} sub={`${rows.length}대`} />
        {KINDS.map((k) => {
          const list = rows.filter((r) => r.kind === k);
          return <Kpi key={k} label={`${k} 월 감가상각`} value={`${man(sum('monthly', list))}만`} sub={`${list.length}대`} />;
        })}
        <Kpi label="장부가 (남은 차값)" value={`${(sum('book') / 1e8).toFixed(1)}억`} sub={`취득원가 ${(sum('cost') / 1e8).toFixed(1)}억`} />
        <Kpi label="장기 월 매출 − 감가상각" value={`${man(longMargin)}만`} sub="보험·판관비·이자 빼기 전" />
      </div>

      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
        {['', ...KINDS].map((k) => (
          <button key={k || 'all'} type="button" style={tabBtn(kind === k)} onClick={() => setKind(k)}>
            {k || '전체'} {k ? rows.filter((r) => r.kind === k).length : rows.length}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="갑지·고객·차량 찾기"
          style={{ marginLeft: 'auto', padding: '0.35rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }}
        />
      </div>

      <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: '70vh' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  style={{ ...th, textAlign: c.left ? 'left' : 'right' }}
                  onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : !c.left }))}
                >
                  {c.label}{sort.key === c.key ? (sort.desc ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{r.ledgerNo}</td>
                <td style={{ ...td, textAlign: 'left' }}>{r.customerName}</td>
                <td style={{ ...td, textAlign: 'left' }}>{r.car}</td>
                <td style={{ ...td, textAlign: 'left', color: KIND_COLOR[r.kind], fontWeight: 700 }}>{r.kind}</td>
                <td style={td}>{won(r.cost)}</td>
                <td style={td}>{won(r.residual)}</td>
                <td style={td}>{r.months}개월</td>
                <td style={td} title={`시작 ${ymd(r.start)}`}>{r.elapsed}개월</td>
                <td style={{ ...td, fontWeight: 700 }}>{won(r.monthly)}</td>
                <td style={td}>{won(r.book)}</td>
                <td style={td}>{r.kind === '단기' ? '-' : won(r.revenue)}</td>
                <td style={{ ...td, fontWeight: 700, color: r.margin == null ? 'var(--text-muted)' : r.margin < 0 ? '#d9534f' : 'var(--text-main)' }}>
                  {r.margin == null ? '-' : won(r.margin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.skipped.length > 0 && (
        <div style={{ ...card, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <b>계산에서 빠진 차 {data.skipped.length}대</b>
          {data.skipped.map((s) => <div key={s.id}>· {s.ledgerNo} {s.customerName} — {s.reason}</div>)}
        </div>
      )}
    </div>
  );
}

export default VehicleDepreciationView;
