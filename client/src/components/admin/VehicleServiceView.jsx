import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X, ExternalLink, Trash2, Pencil, Search } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const ymd = (d) => (d ? String(d).slice(0, 10) : '');
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 서버(utils/vehicleServicePlan.js)와 같은 값이라야 한다
const KINDS = ['자동차검사', '정기점검', '고장수리', '사고수리', '소모품교환', '기타'];

const STATUS_COLOR = { 지남: 'var(--error)', '30일 이내': '#d97706', 예정: 'var(--text-muted)' };

const ddayText = (dday) => {
  if (dday === null || dday === undefined) return '';
  if (dday > 0) return `D-${dday}`;
  return dday === 0 ? '오늘' : `${-dday}일 지남`;
};

// 위 칩을 누르면 그 상태의 차만 남긴다. 아침에 "오늘 챙길 차"만 보려는 용도다.
const FILTERS = [
  { id: 'insp-over', label: '검사 지남', test: (r) => r.inspection?.status === '지남' },
  { id: 'insp-soon', label: '검사 30일 이내', test: (r) => r.inspection?.status === '30일 이내' },
  { id: 'maint-over', label: '점검 지남', test: (r) => r.maintenance?.status === '지남' },
  { id: 'maint-soon', label: '점검 30일 이내', test: (r) => r.maintenance?.status === '30일 이내' }
];

/** 다음 날짜 한 칸: 날짜 + D-day + 상태 */
function Due({ item }) {
  return (
    <>
      <div style={{ fontWeight: 700, color: 'var(--text-bright)' }}>
        {item.date}{' '}
        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: STATUS_COLOR[item.status] }}>{ddayText(item.dday)}</span>
      </div>
      <div style={{ fontSize: '0.72rem', color: STATUS_COLOR[item.status], fontWeight: item.status === '예정' ? 400 : 700 }}>{item.status}</div>
    </>
  );
}

const EMPTY_FORM = { kind: '정기점검', date: '', mileage: '', amount: '', shop: '', description: '', memo: '' };

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
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [editingId, setEditingId] = useState(null); // 고치는 중인 기록. 없으면 새로 적는다
  const [saving, setSaving] = useState(false);

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
      if (data.success) setDetail({ row: data.row, records: data.records || [] });
      else showToast?.(data.message || '차량 기록을 불러오지 못했습니다.', 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  useEffect(() => { load(); }, [load]);

  const openVehicle = (vehicleId) => {
    setDetail(null);
    setSelectedId(vehicleId);
    loadDetail(vehicleId);
    setForm({ ...EMPTY_FORM, date: todayYmd() });
    setFile(null);
    setEditingId(null);
  };

  const closePanel = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const startEdit = (r) => {
    setEditingId(r._id);
    setFile(null);
    setForm({
      kind: r.kind,
      date: ymd(r.date),
      mileage: r.mileage ?? '',
      amount: r.amount ?? '',
      shop: r.shop || '',
      description: r.description || '',
      memo: r.memo || ''
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setFile(null);
    setForm({ ...EMPTY_FORM, date: todayYmd() });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canWrite) { showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error'); return; }
    if (!form.date) { showToast?.('날짜를 적어 주세요.', 'error'); return; }
    setSaving(true);
    try {
      let res;
      if (editingId) {
        res = await fetch(`${API_HOST}/api/vehicle-services/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form)
        });
      } else {
        // 영수증 파일을 함께 보낼 수 있어 FormData로 보낸다
        const fd = new FormData();
        fd.append('vehicleId', selectedId);
        Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
        if (file) fd.append('file', file);
        res = await fetch(`${API_HOST}/api/vehicle-services`, { method: 'POST', body: fd });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast?.(data.message || '저장하지 못했습니다.', 'error');
        return;
      }
      showToast?.(data.message || '저장했습니다.', 'success');
      resetForm();
      loadDetail(selectedId);
      load();
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`${ymd(r.date)} ${r.kind} 기록을 지울까요?\n저장된 영수증 파일은 폴더에 그대로 남습니다.`)) return;
    const res = await fetch(`${API_HOST}/api/vehicle-services/${r._id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    showToast?.(data.message || '처리했습니다.', data.success ? 'success' : 'error');
    if (editingId === r._id) resetForm();
    loadDetail(selectedId);
    load();
  };

  // 창을 먼저 열어 두지 않으면 팝업 차단에 걸린다
  const openFile = async (r) => {
    const win = window.open('', '_blank');
    try {
      const res = await fetch(`${API_HOST}/api/vehicle-services/${r._id}/file`);
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
    // 급한 차부터: 검사·점검 중 더 이른 날짜 순
    .sort((a, b) => {
      const da = Math.min(a.inspection?.dday ?? 99999, a.maintenance?.dday ?? 99999);
      const db = Math.min(b.inspection?.dday ?? 99999, b.maintenance?.dday ?? 99999);
      return da - db;
    });

  const cell = { padding: '0.45rem 0.5rem', verticalAlign: 'top', borderBottom: '1px solid var(--border-color)' };
  const input = { width: '100%', padding: '0.35rem 0.45rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.8rem', boxSizing: 'border-box' };
  const label = { display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 };
  const small = { fontSize: '0.72rem', color: 'var(--text-muted)' };

  const selectedRow = detail?.row || rows.find((r) => r.vehicleId === selectedId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const count = rows.filter(f.test).length;
          const on = filter === f.id;
          const color = f.id.endsWith('over') ? 'var(--error)' : '#d97706';
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '980px' }}>
          <thead style={{ background: 'var(--bg-main)', color: 'var(--text-muted)' }}>
            <tr>
              {['차량번호', '차종', '계약자', '다음 자동차검사', '다음 정기점검', '최근 정비·수리', '누적 수리비'].map((h) => (
                <th key={h} style={{ ...cell, textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={7} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                {loading ? '불러오는 중...' : '해당하는 차량이 없습니다.'}
              </td></tr>
            ) : visible.map((r) => (
              <tr
                key={r.vehicleId}
                onClick={() => openVehicle(r.vehicleId)}
                style={{ cursor: 'pointer', background: selectedId === r.vehicleId ? 'var(--bg-main)' : undefined }}
              >
                <td style={cell}>
                  <div style={{ fontWeight: 800, color: 'var(--text-bright)' }}>{r.plateNo || '-'}</div>
                  <div style={small}>{r.status}</div>
                </td>
                <td style={cell}>{r.carModel}</td>
                <td style={cell}>{r.partyName || '-'}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  {r.inspection ? (
                    <>
                      <Due item={r.inspection} />
                      <div style={small}>기간 {r.inspection.windowStart} ~ {r.inspection.windowEnd}</div>
                    </>
                  ) : <span style={small}>최초등록일 없음</span>}
                </td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  {r.maintenance ? (
                    <>
                      <Due item={r.maintenance} />
                      <div style={small} title={r.maintenance.basis}>{r.maintenance.intervalMonths}개월 주기{r.maintenance.kmPerMonth ? ' · 실주행' : ''}</div>
                    </>
                  ) : <span style={small}>미가입</span>}
                </td>
                <td style={cell}>
                  {r.lastRecord ? (
                    <>
                      <div>{r.lastRecord.date} {r.lastRecord.kind}</div>
                      {r.lastRecord.description && <div style={small}>{r.lastRecord.description}</div>}
                    </>
                  ) : <span style={small}>기록 없음</span>}
                </td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{r.repairTotal ? won(r.repairTotal) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>자동차검사</strong> 최초등록일 2년 뒤, 그 뒤 1년마다. 검사일 앞뒤 31일 안에 받아야 합니다 (기간이 지나면 '지남') ·{' '}
        <strong>정기점검</strong> 일반정비 가입 차만, 1만 km마다 (약정 주행거리로 주기를 정하고, 주행거리 기록이 쌓이면 실제 주행도 봅니다).
        차를 눌러 기록을 남기면 다음 날짜와 캘린더가 바로 바뀝니다.
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
                    <Due item={selectedRow.inspection} />
                    <div style={small}>검사 기간 {selectedRow.inspection.windowStart} ~ {selectedRow.inspection.windowEnd}</div>
                    <div style={small}>{selectedRow.inspection.round}회차{selectedRow.inspection.lastDone ? ` · 지난 검사 ${selectedRow.inspection.lastDone}` : ''}</div>
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
                    <Due item={selectedRow.maintenance} />
                    <div style={small}>{selectedRow.maintenance.basis}</div>
                  </>
                ) : <div style={small}>일반정비 미가입 차량입니다.</div>}
              </div>
            </div>

            {canWrite && (
              <form onSubmit={submit} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div style={{ gridColumn: '1 / -1', fontWeight: 800, fontSize: '0.85rem', color: 'var(--text-bright)' }}>
                  {editingId ? '기록 고치기' : '기록 남기기'}
                </div>
                <label style={label}>종류
                  <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={input}>
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
                <label style={label}>날짜
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={input} required />
                </label>
                <label style={label}>주행거리(km)
                  <MoneyInput value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })} placeholder="계기판 숫자" style={input} />
                </label>
                <label style={label}>금액
                  <MoneyInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" style={input} />
                </label>
                <label style={{ ...label, gridColumn: '1 / -1' }}>정비소·검사소
                  <input value={form.shop} onChange={(e) => setForm({ ...form, shop: e.target.value })} style={input} />
                </label>
                <label style={{ ...label, gridColumn: '1 / -1' }}>내용
                  <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="엔진오일·필터 교환, 브레이크패드 등" style={input} />
                </label>
                <label style={{ ...label, gridColumn: '1 / -1' }}>메모
                  <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} style={input} />
                </label>
                {!editingId && (
                  <label style={{ ...label, gridColumn: '1 / -1' }}>영수증·검사증 (선택)
                    <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontSize: '0.78rem' }} />
                  </label>
                )}
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                  {editingId && (
                    <button type="button" onClick={resetForm} style={{ border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                      취소
                    </button>
                  )}
                  <button type="submit" disabled={saving} style={{ border: 'none', background: 'var(--primary)', color: '#fff', padding: '0.4rem 0.9rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}>
                    {saving ? '저장 중...' : (editingId ? '고친 내용 저장' : '기록 저장')}
                  </button>
                </div>
              </form>
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
                    <div key={r._id} style={{ padding: '0.4rem 0 0.6rem 0.8rem', position: 'relative', background: editingId === r._id ? 'var(--bg-main)' : undefined }}>
                      <div style={{ position: 'absolute', left: '-5px', top: '0.65rem', width: '8px', height: '8px', borderRadius: '50%', background: r.kind === '사고수리' ? 'var(--error)' : 'var(--primary)' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                        <strong style={{ color: 'var(--text-bright)' }}>{ymd(r.date)}</strong>
                        <span style={{ fontWeight: 700 }}>{r.kind}</span>
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
                      {r.memo && <div style={small}>{r.memo}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VehicleServiceView;
