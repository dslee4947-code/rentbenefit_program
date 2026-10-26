import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, FileText, Mail, Plus, Trash2, Save, Download, ExternalLink, Paperclip } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';
import InvoiceSheet, { makeInvoicePdf, roundTotal } from './InvoiceSheet.jsx';
import useBackClose from '../../utils/useBackClose.js';
import UnpaidBox from './UnpaidBox.jsx';
import PaymentDayBadge from './PaymentDayBadge.jsx';
import { PAYMENT_DAYS, paymentDayKey } from './paymentDay.js';
import { daysSinceDue } from './unpaidRules.js';

// 핸드폰 폭(mobile.css와 같은 기준)
const isPhone = () => window.matchMedia('(max-width: 768px)').matches;

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const ymd = (d) => (d ? String(d).slice(0, 10) : '-');
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 회차에 손으로 더하는 항목. 이름은 고칠 수 있어 "과태료 (3/2 속도위반)"처럼 적어 둘 수 있다.
const QUICK_EXTRAS = ['과태료', '자부담금', '기타 청구'];

const PAY_STYLE = {
  '예정': { bg: '#f1f5f9', color: '#475569' },
  '청구됨': { bg: '#e0f2fe', color: '#0284c7' },
  '입금완료': { bg: '#dcfce7', color: '#16a34a' },
  '미납': { bg: '#fee2e2', color: '#ef4444' }
};

/**
 * 회차가 어떤 상태인지 한 단어로. 폴더에서 PDF가 있나 없나로 보던 것을 화면에서 대신한다.
 * - 발행: 이 프로그램에서 청구서를 만들었다(파일이 저장돼 있다)
 * - 엑셀 발송: 프로그램 이전처럼 엑셀로 만들어 보냈다(드롭박스 청구서를 읽어 넣은 기록이 있다)
 * - 기록 없음: 출금일이 지났는데 프로그램에 발행 기록이 없다. 예전처럼 엑셀로 보냈거나 빠진 회차다.
 * - 예정: 아직 출금일이 오지 않았다
 */
/** 출금일 + 15일 안에 입금이 없던 회차인지(나중에 들어왔어도 미납이었던 것). 서버 utils/lateInterestHistory.js와 같은 기준 */
const wasLate = (r) => {
  const due = new Date(r.dueDate).getTime();
  if (r.paidAt) return (new Date(r.paidAt).getTime() - due) / 864e5 > 15;
  return r.status === '미납';
};

const issueStateOf = (round) => {
  if (round.issuedAt) return { label: '발행', color: '#0284c7', bg: '#e0f2fe' };
  if (round.excelInvoice?.total !== undefined) return { label: '엑셀 발송', color: '#0f766e', bg: '#ccfbf1' };
  if (ymd(round.dueDate) < todayYmd()) return { label: '기록 없음', color: '#b45309', bg: '#fef3c7' };
  return { label: '예정', color: '#64748b', bg: '#f1f5f9' };
};


/**
 * 청구서 보관함.
 *
 * 계약 하나의 청구서를 1회차부터 끝 회차까지 폴더처럼 모아 본다. 예전에는 법인 폴더에 회차별 PDF를
 * 쌓아 두고 파일이 있나 없나로 "보냈는지"를 확인했다.
 *
 * - 회차를 누르면 그 회차 청구서를 계약 조건대로 화면에 그린다. PDF는 버튼을 누를 때만 만든다.
 * - 발행하지 않은 회차에는 과태료·자부담금 같은 항목을 직접 더할 수 있다. 청구서에 바로 반영된다.
 * - 이미 발행한 회차는 보낸 내용이 바뀌면 안 되므로 고치지 않고, 저장해 둔 PDF를 그대로 연다.
 */
function InvoiceArchiveView({ showToast, currentUser }) {
  const [contracts, setContracts] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [picked, setPicked] = useState(null); // 목록에서 고른 계약 (summary 항목)
  const [detail, setDetail] = useState(null); // { schedule, vehicles }
  const [selectedNo, setSelectedNo] = useState(null);
  const [draft, setDraft] = useState([]); // 고르고 있는 회차의 추가 항목(extras)
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [making, setMaking] = useState(false);
  const [bigView, setBigView] = useState(false);
  const sheetRef = useRef(null);
  const previewBoxRef = useRef(null);
  const detailRef = useRef(null);
  const jumpToDetail = useRef(false);
  const [previewZoom, setPreviewZoom] = useState(1);

  const canEdit = currentUser?.role !== 'viewer';

  // 청구서 양식(780px)을 미리보기 칸 폭에 맞춘다. 창 크기가 바뀌어도 따라간다.
  const SHEET_WIDTH = 780;
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return undefined;
    const fit = () => setPreviewZoom(Math.min(1, (el.clientWidth - 16) / SHEET_WIDTH));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [detail, selectedNo]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_HOST}/api/billing-schedules`);
        const data = await res.json();
        if (data.success) setContracts(data.items || []);
        else showToast?.(data.message || '계약 목록을 불러오지 못했습니다.', 'error');
      } catch {
        showToast?.('서버 통신 오류가 발생했습니다.', 'error');
      }
    })();
  }, [showToast]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return contracts;
    return contracts.filter((c) => [c.partyName, c.contractNo, ...(c.plateNos || []), ...(c.vehicles || []).map((v) => v.carModel)]
      .some((v) => String(v || '').toLowerCase().includes(k)));
  }, [contracts, keyword]);

  // 계약 목록을 결제일(5·10·15·25·말일)별로 묶는다. 장기렌트 청구서와 같은 묶음이라 찾기 쉽다.
  // 묶음 안은 계약번호 내림차순(최근 계약이 위). 검색해도 묶음은 그대로 둔다(대표님 2026-10-22).
  const groups = useMemo(() => {
    const order = [...PAYMENT_DAYS.map((d) => d.key), 'etc'];
    const byKey = new Map(order.map((k) => [k, []]));
    for (const c of filtered) byKey.get(c.payDueDate ? paymentDayKey(c.payDueDate) : 'etc')?.push(c);
    return order
      .map((key) => ({ key, items: byKey.get(key).sort((a, b) => String(b.contractNo || '').localeCompare(String(a.contractNo || ''))) }))
      .filter((g) => g.items.length);
  }, [filtered]);

  const loadDetail = useCallback(async (contractId, keepNo) => {
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/contract/${contractId}`);
      const data = await res.json();
      if (!data.success) {
        showToast?.(data.message || '회차표를 불러오지 못했습니다.', 'error');
        return;
      }
      // 엑셀로 보낸 청구서 기록을 회차에 붙여 둔다(따로 저장돼 있다. ExcelInvoice 모델 참고)
      const excelByNo = new Map((data.excelInvoices || []).map((x) => [x.roundNo, x]));
      const schedule = {
        ...data.schedule,
        rounds: (data.schedule.rounds || []).map((r) => (excelByNo.has(r.no) ? { ...r, excelInvoice: excelByNo.get(r.no) } : r))
      };
      setDetail({ schedule, vehicles: data.vehicles || [], contract: data.contract || null });
      // 처음 열면 가장 최근에 출금일이 지난 회차를 먼저 보여 준다(보통 그걸 확인하러 온다)
      const rounds = schedule.rounds;
      const lastPast = [...rounds].reverse().find((r) => ymd(r.dueDate) <= todayYmd());
      const no = keepNo || lastPast?.no || rounds[0]?.no || null;
      setSelectedNo(no);
      setDraft((rounds.find((r) => r.no === no)?.extras || []).map((e) => ({ ...e })));
      setDirty(false);
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  }, [showToast]);

  const pickContract = (c) => {
    if (dirty && !window.confirm('저장하지 않은 항목이 있습니다. 다른 계약으로 넘어갈까요?')) return;
    setPicked(c);
    setDetail(null);
    loadDetail(c.contractId);
    // 핸드폰은 목록 아래에 청구서가 나온다. 고르면 바로 그쪽으로 내려간다.
    jumpToDetail.current = isPhone();
  };

  // 뒤로 가기(핸드폰 화면 쓸기)로 닫는다 — utils/useBackClose.js
  useBackClose(Boolean(picked), () => {
    if (dirty && !window.confirm('저장하지 않은 항목이 있습니다. 계약 목록으로 돌아갈까요?')) return false;
    setPicked(null);
    setDetail(null);
    setDirty(false);
    if (isPhone()) window.scrollTo({ top: 0 });
    return true;
  });
  useBackClose(bigView, () => setBigView(false));

  useEffect(() => {
    if (!detail || !jumpToDetail.current) return;
    jumpToDetail.current = false;
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [detail]);

  const rounds = detail?.schedule?.rounds || [];
  const round = rounds.find((r) => r.no === selectedNo) || null;
  const locked = Boolean(round?.issuedAt); // 발행한 회차는 보낸 내용 그대로 둔다
  const editable = canEdit && round && !locked;

  const selectRound = (no) => {
    if (no === selectedNo) return;
    if (dirty && !window.confirm('저장하지 않은 항목이 있습니다. 다른 회차로 넘어갈까요?')) return;
    setSelectedNo(no);
    setDraft((rounds.find((r) => r.no === no)?.extras || []).map((e) => ({ ...e })));
    setDirty(false);
  };

  // 기타 청구 합계. 항목이 있으면 그 합이고, 없으면 예전 방식으로 금액만 적어 둔 값(other)을 그대로 둔다.
  // 서버 recalcRound도 항목이 없을 때는 other를 건드리지 않는다.
  const otherFor = (extras) => (extras.length
    ? extras.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
    : ((round?.extras || []).length ? 0 : Number(round?.other || 0)));
  const draftOther = otherFor(draft);
  // 화면에 그리는 회차. 발행한 회차는 저장된 값 그대로, 아니면 지금 적고 있는 항목을 얹어 보여 준다.
  const previewRound = round
    ? (locked ? round : { ...round, extras: draft, other: draftOther })
    : null;
  const previewTotal = previewRound ? (locked ? round.total : roundTotal(previewRound)) : 0;
  // 이 회차까지 쌓인 받지 않은 연체 이자(청구서에 누적으로 남긴다)
  const interestToDate = rounds.filter((r) => r.no <= (round?.no || 0) && Number(r.unbilledInterest?.amount) > 0)
    .reduce((acc, r) => ({ amount: acc.amount + Number(r.unbilledInterest.amount), count: acc.count + ((r.unbilledInterest.items || []).length || 1) }), { amount: 0, count: 0 });

  const updateDraft = (index, patch) => {
    setDraft((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    setDirty(true);
  };
  const addExtra = (label) => {
    setDraft((prev) => [...prev, { label, amount: '' }]);
    setDirty(true);
  };
  const removeExtra = (index) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const saveRound = async ({ silent = false } = {}) => {
    if (!editable) return false;
    try {
      setSaving(true);
      // 금액이 0인 줄은 뺀다. 버튼만 누르고 금액을 비워 두면 청구서에 '과태료 -' 줄이 찍힌다.
      const extras = draft
        .filter((e) => Number(e.amount))
        .map((e) => ({ label: (e.label || '').trim() || '기타 청구', amount: Number(e.amount) }));
      const res = await fetch(`${API_HOST}/api/billing-schedules/${detail.schedule._id}/rounds/${round.no}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // other는 추가 항목 합계다. 항목을 모두 지웠을 때 지운 금액이 합계에 남지 않도록 함께 보낸다.
        body: JSON.stringify({ extras, other: otherFor(extras) })
      });
      const data = await res.json();
      if (!data.success) {
        showToast?.(data.message || '저장하지 못했습니다.', 'error');
        return false;
      }
      setDetail((prev) => ({
        ...prev,
        schedule: { ...prev.schedule, rounds: prev.schedule.rounds.map((r) => (r.no === round.no ? { ...data.round, excelInvoice: r.excelInvoice } : r)) }
      }));
      setDraft((data.round.extras || []).map((e) => ({ ...e })));
      setDirty(false);
      if (!silent) showToast?.(`${round.no}회차 청구 항목을 저장했습니다.`, 'success');
      return true;
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const partyName = detail?.schedule?.company?.name || detail?.schedule?.customer?.name || picked?.partyName || '';

  // 화면에 보이는 청구서를 그대로 PDF로 만든다. 고친 항목이 있으면 먼저 저장해 PDF와 기록이 같게 한다.
  const makePdf = async () => {
    if (!sheetRef.current || !round) return;
    try {
      setMaking(true);
      if (dirty && !(await saveRound({ silent: true }))) return;
      const blob = await makeInvoicePdf(sheetRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${partyName || '청구서'}_청구서_${round.no}회차.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      showToast?.(err.message || 'PDF를 만들지 못했습니다.', 'error');
    } finally {
      setMaking(false);
    }
  };

  // OneDrive에 저장해 둔 파일을 새 창으로 연다. 창을 먼저 열어 두지 않으면 팝업 차단에 걸린다.
  const openSavedFile = async (attachmentIndex, { excel = false } = {}) => {
    const win = window.open('', '_blank');
    try {
      const q = excel ? '?excel=1' : (attachmentIndex !== undefined ? `?attachment=${attachmentIndex}` : '');
      const res = await fetch(`${API_HOST}/api/billing-schedules/${detail.schedule._id}/rounds/${round.no}/file${q}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        win?.close();
        showToast?.(data.message || '파일을 열지 못했습니다.', 'error');
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch {
      win?.close();
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  const counts = useMemo(() => {
    const past = rounds.filter((r) => ymd(r.dueDate) <= todayYmd());
    return {
      total: rounds.length,
      past: past.length,
      issued: rounds.filter((r) => r.issuedAt).length,
      sent: rounds.filter((r) => r.sentAt).length,
      excel: rounds.filter((r) => r.excelInvoice?.total !== undefined).length,
      missing: past.filter((r) => !r.issuedAt && r.excelInvoice?.total === undefined).length,
      unpaid: rounds.filter((r) => r.status === '미납').length,
      // 다음 청구서에 전월 미결제로 넘어간 회차(청구 당시 미납이었던 회차)
      overdue: rounds.filter((r) => r.status !== '미납' && wasLate(r)).length,
      unbilledInterest: rounds.reduce((s, r) => s + (Number(r.unbilledInterest?.amount) || 0), 0)
    };
  }, [rounds]);

  const box = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px' };
  const inputStyle = { padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem' };
  const btn = (primary) => ({
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.45rem 0.8rem', borderRadius: '6px',
    fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
    border: primary ? 'none' : '1px solid var(--border-color)',
    background: primary ? 'var(--primary)' : '#fff', color: primary ? '#fff' : 'var(--text-main)'
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 260px) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
      {/* 계약 고르기 */}
      {/* 목록은 화면 위에 붙어 있고(sticky) 안에서만 스크롤한다. 목록 끝에서 휠을 더 굴려도 페이지 전체가 따라 움직이지 않게
          overscrollBehavior를 막는다. 오른쪽 청구서 길이(범칙금 줄 등)가 달라도 위쪽이 흔들리지 않는다. */}
      <div className="m-archive-list" style={{ ...box, padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: 'calc(100vh - 2rem)', position: 'sticky', top: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Search size={15} style={{ color: 'var(--primary)' }} />
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="계약자 / 계약번호 / 차량번호" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        </div>
        <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {filtered.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.5rem' }}>맞는 계약이 없습니다.</div>}
          {groups.map((g) => (
            <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#fff', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.2rem 0.25rem', borderBottom: '1px solid var(--border-color)' }}>
                {g.key === 'etc'
                  ? <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)' }}>결제일 미정</span>
                  : <PaymentDayBadge dayKey={g.key} />}
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{g.items.length}건</span>
              </div>
          {g.items.map((c) => {
            const active = picked?.contractId === c.contractId;
            return (
              <button
                key={c.contractId}
                type="button"
                onClick={() => pickContract(c)}
                style={{
                  textAlign: 'left', padding: '0.5rem 0.6rem', borderRadius: '6px', cursor: 'pointer',
                  border: active ? '1px solid var(--primary)' : '1px solid transparent',
                  background: active ? '#eef2ff' : 'transparent'
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{c.partyName || '계약자 미상'}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {/* 차가 많은 계약(신흥 20대 등)은 두 대만 보이고 나머지는 '외 n대'. 검색은 모든 차량번호로 된다 */}
                  {c.contractNo} · {(c.vehicles || []).slice(0, 2).map((v) => `${v.carModel} ${v.plateNo}`.trim()).join(', ') || '차량 미정'}
                  {(c.vehicles || []).length > 2 ? ` 외 ${c.vehicles.length - 2}대` : ''}
                </div>
              </button>
            );
          })}
            </div>
          ))}
        </div>
      </div>

      {!detail ? (
        <div style={{ ...box, padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          왼쪽에서 계약을 고르면 1회차부터 모든 청구서를 볼 수 있습니다.
        </div>
      ) : (
        <div ref={detailRef} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0, scrollMarginTop: '70px' }}>
          {/* 계약 요약 */}
          <div style={{ ...box, padding: '0.9rem 1.1rem' }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>{partyName}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {picked?.contractNo} · {detail.vehicles.map((v) => `${v.carModel || ''} ${v.plateNo || ''}`.trim()).join(', ')}
            </div>
            <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', marginTop: '0.6rem', fontSize: '0.82rem' }}>
              <span>전체 <b>{counts.total}</b>회차</span>
              <span>출금일 지난 회차 <b>{counts.past}</b></span>
              <span style={{ color: '#0284c7' }}>프로그램 발행 <b>{counts.issued}</b></span>
              <span style={{ color: '#16a34a' }}>메일 발송 <b>{counts.sent}</b></span>
              {counts.excel > 0 && <span style={{ color: '#0f766e' }}>엑셀 청구서 <b>{counts.excel}</b></span>}
              {counts.missing > 0 && <span style={{ color: '#b45309' }}>발행 기록 없음 <b>{counts.missing}</b></span>}
              {counts.unpaid > 0 && <span style={{ color: '#dc2626' }}>지금 미납 <b>{counts.unpaid}</b></span>}
              {counts.overdue > 0 && <span style={{ color: '#b45309' }}>늦게 입금(미납 이력) <b>{counts.overdue}</b>회</span>}
              {counts.unbilledInterest > 0 && <span style={{ color: '#92400e' }}>받지 않은 연체 이자 <b>{won(counts.unbilledInterest)}</b></span>}
            </div>
          </div>

          <InterestHistory rounds={rounds} />

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 400px) minmax(360px, 1fr)', gap: '1rem', alignItems: 'start' }}>
            {/* 회차 목록 */}
            <div style={{ ...box, overflow: 'auto', overscrollBehavior: 'contain', maxHeight: 'calc(100vh - 2rem)', position: 'sticky', top: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-main)' }}>
                  <tr>
                    {['회차', '출금일', '청구액', '청구서', '입금'].map((h) => (
                      <th key={h} style={{ padding: '0.55rem', textAlign: h === '청구액' ? 'right' : 'center', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((r) => {
                    const st = issueStateOf(r);
                    const pay = PAY_STYLE[r.status] || PAY_STYLE['예정'];
                    const active = r.no === selectedNo;
                    return (
                      <tr
                        key={r.no}
                        onClick={() => selectRound(r.no)}
                        style={{ cursor: 'pointer', borderTop: '1px solid var(--border-color)', background: active ? '#eef2ff' : undefined }}
                      >
                        <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 700 }}>{r.no}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'center', whiteSpace: 'nowrap' }}>{ymd(r.dueDate)}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {won(r.total)}
                          {r.excelInvoice?.total !== undefined && r.excelInvoice.total !== r.total && (
                            <div style={{ fontSize: '0.7rem', color: '#0f766e' }}>엑셀 {won(r.excelInvoice.total)}</div>
                          )}
                          {(r.extras || []).length > 0 && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'normal' }}>+ {r.extras.map((e) => e.label).join(', ')}</div>
                          )}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span style={{ background: st.bg, color: st.color, padding: '0.1rem 0.5rem', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700 }}>{st.label}</span>
                          {r.sentAt && <Mail size={13} style={{ color: '#16a34a', marginLeft: '0.3rem', verticalAlign: 'middle' }} />}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                          {/* 출금일 + 15일 안에 안 들어온 회차는 나중에 들어왔어도 '미납'으로 보여 주고 실제 입금일을 붙인다(대표님 지시 2026-10-20) */}
                          {r.status === '입금완료' && wasLate(r) ? (
                            <>
                              <span style={{ background: PAY_STYLE['미납'].bg, color: PAY_STYLE['미납'].color, padding: '0.1rem 0.5rem', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>미납</span>
                              <div style={{ fontSize: '0.66rem', color: '#16a34a', fontWeight: 700, whiteSpace: 'nowrap' }}>→ {ymd(r.paidAt).slice(2).replace(/-/g, '.')} 입금</div>
                            </>
                          ) : (
                            <span style={{ background: pay.bg, color: pay.color, padding: '0.1rem 0.5rem', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.status}</span>
                          )}
                          {r.unbilledInterest?.amount > 0 && (
                            <div style={{ fontSize: '0.66rem', color: '#92400e', whiteSpace: 'nowrap' }}>미청구 이자 {won(r.unbilledInterest.amount)}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 고른 회차: 추가 항목 + 청구서 */}
            {round && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', minWidth: 0 }}>
                <div style={{ ...box, padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 800 }}>
                      <FileText size={15} style={{ verticalAlign: 'middle', marginRight: '0.3rem', color: 'var(--primary)' }} />
                      {round.no}회차 청구서 <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.8rem' }}>출금일 {ymd(round.dueDate)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {locked && round.invoiceSavedPath && (
                        <button type="button" style={btn(false)} onClick={() => openSavedFile()}>
                          <ExternalLink size={13} /> 보낸 PDF 보기
                        </button>
                      )}
                      {editable && (
                        <button type="button" style={btn(false)} disabled={saving || !dirty} onClick={() => saveRound()}>
                          <Save size={13} /> {saving ? '저장 중' : '저장'}
                        </button>
                      )}
                      <button type="button" style={btn(true)} disabled={making} onClick={makePdf}>
                        <Download size={13} /> {making ? '만드는 중' : 'PDF 만들기'}
                      </button>
                    </div>
                  </div>

                  {/* 전달이 안 들어왔으면 여기서 [미납으로 처리] → 다음 청구서에 원금·이자 */}
                  {canEdit && round.status !== '입금완료' && daysSinceDue(round) >= 0 && (
                    <UnpaidBox
                      key={`${round.no}-${round.status}`}
                      scheduleId={detail.schedule._id}
                      round={round}
                      rounds={rounds}
                      showToast={showToast}
                      onDone={() => loadDetail(picked.contractId, round.no)}
                    />
                  )}

                  {locked ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {ymd(round.issuedAt)}에 발행한 회차입니다{round.sentAt ? ` · ${ymd(round.sentAt)} 메일 발송` : ' · 메일은 보내지 않았습니다'}.
                      보낸 내용과 달라지지 않도록 여기서는 고칠 수 없습니다.
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        과태료, 자부담금처럼 이 회차에 더 청구할 금액을 넣으면 아래 청구서에 바로 반영됩니다.
                      </div>
                      {draft.map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <input
                            value={e.label || ''}
                            onChange={(ev) => updateDraft(i, { label: ev.target.value })}
                            placeholder="항목 (예: 과태료 3/2 속도위반)"
                            disabled={!editable}
                            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                          />
                          <MoneyInput
                            value={e.amount}
                            onChange={(ev) => updateDraft(i, { amount: ev.target.value })}
                            placeholder="금액"
                            disabled={!editable}
                            style={{ ...inputStyle, width: '120px' }}
                          />
                          {editable && (
                            <button type="button" onClick={() => removeExtra(i)} title="이 항목 빼기" style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer' }}>
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      ))}
                      {editable && (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {QUICK_EXTRAS.map((label) => (
                            <button key={label} type="button" style={btn(false)} onClick={() => addExtra(label)}>
                              <Plus size={13} /> {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {round.excelInvoice?.total !== undefined && (
                    <ExcelInvoiceBox
                      inv={round.excelInvoice}
                      systemTotal={round.total}
                      onOpen={(round.excelInvoice.savedPath || round.excelInvoice.sourcePath) ? () => openSavedFile(undefined, { excel: true }) : null}
                    />
                  )}

                  {(round.attachments || []).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.5rem' }}>
                      {round.attachments.map((a, i) => (
                        <div key={a.fileName || i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem' }}>
                          <Paperclip size={12} style={{ color: 'var(--text-muted)' }} />
                          <span>{a.kind}{a.amount ? ` ${won(a.amount)}` : ''}</span>
                          {a.savedPath && (
                            <button type="button" onClick={() => openSavedFile(i)} style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>
                              보기
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!locked && ymd(round.dueDate) <= todayYmd() && (
                    <div style={{ fontSize: '0.74rem', color: '#b45309' }}>
                      지난 회차는 입금 기록이 없으면 전월 미결제·연체 이자가 0원으로 계산됩니다.
                    </div>
                  )}
                </div>

                {/* 청구서. 양식은 폭이 780px로 고정이라 칸 폭에 맞춰 줄여 보여 준다. */}
                <div
                  ref={previewBoxRef}
                  onClick={() => setBigView(true)}
                  title="눌러서 크게 보기"
                  style={{ ...box, overflow: 'hidden', padding: '0.5rem', cursor: 'zoom-in' }}
                >
                  <div style={{ zoom: previewZoom }}>
                    <InvoiceSheet
                      item={{ company: detail.schedule.company, customer: detail.schedule.customer, contract: detail.contract, proration: detail.schedule.proration, unbilledInterestToDate: interestToDate }}
                      round={previewRound}
                      vehicles={detail.vehicles}
                      total={previewTotal}
                    />
                  </div>
                </div>
                {bigView && (
                  <div
                    onClick={() => setBigView(false)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, overflow: 'auto', padding: '2rem', cursor: 'zoom-out' }}
                  >
                    <div style={{ width: 'fit-content', margin: '0 auto', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
                      <InvoiceSheet
                        item={{ company: detail.schedule.company, customer: detail.schedule.customer, contract: detail.contract, proration: detail.schedule.proration, unbilledInterestToDate: interestToDate }}
                        round={previewRound}
                        vehicles={detail.vehicles}
                        total={previewTotal}
                      />
                    </div>
                  </div>
                )}
                {/* PDF는 줄이지 않은 원래 크기로 만든다. 화면 밖에 한 벌 더 그려 두고 이것을 캡처한다. */}
                <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
                  <InvoiceSheet
                    innerRef={sheetRef}
                    item={{ company: detail.schedule.company, customer: detail.schedule.customer, contract: detail.contract, proration: detail.schedule.proration, unbilledInterestToDate: interestToDate }}
                    round={previewRound}
                    vehicles={detail.vehicles}
                    total={previewTotal}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 엑셀로 보낸 청구서의 내용. 드롭박스 청구서 PDF에서 읽은 '청구내역' 줄(미납통행료·범칙금·자부담금 등)을
 * 이름 그대로 보여 주고, 프로그램 계산과 금액이 다르면 차이를 함께 적는다.
 */
function ExcelInvoiceBox({ inv, systemTotal, onOpen }) {
  const diff = (Number(inv.total) || 0) - (Number(systemTotal) || 0);
  const items = (inv.items || []).filter((it) => Number(it.amount));
  return (
    <div style={{ border: '1px solid #99f6e4', background: '#f0fdfa', borderRadius: '8px', padding: '0.6rem 0.75rem', fontSize: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, color: '#0f766e' }}>
          엑셀로 보낸 청구서
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
            {inv.payDate ? `결제일 ${inv.payDate}` : ''}{inv.roundNo ? ` · 청구서상 ${inv.roundNo}회` : ''}
          </span>
        </div>
        {onOpen && (
          <button type="button" onClick={onOpen} style={{ border: '1px solid #5eead4', background: '#fff', color: '#0f766e', borderRadius: '6px', padding: '0.25rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
            보낸 PDF 보기
          </button>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.4rem' }}>
        <tbody>
          {items.map((it, i) => (
            <tr key={`${i}-${it.label}`} style={{ borderTop: '1px dashed #ccfbf1' }}>
              <td style={{ padding: '0.2rem 0' }}>{it.label}</td>
              <td style={{ padding: '0.2rem 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{won(it.amount)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid #5eead4' }}>
            <td style={{ padding: '0.3rem 0', fontWeight: 800 }}>결제금액</td>
            <td style={{ padding: '0.3rem 0', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{won(inv.total)}</td>
          </tr>
        </tbody>
      </table>
      {diff !== 0 && (
        <div style={{ marginTop: '0.3rem', color: '#b45309' }}>
          프로그램 계산 {won(systemTotal)}과 {won(Math.abs(diff))} {diff > 0 ? '많게' : '적게'} 청구했습니다.
        </div>
      )}
    </div>
  );
}

/**
 * 연체 이자 내역. 언제(어느 청구서에서), 어느 미납 회차에 대해, 어떤 기간으로 붙었는지 한 줄씩.
 * 지난 청구서의 이자는 받지 않았으므로 '청구하지 않음', 앞으로 보낼 청구서에 넣은 이자는 '청구'로 적는다.
 */
function InterestHistory({ rounds }) {
  const [open, setOpen] = useState(false);
  const fmt = (d) => (d ? String(d).slice(2, 10).replace(/-/g, '.') : '-');
  const rows = [];
  for (const r of rounds) {
    for (const it of r.unbilledInterest?.items || []) {
      rows.push({ on: r, fromNo: it.fromNo, principal: it.principal, from: it.from, to: it.to, days: it.days, rate: it.rate, amount: it.amount, billed: false });
    }
    for (const e of r.extras || []) {
      const m = /^연체 이자 \((\d+)회차 ([\d,]+)원 · 연 (\d+)% · (\d+)일\)/.exec(e.label || '');
      if (m) rows.push({ on: r, fromNo: Number(m[1]), principal: Number(m[2].replace(/,/g, '')), from: null, to: r.dueDate, days: Number(m[4]), rate: Number(m[3]), amount: e.amount, billed: true });
    }
  }
  if (!rows.length) return null;
  const unbilledRows = rows.filter((x) => !x.billed);
  const unbilled = unbilledRows.reduce((s, x) => s + x.amount, 0);
  const billed = rows.filter((x) => x.billed).reduce((s, x) => s + x.amount, 0);
  const th = { padding: '0.4rem', textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' };
  const td = { padding: '0.35rem 0.4rem', textAlign: 'center', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' };
  return (
    <div style={{ background: '#fff', border: '1px solid #fcd34d', borderRadius: '10px', padding: '0.7rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', fontSize: '0.84rem' }}>
        <strong style={{ color: '#92400e' }}>연체 이자 내역</strong>
        <span>받지 않은 이자 <b style={{ color: '#92400e' }}>{unbilled.toLocaleString()}원</b> ({unbilledRows.length}건)</span>
        {billed > 0 && <span>청구한 이자 <b>{billed.toLocaleString()}원</b></span>}
        <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>출금일 + 15일 안에 안 들어온 회차에, 들어올 때까지 청구서마다 한 달치(원금 × 연이율 × 일수 ÷ 365)</span>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ marginLeft: 'auto', border: '1px solid #fcd34d', background: '#fffbeb', color: '#92400e', borderRadius: '6px', padding: '0.25rem 0.7rem', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}>
          {open ? '접기' : '내역 보기'}
        </button>
      </div>
      {open && (
        <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead><tr>{['이자가 붙은 청구서', '미납 회차', '원금', '기간', '일수', '이율', '이자', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((x, i) => (
                <tr key={i} style={{ background: x.billed ? '#fef2f2' : undefined }}>
                  <td style={td}>{x.on.no}회 ({fmt(x.on.dueDate)})</td>
                  <td style={td}>{x.fromNo}회분</td>
                  <td style={{ ...td, textAlign: 'right' }}>{Number(x.principal).toLocaleString()}</td>
                  <td style={td}>{x.from ? `${fmt(x.from)} ~ ${fmt(x.to)}` : `~ ${fmt(x.to)}`}</td>
                  <td style={td}>{x.days}일</td>
                  <td style={td}>연 {x.rate}%</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{Number(x.amount).toLocaleString()}</td>
                  <td style={{ ...td, color: x.billed ? '#dc2626' : '#92400e', fontWeight: 700 }}>{x.billed ? '청구' : '청구하지 않음'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default InvoiceArchiveView;
