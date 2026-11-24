import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import InvoiceSheet from './InvoiceSheet.jsx';
import MoneyInput from './MoneyInput.jsx';
import { removeExtra } from './billingForm.js';

const SHEET_WIDTH = 780; // InvoiceSheet 고정 폭
const FIELDS = [
  ['prevUnpaid', '전월 미결제금액'],
  ['prevOverpaid', '전월 초과 입금액'],
  ['monthlyRent', '당월 결제금액 (월 렌트료)'],
  ['maintenance', '정기점검'],
  ['fine', '범칙금 / 과태료'],
  ['interest', '연체 이자']
];

/**
 * 청구서 보면서 고치기(대표님 2026-11-24). 왼쪽에서 고치면 오른쪽 청구서에 바로 보이고, [저장]을 눌러야 남는다.
 * 저장은 청구서 화면과 같은 길(MonthlyBillingView handleSaveRound)을 쓴다.
 */
export default function InvoiceEditDialog({ form, setForm, totals, item, vehicles, attachments, saving, onSave, onClose }) {
  const boxRef = useRef(null);
  const [zoom, setZoom] = useState(0.8);
  // 청구서는 폭이 고정이라 오른쪽 칸 폭에 맞춰 줄여 보여 준다
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setZoom(Math.min(1, Math.max(0.35, (el.clientWidth - 32) / SHEET_WIDTH))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const set = (patch) => setForm((cur) => ({ ...cur, ...patch }));
  const setExtra = (i, patch) => set({ extras: form.extras.map((x, xi) => (xi === i ? { ...x, ...patch } : x)) });
  const label = { fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-bright)', marginBottom: '0.25rem', display: 'block' };
  const input = { width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem', fontFamily: 'inherit' };
  // 서류에 금액을 적어 둔 항목은 서류 합계가 청구액이라 손으로 고치지 않는다(서버 recalcRound와 같은 규칙)
  const docTotals = {
    ...(totals.hasDocFine ? { fine: totals.fineTotal } : {}),
    ...(totals.hasDocMaintenance ? { maintenance: totals.maintenanceTotal } : {})
  };
  const originalYmd = form.dueDateOriginal ? String(form.dueDateOriginal).slice(0, 10) : '';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
      <div style={{ background: '#fff', borderRadius: '12px', width: 'min(1280px, 100%)', height: '95vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
          <strong style={{ fontSize: '0.95rem' }}>{item.company?.name || item.customer?.name || ''} · {form.no}회차 청구서 고치기</strong>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div style={{ flex: '1 1 300px', maxHeight: '100%', overflow: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', boxSizing: 'border-box' }}>
            <div>
              <label style={label}>출금일 (이 회차만)</label>
              <input type="date" value={form.dueDate} onChange={(e) => { if (e.target.value) set({ dueDate: e.target.value }); }} style={input} />
              {originalYmd && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  원래 출금일 {originalYmd}
                  <button type="button" onClick={() => set({ dueDate: originalYmd })} style={{ marginLeft: '0.4rem', border: 'none', background: 'none', color: 'var(--primary)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}>되돌리기</button>
                </div>
              )}
            </div>

            <div>
              <label style={label}>비고 · 특이사항 (청구서와 메일에 나갑니다)</label>
              <textarea rows={4} value={form.invoiceNote} onChange={(e) => set({ invoiceNote: e.target.value })} placeholder="예: 차량 출고 일정에 따라 1회차에 한해 출금일을 변경합니다. 2회차부터는 매월 25일에 출금됩니다." style={{ ...input, resize: 'vertical', lineHeight: 1.6 }} />
            </div>

            {FIELDS.map(([key, name]) => {
              const locked = key in docTotals;
              return (
                <div key={key}>
                  <label style={label}>{name}{locked && <span style={{ marginLeft: '0.4rem', color: 'var(--primary)' }}>서류 합계 자동</span>}</label>
                  <MoneyInput value={locked ? docTotals[key] : form[key]} disabled={locked} onChange={(e) => set({ [key]: e.target.value })} style={{ ...input, ...(locked ? { background: 'var(--bg-main)', color: 'var(--text-muted)' } : {}) }} />
                </div>
              );
            })}

            <div>
              <label style={label}>기타 청구 (항목 이름이 청구서에 찍힙니다)</label>
              {(form.extras || []).map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.35rem' }}>
                  <input value={e.label} onChange={(ev) => setExtra(i, { label: ev.target.value })} placeholder="항목명" style={{ ...input, flex: 1, minWidth: 0 }} />
                  <MoneyInput value={e.amount} onChange={(ev) => setExtra(i, { amount: ev.target.value })} style={{ ...input, width: '110px' }} />
                  <button type="button" onClick={() => setForm((cur) => removeExtra(cur, i))} aria-label="항목 지우기" style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" onClick={() => set({ extras: [...(form.extras || []), { label: '', amount: 0 }] })} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'none', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer' }}>
                <Plus size={13} /> 항목 추가
              </button>
            </div>
          </div>

          <div ref={boxRef} style={{ flex: '2.4 1 420px', minWidth: 0, maxHeight: '100%', overflow: 'auto', background: '#f1f5f9', padding: '1rem', boxSizing: 'border-box' }}>
            <div style={{ zoom, width: 'fit-content', margin: '0 auto', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
              <InvoiceSheet
                item={item}
                round={{ ...form, fine: totals.fineTotal, maintenance: totals.maintenanceTotal, other: totals.otherTotal, attachments }}
                vehicles={vehicles}
                total={totals.total}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1rem', borderTop: '1px solid var(--border-color)' }}>
          <strong style={{ fontSize: '0.9rem' }}>청구액 {Number(totals.total || 0).toLocaleString()}원</strong>
          {form.issuedAt && <span style={{ fontSize: '0.76rem', color: '#b45309', fontWeight: 700 }}>발행한 청구서입니다. 저장하면 정정본을 다시 보내야 합니다.</span>}
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', background: '#fff', border: '1px solid var(--border-color)', padding: '0.55rem 1.1rem', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}>취소</button>
          <button type="button" onClick={onSave} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.55rem 1.3rem', borderRadius: '6px', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer' }}>
            <Save size={14} /> {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
