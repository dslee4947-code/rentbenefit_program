import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Search, Undo2, FileText, Save } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => `${Math.round(Number(n) || 0).toLocaleString()}원`;
const ymd = (d) => (d ? new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : '-');
const todayYmd = () => ymd(new Date());
const STATUS_COLOR = { 예정: '#64748b', 청구됨: '#2563eb', 입금완료: '#047857', 미납: '#dc2626' };

/**
 * 단기렌트 월 청구 (자금팀 > 단기렌트 월 청구).
 *
 * 단기렌트·사고대차 차를 한 달 단위로 빌려주면(예: 주식회사 레이 그랜저 142호9185, 2026-09-16부터) 여기서 한 번 등록한다.
 * 그러면 매달 결제일(고르지 않으면 대여 시작일과 같은 날)을 청구일로 회차가 생기고, 청구서는 [장기렌트 청구서]에서 그 달을 열어 장기렌트와
 * 똑같이 발행·발송·입금 처리한다. 입금을 넣으면 그 차의 차량 손익 원장에 '○○ 단기렌트료 n회차'가 들어간다.
 * 반납하면 반납일까지 일할로 마지막 회차를 맞춘다.
 */
const EMPTY_FORM = () => ({ startDate: todayYmd(), billingDay: '', monthlyFee: '', vehicleId: '', billingEmail: '' });

export default function ShortTermBillingView({ showToast, currentUser, onOpenBilling }) {
  const canEdit = currentUser?.role !== 'viewer';
  const [data, setData] = useState({ items: [], vehicles: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM());
  const [party, setParty] = useState(null); // 고른 법인
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [returning, setReturning] = useState({}); // contractId -> 반납일
  const [editing, setEditing] = useState({}); // contractId -> 월 대여료

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_HOST}/api/short-term-billing`, { cache: 'no-store' }).then((r) => r.json());
      if (res.success) setData({ items: res.items, vehicles: res.vehicles });
      else showToast?.(res.message || '목록을 불러오지 못했습니다.', 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || party) return undefined;
    const t = setTimeout(async () => {
      const res = await fetch(`${API_HOST}/api/companies?search=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => []);
      setFound((Array.isArray(res) ? res : []).slice(0, 8));
    }, 250);
    return () => clearTimeout(t);
  }, [query, party]);

  const call = async (url, method, body, okMsg) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_HOST}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
      showToast?.(res.message || (res.success ? okMsg : '처리하지 못했습니다.'), res.success ? 'success' : 'error');
      if (res.success) await load();
      return res.success;
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!party) { showToast?.('법인을 골라 주세요.', 'error'); return; }
    const ok = await call('/api/short-term-billing', 'POST', {
      companyId: party._id, vehicleId: form.vehicleId, startDate: form.startDate, billingDay: Number(form.billingDay) || undefined,
      monthlyFee: Number(String(form.monthlyFee).replace(/[^\d]/g, '')), billingEmail: form.billingEmail || party.billingEmail
    }, '등록했습니다.');
    if (ok) { setParty(null); setQuery(''); setForm(EMPTY_FORM()); }
  };

  const card = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem 1.2rem' };
  const input = { padding: '0.45rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.84rem', boxSizing: 'border-box' };
  const btn = (bg, color = '#fff') => ({ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: bg, color, border: bg === '#fff' ? '1px solid var(--border-color)' : 'none', borderRadius: '6px', padding: '0.45rem 0.8rem', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' });
  const label = { fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' };

  const running = data.items.filter((c) => c.status === '진행중');
  const ended = data.items.filter((c) => c.status !== '진행중');

  const row = (c) => {
    const nextRound = c.rounds.find((r) => r.status === '예정' && !r.issued);
    return (
      <div key={c._id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px' }}>
            <div style={{ fontWeight: 800 }}>{c.companyId?.name || c.customer?.name || c.leaseCompany} · {c.vehicle?.carModel} {c.vehicle?.plateNo}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {c.contractNo} · {ymd(c.rentStartDate)}부터{c.returnDate ? ` ${ymd(c.returnDate)} 반납` : ' 이용 중'} · 월 {won(c.pricing?.monthlyFee)} · {c.pricing?.billingDay ? `매달 ${c.pricing.billingDay}일 결제` : '시작일과 같은 날 결제'} · 청구 메일 {c.billingEmail || '없음'}
              {c.unpaid > 0 && <b style={{ color: '#dc2626' }}> · 미납 {won(c.unpaid)}</b>}
            </div>
          </div>
          {nextRound && onOpenBilling && (
            <button type="button" onClick={() => onOpenBilling(ymd(nextRound.dueDate).slice(0, 7))} style={btn('var(--primary)')}>
              <FileText size={14} /> {nextRound.no}회차 청구서 ({ymd(nextRound.dueDate).slice(5)})
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', fontSize: '0.74rem' }}>
          {c.rounds.map((r) => (
            <span key={r.no} title={`${ymd(r.dueDate)} · ${won(r.total)}${r.paidAmount ? ` · 입금 ${won(r.paidAmount)}` : ''}`} style={{ border: `1px solid ${STATUS_COLOR[r.status]}`, color: STATUS_COLOR[r.status], borderRadius: '999px', padding: '0.1rem 0.5rem' }}>
              {r.no}회 {ymd(r.dueDate).slice(5)} {r.status}{r.issued && r.status === '예정' ? '(발행)' : ''}
            </span>
          ))}
        </div>
        {canEdit && c.status === '진행중' && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem' }}>
            <input value={editing[c._id] ?? ''} onChange={(e) => setEditing((m) => ({ ...m, [c._id]: e.target.value }))} placeholder="월 대여료 고치기" style={{ ...input, width: '150px' }} />
            <button type="button" disabled={busy || !editing[c._id]} onClick={() => call(`/api/short-term-billing/${c._id}`, 'PATCH', { monthlyFee: Number(String(editing[c._id]).replace(/[^\d]/g, '')) }, '고쳤습니다.').then((ok) => ok && setEditing((m) => ({ ...m, [c._id]: '' })))} style={btn('#fff', 'var(--text-main)')}>
              <Save size={13} /> 금액 저장
            </button>
            <span style={{ marginLeft: 'auto' }} />
            <input type="date" value={returning[c._id] || ''} onChange={(e) => setReturning((m) => ({ ...m, [c._id]: e.target.value }))} style={input} />
            <button type="button" disabled={busy || !returning[c._id]} onClick={() => call(`/api/short-term-billing/${c._id}/return`, 'POST', { returnDate: returning[c._id] }, '반납 처리했습니다.')} style={btn('#b45309')}>
              <Undo2 size={13} /> 반납 (일할 정산)
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ ...card, fontSize: '0.82rem', lineHeight: 1.7, color: 'var(--text-muted)' }}>
        단기렌트·사고대차 차를 <b>한 달 단위</b>로 빌려줄 때 여기서 한 번 등록하세요. 고른 결제일(고르지 않으면 대여 시작일과 같은 날)이 매달 청구일이 됩니다.
        청구서는 <b>[장기렌트 청구서]</b>에서 그 달을 열면 장기렌트와 함께 보이고(계약번호 '단기-…', <b>단기</b> 꼬리표), 똑같이 발행·보내기·입금 처리합니다.
        입금을 넣으면 그 차의 <b>차량 손익 원장</b>에 '법인명 단기렌트료 n회차'가 자동으로 들어갑니다. 원장에 따로 적지 마세요(두 번 잡힙니다).
        반납하면 반납일까지 일할로 마지막 회차를 맞춥니다.
      </div>

      {canEdit && (
        <form onSubmit={create} style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem', alignItems: 'end' }}>
          <div style={{ position: 'relative' }}>
            <div style={label}>법인</div>
            {party ? (
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <b style={{ fontSize: '0.86rem' }}>{party.name}</b>
                <button type="button" onClick={() => { setParty(null); setQuery(''); }} style={{ ...btn('#fff', 'var(--text-muted)'), padding: '0.2rem 0.5rem' }}>바꾸기</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Search size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="법인명·사업자번호" style={{ ...input, width: '100%' }} />
              </div>
            )}
            {!party && query.trim().length >= 2 && found.length > 0 && (
              <div style={{ position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                {found.map((c) => (
                  <button key={c._id} type="button" onClick={() => { setParty(c); setForm((f) => ({ ...f, billingEmail: c.billingEmail || '' })); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.45rem 0.6rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.82rem' }}>
                    <b>{c.name}</b> <span style={{ color: 'var(--text-muted)' }}>{c.bizNo || ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label>
            <div style={label}>차량 (단기렌트 차량)</div>
            <select value={form.vehicleId} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))} style={{ ...input, width: '100%' }}>
              <option value="">골라 주세요</option>
              {data.vehicles.map((v) => (
                <option key={v._id} value={v._id} disabled={Boolean(v.rentedTo)}>{v.plateNo} · {v.carModel} ({v.code}){v.rentedTo ? ` — ${v.rentedTo} 이용 중` : ''}</option>
              ))}
            </select>
          </label>
          <label>
            <div style={label}>대여 시작일</div>
            <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} style={{ ...input, width: '100%' }} />
          </label>
          <label>
            <div style={label}>결제일 (매달 청구일)</div>
            <select value={form.billingDay} onChange={(e) => setForm((f) => ({ ...f, billingDay: e.target.value }))} style={{ ...input, width: '100%' }}>
              <option value="">대여 시작일과 같은 날</option>
              <option value="5">5일</option>
              <option value="10">10일</option>
              <option value="15">15일</option>
              <option value="25">25일</option>
              <option value="31">말일</option>
            </select>
          </label>
          <label>
            <div style={label}>월 대여료 (부가세 포함)</div>
            <input value={form.monthlyFee} onChange={(e) => setForm((f) => ({ ...f, monthlyFee: e.target.value }))} placeholder="예: 1,189,725" style={{ ...input, width: '100%' }} />
          </label>
          <label>
            <div style={label}>청구 메일</div>
            <input value={form.billingEmail} onChange={(e) => setForm((f) => ({ ...f, billingEmail: e.target.value }))} placeholder="법인 청구 이메일" style={{ ...input, width: '100%' }} />
          </label>
          <button type="submit" disabled={busy} style={btn('var(--primary)')}><Plus size={14} /> 단기렌트 월 청구 등록</button>
        </form>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <b>이용 중 {running.length}건</b>
        <button type="button" onClick={load} disabled={loading} style={btn('#fff', 'var(--text-main)')}><RefreshCw size={13} /> 새로고침</button>
      </div>
      {running.length === 0 && <div style={{ ...card, color: 'var(--text-muted)' }}>이용 중인 단기렌트 월 청구가 없습니다.</div>}
      {running.map(row)}
      {ended.length > 0 && <b>반납 {ended.length}건</b>}
      {ended.map(row)}
    </div>
  );
}
