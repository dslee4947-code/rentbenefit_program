import { useState } from 'react';
import { garageAreasOf } from '../../../../shared/fleetFiling.js';
import { longTermCounts, sortLongTermList, SHORT_PARTY } from '../../../../shared/longTermList.js';

/**
 * 차고지 감면 (대표님 2026-11-25).
 * 공문은 지금 상황 그대로 내고 장기렌트 차량 명세를 붙인다. 감면 면적은 [구청 처리 완료]를 누를 때 적는다.
 */
const card = { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.1rem' };
const input = { padding: '0.3rem 0.45rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', background: 'var(--bg-surface)', color: 'var(--text-main)', width: '100%', boxSizing: 'border-box' };
const th = { padding: '0.4rem 0.4rem', fontSize: '0.75rem', fontWeight: 800, background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const td = { padding: '0.2rem 0.3rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem' };
const btn = (kind) => ({ padding: '0.35rem 0.8rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', border: kind ? 'none' : '1px solid var(--border-color)', background: kind === 'ok' ? '#15803d' : kind ? 'var(--primary)' : 'var(--bg-surface)', color: kind ? '#fff' : 'var(--text-main)' });

const FIELDS = [['party', '계약자', 150], ['bizNo', '사업자번호', 105], ['contractNo', '계약번호', 105], ['plateNo', '차량번호', 92], ['vin', '차대번호', 170], ['model', '차종', 190], ['start', '대여 시작', 98], ['end', '반납 예정', 98], ['months', '개월', 52], ['fee', '월대여료', 92]];

export function LongTermListCard({ api, rows, setRows, editable, showToast }) {
  const [busy, setBusy] = useState(false);
  const n = longTermCounts(rows);

  const fetchRows = async (url, options, ok) => {
    if (rows.length && !window.confirm('지금 목록을 새 목록으로 바꿉니다. 손으로 고친 내용은 없어집니다.')) return;
    setBusy(true);
    try {
      const r = await fetch(url, options);
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message);
      setRows(d.rows);
      showToast(`${ok} ${d.rows.length}대`, 'success');
    } catch (err) {
      showToast(err.message || '목록을 불러오지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const importFile = (file) => {
    const form = new FormData();
    form.append('file', file);
    return fetchRows(`${api}/long-term-list/import`, { method: 'POST', body: form }, '엑셀에서 읽었습니다.');
  };
  const setRow = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: k === 'months' || k === 'fee' ? Number(v.replace(/[^\d]/g, '')) || null : v } : r)));

  return (
    <div style={card}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 0.6rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <b style={{ fontSize: '0.9rem' }}>장기렌트 차량 명세</b>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{rows.length ? `장기렌트 ${n.long}대 · 계약 ${n.contracts}건 · 계약자 ${n.parties}곳${n.short ? ` · 단기렌트 ${n.short}대` : ''}` : '아직 비어 있습니다. 공문 뒤에 붙을 목록을 불러오세요.'}</span>
        {editable && (
          <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            <button type="button" style={btn('primary')} disabled={busy} onClick={() => fetchRows(`${api}/long-term-list`, undefined, '렌트차량 DB에서 불러왔습니다.')}>렌트차량 DB에서 불러오기</button>
            <label style={btn()}>정리한 엑셀 올리기
              <input type="file" accept=".xlsx,.xls" disabled={busy} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
            </label>
            {n.short > 0 && <button type="button" style={btn()} onClick={() => setRows(rows.filter((r) => !r.short))}>단기렌트 빼기</button>}
            {rows.length > 0 && <button type="button" style={btn()} onClick={() => setRows(sortLongTermList(rows))}>계약자별로 정렬</button>}
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <div style={{ overflow: 'auto', maxHeight: '45vh' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead><tr><th style={th}>No</th>{FIELDS.map(([k, label]) => <th key={k} style={th}>{label}</th>)}<th style={th}>단기</th><th style={th} /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={td}>{i + 1}</td>
                  {FIELDS.map(([k, label, w]) => <td key={k} style={{ ...td, minWidth: w }}><input aria-label={`${i + 1}번 ${label}`} style={input} disabled={!editable} value={k === 'fee' && r.fee ? Number(r.fee).toLocaleString() : r[k] ?? ''} onChange={(e) => setRow(i, k, e.target.value)} /></td>)}
                  <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" aria-label={`${i + 1}번 단기렌트`} disabled={!editable} checked={!!r.short} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, short: e.target.checked, party: e.target.checked ? SHORT_PARTY : x.party === SHORT_PARTY ? '' : x.party } : x)))} /></td>
                  <td style={td}>{editable && <button type="button" title="빼기" style={{ ...btn(), padding: '0.15rem 0.4rem' }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && <button type="button" style={{ ...btn(), marginTop: '0.4rem', fontSize: '0.78rem' }} onClick={() => setRows([...rows, { party: '', bizNo: '', contractNo: '', plateNo: '', vin: '', model: '', start: '', end: '', months: null, fee: null, short: false }])}>+ 빈 줄</button>}
    </div>
  );
}

/** [구청 처리 완료]를 누르면 나오는 창: 감면받은 면적을 적으면 다음 공문부터 그 면적으로 계산한다. */
export function GarageResultDialog({ garage, usedArea, onApply, onClose }) {
  const now = garageAreasOf(garage);
  const [v, setV] = useState({
    requiredArea: String(Math.round(usedArea)),
    rate: String(Math.round((Number(now.reductionRate) || 0) * 1000) / 10),
    reducedRequired: '',
    contractArea: String(now.contractArea)
  });
  const [busy, setBusy] = useState(false);
  const num = (s) => Number(String(s).replace(/,/g, ''));
  const byRate = Math.round(num(v.requiredArea) * (1 - num(v.rate) / 100));
  // 감면후 면적을 안 적으면 감면율로 계산한 값을 쓴다. 구청 알림의 숫자와 다르면 직접 적는다.
  const reduced = v.reducedRequired === '' ? byRate : num(v.reducedRequired);
  const required = num(v.requiredArea);
  const contract = num(v.contractArea);
  const bad = !(required > 0) || !(contract > 0) || !(reduced >= 0) || reduced > required || !(num(v.rate) >= 0 && num(v.rate) <= 100);
  const m = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString()}㎡` : '-');
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value.replace(/[^\d.]/g, '') });
  const apply = async () => {
    setBusy(true);
    try { await onApply({ requiredArea: required, reducedRequired: reduced, contractArea: contract, reductionRate: num(v.rate) / 100 }); } finally { setBusy(false); }
  };
  const row = (label, before, after) => <tr><td style={{ ...td, fontWeight: 700 }}>{label}</td><td style={{ ...td, textAlign: 'right' }}>{m(before)}</td><td style={{ ...td, textAlign: 'right' }}>{after}</td></tr>;
  const box = (k, placeholder) => <input inputMode="decimal" aria-label={k} style={{ ...input, width: '110px', textAlign: 'right' }} value={v[k]} placeholder={placeholder} onChange={set(k)} />;
  return (
    <div role="dialog" aria-modal="true" aria-label="차고지 감면 결과" className="no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ ...card, width: '460px', maxWidth: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <b>구청에서 감면받은 면적</b>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.3rem 0 0.7rem' }}>구청 처리 알림에 적힌 숫자를 넣으면 다음 공문부터 이 면적으로 계산합니다.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['', '지금', '감면 결과'].map((h, i) => <th key={i} style={{ ...th, position: 'static', textAlign: i ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {row('감면전 소요면적', now.requiredArea, box('requiredArea'))}
            <tr><td style={{ ...td, fontWeight: 700 }}>감면율(%)</td><td style={{ ...td, textAlign: 'right' }}>{Math.round(now.reductionRate * 1000) / 10}%</td><td style={{ ...td, textAlign: 'right' }}>{box('rate')}</td></tr>
            {row('감면후 소요면적', now.reducedRequired, box('reducedRequired', Number.isFinite(byRate) ? String(byRate) : ''))}
            {row('재계약(확보) 면적', now.contractArea, box('contractArea'))}
            {row('잔여면적', now.remaining, <b style={{ color: contract - reduced < 0 ? '#d9534f' : undefined }}>{m(contract - reduced)}</b>)}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.9rem' }}>
          <button type="button" style={btn()} disabled={busy} onClick={onClose}>닫기</button>
          <button type="button" style={btn('ok')} disabled={busy || bad} onClick={apply}>구청 처리 완료</button>
        </div>
      </div>
    </div>
  );
}
