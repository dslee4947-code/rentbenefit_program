import { useCallback, useEffect, useRef, useState } from 'react';
import CarAgeFilingDocs from './CarAgeFilingDocs.jsx';
import { makeA4PagesPdf } from '../../utils/printFit.js';
import { DEFAULT_CAR_AGE_APPLICANT } from '../../../../shared/carAgeFiling.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);
const API = `${API_HOST}/api/fleet-filings/car-age`;

/**
 * 증차·감차 공문 > 차령연장 신청서 탭 (대표님 2026-11-17).
 * 우리 회사 렌터카 차령을 연장할 때 서울시에 내는 사업용자동차 차령조정 신청서(별지 제55호서식)와 별첨 차량 목록을 만든다.
 * 차는 정비·검사 기록에서 [차령 연장 신청]을 체크한 자동차검사로 불러오거나 차량번호로 하나씩 넣는다.
 */

const card = { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.1rem' };
const input = { padding: '0.35rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.84rem', background: 'var(--bg-surface)', color: 'var(--text-main)', width: '100%', boxSizing: 'border-box' };
const th = { padding: '0.4rem 0.5rem', fontSize: '0.76rem', fontWeight: 800, background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem', verticalAlign: 'middle' };
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
const Chip = ({ status }) => <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fff', background: STATUS_COLOR[status] || '#6b7280', borderRadius: '10px', padding: '0.1rem 0.55rem', whiteSpace: 'nowrap' }}>{status}</span>;

const APPLICANT_FIELDS = [
  ['name', '① 법인 명칭'], ['ceo', '대표자 성명'], ['corpNo', '② 법인등록번호'],
  ['address', '③ 주소'], ['address2', '주소 둘째 줄'], ['phone', '전화'],
  ['business', '④ 사업의 종류'], ['signName', '신청인 서명란'], ['addressee', '받는 곳 (시ㆍ도지사 귀하 옆)']
];

function Editor({ filing, data, canEdit, onSave, onStatus, onDelete, showToast }) {
  const [draft, setDraft] = useState(filing);
  const [busy, setBusy] = useState(false);
  const [plate, setPlate] = useState('');
  const docsRef = useRef(null);
  const editable = canEdit && filing.status !== '처리완료';
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setApp = (k, v) => setDraft((d) => ({ ...d, applicant: { ...d.applicant, [k]: v } }));
  const setItem = (i, patch) => setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const has = (p) => draft.items.some((it) => it.plateNo === p);
  const candidates = (data.candidates || []).filter((c) => !has(c.plateNo));

  const addPlate = () => {
    const p = plate.replace(/\s+/g, '');
    if (!p) return;
    if (has(p)) { showToast('이미 들어간 차입니다.', 'error'); return; }
    const v = (data.vehicles || []).find((x) => x.plateNo === p) || (data.candidates || []).find((x) => x.plateNo === p);
    set({ items: [...draft.items, { vehicle: v?.vehicle, carName: v?.carName || '', plateNo: p, passedAt: v?.passedAt || '', note: '' }] });
    setPlate('');
  };

  const pdf = async (open) => {
    const win = open ? window.open('', '_blank') : null;
    setBusy(true);
    try {
      const blob = await makeA4PagesPdf([...docsRef.current.querySelectorAll('.fleet-doc-page')]);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `사업용자동차_차령조정_신청서_${ymd(draft.filedAt).replace(/-/g, '').slice(2)}_${draft.items.length}대.pdf`;
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
  const st = filing.status;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <Chip status={st} />
        <b>{filing._id ? `${ymd(filing.filedAt)} 차령조정 신청서` : '새 차령조정 신청서'}</b>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>{draft.items.length}대{filing.processedAt ? ` · 처리 ${ymd(filing.processedAt)}` : ''}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {editable && <button type="button" style={btn('primary')} disabled={busy} onClick={save}>저장</button>}
          {canEdit && filing._id && st === '작성중' && <button type="button" style={btn()} disabled={busy} onClick={() => onStatus(filing, '제출')}>서울시에 냄</button>}
          {canEdit && filing._id && st === '제출' && <button type="button" style={btn('ok')} disabled={busy} onClick={() => onStatus(filing, '처리완료')}>처리 완료</button>}
          {canEdit && filing._id && st === '제출' && <button type="button" style={btn()} disabled={busy} onClick={() => onStatus(filing, '작성중')}>작성중으로</button>}
          {canEdit && filing._id && st === '처리완료' && <button type="button" style={btn()} disabled={busy} onClick={() => onStatus(filing, '제출')}>처리 완료 되돌리기</button>}
          <button type="button" style={btn()} disabled={busy} onClick={() => pdf(true)}>인쇄용 열기</button>
          <button type="button" style={btn()} disabled={busy} onClick={() => pdf(false)}>PDF 받기</button>
          {canEdit && filing._id && st !== '처리완료' && <button type="button" style={btn('danger')} disabled={busy} onClick={() => onDelete(filing)}>삭제</button>}
        </span>
      </div>
      {draft._id && editable && JSON.stringify(draft) !== JSON.stringify(filing) && <div style={{ fontSize: '0.8rem', color: '#b45309' }}>고친 내용이 아직 저장되지 않았습니다.</div>}

      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.7rem' }}>
        <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>신청일
          <input type="date" style={input} disabled={!editable} value={ymd(draft.filedAt)} onChange={(e) => set({ filedAt: e.target.value })} />
        </label>
        {APPLICANT_FIELDS.map(([k, name]) => (
          <label key={k} style={{ fontSize: '0.78rem', fontWeight: 700 }}>{name}
            <input style={input} disabled={!editable} value={draft.applicant?.[k] || ''} placeholder={DEFAULT_CAR_AGE_APPLICANT[k]} onChange={(e) => setApp(k, e.target.value)} />
          </label>
        ))}
        <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" disabled={!editable} checked={draft.stamp !== false} onChange={(e) => set({ stamp: e.target.checked })} /> 신청인 칸에 회사 도장 찍기
        </label>
        <label style={{ fontSize: '0.78rem', fontWeight: 700, gridColumn: '1 / -1' }}>메모 (서류에 안 나옴)
          <textarea rows={2} style={{ ...input, resize: 'vertical' }} disabled={!canEdit} value={draft.memo || ''} onChange={(e) => set({ memo: e.target.value })} />
        </label>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <b style={{ fontSize: '0.9rem' }}>신청 대상 차량 {draft.items.length}대</b>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>2대 이상이면 ⑤칸은 "별첨 목록 기재 차량 N대"로 쓰고 별첨 목록을 붙입니다. 합격통지서 칸을 비우면 "첨부 N번"으로 나옵니다.</span>
          {editable && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
              <input list="car-age-plates" value={plate} onChange={(e) => setPlate(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPlate()} placeholder="차량번호" style={{ ...input, width: '140px' }} />
              <datalist id="car-age-plates">{(data.vehicles || []).map((v) => <option key={v.plateNo} value={v.plateNo}>{v.carModel}</option>)}</datalist>
              <button type="button" style={btn()} onClick={addPlate}>+ 차 넣기</button>
            </span>
          )}
        </div>
        {editable && candidates.length > 0 && (
          <div style={{ fontSize: '0.8rem', marginBottom: '0.6rem', padding: '0.5rem 0.7rem', background: 'var(--bg-main)', borderRadius: '6px' }}>
            <b>검사 기록에서 찾은 차 {candidates.length}대</b> <span style={{ color: 'var(--text-muted)' }}>(최근 1년 자동차검사 중 [차령 연장 신청] 체크, 다른 신청서에 없는 차)</span>
            <button type="button" style={{ ...btn(), marginLeft: '0.5rem', padding: '0.15rem 0.6rem', fontSize: '0.78rem' }} onClick={() => set({ items: [...draft.items, ...candidates.map((c) => ({ vehicle: c.vehicle, carName: c.carName, plateNo: c.plateNo, passedAt: c.passedAt, note: '' }))] })}>모두 넣기</button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.4rem' }}>
              {candidates.map((c) => (
                <button key={c.plateNo} type="button" title={c.carModel} style={{ ...btn(), padding: '0.1rem 0.5rem', fontSize: '0.76rem', fontWeight: 600 }} onClick={() => set({ items: [...draft.items, { vehicle: c.vehicle, carName: c.carName, plateNo: c.plateNo, passedAt: c.passedAt, note: '' }] })}>
                  + {c.plateNo} {c.carName} · {c.passedAt}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ overflow: 'auto', maxHeight: '50vh' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: '620px' }}>
            <thead><tr>{['연번', '차명', '자동차등록번호', '검사 합격일', '합격통지서', ''].map((h) => <th key={h} style={{ ...th, position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
            <tbody>
              {draft.items.map((it, i) => (
                <tr key={`${it.plateNo}-${i}`}>
                  <td style={{ ...td, width: '44px' }}>{i + 1}</td>
                  <td style={{ ...td, width: '130px' }}><input style={input} disabled={!editable} value={it.carName} onChange={(e) => setItem(i, { carName: e.target.value })} /></td>
                  <td style={{ ...td, width: '140px' }}><input style={input} disabled={!editable} value={it.plateNo} onChange={(e) => setItem(i, { plateNo: e.target.value })} /></td>
                  <td style={{ ...td, width: '150px' }}><input type="date" style={input} disabled={!editable} value={it.passedAt || ''} onChange={(e) => setItem(i, { passedAt: e.target.value })} /></td>
                  <td style={td}><input style={input} disabled={!editable} value={it.note || ''} placeholder={`첨부 ${i + 1}번`} onChange={(e) => setItem(i, { note: e.target.value })} /></td>
                  <td style={{ ...td, width: '84px', whiteSpace: 'nowrap' }}>
                    {editable && (
                      <>
                        <button type="button" title="위로" disabled={i === 0} style={{ ...btn(), padding: '0.15rem 0.35rem' }} onClick={() => set({ items: draft.items.map((x, j) => (j === i - 1 ? draft.items[i] : j === i ? draft.items[i - 1] : x)) })}>↑</button>
                        <button type="button" style={{ ...btn(), padding: '0.15rem 0.4rem', marginLeft: '0.2rem' }} onClick={() => set({ items: draft.items.filter((_, j) => j !== i) })}>✕</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!draft.items.length && <tr><td colSpan={6} style={{ ...td, color: 'var(--text-muted)' }}>차를 넣어 주세요.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...card, background: 'var(--bg-main)' }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 800, marginBottom: '0.6rem' }}>
          서울시에 낼 서류 미리보기 <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>— 신청서 앞쪽 · 뒤쪽{draft.items.length > 1 ? ' · 별첨 차량 목록' : ''}. 검사 합격통지서는 따로 붙입니다.</span>
        </div>
        <div ref={docsRef} style={{ display: 'flex', flexDirection: 'column', gap: '18px', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '6px' }}>
          <CarAgeFilingDocs filing={draft} />
        </div>
      </div>
    </div>
  );
}

export default function CarAgeFilingPanel({ canEdit, showToast }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => fetch(API)
    .then((r) => r.json())
    .then((d) => { if (!d.success) throw new Error(d.message); setData(d); })
    .catch((err) => showToast(err.message || '차령조정 신청서를 불러오지 못했습니다.', 'error')), [showToast]);
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
      showToast('차령조정 신청서를 저장했습니다.', 'success');
      await load();
      setSelected(d.filing._id);
    } catch (err) { showToast(err.message, 'error'); }
  };
  const setStatus = async (filing, status) => {
    if (!window.confirm(`신청서를 '${status}'(으)로 바꿉니다.`)) return;
    try { await call(`${API}/${filing._id}/status`, 'POST', { status }); await load(); } catch (err) { showToast(err.message, 'error'); }
  };
  const remove = async (filing) => {
    if (!window.confirm('이 신청서를 지웁니다.')) return;
    try { await call(`${API}/${filing._id}`, 'DELETE'); setSelected(null); await load(); } catch (err) { showToast(err.message, 'error'); }
  };

  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>차령조정 신청서를 불러오는 중…</div>;
  const current = selected === 'new' ? null : data.filings.find((f) => f._id === selected);
  const fresh = { filedAt: todayYmd(), status: '작성중', applicant: { ...data.defaults.applicant }, items: [], stamp: true, memo: '' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: '40vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.8rem', flexWrap: 'wrap' }}>
          <b>사업용자동차 차령조정 신청서</b>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>렌터카 차령을 연장할 때 검사 합격통지서와 함께 서울시에 냅니다(별지 제55호서식).</span>
          {data.candidates?.length > 0 && <span style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 700 }}>신청서에 아직 없는 차령 연장 검사 {data.candidates.length}대</span>}
          {canEdit && <button type="button" style={{ ...btn('primary'), marginLeft: 'auto' }} onClick={() => setSelected('new')}>+ 새 신청서</button>}
        </div>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead><tr>{['신청일', '상태', '대수', '차량', '처리', '메모'].map((h) => <th key={h} style={{ ...th, position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
          <tbody>
            {data.filings.map((f) => (
              <tr key={f._id} onClick={() => setSelected(f._id)} style={{ cursor: 'pointer', background: selected === f._id ? 'var(--bg-main)' : undefined }}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{ymd(f.filedAt)}</td>
                <td style={td}><Chip status={f.status} /></td>
                <td style={td}>{f.items.length}대</td>
                <td style={{ ...td, maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.items.map((it) => it.plateNo).join(', ')}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{ymd(f.processedAt)}</td>
                <td style={{ ...td, fontSize: '0.76rem', color: 'var(--text-muted)' }}>{f.memo}</td>
              </tr>
            ))}
            {!data.filings.length && <tr><td colSpan={6} style={{ ...td, color: 'var(--text-muted)' }}>신청서가 없습니다. [+ 새 신청서]로 만듭니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {selected === 'new' && <Editor key="new" filing={fresh} data={data} canEdit={canEdit} onSave={save} onStatus={setStatus} onDelete={remove} showToast={showToast} />}
      {current && <Editor key={`${current._id}-${current.updatedAt}`} filing={{ ...current, filedAt: ymd(current.filedAt) }} data={data} canEdit={canEdit} onSave={save} onStatus={setStatus} onDelete={remove} showToast={showToast} />}
    </div>
  );
}
