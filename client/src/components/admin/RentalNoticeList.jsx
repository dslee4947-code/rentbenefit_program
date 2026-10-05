import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Trash2, RefreshCw } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const ymd = (d) => (d ? String(d).slice(0, 10) : '');

// 서버(models/RentalNotice.js)와 같은 값이라야 한다
const HANDLINGS = ['고객청구', '명의변경', '회사부담'];
const STATUSES_BY_HANDLING = {
  고객청구: ['접수', '안내', '청구', '입금완료'],
  명의변경: ['접수', '안내', '변경완료'],
  회사부담: ['접수', '회사납부']
};
const FINISHED = ['입금완료', '변경완료', '회사납부'];

const daysUntil = (d) => {
  if (!d) return null;
  const t = new Date(d);
  const now = new Date();
  return Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
};

/**
 * 대차(단기렌트·사고대차·무상대차) 차량의 고지서.
 *
 * 장기렌트는 다음 청구서에 자동으로 붙지만, 대차는 청구할 곳이 건마다 달라
 * (운전한 고객, 명의 변경, 회사 부담) 여기서 한 건씩 정하고 끝날 때까지 지켜본다.
 * 칸을 고치면 바로 저장된다.
 */
function RentalNoticeList({ showToast, currentUser, reloadKey }) {
  const [items, setItems] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true); // 처음 불러오기 전까지만 '불러오는 중'을 보여 준다

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_HOST}/api/rental-notices${showAll ? '?all=1' : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) setItems(data.items || []);
      else showToast?.(data.message || '대차 고지서를 불러오지 못했습니다.', 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showAll, showToast]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const canWrite = currentUser?.role !== 'viewer';

  /** 한 칸을 고쳐 바로 저장한다. 실패하면 목록을 다시 읽어 화면을 되돌린다. */
  const save = async (id, patch) => {
    if (!canWrite) { showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error'); return; }
    setItems((prev) => prev.map((x) => (x._id === id ? { ...x, ...patch } : x)));
    try {
      const res = await fetch(`${API_HOST}/api/rental-notices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (!data.success) { showToast?.(data.message || '저장하지 못했습니다.', 'error'); load(); }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
      load();
    }
  };

  const remove = async (x) => {
    if (!window.confirm(`${x.plateNo} ${x.kind} ${won(x.amount)} 고지서를 삭제할까요?\n저장된 파일은 폴더에 그대로 남습니다.`)) return;
    const res = await fetch(`${API_HOST}/api/rental-notices/${x._id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    showToast?.(data.message || '처리했습니다.', data.success ? 'success' : 'error');
    load();
  };

  // 창을 먼저 열어 두지 않으면 팝업 차단에 걸린다
  const openFile = async (x) => {
    const win = window.open('', '_blank');
    try {
      const res = await fetch(`${API_HOST}/api/rental-notices/${x._id}/file`);
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

  const open = items.filter((x) => !FINISHED.includes(x.status));
  const openTotal = open.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const cell = { padding: '0.45rem 0.45rem', verticalAlign: 'middle', borderBottom: '1px solid var(--border-color)' };
  const input = { width: '100%', padding: '0.25rem 0.4rem', borderRadius: '5px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.78rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
        <strong style={{ color: 'var(--text-bright)' }}>진행 중 {open.length}건 · {won(openTotal)}</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 끝난 건도 보기
        </label>
        <button type="button" onClick={load} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '1000px' }}>
          <thead style={{ background: 'var(--bg-main)', color: 'var(--text-muted)' }}>
            <tr>
              {['차량번호', '종류', '금액', '위반일', '납부기한', '운전한 고객', '연락처', '처리 방식', '진행', '메모', ''].map((h) => (
                <th key={h} style={{ ...cell, textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={11} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                {loading ? '불러오는 중...' : '대차 고지서가 없습니다. [여러 장 올리기]로 올리면 대차 건은 여기로 모입니다.'}
              </td></tr>
            ) : items.map((x) => {
              const dday = FINISHED.includes(x.status) ? null : daysUntil(x.noticeDueDate);
              const statuses = STATUSES_BY_HANDLING[x.handling] || STATUSES_BY_HANDLING.고객청구;
              return (
                <tr key={x._id} style={{ opacity: FINISHED.includes(x.status) ? 0.6 : 1 }}>
                  <td style={cell}>
                    <div style={{ fontWeight: 800, color: 'var(--text-bright)' }}>{x.plateNo}</div>
                    {x.rentalType && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{x.rentalType}{x.insuranceCompany ? ` · ${x.insuranceCompany}` : ''}</div>}
                  </td>
                  <td style={cell}>{x.kind}</td>
                  <td style={{ ...cell, width: '110px' }}>
                    <MoneyInput
                      value={x.amount}
                      disabled={!canWrite}
                      onChange={(e) => setItems((prev) => prev.map((y) => (y._id === x._id ? { ...y, amount: e.target.value } : y)))}
                      onBlur={(e) => save(x._id, { amount: Number(String(e.target.value).replace(/,/g, '')) || 0 })}
                      style={input}
                    />
                    {x.surcharge > 0 && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>부가 {won(x.surcharge)} 제외</div>}
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{ymd(x.occurredAt) || '-'}{x.violationTime ? ` ${x.violationTime}` : ''}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    {ymd(x.noticeDueDate) || '-'}
                    {dday !== null && (
                      <div style={{ fontSize: '0.72rem', fontWeight: 800, color: dday < 0 ? 'var(--error)' : (dday <= 3 ? '#d97706' : 'var(--text-muted)') }}>
                        {dday > 0 ? `D-${dday}` : (dday === 0 ? '오늘까지' : `${-dday}일 지남`)}
                      </div>
                    )}
                  </td>
                  <td style={{ ...cell, width: '120px' }}>
                    <input
                      defaultValue={x.customerName}
                      disabled={!canWrite}
                      placeholder="고객 이름"
                      onBlur={(e) => e.target.value !== x.customerName && save(x._id, { customerName: e.target.value })}
                      style={input}
                    />
                  </td>
                  <td style={{ ...cell, width: '120px' }}>
                    <input
                      defaultValue={x.customerContact}
                      disabled={!canWrite}
                      placeholder="연락처"
                      onBlur={(e) => e.target.value !== x.customerContact && save(x._id, { customerContact: e.target.value })}
                      style={input}
                    />
                  </td>
                  <td style={cell}>
                    <select
                      value={x.handling}
                      disabled={!canWrite}
                      // 방식을 바꾸면 그 방식에 없는 단계가 남지 않게 처음 단계로 돌린다
                      onChange={(e) => save(x._id, { handling: e.target.value, status: STATUSES_BY_HANDLING[e.target.value].includes(x.status) ? x.status : '접수' })}
                      style={{ ...input, width: '88px' }}
                    >
                      {HANDLINGS.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </td>
                  <td style={cell}>
                    <select value={x.status} disabled={!canWrite} onChange={(e) => save(x._id, { status: e.target.value })} style={{ ...input, width: '84px', fontWeight: 700 }}>
                      {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={cell}>
                    <input
                      defaultValue={x.memo}
                      disabled={!canWrite}
                      placeholder="메모"
                      onBlur={(e) => e.target.value !== x.memo && save(x._id, { memo: e.target.value })}
                      style={input}
                    />
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => openFile(x)} title="원본 열기" style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
                      <ExternalLink size={14} />
                    </button>
                    {canWrite && (
                      <button type="button" onClick={() => remove(x)} title="잘못 올린 고지서 삭제 (저장된 파일은 남습니다)" style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>고객청구</strong> 운전한 고객에게 청구합니다 (안내 → 청구 → 입금완료) ·{' '}
        <strong>명의변경</strong> 대여계약서를 관공서에 보내 고객에게 직접 고지되게 합니다 ·{' '}
        <strong>회사부담</strong> 직원 운행 등 회사가 냅니다. 미납통행료는 원금만 청구합니다.
      </div>
    </div>
  );
}

export default RentalNoticeList;
