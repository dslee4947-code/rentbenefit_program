import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Printer, Plus, Trash2 } from 'lucide-react';
import { toCommaString, parseNumber } from '../../utils/format.js';
import { quoteRental, insurerAmountFor, deriveRates } from '../../../../shared/shortTermRates.js';
import { printFitted } from '../../utils/printFit.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => (n === null || n === undefined ? '-' : `${toCommaString(Math.round(n))}`);
const yearMonth = (d) => (d ? `${new Date(d).getFullYear()}년 ${new Date(d).getMonth() + 1}월` : '-');
// 장기 대여(월렌트) 중인 차: 줄 가운데에 빨간 가는 선을 긋는다. 칸마다 같은 높이에 그려 한 줄로 이어진다.
const STRIKE_BG = 'linear-gradient(to bottom, transparent calc(50% - 0.5px), #dc2626 calc(50% - 0.5px), #dc2626 calc(50% + 0.5px), transparent calc(50% + 0.5px))';
const longRentText = (until) => `장기 대여 중${until ? ` (~${until})` : ''} · 대여 불가`;
const card = { background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', padding: '1.1rem 1.2rem' };
const th = { padding: '0.5rem 0.55rem', fontSize: '0.76rem', fontWeight: 800, background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', whiteSpace: 'nowrap', textAlign: 'left' };
const td = { padding: '0.4rem 0.55rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem', verticalAlign: 'middle' };
const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const inputSt = { width: '96px', padding: '0.28rem 0.4rem', border: '1px solid var(--border-color)', borderRadius: '5px', textAlign: 'right', fontSize: '0.8rem' };
const btn = (primary) => ({
  display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.85rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
  border: primary ? 'none' : '1px solid var(--border-color)', background: primary ? 'var(--primary)' : '#fff', color: primary ? '#fff' : 'var(--text-bright)'
});

const TABS = [
  ['rates', '단기렌트 단가표'],
  ['calc', '대여료 계산기'],
  ['accident', '사고대차 기준표'],
  ['policy', '요금 규칙']
];

/**
 * 단기렌트 · 사고대차 단가표 (엑셀 "12. 단기 렌트비용.xls"를 옮긴 화면).
 *
 * 1개월 요금 = 손익 원장의 단기렌트 월 목표(견적 3년 · 인수가 30% · 정비 포함, 차령 가감).
 * 1일 = 1개월 × 10%(2,500원 단위 올림), 1주 = 1일 × 4 — 엑셀 단가표의 규칙. 요금 규칙 탭에서 바꾼다.
 */
function ShortTermRatesView({ showToast, currentUser }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('rates');
  const [edits, setEdits] = useState({}); // ledgerId -> { day, week, month, renting, note }
  const [contacts, setContacts] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);
  const canEdit = currentUser?.role !== 'viewer';
  const isAdmin = currentUser?.role === 'admin';

  const load = () => fetch(`${API_HOST}/api/short-term-rates`)
    .then((res) => res.json())
    .then((d) => {
      if (!d.success) throw new Error(d.message || '단가표를 불러오지 못했습니다.');
      setData(d);
      setContacts(d.contacts || []);
      setPolicy(d.policy);
      setEdits({});
    })
    .catch((err) => showToast?.(err.message, 'error'));

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 손익 원장·렌트차량 DB에서 단기렌트로 바꾸고 이 화면으로 돌아오면 차 목록을 다시 읽는다.
  // 저장하지 않은 수정이 있으면 지우지 않도록 건너뛴다.
  const editsRef = useRef(edits);
  editsRef.current = edits;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Object.keys(editsRef.current).length === 0) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (body, okMessage) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_HOST}/api/short-term-rates`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || '저장하지 못했습니다.');
      showToast?.(okMessage || d.message, 'success');
      await load();
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!data || !policy) return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단가표를 불러오는 중…</div>;

  const cars = data.cars.filter((c) => !c.hidden);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="no-print" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            style={{ ...btn(tab === key), background: tab === key ? 'var(--primary)' : '#fff' }}>{label}</button>
        ))}
      </div>

      {tab === 'rates' && (
        <RateCard data={data} cars={cars} policy={data.policy} edits={edits} setEdits={setEdits} canEdit={canEdit} saving={saving}
          onSave={() => save({ vehicles: edits }, '차별 요금·대여 중 표시를 저장했습니다.')} />
      )}
      {tab === 'calc' && <Calculator cars={cars} policy={data.policy} holidays={data.holidays} regions={data.regions} />}
      {tab === 'accident' && (
        <Accident data={data} cars={cars} contacts={contacts} setContacts={setContacts} canEdit={canEdit} saving={saving}
          onSave={() => save({ contacts }, '보험 담당자를 저장했습니다.')}
          onGrade={(id, grade) => save({ vehicles: { [id]: { insurerGrade: grade || null } } }, grade ? `보험사 등급을 ${grade}로 정했습니다.` : '보험사 등급을 자동으로 되돌렸습니다.')} />
      )}
      {tab === 'policy' && (
        <Policy policy={policy} setPolicy={setPolicy} isAdmin={isAdmin} saving={saving}
          onSave={() => save({ policy }, '요금 규칙을 저장했습니다. 단가표가 새 규칙으로 다시 계산됩니다.')} />
      )}
    </div>
  );
}

// ───────────────────────── 단기렌트 단가표

function RateCard({ data, cars, policy, edits, setEdits, canEdit, saving, onSave }) {
  const setEdit = (id, key, value) => setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  const valueOf = (c, key) => (edits[c.ledgerId] && key in edits[c.ledgerId] ? edits[c.ledgerId][key] : c[key]);
  const dirty = Object.keys(edits).length > 0;
  // 아래 요금표는 위 표에서 고친 값(저장 전)을 바로 보여 준다. 칸을 비우면 계산값으로 돌아간다.
  const sheetCars = cars.map((c) => {
    const e = edits[c.ledgerId];
    if (!e) return c;
    // 1개월을 고치면 직접 정하지 않은 1일·1주는 서버처럼 새 1개월에서 다시 낸다
    const base = 'month' in e ? deriveRates(e.month || c.calculated.month, policy) : null;
    const rate = (key) => {
      if (key in e) return e[key] || (base ? base[key] : c.calculated[key]);
      if (base && !c.overridden[key]) return base[key];
      return c.rates[key];
    };
    return {
      ...c,
      renting: !!valueOf(c, 'renting'),
      longRent: !!valueOf(c, 'longRent'),
      longRentUntil: valueOf(c, 'longRentUntil') || null,
      rates: { day: rate('day'), week: rate('week'), month: rate('month') }
    };
  });

  const sheetRef = useRef(null);
  const print = () => printFitted(sheetRef.current, { orientation: 'portrait', title: `렌트베네핏_단기렌트료_${ymdText(new Date())}` });

  return (
    <>
    <div className="no-print" style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 800, color: '#fa8c16' }}>렌트베네핏 단기렌트료 ({cars.length}대)</span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button type="button" style={btn(false)} onClick={print}><Printer size={14} /> 인쇄·PDF</button>
          {canEdit && <button type="button" style={btn(true)} disabled={!dirty || saving} onClick={onSave}><Save size={14} /> {saving ? '저장 중…' : '저장'}</button>}
        </div>
      </div>
      {cars.some((c) => c.rentalLife && c.rentalLife.daysLeft <= 180) && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '8px', padding: '0.55rem 0.75rem', fontSize: '0.8rem', marginBottom: '0.7rem', lineHeight: 1.6 }}>
          <b>렌터카 차령 만료 6개월 안</b> (경·소·중형 5년, 대형 8년 · 검사로 최대 2년 연장):{' '}
          {cars.filter((c) => c.rentalLife && c.rentalLife.daysLeft <= 180)
            .map((c) => `${c.carModel} ${c.plateNo} ${ymdText(c.rentalLife.until)}${c.rentalLife.daysLeft < 0 ? ' (지남)' : ` (D-${c.rentalLife.daysLeft})`}`).join(' · ')}
          {' '}— 연장 검사 또는 매각을 정해야 합니다.
        </div>
      )}
      <p style={{ margin: '0 0 0.7rem', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <b>1개월</b> = {policy.monthly?.method === 'quote'
          ? '단기렌트 월 목표(견적 3년 · 인수가 30% · 정비 포함, 차령 가감)'
          : `엑셀 단기렌트 계산식(차량가를 ${policy.monthly?.termMonths || 36}개월에 회수 · 연 ${((policy.monthly?.interestRate ?? 0.06) * 100).toFixed(1)}% · 등록 후 반기마다 ${Math.round((policy.monthly?.stepRate ?? 0.03) * 100)}%씩 내림)`} · <b>1일(평일)</b> = 1개월 × {Math.round(policy.dayRatio * 100)}% ({toCommaString(policy.dayRoundUnit)}원 단위 올림) · <b>1주</b> = 1일 × {policy.weekDays}.
        칸에 금액을 적으면 그 차만 직접 정한 요금을 씁니다(비우면 계산값). 주말·공휴일 1일 렌트는 {Math.round(policy.weekendSurchargeRate * 100)}% 추가 · 부가세·자차 포함.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'center' }}>NO</th><th style={th}>차종</th><th style={th}>번호</th><th style={th}>년식 · 차령</th><th style={th}>렌터카 차령 만료</th>
              <th style={{ ...th, textAlign: 'right' }}>1일(평일)</th><th style={{ ...th, textAlign: 'right' }}>1주</th><th style={{ ...th, textAlign: 'right' }}>1개월</th>
              <th style={th}>대여 상태</th><th style={th}>메모</th>
            </tr>
          </thead>
          <tbody>
            {cars.map((c, i) => {
              const e = edits[c.ledgerId] || {};
              const brandRow = c.brand !== cars[i - 1]?.brand && (
                <tr key={`brand-${c.brand}`}>
                  <td colSpan={10} style={{ ...td, background: '#111e38', color: '#fff', fontWeight: 800, fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                    {c.brand} <span style={{ color: '#ad885c', fontWeight: 600 }}>{cars.filter((x) => x.brand === c.brand).length}대</span>
                  </td>
                </tr>
              );
              const field = (key) => (canEdit ? (
                <input style={{ ...inputSt, fontWeight: c.overridden[key] || e[key] ? 800 : 400, color: c.overridden[key] || e[key] ? '#b45309' : undefined }}
                  placeholder={toCommaString(c.calculated[key])}
                  value={key in e ? toCommaString(e[key] || '') : (c.overridden[key] ? toCommaString(c.rates[key]) : '')}
                  onChange={(ev) => setEdit(c.ledgerId, key, parseNumber(ev.target.value) || null)} />
              ) : won(c.rates[key]));
              return (
                <React.Fragment key={c.ledgerId}>
                {brandRow}
                <tr style={valueOf(c, 'longRent')
                  ? { backgroundColor: '#fef2f2', backgroundImage: STRIKE_BG }
                  : { background: valueOf(c, 'renting') ? '#fffbeb' : undefined }}>
                  <td style={{ ...td, textAlign: 'center', color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{c.carModel}{c.reason && <div style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: 400 }}>{c.reason}</div>}</td>
                  <td style={td}>{c.plateNo}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{yearMonth(c.ageStart)}<div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{policy.monthly?.method !== 'quote' && c.excel
                    ? `${c.excel.halfLabel} −${toCommaString(c.excel.step)}×${c.excel.steps}`
                    : (c.ageYear ? `${c.ageYear}년차 ×${c.ageFactor}` : '')} · {c.fuelType || '유종 미상'}</div></td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: c.rentalLife?.daysLeft <= 180 ? '#b91c1c' : 'var(--text-muted)', fontWeight: c.rentalLife?.daysLeft <= 180 ? 700 : 400 }}>
                    {c.rentalLife ? <>{ymdText(c.rentalLife.until)}<div style={{ fontSize: '0.7rem' }}>{c.rentalLife.years}년 · {c.rentalLife.daysLeft < 0 ? '지남' : `D-${c.rentalLife.daysLeft}`}</div></> : '-'}
                  </td>
                  <td style={num}>{field('day')}</td>
                  <td style={num}>{field('week')}</td>
                  <td style={num}>{field('month')}</td>
                  <td style={td}>
                    <select disabled={!canEdit} style={{ fontSize: '0.78rem', padding: '0.2rem', background: '#fff' }}
                      value={valueOf(c, 'longRent') ? 'long' : valueOf(c, 'renting') ? 'short' : ''}
                      onChange={(ev) => {
                        const mode = ev.target.value;
                        setEdits((prev) => ({ ...prev, [c.ledgerId]: { ...(prev[c.ledgerId] || {}), renting: mode === 'short', longRent: mode === 'long' } }));
                      }}>
                      <option value="">대여 가능</option>
                      <option value="short">단기 대여 중</option>
                      <option value="long">장기 대여(월렌트)</option>
                    </select>
                    {valueOf(c, 'longRent') && (
                      <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: '#b91c1c', background: '#fff', whiteSpace: 'nowrap' }}>
                        반납 예정{' '}
                        <input type="date" disabled={!canEdit} style={{ fontSize: '0.72rem' }} value={valueOf(c, 'longRentUntil') || ''}
                          onChange={(ev) => setEdit(c.ledgerId, 'longRentUntil', ev.target.value || null)} />
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    {canEdit ? <input style={{ ...inputSt, width: '140px', textAlign: 'left' }} value={valueOf(c, 'note') || ''} onChange={(ev) => setEdit(c.ledgerId, 'note', ev.target.value)} /> : c.note}
                  </td>
                </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '0.7rem', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
        보험: 대인 {policy.insurance.bodily} · 대물 {policy.insurance.property} · 자손 {policy.insurance.selfInjury} · 자차 수리 {policy.insurance.ownDamageLimit} · 면책금 {policy.insurance.deductible}<br />
        주행거리: 1일 {policy.kmPerDay}km · 1주 {toCommaString(policy.kmPerWeek)}km · 월 {toCommaString(policy.kmPerMonth)}km (초과 km당 {policy.excessPerKm}원)<br />
        탁송: {deliveryText(policy)}<br />
        {policy.notes.filter((n) => n.trim()).join(' · ')}
      </div>
    </div>
    <div className="st-sheet-section" style={card}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
        <span style={{ fontWeight: 800 }}>고객 안내용 단가표 (인쇄 모양)</span>
        <button type="button" style={{ ...btn(true), background: SHEET_NAVY }} onClick={print}><Printer size={14} /> 인쇄하기 / PDF 다운로드</button>
      </div>
      {dirty && <div className="no-print" style={{ fontSize: '0.76rem', color: '#b45309', marginBottom: '0.5rem' }}>위에서 고친 내용이 아래 요금표에 미리 보입니다. [저장]을 눌러야 남습니다.</div>}
      <RateSheet sheetRef={sheetRef} cars={sheetCars} policy={policy} />
    </div>
    </>
  );
}

// 고객에게 보내는 단가표. 견적서의 비교견적서(차량 조건비교표)와 같은 양식 — 남색 머리글, 금색 선, 로고.
// 화면·인쇄·PDF가 이 한 양식을 함께 쓴다(docs/print-a4-guide.md).
const SHEET_NAVY = '#111e38';
const SHEET_GOLD = '#ad885c';
const SHEET_CSS = `
  .st-sheet-scroll { overflow-x: auto; }
  .st-sheet-table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: 0.86rem; color: #334155; background: #fff;
    border-top: 3px solid ${SHEET_NAVY}; border-bottom: 3px solid ${SHEET_NAVY}; }
  .st-sheet-table th { background: ${SHEET_NAVY}; color: #fff; font-weight: 800; padding: 9px 8px; text-align: center;
    border-right: 1px solid ${SHEET_GOLD}; border-bottom: 1px solid ${SHEET_GOLD}; white-space: nowrap; }
  .st-sheet-table td { padding: 8px 8px; border-bottom: 1px solid #e9e6e0; border-right: 1px solid ${SHEET_GOLD}; white-space: nowrap; }
  .st-sheet-table th:last-child, .st-sheet-table td:last-child { border-right: none; }
  .st-sheet-table td.color { font-weight: 700; letter-spacing: 0.04em; color: #475569; }
  .st-sheet-table tbody tr.even td { background: #f9f8f6; }
  /* 모든 차 줄을 같은 높이로 둔다. 장기 대여 차는 요금 칸을 이 높이의 절반씩 위(안내)·아래(요금)로 나눈다 */
  .st-sheet-table tbody tr:not(.brand):not(.blocked) td, .st-sheet-table tr.blocked td[rowspan] { height: 34px; padding-top: 0; padding-bottom: 0; }
  .st-sheet-table td.no { text-align: center; color: ${SHEET_GOLD}; font-weight: 800; }
  .st-sheet-table td.model { color: ${SHEET_NAVY}; font-weight: 800; }
  .st-sheet-table td.n { text-align: right; padding-right: 14px; }
  .st-sheet-table td.month { font-weight: 800; color: ${SHEET_NAVY}; }
  .st-sheet-table td.c { text-align: center; }
  /* 줄 가운데 빨간 선. 배경 그러데이션은 인쇄·PDF에서 빠져서 칸마다 테두리 한 줄을 긋는다 */
  .st-sheet-table tr.blocked td { background-color: #fef2f2 !important; color: #9ca3af; position: relative; }
  .st-sheet-table tr.blocked td:not(.blocked-label):not(.rate)::after { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px solid #dc2626; }
  .st-sheet-table tr.blocked td.no, .st-sheet-table tr.blocked td.model { color: #9ca3af; }
  /* 요금 칸은 위(안내)·아래(단기 요금)로 나눠 선을 긋지 않는다. 그 경계가 다른 칸의 가운데 선과 이어진다 */
  .st-sheet-table tr.blocked td.blocked-label { color: #b91c1c; font-weight: 800; font-size: 0.68rem; height: 17px; line-height: 16px; padding: 0 8px; border-bottom: 1px solid #fca5a5; }
  .st-sheet-table tr.blocked td.rate { color: #b6bcc6; font-weight: 500; font-size: 0.74rem; height: 17px; line-height: 16px; padding-top: 0; padding-bottom: 0; }
  .st-sheet-table tr.blocked td.rate.month { color: #b6bcc6; font-weight: 600; }
  .st-sheet-table tr.brand td { background: #f3eee6 !important; color: ${SHEET_NAVY}; font-weight: 800; font-size: 0.84rem; padding: 6px 12px;
    border-top: 2px solid ${SHEET_GOLD}; border-right: none; letter-spacing: 1px; }
  .st-sheet-table tr.brand td span { color: ${SHEET_GOLD}; font-weight: 700; margin-left: 6px; letter-spacing: 0; }
  @media print {
    @page { size: A4 portrait; margin: 0 !important; }
    body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    aside, header, nav, footer, button, .no-print, body .desktop-sidebar, body .mobile-header { display: none !important; }
    main, body .main-content, body .admin-container { padding: 0 !important; margin: 0 !important; overflow: visible !important; background: #fff !important; }
    .st-sheet-section { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; border: none !important;
      border-radius: 0 !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; background: #fff !important; }
  }
`;

function RateSheet({ sheetRef, cars, policy }) {
  const ins = policy.insurance;
  const today = ymdText(new Date());
  const notes = policy.notes.filter((n) => n.trim());
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SHEET_CSS }} />
      <div ref={sheetRef} className="print-fit" style={{ maxWidth: '900px', margin: '0 auto', background: '#fff', padding: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', marginTop: '0.3rem', borderBottom: `2px solid ${SHEET_GOLD}`, paddingBottom: '0.6rem' }}>
          <div style={{ width: '150px' }}><span style={{ fontSize: '1.1rem', fontWeight: 800, color: SHEET_NAVY }}>(주)렌트베네핏</span></div>
          <h2 style={{ fontWeight: 800, fontSize: '1.7rem', color: SHEET_NAVY, margin: 0, letterSpacing: '1px', flex: 1, textAlign: 'center' }}>단기렌트 요금표</h2>
          <div style={{ width: '150px', display: 'flex', justifyContent: 'flex-end' }}><img src="/logo.png" alt="RENT BENefit" style={{ height: '32px', width: 'auto', objectFit: 'contain' }} /></div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', marginBottom: '0.8rem', color: SHEET_NAVY, fontSize: '0.86rem', fontWeight: 700 }}>
          <div style={{ lineHeight: 1.7 }}>
            <span style={{ color: SHEET_GOLD, marginRight: '0.5rem' }}>보험</span>
            대인 {ins.bodily} · 대물 {ins.property} · 자손 {ins.selfInjury} · 자차 수리 {ins.ownDamageLimit} · 면책금 {ins.deductible}<br />
            <span style={{ color: SHEET_GOLD, marginRight: '0.5rem' }}>주행</span>
            1일 {policy.kmPerDay}km · 1주 {toCommaString(policy.kmPerWeek)}km · 1개월 {toCommaString(policy.kmPerMonth)}km (초과 km당 {policy.excessPerKm}원)
          </div>
          <div style={{ color: '#555', fontWeight: 500, whiteSpace: 'nowrap' }}>작성일 {today}</div>
        </div>

        <div className="st-sheet-scroll print-fit-scroll">
          <table className="st-sheet-table">
            <thead>
              <tr>
                <th style={{ width: '6%' }}>NO</th><th>차종</th><th>1일(평일)</th><th>1주</th><th>1개월</th><th>색상(외/내)</th><th>유종</th><th>연식</th>
              </tr>
            </thead>
            <tbody>
              {cars.map((c, i) => (
                <React.Fragment key={c.ledgerId}>
                {c.brand !== cars[i - 1]?.brand && (
                  <tr className="brand"><td colSpan={8}>{c.brand}<span>{cars.filter((x) => x.brand === c.brand).length}대</span></td></tr>
                )}
                {c.longRent ? (
                  // 장기 대여 차는 요금 칸을 위아래로 나눈다: 위 '장기 대여 중(날짜)', 아래 단기 요금. 다른 칸은 두 줄을 합쳐 가운데 선을 긋는다
                  <>
                    <tr className="blocked">
                      <td rowSpan={2} className="no">{i + 1}</td>
                      <td rowSpan={2} className="model">{c.carModel}</td>
                      <td colSpan={3} className="c blocked-label">{longRentText(c.longRentUntil)}</td>
                      <td rowSpan={2} className="c color">{c.color || ''}</td>
                      <td rowSpan={2} className="c">{c.fuelType || ''}</td>
                      <td rowSpan={2} className="c">{yearMonth(c.ageStart)}</td>
                    </tr>
                    <tr className="blocked">
                      <td className="n rate">{won(c.rates.day)}</td><td className="n rate">{won(c.rates.week)}</td><td className="n rate month">{won(c.rates.month)}</td>
                    </tr>
                  </>
                ) : (
                <tr className={(i - cars.findIndex((x) => x.brand === c.brand)) % 2 ? 'even' : undefined}>
                  <td className="no">{i + 1}</td>
                  <td className="model">{c.carModel}</td>
                  {c.renting
                    ? <td colSpan={3} className="c" style={{ color: SHEET_GOLD, fontWeight: 800 }}>단기 렌트 중</td>
                    : <><td className="n">{won(c.rates.day)}</td><td className="n">{won(c.rates.week)}</td><td className="n month">{won(c.rates.month)}</td></>}
                  <td className="c color">{c.color || ''}</td>
                  <td className="c">{c.fuelType || ''}</td>
                  <td className="c">{yearMonth(c.ageStart)}</td>
                </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '0.8rem', background: '#fdfbfa', border: `1px dashed ${SHEET_GOLD}`, padding: '0.55rem 0.8rem', fontSize: '0.78rem', color: '#444', lineHeight: 1.7 }}>
          * 요금은 부가세·자차 포함 금액(원)입니다. 주말·공휴일 1일 렌트는 1일 요금에 {Math.round(policy.weekendSurchargeRate * 100)}% 추가됩니다.<br />
          * 탁송: {deliveryText(policy)}
          {notes.length > 0 && <><br />{notes.map((n) => `* ${n}`).join('  ')}</>}
        </div>
      </div>
    </>
  );
}

const ymdText = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const GRADE_BASIS = { cc: '배기량', hybrid: '하이브리드 → 같은 모델 내연기관 기준', hybridUnknown: '하이브리드 · 기준 확인 필요', manual: '직접 고름' };

const deliveryText = (p) => {
  const d = p.delivery;
  const days = [d.holidayIncludesSaturday && '토요일', d.holidayIncludesSunday && '일요일', '공휴일'].filter(Boolean).join('·');
  const region = Object.entries(d.regionFees).filter(([k]) => k !== '서울')
    .map(([k, v]) => `${k} ${v === null || v === undefined ? '별도 협의' : `왕복 ${toCommaString(v)}원`}`).join(', ');
  return `서울 ${d.seoulFree ? '무료' : '유료'}(1일 대여는 ${toCommaString(d.oneDayFee)}원) · ${days} 인도·회수는 1회 ${toCommaString(d.holidayFee)}원 추가 · ${region}`;
};

// ───────────────────────── 대여료 계산기

const localInput = (d) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 16);
};

/**
 * 계산기 차량 고르기. 브라우저 기본 선택 칸은 항목에 줄을 그을 수 없어 목록을 직접 그린다.
 * 장기 대여(대여 불가) 차는 가운데 빨간 선을 긋고 고를 수 없게 한다.
 */
function CarPicker({ cars, value, onChange, fieldStyle }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const selected = cars.find((c) => String(c.ledgerId) === String(value));
  const text = (c) => `${c.carModel} ${c.plateNo}`;
  const blocked = { textDecoration: 'line-through', textDecorationColor: '#dc2626', textDecorationThickness: '1.5px', color: '#9ca3af', cursor: 'not-allowed' };
  return (
    <div ref={boxRef} style={{ position: 'relative', fontWeight: 400 }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ ...fieldStyle, width: '100%', background: '#fff', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{selected ? `${text(selected)}${selected.renting ? ' (대여 중)' : ''}` : '차량을 고르세요'}</span><span style={{ fontSize: '0.7rem' }}>▼</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, maxHeight: '320px', overflowY: 'auto', background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', marginTop: '2px' }}>
          {cars.map((c, i) => (
            <React.Fragment key={c.ledgerId}>
              {c.brand !== cars[i - 1]?.brand && <div style={{ padding: '0.25rem 0.6rem', fontSize: '0.7rem', fontWeight: 800, color: '#ad885c', background: '#faf8f4' }}>{c.brand}</div>}
              <div
                role="option"
                aria-disabled={c.longRent || undefined}
                aria-selected={String(c.ledgerId) === String(value)}
                onClick={() => { if (c.longRent) return; onChange(c.ledgerId); setOpen(false); }}
                title={c.longRent ? `장기 대여 중${c.longRentUntil ? ` (~${c.longRentUntil})` : ''} · 대여 불가` : undefined}
                style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
                  background: String(c.ledgerId) === String(value) ? '#e8f0ff' : undefined }}
                onMouseEnter={(e) => { if (!c.longRent && String(c.ledgerId) !== String(value)) e.currentTarget.style.background = '#f5f7fb'; }}
                onMouseLeave={(e) => { if (String(c.ledgerId) !== String(value)) e.currentTarget.style.background = ''; }}>
                <span style={c.longRent ? blocked : undefined}>{text(c)}</span>
                {c.longRent && <span style={{ color: '#b91c1c', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>대여 불가{c.longRentUntil ? ` ~${c.longRentUntil}` : ''}</span>}
                {!c.longRent && c.renting && <span style={{ color: '#b45309', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>대여 중</span>}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function Calculator({ cars, policy, holidays, regions }) {
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  // 처음에는 빌려줄 수 있는 첫 차를 고른다(장기 대여 차는 고를 수 없다)
  const [ledgerId, setLedgerId] = useState((cars.find((c) => !c.longRent) || cars[0])?.ledgerId || '');
  const [start, setStart] = useState(localInput(new Date(today.getTime() + 86400000)));
  const [end, setEnd] = useState(localInput(new Date(today.getTime() + 4 * 86400000)));
  const [region, setRegion] = useState('서울');
  const [km, setKm] = useState('');
  const car = cars.find((c) => String(c.ledgerId) === String(ledgerId));
  const q = useMemo(() => (car ? quoteRental({ rates: car.rates, start, end, region, holidays, policy, expectedKm: Number(km) || 0 }) : null),
    [car, start, end, region, holidays, policy, km]);

  const label = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.76rem', fontWeight: 700 };
  const field = { padding: '0.35rem 0.45rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' };
  const line = (l, v, strong) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderTop: '1px dashed var(--border-color)', fontWeight: strong ? 800 : 400 }}>
      <span>{l}</span><span>{v === null ? '별도 협의' : `${won(v)}원`}</span>
    </div>
  );

  return (
    <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <span style={{ fontWeight: 800, color: '#fa8c16' }}>대여료 계산기</span>
        <div style={label}>차량
          <CarPicker cars={cars} value={ledgerId} onChange={setLedgerId} fieldStyle={field} />
        </div>
        <label style={label}>인도 일시<input type="datetime-local" style={field} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label style={label}>반납 일시<input type="datetime-local" style={field} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label style={label}>탁송 지역
          <select style={field} value={region} onChange={(e) => setRegion(e.target.value)}>{regions.map((r) => <option key={r}>{r}</option>)}</select>
        </label>
        <label style={label}>예상 주행거리(km, 선택)<input style={field} value={km} onChange={(e) => setKm(e.target.value.replace(/[^0-9]/g, ''))} placeholder="비우면 초과 요금 계산 안 함" /></label>
        {car && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>이 차 요금: 1일 {won(car.rates.day)} · 1주 {won(car.rates.week)} · 1개월 {won(car.rates.month)}원</div>}
      </div>
      <div>
        {!q ? null : !q.ok ? <div style={{ color: '#b91c1c' }}>{q.reason}</div> : (
          <div style={{ fontSize: '0.86rem' }}>
            <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>{q.days}일 대여 {[q.months && `${q.months}개월`, q.weeks && `${q.weeks}주`, q.restDays && `${q.restDays}일`].filter(Boolean).join(' + ')}</div>
            {q.monthCost > 0 && line(`1개월 × ${q.months}`, q.monthCost)}
            {q.weekCost > 0 && line(`1주 × ${q.weekCost / car.rates.week}`, q.weekCost)}
            {q.dayCost > 0 && (q.restDays
              ? q.dayLines.map((l) => line(`${l.date}${l.surcharge ? ` (주말·공휴일 +${Math.round(policy.weekendSurchargeRate * 100)}%)` : ''}`, l.amount))
              : line('남은 날 → 1주 요금', q.dayCost))}
            {q.deliveryLines.length === 0 ? line('탁송 (서울 무료)', 0) : q.deliveryLines.map((l) => line(l.label, l.amount))}
            {q.excess > 0 && line(`초과 주행 ${toCommaString(q.excessKm)}km × ${policy.excessPerKm}원`, q.excess)}
            {line(q.deliveryKnown ? '합계 (부가세 포함)' : '합계 (탁송료 별도)', q.total, true)}
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.6 }}>
              포함 주행거리 {toCommaString(q.allowanceKm)}km ({[q.months && `1개월 ${toCommaString(policy.kmPerMonth)}km × ${q.months}`, q.weeks && `1주 ${toCommaString(policy.kmPerWeek)}km × ${q.weeks}`, q.restDays && `1일 ${policy.kmPerDay}km × ${q.restDays}`].filter(Boolean).join(' + ')})
            </div>
            {/* 금액이 어떻게 나왔는지 단계별 식 */}
            <div style={{ marginTop: '0.9rem', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: 'var(--bg-main)', padding: '0.4rem 0.7rem', fontWeight: 800, fontSize: '0.8rem' }}>계산 과정</div>
              {(q.steps || []).map((st, i) => (
                <div key={i} style={{ padding: '0.45rem 0.7rem', borderTop: i ? '1px dashed var(--border-color)' : 'none', background: st.total ? '#f0f7ff' : st.swap ? '#fffbeb' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', fontWeight: st.total ? 800 : 700, fontSize: '0.8rem', color: st.swap ? '#b45309' : undefined }}>
                    <span>{i + 1}. {st.label}</span>
                    {st.amount !== undefined && <span style={{ whiteSpace: 'nowrap' }}>{won(st.amount)}원</span>}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.15rem', lineHeight: 1.55 }}>{st.formula}</div>
                  {st.note && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>※ {st.note}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── 사고대차

function Accident({ data, cars, contacts, setContacts, canEdit, saving, onSave, onGrade }) {
  const setC = (i, key, v) => setContacts((prev) => prev.map((c, j) => (j === i ? { ...c, [key]: v } : c)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>사고대차 보험사 기준표 (통상의 요금, 원/일)</div>
        <p style={{ margin: '0 0 0.6rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          보험사는 <b>피해 차량</b>의 배기량 등급으로 대차료를 줍니다. 피해 차량이 운행연한(경·소·중형 5년, 대형 8년)을 넘으면 그 규모의 최저 등급으로 줍니다.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['규모', '등급', '배기량', '1~2일차', '3~4일차', '5~6일차', '7일 이상', '6시간', '10시간', '12시간'].map((h, i) => <th key={h} style={{ ...th, textAlign: i > 2 ? 'right' : 'left' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {data.insurerTable.map((g, i, all) => (
                <tr key={g.grade}>
                  <td style={td}>{g.size} ({g.lifeYears}년)</td><td style={td}>{g.grade}</td>
                  <td style={td}>{i === 0 ? 0 : all[i - 1].ccMax + 1} ~ {g.ccMax ?? ''}cc</td>
                  {['d1', 'd3', 'd5', 'd7', 'h6', 'h10', 'h12'].map((k) => <td key={k} style={num}>{won(g[k])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>우리 차를 사고대차로 내보내면</div>
        <p style={{ margin: '0 0 0.6rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          같은 급 피해 차량에 내보낸다고 보고, 우리 차 등급의 보험사 기준 대차료를 단기렌트 요금과 견줍니다. 30일 사고대차 = 보험사 기준으로 30일 대차료 합계.
          하이브리드는 2022-10부터 배기량이 아니라 같은 모델 내연기관 차 기준이라 그 등급으로 잡았습니다(예: 그랜저·쏘렌토 HEV → 2.5 기준 D). 다르면 등급을 직접 고르세요.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['NO', '차종', '배기량', '보험사 등급', '보험사 1일(1~2일차)', '우리 1일', '30일 사고대차', '우리 1개월'].map((h, i) => <th key={h} style={{ ...th, textAlign: i === 0 ? 'center' : i > 3 ? 'right' : 'left' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {cars.map((c, i) => {
                const g = data.insurerTable.find((x) => x.grade === c.insurer?.grade);
                return (
                  <tr key={c.ledgerId}>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{c.carModel} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{c.plateNo}</span></td>
                    <td style={td}>{c.cc ? `${toCommaString(c.cc)}cc` : '모름'}</td>
                    <td style={td}>
                      {canEdit ? (
                        <select value={c.insurer?.grade || ''} onChange={(e) => onGrade(c.ledgerId, e.target.value)} style={{ fontSize: '0.8rem', padding: '0.2rem' }}>
                          <option value="">자동</option>
                          {data.insurerTable.map((g) => <option key={g.grade} value={g.grade}>{g.size} {g.grade}</option>)}
                        </select>
                      ) : (c.insurer ? `${c.insurer.size} ${c.insurer.grade}` : '-')}
                      {c.insurer && <div style={{ fontSize: '0.68rem', color: c.insurer.basis === 'hybridUnknown' ? '#b45309' : 'var(--text-muted)' }}>{GRADE_BASIS[c.insurer.basis]}</div>}
                    </td>
                    <td style={num}>{won(c.insurer?.d1)}</td>
                    <td style={num}>{won(c.rates.day)}</td>
                    <td style={num}>{g ? won(insurerAmountFor(g, 30)) : '-'}</td>
                    <td style={num}>{won(c.rates.month)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 800 }}>공업사별 보험 담당자</span>
          {canEdit && (
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" style={btn(false)} onClick={() => setContacts((p) => [...p, { shop: '', insurer: '', name: '', phone: '', note: '' }])}><Plus size={14} /> 줄 추가</button>
              <button type="button" style={btn(true)} disabled={saving} onClick={onSave}><Save size={14} /> 저장</button>
            </div>
          )}
        </div>
        {contacts.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>아직 적은 담당자가 없습니다. [줄 추가]로 공업사·보험사·담당자·연락처를 적어 주세요.</div>}
        {contacts.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['공업사', '보험사', '보험 담당자', '연락처', '비고', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={i}>
                  {['shop', 'insurer', 'name', 'phone', 'note'].map((k) => (
                    <td key={k} style={td}>{canEdit ? <input style={{ ...inputSt, width: '100%', textAlign: 'left' }} value={c[k] || ''} onChange={(e) => setC(i, k, e.target.value)} /> : c[k]}</td>
                  ))}
                  <td style={td}>{canEdit && <button type="button" style={{ ...btn(false), padding: '0.2rem 0.4rem' }} onClick={() => setContacts((p) => p.filter((_, j) => j !== i))}><Trash2 size={13} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── 요금 규칙

function Policy({ policy, setPolicy, isAdmin, saving, onSave }) {
  const set = (path, value) => setPolicy((prev) => {
    const next = structuredClone(prev);
    let o = next;
    path.slice(0, -1).forEach((k) => { o = o[k]; });
    o[path[path.length - 1]] = value;
    return next;
  });
  const row = (label, input, hint) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) 1fr', gap: '0.6rem', alignItems: 'center', padding: '0.35rem 0', borderTop: '1px solid var(--border-color)' }}>
      <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{label}</span>
      <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{input}{hint}</span>
    </div>
  );
  const numIn = (path, value, opts = {}) => (
    <input disabled={!isAdmin} style={inputSt} value={opts.pct ? Math.round(value * 1000) / 10 : toCommaString(value ?? '')}
      onChange={(e) => {
        const raw = opts.pct ? Number(e.target.value.replace(/[^0-9.]/g, '')) / 100 : parseNumber(e.target.value);
        set(path, opts.nullable && e.target.value.trim() === '' ? null : raw);
      }} />
  );
  const textIn = (path, value) => <input disabled={!isAdmin} style={{ ...inputSt, width: '160px', textAlign: 'left' }} value={value} onChange={(e) => set(path, e.target.value)} />;
  const d = policy.delivery;

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 800 }}>요금 규칙</span>
        {isAdmin ? <button type="button" style={btn(true)} disabled={saving} onClick={onSave}><Save size={14} /> 저장</button>
          : <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>관리자만 바꿀 수 있습니다</span>}
      </div>
      {row('1개월 요금 계산', (
        <select disabled={!isAdmin} value={policy.monthly?.method || 'excel'} onChange={(e) => set(['monthly', 'method'], e.target.value)} style={{ fontSize: '0.8rem', padding: '0.25rem' }}>
          <option value="excel">엑셀 단기렌트 계산식 (차량가 36개월 회수, 반기마다 내림)</option>
          <option value="quote">견적 식 (3년 · 인수가 30% · 정비 포함, 차령 1년차 ×1.1 ~ 5년차 ×0.7)</option>
        </select>
      ))}
      {(policy.monthly?.method || 'excel') === 'excel' && <>
        {row('· 이자율 (연)', numIn(['monthly', 'interestRate'], policy.monthly.interestRate, { pct: true }), `% · ${policy.monthly.termMonths}개월 원리금 균등`)}
        {row('· 등록비용', numIn(['monthly', 'registrationRate'], policy.monthly.registrationRate, { pct: true }), '% (차량가 ÷ 1.1에 곱함)')}
        {row('· 보험료 (연)', numIn(['monthly', 'insuranceAnnual'], policy.monthly.insuranceAnnual), '원 + 자차 수리 예비비(차량가 기준 요율)')}
        {row('· 중고차 감가율', numIn(['monthly', 'residualRate'], policy.monthly.residualRate, { pct: true }), '% (0이면 차량가 전체를 36개월에 회수)')}
        {row('· 반기마다 내림', numIn(['monthly', 'stepRate'], policy.monthly.stepRate, { pct: true }), `% × 최대 ${policy.monthly.maxSteps}번 (3년 하반기까지)`)}
      </>}
      {row('1일 = 1개월 ×', numIn(['dayRatio'], policy.dayRatio, { pct: true }), '%')}
      {row('1일 요금 올림 단위', numIn(['dayRoundUnit'], policy.dayRoundUnit), '원')}
      {row('1주 = 1일 ×', numIn(['weekDays'], policy.weekDays), '일치')}
      {row('주말·공휴일 1일 할증', numIn(['weekendSurchargeRate'], policy.weekendSurchargeRate, { pct: true }), '%')}
      {row('포함 주행거리', <>1일 {numIn(['kmPerDay'], policy.kmPerDay)} · 1주 {numIn(['kmPerWeek'], policy.kmPerWeek)} · 월 {numIn(['kmPerMonth'], policy.kmPerMonth)}</>, 'km')}
      {row('초과 주행', numIn(['excessPerKm'], policy.excessPerKm), '원/km')}
      {row('보험', <>대인 {textIn(['insurance', 'bodily'], policy.insurance.bodily)} 대물 {textIn(['insurance', 'property'], policy.insurance.property)} 자손 {textIn(['insurance', 'selfInjury'], policy.insurance.selfInjury)} 자차 {textIn(['insurance', 'ownDamageLimit'], policy.insurance.ownDamageLimit)} 면책금 {textIn(['insurance', 'deductible'], policy.insurance.deductible)}</>)}
      {row('서울 탁송', <label><input type="checkbox" disabled={!isAdmin} checked={d.seoulFree} onChange={(e) => set(['delivery', 'seoulFree'], e.target.checked)} /> 2일 이상 대여 무료</label>)}
      {row('1일 대여 탁송료', numIn(['delivery', 'oneDayFee'], d.oneDayFee), '원')}
      {row('휴일 인도·회수 추가', <>{numIn(['delivery', 'holidayFee'], d.holidayFee)}원 / 1회 · 공휴일
        <label><input type="checkbox" disabled={!isAdmin} checked={d.holidayIncludesSunday} onChange={(e) => set(['delivery', 'holidayIncludesSunday'], e.target.checked)} /> 일요일 포함</label>
        <label><input type="checkbox" disabled={!isAdmin} checked={d.holidayIncludesSaturday} onChange={(e) => set(['delivery', 'holidayIncludesSaturday'], e.target.checked)} /> 토요일 포함</label></>)}
      {row('경기·인천 왕복 탁송', numIn(['delivery', 'regionFees', '경기·인천'], d.regionFees['경기·인천'], { nullable: true }), '원 (비우면 별도 협의)')}
      {row('그 밖의 지역', numIn(['delivery', 'regionFees', '기타'], d.regionFees['기타'], { nullable: true }), '원 (비우면 별도 협의)')}
      {row('안내 문구', <textarea disabled={!isAdmin} rows={3} style={{ width: '100%', fontSize: '0.8rem', padding: '0.4rem' }} value={policy.notes.join('\n')}
        onChange={(e) => set(['notes'], e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} />)}
    </div>
  );
}

export default ShortTermRatesView;
