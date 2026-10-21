import { useState } from 'react';
import MoneyInput from './MoneyInput.jsx';
import { LATE_GRACE_DAYS, daysSinceDue } from './unpaidRules.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);
const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const ymd = (d) => (d ? String(d).slice(0, 10) : '-');

/**
 * [미납으로 처리] / [미납 취소] (대표님 지시 2026-10-21).
 *
 * 전달 청구서가 안 들어왔으면 그 회차에서 한 번 누른다. 누르기 전에 서버가 '누르면 다음 청구서가
 * 어떻게 바뀌는지'를 계산해 보여 주고(미리보기), 확인을 눌러야 실제로 바뀐다.
 * 다음 미발행 청구서에 미납 원금 + 연체 이자(원금 × 연 이율 × 출금일 사이 일수)가 붙는다.
 * 이미 쌓여 있는 '청구 보류' 이자는 건드리지 않는다. 핸드폰에서도 누르기 쉽게 버튼을 크게 둔다.
 */
export default function UnpaidBox({ scheduleId, round, rounds, onDone, showToast }) {
  const [preview, setPreview] = useState(null); // 서버 미리보기 결과
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(''); // 일부만 들어왔으면 들어온 금액
  const isUnpaid = round.status === '미납';
  const action = isUnpaid ? 'unmark' : 'mark';
  const since = daysSinceDue(round);
  const inGrace = since <= LATE_GRACE_DAYS;

  // 이 회차 미납이 붙어 있는 다음 청구서(이미 청구 중이면 알려 준다)
  const chargedIn = isUnpaid
    ? rounds.find((r) => r.no > round.no && Number(r.prevUnpaid) > 0 && Number(r.interest) >= 0 && r.no === round.no + 1)
    : null;

  const call = async (dryRun) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/${scheduleId}/rounds/${round.no}/unpaid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, dryRun, ...(action === 'mark' && paid !== '' ? { paidAmount: Number(String(paid).replace(/[^0-9]/g, '')) || 0 } : {}) })
      });
      const data = await res.json();
      if (!data.success) { showToast?.(data.message || '처리하지 못했습니다.', 'error'); return; }
      if (dryRun) setPreview(data);
      else { setPreview(null); showToast?.(data.message, 'success'); onDone?.(); }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const bigBtn = (color, filled) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
    padding: '0.55rem 1rem', minHeight: '40px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 800, cursor: busy ? 'wait' : 'pointer',
    border: `1px solid ${color}`, background: filled ? color : '#fff', color: filled ? '#fff' : color
  });
  const first = preview?.changes?.[0];

  return (
    <div style={{ border: `1px solid ${isUnpaid ? '#fecaca' : '#e2e8f0'}`, background: isUnpaid ? '#fff7f7' : '#f8fafc', borderRadius: '8px', padding: '0.7rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.82rem' }}>
          <b>입금 확인</b>{' '}
          {isUnpaid
            ? <span style={{ color: '#dc2626', fontWeight: 700 }}>미납 {won(Math.max(0, (round.total || 0) - (round.paidAmount || 0)))}</span>
            : <span style={{ color: 'var(--text-muted)' }}>출금일 {ymd(round.dueDate)} · {since >= 0 ? `${since}일 지남` : `${-since}일 남음`}</span>}
        </div>
        {!preview && (
          inGrace && !isUnpaid
            ? <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>출금일 뒤 {LATE_GRACE_DAYS}일이 지나면 미납으로 처리할 수 있습니다</span>
            : (
              <button type="button" disabled={busy} onClick={() => call(true)} style={bigBtn(isUnpaid ? '#475569' : '#dc2626', !isUnpaid)}>
                {busy ? '계산 중…' : (isUnpaid ? '미납 취소' : '미납으로 처리')}
              </button>
            )
        )}
      </div>

      {isUnpaid && !preview && chargedIn && (
        <div style={{ fontSize: '0.76rem', color: '#991b1b' }}>
          {chargedIn.no}회차 청구서에 미납 원금 {won(chargedIn.prevUnpaid)}{Number(chargedIn.interest) > 0 ? ` + 연체 이자 ${won(chargedIn.interest)}` : ''}이 붙어 있습니다.
        </div>
      )}

      {preview && (
        <div style={{ background: '#fff', border: '1px dashed #f59e0b', borderRadius: '8px', padding: '0.6rem 0.7rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#92400e' }}>
            {action === 'mark' ? `${round.no}회차를 미납으로 처리하면` : `${round.no}회차 미납을 취소하면`}
          </div>
          {action === 'mark' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
              <span>일부만 들어왔으면 들어온 금액</span>
              <MoneyInput
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                placeholder="0"
                style={{ width: '120px', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
              />
              <button type="button" disabled={busy} onClick={() => call(true)} style={{ ...bigBtn('#92400e', false), minHeight: '32px', padding: '0.3rem 0.7rem', fontSize: '0.76rem' }}>다시 계산</button>
              <span style={{ color: 'var(--text-muted)' }}>안 낸 돈 {won(preview.owe)}</span>
            </div>
          )}
          {first ? (
            <div style={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
              <div><b>{first.no}회차</b> 청구서 (출금일 {ymd(first.dueDate)})</div>
              {action === 'mark' ? (
                <>
                  <div>· 미납 원금 <b>{won(first.after.prevUnpaid)}</b></div>
                  <div>· 연체 이자 <b>{won(first.after.interest)}</b>{first.interestRate ? ` (연 ${first.interestRate}% × ${first.interestDays}일)` : ''}</div>
                </>
              ) : (
                <div>· 붙어 있던 미납 원금·이자를 뺍니다</div>
              )}
              <div>· 청구액 {won(first.before.total)} → <b style={{ color: action === 'mark' ? '#dc2626' : '#16a34a' }}>{won(first.after.total)}</b></div>
              {first.approved && (
                <div style={{ fontSize: '0.76rem', color: '#b45309', fontWeight: 700 }}>
                  {first.no}회차는 발송 승인해 둔 청구서입니다. 바뀐 금액으로 발송 센터에서 다시 승인해야 나갑니다.
                </div>
              )}
              {preview.changes.length > 1 && (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>그 뒤 {preview.changes.length - 1}개 회차도 함께 다시 계산됩니다.</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              바뀌는 청구서가 없습니다(다음 청구서를 이미 발행했거나 마지막 회차입니다).
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button type="button" disabled={busy} onClick={() => call(false)} style={{ ...bigBtn(action === 'mark' ? '#dc2626' : '#475569', true), flex: '1 1 140px' }}>
              {busy ? '처리 중…' : (action === 'mark' ? '확인, 미납 처리' : '확인, 미납 취소')}
            </button>
            <button type="button" disabled={busy} onClick={() => setPreview(null)} style={{ ...bigBtn('#64748b', false), flex: '1 1 100px' }}>
              그만두기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

