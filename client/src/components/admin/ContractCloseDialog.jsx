import { useEffect, useState } from 'react';
import { X, Undo2, KeyRound } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ymd = (d) => {
  const x = d ? new Date(d) : new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const won = (n) => `${Number(n || 0).toLocaleString()}원`;

/**
 * 반납 · 인수 창. 계약을 끝내는 두 가지 길이다(연장은 따로 ContractExtendDialog).
 *
 * 반납: 차가 돌아온다. 보증금 반환·손상 수리비·초과 주행을 정산하고 차를 재고로 돌린다.
 *       다음 고객이 정해질 때까지 단기렌트·사고대차로 쓰면 '단기렌트'를 고른다(같은 원장에 구간으로 남는다).
 * 인수: 고객이 차를 산다. 받은 인수가를 넣으면 차량은 거래완료가 된다.
 *
 * @param {object} props
 * @param {string} props.contractId
 * @param {() => void} props.onClose
 * @param {() => void} [props.onDone]
 * @param {Function} props.showToast
 */
function ContractCloseDialog({ contractId, onClose, onDone, showToast }) {
  const [info, setInfo] = useState(null);
  const [mode, setMode] = useState('반납');
  const [form, setForm] = useState({
    returnDate: ymd(), mileage: '', depositRefund: '', damageCharge: '', excessMileageCharge: '', nextUse: '재고', note: '',
    takeoverDate: ymd(), takeoverAmount: ''
  });
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    (async () => {
      try {
        // 연장 창과 같은 미리보기(계약·보증금·인수가·차량)를 쓴다
        const res = await fetch(`${API_HOST}/api/contracts/${contractId}/extension-preview`);
        const data = await res.json();
        if (!data.success) {
          showToast?.(data.message || '계약 정보를 불러오지 못했습니다.', 'error');
          onClose();
          return;
        }
        setInfo(data);
        set({ depositRefund: data.previous.deposit || '', takeoverAmount: data.previous.takeoverPrice || '' });
      } catch {
        showToast?.('서버 통신 오류가 발생했습니다.', 'error');
        onClose();
      }
    })();
    // 계약이 바뀔 때만 불러온다(부모가 다시 그려질 때마다 불러오면 입력이 지워진다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  const submit = async () => {
    const isReturn = mode === '반납';
    const message = isReturn
      ? `${info.previous.contractNo} 계약을 ${form.returnDate}에 반납 처리합니다.\n보증금 반환 ${won(form.depositRefund)}\n차량은 '${form.nextUse}'로 바뀝니다. 진행할까요?`
      : `${info.previous.contractNo} 계약을 인수 처리합니다.\n인수가 ${won(form.takeoverAmount)}, 차량은 거래완료가 됩니다. 진행할까요?`;
    if (!window.confirm(message)) return;
    try {
      setSaving(true);
      const res = await fetch(`${API_HOST}/api/contracts/${contractId}/${isReturn ? 'return' : 'takeover'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isReturn
          ? {
            returnDate: form.returnDate, mileage: form.mileage, depositRefund: form.depositRefund,
            damageCharge: form.damageCharge, excessMileageCharge: form.excessMileageCharge, nextUse: form.nextUse, note: form.note
          }
          : { takeoverDate: form.takeoverDate, takeoverAmount: form.takeoverAmount, note: form.note })
      });
      const data = await res.json();
      if (!data.success) {
        showToast?.(data.message || '처리하지 못했습니다.', 'error');
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
  const tab = (active) => ({
    flex: 1, padding: '0.6rem', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
    background: active ? 'var(--primary-glow, #eef2ff)' : '#fff',
    color: active ? 'var(--primary)' : 'var(--text-muted)',
    borderBottom: active ? '3px solid var(--primary)' : '3px solid transparent'
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 1rem', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: '12px', width: 'min(600px, 100%)', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.2rem' }}>
          <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>계약 끝내기 — 반납 · 인수</div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
          <button type="button" style={tab(mode === '반납')} onClick={() => setMode('반납')}><Undo2 size={15} /> 반납 (차가 돌아옴)</button>
          <button type="button" style={tab(mode === '인수')} onClick={() => setMode('인수')}><KeyRound size={15} /> 인수 (고객이 삼)</button>
        </div>

        {!info ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중...</div>
        ) : (
          <div style={{ padding: '1.1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div style={{ background: 'var(--bg-main)', borderRadius: '8px', padding: '0.7rem 0.9rem', fontSize: '0.85rem', lineHeight: 1.7 }}>
              <b>{info.partyName}</b> · {info.previous.contractNo} · {info.vehicles.map((v) => `${v.carModel || ''} ${v.plateNo || ''}`.trim()).join(', ')}<br />
              보증금 {won(info.previous.deposit)} · 계약상 인수가 {won(info.previous.takeoverPrice)}
            </div>

            {mode === '반납' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem' }}>
                  <div><span style={label}>반납일</span><input type="date" max="9999-12-31" value={form.returnDate} onChange={(e) => set({ returnDate: e.target.value })} style={input} /></div>
                  <div><span style={label}>반납 때 주행거리 (km)</span><MoneyInput value={form.mileage} onChange={(e) => set({ mileage: e.target.value })} style={input} placeholder="예: 85,000" /></div>
                  <div><span style={label}>돌려줄 보증금</span><MoneyInput value={form.depositRefund} onChange={(e) => set({ depositRefund: e.target.value })} style={input} /></div>
                  <div><span style={label}>손상 수리비 (고객 부담)</span><MoneyInput value={form.damageCharge} onChange={(e) => set({ damageCharge: e.target.value })} style={input} placeholder="0" /></div>
                  <div><span style={label}>초과 주행 정산</span><MoneyInput value={form.excessMileageCharge} onChange={(e) => set({ excessMileageCharge: e.target.value })} style={input} placeholder="0" /></div>
                </div>
                <div>
                  <span style={label}>반납한 차는</span>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.88rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                      <input type="radio" checked={form.nextUse === '재고'} onChange={() => set({ nextUse: '재고' })} /> 재고 — 다음 고객(재렌트)을 기다림
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                      <input type="radio" checked={form.nextUse === '단기렌트'} onChange={() => set({ nextUse: '단기렌트' })} /> 단기렌트·사고대차로 운용
                    </label>
                  </div>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  보증금 반환·수리비·초과 주행은 손익 원장에 줄로 들어갑니다. 반납일 뒤의 미청구 회차는 정리됩니다.
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div><span style={label}>인수일</span><input type="date" max="9999-12-31" value={form.takeoverDate} onChange={(e) => set({ takeoverDate: e.target.value })} style={input} /></div>
                  <div><span style={label}>실제 받은 인수가</span><MoneyInput value={form.takeoverAmount} onChange={(e) => set({ takeoverAmount: e.target.value })} style={input} /></div>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  인수가는 손익 원장에 입금으로 들어가고, 차량은 거래완료가 됩니다. 인수일 뒤의 미청구 회차는 정리됩니다.
                </div>
              </>
            )}

            <div><span style={label}>메모</span><input value={form.note} onChange={(e) => set({ note: e.target.value })} style={input} placeholder="(선택)" /></div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" onClick={onClose} style={{ padding: '0.55rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>취소</button>
              <button type="button" onClick={submit} disabled={saving} style={{ padding: '0.55rem 1.1rem', borderRadius: '6px', border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                {saving ? '처리하는 중...' : `${mode} 처리`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ContractCloseDialog;
