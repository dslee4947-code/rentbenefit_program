import { useEffect, useState } from 'react';
import { Mail, Send, X } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

/**
 * 청구 메일 보내기 전 확인 창(대표님 2026-11-24).
 *
 * 저장된 메일 양식·비고·선납금 안내로 만든 제목과 본문을 보여 주고, 그 자리에서 고쳐 보낸다.
 * 여기서 고친 글은 이번 메일에만 쓰인다. 양식 자체는 [메일 양식]에서 고친다.
 *
 * @param {object} props
 * @param {object} [props.values] 화면에서 고치는 중인 값(total, monthlyRent, dueDate, invoiceNote)
 * @param {{subject: string, body: string}} [props.initial] 이미 고쳐 둔 글. 있으면 다시 만들지 않는다
 * @param {boolean} [props.lockTo] 받는 주소를 못 고치게(이미 승인한 주소)
 * @param {(m: {to: string, subject: string, body: string}) => void} props.onConfirm
 */
export default function InvoiceMailDialog({ title, scheduleId, roundNo, values, initial, to: initialTo, lockTo, docs, currentUser, confirmLabel, onConfirm, onClose }) {
  const [to, setTo] = useState(initialTo || '');
  const [subject, setSubject] = useState(initial?.subject || '');
  const [body, setBody] = useState(initial?.body || '');
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 창을 연 때의 값으로 한 번만 만든다. 뒤에서 화면이 다시 그려져도 고치던 글을 덮지 않는다.
  const [request] = useState(() => ({ scheduleId, roundNo, body: JSON.stringify(values || {}), role: currentUser?.role || 'viewer', keep: Boolean(initial) }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetch(`${API_HOST}/api/billing-schedules/${request.scheduleId}/rounds/${request.roundNo}/mail-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Role': request.role },
          body: request.body
        }).then((r) => r.json());
        if (!alive) return;
        if (!data.success) { setError(data.message || '메일 내용을 불러오지 못했습니다.'); return; }
        if (!request.keep) { setSubject(data.subject); setBody(data.body); }
        setSignature(data.signature || '');
      } catch {
        if (alive) setError('서버 통신 오류가 발생했습니다.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [request]);

  const ours = to.trim().toLowerCase().endsWith('@sdibenefit.com');
  const ready = !loading && isEmail(to) && subject.trim() && body.trim();
  const label = { fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-bright)', marginBottom: '0.25rem', display: 'block' };
  const input = { width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem', fontFamily: 'inherit' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '680px', maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.9rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
          <Mail size={16} style={{ color: 'var(--primary)' }} />
          <strong style={{ fontSize: '0.95rem' }}>{title}</strong>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div>
            <label style={label}>받는 사람</label>
            <input value={to} disabled={lockTo} onChange={(e) => setTo(e.target.value)} style={{ ...input, ...(lockTo ? { background: 'var(--bg-main)' } : {}) }} placeholder="billing@example.com" />
            {isEmail(to) && (
              <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', fontWeight: 700, color: ours ? 'var(--text-muted)' : '#b45309' }}>
                {ours ? '회사 계정입니다. 시험 발송으로 보입니다.' : '고객 주소입니다. 보내면 실제로 발송됩니다.'}
              </div>
            )}
          </div>
          <div>
            <label style={label}>제목</label>
            <input value={subject} disabled={loading} onChange={(e) => setSubject(e.target.value)} style={input} />
          </div>
          <div>
            <label style={label}>내용 (고치면 이번 메일에만 적용됩니다)</label>
            <textarea value={loading ? '메일 내용을 불러오는 중…' : body} disabled={loading} onChange={(e) => setBody(e.target.value)} rows={14} style={{ ...input, resize: 'vertical', lineHeight: 1.6 }} />
          </div>
          {signature && (
            <div>
              <div style={label}>아래에 붙는 서명</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', background: 'var(--bg-main)', borderRadius: '6px', padding: '0.5rem 0.65rem' }}>{signature}</div>
            </div>
          )}
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>붙는 파일: 청구서 PDF{docs ? `, ${docs}` : ' (등록한 서류가 있으면 함께)'}</div>
          {error && <div style={{ fontSize: '0.8rem', color: 'var(--error)', fontWeight: 700 }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '0.8rem 1rem', borderTop: '1px solid var(--border-color)' }}>
          <button type="button" onClick={onClose} style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.55rem 1.1rem', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}>취소</button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => onConfirm({ to: to.trim(), subject: subject.trim(), body })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#2563eb', color: '#fff', border: 'none', padding: '0.55rem 1.2rem', borderRadius: '6px', fontWeight: 800, cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.6 }}
          >
            <Send size={14} /> {confirmLabel || '보내기'}
          </button>
        </div>
      </div>
    </div>
  );
}
