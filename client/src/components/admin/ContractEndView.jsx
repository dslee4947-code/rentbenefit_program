import { useState, useRef } from 'react';
import { Search, FileText, Download, Save, ExternalLink, X } from 'lucide-react';
import ContractEndSheet from './ContractEndSheet.jsx';
import { END_KINDS } from '../../utils/contractEnd.js';
import { makeFittedPdf } from '../../utils/printFit.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 서류는 A4 크기(794×1120px)로 그려 두었으므로 여백 없이 뜬다
const makeSheetPdf = (element) => makeFittedPdf(element, { orientation: 'portrait', marginMm: 0, imageType: 'png' });
// 숨겨 둔 양식이 이미지까지 자리 잡을 때까지 잠깐 기다린다
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

const todayYmd = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// 계약에 적힌 종료 사유로 처음 고를 구분을 정한다
const KIND_OF_REASON = { 중도해지: 'early', 인수: 'takeover', 반납: 'return' };

/**
 * 계약종료 확인서 만들기 (자금팀).
 *
 * 계약이 끝나고 정산까지 마친 고객에게 보내는 서류다. 계약을 찾아 차와 종료 구분
 * (중도해지 · 만기 후 인수 · 만기 후 반납)을 고르고, PDF로 받거나 계약서 폴더에 저장한다.
 * 메일은 보내지 않는다. 고객에게는 받은 PDF로 직접 보낸다.
 */
export default function ContractEndView({ showToast, currentUser }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [open, setOpen] = useState(null); // buildDeliveryDocs 결과
  const [vehicleId, setVehicleId] = useState(''); // '' = 계약의 차 전체
  const [form, setForm] = useState({ kind: 'return', endDate: '', pickupAddress: '', phone: '', issueDate: todayYmd() });
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef(null);
  const canEdit = currentUser?.role !== 'viewer';
  const headers = { 'X-User-Role': currentUser?.role || 'viewer' };

  // 종료 구분에 맞는 날짜: 실제 종료일이 있으면 그것, 없으면 만기 인수·반납은 계약 종료일, 중도해지는 오늘
  const defaultDate = (d, kind) => d.ending?.actualEndDate || (kind === 'early' ? todayYmd() : d.docs[0]?.endDate || '');

  const openOne = async (contractId, plate) => {
    const data = await fetch(`${API_HOST}/api/delivery-docs/${contractId}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!data?.success) { showToast?.(data?.message || '계약을 불러오지 못했습니다.', 'error'); return; }
    const d = data.data;
    const kind = KIND_OF_REASON[d.ending?.endReason] || 'return';
    setOpen(d);
    setForm({ kind, endDate: defaultDate(d, kind), pickupAddress: d.party.address || '', phone: d.party.phone || '', issueDate: todayYmd() });
    const norm = (v) => String(v || '').replace(/\s+/g, '');
    const hit = plate ? d.docs.find((x) => norm(x.plateNo) === norm(plate)) : null;
    setVehicleId(hit?.vehicleId || (d.docs.length === 1 ? d.docs[0].vehicleId : ''));
  };

  const search = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { showToast?.('두 글자 이상 넣어 주세요.', 'error'); return; }
    const data = await fetch(`${API_HOST}/api/delivery-docs/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!data?.success) { showToast?.(data?.message || '찾지 못했습니다.', 'error'); return; }
    setFound(data.items || []);
  };

  const setKind = (kind) => setForm((f) => ({ ...f, kind, endDate: open?.ending?.actualEndDate ? f.endDate : defaultDate(open, kind) }));

  const docs = open ? open.docs.filter((x) => !vehicleId || x.vehicleId === vehicleId) : [];
  const previewData = open ? { ...open, docs } : null;

  const lacking = [];
  docs.forEach((d) => { if (!d.plateNo) lacking.push(`${d.code || d.carModel} 차량번호`); });
  if (open && !docs.length) lacking.push('계약에 묶인 차량');
  if (open && !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) lacking.push(END_KINDS[form.kind].dateLabel);
  const unpaid = open?.ending?.unpaidRounds || [];

  const buildPdf = async () => {
    await settle();
    if (!sheetRef.current) throw new Error('서류 양식을 그리지 못했습니다.');
    return makeSheetPdf(sheetRef.current);
  };

  const fileTitle = () => `계약종료확인서_${END_KINDS[form.kind].label.replace(/\s+/g, '')}_${open.party.name}_${docs.map((d) => d.plateNo || d.code).join(',')}.pdf`;

  const download = async () => {
    setBusy(true);
    try {
      const blob = await buildPdf();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileTitle();
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) {
      showToast?.(err.message || 'PDF를 만들지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveToFolder = async () => {
    if (lacking.length) { showToast?.(`저장할 수 없습니다: ${lacking.join(', ')}`, 'error'); return; }
    setBusy(true);
    try {
      const blob = await buildPdf();
      const fd = new FormData();
      fd.append('file', blob, 'contract-end.pdf');
      fd.append('kind', form.kind);
      fd.append('endDate', form.endDate);
      if (vehicleId) fd.append('vehicleId', vehicleId);
      const res = await fetch(`${API_HOST}/api/delivery-docs/${open.contractId}/end-docs`, { method: 'POST', headers, body: fd }).then((r) => r.json());
      showToast?.(res.message || (res.success ? '저장했습니다.' : '저장하지 못했습니다.'), res.success ? 'success' : 'error');
      if (res.success && res.data) setOpen((o) => ({ ...o, endDocs: res.data.endDocs }));
    } catch (err) {
      showToast?.(err.message || '저장 중 오류가 났습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // 주소를 그냥 열면 로그인 토큰이 실리지 않아 막힌다. 받아서 연다.
  const openSaved = async (doc) => {
    const res = await fetch(`${API_HOST}/api/delivery-docs/${open.contractId}/end-docs/${doc._id}/file`);
    if (!res.ok) { showToast?.('저장한 파일을 열지 못했습니다.', 'error'); return; }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const savedDocs = (open?.endDocs || []).filter((f) => !vehicleId || f.vehicleId === vehicleId);

  const btn = (bg, color = '#fff') => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', background: bg, color, border: bg === '#fff' ? '1px solid var(--border-color)' : 'none', borderRadius: '6px', padding: '0.45rem 0.8rem', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' });
  const input = { width: '100%', padding: '0.45rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', boxSizing: 'border-box' };
  const card = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.2rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={card}>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.6rem' }}>
          계약이 끝나고 <b>정산까지 마친 고객</b>에게 보내는 계약종료 확인서입니다. 계약을 찾아
          <b> 중도해지 · 만기 후 인수 · 만기 후 반납</b> 중 하나를 고르면 문구가 맞춰 바뀝니다. 메일은 보내지 않습니다.
        </div>
        <form onSubmit={search} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="계약자(법인·고객) 이름 · 계약번호 · 차량번호" style={{ ...input, width: '320px', maxWidth: '100%' }} />
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
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                    <button type="button" onClick={() => openOne(f.contractId, /\d{2,3}[가-힣]\d{4}/.test(query.replace(/\s+/g, '')) ? query : '')} style={btn('var(--primary)')}><FileText size={14} /> 열기</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div style={{ ...card, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ width: '290px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{open.party.name}</div>
                <div style={{ color: 'var(--text-muted)' }}>{open.contractNo} · {open.contractStatus}{open.ending?.endReason ? ` · ${open.ending.endReason}` : ''}</div>
              </div>
              <button type="button" onClick={() => setOpen(null)} aria-label="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            <label>
              <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>차량</div>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} style={input}>
                {open.docs.length > 1 && <option value="">계약 차량 전체 ({open.docs.length}대)</option>}
                {open.docs.map((d) => (
                  <option key={d.vehicleId} value={d.vehicleId}>{d.plateNo || '(번호 없음)'} · {d.carModel}</option>
                ))}
              </select>
            </label>

            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>종료 구분</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {Object.entries(END_KINDS).map(([k, t]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input type="radio" name="end-kind" checked={form.kind === k} onChange={() => setKind(k)} /> {t.label}
                  </label>
                ))}
              </div>
            </div>

            {[
              ['endDate', END_KINDS[form.kind].dateLabel, 'date'],
              ...(END_KINDS[form.kind].pickup ? [['pickupAddress', '차량회수지(주소)', 'text']] : []),
              ['phone', '연락처', 'text'],
              ['issueDate', '발행일', 'date']
            ].map(([k, label, type]) => (
              <label key={k}>
                <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{label}</div>
                <input type={type} value={form[k] || ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} style={input} />
              </label>
            ))}

            {unpaid.length > 0 && (
              <div style={{ background: '#fef3c7', color: '#92400e', borderRadius: '8px', padding: '0.6rem', lineHeight: 1.5 }}>
                <b>입금되지 않은 회차가 있습니다</b>
                <div>{unpaid.join(', ')}회차 (청구 회차표 기준)</div>
                <div>정산이 끝났는지 확인한 뒤 보내 주세요.</div>
              </div>
            )}

            {lacking.length > 0 && (
              <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: '8px', padding: '0.6rem' }}>
                <b>저장할 수 없습니다</b>
                {lacking.map((m) => <div key={m}>· {m} 없음</div>)}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.3rem' }}>
              {canEdit && (
                <button type="button" onClick={saveToFolder} disabled={busy || lacking.length > 0} style={btn(lacking.length ? '#94a3b8' : '#047857')}>
                  <Save size={14} /> {busy ? '만드는 중…' : '계약서 폴더에 저장'}
                </button>
              )}
              <button type="button" onClick={download} disabled={busy || !docs.length} style={btn('#fff', 'var(--text-main)')}>
                <Download size={14} /> PDF 받기
              </button>
            </div>

            <div style={{ fontSize: '0.75rem', background: 'var(--bg-main)', borderRadius: '8px', padding: '0.5rem 0.6rem' }}>
              <b>저장해 둔 확인서</b>
              {savedDocs.length === 0 && <div style={{ color: 'var(--text-muted)' }}>아직 저장한 것이 없습니다.</div>}
              {/* 차가 여러 대인 파일은 차마다 기록이 남는다. 같은 파일은 한 줄로 보인다 */}
              {savedDocs.filter((f, i, arr) => arr.findIndex((g) => g.savedPath === f.savedPath) === i).map((f) => (
                <div key={f._id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.25rem' }}>
                  <span style={{ flex: 1, color: 'var(--text-muted)' }}>
                    {new Date(f.savedAt).toLocaleDateString('ko-KR')} · {END_KINDS[f.kind]?.label || f.kind} · {f.plateNo}
                  </span>
                  <button type="button" onClick={() => openSaved(f)} title={f.fileName} style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                    <ExternalLink size={12} /> 열기
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 미리보기: 실제 크기를 줄여 보여 준다 */}
          <div style={{ flex: 1, minWidth: '300px', background: '#e5e7eb', borderRadius: '8px', padding: '0.8rem', overflow: 'auto', maxHeight: '80vh' }}>
            <div style={{ zoom: 0.62 }}>
              <ContractEndSheet data={previewData} form={form} />
            </div>
          </div>
        </div>
      )}

      {/* PDF를 뜨는 원본. 화면 밖에 실제 크기로 그려 둔다(줄인 미리보기로 뜨면 글자가 흐려진다) */}
      {previewData && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
          <ContractEndSheet data={previewData} form={form} innerRef={sheetRef} />
        </div>
      )}
    </div>
  );
}
