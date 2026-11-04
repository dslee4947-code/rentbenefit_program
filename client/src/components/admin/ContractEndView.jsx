import { useState, useRef } from 'react';
import { Search, FileText, Download, Save, ExternalLink, X, Send } from 'lucide-react';
import ContractEndSheet from './ContractEndSheet.jsx';
import EarlySettlementSheet from './EarlySettlementSheet.jsx';
import { DEPOSIT_ACCOUNT } from './InvoiceSheet.jsx';
import { END_KINDS, FINE_DEPOSIT, SETTLEMENT_LAYOUTS, originOf, ratePctOf, settlementOf } from '../../utils/contractEnd.js';
import { makeFittedPdf } from '../../utils/printFit.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 서류는 A4 크기(794×1120px)로 그려 두었으므로 여백 없이 뜬다.
// 메일에 붙이는 파일이라 jpeg로 뜬다. png는 한 장에 10MB가 넘어 메일이 막힐 수 있다
const makeSheetPdf = (element) => makeFittedPdf(element, { orientation: 'portrait', marginMm: 0, imageType: 'jpeg' });
// 숨겨 둔 양식이 이미지까지 자리 잡을 때까지 잠깐 기다린다
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

const todayYmd = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const wonText = (n) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
// 계약에 적힌 종료 사유로 처음 고를 구분을 정한다
const KIND_OF_REASON = { 중도해지: 'early', 인수: 'takeover', 반납: 'return' };
// 중도해지 정산서 입력값. 납부 회차는 비우면 청구 회차표의 입금완료 수, 나머지 비운 칸은 차량 DB 값을 쓴다
const SETTLEMENT_FORM = (d) => ({
  layout: 'split',
  returnDate: d?.ending?.actualEndDate || todayYmd(),
  paidCount: '',
  actualKm: '',
  baseKm: '200',
  annualKm: '',
  origin: '',
  ratePct: '',
  repairs: ['', '', '', '', ''],
  toll: '',
  unpaidRepair: '',
  issueDate: todayYmd(),
  manager: '렌트베네핏 팀장 이두식 010-9061-3000 / 02-547-0303',
  account: `${DEPOSIT_ACCOUNT.bankName} ${DEPOSIT_ACCOUNT.accountNo}`
});
const FORM_OF = {
  settlement: (d) => SETTLEMENT_FORM(d),
  end: () => ({ kind: 'return', endDate: '', pickupAddress: '', phone: '', issueDate: todayYmd() })
};
const SHEET_OF = { settlement: EarlySettlementSheet, end: ContractEndSheet };
const DOC_NAME = { settlement: '정산서', end: '확인서' };

/**
 * 계약종료 확인서 만들기 (자금팀).
 *
 * 계약이 끝나고 정산까지 마친 고객에게 보내는 서류다. 계약을 찾아 차와 종료 구분
 * (중도해지 · 만기 후 인수 · 만기 후 반납)을 고르고, PDF로 받거나 계약서 폴더에 저장하거나 메일로 보낸다.
 * 메일은 담당자가 [메일 보내기]를 눌렀을 때만 청구서와 같은 계정으로 나간다.
 *
 * mode='settlement'면 중도해지 정산서를 만든다(자금팀 > 중도해지 정산서).
 * 차를 돌려받은 뒤 납부·미납 렌트료와 위약금, 초과운행, 수리비, 보증금·선수금을 모두 계산해 최종 정산금을 낸다. 차 한 대씩 만든다.
 * 중도해지 절차 안내도 이 서류 맨 뒤에 함께 들어간다.
 */
export default function ContractEndView({ showToast, currentUser, mode = 'end' }) {
  const settlement = mode === 'settlement';
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [open, setOpen] = useState(null); // buildDeliveryDocs 결과
  const [vehicleId, setVehicleId] = useState(''); // '' = 계약의 차 전체
  const [form, setForm] = useState(FORM_OF[mode](null));
  const [settlementInfo, setSettlementInfo] = useState(null); // 정산서: 차마다 납부 회차와 확인할 값
  const [mailTo, setMailTo] = useState(''); // 받는 메일. 계약을 열면 청구서 메일로 채운다
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
    if (settlement) {
      const res = await fetch(`${API_HOST}/api/delivery-docs/${contractId}/settlement-info`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      setSettlementInfo(res?.success ? res.data : null);
    }
    const kind = KIND_OF_REASON[d.ending?.endReason] || 'return';
    setOpen(d);
    setMailTo(d.ending?.mailTo || '');
    setForm(mode === 'end' ? { kind, endDate: defaultDate(d, kind), pickupAddress: d.party.address || '', phone: d.party.phone || '', issueDate: todayYmd() } : FORM_OF[mode](d));
    const norm = (v) => String(v || '').replace(/\s+/g, '');
    const hit = plate ? d.docs.find((x) => norm(x.plateNo) === norm(plate)) : null;
    setVehicleId(hit?.vehicleId || (d.docs.length === 1 || settlement ? d.docs[0]?.vehicleId || '' : ''));
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
  if (open && mode === 'end' && !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) lacking.push(END_KINDS[form.kind].dateLabel);
  const unpaid = mode === 'end' ? open?.ending?.unpaidRounds || [] : [];

  // 정산서: 고른 차 한 대를 계산하고, 사람이 확인해야 할 것을 화면에 알린다(종이에는 들어가지 않는다)
  const info = settlement && docs[0] ? settlementInfo?.[docs[0].vehicleId] : null;
  // 연장 계약은 연장 시작일부터 센다(인도일이 최초 인도일로 남아 있는 차가 있다)
  const extended = settlement && info?.periodStart > (docs[0]?.deliveryDate || '');
  const settleDoc = !settlement ? null : extended ? { ...docs[0], deliveryDate: info.periodStart } : docs[0];
  const sheetData = settleDoc ? { ...previewData, docs: [settleDoc] } : previewData;
  const paidTyped = String(form.paidCount ?? '').trim() !== '';
  // 납부 회차를 적지 않았으면 청구 회차표의 입금완료 수
  const sheetForm = settlement ? { ...form, paidCount: paidTyped ? form.paidCount : info?.paidRounds ?? '' } : form;
  const settled = settleDoc ? settlementOf(settleDoc, sheetForm) : null;
  const settleWarnings = [];
  if (settleDoc) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.returnDate)) lacking.push('차량 반납일');
    if (!settleDoc.deliveryDate) lacking.push('인도일');
    if (!settleDoc.endDate) lacking.push('계약 만료일');
    if (!settleDoc.termMonths) lacking.push('계약 기간');
    if (!ratePctOf(settleDoc, form.ratePct)) lacking.push('위약금율(계약에 없음 — 화면에 적어 주세요)');
    if (!(settled?.annualKm || settleDoc.mileage)) lacking.push('연간 약정 주행거리(차량 DB에 없음 — 화면에 적어 주세요)');
    if (String(form.actualKm).trim() === '') lacking.push('반납 시 실주행거리');
    if (!paidTyped && !info) lacking.push('납부 회차(청구 회차표를 읽지 못함 — 화면에 적어 주세요)');
    if (settled?.returnDate > settled?.end) settleWarnings.push(`반납일이 계약 만료일(${settled.end}) 뒤입니다. 중도해지가 맞는지 확인해 주세요.`);
    if (extended) settleWarnings.push(`연장 계약이라 인도일 대신 연장 시작일(${info.periodStart})부터 계산했습니다. 보증금·선수금이 이번 계약의 금액인지 확인해 주세요.`);
    if (info) {
      if (paidTyped && Number(form.paidCount) !== info.paidRounds) settleWarnings.push(`납부 회차를 청구 회차표(입금완료 ${info.paidRounds}회)와 다르게 적었습니다.`);
      if (info.hasLedger && info.ledgerRounds !== info.paidRounds) settleWarnings.push(`청구 회차표는 입금완료 ${info.paidRounds}회인데 차량 손익 원장에는 렌트료가 ${info.ledgerRounds}회 있습니다. 입금 처리가 늦은 회차면 고객이 낸 돈이 미납으로 잡힙니다. 확인 후 납부 회차 칸에 맞는 수를 적어 주세요.`);
      if (info.hasLedger && settleDoc.advancePayment !== info.advanceIn) settleWarnings.push(`차량 DB의 선수금(${wonText(settleDoc.advancePayment)})이 원장에 입금된 선수금(${wonText(info.advanceIn)})과 다릅니다. 선수금 잔액을 확인해 주세요.`);
      if (info.firstRoundRent && info.roundRent && Math.abs(info.firstRoundRent - info.roundRent) > 1000) settleWarnings.push(`1회차를 일할로 받은 계약입니다(1회차 ${wonText(info.firstRoundRent)}, 월 ${wonText(info.roundRent)}, 차액 ${wonText(Math.abs(info.roundRent - info.firstRoundRent))}). 이 차액은 정산서에 넣지 않았습니다.`);
      if (info.roundRent && Math.abs(info.roundRent - settleDoc.monthlyFee) > 1000) settleWarnings.push(`차량 DB의 월 렌트료(${wonText(settleDoc.monthlyFee)})가 청구 회차표(${wonText(info.roundRent)})와 다릅니다. 차량 DB를 고친 뒤 만들어 주세요.`);
    }
  }

  const buildPdf = async () => {
    await settle();
    if (!sheetRef.current) throw new Error('서류 양식을 그리지 못했습니다.');
    return makeSheetPdf(sheetRef.current);
  };

  const fileTitle = () => {
    const name = settlement ? '중도해지정산서' : `계약종료확인서_${END_KINDS[form.kind].label.replace(/\s+/g, '')}`;
    return `${name}_${open.party.name}_${docs.map((d) => d.plateNo || d.code).join(',')}.pdf`;
  };

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
      fd.append('kind', mode === 'end' ? form.kind : mode);
      fd.append('endDate', settlement ? form.returnDate : form.endDate);
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

  const postMail = async (blob, force) => {
    const fd = new FormData();
    fd.append('file', blob, 'contract-end.pdf');
    fd.append('kind', mode === 'end' ? form.kind : mode);
    fd.append('endDate', settlement ? form.returnDate : form.endDate);
    fd.append('to', mailTo.trim());
    if (force) fd.append('force', 'true');
    if (vehicleId) fd.append('vehicleId', vehicleId);
    return fetch(`${API_HOST}/api/delivery-docs/${open.contractId}/end-docs/send`, { method: 'POST', headers, body: fd }).then((r) => r.json());
  };

  // 고객에게 바로 나가는 일이라 받는 주소와 확인할 것을 한 번 더 보여 주고 보낸다
  const sendMail = async () => {
    if (lacking.length) { showToast?.(`보낼 수 없습니다: ${lacking.join(', ')}`, 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailTo.trim())) { showToast?.('받는 메일 주소를 확인해 주세요.', 'error'); return; }
    const warn = settleWarnings.length ? `\n\n확인할 내용이 ${settleWarnings.length}건 있습니다. 왼쪽의 '확인해 주세요'를 보셨나요?` : '';
    if (!window.confirm(`${open.party.name} ${DOC_NAME[mode]}를 ${mailTo.trim()}(으)로 보낼까요?${warn}`)) return;
    setBusy(true);
    try {
      const blob = await buildPdf();
      let res = await postMail(blob, false);
      if (res.alreadySent && window.confirm(`${res.message}\n그래도 다시 보낼까요?`)) res = await postMail(blob, true);
      else if (res.alreadySent) return;
      showToast?.(res.message || (res.success ? '보냈습니다.' : '보내지 못했습니다.'), res.success ? 'success' : 'error');
      if (res.success && res.data) setOpen((o) => ({ ...o, endDocs: res.data.endDocs }));
    } catch (err) {
      showToast?.(err.message || '보내는 중 오류가 났습니다.', 'error');
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

  const savedDocs = (open?.endDocs || []).filter((f) => (!vehicleId || f.vehicleId === vehicleId) && (mode === 'end' ? f.kind !== 'settlement' : f.kind === mode));
  const Sheet = SHEET_OF[mode];
  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const btn = (bg, color = '#fff') => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', background: bg, color, border: bg === '#fff' ? '1px solid var(--border-color)' : 'none', borderRadius: '6px', padding: '0.45rem 0.8rem', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' });
  const input = { width: '100%', padding: '0.45rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', boxSizing: 'border-box' };
  const card = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.2rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={card}>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.6rem' }}>
          {settlement ? (
            <>차를 돌려받은 뒤 고객에게 보내는 <b>중도해지 정산서</b>입니다. 계약을 찾아 <b>반납일·실주행거리·수리비·미납 통행료</b>를 넣으면
              납부·미납 렌트료와 위약금, 보증금·선수금을 모두 계산해 <b>최종 정산금</b>을 냅니다. <b>중도해지 절차</b> 안내도 맨 뒤 쪽에 함께 들어갑니다. 메일은 [메일 보내기]를 눌렀을 때만 나갑니다.</>
          ) : (
            <>계약이 끝나고 <b>정산까지 마친 고객</b>에게 보내는 계약종료 확인서입니다. 계약을 찾아
              <b> 중도해지 · 만기 후 인수 · 만기 후 반납</b> 중 하나를 고르면 문구가 맞춰 바뀝니다. 메일은 [메일 보내기]를 눌렀을 때만 나갑니다.</>
          )}
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
                {open.docs.length > 1 && !settlement && <option value="">계약 차량 전체 ({open.docs.length}대)</option>}
                {open.docs.map((d) => (
                  <option key={d.vehicleId} value={d.vehicleId}>{d.plateNo || '(번호 없음)'} · {d.carModel}</option>
                ))}
              </select>
            </label>

            {settlement && settleDoc && (
              <>
                <label>
                  <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>양식</div>
                  <select value={form.layout} onChange={setField('layout')} style={input}>
                    {Object.entries(SETTLEMENT_LAYOUTS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {[
                    ['returnDate', '차량 반납일', 'date', ''],
                    ['paidCount', '납부 회차', 'text', info ? `회차표 ${info.paidRounds}회` : '회차표 없음'],
                    ['actualKm', '실주행거리(km)', 'text', '계기판 기준'],
                    ['baseKm', '기본 제공 거리(km)', 'text', ''],
                    ['annualKm', '연간 약정(km)', 'text', settleDoc.mileage ? `차량 DB ${settleDoc.mileage.toLocaleString('ko-KR')}` : '차량 DB에 없음'],
                    ['ratePct', '위약금율(%)', 'text', settleDoc.earlyRate ? `계약 ${settleDoc.earlyRate}` : '계약에 없음']
                  ].map(([k, label, type, ph]) => (
                    <label key={k}>
                      <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{label}</div>
                      <input type={type} inputMode={type === 'text' ? 'numeric' : undefined} value={form[k]} placeholder={ph} onChange={setField(k)} style={input} />
                    </label>
                  ))}
                </div>
                <label>
                  <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>초과운행료 구분</div>
                  <select value={form.origin || originOf(settleDoc.carModel)} onChange={setField('origin')} style={input}>
                    <option value="국산">국산 (100원/km)</option>
                    <option value="외산">수입·외산 (200원/km)</option>
                  </select>
                </label>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>수리내역 (면책금, 반납 점검 기준)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.3rem' }}>
                    {form.repairs.map((v, i) => (
                      <input key={i} inputMode="numeric" value={v} placeholder={`수리 ${i + 1}`} aria-label={`수리내역 ${i + 1}`} style={input}
                        onChange={(e) => setForm((f) => ({ ...f, repairs: f.repairs.map((x, j) => (j === i ? e.target.value : x)) }))} />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                  {[['toll', '미납 통행료'], ['unpaidRepair', '미납 수리비']].map(([k, label]) => (
                    <label key={k}>
                      <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{label}</div>
                      <input inputMode="numeric" value={form[k]} onChange={setField(k)} style={input} />
                    </label>
                  ))}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>범칙금·과태료 예치금 {wonText(FINE_DEPOSIT)} 고정 (반납 3개월 후 잔액 반환)</div>
                {[['issueDate', '발행일', 'date'], ['account', '입금 계좌', 'text'], ['manager', '담당자', 'text']].map(([k, label, type]) => (
                  <label key={k}>
                    <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{label}</div>
                    <input type={type} value={form[k]} onChange={setField(k)} style={input} />
                  </label>
                ))}
                {settled && (
                  <div style={{ background: 'var(--bg-main)', borderRadius: '8px', padding: '0.5rem 0.6rem', lineHeight: 1.65 }}>
                    <div>납부 회차 {settled.paidCount}회 <span style={{ color: 'var(--text-muted)' }}>({settled.paidUntil}까지)</span></div>
                    <div>{settled.overpaidRent ? <>초과 납부 렌트료 <b>{wonText(settled.overpaidRent)}</b> <span style={{ color: 'var(--text-muted)' }}>(상계)</span></> : <>미납 렌트료 {wonText(settled.unpaidRent)}</>}</div>
                    <div>위약금 {wonText(settled.penalty)}</div>
                    <div>초과운행 {wonText(settled.excessFee)} · 수리 {wonText(settled.repairTotal)} · 미납 청구 {wonText(settled.unpaidClaim)}</div>
                    <div>보증금·선수금 차감 {wonText(settled.deposit + settled.advanceRemain)}</div>
                    <div>최종 정산금 <b style={{ color: '#dc2626' }}>{wonText(settled.final)}</b> <span style={{ color: 'var(--text-muted)' }}>{settled.final > 0 ? '(고객 납부)' : settled.final < 0 ? '(고객 환급)' : ''}</span></div>
                  </div>
                )}
                {settleWarnings.length > 0 && (
                  <div style={{ background: '#fef3c7', color: '#92400e', borderRadius: '8px', padding: '0.6rem', lineHeight: 1.5 }}>
                    <b>확인해 주세요</b>
                    {settleWarnings.map((m) => <div key={m}>· {m}</div>)}
                  </div>
                )}
              </>
            )}

            {mode === 'end' && <div>
              <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>종료 구분</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {Object.entries(END_KINDS).map(([k, t]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input type="radio" name="end-kind" checked={form.kind === k} onChange={() => setKind(k)} /> {t.label}
                  </label>
                ))}
              </div>
            </div>}

            {mode === 'end' && [
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
                <>
                  <label>
                    <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>받는 메일</div>
                    <input type="email" value={mailTo} placeholder="청구 메일이 없습니다" onChange={(e) => setMailTo(e.target.value)} style={input} />
                  </label>
                  <button type="button" onClick={sendMail} disabled={busy || lacking.length > 0} style={btn(lacking.length ? '#94a3b8' : 'var(--primary)')}>
                    <Send size={14} /> {busy ? '만드는 중…' : '메일 보내기'}
                  </button>
                </>
              )}
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
              <b>저장해 둔 {DOC_NAME[mode]}</b>
              {savedDocs.length === 0 && <div style={{ color: 'var(--text-muted)' }}>아직 저장한 것이 없습니다.</div>}
              {/* 차가 여러 대인 파일은 차마다 기록이 남는다. 같은 파일은 한 줄로 보인다 */}
              {savedDocs.filter((f, i, arr) => arr.findIndex((g) => g.savedPath === f.savedPath) === i).map((f) => (
                <div key={f._id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.25rem' }}>
                  <span style={{ flex: 1, color: 'var(--text-muted)' }}>
                    {new Date(f.savedAt).toLocaleDateString('ko-KR')} · {END_KINDS[f.kind]?.label || `반납 ${f.endDate}`} · {f.plateNo}{f.sentAt ? ` · 메일 ${f.sentTo}` : ''}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <Sheet data={sheetData} form={sheetForm} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF를 뜨는 원본. 화면 밖에 실제 크기로 그려 둔다(줄인 미리보기로 뜨면 글자가 흐려진다) */}
      {previewData && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
          <Sheet data={sheetData} form={sheetForm} innerRef={sheetRef} />
        </div>
      )}
    </div>
  );
}
