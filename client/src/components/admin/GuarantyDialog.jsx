import { useEffect, useState } from 'react';
import { Download, Mail, X } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * 연대보증서(대표님 2026-11-27).
 *
 * 장기렌트 계약서는 모두싸인으로 법인만 서명하고, 대표 개인 보증은 종이 한 장으로 받는다
 * (보증은 전자서명이면 효력이 없다, 민법 제428조의2 · 보증 최고액을 꼭 적는다, 제428조의3).
 * 모양은 서버가 계약서와 같은 글꼴·색으로 그린다(server/utils/guarantyPage.js). 계약서 PDF에는 붙이지 않는다.
 * 여기서는 보증인·최고액을 고쳐 미리 보고, 그 한 장을 메일로 보내거나 PDF로 받는다(대표님 2026-11-27).
 * 메일은 [메일 보내기]를 두 번(확인) 눌렀을 때만 나간다. 자동 발송은 없다.
 */

const toNum = (s) => Number(String(s ?? '').replace(/[^0-9]/g, '')) || 0;
const comma = (n) => (n ? Math.round(n).toLocaleString('ko-KR') : '');
/** 기본 최고액: 월 렌트료 × 계약 개월 수, 만 원 단위 올림 (서버 defaultGuarantyMax와 같다) */
const defaultMax = (values) => {
  const total = toNum(values?.monthlyFee) * toNum(values?.termMonths);
  return total ? Math.ceil(total / 10000) * 10000 : 0;
};

/**
 * @param {{ doc: object, values: object, locked: boolean, onChange: (key: string, v: string) => void, onClose: () => void, showToast?: Function }} props
 *   고친 보증인·최고액은 계약서 칸 guarantorName·guarantyMax로 남는다(계약서 [저장]으로 저장).
 */
export default function GuarantyDialog({ doc, values, locked, onChange, onClose, showToast }) {
  const guarantor = values.guarantorName ?? values.ceoName ?? '';
  const auto = defaultMax({ ...values, termMonths: values.termMonths || doc?.contract?.termMonths });
  const max = toNum(values.guarantyMax) || auto;
  const [pdf, setPdf] = useState({ url: '', loading: true, error: '' });
  const [mail, setMail] = useState({ to: '', cc: '', subject: '', body: '' });
  const [last, setLast] = useState(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // 받는 사람·제목·본문 기본값(계약서 이메일 칸)과 지난 발송
  useEffect(() => {
    fetch(`${API_HOST}/api/contract-documents/${doc._id}/guaranty-mail`).then((r) => r.json()).then((d) => {
      if (!d.success) return;
      setMail((m) => ({ to: m.to || d.draft.to, cc: m.cc, subject: m.subject || d.draft.subject, body: m.body || d.draft.body }));
      setLast(d.last);
    }).catch(() => {});
  }, [doc._id]);

  const query = `guarantorName=${encodeURIComponent(guarantor)}&guarantyMax=${max}`;
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setPdf((p) => ({ ...p, loading: true, error: '' }));
      try {
        const res = await fetch(`${API_HOST}/api/contract-documents/${doc._id}/guaranty-pdf?${query}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || '연대보증서를 만들지 못했습니다.');
        const made = URL.createObjectURL(await res.blob());
        if (alive) setPdf((p) => { if (p.url) URL.revokeObjectURL(p.url); return { url: made, loading: false, error: '' }; });
        else URL.revokeObjectURL(made);
      } catch (e) {
        if (alive) setPdf((p) => ({ ...p, loading: false, error: e.message }));
      }
    }, 400); // 금액을 치는 동안은 기다렸다가 한 번만 만든다
    return () => { alive = false; clearTimeout(t); };
  }, [doc._id, query]);

  const download = () => {
    if (!pdf.url) return;
    const a = document.createElement('a');
    a.href = pdf.url;
    a.download = `연대보증서_${values.partyName || ''}_${values.contractNo || doc?.contract?.contractNo || ''}.pdf`;
    a.click();
    showToast?.('연대보증서를 받았습니다. 메일로 보내고 원본을 회수해 주세요.', 'success');
  };

  const send = async () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    setSending(true);
    try {
      const res = await fetch(`${API_HOST}/api/contract-documents/${doc._id}/guaranty-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...mail, guarantorName: guarantor, guarantyMax: max })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || '메일을 보내지 못했습니다.');
      setLast({ to: data.to, cc: mail.cc, sentAt: data.sentAt });
      showToast?.(`연대보증서를 ${data.to}로 보냈습니다. 원본 회수를 챙겨 주세요.`, 'success');
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const field = { width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, overflow: 'auto', padding: '1.5rem 1rem', display: 'flex', gap: '1rem', justifyContent: 'center', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ width: 320, maxWidth: '100%', background: '#fff', borderRadius: 10, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', fontSize: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <b style={{ fontSize: '1rem' }}>연대보증서</b>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <label>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>연대보증인 (법인 대표자 개인)</div>
          <input value={guarantor} disabled={locked} onChange={(e) => onChange('guarantorName', e.target.value)} style={field} />
        </label>
        <label>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>보증 최고액 (원)</div>
          <input value={comma(max)} disabled={locked} onChange={(e) => onChange('guarantyMax', String(toNum(e.target.value) || ''))} style={field} />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
            기본값: 월 렌트료 × 계약 개월 수 = {comma(auto) || '-'}원(만 원 단위 올림). 이 금액이 없으면 보증이 무효라 꼭 적습니다.
          </div>
        </label>
        <button type="button" disabled={!pdf.url} onClick={download} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.6rem', borderRadius: 8, border: 'none', background: '#0f172a', color: '#fff', fontWeight: 800, cursor: pdf.url ? 'pointer' : 'wait' }}>
          <Download size={15} /> PDF 받기
        </button>
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <b>메일로 보내기</b>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>받는 사람</div>
            <input value={mail.to} onChange={(e) => { setConfirming(false); setMail({ ...mail, to: e.target.value }); }} placeholder="고객 이메일" style={field} />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>참조 (선택)</div>
            <input value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} style={field} />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>제목</div>
            <input value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} style={field} />
          </label>
          <label>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>본문 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(아래에 회사 서명이 붙습니다)</span></div>
            <textarea value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} rows={9} style={{ ...field, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }} />
          </label>
          <button type="button" disabled={sending || !pdf.url || !mail.to.trim()} onClick={send}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.6rem', borderRadius: 8, border: 'none', background: confirming ? '#b91c1c' : '#7c2d12', color: '#fff', fontWeight: 800, cursor: sending ? 'wait' : 'pointer', opacity: sending || !mail.to.trim() ? 0.6 : 1 }}>
            <Mail size={15} /> {sending ? '보내는 중...' : confirming ? `${mail.to.trim()}로 보낼까요? 한 번 더 누르면 보냅니다` : '메일 보내기'}
          </button>
          {confirming && <button type="button" onClick={() => setConfirming(false)} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem' }}>취소</button>}
          {last?.sentAt && (
            <div style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 700 }}>
              지난 발송: {new Date(last.sentAt).toLocaleString('ko-KR')} → {last.to}{last.cc ? ` (참조 ${last.cc})` : ''}
            </div>
          )}
        </div>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.65, background: '#f8fafc', borderRadius: 8, padding: '0.6rem' }}>
          <b>계약서 PDF에는 들어가지 않습니다.</b> 계약서는 모두싸인으로, 연대보증서는 여기서 따로 메일로 보냅니다.<br />
          <b>받는 방법</b><br />
          1. 위 [메일 보내기]로 고객에게 보냅니다(보증인·최고액이 들어간 이 장이 첨부됩니다).<br />
          2. 대표가 <b>자필 서명·최고액 자필 기재</b>, <b>개인 인감</b> 날인<br />
          3. <b>인감증명서</b>(또는 본인서명사실확인서)와 함께 <b>원본</b>을 등기·퀵으로 회수<br />
          4. 인감 대조, 대표에게 문자로 본인 날인 확인 후 계약서 폴더에 보관<br />
          고친 보증인·최고액은 계약서 [저장]을 눌러야 계약서 PDF에도 남습니다.
        </div>
      </div>
      <div style={{ width: 'min(760px, 100%)', background: '#fff', borderRadius: 10, padding: '0.5rem', boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}>
        {pdf.error ? (
          <div style={{ padding: '2rem', color: '#b91c1c' }}>{pdf.error}</div>
        ) : pdf.url ? (
          <iframe title="연대보증서" src={pdf.url} style={{ width: '100%', height: 'calc(100vh - 5rem)', border: 'none' }} />
        ) : (
          <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>연대보증서 만드는 중...</div>
        )}
      </div>
    </div>
  );
}
