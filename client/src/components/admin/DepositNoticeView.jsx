import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Send, Eye, X, Download } from 'lucide-react';
import DepositNoticeSheet from './DepositNoticeSheet.jsx';
import { makeFittedPdf } from '../../utils/printFit.js';
import { num } from '../../utils/endDocStyle.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 서류는 A4 크기(794×1120px)로 그려 두었으므로 여백 없이 뜬다. 메일에 붙이는 파일이라 jpeg로 뜬다
const makeSheetPdf = (element) => makeFittedPdf(element, { orientation: 'portrait', marginMm: 0, imageType: 'jpeg' });
// 숨겨 둔 양식이 이미지까지 자리 잡을 때까지 잠깐 기다린다
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const kstDate = (d) => (d ? new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : '-');

/**
 * 보증금·선수금 안내 (계약·출고).
 *
 * 보증금이나 선수금이 있는 진행 중 계약이 목록에 뜬다. 줄의 [메일 보내기]를 누르면 안내문 PDF를 만들어
 * 고객 청구 메일로 보내고 계약서 폴더에도 저장한다. 담당자가 눌렀을 때만 나간다.
 * 원장에 입금이 다 잡힌 계약은 처음에 숨겨 둔다.
 */
export default function DepositNoticeView({ showToast, currentUser }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showPaid, setShowPaid] = useState(false);
  const [query, setQuery] = useState('');
  const [mailTo, setMailTo] = useState({}); // 줄에서 고친 받는 메일 { 계약 id: 주소 }
  const [sheet, setSheet] = useState(null); // PDF를 뜨려고 그려 둔 계약
  const [preview, setPreview] = useState(null);
  const [busyId, setBusyId] = useState('');
  const sheetRef = useRef(null);
  const canEdit = currentUser?.role !== 'viewer';
  const headers = { 'X-User-Role': currentUser?.role || 'viewer' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch(`${API_HOST}/api/delivery-docs/deposit-notices`, { cache: 'no-store' }).then((r) => r.json());
      if (data.success) setItems(data.items || []);
      else showToast?.(data.message || '목록을 불러오지 못했습니다.', 'error');
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

  const toOf = (it) => mailTo[it.contractId] ?? it.to ?? '';

  const buildPdf = async (it) => {
    setSheet(it);
    await settle();
    if (!sheetRef.current) throw new Error('안내문을 그리지 못했습니다.');
    return makeSheetPdf(sheetRef.current);
  };

  const postMail = (it, blob, force) => {
    const fd = new FormData();
    fd.append('file', blob, 'deposit-notice.pdf');
    fd.append('to', toOf(it).trim());
    fd.append('deposit', it.deposit);
    fd.append('advancePayment', it.advancePayment);
    if (force) fd.append('force', 'true');
    return fetch(`${API_HOST}/api/delivery-docs/${it.contractId}/deposit-notice/send`, { method: 'POST', headers, body: fd }).then((r) => r.json());
  };

  const sendMail = async (it) => {
    const to = toOf(it).trim();
    if (!isEmail(to)) { showToast?.('받는 메일 주소를 확인해 주세요.', 'error'); return; }
    const amount = [it.deposit > 0 && `보증금 ${num(it.deposit)}원`, it.advancePayment > 0 && `선수금 ${num(it.advancePayment)}원`].filter(Boolean).join(', ');
    if (!window.confirm(`${it.partyName}\n${amount}\n\n이 안내문을 ${to}(으)로 보낼까요?`)) return;
    setBusyId(it.contractId);
    try {
      const blob = await buildPdf(it);
      let res = await postMail(it, blob, false);
      if (res.alreadySent && window.confirm(`${res.message}\n그래도 다시 보낼까요?`)) res = await postMail(it, blob, true);
      else if (res.alreadySent) return;
      showToast?.(res.message || (res.success ? '보냈습니다.' : '보내지 못했습니다.'), res.success ? 'success' : 'error');
      if (res.success) load();
    } catch (err) {
      showToast?.(err.message || '보내는 중 오류가 났습니다.', 'error');
    } finally {
      setBusyId('');
      setSheet(null);
    }
  };

  const download = async (it) => {
    setBusyId(it.contractId);
    try {
      const blob = await buildPdf(it);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${it.label}안내문_${it.partyName}_${it.contractNo}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) {
      showToast?.(err.message || 'PDF를 만들지 못했습니다.', 'error');
    } finally {
      setBusyId('');
      setSheet(null);
    }
  };

  const q = query.replace(/\s+/g, '').toLowerCase();
  const shown = items.filter((it) => (showPaid || !it.paid)
    && (!q || `${it.partyName}${it.contractNo}${it.vehicles.map((v) => v.plateNo + v.carModel).join('')}`.replace(/\s+/g, '').toLowerCase().includes(q)));
  const paidCount = items.filter((it) => it.paid).length;

  const btn = (bg, color = '#fff') => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', background: bg, color, border: bg === '#fff' ? '1px solid var(--border-color)' : 'none', borderRadius: '6px', padding: '0.45rem 0.7rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' });
  const input = { width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', boxSizing: 'border-box' };
  const td = { padding: '0.55rem 0.6rem', verticalAlign: 'top' };
  const money = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.2rem', display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="계약자 · 계약번호 · 차량번호" style={{ ...input, width: '280px', maxWidth: '100%' }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />
          원장에 입금이 다 잡힌 계약도 보기 ({paidCount}건)
        </label>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={load} style={btn('#fff', 'var(--text-main)')} disabled={loading}>
          <RefreshCw size={14} /> {loading ? '불러오는 중' : '새로고침'}
        </button>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg-main)', textAlign: 'left' }}>
              {['계약일', '계약자', '차량', '보증금', '선수금', '원장 입금', '받는 메일', '보낸 기록', ''].map((h) => (
                <th key={h} style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>{loading ? '불러오는 중…' : '안내할 계약이 없습니다.'}</td></tr>
            )}
            {shown.map((it) => (
              <tr key={it.contractId} style={{ borderTop: '1px solid var(--border-color)' }}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{kstDate(it.contractDate)}</td>
                <td style={td}><b>{it.partyName}</b><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{it.contractNo}</div></td>
                <td style={td}>{it.vehicles.map((v, i) => <div key={i}>{v.plateNo || '(번호 없음)'} {v.carModel}</div>)}</td>
                <td style={money}>{it.deposit > 0 ? num(it.deposit) : '-'}</td>
                <td style={money}>{it.advancePayment > 0 ? num(it.advancePayment) : '-'}</td>
                <td style={{ ...money, color: it.paid ? '#047857' : '#b45309', fontWeight: 700 }}>
                  {it.paid ? '입금됨' : (it.depositIn + it.advanceIn > 0 ? `${num(it.depositIn + it.advanceIn)} 일부` : '없음')}
                </td>
                <td style={{ ...td, minWidth: '190px' }}>
                  <input type="email" value={toOf(it)} placeholder="청구 메일이 없습니다" onChange={(e) => setMailTo((m) => ({ ...m, [it.contractId]: e.target.value }))} style={input} disabled={!canEdit} />
                </td>
                <td style={{ ...td, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {it.lastSent ? <>{kstDate(it.lastSent.sentAt)}<div>{it.lastSent.sentTo}</div></> : '보낸 적 없음'}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button type="button" onClick={() => setPreview(it)} style={{ ...btn('#fff', 'var(--text-main)'), marginRight: '0.3rem' }}><Eye size={14} /> 보기</button>
                  {canEdit && (
                    <button type="button" onClick={() => sendMail(it)} disabled={Boolean(busyId)} style={btn('var(--primary)')}>
                      <Send size={14} /> {busyId === it.contractId ? '보내는 중…' : '메일 보내기'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'center', padding: '1rem', overflow: 'auto' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: 'min(560px, 100%)', alignSelf: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
              <b style={{ flex: 1 }}>{preview.partyName} {preview.label} 안내문</b>
              <button type="button" onClick={() => download(preview)} disabled={Boolean(busyId)} style={btn('#fff', 'var(--text-main)')}><Download size={14} /> PDF 받기</button>
              <button type="button" onClick={() => setPreview(null)} aria-label="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div style={{ background: '#e5e7eb', padding: '0.8rem', overflow: 'auto', borderRadius: '0 0 12px 12px' }}>
              <div style={{ zoom: 0.62 }}><DepositNoticeSheet item={preview} /></div>
            </div>
          </div>
        </div>
      )}

      {/* PDF를 뜨는 원본. 화면 밖에 실제 크기로 그려 둔다(줄인 미리보기로 뜨면 글자가 흐려진다) */}
      {sheet && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
          <DepositNoticeSheet item={sheet} innerRef={sheetRef} />
        </div>
      )}
    </div>
  );
}
