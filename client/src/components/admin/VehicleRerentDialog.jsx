import { useEffect, useState } from 'react';
import { X, Repeat, Search } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';
import { PAYMENT_DAY_OPTIONS, formatCustomerName } from '../../utils/format.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const today = () => {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/**
 * 재렌트 창. 반납받은 차(재고·단기렌트)를 새 고객에게 중고로 장기 렌트한다.
 *
 * - 차량은 새로 만들지 않는다. 손익 원장에도 같은 장부에 '재렌트' 구간으로 이어진다.
 * - 평가액은 중고차 사업부가 알려 준 금액을 넣는다(대표님 결정 2026-10-05).
 * - 보증금은 새 계약자에게 새로 받는다. 이전 계약자 보증금은 반납 때 돌려줬다.
 * - 새 고객이 없으면 고객 DB 관리에서 먼저 등록한다.
 *
 * @param {object} props
 * @param {object} props.vehicle 재렌트할 차 (렌트차량 DB 줄)
 * @param {() => void} props.onClose
 * @param {() => void} [props.onDone]
 * @param {Function} props.showToast
 */
function VehicleRerentDialog({ vehicle, onClose, onDone, showToast }) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [customer, setCustomer] = useState(null); // 고른 고객 (companies 포함)
  const [companyId, setCompanyId] = useState(''); // 법인 계약이면 그 법인
  const [form, setForm] = useState({
    contractDate: today(), termMonths: 36, monthlyFee: '', deposit: '', advancePayment: '', takeoverPrice: '',
    appraisalValue: '', monthlyPaymentDay: vehicle.monthlyPaymentDay || '25'
  });
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // 고객 이름·사업자번호로 찾는다. 두 글자부터, 입력이 멈추면 찾는다.
  useEffect(() => {
    if (keyword.trim().length < 2) { setResults([]); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_HOST}/api/customers?search=${encodeURIComponent(keyword.trim())}&limit=8`);
        const data = await res.json();
        setResults(data.customers || []);
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  const pickCustomer = async (c) => {
    try {
      const res = await fetch(`${API_HOST}/api/customers/${c._id}`);
      const data = await res.json();
      setCustomer(data?._id ? data : c);
      const primary = (data?.companies || []).find((x) => x.isPrimary) || (data?.companies || [])[0];
      setCompanyId(primary?.companyId?._id || '');
    } catch {
      setCustomer(c);
    }
    setResults([]);
    setKeyword('');
  };

  const submit = async () => {
    if (!customer) { showToast?.('새 계약자(고객)를 골라 주세요.', 'error'); return; }
    if (!Number(form.appraisalValue)) { showToast?.('차량 평가액(중고차 사업부 금액)을 입력해 주세요.', 'error'); return; }
    if (!Number(form.monthlyFee)) { showToast?.('월 렌트료를 입력해 주세요.', 'error'); return; }
    const party = companyId ? (customer.companies || []).find((x) => x.companyId?._id === companyId)?.companyId?.name : formatCustomerName(customer);
    if (!window.confirm(`${vehicle.carModel} ${vehicle.plateNo || ''}을(를) ${party}에게 재렌트합니다.\n${form.termMonths}개월 · 월 ${Number(form.monthlyFee).toLocaleString()}원 · 평가액 ${Number(form.appraisalValue).toLocaleString()}원\n진행할까요?`)) return;
    try {
      setSaving(true);
      const res = await fetch(`${API_HOST}/api/contracts/rerent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: vehicle._id, customerId: customer._id, companyId: companyId || undefined, ...form })
      });
      const data = await res.json();
      if (!data.success) {
        showToast?.(data.message || '재렌트 계약을 만들지 못했습니다.', 'error');
        return;
      }
      showToast?.(data.message, 'success');
      onDone?.();
      onClose();
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const input = { padding: '0.5rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.88rem', width: '100%', boxSizing: 'border-box' };
  const label = { fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem', display: 'block' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 1rem', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: '12px', width: 'min(640px, 100%)', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.2rem', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '1.05rem' }}>
            <Repeat size={18} style={{ color: 'var(--primary)' }} /> 재렌트 계약 — 새 고객에게 중고 장기렌트
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '1.1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div style={{ background: 'var(--bg-main)', borderRadius: '8px', padding: '0.7rem 0.9rem', fontSize: '0.85rem', lineHeight: 1.7 }}>
            <b>{vehicle.carModel} {vehicle.plateNo}</b> · 지금 {vehicle.status} · 주행 {Number(vehicle.currentMileage || 0).toLocaleString()}km<br />
            차는 새로 등록되지 않고, 손익 원장에도 같은 장부에 재렌트 구간으로 이어집니다.
          </div>

          <div>
            <span style={label}>새 계약자</span>
            {customer ? (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ fontSize: '0.9rem' }}>{formatCustomerName(customer)}</b>
                {(customer.companies || []).length > 0 && (
                  <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={{ ...input, width: 'auto' }}>
                    <option value="">개인 계약</option>
                    {customer.companies.map((x) => x.companyId && <option key={x.companyId._id} value={x.companyId._id}>법인 · {x.companyId.name}</option>)}
                  </select>
                )}
                <button type="button" onClick={() => { setCustomer(null); setCompanyId(''); }} style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}>다시 고르기</button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: '0.6rem', top: '0.7rem', color: 'var(--text-muted)' }} />
                <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="고객 이름 · 사업자번호로 찾기 (없으면 고객 DB에서 먼저 등록)" style={{ ...input, paddingLeft: '1.8rem' }} />
                {results.length > 0 && (
                  <div style={{ position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', boxShadow: '0 8px 20px rgba(0,0,0,0.12)', maxHeight: '220px', overflowY: 'auto' }}>
                    {results.map((c) => (
                      <button key={c._id} type="button" onClick={() => pickCustomer(c)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 0.7rem', border: 'none', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}>
                        {formatCustomerName(c)} <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{c.customerId} {c.bizNo || ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem' }}>
            <div><span style={label}>차량 평가액 (중고차 사업부)</span><MoneyInput value={form.appraisalValue} onChange={(e) => set({ appraisalValue: e.target.value })} style={input} /></div>
            <div><span style={label}>계약일 (인도일)</span><input type="date" max="9999-12-31" value={form.contractDate} onChange={(e) => set({ contractDate: e.target.value })} style={input} /></div>
            <div><span style={label}>기간 (개월)</span><input type="number" min="1" value={form.termMonths} onChange={(e) => set({ termMonths: e.target.value })} style={input} /></div>
            <div><span style={label}>월 렌트료</span><MoneyInput value={form.monthlyFee} onChange={(e) => set({ monthlyFee: e.target.value })} style={input} /></div>
            <div><span style={label}>보증금 (새로 받음)</span><MoneyInput value={form.deposit} onChange={(e) => set({ deposit: e.target.value })} style={input} placeholder="0" /></div>
            <div><span style={label}>선납금</span><MoneyInput value={form.advancePayment} onChange={(e) => set({ advancePayment: e.target.value })} style={input} placeholder="0" /></div>
            <div><span style={label}>인수가</span><MoneyInput value={form.takeoverPrice} onChange={(e) => set({ takeoverPrice: e.target.value })} style={input} placeholder="0" /></div>
            <div>
              <span style={label}>월 결제일</span>
              <select value={form.monthlyPaymentDay} onChange={(e) => set({ monthlyPaymentDay: e.target.value })} style={input}>
                {PAYMENT_DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            계약번호는 새 계약자 기준으로 새로 매기고, 1회차는 계약일 이후 처음 오는 결제일입니다.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{ padding: '0.55rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>취소</button>
            <button type="button" onClick={submit} disabled={saving} style={{ padding: '0.55rem 1.1rem', borderRadius: '6px', border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
              {saving ? '등록하는 중...' : '재렌트 계약 등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VehicleRerentDialog;
