import { useState } from 'react';
import { ScrollText, UserPen, X, FileClock } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => (n || n === 0) ? `${Number(n).toLocaleString()}원` : '-';
const ymd = (d) => (d ? String(d).slice(0, 10) : '-');

// 운전자 변경이 끝난 단계. 기본은 감춘다.
const FINISHED = ['변경완료', '납부완료', '고객납부'];

/**
 * 고지서 관리 > 운전자 변경.
 *
 * 범칙금·과태료를 실제 운전자(임차인) 앞으로 넘길 때 관공서(구청·경찰서)에 세 가지를 낸다.
 *   1. 고지서
 *   2. 계약사실 증명원 — 장기렌트 계약서엔 차량번호가 없어(출고 전 계약) 차량번호·차대번호가 든 이 서류가 있어야 한다
 *   3. 운전자 변경 신청 양식 — 운전자 정보를 적는 관공서 양식(대표님이 양식을 올려 주시면 여기서 채워 만든다)
 * 이 탭은 [명의 변경]으로 처리할 고지서를 모아, 운전자 정보를 적고 계약사실 증명원을 가져오는 곳이다.
 *
 * @param {{ items: object[], loading: boolean, currentUser: object, showToast: Function, onChanged: Function, onOpenFact: Function }} props
 *   items = 고지서 관리의 장기렌트 고지서 목록(collectNotices 결과)
 */
export default function DriverChangeList({ items, loading, currentUser, showToast, onChanged, onOpenFact }) {
  const [showAll, setShowAll] = useState(false); // 명의 변경이 아닌 건까지
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(null); // { row, driverName, driverPhone, driverAddress }
  const [saving, setSaving] = useState(false);
  const canEdit = currentUser?.role !== 'viewer';

  const rows = items.filter((x) => (showAll || x.handling === '명의변경') && (showDone || !FINISHED.includes(x.noticeStatus)));

  const save = async () => {
    const { row } = editing;
    setSaving(true);
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/${row.scheduleId}/rounds/${row.roundNo}/attachments/${row.index}/driver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ driverName: editing.driverName, driverPhone: editing.driverPhone, driverAddress: editing.driverAddress })
      }).then((r) => r.json());
      showToast?.(res.message || (res.success ? '저장했습니다.' : '저장하지 못했습니다.'), res.success ? 'success' : 'error');
      if (res.success) { setEditing(null); onChanged?.(); }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const th = { padding: '0.6rem 0.7rem', fontSize: '0.78rem', fontWeight: 800, textAlign: 'left', whiteSpace: 'nowrap' };
  const td = { padding: '0.6rem 0.7rem', fontSize: '0.82rem', verticalAlign: 'top' };
  const linkBtn = (color) => ({ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', border: `1px solid ${color}`, background: '#fff', color, borderRadius: '6px', padding: '0.28rem 0.6rem', fontSize: '0.76rem', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' });
  const input = { padding: '0.45rem 0.55rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.88rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.1rem', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
        고지서를 실제 운전자(임차인) 앞으로 넘길 때 관공서(구청·경찰서)에 <b>고지서 · 계약사실 증명원 · 운전자 변경 신청 양식</b>을 냅니다.
        장기렌트 계약서에는 차량번호가 없어 <b>차량번호·차대번호가 든 계약사실 증명원</b>이 꼭 있어야 합니다.
        <br />[운전자 정보]에 운전자를 적고, [계약사실 증명원]으로 저장해 둔 증명원을 열거나 새로 만들어 저장하세요.
        <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#b45309', fontWeight: 700 }}>
          <FileClock size={14} /> 운전자 변경 신청 양식(관공서 제출용)은 양식을 받으면 이 화면에서 운전자 정보로 채워 만들 수 있게 붙입니다.
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text-bright)' }}>{rows.length}건</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 명의 변경이 아닌 고지서도 보기
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 끝난 건도 보기
        </label>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)' }}>
              {['계약사', '차량번호', '종류 · 고지번호', '위반일', '납부기한', '금액', '운전자', '접수처', '지금 단계', '서류'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>불러오는 중...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                {showAll ? '고지서가 없습니다.' : '[명의 변경]으로 처리할 고지서가 없습니다. 장기렌트 고지서 탭에서 처리 방식을 [명의 변경]으로 바꾸면 여기 올라옵니다.'}
              </td></tr>
            ) : rows.map((x) => (
              <tr key={`${x.scheduleId}-${x.roundNo}-${x.index}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ ...td, fontWeight: 700 }}>
                  {x.partyName || '-'}
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 600 }}>{x.contractNo}</div>
                </td>
                <td style={{ ...td, fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>{x.plateNo || '-'}</td>
                <td style={td}>
                  {x.kind || '-'}
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{x.noticeNo || ''}</div>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{ymd(x.occurredAt)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{ymd(x.noticeDueDate)}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{won(x.amount)}</td>
                <td style={td}>
                  {x.driverName
                    ? (<>
                      <b>{x.driverName}</b>
                      {x.driverPhone && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{x.driverPhone}</div>}
                      {x.driverAddress && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', maxWidth: '200px' }}>{x.driverAddress}</div>}
                    </>)
                    : <span style={{ color: '#dc2626', fontWeight: 700 }}>아직 없음</span>}
                </td>
                <td style={{ ...td, fontSize: '0.78rem' }}>{x.transferAgency || '-'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700 }}>{x.noticeStatus}</td>
                <td style={td}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {canEdit && (
                      <button type="button" onClick={() => setEditing({ row: x, driverName: x.driverName || '', driverPhone: x.driverPhone || '', driverAddress: x.driverAddress || '' })} style={linkBtn('#7c3aed')}>
                        <UserPen size={13} /> 운전자 정보
                      </button>
                    )}
                    <button type="button" onClick={() => onOpenFact(x)} disabled={!x.contractId} style={linkBtn('#047857')}>
                      <ScrollText size={13} /> 계약사실 증명원
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div onClick={() => !saving && setEditing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '440px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 800 }}>운전자 정보</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{editing.row.plateNo} · {editing.row.kind} · 위반일 {ymd(editing.row.occurredAt)}</div>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            {[
              ['driverName', '운전자 이름 (법인이면 임직원 이름)'],
              ['driverPhone', '연락처'],
              ['driverAddress', '주소']
            ].map(([k, label]) => (
              <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                {label}
                <input value={editing[k]} onChange={(e) => setEditing((f) => ({ ...f, [k]: e.target.value }))} style={input} />
              </label>
            ))}
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              관공서 양식에 더 적을 칸(생년월일·면허번호 등)이 있으면 양식을 받은 뒤 여기에 늘립니다.
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" onClick={save} disabled={saving} style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{saving ? '저장 중…' : '저장'}</button>
              <button type="button" onClick={() => setEditing(null)} style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
