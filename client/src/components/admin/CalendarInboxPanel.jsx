import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ymd = (d) => (d ? new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : '');
const hm = (d) => (d ? new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(11, 16) : '');
const comma = (n) => (n === undefined || n === null || n === '' ? '' : Number(n).toLocaleString());

/**
 * 구글 업무캘린더 → 정비 기록 '확인 대기'.
 *
 * 직원이 핸드폰 캘린더에 적은 정비 일정 중 우리 차량번호가 있는 것을 서버가 10분마다 읽어 온다.
 * 같은 캘린더에 고객 차·대차 일정이 섞여 있어 자동으로 기록을 만들지 않고, 여기서 확인하고 옮긴다.
 *
 * @param {object[]} vehicles 정비 화면의 차량 목록(차량번호를 못 찾은 일정에서 차를 고를 때)
 * @param {Function} onImported 기록을 옮긴 뒤 정비 목록을 다시 불러온다
 */
export default function CalendarInboxPanel({ vehicles, onImported, showToast }) {
  const [data, setData] = useState({ items: [], kinds: [], configured: true, lastSyncAt: null });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [edits, setEdits] = useState({});

  const load = useCallback(() => fetch(`${API_HOST}/api/vehicle-services/calendar-inbox`)
    .then((res) => res.json())
    .then((d) => { if (d.success) setData(d); })
    .catch(() => { /* 목록은 다음에 다시 불러온다 */ }), []);
  useEffect(() => { load(); }, [load]);

  const editOf = (it) => ({
    vehicleId: it.vehicle?._id || '',
    kinds: it.parsed?.kinds || [],
    amount: it.parsed?.amount ?? '',
    mileageIn: it.parsed?.mileageIn ?? '',
    mileageOut: it.parsed?.mileageOut ?? '',
    ...(edits[it._id] || {})
  });
  const setEdit = (id, patch) => setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));

  const syncNow = async () => {
    setBusy('sync');
    try {
      const res = await fetch(`${API_HOST}/api/vehicle-services/calendar-inbox/sync`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      showToast?.(d.message || '처리했습니다.', d.success ? 'success' : 'error');
      await load();
    } finally { setBusy(''); }
  };

  const act = async (it, action) => {
    const e = editOf(it);
    if (action === 'import' && !e.vehicleId) { showToast?.('차량을 골라 주세요.', 'error'); return; }
    if (action === 'import' && !e.kinds.length) { showToast?.('종류를 하나 이상 골라 주세요.', 'error'); return; }
    setBusy(it._id);
    try {
      const res = await fetch(`${API_HOST}/api/vehicle-services/calendar-inbox/${it._id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'import' ? JSON.stringify(e) : undefined
      });
      const d = await res.json().catch(() => ({}));
      showToast?.(d.message || '처리했습니다.', d.success ? 'success' : 'error');
      if (d.success) {
        await load();
        if (action === 'import') onImported?.();
      }
    } finally { setBusy(''); }
  };

  const waiting = data.items.filter((x) => x.status !== '옮김');
  const flagged = data.items.filter((x) => x.status === '옮김');
  const count = data.items.length;

  const btn = (bg, fg) => ({ border: `1px solid ${bg === '#fff' ? 'var(--border-color)' : bg}`, background: bg, color: fg, padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' });
  const input = { padding: '0.25rem 0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', width: '90px', boxSizing: 'border-box' };
  const small = { fontSize: '0.72rem', color: 'var(--text-muted)' };

  return (
    <div style={{ border: `1px solid ${count ? '#93c5fd' : 'var(--border-color)'}`, borderRadius: '8px', background: count ? '#eff6ff' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.8rem', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <b style={{ color: '#1e3a8a', fontSize: '0.86rem' }}>구글 캘린더 확인 대기 {waiting.length}건</b>
        {flagged.length > 0 && <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#c2410c' }}>· 옮긴 뒤 바뀐 일정 {flagged.length}건</span>}
        <span style={small}>
          {data.configured ? `마지막으로 읽은 때 ${data.lastSyncAt ? `${ymd(data.lastSyncAt)} ${hm(data.lastSyncAt)}` : '-'} · 10분마다 읽음` : '캘린더 열쇠가 설정되지 않은 서버입니다'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button type="button" disabled={!data.configured || busy === 'sync'} onClick={(ev) => { ev.stopPropagation(); syncNow(); }} style={{ ...btn('#fff', 'var(--text-muted)'), display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <RefreshCw size={12} /> {busy === 'sync' ? '읽는 중...' : '지금 읽기'}
          </button>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid #bfdbfe', background: '#fff', borderRadius: '0 0 8px 8px' }}>
          {count === 0 ? (
            <div style={{ padding: '1rem', textAlign: 'center', ...small }}>확인할 일정이 없습니다.</div>
          ) : data.items.map((it) => {
            const e = editOf(it);
            const p = it.parsed || {};
            const after = it.status === '옮김';
            return (
              <div key={it._id} style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.35rem', background: after ? '#fff7ed' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <b style={{ fontSize: '0.82rem' }}>{ymd(it.start)}</b>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-bright)' }}>{it.title}</span>
                  {it.htmlLink && <a href={it.htmlLink} target="_blank" rel="noreferrer" style={{ ...small, display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>캘린더 <ExternalLink size={11} /></a>}
                  {it.status === '번호없음' && <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#6d28d9' }}>차량번호 확인 필요</span>}
                  {after && <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#c2410c' }}>{it.eventDeleted ? '옮긴 뒤 캘린더에서 지움' : '옮긴 뒤 캘린더에서 고침'} · 정비 기록을 확인해 주세요</span>}
                </div>
                <div style={{ ...small, lineHeight: 1.5 }}>
                  {[p.carModel && `${p.carModel}`, p.shop && `입고 ${p.shop}`, p.staff && `담당 ${p.staff}`].filter(Boolean).join(' · ')}
                  {p.request && <div>의뢰: {p.request}</div>}
                  {p.done && <div>내용: {p.done}</div>}
                  {p.costText && <div>비용: {p.costText}</div>}
                </div>
                {after ? (
                  <div><button type="button" disabled={busy === it._id} onClick={() => act(it, 'dismiss')} style={btn('#fff', 'var(--text-muted)')}>확인함</button></div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <select value={e.vehicleId} onChange={(ev) => setEdit(it._id, { vehicleId: ev.target.value })} style={{ ...input, width: '150px' }}>
                      <option value="">차량 고르기</option>
                      {it.vehicle && !vehicles.some((v) => v.vehicleId === it.vehicle._id) && <option value={it.vehicle._id}>{it.vehicle.plateNo} {it.vehicle.carModel}</option>}
                      {vehicles.map((v) => <option key={v.vehicleId} value={v.vehicleId}>{v.plateNo} {v.carModel}</option>)}
                    </select>
                    {data.kinds.map((k) => {
                      const on = e.kinds.includes(k);
                      return (
                        <button key={k} type="button" onClick={() => setEdit(it._id, { kinds: on ? e.kinds.filter((x) => x !== k) : [...e.kinds, k] })}
                          style={{ ...btn(on ? '#1e3a8a' : '#fff', on ? '#fff' : 'var(--text-muted)'), padding: '0.2rem 0.45rem', fontSize: '0.72rem' }}>
                          {k}
                        </button>
                      );
                    })}
                    <label style={small}>금액 <input value={comma(e.amount)} onChange={(ev) => setEdit(it._id, { amount: ev.target.value.replace(/[^\d]/g, '') })} style={input} /></label>
                    <label style={small}>입고 km <input value={comma(e.mileageIn)} onChange={(ev) => setEdit(it._id, { mileageIn: ev.target.value.replace(/[^\d]/g, '') })} style={input} /></label>
                    <label style={small}>출고 km <input value={comma(e.mileageOut)} onChange={(ev) => setEdit(it._id, { mileageOut: ev.target.value.replace(/[^\d]/g, '') })} style={input} /></label>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
                      <button type="button" disabled={busy === it._id} onClick={() => act(it, 'import')} style={btn('#1e3a8a', '#fff')}>기록으로 옮기기</button>
                      <button type="button" disabled={busy === it._id} onClick={() => act(it, 'dismiss')} style={btn('#fff', 'var(--text-muted)')}>정비 아님</button>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ padding: '0.5rem 0.8rem', ...small, lineHeight: 1.6 }}>
            업무캘린더에 '&lt; 차종 / 차량번호 &gt; AS' 줄이 있는 일정 중 우리 차만 올라옵니다. 종류는 제목·점검 의뢰·점검 내용으로 짐작한 것이라 확인하고 옮겨 주세요.
            여러 종류를 고르면(예: 사고수리 + 정기점검) 종류마다 기록이 하나씩 생기고, 금액은 첫 기록에만 들어갑니다.
          </div>
        </div>
      )}
    </div>
  );
}
