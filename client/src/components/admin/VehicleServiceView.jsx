import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X, ExternalLink, Trash2, Pencil, Search } from 'lucide-react';
import VehicleServiceForm from './VehicleServiceForm.jsx';
import CarDamageMap from './CarDamageMap.jsx';
import CalendarInboxPanel from './CalendarInboxPanel.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => `${Number(n || 0).toLocaleString()}원`;
// DB 날짜는 한국 자정(전날 15:00Z)으로 저장된다. 그대로 자르면 하루 앞 날짜가 나와서 한국 시간으로 바꿔 자른다.
const ymd = (d) => {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return String(d);
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? String(d).slice(0, 10) : new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
};

/** 입고·출고 시각과 주행거리, 수리 기간을 한 줄로 */
const periodText = (r) => {
  const km = (n) => (n ? ` (${Number(n).toLocaleString()}km)` : '');
  const days = r.inAt && r.outAt ? Math.max(0, Math.round((new Date(r.outAt) - new Date(r.inAt)) / 86400000)) : null;
  return [
    r.inAt ? `입고 ${ymd(r.inAt)}${km(r.mileageIn)}` : '',
    r.outAt ? `출고 ${ymd(r.outAt)}${km(r.mileageOut)}` : '',
    days !== null ? `${days}일` : ''
  ].filter(Boolean).join(' → ');
};

const transportFeeOf = (r) => (r.transport?.in?.fee || 0) + (r.transport?.out?.fee || 0);

const ddayText = (dday) => {
  if (dday === null || dday === undefined) return '';
  if (dday > 0) return `D-${dday}`;
  return dday === 0 ? 'D-day' : `D+${-dday}`;
};

const todayYmd = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/**
 * 자동차검사 긴급도.
 * 검사 기간은 검사일 2개월 전부터 1개월 뒤까지인데, 회사 방침은 검사일 전에 끝내는 것이다.
 * 그래서 2개월 안으로 들어오면 표시하고, 검사일을 넘기면(유예 1개월) 더 진하게, 기간까지 넘기면 빨갛게 한다.
 * 정비 포함 여부와 상관없이 검사는 받아야 하므로 이 차들은 목록 맨 위로 올린다.
 */
const INSPECTION_LEVEL = {
  over: { rank: 0, label: '기간 지남', bg: '#fee2e2', fg: '#b91c1c' },
  grace: { rank: 1, label: '검사일 지남', bg: '#ffedd5', fg: '#c2410c' },
  due: { rank: 2, label: '2개월 이내', bg: '#fef9c3', fg: '#a16207' }
};
const inspectionLevelOf = (r, today = todayYmd()) => {
  const i = r.inspection;
  if (!i) return null;
  if (i.windowEnd < today) return 'over';
  if (i.date < today) return 'grace';
  if (i.windowStart <= today) return 'due';
  return null;
};
const MAINT_COLOR = { 지남: 'var(--error)', '30일 이내': '#d97706' };

/**
 * 렌터카 차령(서버 utils/vehicleServicePlan.js carAgeOf).
 * 배기량 2,000cc 미만 5년, 2,000cc 이상 8년. 끝나기 전 2개월 안에 자동차검사를 받으면서 연장을 신청한다(1년씩, 최대 2년).
 * 그래서 그 기간에 자동차검사 기록이 있으면 연장 완료로 본다.
 */
const CAR_AGE_LEVEL = {
  end: { rank: 0, label: '연장 한도 지남', bg: '#fee2e2', fg: '#b91c1c', tip: '연장 2년까지 다 썼습니다. 운행할 수 없어 매각·말소해야 합니다.' },
  expired: { rank: 0, label: '차령 지남', bg: '#fee2e2', fg: '#b91c1c', tip: '차령이 지났는데 그 뒤 자동차검사 기록이 없습니다. 검사를 받았으면 기록을 남기고, 아니면 바로 검사·연장 신청(또는 운행 중지)해야 합니다.' },
  last: { rank: 1, label: '연장 불가·만료 임박', bg: '#ffedd5', fg: '#c2410c', tip: '더 연장할 수 없습니다. 만료 전에 매각·반납을 정해야 합니다.' },
  apply: { rank: 1, label: '연장 신청 기간', bg: '#ffedd5', fg: '#c2410c', tip: '자동차검사를 받으면서 연장 신청할 기간입니다. 검사 기록을 남기면 연장 완료로 바뀝니다.' },
  soon: { rank: 2, label: '6개월 이내', bg: '#fef9c3', fg: '#a16207', tip: '곧 연장 신청 기간입니다. 계약 기간과 매각 여부를 미리 정하세요.' }
};
const carAgeLevelOf = (r) => r.carAge?.level || null;
// 계약이 차령(연장 포함)보다 늦게 끝나면 연장이 꼭 필요한 차다.
// checks.contractEnd는 인도일 + 계약 개월(마지막 날의 다음 날)이라 하루를 빼고 비교한다.
const needsExtensionForContract = (r) => Boolean(r.carAge && r.checks?.contractEnd
  && new Date(r.checks.contractEnd) - new Date(r.carAge.limit) > 86400000);

/**
 * 달력 보기(구글 캘린더처럼).
 *
 * - 자동차검사·정기점검: 앞으로 할 일(예정). 칠한 칸으로 보인다.
 * - 고장수리·사고수리: 일이 생긴 뒤 적는 기록. 테두리 칸 + ✓로 그날에 남는다.
 * - 장기렌트는 계약사 이름으로, 단기렌트는 차량번호로 보인다. 같은 날 같은 계약사·같은 일은 한 줄로 묶는다.
 * - 날짜가 지났는데 기록이 없는 예정 일은 달력 위 '밀린 일'에 모은다.
 * - 차령 연장은 자동차검사 때 함께 신청하므로 따로 칸을 두지 않고 자동차검사 칸에 '차령'을 붙인다.
 *
 * 검사·점검 한 번에: 자동차검사는 검사일 2개월 전부터 1개월 뒤까지 받을 수 있다. 정기점검일이 그 기간 시작 뒤이고
 * 검사일 2개월 뒤 안이면, 둘 중 이른 날에 한 번 입고해 같이 처리하도록 '검사+점검' 한 칸으로 묶는다.
 * 점검은 당겨질 수만 있고 늦춰지지는 않는다. 검사도 검사일을 넘기지 않는다.
 *
 * 날짜 칸의 빈 곳을 누르면 그날로 자동차검사·정기점검·고장수리·사고수리를 적는다(DayPicker).
 * 앞날은 '예정'으로 저장돼 그날에 '예약'으로 보이고, 계산한 날짜는 숨긴다. 받고 나서 '완료'로 바꾸면 다음 회차로 넘어간다.
 */
const KIND = {
  자동차검사: { color: '#1d4ed8', bg: '#dbeafe' },
  '검사+점검': { color: '#6d28d9', bg: '#ede9fe' },
  정기점검: { color: '#047857', bg: '#d1fae5' },
  고장수리: { color: '#b45309', bg: '#fff', record: true },
  사고수리: { color: '#b91c1c', bg: '#fff', record: true }
};
// 아래 정리표의 칸. '검사+점검'은 두 칸에 모두 들어간다.
const SUMMARY_COLS = ['자동차검사', '정기점검', '고장수리', '사고수리'];
const colsOf = (kind) => (kind === '검사+점검' ? ['자동차검사', '정기점검'] : [kind]);

const plusDays = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const shortDate = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const isLong = (r) => r.status === '장기렌트';
// 달력에 보이는 이름: 장기렌트는 계약사, 단기렌트는 차량번호
const whoOf = (r) => (isLong(r) ? (r.partyName || r.plateNo || '-') : (r.plateNo || r.carModel || '-'));

/** 검사와 점검을 같이 할 날. 같이 못 하면 null */
const togetherDateOf = (r) => {
  const i = r.inspection;
  const m = r.maintenance;
  if (!i || !m) return null;
  if (m.date < i.windowStart || m.date > plusDays(i.date, 61)) return null;
  return m.date < i.date ? m.date : i.date;
};

const eventsOf = (r, today) => {
  const out = [];
  const age = r.carAge?.level ? r.carAge : null;
  const inspOverdue = ['over', 'grace'].includes(inspectionLevelOf(r)) || ['expired', 'end'].includes(age?.level);
  const booked = r.bookings || [];
  const bookedKinds = new Set(booked.map((b) => b.kind));
  booked.forEach((b) => out.push({
    kind: KIND[b.kind] ? b.kind : '정기점검', label: b.kind, date: b.date, booked: true, overdue: b.date < today,
    age: b.kind === '자동차검사' ? age : null, note: [b.status, b.shop].filter(Boolean).join(' · ')
  }));
  // 잡아 둔 일정이 있으면 그 종류의 계산 날짜는 보여 주지 않는다
  r = { ...r, inspection: bookedKinds.has('자동차검사') ? null : r.inspection, maintenance: bookedKinds.has('정기점검') ? null : r.maintenance, _row: r };
  const together = togetherDateOf(r);
  if (together) {
    out.push({ kind: '검사+점검', date: together, overdue: together < today || inspOverdue, age, note: `자동차검사 ${r.inspection.date} · 정기점검 ${r.maintenance.date}` });
  } else {
    if (r.inspection) out.push({ kind: '자동차검사', date: r.inspection.date, overdue: inspOverdue, age, note: `받을 수 있는 기간 ${r.inspection.windowStart} ~ ${r.inspection.windowEnd}` });
    if (r.maintenance) out.push({ kind: '정기점검', date: r.maintenance.date, overdue: r.maintenance.status === '지남', note: r.maintenance.basis || '' });
  }
  (r.repairs || []).forEach((x) => out.push({ kind: x.kind, date: x.date, record: true, note: [x.status !== '완료' ? x.status : '', x.description, x.shop, x.amount ? won(x.amount) : ''].filter(Boolean).join(' · ') }));
  return out.map((e) => ({ ...e, r: r._row }));
};

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const monthKey = (ymd) => ymd.slice(0, 7);
const shiftMonth = (key, n) => {
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** 같은 일·같은 이름(장기=계약사, 단기=차량번호)끼리 묶는다 → [{ key, kind, who, list }] */
const groupEvents = (events) => {
  const m = new Map();
  events.forEach((e) => {
    const who = whoOf(e.r);
    const key = `${e.kind}|${who}`;
    if (!m.has(key)) m.set(key, { key, kind: e.kind, who, list: [] });
    m.get(key).list.push(e);
  });
  // 예정 일이 먼저, 그다음 대수가 많은 순
  return [...m.values()].sort((a, b) => Number(Boolean(KIND[a.kind].record)) - Number(Boolean(KIND[b.kind].record)) || b.list.length - a.list.length);
};

/**
 * 달력 칸 한 줄. 누르거나 두 번 누르면 그 자리에 정보 창이 뜬다(아래로 내려가지 않게).
 * 차가 한 대뿐인 줄을 두 번 누르면 바로 차 상세가 열린다.
 */
function GroupChip({ g, active, onClick, onDouble }) {
  const k = KIND[g.kind];
  const hasAge = g.list.some((e) => e.age);
  const booked = g.list.every((e) => e.booked);
  return (
    <button
      type="button"
      onClick={(ev) => { ev.stopPropagation(); onClick(ev.currentTarget.getBoundingClientRect()); }}
      onDoubleClick={(ev) => { ev.stopPropagation(); onDouble?.(); }}
      title={`${g.kind} · ${g.who}\n${g.list.map((e) => `${e.r.plateNo} ${e.note || ''}`).join('\n')}`}
      style={{ display: 'block', width: '100%', textAlign: 'left', border: k.record || active ? `1px solid ${k.color}` : '1px solid transparent', ...(k.record ? { borderLeft: `3px solid ${k.color}` } : {}), background: active && k.record ? '#fef3c7' : k.bg, color: k.color, borderRadius: '4px', padding: '0.05rem 0.25rem', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}
    >
      {k.record ? '✓ ' : ''}{booked ? '📌 ' : ''}{g.kind} {g.who}{g.list.length > 1 ? ` ${g.list.length}대` : ''}{hasAge ? ' · 차령' : ''}
    </button>
  );
}

/** 이달 정리표: 계약사(단기는 '단기렌트')마다 이달 일을 칸별로 */
function MonthSummary({ events, onOpen }) {
  if (!events.length) return null;
  const parties = new Map();
  events.forEach((e) => {
    const party = isLong(e.r) ? (e.r.partyName || '계약사 없음') : '단기렌트';
    if (!parties.has(party)) parties.set(party, { party, cars: new Set(), cols: Object.fromEntries(SUMMARY_COLS.map((c) => [c, []])) });
    const p = parties.get(party);
    p.cars.add(e.r.vehicleId);
    colsOf(e.kind).forEach((c) => p.cols[c].push(e));
  });
  const list = [...parties.values()].sort((a, b) => (a.party === '단기렌트') - (b.party === '단기렌트') || b.cars.size - a.cars.size);
  const totals = Object.fromEntries(SUMMARY_COLS.map((c) => [c, new Set(events.filter((e) => colsOf(e.kind).includes(c)).map((e) => e.r.vehicleId)).size]));
  const cell = { padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--border-color)', verticalAlign: 'top', fontSize: '0.76rem' };
  return (
    <div style={{ marginTop: '0.6rem', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ background: 'var(--bg-main)' }}>
          <tr>
            <th style={{ ...cell, textAlign: 'left', width: '170px' }}>계약사 ({list.length}곳)</th>
            {SUMMARY_COLS.map((c) => (
              <th key={c} style={{ ...cell, textAlign: 'left', color: KIND[c].color }}>{KIND[c].record ? '✓ ' : ''}{c} {totals[c]}대</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.party}>
              <td style={{ ...cell, fontWeight: 800, color: 'var(--text-bright)' }}>{p.party} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{p.cars.size}대</span></td>
              {SUMMARY_COLS.map((c) => (
                <td key={c} style={cell}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>
                    {p.cols[c].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => (
                      <button
                        key={`${e.kind}-${e.r.vehicleId}-${e.date}`}
                        type="button"
                        onClick={() => onOpen(e.r.vehicleId)}
                        title={`${e.r.carModel}\n${e.note || ''}`}
                        style={{ border: '1px solid var(--border-color)', background: '#fff', borderRadius: '4px', padding: '0 0.3rem', fontSize: '0.72rem', cursor: 'pointer', color: 'var(--text-bright)' }}
                      >
                        {e.r.plateNo || '-'} <span style={{ color: 'var(--text-muted)' }}>{shortDate(e.date)}</span>
                        {e.kind === '검사+점검' && <b style={{ color: KIND['검사+점검'].color }}> 함께</b>}
                        {e.age && c === '자동차검사' && <b style={{ color: '#c2410c' }}> 차령</b>}
                      </button>
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PICK_KINDS = ['자동차검사', '정기점검', '고장수리', '사고수리'];

/** 날짜 칸 빈 곳을 눌렀을 때: 종류 고르고 → 차 고르면 상세 입력 양식이 그 날짜로 열린다 */
function DayPicker({ date, rows, onPick, onClose }) {
  const [kind, setKind] = useState('자동차검사');
  const [q, setQ] = useState('');
  const today = todayYmd();
  const key = q.trim().replace(/\s+/g, '').toLowerCase();
  // 그 종류의 일이 그날 앞뒤로 잡힌 차를 위로(검사 기간 안인 차, 점검일이 가까운 차)
  const nearOf = (r) => {
    if (kind === '자동차검사' && r.inspection) return Math.abs(new Date(r.inspection.date) - new Date(date)) / 86400000 - (r.inspection.windowStart <= date && date <= r.inspection.windowEnd ? 1000 : 0);
    if (kind === '정기점검' && r.maintenance) return Math.abs(new Date(r.maintenance.date) - new Date(date)) / 86400000;
    return 99999;
  };
  const list = rows
    .filter((r) => kind !== '정기점검' || r.maintenance)
    .filter((r) => !key || [r.plateNo, r.carModel, r.partyName].some((x) => String(x || '').replace(/\s+/g, '').toLowerCase().includes(key)))
    .sort((a, b) => nearOf(a) - nearOf(b) || String(a.partyName).localeCompare(String(b.partyName)))
    .slice(0, 60);
  const inWindow = (r) => kind === '자동차검사' && r.inspection && r.inspection.windowStart <= date && date <= r.inspection.windowEnd;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '10px', width: 'min(560px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0.8rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-bright)' }}>{date} 일정·기록 넣기</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{date > today ? '앞날이라 "예정"으로 저장합니다. 받고 나서 "완료"로 바꾸세요.' : '지난 날·오늘이라 "완료" 기록으로 저장합니다.'}</div>
          </div>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '0.7rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {PICK_KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} style={{ border: `1px solid ${KIND[k].color}`, background: kind === k ? KIND[k].color : '#fff', color: kind === k ? '#fff' : KIND[k].color, borderRadius: '999px', padding: '0.35rem 0.8rem', fontSize: '0.82rem', fontWeight: 800, cursor: 'pointer' }}>{k}</button>
            ))}
          </div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="차량번호·계약사·차종으로 찾기" style={{ padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }} />
          {kind === '정기점검' && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>정기점검은 일반정비 가입 차와 단기렌트 차만 나옵니다.</div>}
        </div>
        <div style={{ overflowY: 'auto', padding: '0 1rem 1rem' }}>
          {list.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>해당하는 차가 없습니다.</div>}
          {list.map((r) => (
            <button
              key={r.vehicleId}
              type="button"
              onClick={() => onPick(r.vehicleId, kind)}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '0.5rem', border: 'none', borderBottom: '1px solid var(--border-color)', background: '#fff', padding: '0.45rem 0.2rem', cursor: 'pointer', textAlign: 'left', fontSize: '0.8rem' }}
            >
              <b style={{ minWidth: '6.5rem', color: 'var(--text-bright)' }}>{r.plateNo || '-'}</b>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isLong(r) ? r.partyName : '단기렌트'} · {r.carModel}</span>
              <span style={{ fontSize: '0.72rem', color: inWindow(r) ? KIND['자동차검사'].color : 'var(--text-muted)', fontWeight: inWindow(r) ? 800 : 400, whiteSpace: 'nowrap' }}>
                {kind === '자동차검사' && r.inspection ? `검사일 ${shortDate(r.inspection.date)}${inWindow(r) ? ' · 기간 안' : ''}` : ''}
                {kind === '정기점검' && r.maintenance ? `점검일 ${shortDate(r.maintenance.date)}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ServiceCalendar({ rows, onOpen, onAdd, canWrite }) {
  const today = todayYmd();
  const [month, setMonth] = useState(monthKey(today));
  const [picked, setPicked] = useState(null); // { title, list }
  const [addDate, setAddDate] = useState(null); // 빈 곳을 누른 날짜

  const all = rows.flatMap((r) => eventsOf(r, today));
  const overdue = all.filter((e) => e.overdue);
  const inMonth = all.filter((e) => !e.overdue && monthKey(e.date) === month);
  const byDay = new Map();
  inMonth.forEach((e) => byDay.set(e.date, [...(byDay.get(e.date) || []), e]));

  // 그 달 1일이 든 주의 일요일부터
  const first = new Date(`${month}-01T00:00:00Z`);
  const startNo = first.getTime() / 86400000 - first.getUTCDay();
  const days = Array.from({ length: 42 }, (_, i) => new Date((startNo + i) * 86400000).toISOString().slice(0, 10));
  const weeks = [0, 1, 2, 3, 4, 5].map((w) => days.slice(w * 7, w * 7 + 7)).filter((w) => w.some((d) => monthKey(d) === month));

  // 정보 창은 누른 줄 바로 아래(화면 밖으로 나가면 위)에 띄운다
  const pick = (title, list, rect) => setPicked({ title, list, rect });
  const openOne = (list) => { if (list.length === 1) { setPicked(null); onOpen(list[0].r.vehicleId); } };
  const go = (n) => { setMonth(n === 0 ? monthKey(today) : shiftMonth(month, n)); setPicked(null); };
  const navBtn = { border: '1px solid var(--border-color)', background: '#fff', borderRadius: '6px', padding: '0.25rem 0.6rem', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' };

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', background: '#fff', padding: '0.6rem' }}>
      {overdue.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.45rem 0.55rem', marginBottom: '0.6rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#b91c1c', marginBottom: '0.2rem' }}>밀린 일 {overdue.length}건 · 날짜가 지났는데 기록이 없습니다</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {groupEvents(overdue).map((g) => (
              <div key={g.key} style={{ minWidth: '160px', maxWidth: '260px' }}>
                <GroupChip g={g} active={picked?.title === `밀린 ${g.key}`} onClick={(rect) => pick(`밀린 ${g.key}`, g.list, rect)} onDouble={() => openOne(g.list)} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
        <button type="button" style={navBtn} onClick={() => go(-1)}>‹</button>
        <strong style={{ fontSize: '1rem', color: 'var(--text-bright)', minWidth: '7rem', textAlign: 'center' }}>{month.slice(0, 4)}년 {Number(month.slice(5, 7))}월</strong>
        <button type="button" style={navBtn} onClick={() => go(1)}>›</button>
        <button type="button" style={navBtn} onClick={() => go(0)}>오늘</button>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {Object.entries(KIND).map(([name, k]) => (
            <span key={name} style={{ fontSize: '0.7rem', fontWeight: 800, color: k.color, background: k.bg, border: k.record ? `1px solid ${k.color}` : 'none', borderRadius: '4px', padding: '0 0.3rem' }}>{k.record ? '✓ ' : ''}{name}</span>
          ))}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderTop: '1px solid var(--border-color)', borderLeft: '1px solid var(--border-color)' }}>
        {WEEK.map((w, i) => (
          <div key={w} style={{ textAlign: 'center', fontSize: '0.72rem', fontWeight: 800, padding: '0.2rem', color: i === 0 ? '#dc2626' : i === 6 ? '#2563eb' : 'var(--text-muted)', borderRight: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-main)' }}>{w}</div>
        ))}
        {weeks.flat().map((d) => {
          const thisMonth = monthKey(d) === month;
          const groups = groupEvents(byDay.get(d) || []);
          const isToday = d === today;
          return (
            <div
              key={d}
              onClick={canWrite ? () => setAddDate(d) : undefined}
              title={canWrite ? '빈 곳을 누르면 이 날짜로 자동차검사·정기점검·고장수리·사고수리를 넣습니다' : undefined}
              style={{ minHeight: '84px', padding: '0.2rem', borderRight: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', background: thisMonth ? '#fff' : '#fafafa', minWidth: 0, cursor: canWrite ? 'pointer' : 'default' }}
            >
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: isToday ? '#fff' : thisMonth ? 'var(--text-bright)' : 'var(--text-muted)', background: isToday ? 'var(--primary)' : 'none', borderRadius: '999px', width: '1.4rem', height: '1.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {Number(d.slice(8, 10))}
              </div>
              {groups.slice(0, 4).map((g) => (
                <GroupChip key={g.key} g={g} active={picked?.title === `${d} ${g.key}`} onClick={(rect) => pick(`${d} ${g.key}`, g.list, rect)} onDouble={() => openOne(g.list)} />
              ))}
              {groups.length > 4 && (
                <button type="button" onClick={(ev) => { ev.stopPropagation(); pick(`${d} 전체`, byDay.get(d), ev.currentTarget.getBoundingClientRect()); }} style={{ border: 'none', background: 'none', fontSize: '0.68rem', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                  +{groups.length - 4}개 더
                </button>
              )}
            </div>
          );
        })}
      </div>

      {picked && (() => {
        const W = Math.min(420, window.innerWidth - 32);
        const left = Math.max(16, Math.min(picked.rect?.left ?? 16, window.innerWidth - W - 16));
        const below = (picked.rect?.bottom ?? 100) + 4;
        const place = below > window.innerHeight * 0.6 ? { bottom: window.innerHeight - (picked.rect?.top ?? 0) + 4 } : { top: below };
        return (
        <>
        <div onClick={() => setPicked(null)} style={{ position: 'fixed', inset: 0, zIndex: 900 }} />
        <div style={{ position: 'fixed', left, ...place, width: W, maxHeight: '50vh', overflowY: 'auto', zIndex: 901, background: '#fff', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-bright)', marginBottom: '0.3rem' }}>
            {picked.title.replace(/\|/g, ' · ')} ({picked.list.length}대)
            <button type="button" onClick={() => setPicked(null)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={14} /></button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {picked.list.map((e) => (
              <button
                key={`${e.kind}-${e.r.vehicleId}-${e.date}`}
                type="button"
                onClick={() => { setPicked(null); onOpen(e.r.vehicleId); }}
                title="누르면 차 상세가 열립니다"
                style={{ border: '1px solid var(--border-color)', background: '#fff', borderRadius: '6px', padding: '0.25rem 0.45rem', fontSize: '0.76rem', cursor: 'pointer', textAlign: 'left' }}
              >
                <b style={{ color: KIND[e.kind].color }}>{e.booked ? '📌 ' : ''}{e.label || e.kind}</b> <b>{e.r.plateNo || '-'}</b>{' '}
                <span style={{ color: 'var(--text-muted)' }}>{isLong(e.r) ? `${e.r.partyName} · ` : ''}{e.r.carModel} · {e.date}</span>
                {e.note && <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{e.note}</div>}
                {e.age && <b style={{ color: '#c2410c' }}> · 차령 연장 함께 신청</b>}
              </button>
            ))}
          </div>
        </div>
        </>
        );
      })()}

      <MonthSummary events={inMonth} onOpen={onOpen} />
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.6 }}>
        자동차검사는 검사일 2개월 전부터 1개월 뒤까지 받을 수 있습니다. 정기점검일이 그 안(검사일 2개월 뒤까지)에 있으면 이른 날에 한 번 입고해 같이 처리하도록 <b style={{ color: KIND['검사+점검'].color }}>검사+점검</b>으로 묶었습니다.
        ✓ 고장수리·사고수리는 일이 생긴 뒤 남긴 기록입니다. 📌는 날짜를 잡아 둔 일정입니다.
        {canWrite ? ' 날짜 칸의 빈 곳을 누르면 그날로 일정·기록을 넣을 수 있습니다.' : ''}
      </div>
      {addDate && (
        <DayPicker date={addDate} rows={rows} onClose={() => setAddDate(null)} onPick={(id, kind) => { setAddDate(null); onAdd(id, kind, addDate); }} />
      )}
    </div>
  );
}

/** 상세 패널의 날짜 한 칸: 날짜 + D-day */
function Due({ item, color }) {
  return (
    <div style={{ fontWeight: 800, color: 'var(--text-bright)' }}>
      {item.date}{' '}
      <span style={{ fontSize: '0.78rem', color: color || 'var(--text-muted)' }}>{ddayText(item.dday)}</span>
    </div>
  );
}

// 위 칩을 누르면 그 상태의 차만 남긴다. 아침에 "오늘 챙길 차"만 보려는 용도다.
const FILTERS = [
  { id: 'insp-over', label: '검사일 지남', color: '#b91c1c', test: (r) => ['over', 'grace'].includes(inspectionLevelOf(r)) },
  { id: 'insp-due', label: '검사 2개월 이내', color: '#a16207', test: (r) => inspectionLevelOf(r) === 'due' },
  { id: 'maint-over', label: '점검 지남', color: 'var(--error)', test: (r) => r.maintenance?.status === '지남' },
  { id: 'maint-soon', label: '점검 30일 이내', color: '#d97706', test: (r) => r.maintenance?.status === '30일 이내' },
  { id: 'age-now', label: '차령 연장 신청', color: '#c2410c', test: (r) => ['end', 'expired', 'last', 'apply'].includes(carAgeLevelOf(r)) },
  { id: 'age-soon', label: '차령 6개월 이내', color: '#a16207', test: (r) => carAgeLevelOf(r) === 'soon' },
  { id: 'insp-unverified', label: '검사 기록 없음', color: '#6d28d9', test: (r) => Boolean(r.inspection?.unverified) }
];

// 정비 포함 장기렌트와 단기렌트(사고대차 포함)는 회사가 정비를 챙기는 차라 먼저 본다
const isCareGroup = (r) => r.generalMaintenance === '가입' || r.status === '단기렌트' || r.status === '사고대차';
const groupText = (r) => (r.status === '장기렌트' ? (r.generalMaintenance === '가입' ? '장기 · 정비' : '장기') : '단기');

/**
 * 목록 순서.
 * 1) 자동차검사나 차령 연장이 급한 차 (기간 지남 → 검사일 지남·연장 신청 기간 → 2개월·6개월 이내), 정비 포함 여부와 상관없이
 * 2) 정비 포함·단기렌트 차 중 정기점검이 지났거나 30일 안인 차
 * 3) 나머지 정비 포함·단기렌트 차
 * 4) 정비 미포함 차
 * 같은 묶음 안에서는 정비 포함 차가 먼저, 그다음 날짜가 이른 차가 먼저다.
 */
const rankOf = (r) => {
  const level = inspectionLevelOf(r);
  const age = carAgeLevelOf(r);
  if (level || age) return Math.min(level ? INSPECTION_LEVEL[level].rank : 9, age ? CAR_AGE_LEVEL[age].rank : 9);
  if (!isCareGroup(r)) return 6;
  if (r.maintenance?.status === '지남') return 3;
  if (r.maintenance?.status === '30일 이내') return 4;
  return 5;
};
const urgencyDday = (r) => {
  if (inspectionLevelOf(r)) return r.inspection.dday;
  return Math.min(r.inspection?.dday ?? 99999, isCareGroup(r) ? (r.maintenance?.dday ?? 99999) : 99999);
};

/**
 * 차량 정비·검사 관리.
 *
 * 운행 중인 차(장기렌트·단기렌트)마다 다음 자동차검사와 정기점검이 언제인지 보여 주고,
 * 정비·수리 기록을 남긴다. 기록을 남기면 다음 날짜가 바로 다시 계산되고 캘린더도 따라간다.
 *
 * 자동차검사: 최초등록일 2년 뒤, 그 뒤 1년마다. 검사일 앞뒤 31일이 검사 기간이다.
 * 정기점검: 일반정비 '가입' 차만. 1만 km마다(약정 주행거리로 개월 수를 정한다).
 * 알림은 직원용(대시보드·캘린더)이다. 고객에게 보내지 않는다.
 */
function VehicleServiceView({ showToast, currentUser }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true); // 처음 불러오기 전까지만 '불러오는 중'을 보여 준다
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [view, setView] = useState('calendar'); // 'calendar' | 'list'
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // { row, records }
  // 상세 입력 양식(테스트판). { record: null }이면 새 기록, record가 있으면 고치기
  const [formOpen, setFormOpen] = useState(null);
  const [transportRates, setTransportRates] = useState([]);

  const canWrite = currentUser?.role !== 'viewer';

  // 화면을 열 때와 기록을 바꾼 뒤 부른다. 상태는 응답이 온 뒤에만 바꾼다.
  const load = useCallback(() => fetch(`${API_HOST}/api/vehicle-services/plan`, { cache: 'no-store' })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) setRows(data.rows || []);
      else showToast?.(data.message || '정비·검사 계획을 불러오지 못했습니다.', 'error');
    })
    .catch(() => showToast?.('서버 통신 오류가 발생했습니다.', 'error'))
    .finally(() => setLoading(false)), [showToast]);

  const loadDetail = async (vehicleId) => {
    if (!vehicleId) return;
    try {
      const res = await fetch(`${API_HOST}/api/vehicle-services/vehicle/${vehicleId}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setDetail({ row: data.row, records: data.records || [] });
        // 목록의 그 줄도 같이 맞춘다. 목록을 열어 둔 사이 기록이 바뀌면 상세와 목록이 달라 보였다.
        setRows((prev) => prev.map((r) => (r.vehicleId === data.row?.vehicleId ? data.row : r)));
        setTransportRates(data.transportRates || []);
      }
      else showToast?.(data.message || '차량 기록을 불러오지 못했습니다.', 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  useEffect(() => { load(); }, [load]);
  // 다른 창(캘린더 등)에 갔다 돌아오면 목록을 다시 불러온다
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const openVehicle = (vehicleId) => {
    setDetail(null);
    setSelectedId(vehicleId);
    loadDetail(vehicleId);
    setFormOpen(null);
  };

  const closePanel = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const startEdit = (r) => setFormOpen({ record: r });

  const afterSave = () => {
    setFormOpen(null);
    loadDetail(selectedId);
    load();
  };

  const remove = async (r) => {
    if (!window.confirm(`${ymd(r.date)} ${r.kind} 기록을 지울까요?\n저장된 영수증 파일은 폴더에 그대로 남습니다.`)) return;
    const res = await fetch(`${API_HOST}/api/vehicle-services/${r._id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    showToast?.(data.message || '처리했습니다.', data.success ? 'success' : 'error');
    loadDetail(selectedId);
    load();
  };

  // 창을 먼저 열어 두지 않으면 팝업 차단에 걸린다
  // i: 상세 양식의 첨부 여러 장 중 몇 번째인지. 없으면 예전 영수증 한 장
  const openFile = async (r, i) => {
    const win = window.open('', '_blank');
    try {
      const res = await fetch(`${API_HOST}/api/vehicle-services/${r._id}/file${i !== undefined ? `?i=${i}` : ''}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        win?.close();
        showToast?.(data.message || '파일을 열지 못했습니다.', 'error');
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.location.assign(url);
    } catch {
      win?.close();
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  const q = query.trim().replace(/\s+/g, '').toLowerCase();
  const activeFilter = FILTERS.find((f) => f.id === filter);
  const visible = rows
    .filter((r) => !q || [r.plateNo, r.carModel, r.partyName].some((x) => String(x || '').replace(/\s+/g, '').toLowerCase().includes(q)))
    .filter((r) => !activeFilter || activeFilter.test(r))
    // 급한 차부터 (rankOf 설명 참고)
    .sort((a, b) => rankOf(a) - rankOf(b)
      || Number(isCareGroup(b)) - Number(isCareGroup(a))
      || urgencyDday(a) - urgencyDday(b));

  const cell = { padding: '0.45rem 0.6rem', verticalAlign: 'middle', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' };
  const clip = { overflow: 'hidden', textOverflow: 'ellipsis' };
  const input = { width: '100%', padding: '0.35rem 0.45rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.8rem', boxSizing: 'border-box' };
  const small = { fontSize: '0.72rem', color: 'var(--text-muted)' };

  const selectedRow = detail?.row || rows.find((r) => r.vehicleId === selectedId);
  // 지금까지 고친 부위를 부위마다 센다(차량 그림에 겹쳐 보여 준다)
  const damageCounts = {};
  (detail?.records || []).flatMap((r) => r.parts || []).forEach((p) => { damageCounts[p.zone] = (damageCounts[p.zone] || 0) + 1; });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <CalendarInboxPanel vehicles={rows} onImported={() => { load(); if (selectedId) loadDetail(selectedId); }} showToast={showToast} />
      <div style={{ display: 'flex', gap: '0.3rem' }}>
        {[['calendar', '달력'], ['list', '목록']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setView(id)} style={{ border: '1px solid var(--border-color)', background: view === id ? 'var(--primary)' : '#fff', color: view === id ? '#fff' : 'var(--text-bright)', padding: '0.35rem 0.9rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 800, cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>
      {view === 'calendar' && (
        <ServiceCalendar
          rows={rows}
          onOpen={openVehicle}
          canWrite={canWrite}
          onAdd={(id, kind, date) => { openVehicle(id); setFormOpen({ record: null, preset: { kind, date } }); }}
        />
      )}
      {view === 'list' && (<>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const count = rows.filter(f.test).length;
          const on = filter === f.id;
          const { color } = f;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(on ? '' : f.id)}
              style={{ border: `1px solid ${on ? color : 'var(--border-color)'}`, background: on ? color : '#fff', color: on ? '#fff' : color, padding: '0.4rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer' }}
            >
              {f.label} {count}
            </button>
          );
        })}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={13} style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="차량번호·차종·계약자" style={{ ...input, width: '200px', paddingLeft: '1.6rem' }} />
        </div>
        <button type="button" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.4rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead style={{ background: 'var(--bg-main)', color: 'var(--text-muted)' }}>
            <tr>
              {['차량번호', '구분', '차종', '계약자', '자동차검사', '차령', '정기점검', '최근 기록'].map((h) => (
                <th key={h} style={{ ...cell, textAlign: 'left', fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={8} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                {loading ? '불러오는 중...' : '해당하는 차량이 없습니다.'}
              </td></tr>
            ) : visible.map((r) => {
              const level = inspectionLevelOf(r);
              const inspUrgent = level ? INSPECTION_LEVEL[level] : null;
              const ageLevel = carAgeLevelOf(r);
              const age = ageLevel ? CAR_AGE_LEVEL[ageLevel] : null;
              // 줄 색은 검사·차령 중 더 급한 쪽을 따른다
              const urgent = [inspUrgent, age].filter(Boolean).sort((a, b) => a.rank - b.rank)[0] || null;
              const insp = r.inspection;
              const maint = r.maintenance;
              return (
                <tr
                  key={r.vehicleId}
                  onClick={() => openVehicle(r.vehicleId)}
                  style={{ cursor: 'pointer', background: selectedId === r.vehicleId ? 'var(--bg-main)' : urgent?.bg }}
                >
                  <td style={{ ...cell, fontWeight: 800, color: urgent?.fg || 'var(--text-bright)', borderLeft: `4px solid ${urgent?.fg || 'transparent'}` }}>{r.plateNo || '-'}</td>
                  <td style={{ ...cell, color: 'var(--text-muted)' }}>{groupText(r)}</td>
                  <td style={{ ...cell, ...clip, maxWidth: '200px' }} title={r.carModel}>{r.carModel}</td>
                  <td style={{ ...cell, ...clip, maxWidth: '170px' }} title={r.partyName}>{r.partyName || '-'}</td>
                  <td style={cell}>
                    {insp ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>{insp.date}</span>
                        {inspUrgent && <b style={{ color: inspUrgent.fg }}>{ddayText(insp.dday)} {inspUrgent.label}</b>}
                        {/* 검사를 받은 차는 다음 검사일이 내년으로 넘어가 음영이 없어진다. 따로 '완료' 표시는 두지 않는다 */}
                        {level === 'grace' && <span style={small}>(마감 {insp.windowEnd})</span>}
                        {insp.unverified && <span title="검사 기록이 없어 지난 검사는 받은 것으로 보고 이번 차례를 보여 줍니다. 사이버검사소에서 확인 후 차를 눌러 검사 기록을 남겨 주세요." style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6d28d9' }}>기록 없음</span>}
                      </span>
                    ) : <span style={small}>등록일 없음</span>}
                  </td>
                  <td style={cell} title={r.carAge ? `${r.carAge.size}${r.carAge.cc && r.carAge.byCc ? ` ${r.carAge.cc.toLocaleString()}cc` : ''} · 차령 ${r.carAge.years}년${age ? ` · ${age.tip}` : ''}` : ''}>
                    {r.carAge ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>{r.carAge.limit}</span>
                        <span style={small}>{r.carAge.years}년{r.carAge.extendedOn?.length ? ` · 연장 ${r.carAge.extendedOn.length}회 완료` : ''}</span>
                        {age && <b style={{ color: age.fg }}>{ddayText(r.carAge.dday)} {age.label}</b>}
                        {!age && needsExtensionForContract(r) && <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#a16207' }}>계약 중 만료</span>}
                      </span>
                    ) : <span style={small}>-</span>}
                  </td>
                  <td style={cell}>
                    {maint ? (
                      <span title={maint.basis}>
                        {maint.date}{' '}
                        {MAINT_COLOR[maint.status] && <b style={{ color: MAINT_COLOR[maint.status] }}>{ddayText(maint.dday)}</b>}
                      </span>
                    ) : <span style={small}>-</span>}
                  </td>
                  <td style={{ ...cell, color: 'var(--text-muted)' }}>{r.lastRecord ? `${r.lastRecord.date} ${r.lastRecord.kind}` : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        {Object.values(INSPECTION_LEVEL).map((l) => (
          <span key={l.label} style={{ background: l.bg, color: l.fg, fontWeight: 800, padding: '0 0.35rem', borderRadius: '4px', marginRight: '0.3rem' }}>{l.label}</span>
        ))}
        자동차검사는 검사일 2개월 전부터 1개월 뒤까지 받을 수 있고, 검사일 전에 끝내는 것을 목표로 합니다.
        차령(렌터카)은 최초등록일부터 배기량 2,000cc 미만 5년, 2,000cc 이상 8년이며, 끝나기 전 2개월 안에 검사를 받고 연장을 신청합니다(1년씩, 최대 2년).
        순서: 검사·차령 급한 차 → 정비 포함·단기렌트 중 점검 급한 차 → 나머지 정비 포함·단기렌트 → 정비 미포함.
      </div>
      </>)}

      {selectedId && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100%)', background: '#fff', boxShadow: '-6px 0 24px rgba(0,0,0,0.15)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.9rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-bright)' }}>{selectedRow?.plateNo} {selectedRow?.carModel}</div>
              <div style={small}>
                {selectedRow?.partyName || '-'} · 최초등록 {selectedRow?.registrationDate || '-'} · 인도 {selectedRow?.deliveryDate || '-'}
                {selectedRow?.annualKm ? ` · 약정 ${Number(selectedRow.annualKm).toLocaleString()}km/년` : ''}
                {selectedRow?.currentMileage ? ` · 주행 ${Number(selectedRow.currentMileage).toLocaleString()}km` : ''}
              </div>
            </div>
            <button type="button" onClick={closePanel} title="닫기" style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={18} />
            </button>
          </div>

          <div style={{ overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem' }}>
                <div style={{ ...small, fontWeight: 800 }}>다음 자동차검사</div>
                {selectedRow?.inspection ? (
                  <>
                    <Due item={selectedRow.inspection} color={INSPECTION_LEVEL[inspectionLevelOf(selectedRow)]?.fg} />
                    <div style={small}>{selectedRow.inspection.checkedAt ? '유효기간 만료일 · ' : ''}받을 수 있는 기간 {selectedRow.inspection.windowStart} ~ {selectedRow.inspection.windowEnd} (목표: 검사일 전)</div>
                    {selectedRow.inspection.unverified && <div style={{ ...small, color: '#6d28d9' }}>검사 기록이 없어 지난 검사는 받은 것으로 보았습니다. 사이버검사소에서 확인해 주세요.</div>}
                    {selectedRow.inspection.checkedAt && <div style={small}>사이버검사소 유효기간 만료일 기준 ({selectedRow.inspection.checkedAt} 조회)</div>}
                    <div style={small}>{[selectedRow.inspection.round && `${selectedRow.inspection.round}회차`, selectedRow.inspection.lastDone && `지난 검사 ${selectedRow.inspection.lastDone}`].filter(Boolean).join(' · ')}</div>
                    {selectedRow.inspection.missed > 0 && (
                      <div style={{ ...small, color: 'var(--error)' }}>그 뒤 {selectedRow.inspection.missed}회차도 기간이 지났습니다. 검사 기록이 빠졌는지 확인하세요.</div>
                    )}
                  </>
                ) : <div style={small}>최초등록일이 없어 계산할 수 없습니다.</div>}
              </div>
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem' }}>
                <div style={{ ...small, fontWeight: 800 }}>다음 정기점검</div>
                {selectedRow?.maintenance ? (
                  <>
                    <Due item={selectedRow.maintenance} color={MAINT_COLOR[selectedRow.maintenance.status]} />
                    <div style={small}>{selectedRow.maintenance.basis}</div>
                  </>
                ) : <div style={small}>일반정비 미가입 차량입니다.</div>}
              </div>
            </div>

            {selectedRow?.carAge && (() => {
              const a = selectedRow.carAge;
              const lv = CAR_AGE_LEVEL[a.level];
              return (
                <div style={{ border: `1px solid ${lv?.fg || 'var(--border-color)'}`, background: lv?.bg, borderRadius: '8px', padding: '0.6rem' }}>
                  <div style={{ ...small, fontWeight: 800 }}>렌터카 차령</div>
                  <div style={{ fontWeight: 800, color: 'var(--text-bright)' }}>
                    {a.limit} 만료{' '}
                    <span style={{ fontSize: '0.78rem', color: lv?.fg || 'var(--text-muted)' }}>{ddayText(a.dday)}{lv ? ` ${lv.label}` : ''}</span>
                  </div>
                  <div style={small}>
                    {a.size}{a.cc && a.byCc ? ` (${a.cc.toLocaleString()}cc)` : ''} → 기본 차령 {a.years}년, 기본 만료 {a.expiry}
                    {a.extendedOn?.length ? ` · 연장 완료(자동차검사 ${a.extendedOn.join(', ')})` : ''}
                  </div>
                  <div style={small}>{a.limit < a.maxLimit ? `다음 연장: ${a.applyStart} ~ ${a.limit}에 자동차검사를 받으면서 신청 · ` : '더 연장할 수 없음 · '}연장 한도 {a.maxLimit}</div>
                  {lv && <div style={{ ...small, color: lv.fg, fontWeight: 700 }}>{lv.tip}</div>}
                  {needsExtensionForContract(selectedRow) && (
                    <div style={{ ...small, color: '#b45309' }}>⚠ 계약이 {selectedRow.checks.contractEnd}에 끝나 차령보다 늦습니다. 연장 신청이 필요합니다.</div>
                  )}
                  {!a.byCc && <div style={small}>배기량이 없어 크기 기준(승용 전기차는 중형 이하)으로 보았습니다. 친환경차는 시·도 조례로 2년을 더 주는 곳이 있으니 확인하세요.</div>}
                </div>
              );
            })()}

            {/* 정기점검 횟수 · 계약 대비 주행 · 지금까지 고친 부위 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem' }}>
                <div style={{ ...small, fontWeight: 800 }}>정기점검 횟수</div>
                <div style={{ fontWeight: 800, color: 'var(--text-bright)' }}>
                  {selectedRow?.checks?.done ?? 0}회 받음
                  {selectedRow?.checks?.expected
                    ? <span style={{ ...small, fontWeight: 600 }}> / 계약 중 {selectedRow.checks.expected}회{selectedRow.checks.remaining !== null ? ` · 계약 끝(${selectedRow.checks.contractEnd})까지 ${selectedRow.checks.remaining}회 더` : ''}</span>
                    : null}
                </div>
                <div style={small}>{selectedRow?.checks?.last ? `마지막 ${selectedRow.checks.last}` : '정기점검 기록 없음'}</div>
                <div style={{ ...small, fontWeight: 800, marginTop: '0.5rem' }}>계약 대비 주행</div>
                <div style={small}>
                  {selectedRow?.usage?.annualizedKm
                    ? <>연 환산 <b style={{ color: 'var(--text-bright)' }}>{selectedRow.usage.annualizedKm.toLocaleString()}km</b>{selectedRow.usage.ratio ? ` (약정의 ${selectedRow.usage.ratio}%)` : ''}</>
                    : '주행거리 기록이 쌓이면 계산합니다'}
                </div>
                {(selectedRow?.notices || []).map((n) => (
                  <div key={n.type} style={{ ...small, color: '#b45309', marginTop: '0.3rem' }}>⚠ {n.text}</div>
                ))}
              </div>
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.4rem' }}>
                <div style={{ ...small, fontWeight: 800, textAlign: 'center' }}>지금까지 고친 부위</div>
                <CarDamageMap width={130} counts={damageCounts} />
              </div>
            </div>

            {canWrite && (
              <button type="button" onClick={() => setFormOpen({ record: null })} style={{ border: 'none', background: 'var(--primary)', color: '#fff', padding: '0.55rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 800, cursor: 'pointer' }}>
                + 정비·수리 기록 남기기 (상세 양식)
              </button>
            )}

            <div>
              <div style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--text-bright)', marginBottom: '0.4rem' }}>
                정비·검사 이력 {detail ? `${detail.records.length}건` : ''}
              </div>
              {!detail ? (
                <div style={small}>불러오는 중...</div>
              ) : detail.records.length === 0 ? (
                <div style={small}>아직 기록이 없습니다.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '2px solid var(--border-color)', marginLeft: '0.3rem' }}>
                  {detail.records.map((r) => (
                    <div key={r._id} style={{ padding: '0.4rem 0 0.6rem 0.8rem', position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-5px', top: '0.65rem', width: '8px', height: '8px', borderRadius: '50%', background: r.kind === '사고수리' ? 'var(--error)' : 'var(--primary)' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                        <strong style={{ color: 'var(--text-bright)' }}>{ymd(r.date)}</strong>
                        <span style={{ fontWeight: 700 }}>{r.kind}{r.checkRound ? ` ${r.checkRound}회차` : ''}</span>
                        {r.status && r.status !== '완료' && <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#d97706' }}>{r.status}</span>}
                        {r.amount > 0 && <span style={{ color: 'var(--text-muted)' }}>{won(r.amount)}</span>}
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.2rem' }}>
                          {r.fileName && (
                            <button type="button" onClick={() => openFile(r)} title="영수증 열기" style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
                              <ExternalLink size={13} />
                            </button>
                          )}
                          {canWrite && (
                            <>
                              <button type="button" onClick={() => startEdit(r)} title="고치기" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                <Pencil size={13} />
                              </button>
                              <button type="button" onClick={() => remove(r)} title="지우기 (영수증 파일은 남습니다)" style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                      <div style={small}>
                        {[r.mileage ? `${Number(r.mileage).toLocaleString()}km` : '', r.shop, r.description].filter(Boolean).join(' · ')}
                      </div>
                      {(r.inAt || r.outAt) && <div style={small}>{periodText(r)}</div>}
                      {(r.payer || transportFeeOf(r) > 0) && (
                        <div style={small}>
                          {[r.payer ? [r.payer, r.insurer, r.claimNo].filter(Boolean).join(' ') : '', transportFeeOf(r) ? `탁송 ${won(transportFeeOf(r))}` : ''].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {(r.parts || []).length > 0 && <div style={small}>수리 부위: {r.parts.map((p) => `${p.zone}(${p.action})`).join(', ')}</div>}
                      {(r.consumables || []).length > 0 && <div style={small}>소모품: {r.consumables.join(', ')}</div>}
                      {(r.attachments || []).length > 1 && (
                        <div style={{ ...small, display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {r.attachments.map((a, i) => (
                            <button key={a.savedPath || i} type="button" onClick={() => openFile(r, i)} style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, fontSize: '0.72rem' }}>
                              📎 {a.label || a.fileName}
                            </button>
                          ))}
                        </div>
                      )}
                      {r.memo && <div style={small}>{r.memo}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {formOpen && selectedRow && (
        <VehicleServiceForm
          row={selectedRow}
          record={formOpen.record}
          preset={formOpen.preset}
          transportRates={transportRates}
          onClose={() => setFormOpen(null)}
          onSaved={afterSave}
          showToast={showToast}
        />
      )}
    </div>
  );
}

export default VehicleServiceView;
