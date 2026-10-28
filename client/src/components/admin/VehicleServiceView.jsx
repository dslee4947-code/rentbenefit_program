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
  { id: 'insp-unverified', label: '검사 기록 없음', color: '#6d28d9', test: (r) => Boolean(r.inspection?.unverified) }
];

// 정비 포함 장기렌트와 단기렌트(사고대차 포함)는 회사가 정비를 챙기는 차라 먼저 본다
const isCareGroup = (r) => r.generalMaintenance === '가입' || r.status === '단기렌트' || r.status === '사고대차';
const groupText = (r) => (r.status === '장기렌트' ? (r.generalMaintenance === '가입' ? '장기 · 정비' : '장기') : '단기');

/**
 * 목록 순서.
 * 1) 자동차검사가 급한 차 (기간 지남 → 검사일 지남 → 2개월 이내), 정비 포함 여부와 상관없이
 * 2) 정비 포함·단기렌트 차 중 정기점검이 지났거나 30일 안인 차
 * 3) 나머지 정비 포함·단기렌트 차
 * 4) 정비 미포함 차
 * 같은 묶음 안에서는 정비 포함 차가 먼저, 그다음 날짜가 이른 차가 먼저다.
 */
const rankOf = (r) => {
  const level = inspectionLevelOf(r);
  if (level) return INSPECTION_LEVEL[level].rank;
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
              {['차량번호', '구분', '차종', '계약자', '자동차검사', '정기점검', '최근 기록'].map((h) => (
                <th key={h} style={{ ...cell, textAlign: 'left', fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={7} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                {loading ? '불러오는 중...' : '해당하는 차량이 없습니다.'}
              </td></tr>
            ) : visible.map((r) => {
              const level = inspectionLevelOf(r);
              const urgent = level ? INSPECTION_LEVEL[level] : null;
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
                        {urgent && <b style={{ color: urgent.fg }}>{ddayText(insp.dday)} {urgent.label}</b>}
                        {/* 검사를 받은 차는 다음 검사일이 내년으로 넘어가 음영이 없어진다. 따로 '완료' 표시는 두지 않는다 */}
                        {level === 'grace' && <span style={small}>(마감 {insp.windowEnd})</span>}
                        {insp.unverified && <span title="검사 기록이 없어 지난 검사는 받은 것으로 보고 이번 차례를 보여 줍니다. 사이버검사소에서 확인 후 차를 눌러 검사 기록을 남겨 주세요." style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6d28d9' }}>기록 없음</span>}
                      </span>
                    ) : <span style={small}>등록일 없음</span>}
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
        순서: 검사 급한 차 → 정비 포함·단기렌트 중 점검 급한 차 → 나머지 정비 포함·단기렌트 → 정비 미포함.
      </div>

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
