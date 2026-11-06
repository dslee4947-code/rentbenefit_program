import { useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';
import { DOC_LABEL, READ_SOURCE, fieldsFromDoc, matchServiceTarget, readServiceDoc, saveServiceDoc } from './serviceDocs.js';

// 서버(utils/vehicleServicePlan.js)와 같은 값
const KINDS = ['자동차검사', '정기점검', '소모품교환', '고장수리', '사고수리', '기타'];
const won = (n) => `${Number(n || 0).toLocaleString()}원`;

/** 이 서류가 어디로 들어가는지 사람이 읽을 말 */
const targetText = (t) => {
  if (!t) return '새 기록으로 저장합니다';
  return t.status === '완료'
    ? `${t.date} ${t.kind} 기록에 서류를 붙입니다(같은 일이 두 번 잡히지 않게)`
    : `${t.date} ${t.kind} 일정(${t.status})을 완료로 바꿉니다`;
};

/**
 * 서류 올리기 (렌트 차량 AS, 대표님 2026-11-04).
 *
 * 수리 내역서·자동차검사 결과서를 여러 장 한꺼번에 올리면 글자를 읽어 차량번호로 차를 찾고, 날짜로 일정표의 일정을 찾아 준다.
 * 읽은 값은 줄마다 보여 주고 사람이 확인한 뒤 저장한다. 차를 못 찾았거나 다르게 읽은 칸은 여기서 고친다.
 *
 * @param {object} props
 * @param {object[]} props.rows 달력의 차 목록(고르기용)
 * @param {() => void} props.onClose 닫기
 * @param {() => void} props.onSaved 저장 뒤 목록·달력을 다시 읽는다
 * @param {(msg: string, type?: string) => void} props.showToast 안내
 */
export default function ServiceDocUpload({ rows, onClose, onSaved, showToast }) {
  const [items, setItems] = useState([]); // 파일 한 장에 한 줄
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);

  const update = (id, patch) => setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const setField = (id, patch) => setItems((cur) => cur.map((x) => (x.id === id ? { ...x, fields: { ...x.fields, ...patch } } : x)));

  /** 파일을 한 장씩 읽는다. 동시에 많이 보내면 글자 인식(OCR) 요청이 몰린다 */
  const addFiles = async (files) => {
    const added = files.map((file) => ({ id: nextId.current++, file, state: '읽는 중' }));
    setItems((cur) => [...cur, ...added]);
    setBusy(true);
    for (const it of added) {
      try {
        const data = await readServiceDoc(it.file);
        update(it.id, {
          state: '확인', source: data.source, parsed: data.parsed, kind: data.kind, target: data.target,
          vehicleId: data.vehicle?.vehicleId || '', vehicle: data.vehicle, fields: fieldsFromDoc(data)
        });
      } catch (err) {
        update(it.id, { state: '실패', message: err.message });
      }
    }
    setBusy(false);
  };

  /** 차·종류·날짜를 고치면 넣을 일정이 달라진다 */
  const rematch = async (it, patch) => {
    const next = { vehicleId: it.vehicleId, kind: it.kind, date: it.fields?.date, ...patch };
    if (!next.vehicleId) { update(it.id, { target: null }); return; }
    update(it.id, { target: await matchServiceTarget(next).catch(() => null) });
  };

  const ready = items.filter((x) => x.state === '확인' && x.vehicleId && x.fields?.date);
  const unready = items.filter((x) => x.state === '확인' && !(x.vehicleId && x.fields?.date));

  const saveAll = async () => {
    setBusy(true);
    let saved = 0;
    for (const it of ready) {
      update(it.id, { state: '저장 중' });
      try {
        const description = it.target?.hasDescription ? '' : it.fields.description; // 이미 적어 둔 작업 내용은 그대로 둔다
        const warn = await saveServiceDoc({
          vehicleId: it.vehicleId, recordId: it.target?.recordId, kind: it.kind,
          fields: { ...it.fields, description }, files: [it.file]
        });
        update(it.id, { state: '저장됨', message: warn });
        saved += 1;
      } catch (err) {
        update(it.id, { state: '확인', message: err.message });
      }
    }
    setBusy(false);
    if (saved) {
      showToast?.(`서류 ${saved}건을 저장했습니다. 달력에 반영했습니다.`, 'success');
      onSaved?.();
    }
  };

  const tryClose = () => {
    if (items.some((x) => x.state === '확인') && !window.confirm('아직 저장하지 않은 서류가 있습니다. 닫을까요?')) return;
    onClose();
  };

  const input = { width: '100%', padding: '0.35rem 0.45rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.8rem', boxSizing: 'border-box' };
  const lab = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.1rem' };
  const sortedRows = [...rows].sort((a, b) => String(a.plateNo).localeCompare(String(b.plateNo)));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1100, overflowY: 'auto', padding: '1.5rem 1rem' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto', background: 'var(--bg-main)', borderRadius: '12px', padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-bright)' }}>서류 올리기</div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>수리 내역서·자동차검사 결과서를 올리면 차와 일정을 찾아 내용을 채웁니다. 확인하고 저장하세요.</div>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'var(--primary)', color: '#fff', borderRadius: '7px', padding: '0.45rem 0.9rem', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer' }}>
            <FileUp size={15} /> 파일 고르기
            <input type="file" multiple accept=".pdf,.xlsx,.xls,image/*" style={{ display: 'none' }}
              onChange={(e) => { const picked = [...e.target.files]; e.target.value = ''; if (picked.length) addFiles(picked); }} />
          </label>
          <button type="button" onClick={tryClose} title="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
        </div>

        {items.length === 0 && (
          <div style={{ background: '#fff', border: '1px dashed var(--border-color)', borderRadius: '10px', padding: '1.5rem', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            PDF·사진(스캔)·엑셀을 여러 장 함께 고를 수 있습니다.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {items.map((it) => (
            <div key={it.id} data-doc-row style={{ background: '#fff', border: `1px solid ${it.state === '실패' ? '#fca5a5' : 'var(--border-color)'}`, borderRadius: '10px', padding: '0.6rem 0.7rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                <b style={{ overflowWrap: 'anywhere' }}>📎 {it.file.name}</b>
                {it.parsed && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{DOC_LABEL[it.parsed.docType]} · {READ_SOURCE[it.source] || it.source}로 읽음</span>}
                <span style={{ marginLeft: 'auto', fontWeight: 800, fontSize: '0.75rem', color: it.state === '실패' ? '#dc2626' : it.state === '저장됨' ? '#16a34a' : 'var(--text-muted)' }}>{it.state}</span>
                {!['읽는 중', '저장 중'].includes(it.state) && (
                  <button type="button" onClick={() => setItems((cur) => cur.filter((x) => x.id !== it.id))} title="이 줄 빼기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={14} /></button>
                )}
              </div>
              {it.message && <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.2rem' }}>{it.message}</div>}

              {it.state === '확인' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.35rem', marginTop: '0.4rem' }}>
                    <div style={{ gridColumn: 'span 2' }}>
                      <div style={lab}>차량{it.parsed.plateNo ? ` (서류: ${it.parsed.plateNo})` : ''}</div>
                      <select style={{ ...input, ...(it.vehicleId ? {} : { borderColor: '#dc2626' }) }} value={it.vehicleId}
                        onChange={(e) => { update(it.id, { vehicleId: e.target.value }); rematch(it, { vehicleId: e.target.value }); }}>
                        <option value="">차를 골라 주세요</option>
                        {/* 거래완료 차는 목록에 없다. 지난 서류를 올릴 때 찾은 차가 빈칸으로 보이지 않게 넣어 둔다 */}
                        {it.vehicle && !rows.some((r) => String(r.vehicleId) === String(it.vehicle.vehicleId)) && (
                          <option value={it.vehicle.vehicleId}>{it.vehicle.plateNo} · {it.vehicle.carModel} · {it.vehicle.partyName || '-'}</option>
                        )}
                        {sortedRows.map((r) => <option key={r.vehicleId} value={r.vehicleId}>{r.plateNo} · {r.carModel} · {r.partyName || '-'}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={lab}>종류</div>
                      <select style={input} value={it.kind} onChange={(e) => { update(it.id, { kind: e.target.value }); rematch(it, { kind: e.target.value }); }}>
                        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={lab}>날짜</div>
                      <input type="date" style={{ ...input, ...(it.fields.date ? {} : { borderColor: '#dc2626' }) }} value={it.fields.date}
                        onChange={(e) => { setField(it.id, { date: e.target.value }); rematch(it, { date: e.target.value }); }} />
                    </div>
                    <div>
                      <div style={lab}>주행거리(km)</div>
                      <MoneyInput style={input} value={it.fields.mileage} onChange={(e) => setField(it.id, { mileage: e.target.value })} />
                    </div>
                    <div>
                      <div style={lab}>금액(합계)</div>
                      <MoneyInput style={input} value={it.fields.amount} onChange={(e) => setField(it.id, { amount: e.target.value })} placeholder="0" />
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      <div style={lab}>{it.parsed.docType === 'inspection' ? '검사소' : '정비소·센터'}</div>
                      <input style={input} value={it.fields.shop} onChange={(e) => setField(it.id, { shop: e.target.value })} />
                    </div>
                  </div>
                  <div style={{ marginTop: '0.35rem' }}>
                    <div style={lab}>작업 내용</div>
                    <input style={input} value={it.fields.description} onChange={(e) => setField(it.id, { description: e.target.value })} />
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', marginTop: '0.35rem' }}>
                    → {it.vehicleId ? targetText(it.target) : '차를 고르면 넣을 일정을 찾습니다'}
                    {it.parsed.docType === 'repair' && it.parsed.total > 0 ? ` · 내역서 합계 ${won(it.parsed.total)}` : ''}
                    {it.parsed.nextDate ? ` · 다음 검사 ${it.parsed.nextDate}` : ''}
                  </div>
                  {(it.parsed.warnings || []).map((w) => <div key={w} style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.15rem' }}>⚠ {w}</div>)}
                </>
              )}
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {unready.length ? `차·날짜가 빠진 ${unready.length}건은 채워야 저장됩니다.` : '파일은 계약자 폴더의 차량번호 폴더에 저장됩니다.'}
            </span>
            <button type="button" onClick={tryClose} style={{ marginLeft: 'auto', border: '1px solid var(--border-color)', background: '#fff', borderRadius: '7px', padding: '0.45rem 0.9rem', fontWeight: 700, cursor: 'pointer' }}>닫기</button>
            <button type="button" onClick={saveAll} disabled={busy || !ready.length} style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: '7px', padding: '0.45rem 1.1rem', fontWeight: 800, cursor: busy ? 'wait' : 'pointer', opacity: busy || !ready.length ? 0.6 : 1 }}>
              {busy ? '처리 중…' : `${ready.length}건 저장`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
