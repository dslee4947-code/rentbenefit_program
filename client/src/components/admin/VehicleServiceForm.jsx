import { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';
import CarDamageMap from './CarDamageMap.jsx';
import { ACTIONS, ACTION_COLOR } from './carDamageZones.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 서버(utils/vehicleServicePlan.js, models/VehicleService.js)와 같은 값
const KINDS = ['자동차검사', '정기점검', '소모품교환', '고장수리', '사고수리', '기타'];
const STATUSES = ['예정', '입고', '수리 중', '완료'];
const METHODS = ['직원', '외주 탁송', '센터 픽업·딜리버리', '고객 직접'];
const PAYERS = ['자차 보험', '상대방 보험', '보증·리콜(무상)', '회사 부담', '고객 부담'];
const FUELS = ['', '바닥', '1/4', '1/2', '3/4', '가득'];
const CONSUMABLES = ['엔진오일·오일필터', '에어필터', '에어컨 필터', '브레이크 패드(앞)', '브레이크 패드(뒤)', '브레이크 오일', '타이어', '와이퍼', '배터리', '냉각수'];

const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;
const won = (n) => `${Math.round(n).toLocaleString()}원`;

/** Date → datetime-local 값(한국 시간) */
const toLocalInput = (d) => {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const k = new Date(t.getTime() - t.getTimezoneOffset() * 60000);
  return k.toISOString().slice(0, 16);
};

const emptyLeg = (method = '직원') => ({ method, from: '', to: '', distanceKm: '', vendor: '', fee: '' });

/**
 * @param {object|null} record 고칠 기록
 * @param {{kind: string, date: string}} [preset] 달력 빈칸을 눌러 새로 적을 때. 앞날이면 '예정'으로 입고 날에, 지난 날·오늘이면 '완료'로 출고 날에 넣는다.
 */
const formOf = (record, preset) => {
  if (!record) {
    const future = preset?.date && preset.date > new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    return {
      kind: preset?.kind || '정기점검', status: future ? '예정' : '완료', staff: '', shop: '',
      inAt: future ? `${preset.date}T10:00` : '', outAt: preset?.date && !future ? `${preset.date}T18:00` : '', mileageIn: '', mileageOut: '', fuelIn: '', fuelOut: '',
      transport: { in: emptyLeg(), out: emptyLeg() },
      payer: '', insurer: '', claimNo: '', fault: '', deductible: '', loaner: '',
      costs: { repair: '', vat: '', insurancePaid: '' },
      request: '', description: '', memo: '', parts: [], consumables: []
    };
  }
  const leg = (l) => ({ ...emptyLeg(l?.method || ''), ...Object.fromEntries(Object.entries(l || {}).map(([k, v]) => [k, v ?? ''])) });
  return {
    kind: record.kind, status: record.status || '완료', staff: record.staff || '', shop: record.shop || '',
    // 예전 간단 양식 기록은 입고·출고 시각이 없다. 날짜를 출고로 보여 준다.
    inAt: toLocalInput(record.inAt), outAt: toLocalInput(record.outAt || (!record.inAt ? record.date : null)),
    mileageIn: record.mileageIn ?? '', mileageOut: record.mileageOut ?? (record.mileageIn ? '' : record.mileage ?? ''),
    fuelIn: record.fuelIn || '', fuelOut: record.fuelOut || '',
    transport: { in: leg(record.transport?.in), out: leg(record.transport?.out) },
    payer: record.payer || '', insurer: record.insurer || '', claimNo: record.claimNo || '', fault: record.fault || '',
    deductible: record.deductible ?? '', loaner: record.loaner || '',
    costs: { repair: record.costs?.repair ?? (record.costs ? '' : record.amount || ''), vat: record.costs?.vat ?? '', insurancePaid: record.costs?.insurancePaid ?? '' },
    request: record.request || '', description: record.description || '', memo: record.memo || '',
    parts: record.parts || [], consumables: record.consumables || []
  };
};

/**
 * 정비·수리 한 건 상세 입력 (테스트판, 2026-10).
 * 시안: docs/mockups/vehicle-service-form-v1.html
 *
 * 아직 하지 않는 것(다음 단계): 원장 자동 기록, 수리 내역서 글자 읽기, 지도 API 거리 자동 계산.
 *
 * @param {object} props
 * @param {object} props.row 차량 한 줄(서버 rowOf: checks, usage, notices 포함)
 * @param {object|null} props.record 고칠 기록. 없으면 새로 적는다
 * @param {{kind: string, date: string}} [props.preset] 달력에서 날짜·종류를 골라 열 때
 * @param {{year:number, perKm:number}[]} props.transportRates 해마다 외주 탁송 km당 단가
 */
export default function VehicleServiceForm({ row, record, preset, transportRates = [], onClose, onSaved, showToast }) {
  const [form, setForm] = useState(() => formOf(record, preset));
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setLeg = (side, patch) => setForm((f) => ({ ...f, transport: { ...f.transport, [side]: { ...f.transport[side], ...patch } } }));
  const setCost = (patch) => setForm((f) => ({ ...f, costs: { ...f.costs, ...patch } }));

  const togglePart = (zone) => setForm((f) => {
    const cur = f.parts.find((p) => p.zone === zone);
    const next = cur ? ACTIONS[ACTIONS.indexOf(cur.action) + 1] : ACTIONS[0];
    const rest = f.parts.filter((p) => p.zone !== zone);
    return { ...f, parts: next ? [...rest, { zone, action: next, memo: cur?.memo || '' }] : rest };
  });
  const toggleConsumable = (c) => setForm((f) => ({
    ...f, consumables: f.consumables.includes(c) ? f.consumables.filter((x) => x !== c) : [...f.consumables, c]
  }));

  // ── 자동 계산
  const days = form.inAt && form.outAt ? Math.max(0, Math.round((new Date(form.outAt) - new Date(form.inAt)) / 86400000)) : null;
  const moved = num(form.mileageOut) && num(form.mileageIn) ? num(form.mileageOut) - num(form.mileageIn) : null;
  const latestRate = transportRates[transportRates.length - 1];
  const estimateOf = (leg) => (latestRate && num(leg.distanceKm) ? Math.round(num(leg.distanceKm) * latestRate.perKm) : null);
  const transportFee = ['in', 'out'].reduce((s, side) => s + (form.transport[side].method === '외주 탁송' ? num(form.transport[side].fee) : 0), 0);
  const repairTotal = num(form.costs.repair) + num(form.costs.vat);
  const insurancePaid = num(form.costs.insurancePaid);
  const companyBurden = useMemo(() => {
    const byOthers = ['고객 부담', '보증·리콜(무상)'].includes(form.payer) ? repairTotal : 0;
    return repairTotal - byOthers - insurancePaid + transportFee;
  }, [form.payer, repairTotal, insurancePaid, transportFee]);

  const checks = row?.checks;
  const nextRound = form.kind === '정기점검' && !record?.checkRound ? (checks?.done || 0) + 1 : record?.checkRound;

  // 고객 안내 문자 초안 (보내지는 않는다)
  const makeNotice = (n) => {
    const head = `[렌트베네핏] ${row?.partyName || '고객'}님, ${row?.plateNo} ${row?.carModel} 차량 안내드립니다.`;
    const body = n.type === 'over'
      ? `최근 주행거리가 연 ${row.usage.annualizedKm?.toLocaleString()}km로 약정 주행거리(연 ${row.usage.contractKm?.toLocaleString()}km)보다 많습니다. 안전을 위해 정기점검 주기를 앞당겨 진행하고자 하며, 약정 초과 주행에 대한 기준도 함께 안내드리겠습니다.`
      : '최근 1년 동안 정기점검 기록이 없습니다. 주행거리가 적더라도 오일·소모품은 시간이 지나면 성능이 떨어지므로 연 1회 정기점검을 꼭 받으셔야 합니다. 편하신 일정 알려 주시면 예약 도와드리겠습니다.';
    const text = `${head}\n${body}\n문의: 렌트베네핏`;
    setNotice(text);
    navigator.clipboard?.writeText(text).then(() => showToast?.('안내 문자를 복사했습니다. 붙여 넣어 보내세요.', 'success')).catch(() => {});
  };

  const save = async () => {
    if (!form.inAt && !form.outAt) { showToast?.('입고 또는 출고 날짜를 적어 주세요.', 'error'); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      let res;
      if (record) {
        res = await fetch(`${API_HOST}/api/vehicle-services/${record._id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      } else {
        const fd = new FormData();
        fd.append('vehicleId', row.vehicleId);
        fd.append('kind', form.kind);
        fd.append('data', JSON.stringify(payload));
        files.forEach((f) => fd.append('files', f));
        res = await fetch(`${API_HOST}/api/vehicle-services`, { method: 'POST', body: fd });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { showToast?.(data.message || '저장하지 못했습니다.', 'error'); return; }
      showToast?.(data.message || '저장했습니다.', 'success');
      onSaved?.();
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── 모양
  const card = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.8rem 0.9rem' };
  const h2 = { margin: '0 0 0.6rem', fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.4rem' };
  const tag = { marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' };
  const row2 = { display: 'grid', gridTemplateColumns: '84px 1fr', gap: '0.5rem', alignItems: 'center', marginBottom: '0.45rem' };
  const lab = { fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 700 };
  const input = { width: '100%', padding: '0.35rem 0.45rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.8rem', boxSizing: 'border-box' };
  const auto = { background: 'var(--bg-main)', borderRadius: '6px', padding: '0.35rem 0.55rem', fontSize: '0.76rem', color: 'var(--text-bright)' };
  const hint = { fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' };
  const two = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' };
  const three = { display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr', gap: '0.35rem' };
  // 컴포넌트로 만들면 입력할 때마다 다시 만들어져 글자 칸이 포커스를 잃는다. 그래서 함수로 그린다.
  const chips = (items, value, onChange) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
      {items.map((it) => (
        <button key={it} type="button" onClick={() => onChange(value === it ? '' : it)}
          style={{ border: `1px solid ${value === it ? 'var(--primary)' : 'var(--border-color)'}`, background: value === it ? 'var(--primary)' : '#fff', color: value === it ? '#fff' : 'var(--text-muted)', borderRadius: '999px', padding: '0.22rem 0.65rem', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer' }}>
          {it}
        </button>
      ))}
    </div>
  );
  const leg = (side, title) => {
    const l = form.transport[side];
    const est = estimateOf(l);
    return (
      <>
        <div style={row2}><span style={lab}>{title}</span>{chips(METHODS, l.method, (v) => setLeg(side, { method: v }))}</div>
        <div style={row2}><span style={lab}>{side === 'in' ? '픽업지 → 센터' : '센터 → 인도지'}</span>
          <div style={two}>
            <input style={input} value={l.from} onChange={(e) => setLeg(side, { from: e.target.value })} placeholder={side === 'in' ? '픽업지 주소' : '센터'} />
            <input style={input} value={l.to} onChange={(e) => setLeg(side, { to: e.target.value })} placeholder={side === 'in' ? '입고 센터' : '인도지 주소'} />
          </div></div>
        <div style={row2}><span style={lab}>거리 · 탁송</span>
          <div style={three}>
            <input style={{ ...input, textAlign: 'right' }} inputMode="decimal" value={l.distanceKm} onChange={(e) => setLeg(side, { distanceKm: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="거리 km" />
            <input style={input} value={l.vendor} disabled={l.method !== '외주 탁송'} onChange={(e) => setLeg(side, { vendor: e.target.value })} placeholder="탁송 업체" />
            <MoneyInput style={input} value={l.fee} disabled={l.method !== '외주 탁송'} onChange={(e) => setLeg(side, { fee: e.target.value })} placeholder="탁송료" />
          </div></div>
        {l.method === '외주 탁송' && (
          <div style={{ ...row2, marginTop: '-0.2rem' }}><span />
            <div style={hint}>
              {est !== null
                ? <>예상 {won(est)} ({latestRate.year}년 평균 km당 {won(latestRate.perKm)}){num(l.fee) ? ` · 실제 ${won(num(l.fee))} (${num(l.fee) >= est ? '+' : ''}${Math.round(((num(l.fee) - est) / est) * 100)}%)` : ''}</>
                : '거리와 탁송료가 쌓이면 해마다 km당 단가와 예상 탁송료가 나옵니다.'}
            </div></div>
        )}
      </>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1100, overflowY: 'auto', padding: '1.5rem 1rem' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', background: 'var(--bg-main)', borderRadius: '12px', padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem' }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-bright)' }}>
              정비·수리 기록 {record ? '고치기' : '입력'} <span style={{ fontSize: '0.7rem', background: '#eef3fe', color: 'var(--primary)', borderRadius: '10px', padding: '0.1rem 0.5rem', verticalAlign: '2px' }}>테스트</span>
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              {row?.plateNo} · {row?.carModel} · {row?.partyName || '-'} · 인도 {row?.deliveryDate || '-'}{row?.annualKm ? ` · 약정 ${Number(row.annualKm).toLocaleString()}km/년` : ''}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
            <button type="button" onClick={onClose} style={{ border: '1px solid var(--border-color)', background: '#fff', borderRadius: '7px', padding: '0.45rem 0.9rem', fontWeight: 700, cursor: 'pointer' }}>닫기</button>
            <button type="button" onClick={save} disabled={saving} style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: '7px', padding: '0.45rem 1rem', fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}>{saving ? '저장 중…' : '저장'}</button>
            <button type="button" onClick={onClose} title="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '0.8rem' }}>
          {/* 1. 기본 */}
          <div style={card}>
            <h3 style={h2}>① 기본 정보</h3>
            <div style={row2}><span style={lab}>종류</span>{chips(KINDS, form.kind, (v) => v && set({ kind: v }))}</div>
            <div style={row2}><span style={lab}>진행 상태</span>{chips(STATUSES, form.status, (v) => v && set({ status: v }))}</div>
            <div style={row2}><span style={lab}>담당 · 센터</span>
              <div style={two}>
                <input style={input} value={form.staff} onChange={(e) => set({ staff: e.target.value })} placeholder="진행 직원" />
                <input style={input} value={form.shop} onChange={(e) => set({ shop: e.target.value })} placeholder="정비소·센터 (예: 한성 성동)" />
              </div></div>
            <div style={row2}><span style={lab}>정기점검 횟수</span>
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.3rem' }}>
                  {[['계약 중 예정', checks?.expected ?? '-'], ['받은 횟수', checks?.done ?? 0], ['남은 횟수', checks?.remaining ?? '-'], ['다음 점검', row?.maintenance?.date || '-']].map(([k, v]) => (
                    <div key={k} style={{ ...auto, textAlign: 'center' }}><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{k}</div><b>{typeof v === 'number' ? `${v}회` : v}</b></div>
                  ))}
                </div>
                <div style={hint}>
                  {form.kind === '정기점검' && nextRound ? `저장하면 ${nextRound}회차로 셉니다. ` : ''}
                  {checks?.termMonths ? `계약 ${checks.termMonths}개월 ÷ ${checks.intervalMonths}개월 주기 · 남은 횟수는 다음 점검일부터 계약 끝(${checks.contractEnd || '-'})까지` : '계약 기간을 몰라 예정 횟수를 셀 수 없습니다'}
                </div>
              </div></div>
          </div>

          {/* 2. 기간·주행거리 */}
          <div style={card}>
            <h3 style={h2}>② 수리 기간 · 주행거리<span style={tag}>문제가 생겼을 때 증거자료</span></h3>
            {[['입고', 'inAt', 'mileageIn', 'fuelIn'], ['출고', 'outAt', 'mileageOut', 'fuelOut']].map(([t, at, km, fuel]) => (
              <div key={t} style={row2}><span style={lab}>{t}</span>
                <div style={three}>
                  <input type="datetime-local" style={input} value={form[at]} onChange={(e) => set({ [at]: e.target.value })} />
                  <MoneyInput style={input} value={form[km]} onChange={(e) => set({ [km]: e.target.value })} placeholder="주행거리 km" />
                  <select style={input} value={form[fuel]} onChange={(e) => set({ [fuel]: e.target.value })}>{FUELS.map((f) => <option key={f} value={f}>{f ? `연료 ${f}` : '연료'}</option>)}</select>
                </div></div>
            ))}
            <div style={row2}><span /><div style={auto}>
              수리 기간 <b>{days === null ? '-' : `${days}일`}</b>{moved !== null ? <> · 이동 중 주행 <b>{moved.toLocaleString()}km</b></> : ''}
            </div></div>
            <div style={row2}><span style={lab}>계약 대비</span>
              <div>
                <div style={auto}>
                  {row?.usage?.annualizedKm
                    ? <>인도 후 {row.usage.monthsSinceDelivery}개월 · 주행 {Number(row.usage.lastKm).toLocaleString()}km → 연 환산 <b>{row.usage.annualizedKm.toLocaleString()}km</b>{row.usage.ratio ? ` (약정의 ${row.usage.ratio}%)` : ' (약정 미기재)'}</>
                    : '주행거리 기록이 쌓이면 약정 대비 주행을 계산합니다.'}
                </div>
                {(row?.notices || []).map((n) => (
                  <div key={n.type} style={{ borderLeft: '3px solid #d97706', background: '#fff7e6', borderRadius: '6px', padding: '0.4rem 0.6rem', fontSize: '0.74rem', marginTop: '0.35rem', lineHeight: 1.5 }}>
                    {n.text}
                    <button type="button" onClick={() => makeNotice(n)} style={{ marginLeft: '0.4rem', border: '1px solid var(--border-color)', background: '#fff', borderRadius: '6px', padding: '0.1rem 0.5rem', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>안내 문자 만들기</button>
                  </div>
                ))}
                {notice && <textarea readOnly value={notice} style={{ ...input, marginTop: '0.35rem', minHeight: '70px' }} />}
              </div></div>
          </div>

          {/* 3. 이동·탁송 */}
          <div style={card}>
            <h3 style={h2}>③ 이동 · 탁송<span style={tag}>외주 탁송이면 탁송료가 생깁니다</span></h3>
            {leg('in', '입고 이동')}
            <div style={{ borderTop: '1px dashed var(--border-color)', margin: '0.4rem 0' }} />
            {leg('out', '출고 이동')}
            <div style={hint}>거리는 지금은 직접 적습니다. 지도 API를 붙이면 주소로 자동 계산됩니다.</div>
          </div>

          {/* 4. 보험·비용 */}
          <div style={card}>
            <h3 style={h2}>④ 보험 · 비용 처리</h3>
            <div style={row2}><span style={lab}>처리 구분</span>{chips(PAYERS, form.payer, (v) => set({ payer: v }))}</div>
            {['자차 보험', '상대방 보험'].includes(form.payer) && (
              <>
                <div style={row2}><span style={lab}>보험사 · 접수</span><div style={two}>
                  <input style={input} value={form.insurer} onChange={(e) => set({ insurer: e.target.value })} placeholder="보험사" />
                  <input style={input} value={form.claimNo} onChange={(e) => set({ claimNo: e.target.value })} placeholder="접수번호" />
                </div></div>
                <div style={row2}><span style={lab}>과실 · 자기부담</span><div style={two}>
                  <input style={input} value={form.fault} onChange={(e) => set({ fault: e.target.value })} placeholder="예: 상대 100 : 0" />
                  <MoneyInput style={input} value={form.deductible} onChange={(e) => set({ deductible: e.target.value })} placeholder="자기부담금" />
                </div></div>
              </>
            )}
            <div style={row2}><span style={lab}>대차 제공</span><input style={input} value={form.loaner} onChange={(e) => set({ loaner: e.target.value })} placeholder="수리 동안 내준 차 (예: 아반떼 125호5281, 2/26~3/5)" /></div>
            <div style={row2}><span style={lab}>수리비 · 부가세</span><div style={two}>
              <MoneyInput style={input} value={form.costs.repair} onChange={(e) => setCost({ repair: e.target.value })} placeholder="수리비(공급가)" />
              <MoneyInput style={input} value={form.costs.vat} onChange={(e) => setCost({ vat: e.target.value })} placeholder="부가세" />
            </div></div>
            <div style={row2}><span style={lab}>보험 처리액</span><MoneyInput style={input} value={form.costs.insurancePaid} onChange={(e) => setCost({ insurancePaid: e.target.value })} placeholder="보험사가 낸 금액" /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.3rem', marginTop: '0.5rem' }}>
              {[['수리비 합계', repairTotal], ['탁송료', transportFee], ['보험 처리', -insurancePaid]].map(([k, v]) => (
                <div key={k} style={{ ...auto, textAlign: 'center' }}><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{k}</div><b>{Math.round(v).toLocaleString()}</b></div>
              ))}
              <div style={{ ...auto, textAlign: 'center', background: 'var(--text-bright)', color: '#fff' }}><div style={{ fontSize: '0.68rem', opacity: 0.75 }}>회사 실부담</div><b>{Math.round(companyBurden).toLocaleString()}</b></div>
            </div>
            <div style={hint}>원장 반영(테스트판에서는 기록만): {[repairTotal ? `${form.kind} ${won(repairTotal)}` : '', insurancePaid ? `보험 입금 ${won(insurancePaid)}` : '', transportFee ? `탁송 ${won(transportFee)}` : ''].filter(Boolean).join(' / ') || '-'}</div>
          </div>

          {/* 5. 작업·부위 */}
          <div style={{ ...card, gridColumn: '1 / -1' }}>
            <h3 style={h2}>⑤ 요청 · 작업 내용 · 수리 부위<span style={tag}>그림의 부위를 누를 때마다 교환 → 판금·도색 → 수리·점검 → 없음</span></h3>
            <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '1rem', alignItems: 'start' }}>
              <div>
                <CarDamageMap parts={form.parts} onToggle={togglePart} />
                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  {ACTIONS.map((a) => <span key={a}><i style={{ display: 'inline-block', width: 9, height: 9, background: ACTION_COLOR[a], borderRadius: 2, marginRight: 3 }} />{a}</span>)}
                </div>
              </div>
              <div>
                <div style={row2}><span style={lab}>고객 요청</span><textarea style={{ ...input, minHeight: '52px' }} value={form.request} onChange={(e) => set({ request: e.target.value })} placeholder="점검 의뢰 내용" /></div>
                <div style={row2}><span style={lab}>작업 내용</span><textarea style={{ ...input, minHeight: '52px' }} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="실제로 한 작업" /></div>
                {form.parts.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', marginBottom: '0.5rem' }}>
                    <thead><tr style={{ color: 'var(--text-muted)' }}><th style={{ textAlign: 'left', padding: '0.25rem' }}>부위</th><th style={{ textAlign: 'left' }}>작업</th><th style={{ textAlign: 'left' }}>메모</th></tr></thead>
                    <tbody>
                      {form.parts.map((p, i) => (
                        <tr key={p.zone} style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.25rem' }}>{p.zone}</td>
                          <td><span style={{ background: ACTION_COLOR[p.action], color: '#111', borderRadius: '8px', padding: '0.05rem 0.45rem', fontWeight: 700 }}>{p.action}</span></td>
                          <td><input style={{ ...input, padding: '0.2rem 0.35rem' }} value={p.memo} onChange={(e) => setForm((f) => ({ ...f, parts: f.parts.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)) }))} placeholder="긁힘, 찍힘 등" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ ...lab, marginBottom: '0.3rem' }}>소모품 (바꾼 것만 체크)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.25rem 0.6rem', fontSize: '0.76rem' }}>
                  {CONSUMABLES.map((c) => (
                    <label key={c} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.consumables.includes(c)} onChange={() => toggleConsumable(c)} />{c}
                    </label>
                  ))}
                </div>
                <div style={{ ...row2, marginTop: '0.5rem' }}><span style={lab}>메모</span><input style={input} value={form.memo} onChange={(e) => set({ memo: e.target.value })} /></div>
              </div>
            </div>
          </div>

          {/* 6. 증빙 */}
          <div style={{ ...card, gridColumn: '1 / -1' }}>
            <h3 style={h2}>⑥ 수리 내역서 · 견적서 · 사진</h3>
            {record ? (
              <div style={hint}>테스트판에서는 파일을 새 기록에서만 올릴 수 있습니다. 이 기록의 파일 {(record.attachments || []).length || (record.fileName ? 1 : 0)}개</div>
            ) : (
              <>
                <input type="file" multiple onChange={(e) => setFiles([...e.target.files])} style={{ fontSize: '0.8rem' }} />
                {files.length > 0 && <div style={hint}>{files.map((f) => f.name).join(', ')}</div>}
                <div style={hint}>파일은 계약자 OneDrive 폴더의 차량번호 폴더에 날짜별로 저장됩니다. 내역서 글자 자동 읽기(부품·공임·합계 표 채우기)는 다음 단계에서 붙입니다.</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
