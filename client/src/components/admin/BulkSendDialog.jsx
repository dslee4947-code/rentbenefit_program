import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Send, X } from 'lucide-react';
import InvoiceSheet, { makeInvoicePdf } from './InvoiceSheet.jsx';
import PaymentDayBadge from './PaymentDayBadge.jsx';
import { buildRoundForm, formTotals, roundSaveBody } from './billingForm.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const nameOf = (it) => it.company?.name || it.customer?.name || it.contract?.contractNo || '';
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/**
 * 출금일 하나의 청구서를 한 번에 보낸다(청구 대상 → 출금일 줄의 [보내기], 대표님 2026-10-30).
 *
 * 창을 열면 건마다 회차표를 다시 읽어 받는 주소와 금액을 채운다. 담당자가 목록을 보고 [최종 보내기]를 누르면
 * 한 건씩 청구서 화면의 [발행 + 메일]과 같은 길로 보낸다: 금액 저장 → 양식을 PDF로 → 서버가 폴더 저장·메일 발송.
 * 메일은 회사 메일(rent@)로 나가 아웃룩 보낸편지함에 남고, 발송 센터 ③ 발송 결과에도 '보냄'으로 뜬다.
 */
export default function BulkSendDialog({ title, items, currentUser, showToast, onClose, onDone }) {
  // 줄마다: 받는 주소, 보낼지, 진행 상태(대기·보내는 중·보냄·실패), 사유
  const [rows, setRows] = useState(() => items.map((it) => ({
    it,
    to: '',
    pick: !it.round.issuedAt,
    total: it.round.total || 0,
    state: it.round.issuedAt ? '이미 발행' : '',
    message: ''
  })));
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [sheet, setSheet] = useState(null);
  const sheetRef = useRef(null);

  const update = (i, patch) => setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  // 받는 주소와 지금 청구액을 채운다. 청구서 화면에서 열었을 때와 같은 값이다.
  useEffect(() => {
    let alive = true;
    (async () => {
      const filled = await Promise.all(items.map(async (it) => {
        try {
          const data = await fetch(`${API_HOST}/api/billing-schedules/contract/${it.contract._id}`, { cache: 'no-store' }).then((r) => r.json());
          if (!data.success) return {};
          const round = data.schedule.rounds.find((r) => r.no === it.round.no);
          const to = data.schedule.billingEmail || data.schedule.company?.billingEmail || data.schedule.customer?.email || '';
          if (!round) return { to };
          const totals = formTotals(buildRoundForm(it, round, data.schedule.rounds), round.attachments);
          return { to, total: totals.total, issued: Boolean(round.issuedAt) };
        } catch {
          return {};
        }
      }));
      if (!alive) return;
      setRows((cur) => cur.map((r, i) => ({
        ...r,
        to: filled[i].to ?? r.to,
        total: filled[i].total ?? r.total,
        ...(filled[i].issued ? { pick: false, state: '이미 발행' } : {})
      })));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [items]);

  /** 한 건을 보낸다. 실패하면 이유를 돌려준다. */
  const sendOne = async (it, to) => {
    const data = await fetch(`${API_HOST}/api/billing-schedules/contract/${it.contract._id}`, { cache: 'no-store' }).then((r) => r.json());
    if (!data.success) return { error: data.message || '회차표를 불러오지 못했습니다.' };
    const round = data.schedule.rounds.find((r) => r.no === it.round.no);
    if (!round) return { error: '회차를 찾지 못했습니다.' };
    if (round.issuedAt) return { error: '이미 발행한 회차입니다.' };

    // 청구서 화면에서 열었을 때와 같은 값으로 저장하고, 서버가 저장한 값으로 그린다
    const form = buildRoundForm(it, round, data.schedule.rounds);
    const totals = formTotals(form, round.attachments);
    const saved = await fetch(`${API_HOST}/api/billing-schedules/${it.scheduleId}/rounds/${round.no}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
      body: JSON.stringify(roundSaveBody(form, totals))
    }).then((r) => r.json());
    if (!saved.success) return { error: saved.message || '회차를 저장하지 못했습니다.' };
    const stored = saved.round;
    if (Number(stored.total || 0) !== Number(totals.total || 0)) {
      return { error: `화면 계산(${won(totals.total)})과 저장된 청구액(${won(stored.total)})이 다릅니다. 청구서 화면에서 열어 확인해 주세요.` };
    }

    flushSync(() => setSheet({
      item: { ...it, company: data.schedule.company || it.company, customer: data.schedule.customer || it.customer, proration: data.schedule.proration || it.proration },
      round: {
        ...form,
        fine: stored.fine,
        maintenance: stored.maintenance,
        other: stored.other,
        attachments: stored.attachments || round.attachments || [],
        dueDate: stored.dueDate || round.dueDate
      },
      vehicles: data.vehicles || [],
      total: stored.total
    }));
    await settle();
    if (!sheetRef.current) return { error: '청구서 양식을 그리지 못했습니다.' };
    const blob = await makeInvoicePdf(sheetRef.current);

    const fd = new FormData();
    fd.append('file', blob, 'invoice.pdf');
    fd.append('sendEmail', 'true');
    fd.append('to', to);
    const res = await fetch(`${API_HOST}/api/billing-schedules/${it.scheduleId}/rounds/${round.no}/issue`, {
      method: 'POST',
      headers: { 'X-User-Role': currentUser?.role || 'viewer' },
      body: fd
    }).then((r) => r.json());
    if (!res.success) return { error: res.message || '발행하지 못했습니다.' };
    if (res.mailError) return { error: `청구서는 발행했지만 메일을 보내지 못했습니다. ${res.mailError}`, issued: true };
    return { total: stored.total };
  };

  const targets = rows.filter((r) => r.pick && !r.state);
  const badMail = targets.filter((r) => !isEmail(r.to));
  const sum = targets.reduce((s, r) => s + (Number(r.total) || 0), 0);

  const runAll = async () => {
    if (currentUser?.role === 'viewer') { showToast?.('발송 권한이 없습니다.', 'error'); return; }
    if (!targets.length) { showToast?.('보낼 청구서를 골라 주세요.', 'error'); return; }
    if (badMail.length) { showToast?.(`받는 주소가 없거나 틀린 건이 ${badMail.length}건 있습니다.`, 'error'); return; }
    if (!window.confirm(`${title} 청구서 ${targets.length}건(${won(sum)})을 고객에게 메일로 보냅니다.\n실제로 발송됩니다. 보낼까요?`)) return;

    setRunning(true);
    let ok = 0;
    let bad = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      if (!r.pick || r.state) continue;
      update(i, { state: '보내는 중' });
      try {
        const result = await sendOne(r.it, r.to.trim());
        if (result.error) { bad += 1; update(i, { state: result.issued ? '메일 실패' : '실패', message: result.error }); } else { ok += 1; update(i, { state: '보냄', total: result.total ?? r.total }); }
      } catch (err) {
        bad += 1;
        update(i, { state: '실패', message: err.message || '오류' });
      }
    }
    flushSync(() => setSheet(null));
    setRunning(false);
    setDone(true);
    showToast?.(bad ? `${ok}건 보냈고 ${bad}건은 못 보냈습니다. 사유를 확인해 주세요.` : `${ok}건을 모두 보냈습니다. 발송 센터 ③ 발송 결과에서 확인할 수 있습니다.`, bad ? 'warning' : 'success');
    onDone?.();
  };

  const STATE_COLOR = { 보냄: '#16a34a', '보내는 중': '#2563eb', 실패: '#dc2626', '메일 실패': '#dc2626', '이미 발행': '#64748b' };
  const cell = { padding: '0.45rem 0.5rem', borderBottom: '1px solid var(--border-color)', verticalAlign: 'middle', fontSize: '0.8rem' };

  return (
    <div onClick={() => !running && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '860px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.9rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
          <Send size={16} style={{ color: 'var(--primary)' }} />
          <strong style={{ fontSize: '0.95rem' }}>{title} 청구서 보내기</strong>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {loading ? '받는 주소 불러오는 중…' : `보낼 것 ${targets.length}건 · ${won(sum)}`}
          </span>
          <button type="button" onClick={onClose} disabled={running} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: running ? 'not-allowed' : 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0.4rem 1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ ...cell, width: '32px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    disabled={running || done}
                    checked={rows.some((r) => !r.state) && rows.filter((r) => !r.state).every((r) => r.pick)}
                    onChange={(e) => setRows((cur) => cur.map((r) => (r.state ? r : { ...r, pick: e.target.checked })))}
                  />
                </th>
                <th style={cell}>계약자</th><th style={cell}>회차 · 출금일</th><th style={{ ...cell, textAlign: 'right' }}>청구액</th><th style={cell}>받는 주소</th><th style={cell}>결과</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.it.scheduleId}-${r.it.round.no}`} style={{ opacity: r.state === '이미 발행' ? 0.55 : 1 }}>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <input type="checkbox" checked={r.pick} disabled={running || done || Boolean(r.state)} onChange={(e) => update(i, { pick: e.target.checked })} />
                  </td>
                  <td style={cell}><strong>{nameOf(r.it)}</strong><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.it.carSummary || ''}</div></td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}><PaymentDayBadge date={r.it.round.dueDate} /> {r.it.round.no}회차 · {String(r.it.round.dueDate || '').slice(0, 10)}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{won(r.total)}</td>
                  <td style={cell}>
                    <input
                      value={r.to}
                      disabled={running || done || Boolean(r.state)}
                      onChange={(e) => update(i, { to: e.target.value })}
                      placeholder="받을 이메일"
                      style={{ width: '100%', minWidth: '170px', padding: '0.3rem 0.45rem', borderRadius: '5px', fontSize: '0.78rem', border: `1px solid ${!r.pick || r.state || isEmail(r.to) ? 'var(--border-color)' : '#f87171'}` }}
                    />
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap', fontWeight: 700, color: STATE_COLOR[r.state] || 'var(--text-muted)' }}>
                    {r.state || (r.pick ? '보낼 예정' : '빼기')}
                    {r.message && <div style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: '200px' }}>{r.message}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 1rem', borderTop: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            회사 메일로 나가 아웃룩 보낸편지함에 남고, 발송 센터 ③ 발송 결과에서도 볼 수 있습니다. 이미 발행한 회차는 다시 보내지 않습니다.
          </span>
          {done ? (
            <button type="button" onClick={onClose} style={{ marginLeft: 'auto', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.5rem 1.1rem', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}>닫기</button>
          ) : (
            <button
              type="button"
              onClick={runAll}
              disabled={running || loading || !targets.length}
              style={{ marginLeft: 'auto', background: '#2563eb', color: '#fff', border: 'none', padding: '0.5rem 1.1rem', borderRadius: '6px', fontWeight: 800, whiteSpace: 'nowrap', cursor: running || loading || !targets.length ? 'not-allowed' : 'pointer', opacity: running || loading || !targets.length ? 0.6 : 1 }}
            >
              {running ? '보내는 중…' : `최종 보내기 (${targets.length}건)`}
            </button>
          )}
        </div>
      </div>
      {sheet && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
          <InvoiceSheet innerRef={sheetRef} item={sheet.item} round={sheet.round} vehicles={sheet.vehicles} total={sheet.total} />
        </div>
      )}
    </div>
  );
}
