import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FleetFilingDocs from './FleetFilingDocs.jsx';
import { makeA4PagesPdf } from '../../utils/printFit.js';
import { FILING_KINDS, filingSheetOf, defaultReasonOf, defaultRegistrationLabelOf, carTypeKey } from '../../../../shared/fleetFiling.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);
const API = `${API_HOST}/api/fleet-filings`;

/**
 * 영업 > 증차·감차 공문.
 *
 * 엑셀 "증차공문 서류_251013.xlsx"를 옮긴 화면(대표님 2026-10-30).
 * 차를 들이거나 빼면 구청에 변경등록신청서·신구사업대비표·매매계약서를 낸다. 여기서 바뀌는 차종과 대수만 적으면
 * 서류 세 가지가 엑셀과 같은 모양으로 만들어지고, 구청 처리 메일이 오면 [구청 처리 완료]로 신고 대수에 반영한다.
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
const tabBtn = (active) => ({ padding: '0.45rem 1rem', border: 'none', borderBottom: active ? '3px solid var(--primary)' : '3px solid transparent', background: 'none', fontWeight: active ? 800 : 600, color: active ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem' });

const STATUS_COLOR = { 작성중: '#6b7280', 제출: '#b45309', 처리완료: '#15803d', 취소: '#9ca3af' };
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const won = (n) => (Number(n) ? Math.round(n).toLocaleString() : '');
const parseWon = (s) => Number(String(s).replace(/[^\d]/g, '')) || '';

const emptyFiling = () => ({ filedAt: todayYmd(), kind: '증차·감차', reason: '', registrationLabel: '', items: [{ name: '', width: '', length: '', delta: 1, plates: '' }], contracts: [], memo: '', status: '작성중' });
const emptyContract = () => ({ maker: '현대', contractNo: '', model: '', color: '', price: '', deliveryFee: '', qty: '1대', deposit: '' });

// 지난 기록의 구분: 차종 줄이 있으면 그 부호, 구청 알림만 있으면 알림의 증차·감차 대수
const kindOfHistory = (f) => {
  if (f.items?.length) return f.items[0].delta > 0 ? '증차' : '감차';
  const n = f.notice || {};
  return [n.increase ? `증차 ${n.increase}` : '', n.decrease ? `감차 ${n.decrease}` : ''].filter(Boolean).join('·') || '변경';
};

const changeText = (items) => (items || []).map((it) => `${it.name} ${it.delta > 0 ? '+' : ''}${it.delta}`).join(', ');

function Kpi({ label, value, sub, color }) {
  return (
    <div style={card}>
      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function StatusChip({ status }) {
  return <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#fff', background: STATUS_COLOR[status] || '#6b7280', borderRadius: '10px', padding: '0.1rem 0.55rem', whiteSpace: 'nowrap' }}>{status}</span>;
}

/* ── 공문 편집 ─────────────────────────────────────────────── */

function FilingEditor({ info, filing, canEdit, onSave, onStatus, onDelete, onOpenNotice, showToast }) {
  const [draft, setDraft] = useState(filing);
  const [busy, setBusy] = useState(false);
  const docsRef = useRef(null);
  const locked = filing.applied || filing.status === '처리완료';
  const editable = canEdit && !locked;
  const sheet = useMemo(() => filingSheetOf(info, draft), [info, draft]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setItem = (i, patch) => setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const setContract = (i, patch) => setDraft((d) => ({ ...d, contracts: d.contracts.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  // 차종을 고르면 신구사업대비표의 재원을 채운다
  const pickType = (i, name) => {
    const t = info.carTypes.find((x) => carTypeKey(x.name) === carTypeKey(name));
    setItem(i, t ? { name, width: t.width, length: t.length } : { name });
  };

  const save = async () => {
    setBusy(true);
    try { await onSave(draft); } finally { setBusy(false); }
  };

  const pdf = async (open) => {
    // 창은 누른 순간 열어 둔다. PDF를 다 만든 뒤에 열면 팝업 차단에 걸린다.
    const win = open ? window.open('', '_blank') : null;
    setBusy(true);
    try {
      const pages = [...docsRef.current.querySelectorAll('.fleet-doc-page')];
      const blob = await makeA4PagesPdf(pages);
      const url = URL.createObjectURL(blob);
      if (win) {
        win.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `증차공문 서류_${ymd(draft.filedAt).slice(2).replace(/-/g, '')}(${(draft.items || []).map((it) => it.name).join(', ')}).pdf`;
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

  const status = filing.status;
  const nameList = info.carTypes.map((t) => t.name);
  const hasIncrease = sheet.increase > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <StatusChip status={status} />
        <b style={{ fontSize: '0.95rem' }}>{filing._id ? `${ymd(filing.filedAt)} 공문` : '새 공문'}</b>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>
          {sheet.beforeTotal}대 → <b style={{ color: 'var(--text-main)' }}>{sheet.afterTotal}대</b> (증차 {sheet.increase} · 감차 {Math.abs(sheet.decrease)})
          {filing.processedAt && ` · 구청 처리 ${ymd(filing.processedAt)}`}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {editable && <button type="button" style={btn('primary')} disabled={busy} onClick={save}>저장</button>}
          {canEdit && filing._id && status === '작성중' && <button type="button" style={btn()} disabled={busy} onClick={() => onStatus(filing, '제출')}>구청에 냄</button>}
          {canEdit && filing._id && status === '제출' && <button type="button" style={btn('ok')} disabled={busy} onClick={() => onStatus(filing, '처리완료')}>구청 처리 완료</button>}
          {canEdit && filing._id && status === '제출' && <button type="button" style={btn()} disabled={busy} onClick={() => onStatus(filing, '작성중')}>작성중으로</button>}
          {canEdit && filing._id && status === '처리완료' && <button type="button" style={btn()} disabled={busy} onClick={() => onStatus(filing, '제출')}>처리 완료 되돌리기</button>}
          <button type="button" style={btn()} disabled={busy} onClick={() => pdf(true)}>인쇄용 열기</button>
          <button type="button" style={btn()} disabled={busy} onClick={() => pdf(false)}>PDF 받기</button>
          {canEdit && filing._id && !filing.applied && <button type="button" style={btn('danger')} disabled={busy} onClick={() => onDelete(filing)}>삭제</button>}
        </span>
      </div>

      {(draft._id && JSON.stringify(draft) !== JSON.stringify(filing)) && editable && (
        <div style={{ fontSize: '0.8rem', color: '#b45309' }}>고친 내용이 아직 저장되지 않았습니다.</div>
      )}
      {filing.notice?.minwonNo && (
        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', fontSize: '0.84rem', borderColor: '#15803d' }}>
          <b style={{ color: '#15803d' }}>구청 처리 알림</b>
          <span>민원 {filing.notice.minwonNo} (신청 {ymd(filing.notice.appliedAt)}) · {filing.notice.noticeNo} 시행 {ymd(filing.notice.processedAt)} · {filing.notice.before}대 → {filing.notice.after}대</span>
          <span style={{ color: 'var(--text-muted)' }}>{filing.notice.summary}</span>
          {onOpenNotice && <button type="button" style={{ ...btn(), marginLeft: 'auto' }} onClick={() => onOpenNotice(filing._id)}>알림 PDF 열기</button>}
        </div>
      )}
      {locked && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>구청 처리가 끝나 대수가 신고 현황에 들어간 공문입니다. 고치려면 [처리 완료 되돌리기]를 먼저 누르세요.</div>}

      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.7rem' }}>
        <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>신청일
          <input type="date" style={input} disabled={!editable} value={ymd(draft.filedAt)} onChange={(e) => set({ filedAt: e.target.value })} />
        </label>
        <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>구분 (엑셀 시트)
          <select style={input} disabled={!editable} value={draft.kind} onChange={(e) => set({ kind: e.target.value })}>
            {FILING_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>변경등록내역 (대비표)
          <input style={input} disabled={!editable} value={draft.registrationLabel} placeholder={defaultRegistrationLabelOf(draft.kind, sheet.increase, sheet.decrease)} onChange={(e) => set({ registrationLabel: e.target.value })} />
        </label>
        <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>⑥ 변경 사유 (비우면 자동)
          <textarea rows={2} style={{ ...input, resize: 'vertical' }} disabled={!editable} value={draft.reason} placeholder={defaultReasonOf(draft.kind, sheet.increase, sheet.decrease)} onChange={(e) => set({ reason: e.target.value })} />
        </label>
        <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>메모
          <textarea rows={2} style={{ ...input, resize: 'vertical' }} disabled={!canEdit} value={draft.memo} onChange={(e) => set({ memo: e.target.value })} />
        </label>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
          <b style={{ fontSize: '0.9rem' }}>바뀌는 차종</b>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginLeft: '0.6rem' }}>늘리면 +, 줄이면 −. 표에 없는 차종은 이름과 가로·세로(m)를 적으면 대비표 끝에 새 줄로 들어갑니다.</span>
          {editable && <button type="button" style={{ ...btn(), marginLeft: 'auto' }} onClick={() => set({ items: [...draft.items, { name: '', width: '', length: '', delta: 1, plates: '' }] })}>+ 줄</button>}
        </div>
        <datalist id="fleet-car-types">{nameList.map((n, i) => <option key={`${n}-${i}`} value={n} />)}</datalist>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead><tr><th style={th}>차종</th><th style={th}>가로(m)</th><th style={th}>세로(m)</th><th style={th}>증감 대수</th><th style={th}>지금 신고</th><th style={th}>차량번호·메모</th><th style={th} /></tr></thead>
            <tbody>
              {draft.items.map((it, i) => {
                const t = info.carTypes.find((x) => carTypeKey(x.name) === carTypeKey(it.name));
                return (
                  <tr key={i}>
                    <td style={td}><input style={input} list="fleet-car-types" disabled={!editable} value={it.name} onChange={(e) => pickType(i, e.target.value)} placeholder="GV80(H)" /></td>
                    <td style={{ ...td, width: '90px' }}><input style={input} disabled={!editable} value={it.width ?? ''} onChange={(e) => setItem(i, { width: e.target.value })} /></td>
                    <td style={{ ...td, width: '90px' }}><input style={input} disabled={!editable} value={it.length ?? ''} onChange={(e) => setItem(i, { length: e.target.value })} /></td>
                    <td style={{ ...td, width: '90px' }}><input type="number" style={{ ...input, color: Number(it.delta) < 0 ? '#c00' : undefined, fontWeight: 700 }} disabled={!editable} value={it.delta} onChange={(e) => setItem(i, { delta: e.target.value === '' ? '' : Number(e.target.value) })} /></td>
                    <td style={{ ...td, width: '80px', color: 'var(--text-muted)' }}>{t ? `${t.count}대` : it.name ? '새 차종' : ''}</td>
                    <td style={td}><input style={input} disabled={!editable} value={it.plates || ''} onChange={(e) => setItem(i, { plates: e.target.value })} placeholder="감차할 차 번호 등" /></td>
                    <td style={{ ...td, width: '40px' }}>{editable && <button type="button" style={{ ...btn(), padding: '0.2rem 0.5rem' }} onClick={() => set({ items: draft.items.filter((_, j) => j !== i) })}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
          <b style={{ fontSize: '0.9rem' }}>자동차매매계약서</b>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginLeft: '0.6rem' }}>
            증차할 때 붙입니다(엑셀 '차량정보' 시트). 현대·기아 양식에 계약 내용과 회사 도장이 찍힙니다.{!hasIncrease && ' 지금은 증차가 없어 서류에 넣지 않습니다.'}
          </span>
          {editable && <button type="button" style={{ ...btn(), marginLeft: 'auto' }} onClick={() => set({ contracts: [...draft.contracts, emptyContract()] })}>+ 계약서</button>}
        </div>
        {draft.contracts.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>붙인 계약서가 없습니다.</div>}
        {draft.contracts.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1.1fr 2.4fr 1.6fr 1fr 0.8fr 0.6fr 0.9fr 36px', gap: '0.4rem', alignItems: 'end', marginBottom: '0.4rem', fontSize: '0.74rem', fontWeight: 700 }}>
            <label>제조사<select style={input} disabled={!editable} value={c.maker} onChange={(e) => setContract(i, { maker: e.target.value })}><option>현대</option><option>기아</option></select></label>
            <label>계약번호<input style={input} disabled={!editable} value={c.contractNo} onChange={(e) => setContract(i, { contractNo: e.target.value })} /></label>
            <label>차종/선택사양<input style={input} disabled={!editable} value={c.model} onChange={(e) => setContract(i, { model: e.target.value })} /></label>
            <label>색상(외장/내장)<input style={input} disabled={!editable} value={c.color} onChange={(e) => setContract(i, { color: e.target.value })} /></label>
            <label>차량가격<input style={input} disabled={!editable} value={won(c.price)} onChange={(e) => setContract(i, { price: parseWon(e.target.value) })} /></label>
            <label>탁송료<input style={input} disabled={!editable} value={won(c.deliveryFee)} onChange={(e) => setContract(i, { deliveryFee: parseWon(e.target.value) })} /></label>
            <label>대수<input style={input} disabled={!editable} value={c.qty} onChange={(e) => setContract(i, { qty: e.target.value })} /></label>
            <label>계약금<input style={input} disabled={!editable} value={won(c.deposit)} onChange={(e) => setContract(i, { deposit: parseWon(e.target.value) })} /></label>
            {editable ? <button type="button" style={{ ...btn(), padding: '0.35rem 0.4rem' }} onClick={() => set({ contracts: draft.contracts.filter((_, j) => j !== i) })}>✕</button> : <span />}
          </div>
        ))}
      </div>

      <div style={{ ...card, background: 'var(--bg-main)' }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 800, marginBottom: '0.6rem' }}>
          구청에 낼 서류 미리보기 <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>— 신청서 · 신구사업대비표{hasIncrease && draft.contracts.length ? ` · 매매계약서 ${draft.contracts.length}장` : ''}. [인쇄용 열기]로 인쇄하거나 [PDF 받기]로 저장합니다.</span>
        </div>
        <div ref={docsRef} style={{ display: 'flex', flexDirection: 'column', gap: '18px', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '6px' }}>
          <FleetFilingDocs info={info} filing={draft} />
        </div>
      </div>
    </div>
  );
}

/* ── 차종별 신고 대수 ───────────────────────────────────────── */

function CarTypesPanel({ info, canEdit, onSaveInfo }) {
  const [rows, setRows] = useState(info.carTypes);
  const [q, setQ] = useState('');
  const total = rows.reduce((s, t) => s + (Number(t.count) || 0), 0);
  const area = rows.reduce((s, t) => s + (Number(t.width) || 0) * (Number(t.length) || 0) * (Number(t.count) || 0), 0);
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(info.carTypes);
  const words = q.trim().toLowerCase();
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <b>신구사업대비표 차종 {rows.length}개 · {total}대 · 사용면적 {Math.round(area).toLocaleString()}㎡</b>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>대수는 공문을 [구청 처리 완료]로 바꾸면 저절로 바뀝니다. 여기서는 엑셀과 다를 때만 바로잡습니다.</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="차종 찾기" style={{ ...input, width: '140px', marginLeft: 'auto' }} />
        {canEdit && <button type="button" style={btn()} onClick={() => setRows([...rows, { name: '', width: '', length: '', count: 0 }])}>+ 차종</button>}
        {canEdit && <button type="button" style={btn('primary')} disabled={!dirty} onClick={() => onSaveInfo({ carTypes: rows })}>저장</button>}
      </div>
      <div style={{ overflow: 'auto', maxHeight: '65vh' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead><tr>{['차종', '가로(m)', '세로(m)', '신고 대수', '사용면적(㎡)', ''].map((h) => <th key={h} style={{ ...th, position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((t, i) => (!words || String(t.name).toLowerCase().includes(words)) && (
              <tr key={i} style={{ opacity: Number(t.count) ? 1 : 0.55 }}>
                <td style={td}><input style={input} disabled={!canEdit} value={t.name} onChange={(e) => setRow(i, { name: e.target.value })} /></td>
                <td style={{ ...td, width: '100px' }}><input style={input} disabled={!canEdit} value={t.width} onChange={(e) => setRow(i, { width: e.target.value })} /></td>
                <td style={{ ...td, width: '100px' }}><input style={input} disabled={!canEdit} value={t.length} onChange={(e) => setRow(i, { length: e.target.value })} /></td>
                <td style={{ ...td, width: '90px' }}><input type="number" style={{ ...input, fontWeight: 700 }} disabled={!canEdit} value={t.count} onChange={(e) => setRow(i, { count: e.target.value })} /></td>
                <td style={{ ...td, textAlign: 'right', width: '110px' }}>{((Number(t.width) || 0) * (Number(t.length) || 0) * (Number(t.count) || 0)).toFixed(3)}</td>
                <td style={{ ...td, width: '40px' }}>{canEdit && <button type="button" style={{ ...btn(), padding: '0.2rem 0.5rem' }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── 기본 정보 ─────────────────────────────────────────────── */

function InfoPanel({ info, canEdit, onSaveInfo }) {
  const [company, setCompany] = useState(info.company);
  const [garage, setGarage] = useState(info.garage);
  const field = (label, value, onChange) => (
    <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>{label}<input style={input} disabled={!canEdit} value={value ?? ''} onChange={(e) => onChange(e.target.value)} /></label>
  );
  const reduction = (Number(garage.requiredArea) || 0) * (Number(garage.reductionRate) || 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.7rem' }}>
        <b style={{ gridColumn: '1 / -1' }}>신청서 (엑셀 '증차' 시트)</b>
        {field('③ 법인명', company.name, (v) => setCompany({ ...company, name: v }))}
        {field('법인명 옆 전화', company.phone, (v) => setCompany({ ...company, phone: v }))}
        {field('④ 주소', company.address, (v) => setCompany({ ...company, address: v }))}
        {field('주소 옆 전화', company.officePhone, (v) => setCompany({ ...company, officePhone: v }))}
        {field('대비표 주사무소', company.officeAddress, (v) => setCompany({ ...company, officeAddress: v }))}
      </div>
      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.7rem' }}>
        <b style={{ gridColumn: '1 / -1' }}>차고지 (대비표 위쪽 표와 오른쪽 면적 계산)</b>
        {field('위치', garage.location, (v) => setGarage({ ...garage, location: v }))}
        {field('규모(㎡)', garage.area, (v) => setGarage({ ...garage, area: v }))}
        {field('감면전 소요면적(㎡)', garage.requiredArea, (v) => setGarage({ ...garage, requiredArea: v }))}
        {field('감면율 (0.9 = 90%)', garage.reductionRate, (v) => setGarage({ ...garage, reductionRate: v }))}
        {field('재계약 면적(㎡)', garage.contractArea, (v) => setGarage({ ...garage, contractArea: v }))}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'end' }}>
          감면 면적 {Math.round(reduction)}㎡ · 감면후 소요면적 {Math.round((Number(garage.requiredArea) || 0) - reduction)}㎡ · 잔여면적 {Math.round((Number(garage.contractArea) || 0) - ((Number(garage.requiredArea) || 0) - reduction))}㎡
        </div>
      </div>
      {canEdit && <div><button type="button" style={btn('primary')} onClick={() => onSaveInfo({ company, garage })}>저장</button></div>}
    </div>
  );
}

/* ── 화면 ─────────────────────────────────────────────────── */

function FleetFilingView({ showToast, currentUser }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('filings');
  const [selected, setSelected] = useState(null); // 공문 id 또는 'new'
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef(null);
  const noticeRef = useRef(null);
  const [noticePick, setNoticePick] = useState(null); // 맞는 공문을 못 고른 구청 알림 { file, notice, candidates, message }
  const canEdit = currentUser?.role && currentUser.role !== 'viewer';

  const load = useCallback(() => fetch(API)
    .then((r) => r.json())
    .then((d) => { if (!d.success) throw new Error(d.message); setData(d); return d; })
    .catch((err) => showToast(err.message || '증차·감차 공문을 불러오지 못했습니다.', 'error')), [showToast]);

  useEffect(() => { load(); }, [load]);

  const call = async (url, method, body) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.message || '처리하지 못했습니다.');
    return d;
  };

  const saveFiling = async (draft) => {
    try {
      const d = draft._id ? await call(`${API}/${draft._id}`, 'PUT', draft) : await call(API, 'POST', draft);
      showToast('공문을 저장했습니다.', 'success');
      await load();
      setSelected(d.filing._id);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const setStatus = async (filing, status) => {
    const ask = {
      제출: '구청에 낸 공문으로 표시합니다. 지금 신고 대수가 이 공문에 찍혀, 나중에 다시 뽑아도 같은 서류가 나옵니다.',
      처리완료: `구청 처리가 끝났다고 표시하고 신고 대수에 ${changeText(filing.items)}를 반영합니다.`,
      작성중: '작성중으로 되돌립니다.'
    }[status] || `${status}(으)로 바꿉니다.`;
    if (!window.confirm(ask)) return;
    try {
      await call(`${API}/${filing._id}/status`, 'POST', { status });
      showToast(`공문을 '${status}'(으)로 바꿨습니다.`, 'success');
      await load();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const remove = async (filing) => {
    if (!window.confirm('이 공문을 지웁니다.')) return;
    try {
      await call(`${API}/${filing._id}`, 'DELETE');
      setSelected(null);
      await load();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const saveInfo = async (patch) => {
    try {
      await call(`${API}/info`, 'PUT', patch);
      showToast('신고 현황을 저장했습니다.', 'success');
      await load();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const upload = async (file) => {
    if (!file) return;
    if (!window.confirm(`${file.name}\n증차공문 엑셀이면 차종·재원·신고 대수·차고지·법인 정보를 엑셀 값으로 바꿉니다(이전 값은 백업). 구청 등록현황 엑셀이면 지난 처리 기록을 옮깁니다.`)) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await fetch(`${API}/import`, { method: 'POST', body: form });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message);
      const { result } = d;
      showToast(`엑셀을 올렸습니다. ${result.carTypes ? `차종 ${result.carTypes}개 ${result.total}대` : ''}${result.draft ? ' · 엑셀에 적힌 변경으로 공문 초안' : ''}${result.history ? ` · 지난 기록 ${result.history}건` : ''}`, 'success');
      await load();
      if (result.draft) { setTab('filings'); setSelected(result.draft); }
    } catch (err) {
      showToast(err.message || '엑셀을 읽지 못했습니다.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // 구청 "변경등록신청 처리 알림" PDF → 맞는 공문을 처리 완료로 바꾸고 신고 대수에 반영
  const uploadNotice = async (file, extra = {}) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    Object.entries(extra).forEach(([k, v]) => form.append(k, v));
    try {
      const r = await fetch(`${API}/notice`, { method: 'POST', body: form });
      const d = await r.json();
      if (d.needPick) { setNoticePick({ file, notice: d.notice, candidates: d.candidates || [], message: d.message }); return; }
      if (!r.ok || !d.success) throw new Error(d.message);
      const { result } = d;
      setNoticePick(null);
      const n = result.notice;
      if (result.replaced) showToast(`같은 민원(${n.minwonNo})의 다시 온 알림이라 파일만 바꿨습니다.`, 'success');
      else if (result.applied) showToast(`구청 처리 알림을 반영했습니다. 민원 ${n.minwonNo} · ${n.before}대 → ${n.after}대 · 신고 대수 ${result.registered}대`, 'success');
      else showToast(`구청 처리 알림을 기록했습니다 (민원 ${n.minwonNo}). 신고 대수는 바꾸지 않았습니다.`, 'success');
      if (result.mismatch) showToast(`구청 알림은 ${result.mismatch.notice}대인데 프로그램 신고 대수는 ${result.mismatch.program}대입니다. 차종별 신고 대수를 확인해 주세요.`, 'error');
      await load();
      setTab('filings');
      setSelected(result.filingId);
    } catch (err) {
      showToast(err.message || '구청 처리 알림을 읽지 못했습니다.', 'error');
    } finally {
      if (noticeRef.current) noticeRef.current.value = '';
    }
  };

  const openNotice = async (id) => {
    // 창은 누른 순간 열어 둔다(파일을 받은 뒤 열면 팝업 차단에 걸린다)
    const win = window.open('', '_blank');
    try {
      const r = await fetch(`${API}/${id}/notice`);
      if (!r.ok) throw new Error('구청 처리 알림 파일을 열지 못했습니다.');
      const url = URL.createObjectURL(await r.blob());
      win.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      win?.close();
      showToast(err.message, 'error');
    }
  };

  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>증차·감차 공문을 불러오는 중…</div>;

  const { info, filings, vehicleStats = {} } = data;
  const registered = info.carTypes.reduce((s, t) => s + (Number(t.count) || 0), 0);
  const pending = filings.filter((f) => f.status === '제출');
  const drafts = filings.filter((f) => f.status === '작성중');
  const g = filingSheetOf(info, {}).garage;
  const running = (vehicleStats['장기렌트'] || 0) + (vehicleStats['단기렌트'] || 0) + (vehicleStats['재고'] || 0);
  const pendingNet = pending.reduce((s, f) => s + (f.items || []).reduce((a, it) => a + (Number(it.delta) || 0), 0), 0);

  const own = filings.filter((f) => !f.source);
  const imported = filings.filter((f) => f.source);
  const current = selected === 'new' ? null : filings.find((f) => f._id === selected);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.7rem' }}>
        <Kpi label="구청 신고 대수" value={`${registered}대`} sub={`차종 ${info.carTypes.filter((t) => Number(t.count)).length}개${pendingNet ? ` · 처리되면 ${registered + pendingNet}대` : ''}`} />
        <Kpi label="구청 처리 기다림" value={`${pending.length}건`} sub={pending.length ? pending.map((f) => changeText(f.items)).join(' / ') : '낸 공문이 모두 처리됨'} color={pending.length ? '#b45309' : undefined} />
        <Kpi label="작성 중" value={`${drafts.length}건`} sub="아직 구청에 안 낸 공문" />
        <Kpi label="차고지 잔여면적" value={`${Math.round(g.remaining)}㎡`} sub={`재계약 ${g.contractArea}㎡ · 감면후 소요 ${Math.round(g.reducedRequired)}㎡`} color={g.remaining < 0 ? '#d9534f' : undefined} />
        <Kpi label="렌트차량 DB 운용 중" value={`${running}대`} sub={`장기 ${vehicleStats['장기렌트'] || 0} · 단기 ${vehicleStats['단기렌트'] || 0} · 재고 ${vehicleStats['재고'] || 0}${vehicleStats['계약중'] ? ` · 출고 전 ${vehicleStats['계약중']}대(증차 대상)` : ''}`} />
      </div>

      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
        <button type="button" style={tabBtn(tab === 'filings')} onClick={() => setTab('filings')}>공문 {own.length}</button>
        <button type="button" style={tabBtn(tab === 'types')} onClick={() => setTab('types')}>차종별 신고 대수</button>
        <button type="button" style={tabBtn(tab === 'info')} onClick={() => setTab('info')}>법인·차고지</button>
        {canEdit && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', paddingBottom: '0.3rem' }}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
            <button type="button" style={btn()} onClick={() => fileRef.current?.click()}>엑셀 올리기</button>
            <input ref={noticeRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => uploadNotice(e.target.files?.[0])} />
            <button type="button" style={btn('ok')} onClick={() => noticeRef.current?.click()}>구청 처리 알림 올리기</button>
            <button type="button" style={btn('primary')} onClick={() => { setTab('filings'); setSelected('new'); }}>+ 새 공문</button>
          </span>
        )}
      </div>

      {noticePick && (
        <div style={{ ...card, borderColor: '#b45309' }}>
          <div style={{ fontWeight: 800, marginBottom: '0.3rem' }}>구청 처리 알림: 민원 {noticePick.notice.minwonNo} · 처리 {ymd(noticePick.notice.processedAt)} · {noticePick.notice.before}대 → {noticePick.notice.after}대</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{noticePick.notice.summary}</div>
          <div style={{ fontSize: '0.84rem', marginBottom: '0.6rem', color: '#b45309' }}>{noticePick.message}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {noticePick.candidates.map((c) => (
              <button key={c._id} type="button" style={btn()} onClick={() => uploadNotice(noticePick.file, { filingId: c._id })}>
                {ymd(c.filedAt)} {c.status} · {changeText(c.items)} ({c.beforeTotal} → {c.afterTotal}) 공문에 반영
              </button>
            ))}
            <button type="button" style={btn()} onClick={() => uploadNotice(noticePick.file, { mode: 'history' })}>공문 없이 기록만 남기기 (대수는 그대로)</button>
            <button type="button" style={btn()} onClick={() => setNoticePick(null)}>닫기</button>
          </div>
        </div>
      )}

      {tab === 'filings' && (
        <>
          <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: '40vh' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead><tr>{['신청일', '상태', '구분', '바뀌는 차종', '대수', '구청 처리', '메모'].map((h) => <th key={h} style={{ ...th, position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
              <tbody>
                {[...own, ...(showHistory ? imported : [])].map((f) => (
                  <tr key={f._id} onClick={() => !f.source && setSelected(f._id)} style={{ cursor: f.source ? 'default' : 'pointer', background: selected === f._id ? 'var(--bg-main)' : undefined, color: f.source ? 'var(--text-muted)' : undefined }}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{ymd(f.filedAt)}</td>
                    <td style={td}><StatusChip status={f.status} /></td>
                    <td style={td}>{f.source ? kindOfHistory(f) : f.kind}</td>
                    <td style={td}>{f.items?.length ? changeText(f.items) : f.notice?.summary?.replace(/^○\s*주사무소\s*/, '')}{f.items?.some((it) => it.plates) && <span style={{ color: 'var(--text-muted)' }}> ({f.items.map((it) => it.plates).filter(Boolean).join(', ')})</span>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{f.beforeTotal ?? '?'} → <b>{f.afterTotal ?? '?'}</b></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {ymd(f.processedAt)}
                      {f.notice?.minwonNo && (
                        <button type="button" title={`민원 ${f.notice.minwonNo} · ${f.notice.fileName || ''}`} style={{ ...btn(), padding: '0.1rem 0.45rem', fontSize: '0.72rem', marginLeft: '0.4rem' }} onClick={(e) => { e.stopPropagation(); openNotice(f._id); }}>알림 PDF</button>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: '0.76rem', color: 'var(--text-muted)' }}>{f.source ? `${f.source}` : f.memo}</td>
                  </tr>
                ))}
                {!own.length && !showHistory && <tr><td colSpan={7} style={{ ...td, color: 'var(--text-muted)' }}>공문이 없습니다. [+ 새 공문]으로 만듭니다.</td></tr>}
              </tbody>
            </table>
            {imported.length > 0 && (
              <div style={{ padding: '0.5rem 0.8rem' }}>
                <button type="button" style={{ ...btn(), fontSize: '0.78rem' }} onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? '지난 구청 처리 기록 숨기기' : `지난 구청 처리 기록 ${imported.length}건 보기 (엑셀 등록현황·구청 알림)`}
                </button>
              </div>
            )}
          </div>

          {selected === 'new' && (
            <FilingEditor key="new" info={info} filing={emptyFiling()} canEdit={canEdit} onSave={saveFiling} onStatus={setStatus} onDelete={remove} showToast={showToast} />
          )}
          {current && (
            <FilingEditor key={`${current._id}-${current.updatedAt}`} info={info} filing={{ ...current, filedAt: ymd(current.filedAt) }} canEdit={canEdit} onSave={saveFiling} onStatus={setStatus} onDelete={remove} onOpenNotice={openNotice} showToast={showToast} />
          )}
        </>
      )}

      {tab === 'types' && <CarTypesPanel key={data.info.updatedAt} info={info} canEdit={canEdit} onSaveInfo={saveInfo} />}
      {tab === 'info' && <InfoPanel key={data.info.updatedAt} info={info} canEdit={canEdit} onSaveInfo={saveInfo} />}
    </div>
  );
}

export default FleetFilingView;
