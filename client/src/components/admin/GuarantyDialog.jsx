import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * 연대보증서(대표님 2026-11-27).
 *
 * 장기렌트 계약서는 모두싸인으로 법인만 서명하고, 대표 개인 보증은 종이 한 장으로 받는다
 * (보증은 전자서명이면 효력이 없다, 민법 제428조의2 · 보증 최고액을 꼭 적는다, 제428조의3).
 * 모양은 서버가 계약서 장과 같게 그린다(server/utils/guarantyPage.js). 법인 계약은 계약서 PDF 맨 뒤 장으로도 붙는다.
 * 여기서는 보증인·최고액을 고쳐 미리 보고, 그 한 장만 PDF로 받는다(따로 메일로 보낼 때).
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
          <Download size={15} /> 이 장만 PDF 받기
        </button>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.65, background: '#f8fafc', borderRadius: 8, padding: '0.6rem' }}>
          <b>법인 계약은 계약서 PDF 맨 뒤 장(13쪽)에 함께 들어갑니다</b>(왼쪽 '공동임차인 칸'이 별첨 연대보증서일 때).<br />
          <b>받는 방법</b><br />
          1. 계약서와 함께, 또는 이 장만 메일로 보냅니다.<br />
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
