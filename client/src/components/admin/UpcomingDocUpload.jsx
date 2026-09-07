import { useState, useEffect, useRef } from 'react';
import { Upload, X, ScanLine, Send } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ymd = (d) => (d ? String(d).slice(0, 10) : '-');
const won = (n) => (n || n === 0) ? `${Number(n).toLocaleString()}원` : '-';

const STATUS_STYLE = {
  '예정': { bg: '#f1f5f9', color: '#475569' },
  '청구됨': { bg: '#e0f2fe', color: '#0284c7' },
  '입금완료': { bg: '#dcfce7', color: '#16a34a' },
  '미납': { bg: '#fee2e2', color: '#ef4444' }
};
const KINDS = ['범칙금', '과태료', '통행료', '정비내역', '기타'];
// 정비내역만 '정기점검/정비'로 가고 나머지는 '범칙금/과태료'로 합산된다(서버와 같은 규칙)
const isMaintenanceKind = (kind) => ['정비내역', '정비'].includes(String(kind || '').trim());

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
  // 고른 계약의 회차 이력. 어느 회차에 얼마를 청구했고 범칙금이 얼마였는지 보여 준다.
  const [rounds, setRounds] = useState([]);
  const [showAllRounds, setShowAllRounds] = useState(false);
  const [kind, setKind] = useState(KINDS[0]);
  const [customKind, setCustomKind] = useState(''); // '기타'일 때 실제 종류 이름
  const [amount, setAmount] = useState('');
  const [plateNo, setPlateNo] = useState('');
  // 고지서에서 읽는 값. 위반일은 어느 계약자 건인지를 가르는 값이라 눈으로 확인하고 고칠 수 있어야 한다.
  const [occurredAt, setOccurredAt] = useState('');
  const [noticeNo, setNoticeNo] = useState('');
  const [noticeDueDate, setNoticeDueDate] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  // 고른 파일은 바로 올리지 않는다. 먼저 글자를 읽어 칸을 채우고, 확인한 뒤 올린다.
  const [pendingFile, setPendingFile] = useState(null);
  const [reading, setReading] = useState(false);
  const [readResult, setReadResult] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // no-store: 브라우저가 예전 응답을 그대로 쓰면 차량번호가 없던 시절 목록이 보인다
        const res = await fetch(`${API_HOST}/api/billing-schedules`, { cache: 'no-store' });
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
    setRounds([]);
    setCustomPlate(false);
    setPlateNo('');
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/contract/${x.contractId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) return;
      setRounds(data.schedule?.rounds || []);
      setShowAllRounds(false);
      const cars = (data.vehicles || []).filter((v) => v.plateNo);
      setVehicles(cars);
      // 차량번호로 찾아 들어왔으면 그 차량을 골라 준다. 아니면 첫 차량.
      const hit = kw ? cars.find((v) => v.plateNo.toLowerCase().includes(kw)) : null;
      if (cars.length) setPlateNo((hit || cars[0]).plateNo);
    } catch { /* 차량을 못 불러와도 손으로 적으면 된다 */ }
  };

  // 범칙금·과태료는 차량번호로 확인하고 오니, 계약자·계약번호와 함께 차량번호로도 찾게 한다.
  const kw = keyword.trim().toLowerCase();
  const matches = (x) => [x.partyName, x.contractNo, ...(x.plateNos || [])]
    .some((v) => (v || '').toLowerCase().includes(kw));
  const shown = kw ? list.filter(matches) : list;

  /** 목록에 보여 줄 차량번호. 20대짜리 계약도 있어 앞의 몇 대만 적는다. */
  const plateLabel = (x) => {
    const plates = x.plateNos || [];
    if (!plates.length) return '차량번호 없음';
    // 검색어와 맞는 차량이 있으면 그것부터 보여 준다
    const hit = kw ? plates.filter((p) => p.toLowerCase().includes(kw)) : [];
    const head = hit.length ? hit : plates;
    const shownPlates = head.slice(0, 2).join(', ');
    const rest = plates.length - Math.min(head.length, 2);
    return rest > 0 ? `${shownPlates} 외 ${rest}대` : shownPlates;
  };

  /**
   * 고른 파일에서 차량번호와 금액을 읽어 칸을 채운다.
   *
   * 읽은 값을 그대로 올리지 않는다. 잘못 읽은 금액이 청구서로 나가면 되돌리기 어려워,
   * 사람이 눈으로 확인하고 [올리기]를 눌러야 저장된다.
   */
  const handlePickFile = async (file) => {
    if (!file) return;
    setPendingFile(file);
    setReadResult(null);
    if (!/^image\/|^application\/pdf$/.test(file.type)) return; // 읽을 수 없는 형식이면 그냥 둔다

    try {
      setReading(true);
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_HOST}/api/ocr/fine-notice`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) { setReadResult({ error: data.message }); return; }

      setReadResult(data);
      if (data.amount) setAmount(data.amount);
      if (data.plateNo) setPlateNo(data.plateNo);
      if (data.kind && KINDS.includes(data.kind)) setKind(data.kind);
      setOccurredAt(data.violationDate || '');
      setNoticeNo(data.noticeNo || '');
      setNoticeDueDate(data.noticeDueDate || '');

      // 위반일이 렌트 기간 안에 들어 계약이 하나로 좁혀졌을 때만 자동으로 고른다.
      // 기간 밖이거나 겹치는 계약이 둘 이상이면 고르지 않는다. 잘못 붙은 청구서는 되돌리기 어렵다.
      const hit = data.matched;
      if (hit?.contractId && String(hit.contractId) !== String(picked?.contractId)) {
        const target = list.find((x) => String(x.contractId) === String(hit.contractId));
        if (target) {
          await pickContract(target);
          setPlateNo(hit.plateNo);
          if (data.amount) setAmount(data.amount);
        }
      }
    } catch {
      setReadResult({ error: '글자를 읽지 못했습니다. 직접 입력해 주세요.' });
    } finally {
      setReading(false);
    }
  };

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
      // '기타'는 적어 넣은 이름을 그대로 쓴다. 파일명과 청구서 명세에 그 이름이 찍힌다.
      fd.append('kind', kind === '기타' ? (customKind.trim() || '기타') : kind);
      fd.append('amount', String(Number(amount) || 0));
      if (plateNo.trim()) fd.append('plateNo', plateNo.trim());
      if (occurredAt) fd.append('occurredAt', occurredAt);
      if (noticeNo.trim()) fd.append('noticeNo', noticeNo.trim());
      if (noticeDueDate) fd.append('noticeDueDate', noticeDueDate);

      const res = await fetch(`${API_HOST}/api/billing-schedules/contract/${picked.contractId}/upcoming/attachments`, {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' },
        body: fd
      });
      const data = await res.json();
      if (data.success) {
        showToast?.(data.message, 'success');
        setAmount('');
        setCustomKind('');
        setOccurredAt('');
        setNoticeNo('');
        setNoticeDueDate('');
        await pickContract(picked); // 방금 올린 건이 이력에 바로 보이도록
        onDone?.();
      } else {
        showToast?.(data.message || '올리지 못했습니다.', 'error');
      }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setUploading(false);
      setPendingFile(null);
      setReadResult(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // 이력에 보여 줄 회차. 기본은 지나온 것과 이번 회차까지만 보여 준다.
  // 60회차를 전부 펼치면 정작 봐야 할 최근 건이 묻힌다.
  const upcomingNo = picked?.upcoming?.no ?? Infinity;
  const history = showAllRounds
    ? [...rounds].reverse()
    : rounds.filter((r) => r.no <= upcomingNo || r.issuedAt || (r.attachments || []).length).reverse();

  const issuedRounds = rounds.filter((r) => r.issuedAt);
  const paidRounds = rounds.filter((r) => r.status === '입금완료');
  const unpaidRounds = rounds.filter((r) => r.status === '미납');
  const fineTotalAll = rounds.reduce((sum, r) => sum + (Number(r.fine) || 0), 0);

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
            placeholder="차량번호 / 계약자 / 계약번호 검색"
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
                <div style={{ fontSize: '0.76rem', color: 'var(--primary)', fontWeight: '700' }}>
                  {plateLabel(x)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {x.contractNo}
                  {x.upcoming ? ` · 다음 ${x.upcoming.no}회차` : ' · 남은 회차 없음'}
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
            {kind === '기타' && (
              <input
                value={customKind}
                onChange={(e) => setCustomKind(e.target.value)}
                placeholder="종류 이름 (예: 주차위반)"
                style={{ ...inputStyle, width: '150px' }}
              />
            )}
            <MoneyInput
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="금액 (없으면 비워 두세요)"
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
          {/* 위반일은 어느 계약자 건인지를 가르는 값이다. 고지서를 읽으면 채워지고, 못 읽으면 직접 적는다. */}
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...labelStyle, marginBottom: '0.15rem' }}>위반일</label>
              <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ ...labelStyle, marginBottom: '0.15rem' }}>납부기한</label>
              <input type="date" value={noticeDueDate} onChange={(e) => setNoticeDueDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ ...labelStyle, marginBottom: '0.15rem' }}>고지번호</label>
              <input
                value={noticeNo}
                onChange={(e) => setNoticeNo(e.target.value)}
                placeholder="중복 방지"
                title="같은 고지서를 다시 올리는 것을 이 번호로 막습니다"
                style={inputStyle}
              />
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            disabled={uploading}
            onChange={(e) => handlePickFile(e.target.files?.[0])}
            style={{ ...inputStyle, padding: '0.3rem' }}
          />

          {reading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--primary)', fontWeight: '700' }}>
              <ScanLine size={14} /> 고지서에서 차량번호와 금액을 읽는 중...
            </div>
          )}

          {readResult && !reading && (
            <div style={{ background: readResult.error ? '#fef2f2' : 'var(--primary-glow)', border: `1px solid ${readResult.error ? 'var(--error)' : 'var(--primary)'}`, borderRadius: '6px', padding: '0.5rem 0.7rem', fontSize: '0.78rem' }}>
              {readResult.error ? (
                <span style={{ color: 'var(--error)' }}>{readResult.error}</span>
              ) : (
                <>
                  <div style={{ fontWeight: '700', color: 'var(--text-bright)' }}>
                    읽은 값 — {readResult.kind || '종류 미상'} · 차량번호 {readResult.plateNo || '못 찾음'} · 금액 {readResult.amount ? `${Number(readResult.amount).toLocaleString()}원` : '못 찾음'}
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                    위반일 {readResult.violationDate || '못 읽음'}{readResult.violationTime ? ` ${readResult.violationTime}` : ''}
                    {' · '}납부기한 {readResult.noticeDueDate || '못 읽음'}
                    {readResult.noticeNo ? ` · 고지번호 ${readResult.noticeNo}` : ''}
                  </div>

                  {/* 이미 올린 고지서면 무엇보다 먼저 알려야 한다. 두 번 청구되면 되돌리기 어렵다. */}
                  {readResult.duplicate && (
                    <div style={{ background: '#fef2f2', border: '1px solid var(--error)', borderRadius: '5px', padding: '0.35rem 0.5rem', marginTop: '0.3rem', color: 'var(--error)', fontWeight: '800' }}>
                      이미 올린 고지서입니다 — {readResult.duplicate.partyName} {readResult.duplicate.contractNo} {readResult.duplicate.roundNo}회차
                    </div>
                  )}

                  {/* 위반일 기준 판정 결과 */}
                  {readResult.matched ? (
                    <div style={{ color: 'var(--primary)', fontWeight: '700', marginTop: '0.25rem' }}>
                      위반일에 렌트 중이던 계약 — {readResult.matched.partyName} {readResult.matched.contractNo}
                      {readResult.matched.period && (
                        <span style={{ fontWeight: '600', color: 'var(--text-muted)' }}>
                          {' '}({ymd(readResult.matched.period.start)} ~ {ymd(readResult.matched.period.end)} · {readResult.matched.period.basis} 기준)
                        </span>
                      )}
                      {(readResult.matched.finesEmail || readResult.matched.finesEmail2) && (
                        <div style={{ fontWeight: '600', color: 'var(--text-muted)' }}>
                          범칙금 메일 {[readResult.matched.finesEmail, readResult.matched.finesEmail2].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                  ) : readResult.reason && (
                    <div style={{ color: '#d97706', fontWeight: '700', marginTop: '0.25rem' }}>
                      계약을 정하지 못했습니다 — {readResult.reason}
                    </div>
                  )}

                  {/* 정하지 못했을 때는 그 차가 거쳐 간 계약을 늘어놓고 사람이 고르게 한다 */}
                  {!readResult.matched && readResult.contractCandidates?.length > 0 && (
                    <div style={{ marginTop: '0.25rem' }}>
                      {readResult.contractCandidates.map((c) => (
                        <div key={String(c.contractId)} style={{ color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                          {c.partyName} {c.contractNo} · {ymd(c.period?.start)} ~ {ymd(c.period?.end)}
                          {c.position ? ` · 위반일은 ${c.position}` : ''}
                          {list.some((x) => String(x.contractId) === String(c.contractId)) && (
                            <button
                              type="button"
                              onClick={() => {
                                const target = list.find((x) => String(x.contractId) === String(c.contractId));
                                if (target) pickContract(target);
                              }}
                              style={{ marginLeft: '0.35rem', border: '1px dashed var(--primary)', background: '#fff', color: 'var(--primary)', padding: '0.05rem 0.4rem', borderRadius: '4px', fontSize: '0.73rem', fontWeight: '700', cursor: 'pointer' }}
                            >
                              이 계약으로
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!readResult.contractCandidates?.length && readResult.plateNos?.length > 0 && (
                    <div style={{ color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      읽은 번호({readResult.plateNos.join(', ')})가 차량 DB에 없습니다. 계약을 직접 고르세요.
                    </div>
                  )}
                  {readResult.candidates?.length > 1 && (
                    <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      다른 금액 후보:
                      {readResult.candidates.slice(1, 5).map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setAmount(c.amount)}
                          style={{ marginLeft: '0.3rem', border: '1px dashed var(--border-color)', background: '#fff', color: 'var(--primary)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.73rem', fontWeight: '700', cursor: 'pointer' }}
                        >
                          {Number(c.amount).toLocaleString()}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    위 칸의 값을 확인하고 고친 뒤 올려 주세요.
                  </div>
                </>
              )}
            </div>
          )}

          {pendingFile && (
            <button
              type="button"
              onClick={() => handleUpload(pendingFile)}
              disabled={!picked?.upcoming || uploading || reading}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.55rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', cursor: (!picked?.upcoming || uploading || reading) ? 'not-allowed' : 'pointer', opacity: (!picked?.upcoming || uploading || reading) ? 0.6 : 1 }}
            >
              <Send size={14} /> {uploading ? '올리는 중...' : `${picked?.upcoming ? `${picked.upcoming.no}회차에 ` : ''}올리기`}
            </button>
          )}

          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            {picked?.upcoming
              ? `올리면 ${picked.upcoming.no}회차 청구서에 붙고, 적어 둔 금액이 그 회차 청구액에 더해집니다.`
              : '파일을 고르면 차량번호로 계약을 찾아 줍니다. 못 찾으면 왼쪽에서 직접 고르세요.'}
          </div>
        </div>
      </div>

      {/* 고른 계약의 청구 이력 */}
      {picked && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--text-bright)' }}>
              {picked.partyName} 청구 이력
            </span>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{picked.contractNo}</span>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAllRounds((v) => !v)}
                style={{ marginLeft: 'auto', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.25rem 0.6rem', borderRadius: '5px', fontSize: '0.74rem', fontWeight: '700', cursor: 'pointer' }}
              >
                {showAllRounds ? '지나온 회차만 보기' : `전체 ${rounds.length}회차 보기`}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
            {[
              ['청구한 회차', `${issuedRounds.length}건`],
              ['입금 완료', `${paidRounds.length}건`],
              ['미납', `${unpaidRounds.length}건`],
              ['범칙금·과태료 누계', won(fineTotalAll)]
            ].map(([label, value]) => (
              <div key={label} style={{ background: 'var(--bg-main)', borderRadius: '6px', padding: '0.4rem 0.7rem', minWidth: '110px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600' }}>{label}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: '800', color: 'var(--text-bright)', marginTop: '0.1rem' }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead style={{ position: 'sticky', top: 0 }}>
                <tr style={{ background: 'var(--bg-main)', color: 'var(--text-bright)', fontWeight: '700' }}>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', width: '60px' }}>회차</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', width: '100px' }}>출금일</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>렌트료</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>범칙금·과태료</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>청구액</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', width: '80px' }}>상태</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', width: '70px' }}>메일</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '1.2rem', color: 'var(--text-muted)' }}>
                    아직 청구한 회차가 없습니다. 전체 회차를 보려면 위 버튼을 누르세요.
                  </td></tr>
                ) : history.map((r) => {
                  const st = STATUS_STYLE[r.status] || STATUS_STYLE['예정'];
                  // 금액이 0인 서류도 보여 준다. 올렸는지 아닌지를 이 표에서 알 수 있어야 한다.
                  const docs = r.attachments || [];
                  return (
                    <tr key={r.no} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.35rem 0.5rem', textAlign: 'center', fontWeight: '700' }}>{r.no}</td>
                      <td style={{ padding: '0.35rem 0.5rem', textAlign: 'center' }}>{ymd(r.dueDate)}</td>
                      <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>{won(r.monthlyRent)}</td>
                      <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>
                        {r.fine ? <strong style={{ color: 'var(--error)' }}>{won(r.fine)}</strong> : (docs.length ? <span style={{ color: 'var(--text-muted)' }}>0원</span> : '-')}
                        {docs.length > 0 && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: '700' }}>
                            서류 {docs.length}건
                            {docs.some((a) => !Number(a.amount)) && <span style={{ color: '#d97706' }}> · 금액 미입력</span>}
                          </div>
                        )}
                        {docs.length > 0 && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {docs.map((a) => `${a.kind}${a.plateNo ? ` ${a.plateNo}` : ''}`).join(', ')}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: '700' }}>{won(r.total)}</td>
                      <td style={{ padding: '0.35rem 0.5rem', textAlign: 'center' }}>
                        <span style={{ background: st.bg, color: st.color, padding: '0.1rem 0.45rem', borderRadius: '20px', fontSize: '0.7rem', fontWeight: '700' }}>
                          {r.status}
                        </span>
                        {r.paidAt && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{ymd(r.paidAt)}</div>}
                      </td>
                      <td style={{ padding: '0.35rem 0.5rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {r.sentAt ? ymd(r.sentAt) : (r.issuedAt ? '저장만' : '-')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            이 프로그램으로 발행한 건만 남습니다. 엑셀로 보내시던 지난 청구서는 여기에 없습니다.
          </div>
        </div>
      )}
    </div>
  );
}

export default UpcomingDocUpload;
