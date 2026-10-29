import { useEffect, useMemo, useState } from 'react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * "렌트베네핏은 이렇게 벌고 쓴다" — 매출 → 영업비용·영업이익 → 남는 돈 흐름도 (대표님 2026-10-29 통계 대시보드).
 *
 * 차량 손익 원장(렌트료·단기 매출·차량 운영비)과 회사 장부(판관비·이자)를 기간별로 더한 값을 서버가 준다(/api/company-book/money-flow).
 * 차 구입·할부 상환·인수·매각 대금은 매출·비용이 아니라 흐름 밖 참고 칸으로 둔다.
 * 비용이 매출보다 큰 해(2021 시작 해)는 띠를 그릴 수 없어 표만 보여 준다.
 */

const C = {
  rev: '#2f6bd8', revBand: '#a9c3f2',
  profit: '#22915f', profitBand: '#a6dcc2',
  cost: '#b8342c', costBand: '#e9aaa5',
  muted: '#5d6470'
};

const won = (v) => {
  const a = Math.abs(v) / 10000;
  const s = a >= 10000 ? `${(a / 10000).toFixed(a >= 100000 ? 1 : 2)}억 원` : `${Math.round(a).toLocaleString()}만 원`;
  return (v < 0 ? '−' : '') + s;
};
const pct = (v, base) => (base ? `${((v / base) * 100).toFixed(1)}%` : '-');

const W = 1160; const H = 700; const NODE_W = 14; const TOP = 70; const BOTTOM = 30;
const COL_X = [190, 450, 720, 940];
const GAP = [26, 0, 40, 10];
const MIN_SLOT = [52, 0, 0, 30];

function totals(d) {
  const revenue = d.income.reduce((s, [, v]) => s + v, 0);
  const cost = d.costs.reduce((s, [, v]) => s + v, 0);
  const op = revenue - cost;
  return { revenue, cost, op, net: op - d.interest + d.refund };
}

function layout(d) {
  const { revenue, cost, op } = totals(d);
  const nodes = [
    ...d.income.map(([label], i) => ({ id: `in${i}`, col: 0, label, kind: 'rev' })),
    { id: 'rev', col: 1, label: '영업수익', kind: 'rev', big: true },
    ...(d.refund > 0 ? [{ id: 'refund', col: 2, label: '보험료 환급 등 (영업외)', kind: 'profit', gapAfter: 120 }] : []),
    { id: 'op', col: 2, label: '영업이익', kind: 'profit', big: true, rate: `영업이익률 ${pct(op, revenue)}` },
    { id: 'cost', col: 2, label: '영업비용', kind: 'cost', big: true },
    { id: 'net', col: 3, label: '남는 돈', kind: 'profit', big: true },
    ...(d.interest > 0 ? [{ id: 'int', col: 3, label: '대출 이자', kind: 'cost' }] : []),
    ...d.costs.map(([label], i) => ({ id: `c${i}`, col: 3, label, kind: 'cost' }))
  ];
  const links = [
    ...d.income.map(([, v], i) => ({ s: `in${i}`, t: 'rev', v, kind: 'rev' })),
    { s: 'rev', t: 'op', v: op, kind: 'profit' },
    { s: 'rev', t: 'cost', v: cost, kind: 'cost' },
    ...(d.refund > 0 ? [{ s: 'refund', t: 'net', v: d.refund, kind: 'profit' }] : []),
    { s: 'op', t: 'net', v: op - Math.max(0, d.interest), kind: 'profit' },
    ...(d.interest > 0 ? [{ s: 'op', t: 'int', v: d.interest, kind: 'cost' }] : []),
    ...d.costs.map(([, v], i) => ({ s: 'cost', t: `c${i}`, v, kind: 'cost' }))
  ];

  const byId = Object.fromEntries(nodes.map((n) => [n.id, { ...n, in: 0, out: 0 }]));
  links.forEach((l) => { byId[l.s].out += l.v; byId[l.t].in += l.v; });
  Object.values(byId).forEach((n) => { n.value = Math.max(n.in, n.out); });

  // 한 열의 높이 합이 가장 큰 열에 맞춰 축척을 정한다
  const cols = [0, 1, 2, 3].map((c) => nodes.filter((n) => n.col === c).map((n) => byId[n.id]));
  const k = Math.min(...cols.map((list, c) => {
    const fixed = GAP[c] * (list.length - 1) + MIN_SLOT[c] * list.length + list.reduce((s, n) => s + (n.gapAfter || 0), 0);
    return (H - TOP - BOTTOM - fixed) / list.reduce((s, n) => s + n.value, 0);
  }));
  cols.forEach((list, c) => {
    const slots = list.map((n) => Math.max(n.value * k, MIN_SLOT[c]));
    const total = slots.reduce((s, h) => s + h, 0) + GAP[c] * (list.length - 1) + list.reduce((s, n) => s + (n.gapAfter || 0), 0);
    let y = TOP + (H - TOP - BOTTOM - total) / 2;
    list.forEach((n, i) => {
      n.h = Math.max(n.value * k, 1.5);
      n.y = y + (slots[i] - n.h) / 2;
      n.x = COL_X[c];
      n.outY = n.y; n.inY = n.y;
      y += slots[i] + GAP[c] + (n.gapAfter || 0);
    });
  });

  const bands = links.map((l) => {
    const s = byId[l.s]; const t = byId[l.t];
    const h = l.v * k;
    const x0 = s.x + NODE_W; const x1 = t.x;
    const y0 = s.outY; const y1 = t.inY;
    s.outY += h; t.inY += h;
    const mx = (x0 + x1) / 2;
    return {
      key: `${l.s}-${l.t}`,
      d: `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z`,
      fill: C[`${l.kind}Band`],
      tip: `${s.label} → ${t.label}: ${won(l.v)} (영업수익의 ${pct(l.v, revenue)})`
    };
  });
  return { nodes: Object.values(byId), bands };
}

const display = { fontWeight: 800 };

function NodeLabel({ n, revenue, net }) {
  const color = C[n.kind];
  const cy = n.y + n.h / 2;
  if (n.col === 0) {
    return (
      <>
        <text x={n.x - 12} y={cy - 4} textAnchor="end" fill={color} fontSize={19} style={display}>{n.label}</text>
        <text x={n.x - 12} y={cy + 18} textAnchor="end" fill={color} fontSize={19} style={display}>{won(n.value)}</text>
      </>
    );
  }
  if (n.col === 3) {
    return (
      <>
        <text x={n.x + NODE_W + 10} y={cy - (n.big ? 8 : 2)} fill={color} fontSize={n.big ? 24 : 14} style={display}>{n.label}</text>
        <text x={n.x + NODE_W + 10} y={cy + (n.big ? 20 : 13)} fill={color} fontSize={n.big ? 24 : 13} fontWeight={n.big ? 800 : 600}>{won(n.value)}</text>
        {n.id === 'net' && <text x={n.x + NODE_W + 10} y={cy + 40} fill={C.muted} fontSize={13}>수익률 {pct(net, revenue)}</text>}
      </>
    );
  }
  if (n.id === 'refund') {
    return <text x={n.x - 10} y={cy + 5} textAnchor="end" fill={color} fontSize={14} style={display}>{n.label} {won(n.value)}</text>;
  }
  const cx = n.x + NODE_W / 2;
  const size = n.big ? (n.col === 1 ? 32 : 26) : 13;
  if (n.id === 'cost') {
    return (
      <>
        <text x={cx - 18} y={cy - 6} textAnchor="end" fill={color} fontSize={size} fontWeight={900}>{n.label}</text>
        <text x={cx - 18} y={cy + size} textAnchor="end" fill={color} fontSize={size} fontWeight={900}>{won(n.value)}</text>
      </>
    );
  }
  const base = n.y - (n.rate ? 26 : 12);
  return (
    <>
      <text x={cx} y={base - size - 4} textAnchor="middle" fill={color} fontSize={size} fontWeight={900}>{n.label}</text>
      <text x={cx} y={base} textAnchor="middle" fill={color} fontSize={size} fontWeight={900}>{won(n.value)}</text>
      {n.rate && <text x={cx} y={n.y - 8} textAnchor="middle" fill={C.muted} fontSize={13}>{n.rate}</text>}
    </>
  );
}


// ───────────── 현금 기준: 남는 돈에서 차 구입을 빼고, 모자란 돈을 어디서 메웠는지 가로 폭포 그림으로
const WF_W = 1160; const WF_LABEL = 300; const WF_VALUE = 130; const WF_ROW = 34; const WF_BAR = 20;

function cashSteps(d, net) {
  const afterCars = net - d.carBuy - d.loanRepay + d.sale;
  const funded = d.funding.reduce((s, [, v]) => s + v, 0);
  const gap = -(afterCars + funded);
  const steps = [
      { label: '차를 굴려서 남은 돈', v: net, kind: 'profit' },
      { label: '새 차 구입', v: -d.carBuy, kind: 'cost' },
      ...(d.loanRepay ? [{ label: '차량 할부 상환 (캐피탈·할부)', v: -d.loanRepay, kind: 'cost' }] : []),
      ...(d.sale ? [{ label: '인수·매각으로 돌려받음', v: d.sale, kind: 'profit' }] : []),
      { label: '차 구입까지 넣은 결과', v: afterCars, total: true },
      ...d.funding.map(([label, v]) => ({ label, v, kind: 'fund' })),
      ...(Math.abs(gap) >= 10000 ? [{ label: gap > 0 ? '장부에 없는 돈 (통장 잔액·대출·할부 차값 등)' : '장부에 없이 남은 돈 (통장 잔액 증가 등)', v: gap, kind: 'gap' }] : []),
      { label: '맞춘 결과', v: 0, total: true }
  ];
  // 막대마다 시작·끝 위치. 합계 줄은 0에서, 나머지는 앞 줄이 끝난 곳에서 이어진다
  const rows = [];
  let run = 0;
  for (const st of steps) {
    const from = st.total ? 0 : run;
    const to = st.total ? st.v : run + st.v;
    if (!st.total) run = to;
    rows.push({ ...st, from, to });
  }
  return { afterCars, gap, rows };
}

function CashWaterfall({ cash }) {
  const { rows } = cash;
  const lo = Math.min(0, ...rows.map((r) => Math.min(r.from, r.to)));
  const hi = Math.max(0, ...rows.map((r) => Math.max(r.from, r.to)));
  const x0 = WF_LABEL; const x1 = WF_W - WF_VALUE;
  const X = (v) => x0 + ((v - lo) / (hi - lo || 1)) * (x1 - x0);
  const H2 = rows.length * WF_ROW + 30;
  const color = (r) => (r.total ? (r.v < 0 ? C.cost : '#334155')
    : r.kind === 'gap' ? '#9ca3af' : r.kind === 'fund' ? (r.v >= 0 ? C.rev : C.cost) : r.v >= 0 ? C.profit : C.cost);
  return (
    <svg viewBox={`0 0 ${WF_W} ${H2}`} style={{ width: '100%', minWidth: '760px', height: 'auto', display: 'block' }} role="img" aria-label="현금 기준 돈 흐름">
      <line x1={X(0)} x2={X(0)} y1={6} y2={H2 - 20} stroke="#94a3b8" strokeDasharray="3 3" />
      <text x={X(0)} y={H2 - 6} textAnchor="middle" fill={C.muted} fontSize={12}>0</text>
      {rows.map((r, i) => {
        const y = 10 + i * WF_ROW;
        const a = X(Math.min(r.from, r.to)); const b = X(Math.max(r.from, r.to));
        const fund = r.kind === 'fund' || r.kind === 'gap';
        return (
          <g key={r.label}>
            {r.total && <line x1={0} x2={WF_W} y1={y - 5} y2={y - 5} stroke="var(--border-color)" />}
            {r.kind === 'fund' && i > 0 && rows[i - 1].total && <text x={4} y={y - 9} fill={C.rev} fontSize={12} fontWeight={800}>{cash.afterCars < 0 ? '모자란 돈을 메운 곳' : '그 밖에 오고 간 돈'}</text>}
            <text x={WF_LABEL - 12} y={y + WF_BAR / 2 + 5} textAnchor="end" fill={r.total ? 'var(--text-main)' : fund ? C.muted : 'var(--text-main)'} fontSize={r.total ? 15 : 14} fontWeight={r.total ? 900 : 700}>{r.label}</text>
            <rect x={a} y={y} width={Math.max(b - a, 2)} height={WF_BAR} rx={3} fill={color(r)} fillOpacity={r.kind === 'gap' ? 0.6 : 1} />
            <text x={WF_W - 4} y={y + WF_BAR / 2 + 5} textAnchor="end" fill={color(r)} fontSize={14} fontWeight={800}>
              {r.total && r.v === 0 ? '0' : `${r.v > 0 && !r.total ? '+' : ''}${won(r.v)}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const card = { background: 'var(--bg-surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)' };
const chip = (on) => ({ padding: '0.3rem 0.8rem', borderRadius: '999px', border: `1px solid ${on ? 'var(--primary)' : 'var(--border-color)'}`, background: on ? 'var(--primary)' : 'transparent', color: on ? '#fff' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' });
const td = { padding: '0.3rem 0.6rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem' };

function MoneyFlowCard({ showToast }) {
  const [periods, setPeriods] = useState(null);
  const [key, setKey] = useState('last12');
  const [tip, setTip] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const [mode, setMode] = useState('flow'); // flow: 장사 흐름, cash: 통장 기준(차 구입 포함)

  useEffect(() => {
    fetch(`${API_HOST}/api/company-book/money-flow`)
      .then((r) => r.json())
      .then((d) => { if (!d.success) throw new Error(d.message); setPeriods(d.periods); })
      .catch((err) => showToast?.(err.message || '돈 흐름을 불러오지 못했습니다.', 'error'));
  }, [showToast]);

  const d = periods?.find((p) => p.key === key) || periods?.[periods.length - 1];
  const t = useMemo(() => (d ? totals(d) : null), [d]);
  const chart = useMemo(() => (d && t.op - Math.max(0, d.interest) >= 0 ? layout(d) : null), [d, t]);

  const cash = useMemo(() => (d ? cashSteps(d, t.net) : null), [d, t]);

  if (!periods) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: '0.9rem' }}>돈 흐름을 계산하는 중…</div>;
  if (!d) return null;

  const rows = [
    ['매출', '', ''],
    ...d.income.map(([l, v]) => ['', l, v]),
    ['', '영업수익 합계', t.revenue],
    ['영업비용', '', ''],
    ...d.costs.map(([l, v]) => ['', l, v]),
    ['', '영업비용 합계', t.cost],
    ['', t.op >= 0 ? '영업이익' : '영업손실', t.op],
    ['영업외', '보험료 환급 등', d.refund],
    ['', '대출 이자', -d.interest],
    ['', '남는 돈', t.net]
  ];
  const notes = [
    ['남는 돈', won(t.net), `영업수익 ${won(t.revenue)} 중 ${pct(t.net, t.revenue)}`],
    ['새 차 구입 (재투자)', won(d.carBuy), d.carBuy > t.net ? `남는 돈보다 ${won(d.carBuy - t.net)} 더 씀 — 담보대출·대표님 차입금·보증금으로 메움` : '남는 돈 안에서 삼'],
    ['차량 할부 상환', won(d.loanRepay), '캐피탈·할부 차의 원금·이자. 흐름에는 넣지 않음'],
    ['인수·매각으로 회수', won(d.sale), '고객 인수가·매각 대금. 차값 회수라 매출에서 뺌']
  ];

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>렌트베네핏은 이렇게 벌고 쓴다</h3>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {d.range} · 차량 손익 원장 + 회사 장부{mode === 'flow' ? ' · 띠에 마우스를 올리면 금액' : ''}
          </div>
          <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.5rem' }} role="group" aria-label="보는 기준">
            <button type="button" style={chip(mode === 'flow')} aria-pressed={mode === 'flow'} onClick={() => setMode('flow')}>장사 흐름 (차 구입 제외)</button>
            <button type="button" style={chip(mode === 'cash')} aria-pressed={mode === 'cash'} onClick={() => setMode('cash')}>현금 기준 (차 구입 포함)</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }} role="group" aria-label="기간">
          {periods.map((p) => (
            <button key={p.key} type="button" style={chip(p.key === d.key)} aria-pressed={p.key === d.key} onClick={() => setKey(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'cash' ? (
        <>
          <div style={{ margin: '0.8rem 0 0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            장사로 남은 돈에서 차 산 돈을 빼면 <b style={{ color: cash.afterCars < 0 ? C.cost : C.profit }}>{won(cash.afterCars)}</b>입니다.
            {cash.afterCars < 0 && ' 모자란 돈은 아래처럼 보증금·차입금·대출로 메웠습니다.'}
          </div>
          <div style={{ overflowX: 'auto' }}><CashWaterfall cash={cash} /></div>
          {cash.gap >= 10000 && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              회색 '장부에 없는 돈'은 회사 장부·원장에 적히지 않은 돈입니다. 그해 통장에 있던 돈을 쓴 것, 장부에 없는 담보대출,
              캐피탈이 차값을 대신 내 준 할부 차(원장에는 차값 전체가 적힘) 등이 섞여 있습니다. 자금팀 일일업무보고·통장 잔액을 받으면 나눠 보여 드립니다(할 일 30번).
            </div>
          )}
        </>
      ) : (
        <>
      {chart ? (
          <div style={{ position: 'relative', overflowX: 'auto', marginTop: '0.5rem' }} onMouseLeave={() => setTip(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: '760px', height: 'auto', display: 'block' }} role="img" aria-label={`영업수익 ${won(t.revenue)}, 영업비용 ${won(t.cost)}, 남는 돈 ${won(t.net)}`}>
              {chart.bands.map((b) => (
                <path
                  key={b.key}
                  d={b.d}
                  fill={b.fill}
                  fillOpacity={tip?.key === b.key ? 1 : 0.85}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.ownerSVGElement.parentNode.getBoundingClientRect();
                    setTip({ key: b.key, text: b.tip, x: e.clientX - r.left, y: e.clientY - r.top });
                  }}
                />
              ))}
              {chart.nodes.map((n) => (
                <g key={n.id}>
                  <rect x={n.x} y={n.y} width={NODE_W} height={n.h} rx={2} fill={C[n.kind]} />
                  <NodeLabel n={n} revenue={t.revenue} net={t.net} />
                </g>
              ))}
            </svg>
            {tip && (
              <div style={{ position: 'absolute', left: tip.x + 12, top: tip.y + 12, background: '#111827', color: '#fff', padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                {tip.text}
              </div>
            )}
          </div>
        ) : (
          <div style={{ margin: '1rem 0', padding: '0.8rem 1rem', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', fontSize: '0.85rem', color: '#9a3412' }}>
            이 기간은 비용이 매출보다 커서(시작 해) 흐름도 대신 아래 표로 보여 줍니다.
          </div>
        )}
  
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.7rem', marginTop: '0.8rem' }}>
          {notes.map(([k, v, p]) => (
            <div key={k} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 700 }}>{k}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{v}</div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{p}</div>
            </div>
          ))}
        </div>
  
        {(showTable || !chart) ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.8rem' }}>
            <thead>
              <tr>
                {['구분', '항목', '금액', '영업수익 대비'].map((h, i) => (
                  <th key={h} style={{ ...td, fontWeight: 800, background: 'var(--bg-main)', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([g, l, v], i) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 700 }}>{g}</td>
                  <td style={{ ...td, fontWeight: /합계|이익|손실|남는/.test(l) ? 800 : 400 }}>{l}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{v === '' ? '' : won(v)}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--text-muted)' }}>{v === '' ? '' : pct(v, t.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {chart && (
          <button type="button" onClick={() => setShowTable((v) => !v)} style={{ marginTop: '0.6rem', background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', padding: 0 }}>
            {showTable ? '표 닫기' : '표로 보기'}
          </button>
        )}
        </>
      )}
    </div>
  );
}

export default MoneyFlowCard;
