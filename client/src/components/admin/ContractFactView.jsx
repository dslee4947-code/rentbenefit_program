import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, FileText, Download, Save, ExternalLink, X, Send } from 'lucide-react';
import ContractFactSheet from './ContractFactSheet.jsx';
import { makeFittedPdf } from '../../utils/printFit.js';
import { partyWithResidentFront } from '../../utils/residentNo.js';
import { dbValue } from '../../utils/factDocs.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 서류는 장마다 A4 크기(794×1120px)로 그려 두었으므로 여백 없이 뜬다
// 메일에 붙일 때는 jpeg로 뜬다. png는 한 장에 10MB가 넘어 메일이 막힐 수 있다
const makeSheetPdf = (element, imageType = 'png') => makeFittedPdf(element, { orientation: 'portrait', marginMm: 0, imageType });
// 숨겨 둔 양식이 이미지까지 자리 잡을 때까지 잠깐 기다린다
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

const PARTS = [
  ['fact', '계약사실 증명원'],
  ['schedule', '상환스케쥴표'],
  ['both', '둘 다 (한 파일)']
];
const PART_NAME = { fact: '계약사실증명원', schedule: '상환스케쥴표', both: '계약사실증명원_상환스케쥴표' };
const normPlate = (v) => String(v || '').replace(/\s+/g, '');

/**
 * 계약사실 증명원 · 상환스케쥴표 만들기 (장기렌트 청구서 아래).
 *
 * 장기렌트 계약서는 차가 나오기 전에 써서 차량번호가 들어가지 않는다. 그래서 차가 나온 뒤
 * 차량번호·차대번호가 든 계약사실 증명원을 따로 만들어 둔다. 고지서 운전자(임차인) 변경 때 관공서에 낸다.
 * 계약을 찾아 차와 서류(증명원 / 상환스케쥴표 / 둘 다)를 고르고, PDF로 받거나 계약서 폴더에 저장하거나 고객 메일로 보낸다.
 * 메일은 담당자가 [메일 보내기]를 눌렀을 때만 나간다. 고지서에서 띄울 때는 관공서에 내는 용도라 메일 칸이 없다.
 *
 * 고지서 관리에서도 이 화면을 그대로 띄운다. 그때는 contractId·plateNo를 받아 그 차로 바로 연다.
 */
export default function ContractFactView({ showToast, currentUser, contractId: presetContract, plateNo: presetPlate, onClose }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [open, setOpen] = useState(null); // buildDeliveryDocs 결과
  const [vehicleId, setVehicleId] = useState(''); // '' = 계약의 차 전체
  const [parts, setParts] = useState('fact');
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [mailTo, setMailTo] = useState(''); // 받는 메일. 계약을 열면 청구서 메일로 채운다
  const sheetRef = useRef(null);
  const canEdit = currentUser?.role !== 'viewer';
  const headers = { 'X-User-Role': currentUser?.role || 'viewer' };

  const openOne = useCallback(async (contractId, plate) => {
    const data = await fetch(`${API_HOST}/api/delivery-docs/${contractId}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!data?.success) { showToast?.(data?.message || '계약을 불러오지 못했습니다.', 'error'); return; }
    const d = data.data;
    setOpen(d);
    setMailTo(d.ending?.mailTo || '');
    setForm({
      driverRange: d.overrides?.driverRange || '',
      accidentRepair: d.overrides?.accidentRepair || '',
      commission: d.overrides?.commission || '',
      receiptDate: d.overrides?.receiptDate || '',
      residentFront: d.overrides?.residentFront || ''
    });
    // 고지서에서 왔으면 그 차로, 차가 한 대면 그 차로 고른다
    const hit = plate ? d.docs.find((x) => normPlate(x.plateNo) === normPlate(plate)) : null;
    setVehicleId(hit?.vehicleId || (d.docs.length === 1 ? d.docs[0].vehicleId : ''));
  }, [showToast]);

  useEffect(() => {
    if (!presetContract) return undefined;
    const t = setTimeout(() => openOne(presetContract, presetPlate), 0);
    return () => clearTimeout(t);
  }, [presetContract, presetPlate, openOne]);

  const search = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { showToast?.('두 글자 이상 넣어 주세요.', 'error'); return; }
    const data = await fetch(`${API_HOST}/api/delivery-docs/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!data?.success) { showToast?.(data?.message || '찾지 못했습니다.', 'error'); return; }
    setFound(data.items || []);
  };

  const docs = open ? open.docs.filter((x) => !vehicleId || x.vehicleId === vehicleId) : [];
  const previewData = open ? {
    ...open,
    party: partyWithResidentFront(open.party, form.residentFront),
    commission: form.commission,
    receiptDate: form.receiptDate,
    docs: docs.map((d) => ({ ...d, accidentRepair: form.accidentRepair || d.db.accidentRepair, insurance: { ...d.insurance, driverRange: form.driverRange || d.db.driverRange } }))
  } : null;

  // 고른 서류에 꼭 있어야 하는 것
  const lacking = [];
  docs.forEach((d) => {
    const name = d.code || d.carModel;
    if (!d.plateNo) lacking.push(`${name} 차량번호`);
    if (parts !== 'schedule' && !d.vin) lacking.push(`${name} 차대번호`);
    if (parts !== 'fact' && !d.schedule.length) lacking.push(`${name} 청구 회차표`);
  });
  if (open && !docs.length) lacking.push('계약에 묶인 차량');

  // 입력 칸(운전자 범위 등)은 인도 서류와 같이 쓴다. 이미 보낸 인도 서류는 서버가 고치지 못하게 막으므로 그때는 화면 값만 쓴다.
  const saveInputs = async () => {
    await fetch(`${API_HOST}/api/delivery-docs/${open.contractId}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(form)
    }).catch(() => null);
  };

  const buildPdf = async (imageType) => {
    await settle();
    if (!sheetRef.current) throw new Error('서류 양식을 그리지 못했습니다.');
    return makeSheetPdf(sheetRef.current, imageType);
  };

  const download = async () => {
    setBusy(true);
    try {
      const blob = await buildPdf();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${PART_NAME[parts]}_${open.party.name}_${docs.map((d) => d.plateNo || d.code).join(',')}.pdf`;
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
      if (canEdit) await saveInputs();
      const blob = await buildPdf();
      const fd = new FormData();
      fd.append('file', blob, 'contract-fact.pdf');
      fd.append('kind', parts);
      if (vehicleId) fd.append('vehicleId', vehicleId);
      const res = await fetch(`${API_HOST}/api/delivery-docs/${open.contractId}/fact-docs`, { method: 'POST', headers, body: fd }).then((r) => r.json());
      showToast?.(res.message || (res.success ? '저장했습니다.' : '저장하지 못했습니다.'), res.success ? 'success' : 'error');
      if (res.success && res.data) setOpen((o) => ({ ...o, factDocs: res.data.factDocs }));
    } catch (err) {
      showToast?.(err.message || '저장 중 오류가 났습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const postMail = (blob, force) => {
    const fd = new FormData();
    fd.append('file', blob, 'contract-fact.pdf');
    fd.append('kind', parts);
    fd.append('to', mailTo.trim());
    if (vehicleId) fd.append('vehicleId', vehicleId);
    if (force) fd.append('force', 'true');
    return fetch(`${API_HOST}/api/delivery-docs/${open.contractId}/fact-docs/send`, { method: 'POST', headers, body: fd }).then((r) => r.json());
  };

  const sendMail = async () => {
    if (lacking.length) { showToast?.(`보낼 수 없습니다: ${lacking.join(', ')}`, 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailTo.trim())) { showToast?.('받는 메일 주소를 확인해 주세요.', 'error'); return; }
    if (!window.confirm(`${open.party.name} ${PARTS.find(([k]) => k === parts)[1]}를 ${mailTo.trim()}(으)로 보낼까요?`)) return;
    setBusy(true);
    try {
      if (canEdit) await saveInputs();
      const blob = await buildPdf('jpeg');
      let res = await postMail(blob, false);
      if (res.alreadySent && window.confirm(`${res.message}\n그래도 다시 보낼까요?`)) res = await postMail(blob, true);
      else if (res.alreadySent) return;
      showToast?.(res.message || (res.success ? '보냈습니다.' : '보내지 못했습니다.'), res.success ? 'success' : 'error');
      if (res.success && res.data) setOpen((o) => ({ ...o, factDocs: res.data.factDocs }));
    } catch (err) {
      showToast?.(err.message || '보내는 중 오류가 났습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // 주소를 그냥 열면 로그인 토큰이 실리지 않아 막힌다. 받아서 연다.
  const openSaved = async (doc) => {
    const res = await fetch(`${API_HOST}/api/delivery-docs/${open.contractId}/fact-docs/${doc._id}/file`);
    if (!res.ok) { showToast?.('저장한 파일을 열지 못했습니다.', 'error'); return; }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const savedDocs = (open?.factDocs || []).filter((f) => !vehicleId || f.vehicleId === vehicleId);

  const btn = (bg, color = '#fff') => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', background: bg, color, border: bg === '#fff' ? '1px solid var(--border-color)' : 'none', borderRadius: '6px', padding: '0.45rem 0.8rem', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' });
  const input = { width: '100%', padding: '0.45rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', boxSizing: 'border-box' };
  const card = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.2rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {!presetContract && (
        <div style={card}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.6rem' }}>
            장기렌트 계약서는 차가 나오기 전에 써서 <b>차량번호가 없습니다</b>. 차가 나온 뒤 <b>차량번호·차대번호</b>가 든
            계약사실 증명원을 만들어 계약서 폴더에 저장해 두세요. 고지서 <b>운전자 변경</b> 때 관공서에 냅니다.
            상환스케쥴표도 따로 만들 수 있습니다.
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
      )}

      {presetContract && !open && <div style={{ ...card, color: 'var(--text-muted)' }}>계약을 불러오는 중…</div>}

      {open && (
        <div style={{ ...card, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ width: '290px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{open.party.name}</div>
                <div style={{ color: 'var(--text-muted)' }}>{open.contractNo}</div>
              </div>
              {!presetContract && <button type="button" onClick={() => setOpen(null)} aria-label="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>}
              {presetContract && onClose && <button type="button" onClick={onClose} aria-label="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>}
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
              <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>만들 서류</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {PARTS.map(([k, label]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input type="radio" name="fact-parts" checked={parts === k} onChange={() => setParts(k)} /> {label}
                  </label>
                ))}
              </div>
            </div>

            {docs.map((d) => (
              <div key={d.vehicleId} style={{ background: 'var(--bg-main)', borderRadius: '8px', padding: '0.5rem 0.6rem', lineHeight: 1.6 }}>
                <div>차량번호 <b style={{ color: d.plateNo ? 'inherit' : '#dc2626' }}>{d.plateNo || '없음'}</b></div>
                <div>차대번호 <b style={{ color: d.vin ? 'inherit' : '#dc2626' }}>{d.vin || '없음'}</b></div>
              </div>
            ))}

            {lacking.length > 0 && (
              <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: '8px', padding: '0.6rem' }}>
                <b>저장할 수 없습니다</b>
                {lacking.map((m) => <div key={m}>· {m} 없음</div>)}
                <div style={{ marginTop: '0.2rem' }}>렌트차량 DB에서 채운 뒤 다시 여세요.</div>
              </div>
            )}

            {parts !== 'schedule' && [
              // 개인 계약자(사업자번호 없음)는 주민등록번호 앞자리만 받는다
              ...(open.party.bizNoLabel === '주민등록번호' ? [['residentFront', '주민등록번호 앞 6자리', '예: 760101 (뒷자리는 *로 가려 찍힘)']] : []),
              ['driverRange', '운전자 범위', `비우면 차량 DB 값(${dbValue(open, 'driverRange')})`],
              ['accidentRepair', '사고수리', `비우면 차량 DB 값(${dbValue(open, 'accidentRepair')})`],
              ['commission', '수수료 (원)', '없으면 비워 두세요'],
              ['receiptDate', '영수일', '예: 2026년 11월 3일']
            ].map(([k, label, ph]) => (
              <label key={k}>
                <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{label}</div>
                <input value={form[k] || ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} placeholder={ph} style={input} disabled={!canEdit} />
              </label>
            ))}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.3rem' }}>
              {canEdit && (
                <button type="button" onClick={saveToFolder} disabled={busy || lacking.length > 0} style={btn(lacking.length ? '#94a3b8' : '#047857')}>
                  <Save size={14} /> {busy ? '만드는 중…' : '계약서 폴더에 저장'}
                </button>
              )}
              <button type="button" onClick={download} disabled={busy || !docs.length} style={btn('#fff', 'var(--text-main)')}>
                <Download size={14} /> PDF 받기
              </button>
              {canEdit && !presetContract && (
                <>
                  <label style={{ marginTop: '0.3rem' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>받는 메일</div>
                    <input type="email" value={mailTo} placeholder="청구 메일이 없습니다" onChange={(e) => setMailTo(e.target.value)} style={input} />
                  </label>
                  <button type="button" onClick={sendMail} disabled={busy || lacking.length > 0} style={btn(lacking.length ? '#94a3b8' : 'var(--primary)')}>
                    <Send size={14} /> {busy ? '만드는 중…' : '메일 보내기'}
                  </button>
                </>
              )}
            </div>

            <div style={{ fontSize: '0.75rem', background: 'var(--bg-main)', borderRadius: '8px', padding: '0.5rem 0.6rem' }}>
              <b>저장해 둔 서류</b>
              {savedDocs.length === 0 && <div style={{ color: 'var(--text-muted)' }}>아직 저장한 것이 없습니다.</div>}
              {/* 차가 여러 대인 파일은 차마다 기록이 남는다. 같은 파일은 한 줄로 보인다 */}
              {savedDocs.filter((f, i, arr) => arr.findIndex((g) => g.savedPath === f.savedPath) === i).map((f) => (
                <div key={f._id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.25rem' }}>
                  <span style={{ flex: 1, color: 'var(--text-muted)' }}>
                    {new Date(f.savedAt).toLocaleDateString('ko-KR')} · {PARTS.find(([k]) => k === f.kind)?.[1] || f.kind} · {f.plateNo}{f.sentAt ? ` · 메일 ${f.sentTo}` : ''}
                  </span>
                  <button type="button" onClick={() => openSaved(f)} title={f.fileName} style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                    <ExternalLink size={12} /> 열기
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 미리보기: 실제 크기를 줄여 보여 준다 */}
          <div style={{ flex: 1, minWidth: '300px', background: '#e5e7eb', borderRadius: '8px', padding: '0.8rem', overflow: 'auto', maxHeight: presetContract ? '70vh' : '80vh' }}>
            <div style={{ zoom: 0.62 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <ContractFactSheet data={previewData} parts={parts} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF를 뜨는 원본. 화면 밖에 실제 크기로 그려 둔다(줄인 미리보기로 뜨면 글자가 흐려진다) */}
      {previewData && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
          <ContractFactSheet data={previewData} parts={parts} innerRef={sheetRef} />
        </div>
      )}
    </div>
  );
}
