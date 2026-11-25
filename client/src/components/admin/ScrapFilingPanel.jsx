import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ScrapFilingDocs from './ScrapFilingDocs.jsx';
import ScrapFilingMail from './ScrapFilingMail.jsx';
import { makeA4PagesPdf } from '../../utils/printFit.js';
import { SCRAP_REASONS } from '../../../../shared/scrapFiling.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);
const API = `${API_HOST}/api/fleet-filings/scrap`;

/**
 * 증차·감차 공문 > 대폐차 신고 탭 (대표님 2026-11-25).
 * 차를 팔거나 바꿀 때 내는 자동차대여사업계획 변경 신고서(별지 제15호서식)와 별첨을 만든다.
 * 차량번호·차종·차대번호로 렌트차량 DB를 찾아 누르면 1쪽 ⑥ 변경 전과 2쪽 별첨이 채워진다.
 */

const card = { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.1rem' };
const input = { padding: '0.35rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.84rem', background: 'var(--bg-surface)', color: 'var(--text-main)', width: '100%', boxSizing: 'border-box' };
const th = { padding: '0.4rem 0.5rem', fontSize: '0.76rem', fontWeight: 800, background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem', verticalAlign: 'middle' };
const lab = { fontSize: '0.78rem', fontWeight: 700 };
const btn = (kind = 'ghost') => ({
  padding: '0.4rem 0.85rem', borderRadius: '6px', fontSize: '0.84rem', fontWeight: 700, cursor: 'pointer',
  border: kind === 'ghost' ? '1px solid var(--border-color)' : 'none',
  background: kind === 'primary' ? 'var(--primary)' : kind === 'danger' ? '#d9534f' : kind === 'ok' ? '#15803d' : 'var(--bg-surface)',
  color: kind === 'ghost' ? 'var(--text-main)' : '#fff'
});
const STATUS_COLOR = { 작성중: '#6b7280', 제출: '#b45309', 처리완료: '#15803d', 취소: '#9ca3af' };
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const Chip = ({ status }) => <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fff', background: STATUS_COLOR[status] || '#6b7280', borderRadius: '10px', padding: '0.1rem 0.55rem', whiteSpace: 'nowrap' }}>{status}</span>;
const carOf = (v) => ({ vehicle: v.vehicle, carName: v.carName, plateNo: v.plateNo, vin: v.vin });
const emptyCar = () => ({ carName: '', plateNo: '', vin: '' });

/* 차량 조회: 글자를 치면 맞는 차가 나오고 누르면 넣는다 */
function VehicleSearch({ vehicles, filedIn, onPick, placeholder }) {
  const [q, setQ] = useState('');
  const found = useMemo(() => {
    const key = squash(q);
    if (!key) return [];
    return vehicles.filter((v) => squash(`${v.plateNo}|${v.carName}|${v.carModel}|${v.vin}`).includes(key));
  }, [q, vehicles]);
  const pick = (v) => { onPick(v); setQ(''); };
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && found.length === 1) pick(found[0]); }} placeholder={placeholder} style={input} />
      {q.trim() && (
        <div style={{ marginTop: '0.3rem', border: '1px solid var(--border-color)', borderRadius: '6px', maxHeight: '240px', overflow: 'auto' }}>
          {found.slice(0, 40).map((v) => (
            <button key={v.vehicle} type="button" onClick={() => pick(v)} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.7rem', width: '100%', padding: '0.35rem 0.6rem', border: 'none', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', textAlign: 'left', cursor: 'pointer', fontSize: '0.82rem' }}>
              <b>{v.plateNo}</b><span>{v.carModel}</span><span style={{ color: v.vin ? 'var(--text-muted)' : '#d9534f' }}>{v.vin || '차대번호 없음'}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{v.status}{filedIn[v.plateNo] ? ` · ${filedIn[v.plateNo]} 신고서에 있음` : ''}</span>
            </button>
          ))}
          {!found.length && <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>맞는 차가 없습니다. 아래 [+ 빈 줄]로 직접 적을 수 있습니다.</div>}
          {found.length > 40 && <div style={{ padding: '0.3rem 0.6rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}>{found.length}대 중 40대만 보입니다. 더 자세히 적어 주세요.</div>}
        </div>
      )}
    </div>
  );
}

function Editor({ filing, data, canEdit, onSave, onStatus, onDelete, onSent, showToast }) {
  const [draft, setDraft] = useState(filing);
  const [busy, setBusy] = useState(false);
  const [showAfter, setShowAfter] = useState(filing.items.some((it) => it.after?.plateNo));
  const docsRef = useRef(null);
  const st = filing.status;
  const editable = canEdit && st !== '처리완료';
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setItem = (i, patch) => setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  // 손으로 고친 차는 DB 차와 다를 수 있어 연결을 끊는다
  const setCar = (i, side, patch) => setItem(i, { [side]: { ...draft.items[i][side], ...patch, ...('plateNo' in patch || 'vin' in patch ? { vehicle: undefined } : {}) } });
  const filedIn = useMemo(() => Object.fromEntries(data.filings.filter((f) => f._id !== filing._id && f.status !== '취소')
    .flatMap((f) => f.items.map((it) => [it.before?.plateNo, ymd(f.filedAt)]))), [data.filings, filing._id]);

  const addBefore = (v) => {
    if (draft.items.some((it) => it.before?.plateNo === v.plateNo)) { showToast('이미 들어간 차입니다.', 'error'); return; }
    set({ items: [...draft.items, { before: carOf(v), after: emptyCar(), reason: '' }] });
  };
  const addAfter = (v) => {
    if (draft.items.some((it) => it.after?.plateNo === v.plateNo)) { showToast('이미 들어간 차입니다.', 'error'); return; }
    const i = draft.items.findIndex((it) => !it.after?.plateNo);
    if (i < 0) { showToast('변경 전 차를 먼저 넣어 주세요.', 'error'); return; }
    setItem(i, { after: carOf(v) });
  };

  const makePdf = () => makeA4PagesPdf([...docsRef.current.querySelectorAll('.fleet-doc-page')]);
  const first = draft.items[0]?.before;
  const pdfName = `대폐차_신고서_${first ? `${first.carName}_${first.plateNo}_` : ''}${draft.items.length > 1 ? `외${draft.items.length - 1}대_` : ''}${ymd(draft.filedAt).replace(/-/g, '').slice(2)}.pdf`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(filing);

  const pdf = async (open) => {
    const win = open ? window.open('', '_blank') : null;
    setBusy(true);
    try {
      const blob = await makePdf();
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = pdfName;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      if (win) win.close();
      showToast(err.message || 'PDF를 만들지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => { setBusy(true); try { await onSave(draft); } finally { setBusy(false); } };
  const carInputs = (it, i, side) => ['carName', 'plateNo', 'vin'].map((k) => (
    <td key={`${side}-${k}`} style={{ ...td, minWidth: k === 'vin' ? '175px' : k === 'plateNo' ? '105px' : '85px' }}>
      <input style={{ ...input, borderColor: k === 'vin' && it[side]?.plateNo && !it[side]?.vin ? '#d9534f' : 'var(--border-color)' }} disabled={!editable} value={it[side]?.[k] || ''} onChange={(e) => setCar(i, side, { [k]: e.target.value })} />
    </td>
  ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <Chip status={st} />
        <b>{filing._id ? `${ymd(filing.filedAt)} 대폐차 신고서` : '새 대폐차 신고서'}</b>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>{draft.items.length}대{filing.processedAt ? ` · 처리 ${ymd(filing.processedAt)}` : ''}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {editable && <button type="button" style={btn('primary')} disabled={busy} onClick={save}>저장</button>}
          {canEdit && filing._id && st === '작성중' && <button type="button" style={btn()} disabled={busy} onClick={() => onStatus(filing, '제출')}>제출함</button>}
          {canEdit && filing._id && st === '제출' && <button type="button" style={btn('ok')} disabled={busy} onClick={() => onStatus(filing, '처리완료')}>처리 완료</button>}
          {canEdit && filing._id && st === '제출' && <button type="button" style={btn()} disabled={busy} onClick={() => onStatus(filing, '작성중')}>작성중으로</button>}
          {canEdit && filing._id && st === '처리완료' && <button type="button" style={btn()} disabled={busy} onClick={() => onStatus(filing, '제출')}>처리 완료 되돌리기</button>}
          <button type="button" style={btn()} disabled={busy} onClick={() => pdf(true)}>인쇄용 열기</button>
          <button type="button" style={btn()} disabled={busy} onClick={() => pdf(false)}>PDF 받기</button>
          {canEdit && filing._id && st !== '처리완료' && <button type="button" style={btn('danger')} disabled={busy} onClick={() => onDelete(filing)}>삭제</button>}
        </span>
      </div>
      {draft._id && editable && dirty && <div style={{ fontSize: '0.8rem', color: '#b45309' }}>고친 내용이 아직 저장되지 않았습니다.</div>}

      <div style={card}>
        <b style={{ fontSize: '0.9rem' }}>차량 조회</b>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>차량번호·차종·차대번호로 찾아 누르면 변경 전에 들어갑니다. 이미 판 차(거래완료)도 나옵니다.</span>
        {editable && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.7rem', margin: '0.5rem 0' }}>
            <VehicleSearch vehicles={data.vehicles} filedIn={filedIn} onPick={addBefore} placeholder="변경 전 차 찾기 (예: 2191, 레이)" />
            {showAfter && <VehicleSearch vehicles={data.vehicles} filedIn={{}} onPick={addAfter} placeholder="변경 후(새 차) 찾기" />}
          </div>
        )}
        {editable && (
          <label style={{ ...lab, display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="checkbox" checked={showAfter} onChange={(e) => { setShowAfter(e.target.checked); if (!e.target.checked) set({ items: draft.items.map((it) => ({ ...it, after: emptyCar() })) }); }} />
            새 차로 바꾸는 신고 (변경 후 칸 쓰기)
          </label>
        )}
        <div style={{ overflow: 'auto', maxHeight: '45vh', marginTop: '0.4rem' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead><tr>{['NO', '변경 전 차량명', '차량번호', '차대번호', ...(showAfter ? ['변경 후 차량명', '차량번호', '차대번호'] : []), '변경사유', ''].map((h, i) => <th key={i} style={{ ...th, position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
            <tbody>
              {draft.items.map((it, i) => (
                <tr key={i}>
                  <td style={td}>{i + 1}</td>
                  {carInputs(it, i, 'before')}
                  {showAfter && carInputs(it, i, 'after')}
                  <td style={{ ...td, minWidth: '130px' }}><input style={input} disabled={!editable} value={it.reason || ''} placeholder={draft.reason} onChange={(e) => setItem(i, { reason: e.target.value })} /></td>
                  <td style={td}>{editable && <button type="button" title="빼기" style={{ ...btn(), padding: '0.15rem 0.4rem' }} onClick={() => set({ items: draft.items.filter((_, j) => j !== i) })}>✕</button>}</td>
                </tr>
              ))}
              {!draft.items.length && <tr><td colSpan={9} style={{ ...td, color: 'var(--text-muted)' }}>위에서 차를 찾아 넣어 주세요.</td></tr>}
            </tbody>
          </table>
        </div>
        {editable && <button type="button" style={{ ...btn(), marginTop: '0.4rem', fontSize: '0.78rem' }} onClick={() => set({ items: [...draft.items, { before: emptyCar(), after: emptyCar(), reason: '' }] })}>+ 빈 줄</button>}
      </div>

      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.7rem' }}>
        <label style={lab}>⑦ 변경사유
          <input list="scrap-reasons" style={input} disabled={!editable} value={draft.reason || ''} onChange={(e) => set({ reason: e.target.value })} />
          <datalist id="scrap-reasons">{SCRAP_REASONS.map((r) => <option key={r} value={r} />)}</datalist>
        </label>
        <label style={lab}>신고일
          <input type="date" style={input} disabled={!editable} value={ymd(draft.filedAt)} onChange={(e) => e.target.value && set({ filedAt: e.target.value })} />
        </label>
        <label style={lab}>⑤ 변경연월일 (비워도 됨)
          <input type="date" style={input} disabled={!editable} value={draft.changedAt || ''} onChange={(e) => set({ changedAt: e.target.value })} />
        </label>
        <label style={lab}>④ 사업의 종류 (비워도 됨)
          <input style={input} disabled={!editable} value={draft.business || ''} placeholder="자동차대여사업" onChange={(e) => set({ business: e.target.value })} />
        </label>
        <label style={{ ...lab, display: 'flex', gap: '0.4rem', alignItems: 'center' }}><input type="checkbox" disabled={!editable} checked={!!draft.showDate} onChange={(e) => set({ showDate: e.target.checked })} /> 신고일을 서류에 찍기</label>
        <label style={{ ...lab, display: 'flex', gap: '0.4rem', alignItems: 'center' }}><input type="checkbox" disabled={!editable} checked={!!draft.showCheck} onChange={(e) => set({ showCheck: e.target.checked })} /> [√] 자동차대여사업계획 변경 표시</label>
        <label style={{ ...lab, gridColumn: '1 / -1' }}>메모 (서류에 안 나옴)
          <textarea rows={2} style={{ ...input, resize: 'vertical' }} disabled={!editable} value={draft.memo || ''} onChange={(e) => set({ memo: e.target.value })} />
        </label>
      </div>

      <ScrapFilingMail api={API} filing={filing} dirty={dirty} canEdit={canEdit} makePdf={makePdf} pdfName={pdfName} onSent={onSent} showToast={showToast} />

      <div style={{ ...card, background: 'var(--bg-main)' }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 800, marginBottom: '0.6rem' }}>서류 미리보기 <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>— 1쪽 신고서 · 2쪽 별첨</span></div>
        <div ref={docsRef} style={{ display: 'flex', flexDirection: 'column', gap: '18px', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '6px' }}>
          <ScrapFilingDocs filing={draft} />
        </div>
      </div>
    </div>
  );
}

export default function ScrapFilingPanel({ canEdit, showToast }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => fetch(API)
    .then((r) => r.json())
    .then((d) => { if (!d.success) throw new Error(d.message); setData(d); })
    .catch((err) => showToast(err.message || '대폐차 신고서를 불러오지 못했습니다.', 'error')), [showToast]);
  useEffect(() => { load(); }, [load]);

  const call = async (url, method, body) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.message || '처리하지 못했습니다.');
    return d;
  };

  const save = async (draft) => {
    try {
      const d = draft._id ? await call(`${API}/${draft._id}`, 'PUT', draft) : await call(API, 'POST', draft);
      showToast('대폐차 신고서를 저장했습니다.', 'success');
      await load();
      setSelected(d.filing._id);
    } catch (err) { showToast(err.message, 'error'); }
  };
  const setStatus = async (filing, status) => {
    if (!window.confirm(`신고서를 '${status}'(으)로 바꿉니다.`)) return;
    try { await call(`${API}/${filing._id}/status`, 'POST', { status }); await load(); } catch (err) { showToast(err.message, 'error'); }
  };
  const remove = async (filing) => {
    if (!window.confirm('이 신고서를 지웁니다.')) return;
    try { await call(`${API}/${filing._id}`, 'DELETE'); setSelected(null); await load(); } catch (err) { showToast(err.message, 'error'); }
  };

  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>대폐차 신고서를 불러오는 중…</div>;
  const current = selected === 'new' ? null : data.filings.find((f) => f._id === selected);
  const fresh = { filedAt: todayYmd(), status: '작성중', reason: SCRAP_REASONS[0], business: '', changedAt: '', showDate: false, showCheck: false, items: [], memo: '' };
  const edit = { data, canEdit, onSave: save, onStatus: setStatus, onDelete: remove, onSent: load, showToast };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: '40vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.8rem', flexWrap: 'wrap' }}>
          <b>대폐차 신고서</b>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>차를 팔거나 바꿀 때 내는 자동차대여사업계획 변경 신고서(별지 제15호서식)와 별첨입니다.</span>
          {canEdit && <button type="button" style={{ ...btn('primary'), marginLeft: 'auto' }} onClick={() => setSelected('new')}>+ 새 신고서</button>}
        </div>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead><tr>{['신고일', '상태', '대수', '변경 전 차량', '변경사유', '처리', '메모'].map((h) => <th key={h} style={{ ...th, position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
          <tbody>
            {data.filings.map((f) => (
              <tr key={f._id} onClick={() => setSelected(f._id)} style={{ cursor: 'pointer', background: selected === f._id ? 'var(--bg-main)' : undefined }}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{ymd(f.filedAt)}</td>
                <td style={td}><Chip status={f.status} /></td>
                <td style={td}>{f.items.length}대</td>
                <td style={td}>{f.items.map((it) => `${it.before?.carName || ''} ${it.before?.plateNo || ''}`.trim()).join(', ')}</td>
                <td style={td}>{f.reason}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{ymd(f.processedAt)}</td>
                <td style={{ ...td, fontSize: '0.76rem', color: 'var(--text-muted)' }}>{f.memo}</td>
              </tr>
            ))}
            {!data.filings.length && <tr><td colSpan={7} style={{ ...td, color: 'var(--text-muted)' }}>신고서가 없습니다. [+ 새 신고서]로 만듭니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {selected === 'new' && <Editor key="new" filing={fresh} {...edit} />}
      {current && <Editor key={`${current._id}-${current.updatedAt}`} filing={{ ...current, filedAt: ymd(current.filedAt) }} {...edit} />}
    </div>
  );
}
