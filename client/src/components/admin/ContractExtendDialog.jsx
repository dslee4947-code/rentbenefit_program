import { useEffect, useState } from 'react';
import { X, CalendarPlus } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ymd = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const won = (n) => `${Number(n || 0).toLocaleString()}원`;

/**
 * 계약 연장 창.
 *
 * 같은 차량에 새 계약(기존 번호 -1, -2)을 이어 붙인다. 이전 계약은 '종료(연장)'로 닫히고 기록은 남는다.
 * 보증금은 계약자가 같으므로 그대로 승계한다(대표님 결정 2026-10-05).
 * 한 계약에 묶인 차는 함께 연장하고, 월 렌트료·인수가는 차마다 넣는다.
 *
 * @param {object} props
 * @param {string} props.contractId 연장할 계약
 * @param {() => void} props.onClose
 * @param {(contract: object) => void} [props.onDone] 연장이 끝난 뒤
 * @param {Function} props.showToast
 */
function ContractExtendDialog({ contractId, onClose, onDone, showToast }) {
  const [preview, setPreview] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [termMonths, setTermMonths] = useState(12);
  const [rows, setRows] = useState([]);
  const [advancePayment, setAdvancePayment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_HOST}/api/contracts/${contractId}/extension-preview`);
        const data = await res.json();
        if (!data.success) {
          showToast?.(data.message || '연장 정보를 불러오지 못했습니다.', 'error');
          onClose();
          return;
        }
        setPreview(data);
        setStartDate(ymd(data.startDate));
        // 지금 조건을 그대로 채워 둔다. 대부분은 렌트료만 고친다.
        setRows(data.vehicles.map((v) => ({ vehicleId: v._id, label: `${v.carModel || ''} ${v.plateNo || ''}`.trim(), monthlyFee: v.monthlyFee || '', takeoverPrice: v.takeoverPrice || '', before: v.monthlyFee || 0 })));
      } catch {
        showToast?.('서버 통신 오류가 발생했습니다.', 'error');
        onClose();
      }
    })();
    // 계약이 바뀔 때만 불러온다. 부모가 다시 그려질 때마다 불러오면 입력하던 값이 지워진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  const endPreview = (() => {
    if (!startDate || !termMonths) return '';
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + Number(termMonths));
    d.setDate(d.getDate() - 1);
    return ymd(d);
  })();

  const submit = async () => {
    if (!termMonths || Number(termMonths) < 1) { showToast?.('연장 기간(개월)을 입력해 주세요.', 'error'); return; }
    if (rows.some((r) => !Number(r.monthlyFee))) { showToast?.('차량마다 연장 월 렌트료를 입력해 주세요.', 'error'); return; }
    if (!window.confirm(`${preview.previous.contractNo} 계약을 ${preview.contractNo}로 연장합니다.\n이전 계약은 종료(연장)로 닫히고, 보증금 ${won(preview.previous.deposit)}은 승계됩니다.\n진행할까요?`)) return;
    try {
      setSaving(true);
      const res = await fetch(`${API_HOST}/api/contracts/${contractId}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          termMonths: Number(termMonths),
          advancePayment: Number(advancePayment) || 0,
          vehicles: rows.map((r) => ({ vehicleId: r.vehicleId, monthlyFee: Number(r.monthlyFee), takeoverPrice: Number(r.takeoverPrice) || 0 }))
        })
      });
      const data = await res.json();
      if (!data.success) {
        showToast?.(data.message || '연장하지 못했습니다.', 'error');
        return;
      }
      showToast?.(data.message, 'success');
      onDone?.(data.contract);
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
            <CalendarPlus size={18} style={{ color: 'var(--primary)' }} /> 계약 연장
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        {!preview ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중...</div>
        ) : (
          <div style={{ padding: '1.1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ background: 'var(--bg-main)', borderRadius: '8px', padding: '0.8rem 0.9rem', fontSize: '0.85rem', lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700 }}>{preview.partyName}</div>
              {/* 저장된 endDate는 기간 다음 날이라 하루 빼서 마지막 날로 보여 준다 */}
              <div>지금 계약 <b>{preview.previous.contractNo}</b> · {ymd(preview.previous.contractDate)} 부터 {preview.previous.termMonths}개월 · 만기 {preview.previous.endDate ? ymd(new Date(new Date(preview.previous.endDate).getTime() - 86400000)) : '-'}</div>
              <div>연장 계약번호 <b style={{ color: 'var(--primary)' }}>{preview.contractNo}</b> · 보증금 {won(preview.previous.deposit)} <b>승계</b> (계약자가 같아 돌려주지 않고 넘깁니다)</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem' }}>
              <div>
                <span style={label}>연장 시작일</span>
                <input type="date" max="9999-12-31" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={input} />
              </div>
              <div>
                <span style={label}>연장 기간 (개월)</span>
                <input type="number" min="1" value={termMonths} onChange={(e) => setTermMonths(e.target.value)} style={input} />
              </div>
              <div>
                <span style={label}>새로 받는 선납금 (있으면)</span>
                <MoneyInput value={advancePayment} onChange={(e) => setAdvancePayment(e.target.value)} style={input} placeholder="0" />
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '-0.4rem' }}>
              연장 기간: {startDate || '-'} ~ {endPreview || '-'} · 1회차는 시작일 이후 처음 오는 결제일입니다.
              {preview.previous.endDate && startDate && startDate < ymd(preview.previous.endDate) && ' 만기 전 연장이라, 지금 계약의 남은 미청구 회차는 새 계약이 대신합니다.'}
            </div>

            <div>
              <span style={label}>차량별 연장 조건</span>
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                {rows.map((r, i) => (
                  <div key={r.vehicleId} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) 1fr 1fr', gap: '0.5rem', alignItems: 'center', padding: '0.6rem 0.7rem', borderTop: i ? '1px solid var(--border-color)' : 'none' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      {r.label}
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>지금 월 {won(r.before)}</div>
                    </div>
                    <MoneyInput value={r.monthlyFee} placeholder="월 렌트료" style={input}
                      onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, monthlyFee: e.target.value } : x)))} />
                    <MoneyInput value={r.takeoverPrice} placeholder="인수가" style={input}
                      onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, takeoverPrice: e.target.value } : x)))} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                월 렌트료 · 인수가 순서입니다. 차는 새로 등록되지 않고, 손익 원장에도 같은 장부에 연장 구간으로 이어집니다.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" onClick={onClose} style={{ padding: '0.55rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>취소</button>
              <button type="button" onClick={submit} disabled={saving} style={{ padding: '0.55rem 1.1rem', borderRadius: '6px', border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                {saving ? '연장하는 중...' : `${preview.contractNo}로 연장`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ContractExtendDialog;
