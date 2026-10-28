import { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { RefreshCw, Send, CheckCircle2, AlertCircle, FileText, X, ChevronLeft, ChevronRight, Eye, Clock, Wallet, ListChecks } from 'lucide-react';
import InvoiceSheet, { makeInvoicePdf } from './InvoiceSheet.jsx';
import ExtensionTag from './ExtensionTag.jsx';
import { buildRoundForm, formTotals, roundSaveBody } from './billingForm.js';
import PaymentDayBadge from './PaymentDayBadge.jsx';
import { paymentDayStripe, paymentDayKey, PAYMENT_DAYS } from './paymentDay.js';
import useBackClose from '../../utils/useBackClose.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const signedWon = (n) => `${n > 0 ? '+' : ''}${Number(n || 0).toLocaleString()}원`;
const ymd = (d) => (d ? String(d).slice(0, 10) : '-');
const mdhm = (d) => (d ? new Date(d).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
// 시험 메일 기본 주소(대표님 지정 2026-10-18). 화면에서 바꾸면 이 브라우저에 기억해 둔다.
const DEFAULT_TEST_MAIL = 'rent_sdibenefit@naver.com';
const readTestMail = () => {
  try { return localStorage.getItem('invoiceTestMail') || DEFAULT_TEST_MAIL; } catch { return DEFAULT_TEST_MAIL; }
};

const nameOf = (it) => it.company?.name || it.customer?.name || it.partyName || it.contract?.contractNo || '';

/**
 * 숨겨 둔 청구서 양식이 자리 잡을 때까지 잠깐 기다린다. flushSync로 DOM은 이미 바뀌어 있다.
 * requestAnimationFrame을 쓰지 않는 이유: 탭이 뒤에 있으면 브라우저가 멈춰 일괄 승인이 멈춘다.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/** 발송일을 사람이 읽는 말로 */
const sendDayLabel = (dday) => {
  if (dday < 0) return `${-dday}일 지남`;
  if (dday === 0) return '오늘 9시';
  if (dday === 1) return '내일 9시';
  return `${dday}일 뒤`;
};

// 발송 결과 표시
const RESULT_STYLE = {
  보냄: { color: '#16a34a', bg: '#dcfce7' },
  '확인 필요': { color: '#7c3aed', bg: '#ede9fe' },
  '메일 실패': { color: '#dc2626', bg: '#fee2e2' },
  실패: { color: '#dc2626', bg: '#fee2e2' },
  '메일 안 감': { color: '#b45309', bg: '#ffedd5' },
  보류: { color: '#d97706', bg: '#fef3c7' }
};

/**
 * 청구서 발송 센터.
 *
 * 담당자의 하루 흐름을 그대로 네 칸으로 나눴다.
 *   ① 확인·승인  보낼 청구서를 본다. 렌트료만 있는 '평소와 같은' 청구서는 한 번에 승인하고,
 *                과태료·미납 이월 등이 붙어 '달라진' 청구서만 한 장씩 미리보기로 확인한다.
 *   ② 보낼 예정  승인한 청구서. 발송일 아침 9시에 서버가 보낸다. 그 전까지는 취소할 수 있다.
 *   ③ 발송 결과  나간 것·실패한 것·멈춘 것. 실패한 건은 여기서 다시 보낸다.
 *   ④ 입금 확인  출금일이 지났는데 입금 처리가 안 된 건. 입금완료·미납을 찍는다.
 *
 * 화면을 열지 않아도 되게 메일로도 알린다: 오후 4시에 '내일 승인 대기', 아침 9시 발송 뒤 '발송 결과'.
 *
 * 승인한 뒤 금액·서류·받는 주소가 바뀌면 서버가 보내지 않고 '보류'로 남긴다. 담당자가 확인한 것과
 * 다른 청구서가 고객에게 나가는 일, 같은 청구서가 두 번 나가는 일은 서버가 막는다.
 */
function AutoSendView({ showToast, currentUser, onChanged }) {
  const [tab, setTab] = useState('review');
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [historyDays, setHistoryDays] = useState(14);
  const [toInput, setToInput] = useState({}); // 줄마다 받는 주소 (고쳐 쓸 수 있다)
  // 평소와 같은 건 중 담당자가 체크를 푼 것. 새로고침해도 유지한다(다시 전부 체크되면 뺀 건이 나간다).
  const [routineExcluded, setRoutineExcluded] = useState(() => new Set());
  const [payPicked, setPayPicked] = useState(() => new Set());
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [sheet, setSheet] = useState(null); // PDF로 뜰 청구서 양식 (한 번에 하나)
  const [review, setReview] = useState(null); // 한 장씩 확인: { list, index, preview, loading }
  const [testMail, setTestMail] = useState(readTestMail);
  const sheetRef = useRef(null);
  const reviewTokenRef = useRef(0); // 확인 창에서 마지막으로 연 청구서. 늦게 온 미리보기를 버린다
  const waitCeoRef = useRef(0); // 이번 승인 중 대표 승인으로 넘긴 건수

  const canWrite = currentUser?.role !== 'viewer';
  // 달라진 청구서는 대표(관리자)가 승인해야 나간다. 직원 승인은 '확인'까지만 된다(서버가 정한다)
  const isCeo = currentUser?.role === 'admin';
  const keyOf = (it) => `${it.scheduleId}-${it.round?.no ?? it.roundNo}`;

  const loadAll = useCallback(async () => {
    try {
      const [q, h, p] = await Promise.all([
        fetch(`${API_HOST}/api/billing-schedules/auto-send/queue?days=${days}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`${API_HOST}/api/billing-schedules/auto-send/history?days=${historyDays}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`${API_HOST}/api/billing-schedules/auto-send/payments`, { cache: 'no-store' }).then((r) => r.json())
      ]);
      if (q.success) setItems(q.items || []);
      if (h.success) setHistory(h.items || []);
      if (p.success) setPayments(p.items || []);
      setPayPicked(new Set());
      if (!q.success || !h.success || !p.success) showToast?.(q.message || h.message || p.message || '목록을 불러오지 못했습니다.', 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [days, historyDays, showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const toOf = (it) => (toInput[keyOf(it)] ?? it.defaultTo ?? '').trim();
  const guard = () => {
    if (canWrite) return true;
    showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
    return false;
  };

  // ---------- 나누기 ----------
  const needsApproval = (it) => !it.issued && ['', '변경됨', '실패', '대표승인대기'].includes(it.autoStatus);
  const isMissed = (it) => it.sendDday < 0;
  const missed = items.filter((it) => isMissed(it) && needsApproval(it) && !it.autoStatus);
  // 보류·실패한 건은 발송일이 지나도 여기 남는다. 빠지면 아무도 다시 승인하지 않아 청구서가 영영 안 나간다.
  const toReview = items.filter((it) => needsApproval(it) && (!isMissed(it) || it.autoStatus));
  // 다시 승인해야 하는 건(보류·실패)은 무엇이 바뀌었는지 봐야 하므로 '달라진' 쪽에 둔다
  const routine = toReview.filter((it) => it.routine && !it.autoStatus);
  const changed = toReview.filter((it) => !(it.routine && !it.autoStatus));
  const scheduled = items.filter((it) => it.autoStatus === '승인');
  const ceoWaiting = changed.filter((it) => it.autoStatus === '대표승인대기');
  const attention = history.filter((h) => h.result && h.result !== '보냄');
  const sentCount = history.filter((h) => h.result === '보냄').length;
  const routineSelected = routine.filter((it) => !routineExcluded.has(keyOf(it)));

  /**
   * 한 건을 승인한다: 금액을 청구서 화면과 같은 식으로 채워 저장하고, 양식을 그려 PDF로 떠서 서버에 맡긴다.
   * @returns {Promise<string>} 실패하면 이유, 성공하면 빈 값
   */
  const approveOne = async (it, to, expectedTotal) => {
    if (!isEmail(to)) return '받는 사람 이메일이 없습니다.';

    // 1) 최신 회차와 차량을 다시 읽는다. 목록을 연 뒤 고지서가 붙었을 수 있다.
    const res = await fetch(`${API_HOST}/api/billing-schedules/contract/${it.contract._id}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) return data.message || '회차표를 불러오지 못했습니다.';
    const round = data.schedule.rounds.find((r) => r.no === it.round.no);
    if (!round) return '회차를 찾지 못했습니다.';
    if (round.issuedAt) return '이미 발행한 회차입니다.';

    // 2) 청구서 화면에서 열었을 때와 같은 값으로 채워 저장한다. 저장한 값이 곧 승인 지문이 된다.
    const form = buildRoundForm(it, round, data.schedule.rounds);
    const totals = formTotals(form, round.attachments);
    // 담당자가 본 금액과 지금 계산한 금액이 다르면 승인하지 않는다(그사이 고지서가 붙었거나 이월이 바뀌었다)
    if (expectedTotal !== undefined && Number(expectedTotal) !== Number(totals.total)) {
      return `보신 금액(${won(expectedTotal)})과 지금 금액(${won(totals.total)})이 다릅니다. 새로고침 후 다시 확인해 주세요.`;
    }
    const saveRes = await fetch(`${API_HOST}/api/billing-schedules/${it.scheduleId}/rounds/${round.no}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
      body: JSON.stringify(roundSaveBody(form, totals))
    });
    const saved = await saveRes.json();
    if (!saved.success) return saved.message || '회차를 저장하지 못했습니다.';
    // 서버가 저장하며 다시 계산한 값으로 그린다. 화면 계산과 저장값이 다르면 PDF와 메일 금액이 갈린다.
    const stored = saved.round;
    if (Number(stored.total || 0) !== Number(totals.total || 0)) {
      return `화면 계산(${won(totals.total)})과 저장된 청구액(${won(stored.total)})이 다릅니다. 청구서 화면에서 열어 확인해 주세요.`;
    }

    // 3) 숨겨 둔 양식에 그려 PDF로 뜬다. 청구서 화면의 [발행]과 같은 양식·같은 함수다.
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
    if (!sheetRef.current) return '청구서 양식을 그리지 못했습니다.';
    const blob = await makeInvoicePdf(sheetRef.current);

    // 4) 서버에 맡긴다. 발송일 아침에 이 파일이 그대로 나간다.
    const fd = new FormData();
    fd.append('file', blob, 'invoice.pdf');
    fd.append('to', to);
    // 서버가 저장된 청구액과 맞춰 본다. 그사이 입금·이월이 바뀌었으면 승인을 거절한다.
    fd.append('expectedTotal', String(stored.total || 0));
    const appRes = await fetch(`${API_HOST}/api/billing-schedules/${it.scheduleId}/rounds/${round.no}/auto-send`, {
      method: 'POST',
      headers: { 'X-User-Role': currentUser?.role || 'viewer' },
      body: fd
    });
    const approved = await appRes.json();
    if (approved.success && approved.waitCeo) waitCeoRef.current += 1;
    return approved.success ? '' : (approved.message || '승인하지 못했습니다.');
  };

  /** 여러 건을 차례로 승인한다. 한 건이 실패해도 나머지는 계속한다. */
  const approveMany = async (list, { ask = true, expectRoutine = false, expectedTotals = null } = {}) => {
    if (!guard() || !list.length) return 0;
    if (ask) {
      const noMail = list.filter((it) => !isEmail(toOf(it))).length;
      const total = list.reduce((s, it) => s + (Number(it.expectedTotal ?? it.round.total) || 0), 0);
      const lines = [
        `${list.length}건을 승인합니다. (청구액 합계 ${won(total)})`,
        '각 청구서의 발송일 아침 9시에 고객에게 메일로 나갑니다. 그 전까지는 취소할 수 있습니다.',
        noMail ? `받는 주소가 없는 ${noMail}건은 건너뜁니다.` : null,
        '',
        '승인할까요?'
      ].filter((x) => x !== null);
      if (!window.confirm(lines.join('\n'))) return 0;
    }

    setBusy('approve');
    waitCeoRef.current = 0;
    const failures = [];
    let ok = 0;
    // 목록을 연 뒤 전월 입금이 들어왔을 수 있다. 전월 미결제·연체 이자 제안값을 지금 값으로 다시 받는다.
    let fresh = new Map();
    try {
      const data = await fetch(`${API_HOST}/api/billing-schedules/auto-send/queue?days=31`, { cache: 'no-store' }).then((r) => r.json());
      if (data.success) fresh = new Map((data.items || []).map((x) => [keyOf(x), x]));
    } catch { /* 다시 못 받으면 아래에서 건마다 실패로 남긴다 */ }

    for (let i = 0; i < list.length; i += 1) {
      const it = list[i];
      setProgress(`${i + 1}/${list.length} ${nameOf(it)} ${it.round.no}회차`);
      const current = fresh.get(keyOf(it));
      if (!current) { failures.push(`${nameOf(it)} ${it.round.no}회차: 목록에서 사라졌습니다(이미 발행했을 수 있습니다)`); continue; }
      if (!isEmail(toOf(it))) { failures.push(`${nameOf(it)}: 받는 주소 없음`); continue; }
      // '평소와 같음'으로 보고 한꺼번에 승인한 건이 그사이 달라졌으면 건너뛴다. 달라진 청구서 칸에서 다시 본다
      if (expectRoutine && (!current.routine || Number(current.expectedTotal) !== Number(it.expectedTotal))) {
        failures.push(`${nameOf(it)} ${it.round.no}회차: 그사이 내용이 바뀌어 건너뜀(달라진 청구서에서 확인)`);
        continue;
      }
      const expected = expectedTotals ? expectedTotals.get(keyOf(it)) : (expectRoutine ? it.expectedTotal : undefined);
      try {
        const reason = await approveOne(current, toOf(it), expected);
        if (reason) failures.push(`${nameOf(it)} ${it.round.no}회차: ${reason}`); else ok += 1;
      } catch (err) {
        failures.push(`${nameOf(it)} ${it.round.no}회차: ${err.message || '오류'}`);
      }
    }
    flushSync(() => setSheet(null));
    setProgress('');
    setBusy('');
    const waited = waitCeoRef.current;
    const okText = waited
      ? `${ok - waited}건 승인, ${waited}건은 확인 완료 — 대표님 승인 후 나갑니다.`
      : `${ok}건 승인했습니다. 발송일 아침 9시에 나갑니다.`;
    if (failures.length) showToast?.(`${okText} ${failures.length}건 못 함: ${failures.slice(0, 3).join(' / ')}`, 'warning');
    else showToast?.(okText, 'success');
    await loadAll();
    onChanged?.();
    return ok;
  };

  /**
   * 엑셀·메일 등 시스템 밖에서 이미 보낸 청구서를 '청구됨'으로 표시한다. 고객에게는 아무것도 보내지 않는다.
   * 그대로 두면 자동 발송 목록에 섞여 같은 청구서를 또 보낼 수 있다.
   */
  const markSentOutside = async (list, { ask = true } = {}) => {
    if (!guard() || !list.length) return false;
    if (ask) {
      const names = list.slice(0, 5).map((it) => `${nameOf(it)} ${it.round.no}회차`).join(', ');
      if (!window.confirm(`${list.length}건을 '밖에서 이미 보냄'(청구됨)으로 표시합니다.\n${names}${list.length > 5 ? ` 외 ${list.length - 5}건` : ''}\n\n고객에게는 아무것도 보내지 않습니다. 표시할까요?`)) return false;
    }
    setBusy('external');
    try {
      const data = await fetch(`${API_HOST}/api/billing-schedules/rounds/bulk-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ status: '청구됨', targets: list.map((it) => ({ scheduleId: it.scheduleId, no: it.round.no })) })
      }).then((r) => r.json());
      showToast?.(data.message || (data.success ? '표시했습니다.' : '표시하지 못했습니다.'), data.success ? 'success' : 'error');
      await loadAll();
      onChanged?.();
      return data.success;
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      setBusy('');
    }
  };

  /** 서버에 요청 하나를 보내고 결과를 알린 뒤 목록을 새로 읽는다. */
  const act = async (key, url, options, confirmText) => {
    if (!guard()) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    try {
      const data = await fetch(url, options).then((r) => r.json());
      showToast?.(data.message || (data.success ? '처리했습니다.' : '처리하지 못했습니다.'), data.success ? ((data.failed || data.held) ? 'warning' : 'success') : 'error');
      await loadAll();
      onChanged?.();
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBusy('');
    }
  };
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const roundUrl = (scheduleId, no, tail) => `${API_HOST}/api/billing-schedules/${scheduleId}/rounds/${no}/${tail}`;

  // 창을 먼저 열어 두지 않으면 팝업 차단에 걸린다
  const openFile = async (url) => {
    const win = window.open('', '_blank');
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        win?.close();
        showToast?.(data.message || '파일을 열지 못했습니다.', 'error');
        return;
      }
      const objectUrl = URL.createObjectURL(await res.blob());
      if (win) win.location.href = objectUrl; else window.location.assign(objectUrl);
    } catch {
      win?.close();
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  // 입금 일괄 처리 대상. 목록을 연 뒤 다른 사람이 상태를 바꿨거나 일부 입금이 적힌 건은 서버가 건너뛴다.
  const payable = payments.filter((p) => !(p.paidAmount > 0));
  const payTargets = () => payable
    .filter((p) => payPicked.has(`${p.scheduleId}-${p.roundNo}`))
    .map((p) => ({ scheduleId: p.scheduleId, no: p.roundNo, expectStatus: '청구됨', keepPartial: true }));

  // ---------- 한 장씩 확인 ----------
  /** 확인 창에 보여 줄 청구서를 그린다. 승인할 때와 같은 식으로 계산하지만 저장하지는 않는다. */
  const loadPreview = async (it) => {
    const data = await fetch(`${API_HOST}/api/billing-schedules/contract/${it.contract._id}`, { cache: 'no-store' }).then((r) => r.json());
    if (!data.success) return { error: data.message || '회차표를 불러오지 못했습니다.' };
    const round = data.schedule.rounds.find((r) => r.no === it.round.no);
    if (!round) return { error: '회차를 찾지 못했습니다.' };
    const form = buildRoundForm(it, round, data.schedule.rounds);
    const totals = formTotals(form, round.attachments);
    return {
      item: { ...it, company: data.schedule.company || it.company, customer: data.schedule.customer || it.customer, proration: data.schedule.proration || it.proration },
      round: { ...form, fine: totals.fineTotal, maintenance: totals.maintenanceTotal, other: totals.otherTotal, attachments: round.attachments || [], dueDate: round.dueDate },
      vehicles: data.vehicles || [],
      total: totals.total,
      attachments: round.attachments || []
    };
  };

  const openReview = async (list, index = 0) => {
    if (!list.length) return;
    const token = ++reviewTokenRef.current;
    setReview({ list, index, preview: null, loading: true });
    const preview = await loadPreview(list[index]);
    // 그사이 다른 건으로 넘겼으면 늦게 온 미리보기를 버린다. 화면의 청구서와 승인하는 청구서가 같아야 한다.
    if (token !== reviewTokenRef.current) return;
    setReview({ list, index, preview: { ...preview, key: keyOf(list[index]) }, loading: false });
  };
  const moveReview = async (step) => {
    if (!review) return;
    const index = review.index + step;
    if (index < 0 || index >= review.list.length) { setReview(null); await loadAll(); return; }
    await openReview(review.list, index);
  };
  // 뒤로 가기(핸드폰 화면 쓸기)로 닫는다 — utils/useBackClose.js
  useBackClose(Boolean(review), () => { setReview(null); loadAll(); });

  const reviewApprove = async () => {
    const it = review.list[review.index];
    if (!review.preview || review.preview.key !== keyOf(it) || review.preview.error) return;
    // 화면에 보이는 청구액 그대로여야 승인한다. 그사이 바뀌었으면 승인하지 않고 알린다.
    const ok = await approveMany([it], { ask: false, expectedTotals: new Map([[keyOf(it), review.preview.total]]) });
    if (ok) await moveReview(1);
  };
  /**
   * 시험 메일: 확인 창에 보이는 청구서 그대로 PDF를 만들어 시험 주소로만 보낸다.
   * 회차 저장·승인·발행을 하나도 하지 않는다. 실제 발송 전에 메일 모양을 확인하는 용도다.
   */
  const reviewTestSend = async () => {
    const it = review.list[review.index];
    const p = review.preview;
    if (!guard() || !p || p.error || p.key !== keyOf(it)) return;
    const to = testMail.trim();
    if (!isEmail(to)) { showToast?.('시험 메일 주소를 확인해 주세요.', 'error'); return; }
    try { localStorage.setItem('invoiceTestMail', to); } catch { /* 기억 못 해도 보내기에는 지장 없다 */ }
    setBusy('test');
    try {
      flushSync(() => setSheet({ item: p.item, round: p.round, vehicles: p.vehicles, total: p.total }));
      await settle();
      if (!sheetRef.current) throw new Error('청구서 양식을 그리지 못했습니다.');
      const blob = await makeInvoicePdf(sheetRef.current);
      const fd = new FormData();
      fd.append('file', blob, 'invoice.pdf');
      fd.append('to', to);
      fd.append('total', String(p.total || 0));
      const data = await fetch(roundUrl(it.scheduleId, it.round.no, 'test-send'), {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' },
        body: fd
      }).then((r) => r.json());
      showToast?.(data.message || (data.success ? '시험 메일을 보냈습니다.' : '보내지 못했습니다.'), data.success ? 'success' : 'error');
    } catch (err) {
      showToast?.(err.message || '시험 메일을 보내지 못했습니다.', 'error');
    } finally {
      flushSync(() => setSheet(null));
      setBusy('');
    }
  };

  /**
   * 시험 메일 여러 건: 결제일 묶음(예: 5일 출금분)을 실제 청구서 그대로 PDF로 만들어 시험 주소로만 보낸다.
   * 승인·저장·발행은 하지 않는다. 실제 발송 전에 한 묶음을 통째로 받아 보고 확인하는 용도다.
   */
  const testSendMany = async (list, label) => {
    if (!guard() || !list.length) return;
    const to = testMail.trim();
    if (!isEmail(to)) { showToast?.('시험 메일 주소를 확인해 주세요.', 'error'); return; }
    if (!window.confirm(`${label} ${list.length}건을 시험 주소 ${to}로만 보냅니다.
고객에게는 나가지 않고, 승인·발행도 하지 않습니다. 보낼까요?`)) return;
    try { localStorage.setItem('invoiceTestMail', to); } catch { /* 기억 못 해도 보내기에는 지장 없다 */ }
    setBusy('test');
    const failures = [];
    let ok = 0;
    for (let i = 0; i < list.length; i += 1) {
      const it = list[i];
      setProgress(`시험 메일 ${i + 1}/${list.length} ${nameOf(it)} ${it.round.no}회차`);
      try {
        const p = await loadPreview(it);
        if (p.error) throw new Error(p.error);
        flushSync(() => setSheet({ item: p.item, round: p.round, vehicles: p.vehicles, total: p.total }));
        await settle();
        if (!sheetRef.current) throw new Error('청구서 양식을 그리지 못했습니다.');
        const blob = await makeInvoicePdf(sheetRef.current);
        const fd = new FormData();
        fd.append('file', blob, 'invoice.pdf');
        fd.append('to', to);
        fd.append('total', String(p.total || 0));
        const data = await fetch(roundUrl(it.scheduleId, it.round.no, 'test-send'), {
          method: 'POST',
          headers: { 'X-User-Role': currentUser?.role || 'viewer' },
          body: fd
        }).then((r) => r.json());
        if (data.success) ok += 1; else failures.push(`${nameOf(it)} ${it.round.no}회차: ${data.message || '실패'}`);
      } catch (err) {
        failures.push(`${nameOf(it)} ${it.round.no}회차: ${err.message || '오류'}`);
      }
    }
    flushSync(() => setSheet(null));
    setProgress('');
    setBusy('');
    if (failures.length) showToast?.(`시험 메일 ${ok}건 보냄, ${failures.length}건 못 보냄: ${failures.slice(0, 3).join(' / ')}`, 'warning');
    else showToast?.(`시험 메일 ${ok}건을 ${to}로 보냈습니다.`, 'success');
  };

  const reviewOutside = async () => {
    const it = review.list[review.index];
    const ok = await markSentOutside([it], { ask: false });
    if (ok) await moveReview(1);
  };

  // ---------- 그리기 ----------
  const cell = { padding: '0.5rem 0.45rem', borderBottom: '1px solid var(--border-color)', verticalAlign: 'middle' };
  const th = { ...cell, textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text-muted)', background: 'var(--bg-main)' };
  const btn = (kind) => ({
    border: kind === 'primary' || kind === 'blue' ? 'none' : '1px solid var(--border-color)',
    background: kind === 'primary' ? 'var(--primary)' : (kind === 'blue' ? '#0284c7' : '#fff'),
    color: kind === 'primary' || kind === 'blue' ? '#fff' : (kind === 'warn' ? '#b45309' : (kind === 'danger' ? 'var(--error)' : 'var(--text-main)')),
    padding: '0.35rem 0.7rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700,
    cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', gap: '0.25rem'
  });
  const chip = (color, bg) => ({ padding: '0.15rem 0.55rem', borderRadius: '999px', background: bg, color, fontWeight: 800, fontSize: '0.74rem', whiteSpace: 'nowrap' });
  const box = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1rem' };
  const toField = (it) => (
    <input
      value={toInput[keyOf(it)] ?? it.defaultTo ?? ''}
      disabled={!canWrite || Boolean(busy)}
      onChange={(e) => setToInput((prev) => ({ ...prev, [keyOf(it)]: e.target.value }))}
      placeholder="받을 이메일 (필수)"
      style={{ width: '100%', minWidth: '180px', padding: '0.3rem 0.45rem', borderRadius: '5px', border: `1px solid ${isEmail(toOf(it)) ? 'var(--border-color)' : '#f87171'}`, fontSize: '0.78rem' }}
    />
  );

  const cards = [
    { key: 'review', icon: <ListChecks size={18} />, label: '① 확인·승인', value: routine.length + changed.length, sub: `평소와 같음 ${routine.length} · 달라짐 ${changed.length}${ceoWaiting.length ? ` (대표 승인 대기 ${ceoWaiting.length})` : ''}`, color: '#d97706', alert: changed.length > 0 || missed.length > 0 },
    { key: 'scheduled', icon: <Clock size={18} />, label: '② 보낼 예정', value: scheduled.length, sub: '발송일 아침 9시 자동 발송', color: '#16a34a' },
    { key: 'results', icon: <Send size={18} />, label: '③ 발송 결과', value: attention.length, sub: `손볼 것 ${attention.length} · 보냄 ${sentCount}`, color: attention.length ? '#dc2626' : '#0284c7', alert: attention.length > 0 },
    { key: 'payments', icon: <Wallet size={18} />, label: '④ 입금 확인', value: payments.length, sub: '출금일 지났는데 입금 처리 전', color: '#7c3aed', alert: payments.length > 0 }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {/* 네 칸 요약. 누르면 그 단계로 간다 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.6rem' }}>
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setTab(c.key)}
            style={{
              textAlign: 'left', cursor: 'pointer', background: '#fff', borderRadius: '10px', padding: '0.75rem 0.9rem',
              border: `2px solid ${tab === c.key ? c.color : 'var(--border-color)'}`,
              boxShadow: tab === c.key ? '0 2px 8px rgba(0,0,0,0.06)' : 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: c.color, fontWeight: 800, fontSize: '0.85rem' }}>
              {c.icon} {c.label}
              {c.alert && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', marginLeft: 'auto' }} />}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-bright)', marginTop: '0.2rem' }}>{loading ? '…' : `${c.value}건`}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{c.sub}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        <span>하루 흐름: 오후 4시 '승인 대기' 메일 → ① 확인·승인 → 다음 날 9시 자동 발송 → '발송 결과' 메일 → ③ 확인 → 출금일 뒤 ④ 입금 확인</span>
        <button type="button" style={{ ...btn(), marginLeft: 'auto' }} onClick={loadAll} disabled={Boolean(busy)}><RefreshCw size={12} /> 새로고침</button>
      </div>

      {busy === 'approve' && (
        <div style={{ ...box, borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 700, fontSize: '0.85rem' }}>
          청구서를 만들어 승인하는 중입니다… {progress} (이 창을 닫지 마세요)
        </div>
      )}

      {/* ① 확인·승인 */}
      {tab === 'review' && canWrite && (
        <TestSendBar
          items={items.filter((it) => !it.issued && !['발송중', '발송완료'].includes(it.autoStatus))}
          testMail={testMail}
          setTestMail={setTestMail}
          busy={Boolean(busy)}
          onSend={testSendMany}
          btn={btn}
        />
      )}

      {tab === 'review' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>보여 줄 범위</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ padding: '0.25rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}>
              {[3, 7, 14, 31].map((d) => <option key={d} value={d}>앞으로 {d}일 안에 보낼 것</option>)}
            </select>
          </div>

          {missed.length > 0 && (
            <div style={{ ...box, borderColor: '#fca5a5', background: '#fff7f7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <AlertCircle size={16} color="#dc2626" />
                <strong style={{ color: '#b91c1c' }}>발송일이 지난 청구서 {missed.length}건</strong>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>엑셀·메일로 이미 보냈다면 '이미 보냄'으로 정리하세요. 고객에게는 아무것도 나가지 않습니다.</span>
                {canWrite && <button type="button" style={{ ...btn('warn'), marginLeft: 'auto' }} disabled={Boolean(busy)} onClick={() => markSentOutside(missed)}>{missed.length}건 모두 '이미 보냄'</button>}
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-main)', lineHeight: 1.7 }}>
                {missed.map((it) => (
                  <span key={keyOf(it)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginRight: '0.8rem' }}>
                    {nameOf(it)} {it.round.no}회차 ({ymd(it.round.dueDate)} 출금)
                    {canWrite && (
                      <button type="button" style={{ ...btn(), padding: '0.05rem 0.4rem', fontSize: '0.7rem' }} disabled={Boolean(busy)} onClick={() => openReview([it])} title="아직 안 보냈으면 확인하고 승인합니다">
                        아직 안 보냄
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 달라진 청구서: 한 장씩 */}
          <div style={box}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <Eye size={16} color="#d97706" />
              <strong>달라진 청구서 {changed.length}건 — 한 장씩 확인</strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>렌트료 말고 붙은 것이 있거나, 승인 뒤 바뀌어 다시 승인해야 하는 건입니다.</span>
              {canWrite && changed.length > 0 && (
                <button type="button" style={{ ...btn('primary'), marginLeft: 'auto' }} disabled={Boolean(busy)} onClick={() => openReview(changed)}>
                  <Eye size={13} /> 한 장씩 확인 시작
                </button>
              )}
            </div>
            {changed.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>확인할 건이 없습니다.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '860px' }}>
                  <thead><tr>{['발송', '계약자', '회차', '청구액', '달라진 점', '받는 주소', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {changed.map((it, i) => (
                      <tr key={keyOf(it)} style={{ boxShadow: paymentDayStripe(it.round.dueDate) }}>
                        <td style={{ ...cell, whiteSpace: 'nowrap', fontWeight: 700, color: it.sendDday <= 1 ? '#d97706' : 'var(--text-muted)' }}>{sendDayLabel(it.sendDday)}</td>
                        <td style={cell}><strong>{nameOf(it)}</strong><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{it.carSummary || it.contract?.contractNo}<ExtensionTag contract={it.contract} /></div></td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}><PaymentDayBadge date={it.round.dueDate} /> {it.round.no}/{it.totalRounds}</td>
                        <td style={{ ...cell, fontWeight: 800, whiteSpace: 'nowrap' }}>{won(it.expectedTotal)}</td>
                        <td style={cell}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {it.autoStatus === '대표승인대기' && (
                              <span style={chip('#6d28d9', '#ede9fe')}>대표 승인 대기{it.round.autoSend?.checkedBy ? ` · ${it.round.autoSend.checkedBy} 확인` : ''}</span>
                            )}
                            {it.autoStatus && it.autoStatus !== '대표승인대기' && <span style={chip('#b45309', '#ffedd5')}>{it.autoStatus === '실패' ? '실패' : '승인 뒤 바뀜'}</span>}
                            {(it.changes || []).map((c) => (
                              <span key={c.key} style={chip('#92400e', '#fef3c7')}>{c.label}{c.amount ? ` ${signedWon(c.amount)}` : ''}</span>
                            ))}
                          </div>
                          {it.round.autoSend?.message && <div style={{ fontSize: '0.72rem', color: 'var(--error)', marginTop: '0.2rem' }}>{it.round.autoSend.message}</div>}
                        </td>
                        <td style={cell}>{toField(it)}</td>
                        <td style={cell}>
                          <button type="button" style={btn()} disabled={Boolean(busy)} onClick={() => openReview(changed, i)}><Eye size={12} /> 확인</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 평소와 같은 청구서: 한 번에 */}
          <div style={box}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <CheckCircle2 size={16} color="#16a34a" />
              <strong>평소와 같은 청구서 {routine.length}건 — 한 번에 승인</strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>월 렌트료만 청구하는 건입니다. 받는 주소만 확인하세요.</span>
              {canWrite && routine.length > 0 && (
                <button
                  type="button"
                  style={{ ...btn('primary'), marginLeft: 'auto' }}
                  disabled={Boolean(busy) || !routineSelected.length}
                  onClick={() => approveMany(routineSelected, { expectRoutine: true })}
                >
                  <CheckCircle2 size={13} /> {routineSelected.length}건 승인
                </button>
              )}
            </div>
            {routine.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>승인할 건이 없습니다.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '760px' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: '32px' }}>
                        <input
                          type="checkbox"
                          checked={routineSelected.length === routine.length}
                          disabled={!canWrite || Boolean(busy)}
                          onChange={(e) => setRoutineExcluded(e.target.checked ? new Set() : new Set(routine.map(keyOf)))}
                        />
                      </th>
                      {['발송', '계약자', '회차 · 출금일', '청구액', '받는 주소', ''].map((h) => <th key={h} style={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {routine.map((it) => {
                      const k = keyOf(it);
                      const checked = !routineExcluded.has(k);
                      return (
                        <tr key={k} style={{ opacity: checked ? 1 : 0.55, boxShadow: paymentDayStripe(it.round.dueDate) }}>
                          <td style={cell}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canWrite || Boolean(busy)}
                              onChange={() => setRoutineExcluded((prev) => {
                                const next = new Set(prev);
                                if (next.has(k)) next.delete(k); else next.add(k);
                                return next;
                              })}
                            />
                          </td>
                          <td style={{ ...cell, whiteSpace: 'nowrap', fontWeight: 700, color: it.sendDday <= 1 ? '#d97706' : 'var(--text-muted)' }}>{sendDayLabel(it.sendDday)}</td>
                          <td style={cell}><strong>{nameOf(it)}</strong> <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{it.carSummary || it.contract?.contractNo}</span><ExtensionTag contract={it.contract} /></td>
                          <td style={{ ...cell, whiteSpace: 'nowrap' }}><PaymentDayBadge date={it.round.dueDate} /> {it.round.no}/{it.totalRounds} · {ymd(it.round.dueDate)}</td>
                          <td style={{ ...cell, fontWeight: 700, whiteSpace: 'nowrap' }}>{won(it.expectedTotal)}</td>
                          <td style={cell}>{toField(it)}</td>
                          <td style={cell}>
                            <button type="button" style={btn()} disabled={Boolean(busy)} onClick={() => openReview([it])} title="청구서를 미리 봅니다"><Eye size={12} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ② 보낼 예정 */}
      {tab === 'scheduled' && (
        <div style={box}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            승인한 청구서입니다. 발송일 아침 9시에 서버가 보냅니다. 그 전까지 [취소]하거나 [지금 보내기]로 먼저 보낼 수 있습니다.
            보내기 직전에 내용이 승인 때와 같은지 다시 보고, 다르면 보내지 않고 '보류'로 남깁니다.
          </div>
          {scheduled.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>보낼 예정인 청구서가 없습니다.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '820px' }}>
                <thead><tr>{['발송', '계약자', '회차 · 출금일', '청구액', '받는 주소', '승인', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {scheduled.map((it) => (
                    <tr key={keyOf(it)} style={{ boxShadow: paymentDayStripe(it.round.dueDate) }}>
                      <td style={{ ...cell, whiteSpace: 'nowrap', fontWeight: 700 }}>{sendDayLabel(it.sendDday)}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{ymd(it.sendDate)}</div></td>
                      <td style={cell}><strong>{nameOf(it)}</strong></td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}><PaymentDayBadge date={it.round.dueDate} /> {it.round.no}/{it.totalRounds} · {ymd(it.round.dueDate)}</td>
                      <td style={{ ...cell, fontWeight: 700, whiteSpace: 'nowrap' }}>{won(it.round.total)}</td>
                      <td style={cell}>{it.round.autoSend?.to}</td>
                      <td style={{ ...cell, fontSize: '0.74rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{it.round.autoSend?.approvedBy}<br />{mdhm(it.round.autoSend?.approvedAt)}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                          <button type="button" style={btn()} onClick={() => openFile(roundUrl(it.scheduleId, it.round.no, 'auto-send/file'))}><FileText size={12} /> PDF</button>
                          {canWrite && (
                            <>
                              <button
                                type="button"
                                style={btn('blue')}
                                disabled={Boolean(busy)}
                                onClick={() => act(keyOf(it), `${API_HOST}/api/billing-schedules/auto-send/run`, json('POST', { scheduleId: it.scheduleId, roundNo: it.round.no }),
                                  `${nameOf(it)} ${it.round.no}회차 청구서를\n${it.round.autoSend?.to} 로 지금 보낼까요?`)}
                              >
                                <Send size={12} /> 지금 보내기
                              </button>
                              <button
                                type="button"
                                style={btn('danger')}
                                disabled={Boolean(busy)}
                                onClick={() => act(keyOf(it), roundUrl(it.scheduleId, it.round.no, 'auto-send'), { method: 'DELETE' }, '이 청구서의 승인을 취소할까요? 발송되지 않습니다.')}
                              >
                                <X size={12} /> 취소
                              </button>
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ③ 발송 결과 */}
      {tab === 'results' && (
        <div style={box}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>최근</span>
            <select value={historyDays} onChange={(e) => setHistoryDays(Number(e.target.value))} style={{ padding: '0.25rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}>
              {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d}일</option>)}
            </select>
            <span style={{ color: 'var(--text-muted)' }}>
              손볼 것이 위에 옵니다. <b>확인 필요</b>는 보내는 도중 멈춘 건이라, 보낸편지함이나 고객에게 받았는지 확인한 뒤 눌러 주세요.
            </span>
          </div>
          {history.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>이 기간에 시스템에서 보낸 청구서가 없습니다.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '880px' }}>
                <thead><tr>{['결과', '계약자', '회차 · 출금일', '청구액', '받는 주소', '발행 · 메일', '방식', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {history.map((h) => {
                    const st = RESULT_STYLE[h.result] || RESULT_STYLE.보냄;
                    const k = `${h.scheduleId}-${h.roundNo}`;
                    return (
                      <tr key={k} style={{ boxShadow: paymentDayStripe(h.dueDate) }}>
                        <td style={cell}>
                          <span style={chip(st.color, st.bg)}>{h.result || '-'}</span>
                          {h.message && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem', maxWidth: '220px' }}>{h.message}</div>}
                        </td>
                        <td style={cell}><strong>{h.partyName}</strong> <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{h.contractNo}</span></td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}><PaymentDayBadge date={h.dueDate} /> {h.roundNo}/{h.totalRounds} · {ymd(h.dueDate)}</td>
                        <td style={{ ...cell, fontWeight: 700, whiteSpace: 'nowrap' }}>{won(h.total)}</td>
                        <td style={cell}>
                          {['메일 실패', '메일 안 감'].includes(h.result) && canWrite
                            ? (
                              <input
                                value={toInput[k] ?? h.to ?? ''}
                                onChange={(e) => setToInput((prev) => ({ ...prev, [k]: e.target.value }))}
                                style={{ width: '100%', minWidth: '170px', padding: '0.3rem 0.45rem', borderRadius: '5px', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}
                              />
                            )
                            : h.to}
                        </td>
                        <td style={{ ...cell, fontSize: '0.74rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{mdhm(h.issuedAt)}<br />{h.sentAt ? `메일 ${mdhm(h.sentAt)}` : '메일 기록 없음'}</td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>{h.via}</td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                            {h.hasFile && <button type="button" style={btn()} onClick={() => openFile(roundUrl(h.scheduleId, h.roundNo, 'file'))}><FileText size={12} /> PDF</button>}
                            {canWrite && ['메일 실패', '메일 안 감'].includes(h.result) && (
                              <button
                                type="button"
                                style={btn('blue')}
                                disabled={Boolean(busy)}
                                onClick={() => {
                                  const to = (toInput[k] ?? h.to ?? '').trim();
                                  act(k, roundUrl(h.scheduleId, h.roundNo, 'resend'), json('POST', { to }), `${h.partyName} ${h.roundNo}회차 청구서를\n${to} 로 다시 보낼까요?`);
                                }}
                                title={h.sentAt ? '이미 보낸 기록이 있어 서버가 막습니다' : undefined}
                              >
                                <Send size={12} /> 다시 보내기
                              </button>
                            )}
                            {canWrite && h.result === '확인 필요' && (
                              <>
                                <button type="button" style={btn('primary')} disabled={Boolean(busy)} onClick={() => act(k, roundUrl(h.scheduleId, h.roundNo, 'auto-send/resolve'), json('POST', { received: true }), '고객이 청구서를 받은 것을 확인하셨나요?')}>받았음</button>
                                <button type="button" style={btn('warn')} disabled={Boolean(busy)} onClick={() => act(k, roundUrl(h.scheduleId, h.roundNo, 'auto-send/resolve'), json('POST', { received: false }), '고객이 받지 못했나요? 다시 보낼 수 있게 풉니다.')}>못 받음</button>
                              </>
                            )}
                            {h.result === '보류' && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>① 확인·승인에서 다시 승인</span>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ④ 입금 확인 */}
      {tab === 'payments' && (
        <div style={box}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              청구서는 나갔는데 출금일이 지난 건입니다. 통장을 보고 들어온 건은 <b>입금완료</b>, 안 들어온 건은 <b>미납</b>을 찍으세요.
              결제일 뒤 15일 안의 건은 아직 들어오는 중일 수 있어 미납으로 찍히지 않습니다.
              미납은 다음 회차에 전월 미결제와 연체 이자로 붙습니다. 일부만 들어온 건은 청구서 화면에서 금액을 적어 주세요.
            </span>
            {canWrite && payPicked.size > 0 && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '0.3rem' }}>
                <button type="button" style={btn('primary')} disabled={Boolean(busy)} onClick={() => act('pay', `${API_HOST}/api/billing-schedules/rounds/bulk-status`, json('PATCH', { status: '입금완료', targets: payTargets() }), `고른 ${payPicked.size}건을 청구액 전액 입금완료로 찍을까요?`)}>
                  고른 {payPicked.size}건 입금완료
                </button>
                <button type="button" style={btn('danger')} disabled={Boolean(busy)} onClick={() => act('pay', `${API_HOST}/api/billing-schedules/rounds/bulk-status`, json('PATCH', { status: '미납', targets: payTargets() }), `고른 ${payPicked.size}건을 미납으로 찍을까요? 다음 회차에 미결제·연체 이자가 붙습니다.`)}>
                  고른 {payPicked.size}건 미납
                </button>
              </span>
            )}
          </div>
          {payments.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>확인할 입금이 없습니다.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '620px' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: '32px' }}>
                      <input
                        type="checkbox"
                        disabled={!canWrite}
                        checked={payPicked.size > 0 && payPicked.size === payable.length}
                        onChange={(e) => setPayPicked(e.target.checked ? new Set(payable.map((p) => `${p.scheduleId}-${p.roundNo}`)) : new Set())}
                      />
                    </th>
                    {['계약자', '회차', '출금일', '청구액', '입금된 금액'].map((h) => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => {
                    const k = `${p.scheduleId}-${p.roundNo}`;
                    return (
                      <tr key={k} style={{ boxShadow: paymentDayStripe(p.dueDate) }}>
                        <td style={cell}>
                          <input
                            type="checkbox"
                            disabled={!canWrite || p.paidAmount > 0}
                            title={p.paidAmount > 0 ? '일부 입금이 있는 건은 청구서 화면에서 금액을 적어 처리하세요' : undefined}
                            checked={payPicked.has(k)}
                            onChange={() => setPayPicked((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                          />
                        </td>
                        <td style={cell}><strong>{p.partyName}</strong> <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.contractNo}</span></td>
                        <td style={cell}>{p.roundNo}회차</td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                          <PaymentDayBadge date={p.dueDate} /> {ymd(p.dueDate)} <span style={{ color: p.inGrace ? 'var(--text-muted)' : 'var(--error)', fontSize: '0.74rem' }}>({p.daysPast}일 지남)</span>
                          {p.inGrace && <span style={{ ...chip('#0284c7', '#e0f2fe'), marginLeft: '0.3rem' }}>15일 안 · 연체 아님</span>}
                        </td>
                        <td style={{ ...cell, fontWeight: 700 }}>{won(p.total)}</td>
                        <td style={{ ...cell, color: p.paidAmount > 0 ? '#b45309' : 'var(--text-muted)' }}>
                          {p.paidAmount > 0 ? `${won(p.paidAmount)} (일부 입금 · 청구서 화면에서 처리)` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 한 장씩 확인 창 */}
      {review && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          {/* 높이를 정해 두어야 안쪽 칸이 스크롤된다(최대 높이만 주면 긴 청구서 아래쪽이 잘려 내려갈 수 없었다) */}
          <div style={{ background: '#fff', borderRadius: '12px', width: 'min(1200px, 100%)', height: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {(() => {
              const it = review.list[review.index];
              const p = review.preview;
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
                    <strong style={{ fontSize: '0.95rem' }}>{nameOf(it)} · {it.round.no}회차</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{review.index + 1} / {review.list.length}</span>
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '0.3rem' }}>
                      <button type="button" style={btn()} disabled={review.index === 0 || Boolean(busy)} onClick={() => moveReview(-1)}><ChevronLeft size={14} /> 이전</button>
                      <button type="button" style={btn()} disabled={Boolean(busy)} onClick={() => moveReview(1)}>건너뛰기 <ChevronRight size={14} /></button>
                      <button type="button" style={btn()} disabled={Boolean(busy)} onClick={() => { setReview(null); loadAll(); }}><X size={14} /> 닫기</button>
                    </span>
                  </div>
                  <div style={{ display: 'flex', flex: 1, minHeight: 0, flexWrap: 'wrap', overflow: 'auto' }}>
                    <div style={{ flex: '1 1 640px', overflow: 'auto', background: '#f1f5f9', padding: '1rem', minHeight: '300px', maxHeight: '100%' }}>
                      {review.loading && <div style={{ color: 'var(--text-muted)' }}>청구서를 그리는 중…</div>}
                      {p?.error && <div style={{ color: 'var(--error)' }}>{p.error}</div>}
                      {p && !p.error && (
                        <div style={{ background: '#fff', margin: '0 auto', width: 'fit-content', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}>
                          <InvoiceSheet item={p.item} round={p.round} vehicles={p.vehicles} total={p.total} />
                        </div>
                      )}
                    </div>
                    <div style={{ flex: '0 0 320px', borderLeft: '1px solid var(--border-color)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', overflow: 'auto' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        출금일 {ymd(it.round.dueDate)} · 발송 {ymd(it.sendDate)} ({sendDayLabel(it.sendDday)})
                      </div>
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem' }}>평소와 다른 점</div>
                        {(it.changes || []).length === 0
                          ? <div style={{ fontSize: '0.8rem', color: '#16a34a' }}>월 렌트료만 청구합니다.</div>
                          : it.changes.map((c) => (
                            <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '0.2rem 0', borderBottom: '1px dashed var(--border-color)' }}>
                              <span>{c.label}</span><strong>{c.amount ? signedWon(c.amount) : ''}</strong>
                            </div>
                          ))}
                        {it.autoStatus && it.round.autoSend?.message && (
                          <div style={{ fontSize: '0.76rem', color: '#b45309', marginTop: '0.3rem' }}>지난 승인: {it.round.autoSend.message}</div>
                        )}
                      </div>
                      {p && !p.error && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', fontWeight: 800 }}>
                            <span>청구액</span><span>{won(p.total)}</span>
                          </div>
                          {p.attachments.length > 0 && (
                            <div style={{ fontSize: '0.78rem' }}>
                              <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>함께 보낼 서류 {p.attachments.length}건</div>
                              {p.attachments.map((a, i) => (
                                <div key={i} style={{ color: 'var(--text-muted)' }}>· {a.kind} {a.plateNo || ''} {Number(a.amount) ? won(a.amount) : ''}</div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem' }}>받는 주소</div>
                        {toField(it)}
                      </div>
                      {canWrite && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: 'auto' }}>
                          <button type="button" style={{ ...btn('primary'), justifyContent: 'center', padding: '0.6rem' }} disabled={Boolean(busy) || review.loading || !p || Boolean(p.error) || p.key !== keyOf(it) || !isEmail(toOf(it))} onClick={reviewApprove}>
                            <CheckCircle2 size={15} />
                            {/* 달라진 청구서: 직원은 확인까지, 대표가 최종 승인 */}
                            {isCeo
                              ? (it.autoStatus === '대표승인대기' ? '최종 승인 (다음 건으로)' : '확인했습니다, 승인 (다음 건으로)')
                              : (it.routine && !it.autoStatus ? '확인했습니다, 승인 (다음 건으로)' : '확인 완료 — 대표 승인 요청 (다음 건으로)')}
                          </button>
                          {it.sendDday < 0 && (
                            <button type="button" style={{ ...btn('warn'), justifyContent: 'center' }} disabled={Boolean(busy)} onClick={reviewOutside}>밖에서 이미 보냄으로 표시</button>
                          )}
                          <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '0.5rem', marginTop: '0.2rem' }}>
                            <div style={{ fontSize: '0.74rem', fontWeight: 700, marginBottom: '0.25rem' }}>시험 메일 (고객에게는 안 나감)</div>
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <input
                                value={testMail}
                                onChange={(e) => setTestMail(e.target.value)}
                                style={{ flex: 1, minWidth: 0, padding: '0.3rem 0.45rem', borderRadius: '5px', border: '1px solid var(--border-color)', fontSize: '0.76rem' }}
                              />
                              <button type="button" style={btn()} disabled={Boolean(busy) || review.loading || !p || Boolean(p.error)} onClick={reviewTestSend}>
                                <Send size={12} /> {busy === 'test' ? '보내는 중…' : '시험 메일'}
                              </button>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>이 청구서를 시험 주소로만 보냅니다. 회차 상태와 승인은 그대로입니다.</div>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            금액을 고쳐야 하면 [장기렌트 청구서 › 청구 대상]에서 이 회차를 열어 고친 뒤 다시 오세요.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* PDF로 뜰 청구서 양식. 화면에는 보이지 않게 두고 이 요소만 캡처한다 (청구서 화면과 같은 방식). */}
      {sheet && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
          <InvoiceSheet innerRef={sheetRef} item={sheet.item} round={sheet.round} vehicles={sheet.vehicles} total={sheet.total} />
        </div>
      )}
    </div>
  );
}

/**
 * 결제일 묶음별 시험 메일 버튼. 예: [5일 12건] 을 누르면 11/5 출금분 청구서 12장이 시험 주소로만 간다.
 */
function TestSendBar({ items, testMail, setTestMail, busy, onSend, btn }) {
  const groups = PAYMENT_DAYS
    .map((d) => ({ ...d, list: items.filter((it) => paymentDayKey(it.round.dueDate) === d.key) }))
    .filter((g) => g.list.length);
  if (!groups.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', padding: '0.6rem 0.8rem', marginBottom: '0.8rem', border: '1px dashed #94a3b8', borderRadius: '8px', background: '#f8fafc', fontSize: '0.8rem' }}>
      <strong>시험 메일로 묶음 보내기</strong>
      <span style={{ color: 'var(--text-muted)' }}>고객에게는 안 나가고 승인도 하지 않습니다 ·</span>
      <input value={testMail} onChange={(e) => setTestMail(e.target.value)} placeholder="시험 메일 주소" style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', minWidth: '200px' }} />
      {groups.map((g) => (
        <button
          key={g.key}
          type="button"
          disabled={busy}
          onClick={() => onSend(g.list, `${g.label} 출금분`)}
          style={{ ...btn(), borderColor: g.color, color: g.color, background: g.bg }}
        >
          {g.label} {g.list.length}건
        </button>
      ))}
    </div>
  );
}

export default AutoSendView;
