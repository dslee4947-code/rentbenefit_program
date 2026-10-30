import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, Plus, Trash2, EyeOff, Eye, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toCommaString, parseNumber } from '../../utils/format.js';
import { COMPANY_ACCOUNTS, COMPANY_SECTIONS, accountOf, signedAmount } from '../../../../shared/companyAccounts.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * 회사 장부.
 *
 * 차 한 대에 속하지 않는 회사의 돈(월급·임대료·세무사비·대출이자·대표 차입금·부가세 …)을 계정별로 모아 본다.
 * 자금팀 엑셀 "렌트베네핏 입출금 리스트"를 올려 채우고, 엑셀에 없는 줄은 여기서 직접 적는다.
 * 계정마다 재무제표의 어느 칸인지 정해져 있어(shared/companyAccounts.js), 비용과 비용이 아닌 돈(빌린 돈·부가세·보증금)을 나눠 보여 준다.
 */

// 표는 만 원 단위로 보여 준다. 대표 차입금이 수십억이라 원 단위로는 칸이 넘친다
const man = (n) => {
  const v = Math.round((Number(n) || 0) / 10000);
  return v ? v.toLocaleString() : '-';
};
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const ymd = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const PNL_SECTIONS = COMPANY_SECTIONS.filter((s) => s.pnl).map((s) => s.key);
const LABOR = ['salary', 'payroll'];

const card = { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.1rem' };
const th = { padding: '0.45rem 0.55rem', fontSize: '0.76rem', fontWeight: '800', background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', textAlign: 'right', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const td = { padding: '0.35rem 0.55rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', textAlign: 'right', whiteSpace: 'nowrap' };
const inp = (w, right) => ({ width: w, padding: '0.3rem 0.4rem', border: '1px solid var(--border-color)', borderRadius: '5px', fontSize: '0.8rem', textAlign: right ? 'right' : 'left', background: 'var(--bg-surface)', color: 'var(--text-main)' });
const tabBtn = (active) => ({ padding: '0.45rem 1rem', border: 'none', borderBottom: active ? '3px solid var(--primary)' : '3px solid transparent', background: 'none', fontWeight: active ? '800' : '600', color: active ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem' });

function Kpi({ label, value, sub, warn, onClick }) {
  return (
    <div style={{ ...card, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick} title={onClick ? '눌러서 이 금액이 나온 근거 보기' : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: '600' }}>
        <span>{label}</span>
        {onClick && <span style={{ color: 'var(--primary)', whiteSpace: 'nowrap' }}>근거 보기 ›</span>}
      </div>
      <div style={{ fontSize: '1.35rem', fontWeight: '800', color: warn ? '#d9534f' : 'var(--text-main)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

// ───────────────────────── 숫자 카드의 근거 (어느 줄을 어떻게 더했나)

const sourceOf = (t) => (t.source === 'excel' ? `${t.sourceSheet || ''} › ${t.sourceColumn || ''}${t.sourceRow ? ` · ${t.sourceRow}행` : ''}` : '직접 입력');

/**
 * 요약 카드를 누르면 뜨는 창. 카드 금액에 들어간 줄을 날짜순으로 모두 보여 주고,
 * 계정별·엑셀 칸별·기간별로 나눠 더한 표와 누적 합계를 같이 보여 준다. 엑셀로도 받을 수 있다.
 * spec: { title, formula, year(없으면 전체 기간), accounts[], value(카드 금액), byYear(기간 표를 연도별로) }
 */
function SourceDialog({ spec, onClose, onOpenAccount, showToast }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    const qs = new URLSearchParams({ accounts: spec.accounts.join(',') });
    if (spec.year) qs.set('year', spec.year);
    fetch(`${API_HOST}/api/company-book/transactions?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (!d.success) throw new Error(d.message); setItems(d.items); })
      .catch((err) => { showToast(err.message || '근거 줄을 불러오지 못했습니다.', 'error'); setItems([]); });
  }, [spec, showToast]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 날짜 오래된 순으로 누적을 쌓는다. 합계에서 뺀 줄은 보여 주되 더하지 않는다
  const rows = useMemo(() => {
    const sorted = [...(items || [])].sort((a, b) => new Date(a.date) - new Date(b.date) || String(a._id).localeCompare(String(b._id)));
    const out = [];
    for (const t of sorted) {
      const v = t.excluded ? 0 : signedAmount(t);
      out.push({ ...t, v, run: (out.length ? out[out.length - 1].run : 0) + v });
    }
    return out;
  }, [items]);
  const total = rows.length ? rows[rows.length - 1].run : 0;
  const counted = rows.filter((t) => !t.excluded);

  const groupBy = (keyOf, labelOf) => {
    const m = new Map();
    for (const t of counted) {
      const k = keyOf(t);
      const g = m.get(k) || { key: k, label: labelOf(t), n: 0, out: 0, in: 0, v: 0 };
      g.n += 1;
      g[t.direction === '출금' ? 'out' : 'in'] += t.amount;
      g.v += t.v;
      m.set(k, g);
    }
    return [...m.values()];
  };
  const byAccount = groupBy((t) => t.account, (t) => accountOf(t.account).name).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const bySource = groupBy((t) => sourceOf({ ...t, sourceRow: null }), (t) => sourceOf({ ...t, sourceRow: null })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const periodKey = (t) => {
    const d = new Date(t.date);
    return spec.byYear ? `${d.getFullYear()}년` : `${d.getMonth() + 1}월`;
  };
  const byPeriod = [];
  for (const g of groupBy(periodKey, periodKey).sort((a, b) => parseInt(a.key, 10) - parseInt(b.key, 10))) {
    byPeriod.push({ ...g, run: (byPeriod.length ? byPeriod[byPeriod.length - 1].run : 0) + g.v });
  }

  const download = () => {
    const wb = XLSX.utils.book_new();
    const head = [[spec.title], [`계산: ${spec.formula}`], [`합계: ${total}원`], []];
    const detail = [...head, ['번호', '날짜', '계정', '내역', '출금', '입금', '반영 금액', '누적', '출처', '메모']];
    rows.forEach((t, i) => detail.push([i + 1, ymd(t.date), accountOf(t.account).name, t.description, t.direction === '출금' ? t.amount : '', t.direction === '입금' ? t.amount : '', t.excluded ? `합계 제외(${t.excludeReason || ''})` : t.v, t.run, sourceOf(t), t.memo || '']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), '근거 줄');
    const sheetOf = (title, list, withRun) => XLSX.utils.aoa_to_sheet([
      [title, '줄 수', '출금', '입금', '반영 금액', ...(withRun ? ['누적'] : [])],
      ...list.map((g) => [g.label, g.n, g.out, g.in, g.v, ...(withRun ? [g.run] : [])])
    ]);
    XLSX.utils.book_append_sheet(wb, sheetOf(spec.byYear ? '연도' : '월', byPeriod, true), spec.byYear ? '연도별' : '월별');
    XLSX.utils.book_append_sheet(wb, sheetOf('계정', byAccount), '계정별');
    XLSX.utils.book_append_sheet(wb, sheetOf('엑셀 시트 › 칸', bySource), '출처별');
    XLSX.writeFile(wb, `회사장부_근거_${spec.title.replace(/[\\/:*?"<>|\s]+/g, '_')}_${ymd(new Date())}.xlsx`);
  };

  const won = (n) => (n ? toCommaString(Math.round(n)) : '-');
  const sumTable = (title, list, withRun) => (
    <div style={{ flex: '1 1 300px', minWidth: 0 }}>
      <div style={{ fontWeight: '800', fontSize: '0.84rem', marginBottom: '0.3rem' }}>{title}</div>
      <div style={{ overflow: 'auto', maxHeight: '260px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead><tr>{['', '줄', '출금', '입금', '반영', ...(withRun ? ['누적'] : [])].map((h, i) => <th key={i} style={{ ...th, textAlign: i ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map((g) => (
              <tr key={g.key}>
                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{g.label}</td>
                <td style={td}>{g.n}</td>
                <td style={td}>{won(g.out)}</td>
                <td style={{ ...td, color: '#2e7d32' }}>{won(g.in)}</td>
                <td style={{ ...td, fontWeight: '700' }}>{won(g.v)}</td>
                {withRun && <td style={{ ...td, fontWeight: '700' }}>{won(g.run)}</td>}
              </tr>
            ))}
            <tr style={{ fontWeight: '800', background: 'var(--bg-main)' }}>
              <td style={{ ...td, textAlign: 'left' }}>합계</td>
              <td style={td}>{counted.length}</td>
              <td style={td}>{won(list.reduce((s, g) => s + g.out, 0))}</td>
              <td style={{ ...td, color: '#2e7d32' }}>{won(list.reduce((s, g) => s + g.in, 0))}</td>
              <td style={td}>{won(total)}</td>
              {withRun && <td style={td}>{won(total)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  const matches = Math.round(total) === Math.round(spec.value);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3vh 1rem', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(1250px, 100%)', display: 'flex', flexDirection: 'column', gap: '0.9rem', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.8rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: '800' }}>{spec.title} — 근거</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.6 }}>{spec.formula}</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: '800' }}>{toCommaString(Math.round(total))}원</div>
            {items && (
              <div style={{ fontSize: '0.74rem', color: matches ? '#15803d' : '#d9534f', fontWeight: '700' }}>
                {matches ? `✓ 카드 금액(${man(spec.value)}만 원)과 같습니다` : `카드 금액 ${toCommaString(Math.round(spec.value))}원과 다릅니다`}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button type="button" disabled={!items?.length} onClick={download} style={{ padding: '0.4rem 0.9rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-surface)', fontWeight: '700', cursor: 'pointer' }}>엑셀로 받기</button>
          {spec.accounts.length === 1 && (
            <button type="button" onClick={() => { onClose(); onOpenAccount(spec.accounts[0], spec.year); }} style={{ padding: '0.4rem 0.9rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-surface)', fontWeight: '700', cursor: 'pointer' }}>줄 목록에서 고치기</button>
          )}
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', padding: '0.4rem 0.9rem', border: 'none', borderRadius: '6px', background: 'var(--primary)', color: '#fff', fontWeight: '700', cursor: 'pointer' }}>닫기</button>
        </div>

        {items === null ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>근거 줄을 불러오는 중…</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
              {sumTable(spec.byYear ? '연도별 (누적 = 그해 말 잔액)' : '월별', byPeriod, true)}
              {sumTable('계정별', byAccount)}
              {sumTable('엑셀 시트 › 칸별 (어디서 가져왔나)', bySource)}
            </div>

            <div>
              <div style={{ fontWeight: '800', fontSize: '0.84rem', marginBottom: '0.3rem' }}>
                더한 줄 {counted.length.toLocaleString()}개{rows.length > counted.length && <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}> · 흐린 줄 {rows.length - counted.length}개는 겹친 줄 등이라 합계에서 뺐습니다</span>}
              </div>
              <div style={{ overflow: 'auto', maxHeight: '50vh', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
                  <thead>
                    <tr>{['#', '날짜', '계정', '내역', '출금', '입금', '반영 금액', '누적', '출처 (엑셀 시트 › 칸 · 행)', '메모'].map((h) => <th key={h} style={{ ...th, textAlign: ['출금', '입금', '반영 금액', '누적', '#'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={10} style={{ ...td, textAlign: 'left', color: 'var(--text-muted)' }}>이 금액에 들어간 줄이 없습니다.</td></tr>}
                    {rows.map((t, i) => (
                      <tr key={t._id} style={{ opacity: t.excluded ? 0.45 : 1 }}>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{i + 1}</td>
                        <td style={{ ...td, textAlign: 'left' }}>{ymd(t.date)}</td>
                        <td style={{ ...td, textAlign: 'left' }}>{accountOf(t.account).name}</td>
                        <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: '180px' }}>{t.description}</td>
                        <td style={td}>{t.direction === '출금' ? toCommaString(t.amount) : ''}</td>
                        <td style={{ ...td, color: '#2e7d32' }}>{t.direction === '입금' ? toCommaString(t.amount) : ''}</td>
                        <td style={{ ...td, fontWeight: '700', color: t.v < 0 ? '#2e7d32' : undefined }}>{t.excluded ? '합계 제외' : toCommaString(t.v)}</td>
                        <td style={td}>{toCommaString(t.run)}</td>
                        <td style={{ ...td, textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.74rem' }}>{sourceOf(t)}</td>
                        <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', color: 'var(--text-muted)', fontSize: '0.74rem' }}>{[t.memo, t.excluded ? t.excludeReason : ''].filter(Boolean).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AccountSelect({ value, onChange, style }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      {COMPANY_SECTIONS.map((s) => (
        <optgroup key={s.key} label={s.name}>
          {COMPANY_ACCOUNTS.filter((a) => a.section === s.key).map((a) => (
            <option key={a.key} value={a.key}>{a.group ? `${a.group} · ${a.name}` : a.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ───────────────────────── 요약 (연도별 / 월별 표)

function SummaryTab({ summary, onOpenAccount, showToast }) {
  const years = useMemo(() => [...new Set(summary.rows.map((r) => r.year))].sort(), [summary]);
  const [focusYear, setFocusYear] = useState(null);
  const [source, setSource] = useState(null); // 근거를 보고 있는 카드
  const closeSource = useCallback(() => setSource(null), []);
  const [mode, setMode] = useState('year'); // year: 연도별, month: focusYear의 월별
  const year = focusYear || years[years.length - 1];

  // 계정 × 기간 금액. 기간 key는 연도별이면 2025, 월별이면 '2025-03'
  const cells = useMemo(() => {
    const m = new Map();
    for (const r of summary.rows) {
      const v = signedAmount({ direction: r.direction, amount: r.amount, account: r.account });
      for (const key of [`${r.account}|${r.year}`, `${r.account}|${r.year}-${String(r.month).padStart(2, '0')}`]) {
        m.set(key, (m.get(key) || 0) + v);
      }
    }
    return m;
  }, [summary]);
  const cell = (account, period) => cells.get(`${account}|${period}`) || 0;

  const periods = mode === 'year' ? years.map(String) : Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const periodLabel = (p) => (mode === 'year' ? `${p}년` : `${Number(p.slice(5))}월`);
  const usedAccounts = COMPANY_ACCOUNTS.filter((a) => years.some((y) => cell(a.key, y)));
  const sumOf = (keys, p) => keys.reduce((s, k) => s + cell(k, p), 0);
  // 비용이 아닌 돈은 '지금 얼마 남았나'가 중요하다: 맨 처음부터 표 마지막 기간까지 쌓은 값
  const cumulative = (key) => years.filter((y) => mode === 'year' || y <= year).reduce((s, y) => s + cell(key, String(y)), 0);

  const opexKeys = usedAccounts.filter((a) => a.section === 'opex').map((a) => a.key);
  const pnlKeys = usedAccounts.filter((a) => PNL_SECTIONS.includes(a.section)).map((a) => a.key);

  // 위 숫자 카드: 고른 해(없으면 마지막 해) 기준, 전년 대비
  const y0 = String(year);
  const y1 = String(year - 1);
  const opexNow = sumOf(opexKeys, y0);
  const laborNow = sumOf(LABOR, y0);
  const ownerLoan = years.reduce((s, y) => s + cell('ownerLoan', String(y)), 0);
  const unsorted = sumOf(['card', 'other'], y0);

  const rowStyle = (strong) => (strong ? { fontWeight: '800', background: 'var(--bg-main)' } : {});
  const renderRow = (label, values, { strong, total, onClick, indent } = {}) => (
    <tr key={label} style={rowStyle(strong)}>
      <td style={{ ...td, textAlign: 'left', paddingLeft: indent ? '1.4rem' : td.padding, cursor: onClick ? 'pointer' : 'default', color: onClick ? 'var(--primary)' : undefined, position: 'sticky', left: 0, background: strong ? 'var(--bg-main)' : 'var(--bg-surface)' }} onClick={onClick}>{label}</td>
      {values.map((v, i) => <td key={periods[i]} style={{ ...td, color: v < 0 ? '#2e7d32' : undefined }}>{man(v)}</td>)}
      <td style={{ ...td, fontWeight: '800' }}>{man(total)}</td>
    </tr>
  );

  const accountRow = (a, cumulativeTotal) => renderRow(
    a.name,
    periods.map((p) => cell(a.key, p)),
    { total: cumulativeTotal ? cumulative(a.key) : periods.reduce((s, p) => s + cell(a.key, p), 0), onClick: () => onOpenAccount(a.key, mode === 'month' ? year : null), indent: true }
  );

  const groups = [...new Set(usedAccounts.filter((a) => a.section === 'opex').map((a) => a.group))];
  const nonPnl = COMPANY_SECTIONS.filter((s) => !s.pnl);

  if (!years.length) {
    return <div style={{ ...card, color: 'var(--text-muted)', fontSize: '0.9rem' }}>아직 장부가 비어 있습니다. "엑셀 올리기"에서 자금팀 입출금 리스트를 올려 주세요.</div>;
  }

  const opexPrev = sumOf(opexKeys, y1);
  const laborPrev = sumOf(LABOR, y1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.8rem' }}>
        <Kpi
          label={`${year}년 본사 비용(판관비)`} value={`${man(opexNow)}만 원`}
          sub={pct(opexNow, opexPrev) !== null ? `전년 ${man(opexPrev)}만 원 대비 ${pct(opexNow, opexPrev) > 0 ? '+' : ''}${pct(opexNow, opexPrev)}%` : '전년 자료 없음'}
          onClick={() => setSource({ title: `${year}년 본사 비용(판관비)`, year: y0, accounts: opexKeys, value: opexNow, formula: `${year}년 1~12월, 판매비와 관리비 계정(인건비·사무실·수수료·영업·차량 공통·분류 필요)의 나간 돈 − 들어온 돈(환급). 합계에서 뺀 줄은 넣지 않습니다.` })}
        />
        <Kpi
          label={`${year}년 인건비`} value={`${man(laborNow)}만 원`}
          sub={`본사 비용의 ${opexNow ? Math.round((laborNow / opexNow) * 100) : 0}%${pct(laborNow, laborPrev) !== null ? `, 전년 대비 ${pct(laborNow, laborPrev) > 0 ? '+' : ''}${pct(laborNow, laborPrev)}%` : ''}`}
          onClick={() => setSource({ title: `${year}년 인건비`, year: y0, accounts: LABOR, value: laborNow, formula: `${year}년 1~12월, 급여 + 4대보험·퇴직연금·원천세 계정의 나간 돈 − 들어온 돈(환급).` })}
        />
        <Kpi
          label={`${year}년 대출이자`} value={`${man(sumOf(['interest', 'loanFee'], y0))}만 원`} sub="은행대출 시트 기준(차량 할부이자는 원장에 있음)"
          onClick={() => setSource({ title: `${year}년 대출이자`, year: y0, accounts: ['interest', 'loanFee'], value: sumOf(['interest', 'loanFee'], y0), formula: `${year}년 1~12월, 대출이자 + 대출 부대비용(약정수수료·채권) 계정의 나간 돈 − 들어온 돈. 차량 할부이자는 차량 손익 원장에 있어 여기 없습니다.` })}
        />
        <Kpi
          label="대표 차입금 잔액" value={`${man(ownerLoan)}만 원`} sub="대표님이 넣은 돈 − 회사가 갚은 돈 (자본금은 따로)"
          onClick={() => setSource({ title: '대표 차입금 잔액', year: null, accounts: ['ownerLoan'], value: ownerLoan, byYear: true, formula: '처음부터 지금까지 대표 차입금 계정에서 회사로 들어온 돈(대표님이 넣은 돈) − 회사에서 나간 돈(대표님께 갚은 돈). 누적 칸이 그날까지의 잔액입니다. 자본금은 따로 셉니다.' })}
        />
        <Kpi
          label={`${year}년 분류 필요`} value={`${man(unsorted)}만 원`} sub="법인카드 결제 총액·기타. 카드사 내역으로 나눠야 합니다" warn={unsorted > 0}
          onClick={() => setSource({ title: `${year}년 분류 필요`, year: y0, accounts: ['card', 'other'], value: unsorted, formula: `${year}년 1~12월, 법인카드(내역 모름) + 기타 계정. 줄 목록에서 알맞은 계정으로 바꾸면 여기서 빠집니다.` })}
        />
      </div>
      {source && <SourceDialog spec={source} onClose={closeSource} onOpenAccount={onOpenAccount} showToast={showToast} />}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" style={tabBtn(mode === 'year')} onClick={() => setMode('year')}>연도별</button>
        <button type="button" style={tabBtn(mode === 'month')} onClick={() => setMode('month')}>월별</button>
        <select style={inp('100px')} value={year} onChange={(e) => setFocusYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>단위: 만 원 · 초록색은 들어온 돈(환급 등) · 계정 이름을 누르면 줄 목록으로 갑니다</span>
      </div>

      <div style={{ overflow: 'auto', maxHeight: '70vh', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', left: 0, zIndex: 2 }}>계정</th>
              {periods.map((p) => (
                <th key={p} style={{ ...th, cursor: mode === 'year' ? 'pointer' : 'default' }} onClick={() => { if (mode === 'year') { setFocusYear(Number(p)); setMode('month'); } }} title={mode === 'year' ? '누르면 이 해의 월별 표' : undefined}>
                  {periodLabel(p)}
                </th>
              ))}
              <th style={th}>합계</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={periods.length + 2} style={{ ...td, textAlign: 'left', fontWeight: '800', color: 'var(--primary)', background: 'var(--bg-main)' }}>손익에 들어가는 돈 (본사 비용)</td></tr>
            {groups.map((g) => {
              const keys = usedAccounts.filter((a) => a.section === 'opex' && a.group === g);
              return (
                <React.Fragment key={g}>
                  {keys.map((a) => accountRow(a))}
                  {renderRow(`${g} 소계`, periods.map((p) => sumOf(keys.map((a) => a.key), p)), { strong: true, total: periods.reduce((s, p) => s + sumOf(keys.map((a) => a.key), p), 0) })}
                </React.Fragment>
              );
            })}
            {renderRow('판매비와 관리비 합계', periods.map((p) => sumOf(opexKeys, p)), { strong: true, total: periods.reduce((s, p) => s + sumOf(opexKeys, p), 0) })}
            {usedAccounts.filter((a) => a.section === 'finance' || a.section === 'incomeTax').map((a) => accountRow(a))}
            {renderRow('본사 비용 합계 (판관비 + 금융비용 + 법인세)', periods.map((p) => sumOf(pnlKeys, p)), { strong: true, total: periods.reduce((s, p) => s + sumOf(pnlKeys, p), 0) })}

            <tr><td colSpan={periods.length + 2} style={{ ...td, textAlign: 'left', fontWeight: '800', color: 'var(--primary)', background: 'var(--bg-main)', paddingTop: '0.8rem' }}>손익이 아닌 돈 (맨 오른쪽은 처음부터 쌓인 잔액)</td></tr>
            {nonPnl.flatMap((s) => usedAccounts.filter((a) => a.section === s.key).map((a) => accountRow(a, true)))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
        {nonPnl.filter((s) => s.note).map((s) => <div key={s.key}>· <b>{s.name}</b>: {s.note}</div>)}
        <div>· 차 한 대에 들어간 돈(차량가·할부·보험·정비)은 <b>차량 손익 원장</b>에 있습니다. 여기의 '차량 공통'은 원장에 없는 탁송·썬팅·차고지 같은 공통 비용입니다.</div>
      </div>
    </div>
  );
}

// ───────────────────────── 줄 목록

const EMPTY_TX = { date: ymd(new Date()), direction: '출금', amount: 0, account: 'other', description: '', memo: '' };

function TransactionsTab({ filter, setFilter, years, showToast, onChanged }) {
  const [items, setItems] = useState(null);
  const [draft, setDraft] = useState(EMPTY_TX);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (filter.year) qs.set('year', filter.year);
    if (filter.account) qs.set('account', filter.account);
    if (filter.q) qs.set('q', filter.q);
    setItems(null);
    fetch(`${API_HOST}/api/company-book/transactions?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (!d.success) throw new Error(d.message); setItems(d.items); })
      .catch((err) => { showToast(err.message || '장부를 불러오지 못했습니다.', 'error'); setItems([]); });
  }, [filter, showToast]);
  useEffect(load, [load]);

  const save = async (id, patch) => {
    const res = await fetch(`${API_HOST}/api/company-book/transactions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const d = await res.json();
    if (!d.success) return showToast(d.message || '저장하지 못했습니다.', 'error');
    setItems((prev) => prev.map((t) => (t._id === id ? d.item : t)));
    onChanged();
  };
  const remove = async (t) => {
    if (!window.confirm(`"${t.description}" ${toCommaString(t.amount)}원 줄을 지울까요?`)) return;
    const res = await fetch(`${API_HOST}/api/company-book/transactions/${t._id}`, { method: 'DELETE' });
    const d = await res.json();
    if (!d.success) return showToast(d.message || '지우지 못했습니다.', 'error');
    setItems((prev) => prev.filter((x) => x._id !== t._id));
    onChanged();
  };
  const add = async () => {
    const res = await fetch(`${API_HOST}/api/company-book/transactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
    const d = await res.json();
    if (!d.success) return showToast(d.message || '추가하지 못했습니다.', 'error');
    showToast('장부에 줄을 추가했습니다.', 'success');
    setDraft({ ...EMPTY_TX, date: draft.date });
    load();
    onChanged();
  };

  const totals = useMemo(() => (items || []).filter((t) => !t.excluded).reduce((s, t) => {
    s[t.direction] += t.amount;
    return s;
  }, { 출금: 0, 입금: 0 }), [items]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ ...card, display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={inp('100px')} value={filter.year || ''} onChange={(e) => setFilter({ ...filter, year: e.target.value })}>
          <option value="">전체 연도</option>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select style={inp('230px')} value={filter.account || ''} onChange={(e) => setFilter({ ...filter, account: e.target.value })}>
          <option value="">전체 계정</option>
          {COMPANY_ACCOUNTS.map((a) => <option key={a.key} value={a.key}>{a.group ? `${a.group} · ${a.name}` : a.name}</option>)}
        </select>
        <input style={inp('180px')} placeholder="내역·메모 검색" defaultValue={filter.q || ''} onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ ...filter, q: e.target.value.trim() }); }} />
        {items && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {items.length.toLocaleString()}줄 · 출금 {toCommaString(totals.출금)}원 · 입금 {toCommaString(totals.입금)}원
          </span>
        )}
      </div>

      <div style={{ ...card, display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: '700' }}>직접 추가</span>
        <input type="date" style={inp('130px')} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        <select style={inp('70px')} value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value })}>
          <option>출금</option><option>입금</option>
        </select>
        <input style={inp('120px', true)} placeholder="금액" value={draft.amount ? toCommaString(draft.amount) : ''} onChange={(e) => setDraft({ ...draft, amount: parseNumber(e.target.value) })} />
        <AccountSelect value={draft.account} onChange={(v) => setDraft({ ...draft, account: v })} style={inp('220px')} />
        <input style={inp('200px')} placeholder="내역 (예: 10월 사무실 임대료)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        <input style={inp('150px')} placeholder="메모" value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} />
        <button type="button" onClick={add} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.8rem', border: 'none', borderRadius: '6px', background: 'var(--primary)', color: '#fff', fontWeight: '700', cursor: 'pointer' }}>
          <Plus size={14} /> 추가
        </button>
      </div>

      <div style={{ overflow: 'auto', maxHeight: '65vh', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead>
            <tr>
              {['날짜', '계정', '내역', '출금', '입금', '메모', '출처', ''].map((h, i) => <th key={h || i} style={{ ...th, textAlign: ['출금', '입금'].includes(h) ? 'right' : 'left' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {items === null && <tr><td colSpan={8} style={{ ...td, textAlign: 'left', color: 'var(--text-muted)' }}>불러오는 중…</td></tr>}
            {items?.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'left', color: 'var(--text-muted)' }}>조건에 맞는 줄이 없습니다.</td></tr>}
            {items?.map((t) => (
              <tr key={t._id} style={{ opacity: t.excluded ? 0.45 : 1 }} title={t.excluded ? `합계에서 뺀 줄: ${t.excludeReason}` : undefined}>
                <td style={{ ...td, textAlign: 'left' }}>{ymd(t.date)}</td>
                <td style={{ ...td, textAlign: 'left' }}>
                  <AccountSelect value={t.account} onChange={(v) => save(t._id, { account: v })} style={inp('210px')} />
                </td>
                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: '180px' }}>{t.description}</td>
                <td style={td}>{t.direction === '출금' ? toCommaString(t.amount) : ''}</td>
                <td style={{ ...td, color: '#2e7d32' }}>{t.direction === '입금' ? toCommaString(t.amount) : ''}</td>
                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{[t.memo, t.excluded ? t.excludeReason : ''].filter(Boolean).join(' · ')}</td>
                <td style={{ ...td, textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.72rem' }}>{t.source === 'excel' ? `${t.sourceSheet} › ${t.sourceColumn}` : '직접 입력'}</td>
                <td style={{ ...td, textAlign: 'left' }}>
                  <button type="button" title={t.excluded ? '다시 합계에 넣기' : '합계에서 빼기(겹친 줄 등)'} onClick={() => save(t._id, { excluded: !t.excluded, excludeReason: t.excluded ? '' : '화면에서 합계에서 뺌' })} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    {t.excluded ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  {t.source === 'manual' && (
                    <button type="button" title="이 줄 지우기" onClick={() => remove(t)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#d9534f' }}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────── 엑셀 올리기

function ImportTab({ showToast, onChanged, lastImportAt }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async (apply) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (apply) fd.append('apply', '1');
      const res = await fetch(`${API_HOST}/api/company-book/import`, { method: 'POST', body: fd });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || '엑셀을 읽지 못했습니다.');
      setResult(d);
      if (apply) {
        showToast(d.message, 'success');
        onChanged();
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const list = (title, rows, render) => rows?.length > 0 && (
    <details style={{ fontSize: '0.8rem' }}>
      <summary style={{ cursor: 'pointer', fontWeight: '700' }}>{title}</summary>
      <ul style={{ margin: '0.4rem 0 0 1rem', lineHeight: 1.7 }}>{rows.map(render)}</ul>
    </details>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', maxWidth: '900px' }}>
      <div style={{ ...card, fontSize: '0.84rem', lineHeight: 1.8 }}>
        자금팀 엑셀 <b>"렌트베네핏 입출금 리스트"</b>를 그대로 올립니다(고정비용·부대비용·기타비용·은행대출·대표 차입금·부가세 시트).
        <br />엑셀을 고쳐서 다시 올려도 같은 줄은 두 번 들어가지 않습니다. 엑셀에서 지우거나 금액·날짜를 고친 줄은 장부에서도 바뀝니다.
        <br />화면에서 계정을 바꾼 줄은 다시 올려도 바꾼 계정이 그대로 남습니다.
        {lastImportAt && <div style={{ color: 'var(--text-muted)' }}>마지막 반영: {new Date(lastImportAt).toLocaleString()}</div>}
      </div>

      <div style={{ ...card, display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }} />
        <button type="button" disabled={!file || busy} onClick={() => send(false)} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.45rem 0.9rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-surface)', fontWeight: '700', cursor: file ? 'pointer' : 'not-allowed' }}>
          <Upload size={14} /> 미리보기
        </button>
      </div>

      {result && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ fontWeight: '800' }}>{result.preview ? '반영하면 이렇게 바뀝니다' : '반영했습니다'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', fontSize: '0.85rem' }}>
            <div>읽은 줄 <b>{result.total.toLocaleString()}</b></div>
            <div>새 줄 <b>{result.added.toLocaleString()}</b></div>
            <div>그대로 <b>{result.kept.toLocaleString()}</b></div>
            <div style={{ color: result.removed ? '#d9534f' : undefined }}>엑셀에서 사라져 지울 줄 <b>{result.removed.toLocaleString()}</b></div>
            <div>겹쳐서 합계에서 뺄 줄 <b>{result.excluded}</b></div>
          </div>
          {result.skipped?.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: '#b26a00', display: 'flex', gap: '0.4rem' }}>
              <AlertTriangle size={15} /> 읽지 못한 줄 {result.skipped.length}건 — 엑셀에서 고친 뒤 다시 올려 주세요.
            </div>
          )}
          {list('읽지 못한 줄', result.skipped, (s, i) => <li key={i}>{s.sheet} › {s.column} {s.row}행: {s.text} ({s.reason})</li>)}
          {list(`새 줄 (앞 ${result.addedSample.length}건)`, result.addedSample, (r, i) => <li key={i}>{ymd(r.date)} {r.description} {toCommaString(r.amount)}원 {r.direction} → {accountOf(r.account).name}</li>)}
          {list(`지울 줄 (앞 ${result.removedSample.length}건)`, result.removedSample, (r, i) => <li key={i}>{ymd(r.date)} {r.description} {toCommaString(r.amount)}원</li>)}
          {result.preview && (
            <div>
              <button type="button" disabled={busy} onClick={() => send(true)} style={{ padding: '0.5rem 1.1rem', border: 'none', borderRadius: '8px', background: 'var(--primary)', color: '#fff', fontWeight: '700', cursor: 'pointer' }}>
                {busy ? '반영 중…' : '장부에 반영'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 화면

function CompanyBookView({ showToast }) {
  const [tab, setTab] = useState('summary');
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState({ year: String(new Date().getFullYear()), account: '', q: '' });

  const loadSummary = useCallback(() => {
    fetch(`${API_HOST}/api/company-book/summary`)
      .then((r) => r.json())
      .then((d) => { if (!d.success) throw new Error(d.message); setSummary(d); })
      .catch((err) => showToast(err.message || '회사 장부를 불러오지 못했습니다.', 'error'));
  }, [showToast]);
  useEffect(loadSummary, [loadSummary]);

  const years = useMemo(() => [...new Set((summary?.rows || []).map((r) => r.year))].sort((a, b) => b - a), [summary]);

  if (!summary) return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>회사 장부를 불러오는 중…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.3rem', borderBottom: '1px solid var(--border-color)' }}>
        <button type="button" style={tabBtn(tab === 'summary')} onClick={() => setTab('summary')}>계정별 요약</button>
        <button type="button" style={tabBtn(tab === 'list')} onClick={() => setTab('list')}>줄 목록</button>
        <button type="button" style={tabBtn(tab === 'import')} onClick={() => setTab('import')}>엑셀 올리기</button>
      </div>
      {tab === 'summary' && (
        <SummaryTab
          key={summary.rows.length}
          summary={summary}
          showToast={showToast}
          onOpenAccount={(account, year) => { setFilter({ year: year ? String(year) : '', account, q: '' }); setTab('list'); }}
        />
      )}
      {tab === 'list' && <TransactionsTab filter={filter} setFilter={setFilter} years={years} showToast={showToast} onChanged={loadSummary} />}
      {tab === 'import' && <ImportTab showToast={showToast} onChanged={loadSummary} lastImportAt={summary.lastImportAt} />}
    </div>
  );
}

export default CompanyBookView;
