import { useState, useEffect, useRef } from 'react';
import { Upload, X } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ymd = (d) => (d ? String(d).slice(0, 10) : '-');
const KINDS = ['범칙금', '과태료', '통행료', '정비내역', '기타'];
const AMOUNT_KINDS = ['범칙금', '과태료', '통행료', '정비내역'];

/**
 * 범칙금·과태료 고지서를 '다음에 나갈 청구서'에 바로 올린다.
 *
 * 고지서는 아무 때나 날아온다. 그때마다 달을 찾아 회차를 고르게 하면
 * 이미 보낸 청구서에 잘못 붙이기 쉬워, 대상 회차를 서버가 정하고 화면에는 확인만 시킨다.
 */
function UpcomingDocUpload({ onClose, onDone, showToast, currentUser }) {
  const [list, setList] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [picked, setPicked] = useState(null);
  // 고른 계약에 묶인 차량. 한 대면 차량번호를 채워 주고, 여러 대면 골라 쓴다.
  const [vehicles, setVehicles] = useState([]);
  const [customPlate, setCustomPlate] = useState(false);
  const [kind, setKind] = useState(KINDS[0]);
  const [amount, setAmount] = useState('');
  const [plateNo, setPlateNo] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_HOST}/api/billing-schedules`);
        const data = await res.json();
        if (data.success) setList(data.items || []);
      } catch {
        showToast?.('계약 목록을 불러오지 못했습니다.', 'error');
      }
    })();
  }, [showToast]);

  /**
   * 계약을 고르면 그 계약의 차량을 불러와 차량번호를 채운다.
   * 한 대짜리 계약이 대부분이라, 매번 번호를 옮겨 적는 일을 없앤다.
   */
  const pickContract = async (x) => {
    setPicked(x);
    setVehicles([]);
    setCustomPlate(false);
    setPlateNo('');
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/contract/${x.contractId}`);
      const data = await res.json();
      if (!data.success) return;
      const list = (data.vehicles || []).filter((v) => v.plateNo);
      setVehicles(list);
      if (list.length) setPlateNo(list[0].plateNo); // 첫 차량을 기본으로
    } catch { /* 차량을 못 불러와도 손으로 적으면 된다 */ }
  };

  const kw = keyword.trim().toLowerCase();
  const shown = kw
    ? list.filter((x) => [x.partyName, x.contractNo].some((v) => (v || '').toLowerCase().includes(kw)))
    : list;

  const handleUpload = async (file) => {
    if (!file || !picked) return;
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      setUploading(true);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      fd.append('amount', String(AMOUNT_KINDS.includes(kind) ? (Number(amount) || 0) : 0));
      if (plateNo.trim()) fd.append('plateNo', plateNo.trim());
      if (occurredAt) fd.append('occurredAt', occurredAt);

      const res = await fetch(`${API_HOST}/api/billing-schedules/contract/${picked.contractId}/upcoming/attachments`, {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' },
        body: fd
      });
      const data = await res.json();
      if (data.success) {
        showToast?.(data.message, 'success');
        setAmount('');
        setPlateNo('');
        setOccurredAt('');
        onDone?.();
        onClose?.();
      } else {
        showToast?.(data.message || '올리지 못했습니다.', 'error');
      }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const inputStyle = { width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.85rem' };
  const labelStyle = { fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' };

  return (
    <div style={{ background: '#fff', border: '1px solid var(--primary)', borderRadius: '10px', padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Upload size={15} style={{ color: 'var(--primary)' }} />
        <span style={{ fontWeight: '800', fontSize: '0.9rem', color: 'var(--text-bright)' }}>범칙금 · 과태료 등록</span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>다음에 나갈 청구서에 붙습니다</span>
        <button
          type="button"
          onClick={onClose}
          style={{ marginLeft: 'auto', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
        <div>
          <label style={labelStyle}>계약 고르기</label>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="계약자 / 계약번호 검색"
            style={inputStyle}
          />
          <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', marginTop: '0.4rem' }}>
            {shown.length === 0 ? (
              <div style={{ padding: '0.8rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                {list.length ? '검색 결과가 없습니다.' : '회차표가 있는 계약이 없습니다.'}
              </div>
            ) : shown.map((x) => (
              <div
                key={x.scheduleId}
                onClick={() => pickContract(x)}
                style={{
                  padding: '0.45rem 0.6rem',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-color)',
                  background: picked?.scheduleId === x.scheduleId ? 'var(--primary-glow)' : 'transparent'
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-bright)' }}>{x.partyName}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {x.contractNo}
                  {x.upcoming ? ` · 다음 ${x.upcoming.no}회차 (출금 ${ymd(x.upcoming.dueDate)})` : ' · 남은 회차 없음'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {picked?.upcoming && (
            <div style={{ background: 'var(--bg-main)', borderRadius: '6px', padding: '0.5rem 0.7rem', fontSize: '0.8rem' }}>
              <div style={{ fontWeight: '700', color: 'var(--text-bright)' }}>{picked.partyName}</div>
              <div style={{ color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                {picked.upcoming.no}회차 · 출금 {ymd(picked.upcoming.dueDate)} · 발송 예정 {ymd(picked.upcoming.sendDate)}
              </div>
              {picked.upcoming.attachmentCount > 0 && (
                <div style={{ color: 'var(--primary)', fontWeight: '700', marginTop: '0.15rem' }}>
                  이미 붙은 서류 {picked.upcoming.attachmentCount}건
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inputStyle, width: '100px' }}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <MoneyInput
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ ...inputStyle, flex: 1, ...(AMOUNT_KINDS.includes(kind) ? {} : { background: 'var(--bg-main)', color: 'var(--text-muted)' }) }}
              disabled={!AMOUNT_KINDS.includes(kind)}
              placeholder="금액"
            />
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {vehicles.length > 1 && !customPlate ? (
              <select
                value={plateNo}
                onChange={(e) => {
                  if (e.target.value === '__custom__') { setCustomPlate(true); setPlateNo(''); }
                  else setPlateNo(e.target.value);
                }}
                style={{ ...inputStyle, flex: 1 }}
              >
                {vehicles.map((v) => (
                  <option key={v._id} value={v.plateNo}>{v.plateNo} · {v.carModel}</option>
                ))}
                <option value="__custom__">직접 입력...</option>
              </select>
            ) : (
              <input
                value={plateNo}
                onChange={(e) => setPlateNo(e.target.value)}
                placeholder={vehicles.length ? '차량번호' : '계약을 고르면 채워집니다'}
                style={{ ...inputStyle, flex: 1 }}
              />
            )}
            <input
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              title="위반일 / 발생일 - 청구서 명세에 찍힙니다 (선택)"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
          {vehicles.length > 1 && (
            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '-0.2rem' }}>
              차량 {vehicles.length}대 계약입니다. 해당 차량을 고르세요.
              {customPlate && (
                <button
                  type="button"
                  onClick={() => { setCustomPlate(false); setPlateNo(vehicles[0].plateNo); }}
                  style={{ marginLeft: '0.4rem', border: 'none', background: 'none', color: 'var(--primary)', fontWeight: '700', cursor: 'pointer', padding: 0 }}
                >
                  목록에서 고르기
                </button>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            disabled={!picked?.upcoming || uploading}
            onChange={(e) => handleUpload(e.target.files?.[0])}
            style={{ ...inputStyle, padding: '0.3rem' }}
          />
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            {picked?.upcoming
              ? `파일을 고르면 ${picked.upcoming.no}회차 청구서에 바로 붙고, 적어 둔 금액이 그 회차 청구액에 더해집니다. 발생일은 청구서 명세에 찍히는 참고 정보라 비워도 됩니다.`
              : '계약을 먼저 고르세요.'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default UpcomingDocUpload;
