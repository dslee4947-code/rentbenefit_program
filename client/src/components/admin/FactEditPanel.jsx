import { RotateCcw } from 'lucide-react';
import { FACT_PARTY_FIELDS, FACT_VEHICLE_GROUPS, factValueOf } from '../../utils/factDocs.js';

/**
 * 계약사실 증명원 내용 고치기 (2026-11-19 대표님).
 *
 * 계약을 불러오면 DB 값이 칸마다 들어가 있고, 그대로 고쳐 쓴다. 고친 칸은 노랗게, 비어 있는 칸은 빨갛게 보인다.
 * 칸을 비우면 DB 값으로 돌아간다. 고친 값은 계약에 따로 저장되어 다음에 열어도 남는다(렌트차량 DB는 바꾸지 않는다).
 *
 * @param {{ open: object, docs: object[], edits: {party:object, vehicles:object}, onChange: Function, disabled?: boolean }} props
 *   open = 서버 원래 값, docs = 지금 고른 차(원래 값), edits = 고친 값
 */
export default function FactEditPanel({ open, docs, edits, onChange, disabled }) {
  const setParty = (k, v) => onChange({ ...edits, party: { ...edits.party, [k]: v } });
  const setVehicle = (id, k, v) => onChange({ ...edits, vehicles: { ...edits.vehicles, [id]: { ...(edits.vehicles?.[id] || {}), [k]: v } } });

  const editedCount = Object.values(edits.party || {}).filter((v) => v !== undefined && v !== '').length
    + Object.values(edits.vehicles || {}).reduce((s, o) => s + Object.values(o || {}).filter((v) => v !== undefined && v !== '').length, 0);

  return (
    <details open style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem 0.6rem' }}>
      <summary style={{ fontWeight: 800, cursor: 'pointer' }}>
        ✏️ 증명원 내용 고치기 {editedCount > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}>· {editedCount}칸 고침</span>}
      </summary>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.35rem 0 0.5rem', lineHeight: 1.5 }}>
        불러온 값을 그대로 고치면 오른쪽 서류에 바로 들어갑니다. <span style={{ background: '#fef3c7', padding: '0 3px' }}>노란 칸</span>은 고친 칸,
        <span style={{ background: '#fee2e2', padding: '0 3px', marginLeft: '2px' }}>빨간 칸</span>은 비어 있는 칸입니다.
        고친 값은 이 계약에 저장되고 렌트차량 DB는 바뀌지 않습니다.
      </div>

      <div style={{ fontWeight: 700, margin: '0.3rem 0' }}>고객 정보</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {FACT_PARTY_FIELDS.map(([k, label]) => (
          <Row
            key={k}
            label={k === 'bizNo' ? (open.party.bizNoLabel || label) : label}
            base={String(open.party[k] || '')}
            value={edits.party?.[k]}
            onSet={(v) => setParty(k, v)}
            disabled={disabled}
            wide={k === 'address'}
          />
        ))}
      </div>

      {docs.map((d) => (
        <details key={d.vehicleId} open={docs.length === 1} style={{ marginTop: '0.6rem' }}>
          <summary style={{ fontWeight: 700, cursor: 'pointer' }}>{d.plateNo || d.code || '(번호 없음)'} · {d.carModel}</summary>
          {FACT_VEHICLE_GROUPS.map(([group, fields]) => (
            <div key={group}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary)', margin: '0.5rem 0 0.25rem' }}>{group}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {fields.map(([k, label]) => (
                  <Row
                    key={k}
                    label={label}
                    base={factValueOf(d, k)}
                    value={edits.vehicles?.[d.vehicleId]?.[k]}
                    onSet={(v) => setVehicle(d.vehicleId, k, v)}
                    disabled={disabled}
                    wide={k === 'options' || k === 'carModel'}
                  />
                ))}
              </div>
            </div>
          ))}
        </details>
      ))}
    </details>
  );
}

function Row({ label, base, value, onSet, wide, disabled }) {
  const edited = value !== undefined && value !== '' && value !== base;
  const empty = !base && !edited;
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '84px 1fr 18px', alignItems: wide ? 'start' : 'center', gap: '0.3rem' }}>
      <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', paddingTop: wide ? '0.35rem' : 0 }}>{label}</span>
      {wide ? (
        <textarea
          rows={2}
          value={value !== undefined ? value : base}
          placeholder={empty ? '비어 있음 — 직접 넣기' : `비우면 원래 값(${base})`}
          onChange={(e) => onSet(e.target.value)}
          disabled={disabled}
          style={fieldStyle(edited, empty)}
        />
      ) : (
        <input
          value={value !== undefined ? value : base}
          placeholder={empty ? '비어 있음 — 직접 넣기' : `비우면 원래 값(${base})`}
          onChange={(e) => onSet(e.target.value)}
          disabled={disabled}
          style={fieldStyle(edited, empty)}
        />
      )}
      {edited ? (
        <button type="button" title={`원래 값으로: ${base || '(비어 있음)'}`} onClick={() => onSet(undefined)} disabled={disabled} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b45309', padding: 0 }}>
          <RotateCcw size={13} />
        </button>
      ) : <span />}
    </label>
  );
}

const fieldStyle = (edited, empty) => ({
  width: '100%',
  padding: '0.32rem 0.45rem',
  border: `1px solid ${edited ? '#f59e0b' : empty ? '#fca5a5' : 'var(--border-color)'}`,
  background: edited ? '#fef3c7' : empty ? '#fee2e2' : '#fff',
  borderRadius: '5px',
  fontSize: '0.78rem',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  resize: 'vertical'
});
