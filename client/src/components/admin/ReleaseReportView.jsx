import { useState } from 'react';
import { Search, Copy, FileText, X, Save, RotateCcw } from 'lucide-react';
import { RELEASE_FIELDS, releaseReportText, releaseEndDate } from '../../utils/releaseReport.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * 렌트출고 보고 글(대표님 2026-11-12).
 * 계약을 찾아 차를 고르면 계약·차량·전자계약서 값으로 양식이 채워진다.
 * 칸을 고치면 오른쪽 글이 바로 바뀌고, [저장]하면 차량에 남아 다음에 열어도 그대로 나온다.
 */
export default function ReleaseReportView({ showToast }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [data, setData] = useState(null);
  const [vehicleId, setVehicleId] = useState('');
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const car = data?.vehicles?.find((x) => String(x.vehicleId) === String(vehicleId));

  const search = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { showToast?.('두 글자 이상 넣어 주세요.', 'error'); return; }
    const res = await fetch(`${API_HOST}/api/delivery-docs/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!res?.success) { showToast?.(res?.message || '찾지 못했습니다.', 'error'); return; }
    setFound(res.items || []);
  };

  const pick = (d, v) => {
    setVehicleId(v ? String(v.vehicleId) : '');
    setForm(v ? { ...v.defaults, ...(v.saved || {}) } : null);
    setDirty(false);
  };

  const openOne = async (contractId) => {
    const res = await fetch(`${API_HOST}/api/delivery-docs/${contractId}/release-report`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!res?.success) { showToast?.(res?.message || '계약을 불러오지 못했습니다.', 'error'); return; }
    setData(res.data);
    setFound(null);
    pick(res.data, res.data.vehicles?.[0]);
  };

  // 인도일을 바꾸면 종료일도 인도일 + 기간 − 1일로 다시 맞춘다(종료일은 그 뒤에 따로 고칠 수 있다)
  const set = (k) => (e) => {
    const val = e.target.value;
    setForm((f) => {
      const next = { ...f, [k]: val };
      if (k === 'deliveryDate') next.endDate = releaseEndDate(val, f.termMonths) || f.endDate;
      return next;
    });
    setDirty(true);
  };

  const save = async (values) => {
    if (!data || !car) return;
    setBusy(true);
    const res = await fetch(`${API_HOST}/api/delivery-docs/${data.contractId}/release-report/${car.vehicleId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values })
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (!res?.success) { showToast?.(res?.message || '저장하지 못했습니다.', 'error'); return; }
    setData((d) => ({ ...d, vehicles: d.vehicles.map((x) => (String(x.vehicleId) === String(car.vehicleId) ? { ...x, saved: res.saved, savedAt: res.savedAt } : x)) }));
    if (values === null) setForm({ ...car.defaults });
    setDirty(false);
    showToast?.(res.message, 'success');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(releaseReportText(form));
      showToast?.('출고 보고 글을 복사했습니다.', 'success');
    } catch {
      showToast?.('복사하지 못했습니다. 브라우저가 클립보드를 막았는지 확인해 주세요.', 'error');
    }
  };

  const btn = (bg, color = '#fff') => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', background: bg, color, border: bg === '#fff' ? '1px solid var(--border-color)' : 'none', borderRadius: '6px', padding: '0.5rem 0.8rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' });
  const input = { width: '100%', padding: '0.4rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box', fontFamily: 'inherit' };
  const card = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.2rem' };
  const changed = (k) => car && String(form?.[k] ?? '') !== String(car.defaults?.[k] ?? '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={card}>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.6rem' }}>
          출고한 차의 <b>렌트출고 보고 글</b>을 만듭니다. 계약을 찾으면 계약·차량·전자계약서 값으로 칸이 채워집니다.
          실제와 다른 칸(인도일, 썬팅 농도, 기타작업 등)을 고치고 <b>[저장]</b>한 뒤 <b>[글 복사]</b>로 붙여 넣으세요.
        </div>
        <form onSubmit={search} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="계약자(법인·고객) 이름 · 계약번호 · 차량번호" style={{ ...input, width: '320px', maxWidth: '100%' }} />
          <button type="submit" style={btn('var(--primary)')}><Search size={14} /> 찾기</button>
          {found && <button type="button" onClick={() => { setFound(null); setQuery(''); }} style={btn('#fff', 'var(--text-muted)')}>닫기</button>}
        </form>
        {found && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', marginTop: '0.7rem' }}>
            <tbody>
              {found.length === 0 && <tr><td style={{ padding: '0.8rem', color: 'var(--text-muted)' }}>찾은 계약이 없습니다.</td></tr>}
              {found.map((f) => (
                <tr key={f.contractId} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.5rem' }}><b>{f.partyName}</b> <span style={{ color: 'var(--text-muted)' }}>{f.contractNo} · {f.contractStatus}</span></td>
                  <td style={{ padding: '0.5rem' }}>{(f.vehicles || []).map((v) => `${v.plateNo || '(번호 없음)'} ${v.carModel}`).join(', ') || '-'}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                    <button type="button" onClick={() => openOne(f.contractId)} style={btn('var(--primary)')}><FileText size={14} /> 열기</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && form && (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ ...card, flex: '1 1 420px', maxWidth: '640px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '0.8rem', fontSize: '0.88rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 800 }}>{data.party}</div>
                <div style={{ color: 'var(--text-muted)' }}>
                  {data.contractNo}
                  {car?.savedAt ? ` · 저장 ${new Date(car.savedAt).toLocaleString('ko-KR')}${car.savedBy ? ` (${car.savedBy})` : ''}` : ' · 아직 저장 안 함'}
                </div>
              </div>
              <button type="button" onClick={() => { setData(null); setForm(null); }} aria-label="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {data.vehicles.length > 1 && (
              <label>
                <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>차량</div>
                <select value={vehicleId} onChange={(e) => pick(data, data.vehicles.find((x) => String(x.vehicleId) === e.target.value))} style={input}>
                  {data.vehicles.map((x) => <option key={x.vehicleId} value={x.vehicleId}>{x.plateNo || '(번호 없음)'} · {x.carModel}</option>)}
                </select>
              </label>
            )}

            {RELEASE_FIELDS.map((g) => (
              <div key={g.group}>
                <div style={{ fontWeight: 800, color: 'var(--primary)', marginBottom: '0.35rem' }}>{g.group}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                  {g.items.map(([k, name, type]) => (
                    <label key={k} style={type === 'textarea' || ['place', 'carModel', 'tinting', 'extra'].includes(k) ? { gridColumn: '1 / -1' } : undefined}>
                      <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>
                        {name}{changed(k) && <span style={{ color: '#b45309', fontWeight: 600 }}> · 고침</span>}
                      </div>
                      {type === 'textarea'
                        ? <textarea value={form[k] || ''} onChange={set(k)} rows={3} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
                        : <input type={type || 'text'} value={form[k] || ''} onChange={set(k)} style={input} />}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" disabled={busy || !dirty} onClick={() => save(form)} style={{ ...btn('var(--primary)'), opacity: busy || !dirty ? 0.5 : 1 }}><Save size={14} /> 저장</button>
              {car?.saved && (
                <button type="button" disabled={busy} onClick={() => save(null)} style={btn('#fff', 'var(--text-muted)')}><RotateCcw size={14} /> 처음 값으로</button>
              )}
            </div>
          </div>

          <div style={{ ...card, flex: '1 1 420px', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 800 }}>출고 보고 글</span>
              <button type="button" onClick={copy} style={btn('var(--primary)')}><Copy size={14} /> 글 복사</button>
            </div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'inherit', fontSize: '0.88rem', lineHeight: 1.6, background: '#f9fafb', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.8rem' }}>
              {releaseReportText(form)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
