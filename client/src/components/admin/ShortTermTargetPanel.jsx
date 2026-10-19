import React, { useEffect, useState } from 'react';
import { toCommaString } from '../../utils/format.js';
import MoneyInput from './MoneyInput.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const START_SOURCE = {
  manual: '직접 정한 날',
  afterLongTerm: '장기렌트 마지막 렌트료 다음 달',
  delivered: '출고일',
  registered: '등록일',
  firstEntry: '원장 첫 줄 날짜'
};

const pct = (r) => (r === null || r === undefined ? '-' : `${Math.round(r * 100)}%`);
const rateColor = (r) => (r === null || r === undefined ? 'var(--text-muted)' : r >= 1 ? '#15803d' : r >= 0.7 ? '#b45309' : '#b91c1c');
const ymd = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: 'var(--bg-main)', borderRadius: '8px', padding: '0.6rem 0.75rem', minWidth: 0 }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: color || 'var(--text-bright)', marginTop: '0.15rem' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem', lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

/**
 * 단기렌트 월 목표 달성 (원장 1장 = 차 1대).
 *
 * 월 목표는 견적서로 3년·인수가 30%·정비 포함 계약을 잡았을 때의 월 렌트료다(shared/shortTermTarget.js).
 * 실제는 원장 고객입금 열의 단기렌트 입금을 달마다 더한 값이다. 원장을 저장하면 다시 계산한다(reloadKey).
 */
function ShortTermTargetPanel({ ledgerId, reloadKey, canEdit, authHeaders, showToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ monthlyTarget: '', startDate: '' });
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = () => fetch(`${API_HOST}/api/ledgers/${ledgerId}/short-term`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error('단기렌트 목표를 불러오지 못했습니다.'))))
    .then((d) => { setData(d); setError(''); })
    .catch((err) => setError(err.message));

  useEffect(() => { load(); }, [ledgerId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => {
    setForm({
      monthlyTarget: data?.targetSource === 'manual' ? data.performance.monthlyTarget : '',
      startDate: data?.performance?.start?.source === 'manual' ? ymd(data.performance.start.date) : ''
    });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/${ledgerId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ shortTerm: { monthlyTarget: Number(form.monthlyTarget) || null, startDate: form.startDate || null } })
      });
      if (!res.ok) throw new Error((await res.json()).message);
      await load();
      setEditing(false);
      showToast?.('단기렌트 목표를 저장했습니다.', 'success');
    } catch (err) {
      showToast?.(err.message || '저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const box = { background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', padding: '1.1rem 1.2rem' };
  if (error) return <div style={{ ...box, color: '#b91c1c', fontSize: '0.85rem' }}>{error}</div>;
  if (!data) return <div style={{ ...box, color: 'var(--text-muted)', fontSize: '0.85rem' }}>단기렌트 목표를 계산하는 중입니다...</div>;

  const p = data.performance || {};
  const months = [...(p.months || [])].reverse();
  const shown = showAll ? months : months.slice(0, 12);
  const maxVal = Math.max(1, ...months.map((m) => Math.max(m.actual, m.target)));

  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#fa8c16' }}>단기렌트 월 목표 · 매달 벌어 오는지</span>
        {canEdit && !editing && (
          <button type="button" onClick={startEdit} style={{ border: '1px solid var(--border-color)', background: '#fff', borderRadius: '6px', padding: '0.25rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer' }}>
            목표·시작일 고치기
          </button>
        )}
      </div>
      <p style={{ margin: '0 0 0.8rem', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
        견적서로 <b>3년 계약 · 인수가 30% · 정비 포함</b>을 잡았을 때의 월 렌트료가 이 차가 매달 벌어 와야 할 돈입니다(선수금 없음).
        이만큼 벌고 3년 뒤 차량가의 30%에 팔면 3년 동안 이 차에 나간 돈을 다 회수합니다.
        고객은 같은 값이면 새 차를 고르므로 <b>차령에 따라</b> 1년차 ×1.1 · 2년차 ×1.0 · 3년차 ×0.9 · 4년차 ×0.8 · 5년차 이후 ×0.7로 가감합니다(1~3년 합계는 같음). 실제는 원장 고객입금 열의 대여 입금(보증금·장기 렌트료·과태료 대납 제외)입니다.
      </p>

      {editing && (
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--bg-main)', borderRadius: '8px', padding: '0.7rem', marginBottom: '0.8rem' }}>
          <label style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            기준 월 목표 · 차령 가감 전 (비우면 견적 계산값 {toCommaString(data.calculatedTarget || 0)}원)
            <MoneyInput value={form.monthlyTarget} onChange={(e) => setForm((f) => ({ ...f, monthlyTarget: e.target.value }))} style={{ width: '10rem' }} />
          </label>
          <label style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            단기렌트 시작일 (비우면 원장에서 찾음)
            <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} style={{ padding: '0.3rem' }} />
          </label>
          <button type="button" disabled={saving} onClick={save} style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.4rem 0.9rem', fontWeight: 700, cursor: 'pointer' }}>
            {saving ? '저장 중...' : '저장'}
          </button>
          <button type="button" onClick={() => setEditing(false)} style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.4rem 0.9rem', cursor: 'pointer' }}>취소</button>
        </div>
      )}

      {data.reason ? (
        <div style={{ color: '#b45309', fontSize: '0.85rem' }}>{data.reason}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', marginBottom: '0.9rem' }}>
            <Stat
              label={`이번 달 목표 (${p.ageYear}년차 ×${p.ageFactor})`}
              value={`${toCommaString(p.currentTarget)}원`}
              sub={<>
                기준 월 목표 {toCommaString(p.monthlyTarget)}원 ({data.targetSource === 'manual' ? '직접 정함' : '견적 계산'})
                {data.targetSource === 'manual' && data.calculatedTarget ? <><br />견적 계산값 {toCommaString(data.calculatedTarget)}원</> : null}
                {data.compareTarget && <><br />5년·인수가 0%면 월 {toCommaString(data.compareTarget.monthlyTarget)}원</>}
              </>}
            />
            <Stat
              label="최근 3개월 평균"
              value={p.avg3 === null ? '-' : `${toCommaString(p.avg3)}원`}
              sub={`목표의 ${pct(p.avg3Rate)}`}
              color={rateColor(p.avg3Rate)}
            />
            <Stat
              label="목표 채운 달"
              value={`${p.metMonths} / ${p.doneMonths}개월`}
              sub={`시작 ${ymd(p.start?.date)} (${START_SOURCE[p.start?.source] || '-'})`}
            />
            <Stat
              label="지금까지 목표 대비"
              value={`${p.gap < 0 ? '-' : '+'}${toCommaString(Math.abs(Math.round(p.gap)))}원`}
              sub={`번 돈 ${toCommaString(Math.round(p.cumActual))} / 목표 ${toCommaString(Math.round(p.cumTarget))}`}
              color={p.gap < 0 ? '#b91c1c' : '#15803d'}
            />
            <Stat
              label="3년 회수 진행"
              value={pct(p.recoveryRate)}
              sub={p.beyondTerm ? '3년이 지났습니다' : `${p.elapsedMonths}개월째 / 36개월`}
              color={p.recoveryRate >= (p.elapsedMonths / 36) ? '#15803d' : '#b45309'}
            />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.35rem', fontWeight: 700 }}>달</th>
                  <th style={{ padding: '0.35rem', fontWeight: 700 }}>차령</th>
                  <th style={{ padding: '0.35rem', fontWeight: 700, textAlign: 'right' }}>목표</th>
                  <th style={{ padding: '0.35rem', fontWeight: 700, textAlign: 'right' }}>번 돈</th>
                  <th style={{ padding: '0.35rem', fontWeight: 700, textAlign: 'right' }}>달성</th>
                  <th style={{ padding: '0.35rem', fontWeight: 700, width: '35%' }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.month} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.35rem', whiteSpace: 'nowrap' }}>
                      {m.month}
                      {m.current && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}> (오늘까지)</span>}
                      {!m.current && m.partial && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}> (시작 달, 일할)</span>}
                    </td>
                    <td style={{ padding: '0.35rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{m.ageYear}년차 ×{m.factor}</td>
                    <td style={{ padding: '0.35rem', textAlign: 'right', color: 'var(--text-muted)' }}>{toCommaString(m.target)}</td>
                    <td style={{ padding: '0.35rem', textAlign: 'right', fontWeight: 600 }}>{toCommaString(m.actual)}</td>
                    <td style={{ padding: '0.35rem', textAlign: 'right', fontWeight: 700, color: rateColor(m.rate) }}>{pct(m.rate)}</td>
                    <td style={{ padding: '0.35rem' }}>
                      <div style={{ position: 'relative', height: '10px', background: 'var(--bg-main)', borderRadius: '5px' }}>
                        <div style={{ position: 'absolute', inset: 0, width: `${(m.actual / maxVal) * 100}%`, background: rateColor(m.rate), borderRadius: '5px', opacity: 0.75 }} />
                        <div title="목표" style={{ position: 'absolute', top: '-2px', bottom: '-2px', left: `${(m.target / maxVal) * 100}%`, width: '2px', background: '#334155' }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {months.length > 12 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} style={{ marginTop: '0.4rem', border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.78rem' }}>
                {showAll ? '최근 12개월만 보기' : `전체 ${months.length}개월 보기`}
              </button>
            )}
            {p.undated > 0 && (
              <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.3rem' }}>날짜가 없는 입금 {toCommaString(p.undated)}원은 달에 나누지 못해 누적에만 넣었습니다.</div>
            )}
          </div>

          {data.assumptions?.length > 0 && (
            <details style={{ marginTop: '0.7rem', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              <summary style={{ cursor: 'pointer' }}>목표 계산 근거 (3년 총원가 {toCommaString(Math.round(data.totalCost || 0))}원 · 정비 {toCommaString(data.maintenanceCost || 0)}원 포함 · 인수가 30% {toCommaString(data.takeoverPrice || 0)}원)</summary>
              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', lineHeight: 1.6 }}>
                {data.assumptions.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export default ShortTermTargetPanel;
