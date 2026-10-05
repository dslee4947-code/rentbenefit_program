import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, Plus, Trash2, EyeOff, Eye, AlertTriangle } from 'lucide-react';
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

function Kpi({ label, value, sub, warn }) {
  return (
    <div style={card}>
      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: '600' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: '800', color: warn ? '#d9534f' : 'var(--text-main)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</div>}
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

function SummaryTab({ summary, onOpenAccount }) {
  const years = useMemo(() => [...new Set(summary.rows.map((r) => r.year))].sort(), [summary]);
  const [focusYear, setFocusYear] = useState(null);
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
        <Kpi label={`${year}년 본사 비용(판관비)`} value={`${man(opexNow)}만 원`} sub={pct(opexNow, opexPrev) !== null ? `전년 ${man(opexPrev)}만 원 대비 ${pct(opexNow, opexPrev) > 0 ? '+' : ''}${pct(opexNow, opexPrev)}%` : '전년 자료 없음'} />
        <Kpi label={`${year}년 인건비`} value={`${man(laborNow)}만 원`} sub={`본사 비용의 ${opexNow ? Math.round((laborNow / opexNow) * 100) : 0}%${pct(laborNow, laborPrev) !== null ? `, 전년 대비 ${pct(laborNow, laborPrev) > 0 ? '+' : ''}${pct(laborNow, laborPrev)}%` : ''}`} />
        <Kpi label={`${year}년 대출이자`} value={`${man(sumOf(['interest', 'loanFee'], y0))}만 원`} sub="은행대출 시트 기준(차량 할부이자는 원장에 있음)" />
        <Kpi label="대표 차입금 잔액" value={`${man(ownerLoan)}만 원`} sub="대표님이 넣은 돈 − 회사가 갚은 돈 (자본금은 따로)" />
        <Kpi label={`${year}년 분류 필요`} value={`${man(unsorted)}만 원`} sub="법인카드 결제 총액·기타. 카드사 내역으로 나눠야 합니다" warn={unsorted > 0} />
      </div>

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
          onOpenAccount={(account, year) => { setFilter({ year: year ? String(year) : '', account, q: '' }); setTab('list'); }}
        />
      )}
      {tab === 'list' && <TransactionsTab filter={filter} setFilter={setFilter} years={years} showToast={showToast} onChanged={loadSummary} />}
      {tab === 'import' && <ImportTab showToast={showToast} onChanged={loadSummary} lastImportAt={summary.lastImportAt} />}
    </div>
  );
}

export default CompanyBookView;
