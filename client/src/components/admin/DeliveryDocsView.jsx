import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Send, FileText, X, Check, Download, Ban, Undo2, Search, Eye } from 'lucide-react';
import ContractFactSheet from './ContractFactSheet.jsx';
import { makeFittedPdf } from '../../utils/printFit.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const STATUS_STYLE = {
  '준비 안 됨': { color: '#b45309', bg: '#ffedd5' },
  '승인 대기': { color: '#1d4ed8', bg: '#dbeafe' },
  승인: { color: '#047857', bg: '#d1fae5' },
  발송중: { color: '#7c3aed', bg: '#ede9fe' },
  발송완료: { color: '#16a34a', bg: '#dcfce7' },
  실패: { color: '#dc2626', bg: '#fee2e2' },
  변경됨: { color: '#dc2626', bg: '#fee2e2' },
  '보내지 않음': { color: '#64748b', bg: '#f1f5f9' }
};

// 서류는 장마다 A4 크기(794×1120px)로 그려 두었으므로 여백 없이 뜬다
const makeContractFactPdf = (element) => makeFittedPdf(element, { orientation: 'portrait', marginMm: 0, imageType: 'png' });

// 숨겨 둔 양식이 이미지까지 자리 잡을 때까지 잠깐 기다린다
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

/**
 * 인도 서류 발송 — 계약사실 증명원 + 상환스케쥴.
 *
 * 차량을 인도하면(인도일·차량번호가 들어가면) 이 목록에 계약이 올라온다. 담당자가 열어 확인하고 [승인]하면
 * PDF가 계약서 폴더에 저장되고, 인도일 다음 날 아침 9시에 고객 청구 메일로 나간다.
 * 승인한 뒤 계약·차량 값이 바뀌면 보내지 않고 '변경됨'으로 남는다. 다시 열어 승인하면 된다.
 */
export default function DeliveryDocsView({ showToast, currentUser }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [back, setBack] = useState(14); // 인도일을 며칠 전까지 볼지
  const [open, setOpen] = useState(null); // 열어 둔 계약의 서류 값
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  // 고객 검색 (다시 요청한 고객에게 보낼 때)
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  // 보내기 전 확인: 실제로 나갈 PDF를 화면에 띄워 두고, [이대로 보내기]를 눌러야 나간다
  const [review, setReview] = useState(null); // { blob, url, snapshot, to }
  const sheetRef = useRef(null);
  const canEdit = currentUser?.role !== 'viewer';
  const headers = { 'X-User-Role': currentUser?.role || 'viewer' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch(`${API_HOST}/api/delivery-docs/queue?back=${back}`, { cache: 'no-store' }).then((r) => r.json());
      if (data.success) setItems(data.items || []);
      else showToast?.(data.message || '목록을 불러오지 못했습니다.', 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, back]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const fillForm = (d) => setForm({
    to: d.to || '',
    driverRange: d.overrides?.driverRange || '',
    accidentRepair: d.overrides?.accidentRepair || '',
    commission: d.overrides?.commission || '',
    receiptDate: d.overrides?.receiptDate || ''
  });

  const openOne = async (contractId) => {
    const data = await fetch(`${API_HOST}/api/delivery-docs/${contractId}`, { cache: 'no-store' }).then((r) => r.json());
    if (!data.success) { showToast?.(data.message || '불러오지 못했습니다.', 'error'); return; }
    setOpen(data.data);
    fillForm(data.data);
  };

  const saveForm = async () => {
    const res = await fetch(`${API_HOST}/api/delivery-docs/${open.contractId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    }).then((r) => r.json());
    if (!res.success) { showToast?.(res.message || '저장하지 못했습니다.', 'error'); return null; }
    setOpen(res.data);
    fillForm(res.data);
    return res.data;
  };

  const approve = async () => {
    setBusy(true);
    try {
      // 입력한 칸을 먼저 저장해야 서버 지문과 PDF가 같은 값을 본다
      const data = await saveForm();
      if (!data) return;
      if (data.missing.length) { showToast?.(`아직 보낼 수 없습니다: ${data.missing.join(', ')}`, 'error'); return; }
      await settle();
      if (!sheetRef.current) { showToast?.('서류 양식을 그리지 못했습니다.', 'error'); return; }
      const blob = await makeContractFactPdf(sheetRef.current);
      const fd = new FormData();
      fd.append('file', blob, 'contract-fact.pdf');
      fd.append('snapshot', data.snapshot);
      const res = await fetch(`${API_HOST}/api/delivery-docs/${data.contractId}/approve`, { method: 'POST', headers, body: fd }).then((r) => r.json());
      showToast?.(res.message || (res.success ? '승인했습니다.' : '승인하지 못했습니다.'), res.success ? 'success' : 'error');
      if (res.success) { setOpen(null); load(); }
    } catch (err) {
      showToast?.(err.message || '승인 중 오류가 났습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (contractId, skip) => {
    if (skip && !window.confirm('이 계약은 인도 서류를 보내지 않을까요? (예전 계약 등)')) return;
    const res = await fetch(`${API_HOST}/api/delivery-docs/${contractId}/cancel`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ skip })
    }).then((r) => r.json());
    showToast?.(res.message, res.success ? 'success' : 'error');
    if (res.success) { setOpen(null); load(); }
  };

  const sendNow = async (contractId) => {
    if (!window.confirm('발송일을 기다리지 않고 지금 고객에게 보낼까요?')) return;
    const res = await fetch(`${API_HOST}/api/delivery-docs/run`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ contractId })
    }).then((r) => r.json());
    showToast?.(res.message, res.success && !res.failed && !res.held ? 'success' : 'error');
    load();
  };

  // 주소를 그냥 열면 로그인 토큰이 실리지 않아 막힌다. 받아서 연다.
  const openApprovedPdf = async (contractId) => {
    const res = await fetch(`${API_HOST}/api/delivery-docs/${contractId}/file`);
    if (!res.ok) { showToast?.('승인한 PDF를 열지 못했습니다.', 'error'); return; }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const search = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { showToast?.('두 글자 이상 넣어 주세요.', 'error'); return; }
    const data = await fetch(`${API_HOST}/api/delivery-docs/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' }).then((r) => r.json());
    if (!data.success) { showToast?.(data.message || '찾지 못했습니다.', 'error'); return; }
    setFound(data.items || []);
  };

  const closeReview = () => {
    if (review?.url) URL.revokeObjectURL(review.url);
    setReview(null);
  };

  /**
   * 보내기 전 확인. 입력을 저장하고, 나갈 PDF를 그대로 만들어 화면에 띄운다.
   * 확인 창에 뜬 그 파일이 그대로 고객에게 간다.
   */
  const prepareSend = async () => {
    setBusy(true);
    try {
      const data = await saveForm();
      if (!data) return;
      const blocking = data.missing.filter((m) => !m.startsWith('받는 사람'));
      if (blocking.length) { showToast?.(`아직 보낼 수 없습니다: ${blocking.join(', ')}`, 'error'); return; }
      await settle();
      if (!sheetRef.current) { showToast?.('서류 양식을 그리지 못했습니다.', 'error'); return; }
      const blob = await makeContractFactPdf(sheetRef.current);
      closeReview();
      setReview({ blob, url: URL.createObjectURL(blob), snapshot: data.snapshot, to: form.to || data.to });
    } catch (err) {
      showToast?.(err.message || 'PDF를 만들지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendReviewed = async () => {
    if (!review) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', review.blob, 'contract-fact.pdf');
      fd.append('snapshot', review.snapshot);
      fd.append('to', review.to);
      const res = await fetch(`${API_HOST}/api/delivery-docs/${open.contractId}/send-now`, { method: 'POST', headers, body: fd }).then((r) => r.json());
      showToast?.(res.message || (res.success ? '보냈습니다.' : '보내지 못했습니다.'), res.success ? 'success' : 'error');
      if (res.success) { closeReview(); setOpen(null); load(); }
    } catch (err) {
      showToast?.(err.message || '보내는 중 오류가 났습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      await settle();
      const blob = await makeContractFactPdf(sheetRef.current);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `계약사실증명원_상환스케쥴_${open.party.name}_${open.contractNo}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally {
      setBusy(false);
    }
  };

  // 화면 미리보기는 입력 중인 값까지 반영해 보여 준다(저장 전이라도 어떻게 나갈지 보이게)
  const previewData = open ? {
    ...open,
    commission: form.commission,
    receiptDate: form.receiptDate,
    docs: open.docs.map((d) => ({
      ...d,
      accidentRepair: form.accidentRepair,
      insurance: { ...d.insurance, driverRange: form.driverRange }
    }))
  } : null;

  const btn = (bg, color = '#fff') => ({ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: bg, color, border: bg === '#fff' ? '1px solid var(--border-color)' : 'none', borderRadius: '6px', padding: '0.45rem 0.8rem', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' });
  const input = { width: '100%', padding: '0.45rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem 1.2rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '260px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          차량을 인도해 <b>인도일·차량번호</b>가 들어간 계약이 여기 올라옵니다. 열어서 확인하고 <b>승인</b>하면
          <b> 인도일 다음 날 아침 9시</b>에 계약사실 증명원과 상환스케쥴이 고객 청구 메일로 나갑니다.
          승인한 PDF는 계약자 폴더 01.계약서에 저장됩니다.
        </div>
        <select value={back} onChange={(e) => setBack(Number(e.target.value))} style={{ padding: '0.45rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem' }}>
          {[14, 30, 60, 120].map((n) => <option key={n} value={n}>인도일 최근 {n}일</option>)}
        </select>
        <button type="button" onClick={load} style={btn('#fff', 'var(--text-main)')} disabled={loading}>
          <RefreshCw size={14} /> {loading ? '불러오는 중' : '새로고침'}
        </button>
      </div>

      {/* 다시 요청한 고객: 찾아서 열고 [파일 확인 후 바로 보내기]로 보낸다 */}
      <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.2rem' }}>
        <form onSubmit={search} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ fontSize: '0.85rem' }}>다시 요청한 고객</b>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="계약자(법인·고객) 이름 · 계약번호 · 차량번호" style={{ ...input, width: '320px' }} />
          <button type="submit" style={btn('var(--primary)')}><Search size={14} /> 찾기</button>
          {found && <button type="button" onClick={() => { setFound(null); setQuery(''); }} style={btn('#fff', 'var(--text-muted)')}>닫기</button>}
        </form>
        {found && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginTop: '0.7rem' }}>
            <tbody>
              {found.length === 0 && <tr><td style={{ padding: '0.8rem', color: 'var(--text-muted)' }}>찾은 계약이 없습니다.</td></tr>}
              {found.map((f) => (
                <tr key={f.contractId} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.5rem' }}><b>{f.partyName}</b> <span style={{ color: 'var(--text-muted)' }}>{f.contractNo} · {f.contractStatus}</span></td>
                  <td style={{ padding: '0.5rem' }}>{f.vehicles.map((v) => `${v.plateNo || '(번호 없음)'} ${v.carModel}`).join(', ') || '-'}</td>
                  <td style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {f.sentAt ? `마지막 발송 ${new Date(f.sentAt).toLocaleDateString('ko-KR')}` : '보낸 적 없음'}
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                    <button type="button" onClick={() => openOne(f.contractId)} style={btn('var(--primary)')}><FileText size={14} /> 열기</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg-main)', textAlign: 'left' }}>
              {['발송일', '계약자', '계약번호', '차량 (인도일)', '받는 사람', '상태', '확인할 것', ''].map((h) => (
                <th key={h} style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>{loading ? '불러오는 중…' : `최근 ${back}일·앞으로 30일 안에 인도한 계약이 없습니다.`}</td></tr>
            )}
            {items.map((it) => {
              const st = STATUS_STYLE[it.changed ? '변경됨' : it.status] || STATUS_STYLE['승인 대기'];
              return (
                <tr key={it.contractId} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.6rem', whiteSpace: 'nowrap', fontWeight: 700 }}>{it.sendDate || '-'}</td>
                  <td style={{ padding: '0.6rem' }}>{it.partyName}</td>
                  <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>{it.contractNo}</td>
                  <td style={{ padding: '0.6rem' }}>
                    {it.vehicles.map((v) => <div key={`${v.plateNo}${v.carModel}`}>{v.plateNo || '(번호 없음)'} {v.carModel} <span style={{ color: 'var(--text-muted)' }}>({v.deliveryDate || '-'})</span></div>)}
                  </td>
                  <td style={{ padding: '0.6rem', fontSize: '0.78rem' }}>{it.to || <span style={{ color: '#dc2626' }}>없음</span>}</td>
                  <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>
                    <span style={{ background: st.bg, color: st.color, borderRadius: '10px', padding: '0.15rem 0.55rem', fontWeight: 700, fontSize: '0.75rem' }}>{it.changed ? '변경됨' : it.status}</span>
                    {it.message && <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: '0.2rem', maxWidth: '220px' }}>{it.message}</div>}
                  </td>
                  <td style={{ padding: '0.6rem', fontSize: '0.75rem', maxWidth: '260px' }}>
                    {it.missing.map((m) => <div key={m} style={{ color: '#dc2626' }}>· {m}</div>)}
                    {it.warnings.map((m) => <div key={m} style={{ color: '#b45309' }}>· {m}</div>)}
                  </td>
                  <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => openOne(it.contractId)} style={btn('var(--primary)')}><FileText size={14} /> 열기</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'center', padding: '1rem', overflow: 'auto' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: 'min(1100px, 100%)', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 2rem)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.8rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 800 }}>{open.party.name} · {open.contractNo} <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.82rem' }}>발송일 {open.sendDate || '-'}</span></div>
              <button type="button" onClick={() => setOpen(null)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', gap: '1rem', padding: '1rem', overflow: 'auto', flexWrap: 'wrap' }}>
              {/* 입력 칸 */}
              <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.8rem' }}>
                {open.missing.length > 0 && (
                  <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: '8px', padding: '0.6rem' }}>
                    <b>아직 보낼 수 없습니다</b>
                    {open.missing.map((m) => <div key={m}>· {m}</div>)}
                  </div>
                )}
                {open.warnings.length > 0 && (
                  <div style={{ background: '#fffbeb', color: '#92400e', borderRadius: '8px', padding: '0.6rem' }}>
                    {open.warnings.map((m) => <div key={m}>· {m}</div>)}
                  </div>
                )}
                {[
                  ['to', '받는 사람 이메일', '법인 청구 이메일이 기본'],
                  ['driverRange', '운전자 범위', '예: 임직원 / 누구나'],
                  ['accidentRepair', '사고수리', '예: 가입 / 미가입'],
                  ['commission', '수수료 (원)', '없으면 비워 두세요'],
                  ['receiptDate', '영수일', '예: 2026년 10월 23일']
                ].map(([k, label, ph]) => (
                  <label key={k}>
                    <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{label}</div>
                    <input value={form[k] || ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} placeholder={ph} style={input} disabled={!canEdit} />
                  </label>
                ))}
                {open.deliveryDocs?.status && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    상태: <b>{open.deliveryDocs.status}</b>
                    {open.deliveryDocs.approvedBy ? ` · 승인 ${open.deliveryDocs.approvedBy}` : ''}
                    {open.deliveryDocs.sentAt ? ` · 보냄 ${new Date(open.deliveryDocs.sentAt).toLocaleString('ko-KR')}` : ''}
                  </div>
                )}
                {(open.deliveryDocs?.history || []).length > 0 && (
                  <div style={{ fontSize: '0.75rem', background: 'var(--bg-main)', borderRadius: '8px', padding: '0.5rem 0.6rem' }}>
                    <b>보낸 기록</b>
                    {[...open.deliveryDocs.history].reverse().map((h, i) => (
                      <div key={i} style={{ color: 'var(--text-muted)' }}>
                        {new Date(h.sentAt).toLocaleString('ko-KR')} · {h.kind} · {h.to}{h.by ? ` · ${h.by}` : ''}
                      </div>
                    ))}
                  </div>
                )}
                {canEdit && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.4rem' }}>
                    <button type="button" onClick={prepareSend} disabled={busy} style={{ ...btn('#1d4ed8'), justifyContent: 'center' }}>
                      <Eye size={14} /> {busy ? '만드는 중…' : '파일 확인 후 바로 보내기'}
                    </button>
                    <button type="button" onClick={approve} disabled={busy || open.missing.length > 0} style={{ ...btn(open.missing.length ? '#94a3b8' : '#047857'), justifyContent: 'center' }}>
                      <Check size={14} /> {busy ? '만드는 중…' : '승인 (PDF 저장 · 발송일에 보냄)'}
                    </button>
                    <button type="button" onClick={saveForm} disabled={busy} style={{ ...btn('#fff', 'var(--text-main)'), justifyContent: 'center' }}>입력만 저장</button>
                    <button type="button" onClick={downloadPdf} disabled={busy} style={{ ...btn('#fff', 'var(--text-main)'), justifyContent: 'center' }}><Download size={14} /> PDF 내려받기</button>
                    {open.deliveryDocs?.status === '승인' && (
                      <>
                        <button type="button" onClick={() => sendNow(open.contractId)} style={{ ...btn('#1d4ed8'), justifyContent: 'center' }}><Send size={14} /> 지금 보내기</button>
                        <button type="button" onClick={() => openApprovedPdf(open.contractId)} style={{ ...btn('#fff', 'var(--text-main)'), justifyContent: 'center' }}>승인한 PDF 보기</button>
                        <button type="button" onClick={() => cancel(open.contractId, false)} style={{ ...btn('#fff', '#dc2626'), justifyContent: 'center' }}><Undo2 size={14} /> 승인 취소</button>
                      </>
                    )}
                    {!['발송완료', '발송중', '보내지 않음'].includes(open.deliveryDocs?.status) && (
                      <button type="button" onClick={() => cancel(open.contractId, true)} style={{ ...btn('#fff', 'var(--text-muted)'), justifyContent: 'center' }}><Ban size={14} /> 보내지 않음 (예전 계약)</button>
                    )}
                  </div>
                )}
              </div>

              {/* 미리보기: 실제 크기를 줄여 보여 준다 */}
              <div style={{ flex: 1, minWidth: '320px', background: '#e5e7eb', borderRadius: '8px', padding: '0.8rem', overflow: 'auto' }}>
                <div style={{ zoom: 0.62 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <ContractFactSheet data={previewData} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {review && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1100, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: 'min(900px, 100%)', height: 'calc(100vh - 2rem)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '0.8rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, fontSize: '0.85rem' }}>
                <b>보낼 파일 확인</b> — 아래 PDF가 그대로 <b>{review.to || '(받는 사람 없음)'}</b>로 나갑니다.
              </div>
              <button type="button" onClick={closeReview} disabled={busy} style={btn('#fff', 'var(--text-main)')}>취소</button>
              <button type="button" onClick={sendReviewed} disabled={busy || !review.to} style={btn('#047857')}>
                <Send size={14} /> {busy ? '보내는 중…' : '이대로 보내기'}
              </button>
            </div>
            <iframe title="보낼 PDF" src={review.url} style={{ flex: 1, border: 'none', width: '100%' }} />
          </div>
        </div>
      )}

      {/* PDF를 뜨는 원본. 화면 밖에 실제 크기로 그려 둔다(줄인 미리보기로 뜨면 글자가 흐려진다) */}
      {previewData && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
          <ContractFactSheet data={previewData} innerRef={sheetRef} />
        </div>
      )}
    </div>
  );
}
