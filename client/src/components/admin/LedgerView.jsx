import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Plus, Save, Trash2, RefreshCw, ArrowLeft, Link2, Printer, FileSpreadsheet, ArrowUp, ArrowDown, CalendarPlus, Pencil, Check, X } from 'lucide-react';
import { toCommaString } from '../../utils/format.js';
import MoneyInput from './MoneyInput.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * 은행 칸 선택지.
 *
 * 갑지에는 예전부터 B / SC 두 글자로 적어 왔고 8,277줄이 그렇게 쌓여 있다.
 * 저장하는 값은 그대로 두고 화면에만 실제 은행 이름을 함께 보여 준다.
 */
const BANK_LABELS = { B: '부산은행', SC: '제일은행', KB: '국민은행' };
const BANKS = ['B', 'SC', '카드', 'KB', '삼성', '하나', '현금'];
const bankText = (code) => {
  const c = (code || '').trim();
  if (!c) return '-';
  return BANK_LABELS[c] ? `${c} (${BANK_LABELS[c]})` : c;
};

/**
 * 손으로 친 날짜를 YYYY-MM-DD로 바꾼다. 261029 -> 2026-10-29
 *
 * 달력에서 고르는 것보다 여섯 자리 치는 편이 훨씬 빠르다.
 * 알아들을 수 없으면 null을 돌려주고, 부르는 쪽이 원래 값으로 되돌린다.
 */
const parseDateInput = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = s.replace(/\D/g, '');
  let y;
  let m;
  let day;
  if (d.length === 8) { y = +d.slice(0, 4); m = +d.slice(4, 6); day = +d.slice(6, 8); }
  else if (d.length === 6) { y = 2000 + +d.slice(0, 2); m = +d.slice(2, 4); day = +d.slice(4, 6); }
  else return null;

  const dt = new Date(y, m - 1, day);
  // 2월 30일 같은 값을 걸러 낸다. Date는 그런 날짜를 조용히 3월로 넘겨 버린다.
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== day) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// 항목 분류. 화면에 찍히는 이름(내용)은 자유 입력이고, 이건 나중에 통계를 내기 위한 꼬리표다.
const CATEGORIES = [
  '계약금', '차량가', '등록비용', '할부이자', '할부금',
  '보험', '자동차세', '검사비', '정기점검', '과태료·통행료',
  '공제조합', '차량작업', '수리·사고', '유류·세차', '탁송',
  '제세공과', '보증금', '선납금', '인수가', '렌트료',
  '수수료', '캐시백', '환급', '기타'
];

// 엑셀 갑지의 3개 열. group이 열 위치를, side가 정산 부호를 정한다.
const COLUMNS = [
  { group: '회사출금', title: '회사출금액 (지출)', side: '지출', accent: '#d9534f' },
  { group: '고객입금', title: '고객입금액 (입금)', side: '입금', accent: '#2f6f4e' },
  { group: '기타', title: '기타 (수수료·환급)', side: '입금', accent: '#4a6fa5' }
];

const STATUSES = ['차량미배정', '운용중', '거래완료', '보류'];
const LEDGER_TYPES = ['장기렌트', '사고대차', '단기렌트', '기타'];

/**
 * 목록에서 정렬할 수 있는 항목.
 *
 * key는 서버가 아는 이름이고, 표 머리글을 누르면 그 기준으로 정렬한다.
 * 누적지출·누적입금·정산금액은 저장된 값이 아니라 줄을 합쳐 만든 값이라 서버에서 계산 후 정렬한다.
 */
const SORTABLE = [
  { key: 'ledgerNo', label: '구분(갑지)' },
  { key: 'contractorName', label: '계약자명' },
  { key: 'customerName', label: '고객명' },
  { key: 'carModel', label: '차종' },
  { key: null, label: '차량 사양' },
  { key: 'plateNo', label: '차량번호' },
  { key: null, label: '차대번호' },
  { key: 'deliveredAt', label: '출고일' },
  { key: 'contractEndAt', label: '계약종료일' },
  { key: null, label: '구분' },
  { key: null, label: '상태' },
  { key: 'paidOut', label: '누적지출', numeric: true },
  { key: 'paidIn', label: '누적입금', numeric: true },
  { key: 'balance', label: '정산금액', numeric: true }
];

const toDateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
// 1구간은 최초 계약, 그 뒤로는 1차·2차 연장이다
const periodName = (seq) => (seq === 1 ? '최초 계약' : `${seq - 1}차 연장`);
const signed = (n) => `${n < 0 ? '-' : ''}${toCommaString(Math.abs(n || 0))} 원`;

const card = {
  background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)',
  boxShadow: 'var(--shadow-premium)'
};
const cellInput = {
  width: '100%', border: '1px solid transparent', background: 'transparent',
  padding: '0.3rem 0.35rem', fontSize: '0.78rem', borderRadius: '4px', color: 'var(--text-bright)'
};
const th = {
  padding: '0.5rem 0.4rem', fontSize: '0.75rem', fontWeight: '700',
  color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', textAlign: 'left'
};

/**
 * 날짜 입력칸. 달력을 열지 않고 261029처럼 쳐 넣으면 2026-10-29가 된다.
 *
 * 칸을 벗어나거나 Enter를 누를 때 정리한다. 타이핑 도중에 고쳐 버리면
 * 26까지 쳤을 때 값이 멋대로 바뀌어 다음 글자를 못 친다.
 */
function DateText({ value, onChange, disabled, style, placeholder = 'YYMMDD' }) {
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);

  const commit = () => {
    const parsed = parseDateInput(text);
    if (parsed === null) { setText(value || ''); return; } // 못 알아들으면 되돌린다
    setText(parsed);
    if (parsed !== (value || '')) onChange(parsed);
  };

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      disabled={disabled}
      placeholder={placeholder}
      title="261029 처럼 여섯 자리로 쳐도 됩니다"
      style={style}
    />
  );
}

/**
 * 차량 손익 원장 (갑지).
 *
 * 목록에서 차량을 찾아 들어가면 그 차 한 대의 정산 카드가 열린다.
 * 엑셀 "렌트베네핏 장기렌트_갑지.xlsx"의 시트 한 장이 이 화면 하나다.
 */
function LedgerView({ showToast, currentUser }) {
  const canEdit = currentUser?.role !== 'viewer';

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
  const [ledgers, setLedgers] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [loading, setLoading] = useState(false);

  const [ledger, setLedger] = useState(null); // 열려 있는 갑지 한 장
  const [entries, setEntries] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // 차량 연결 팝업
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState([]);

  // 계약 연장 팝업
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendQuery, setExtendQuery] = useState('');
  const [extendResults, setExtendResults] = useState([]);

  // 상세에서 보고 있는 계약 구간. null이면 전체(차 1대 기준 누적)
  const [periodView, setPeriodView] = useState(null);

  // 지금 고치고 있는 줄. 평소에는 읽기만 하고 연필을 눌러야 입력칸이 열린다.
  const [editingId, setEditingId] = useState(null);
  // 열마다 맨 위 "추가" 칸에 쳐 넣고 있는 값
  const [draft, setDraft] = useState({});
  // 지금까지 적어 온 항목명 (자동완성용)
  const [labelHints, setLabelHints] = useState({});

  /**
   * 이 갑지의 계약 구간.
   * 연장 이력이 아직 없는 갑지는 지금 붙어 있는 계약으로 1구간짜리 목록을 만든다.
   */
  const periods = useMemo(() => {
    if (ledger?.contractPeriods?.length) {
      return [...ledger.contractPeriods].sort((a, b) => a.seq - b.seq);
    }
    return [{
      seq: 1,
      startDate: ledger?.header?.contractedAt,
      endDate: ledger?.header?.contractEndAt,
      termMonths: ledger?.terms?.termMonths,
      monthlyRent: ledger?.terms?.monthlyRent
    }];
  }, [ledger]);
  const latestSeq = periods[periods.length - 1]?.seq || 1;

  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    'X-User-Role': currentUser?.role || 'viewer'
  }), [currentUser]);

  const fetchLedgers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('ledgerType', typeFilter);
      params.set('sort', sortKey);
      params.set('order', sortOrder);
      const res = await fetch(`${API_HOST}/api/ledgers?${params.toString()}`);
      if (res.ok) setLedgers(await res.json());
    } catch (err) {
      console.error('갑지 목록을 불러오지 못했습니다', err);
    } finally {
      setLoading(false);
    }
  }, [query, statusFilter, typeFilter, sortKey, sortOrder]);

  useEffect(() => {
    if (viewMode !== 'list') return undefined;
    const timer = setTimeout(fetchLedgers, 250);
    return () => clearTimeout(timer);
  }, [viewMode, fetchLedgers]);

  // 항목명 자동완성 목록은 한 번만 받아 둔다
  useEffect(() => {
    fetch(`${API_HOST}/api/ledgers/labels`)
      .then((res) => (res.ok ? res.json() : {}))
      .then(setLabelHints)
      .catch(() => {});
  }, []);

  // 서버가 내려준 갑지 한 장을 화면 상태로 펼친다
  const applyLedger = (data) => {
    setLedger(data);
    setEntries((data.entries || []).map((e) => ({ ...e, date: toDateInput(e.date), periodSeq: e.periodSeq || 1 })));
    setDirty(false);
    setPeriodView(null);
  };

  const openLedger = async (id) => {
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/${id}`);
      if (!res.ok) throw new Error('불러오기 실패');
      applyLedger(await res.json());
      setViewMode('detail');
    } catch {
      showToast('갑지를 불러오지 못했습니다.', 'error');
    }
  };

  const backToList = () => {
    if (dirty && !window.confirm('저장하지 않은 내용이 있습니다. 목록으로 나가시겠습니까?')) return;
    setViewMode('list');
    setLedger(null);
    fetchLedgers();
  };

  const handleCreate = async () => {
    const carModel = window.prompt('갑지를 만들 차종을 입력하세요. (차량 출고 전이면 예상 차종을 적어도 됩니다)');
    if (!carModel) return;
    try {
      const res = await fetch(`${API_HOST}/api/ledgers`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ header: { carModel } })
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const created = await res.json();
      showToast(`갑지 ${created.ledgerNo}을(를) 만들었습니다. 차량이 출고되면 연결해 주세요.`, 'success');
      applyLedger(created);
      setViewMode('detail');
    } catch (err) {
      showToast(err.message || '갑지를 만들지 못했습니다.', 'error');
    }
  };

  const handleDelete = async (id, ledgerNo) => {
    if (!window.confirm(`갑지 ${ledgerNo}를 삭제할까요? 적어 둔 금액도 함께 사라집니다.`)) return;
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/${id}`, { method: 'DELETE', headers: authHeaders });
      if (!res.ok) throw new Error((await res.json()).message);
      showToast('갑지를 삭제했습니다.', 'success');
      if (viewMode === 'detail') { setViewMode('list'); setLedger(null); }
      fetchLedgers();
    } catch (err) {
      showToast(err.message || '삭제하지 못했습니다.', 'error');
    }
  };

  /**
   * 표 머리글을 누르면 그 기준으로 정렬한다.
   * 같은 기준을 다시 누르면 오름/내림이 뒤집힌다. 처음 누를 때의 방향은
   * 이름은 가나다순(오름), 금액·날짜는 큰 값·최근 순(내림)이 사람이 기대하는 쪽이다.
   */
  const toggleSort = (col) => {
    if (!col.key) return;
    if (sortKey === col.key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(col.key);
    setSortOrder(col.numeric || col.key.endsWith('At') ? 'desc' : 'asc');
  };

  const resetFilters = () => {
    setQuery(''); setStatusFilter(''); setTypeFilter('');
    setSortKey('createdAt'); setSortOrder('desc');
  };

  // ── 갑지 상세 ────────────────────────────────────────────────

  const setHeaderField = (key, value) => {
    setLedger((prev) => ({ ...prev, header: { ...prev.header, [key]: value } }));
    setDirty(true);
  };
  const setTermsField = (key, value) => {
    setLedger((prev) => ({ ...prev, terms: { ...prev.terms, [key]: value } }));
    setDirty(true);
  };
  const setLoanField = (key, value) => {
    setLedger((prev) => ({ ...prev, loan: { ...(prev.loan || {}), [key]: value } }));
    setDirty(true);
  };

  const updateEntry = (id, key, value) => {
    setEntries((prev) => prev.map((e) => (e._id === id ? { ...e, [key]: value } : e)));
    setDirty(true);
  };

  const setDraftField = (group, key, value) =>
    setDraft((prev) => ({ ...prev, [group]: { ...(prev[group] || {}), [key]: value } }));

  /**
   * 맨 위 칸에 쳐 넣은 값으로 줄을 하나 만든다.
   *
   * 새 줄은 목록 위쪽에 쌓는다. 방금 적은 것이 눈앞에 있어야 잘못 친 걸 바로 알아챈다.
   * 분류는 고르지 않는다. 저장할 때 서버가 항목명에서 판정한다.
   */
  const addFromDraft = (column) => {
    const d = draft[column.group] || {};
    const amount = Number(d.amount) || 0;
    if (!d.label && !amount) {
      showToast('내용이나 금액 중 하나는 적어야 합니다.', 'error');
      return;
    }

    setEntries((prev) => [{
      _id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      isNew: true,
      side: column.side,
      group: column.group,
      category: '기타',
      label: d.label || '',
      amount,
      bank: d.bank || 'B',
      date: d.date || '',
      // 특정 구간을 보고 있으면 그 구간 줄로 넣는다. 전체 보기에서는 마지막 구간에 붙인다.
      periodSeq: periodView || latestSeq
    }, ...prev]);

    // 은행은 대개 같은 곳이 이어지므로 남겨 두고 나머지만 비운다
    setDraft((prev) => ({ ...prev, [column.group]: { bank: d.bank || 'B' } }));
    setDirty(true);
  };

  const removeRow = (id) => {
    if (!window.confirm('이 줄을 지울까요?')) return;
    setEntries((prev) => prev.filter((e) => e._id !== id));
    if (editingId === id) setEditingId(null);
    setDirty(true);
  };

  /**
   * 화면의 값으로 집계를 다시 계산한다.
   *
   * 저장하기 전에도 숫자가 맞아 떨어지는지 바로 보여야 자금팀이 입력하면서 대조할 수 있다.
   * 서버도 같은 방식으로 계산하므로 저장 후 값이 달라지지 않는다.
   */
  const summary = useMemo(() => {
    const byBank = {};
    let paidOut = 0;
    let paidIn = 0;
    entries.forEach((e) => {
      if (periodView !== null && (e.periodSeq || 1) !== periodView) return;
      const amount = Number(e.amount) || 0;
      if (!amount) return;
      const bank = (e.bank || '미지정').trim() || '미지정';
      if (!byBank[bank]) byBank[bank] = { bank, paidOut: 0, paidIn: 0 };
      if (e.side === '입금') { byBank[bank].paidIn += amount; paidIn += amount; }
      else { byBank[bank].paidOut += amount; paidOut += amount; }
    });
    // 엑셀 상단 박스가 B / SC 두 줄이라 그 순서를 지키고, 나머지 은행은 뒤에 붙인다
    const order = ['B', 'SC'];
    const rows = Object.values(byBank).sort((a, b) => {
      const ai = order.indexOf(a.bank); const bi = order.indexOf(b.bank);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.bank.localeCompare(b.bank);
    });
    return { rows, paidOut, paidIn, balance: paidIn - paidOut };
  }, [entries, periodView]);

  const handleSave = async () => {
    if (!ledger) return;
    setSaving(true);
    try {
      // 상단 정보와 고정 조건은 갑지 안에서만 산다. 계약서·차량 DB로는 되돌아가지 않는다.
      const metaRes = await fetch(`${API_HOST}/api/ledgers/${ledger._id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          header: ledger.header, terms: ledger.terms, loan: ledger.loan,
          ledgerType: ledger.ledgerType, status: ledger.status, note: ledger.note
        })
      });
      if (!metaRes.ok) throw new Error((await metaRes.json()).message);

      const entryRes = await fetch(`${API_HOST}/api/ledgers/${ledger._id}/entries`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          entries: entries.map((e) => ({
            ...(e.isNew ? {} : { _id: e._id }),
            side: e.side, group: e.group, category: e.category, label: e.label,
            amount: Number(e.amount) || 0, bank: e.bank,
            date: e.date || null, round: e.round, periodSeq: e.periodSeq || 1, memo: e.memo
          }))
        })
      });
      if (!entryRes.ok) throw new Error((await entryRes.json()).message);

      applyLedger(await entryRes.json());
      showToast('갑지를 저장했습니다.', 'success');
    } catch (err) {
      showToast(err.message || '저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!ledger) return;
    if (dirty && !window.confirm('저장하지 않은 내용은 사라집니다. 계속할까요?')) return;
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/${ledger._id}/sync`, { method: 'POST', headers: authHeaders });
      if (!res.ok) throw new Error((await res.json()).message);
      const data = await res.json();
      applyLedger(data);
      showToast(`계약·청구·차량 정보에서 ${data.syncedCount}줄을 가져왔습니다. 직접 고친 줄은 그대로 두었습니다.`, 'success');
    } catch (err) {
      showToast(err.message || '가져오지 못했습니다.', 'error');
    }
  };

  const searchLinkable = async (q) => {
    setLinkQuery(q);
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/linkable-vehicles?q=${encodeURIComponent(q)}`);
      if (res.ok) setLinkResults(await res.json());
    } catch { /* 검색 실패는 조용히 넘긴다 */ }
  };

  const searchExtendable = async (q) => {
    setExtendQuery(q);
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/contract-search?q=${encodeURIComponent(q)}`);
      if (res.ok) setExtendResults(await res.json());
    } catch { /* 검색 실패는 조용히 넘긴다 */ }
  };

  const handleExtend = async (contractId, contractNo) => {
    if (!window.confirm(`계약 ${contractNo}을(를) 이 갑지의 연장 구간으로 붙일까요?`)) return;
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/${ledger._id}/extend`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ contractId })
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const data = await res.json();
      applyLedger(data);
      setExtendOpen(false);
      showToast(
        data.absorbedLedger
          ? `연장 구간을 붙였습니다. 따로 만들어져 있던 갑지 ${data.absorbedLedger}(${data.absorbedEntries}줄)을 이 갑지로 합쳤습니다.`
          : '연장 구간을 붙였습니다.',
        'success'
      );
    } catch (err) {
      showToast(err.message || '연장을 등록하지 못했습니다.', 'error');
    }
  };

  const handleLink = async (vehicleId) => {
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/${ledger._id}/link-vehicle`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ vehicleId })
      });
      if (!res.ok) throw new Error((await res.json()).message);
      applyLedger(await res.json());
      setLinkOpen(false);
      showToast('차량을 연결했습니다.', 'success');
    } catch (err) {
      showToast(err.message || '연결하지 못했습니다.', 'error');
    }
  };

  // ── 렌더 ────────────────────────────────────────────────────

  if (viewMode === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
        <div style={{ ...card, padding: '1.2rem', display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="갑지번호 · 차량번호 · 차대번호 · 차종 · 계약자명으로 검색"
              style={{ width: '100%', padding: '0.6rem 0.7rem 0.6rem 2.2rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem' }}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: '#fff' }}
          >
            <option value="">전체 구분</option>
            {LEDGER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: '#fff' }}
          >
            <option value="">전체 상태</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={`${sortKey}:${sortOrder}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':');
              setSortKey(key); setSortOrder(dir);
            }}
            title="표 머리글을 눌러도 같은 기준으로 정렬됩니다"
            style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: '#fff' }}
          >
            <option value="createdAt:desc">최근 만든 순</option>
            {SORTABLE.filter((c) => c.key).flatMap((c) => ([
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} 오름차순</option>,
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} 내림차순</option>
            ]))}
          </select>
          {(query || statusFilter || typeFilter || sortKey !== 'createdAt') && (
            <button
              type="button"
              onClick={resetFilters}
              style={{ border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.6rem 0.8rem', borderRadius: '8px', fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer' }}
            >
              초기화
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={handleCreate}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
            >
              <Plus size={15} /> 갑지 수동 생성
            </button>
          )}
        </div>

        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-main)' }}>
            <span style={{ fontWeight: '700', fontSize: '0.9rem' }}>
              <FileSpreadsheet size={15} style={{ verticalAlign: '-2px', marginRight: '0.35rem' }} />
              차량 손익 원장 {loading ? '' : `${ledgers.length}건`}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>차량 1대당 갑지 한 장입니다.</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '1100px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-main)' }}>
                  {SORTABLE.map((col, i) => {
                    const active = col.key && sortKey === col.key;
                    return (
                      <th
                        key={col.label + i}
                        onClick={() => toggleSort(col)}
                        style={{
                          ...th,
                          textAlign: col.numeric ? 'right' : 'left',
                          whiteSpace: 'nowrap',
                          cursor: col.key ? 'pointer' : 'default',
                          color: active ? 'var(--primary)' : th.color,
                          userSelect: 'none'
                        }}
                      >
                        {col.label}
                        {active && (sortOrder === 'asc'
                          ? <ArrowUp size={12} style={{ verticalAlign: '-2px', marginLeft: '2px' }} />
                          : <ArrowDown size={12} style={{ verticalAlign: '-2px', marginLeft: '2px' }} />)}
                      </th>
                    );
                  })}
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {ledgers.map((l) => (
                  <tr
                    key={l._id}
                    onClick={() => openLedger(l._id)}
                    style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '0.55rem 0.4rem', fontWeight: '700', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{l.ledgerNo}</td>
                    <td style={{ padding: '0.55rem 0.4rem' }}>{l.header?.contractorName || l.company?.name || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem' }}>{l.header?.customerName || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem' }}>{l.header?.carModel || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem' }}>{l.header?.carSpec || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>{l.header?.plateNo || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>{l.header?.vin || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>{toDateInput(l.header?.deliveredAt) || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>{toDateInput(l.header?.contractEndAt) || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: '700', padding: '0.15rem 0.45rem', borderRadius: '10px', background: l.ledgerType === '사고대차' ? '#fde8e8' : 'var(--bg-main)', color: l.ledgerType === '사고대차' ? '#a33' : 'var(--text-muted)' }}>
                        {l.ledgerType || '장기렌트'}
                      </span>
                    </td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: '700', padding: '0.15rem 0.45rem', borderRadius: '10px', background: l.status === '차량미배정' ? '#fff3cd' : 'var(--bg-main)', color: l.status === '차량미배정' ? '#8a6d1f' : 'var(--text-muted)' }}>
                        {l.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.55rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{toCommaString(l.summary?.paidOut)}</td>
                    <td style={{ padding: '0.55rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{toCommaString(l.summary?.paidIn)}</td>
                    <td style={{ padding: '0.55rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: '700', color: (l.summary?.balance || 0) < 0 ? '#d9534f' : '#2f6f4e' }}>
                      {signed(l.summary?.balance)}
                    </td>
                    <td style={{ padding: '0.55rem 0.4rem' }}>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDelete(l._id, l.ledgerNo); }}
                          style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && ledgers.length === 0 && (
                  <tr><td colSpan={SORTABLE.length + 1} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    갑지가 없습니다. 계약서를 등록하면 차량마다 자동으로 만들어지고, 출고 전이라면 "갑지 수동 생성"으로 먼저 만들 수 있습니다.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (!ledger) return null;

  const h = ledger.header || {};
  const t = ledger.terms || {};
  const loan = ledger.loan || {};

  const headerFields = [
    ['구분', 'ledgerNo', null], ['고객명', 'customerName', 'text'], ['계약자명', 'contractorName', 'text'],
    ['차량번호', 'plateNo', 'text'], ['차종', 'carModel', 'text'], ['차량 사양', 'carSpec', 'text'],
    ['등록일', 'registeredAt', 'date'], ['계약일', 'contractedAt', 'date'], ['계약종료일', 'contractEndAt', 'date'],
    ['출고일', 'deliveredAt', 'date'], ['차대번호', 'vin', 'text'], ['배기량', 'cc', 'number']
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* 상단 바 */}
      <div style={{ ...card, padding: '1rem 1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <button type="button" onClick={backToList} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: '#fff', padding: '0.45rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' }}>
            <ArrowLeft size={14} /> 목록
          </button>
          <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: '800' }}>
            차량 정산 카드 (갑지) · <span style={{ color: 'var(--primary)' }}>{ledger.ledgerNo}</span>
          </h4>
          <select
            value={ledger.ledgerType || '장기렌트'}
            onChange={(e) => { setLedger((p) => ({ ...p, ledgerType: e.target.value })); setDirty(true); }}
            disabled={!canEdit}
            title="갑지의 성격. 차량을 연결하면 렌트차량 DB 상태를 보고 자동으로 정해집니다."
            style={{ padding: '0.35rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.78rem', background: '#fff' }}
          >
            {LEDGER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={ledger.status}
            onChange={(e) => { setLedger((p) => ({ ...p, status: e.target.value })); setDirty(true); }}
            disabled={!canEdit}
            style={{ padding: '0.35rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.78rem', background: '#fff' }}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {dirty && <span style={{ fontSize: '0.75rem', color: '#d9534f', fontWeight: '700' }}>저장 안 됨</span>}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {canEdit && !ledger.vehicle && (
            <button type="button" onClick={() => { setLinkOpen(true); searchLinkable(''); }} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid #8a6d1f', background: '#fff3cd', color: '#8a6d1f', padding: '0.45rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}>
              <Link2 size={14} /> 차량 연결
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={() => { setExtendOpen(true); searchExtendable(''); }} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--primary)', background: '#fff', color: 'var(--primary)', padding: '0.45rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}>
              <CalendarPlus size={14} /> 계약 연장 등록
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={handleSync} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: '#fff', padding: '0.45rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' }}>
              <RefreshCw size={14} /> 계약·청구에서 가져오기
            </button>
          )}
          <button type="button" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: '#fff', padding: '0.45rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' }}>
            <Printer size={14} /> 인쇄
          </button>
          {canEdit && (
            <button type="button" onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.45rem 1rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer' }}>
              <Save size={14} /> {saving ? '저장 중...' : '저장'}
            </button>
          )}
        </div>
      </div>

      {/* 상단 정보 */}
      <div style={{ ...card, padding: '1.2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
          {headerFields.map(([label, key, type]) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</label>
              {type === null ? (
                <div style={{ padding: '0.45rem 0.5rem', background: 'var(--bg-main)', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '700' }}>{ledger.ledgerNo}</div>
              ) : (
                <input
                  type={type === 'date' ? 'date' : (type === 'number' ? 'number' : 'text')}
                  value={type === 'date' ? toDateInput(h[key]) : (h[key] ?? '')}
                  onChange={(e) => setHeaderField(key, e.target.value)}
                  disabled={!canEdit}
                  style={{ width: '100%', padding: '0.45rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', background: '#fff' }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 계약 구간 탭 - 연장이 있는 갑지에서만 의미가 있다 */}
      {periods.length > 1 && (
        <div style={{ ...card, padding: '0.7rem 1rem', display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', marginRight: '0.3rem' }}>구간별 보기</span>
          {[null, ...periods.map((p) => p.seq)].map((seq) => {
            const active = periodView === seq;
            return (
              <button
                key={seq === null ? 'all' : seq}
                type="button"
                onClick={() => setPeriodView(seq)}
                style={{
                  border: `1px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
                  background: active ? 'var(--primary)' : '#fff',
                  color: active ? '#fff' : 'var(--text-muted)',
                  padding: '0.35rem 0.8rem', borderRadius: '20px',
                  fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer'
                }}
              >
                {seq === null ? '전체 (차량 1대 누적)' : periodName(seq)}
              </button>
            );
          })}
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            차량가·등록비용은 최초 계약에만 있으므로, 차 1대의 진짜 손익은 &quot;전체&quot;입니다.
          </span>
        </div>
      )}

      {/* 집계 박스 - 엑셀 상단 박스와 같은 값 */}
      <div style={{ ...card, padding: '1.2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          {[
            { title: '지출계 (회사출금액)', pick: (r) => r.paidOut, total: summary.paidOut, color: '#d9534f' },
            { title: '수입계 (고객입금액)', pick: (r) => r.paidIn, total: summary.paidIn, color: '#2f6f4e' },
            { title: '정산계', pick: (r) => r.paidIn - r.paidOut, total: summary.balance, color: summary.balance < 0 ? '#d9534f' : '#2f6f4e' }
          ].map((box) => (
            <div key={box.title} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '0.5rem 0.7rem', background: 'var(--bg-main)', fontSize: '0.78rem', fontWeight: '800' }}>{box.title}</div>
              <div style={{ padding: '0.4rem 0.7rem' }}>
                {summary.rows.map((r) => (
                  <div key={r.bank} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '0.2rem 0' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{r.bank}</span>
                    <span>{signed(box.pick(r))}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: '800', padding: '0.4rem 0 0.2rem', borderTop: '1px solid var(--border-color)', marginTop: '0.3rem', color: box.color }}>
                  <span>계</span><span>{signed(box.total)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3열 입력 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem', alignItems: 'start' }}>
        {COLUMNS.map((column) => {
          const rows = entries.filter((e) => (e.group || '회사출금') === column.group
            && (periodView === null || (e.periodSeq || 1) === periodView));
          const subtotal = rows.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
          return (
            <div key={column.group} style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '0.7rem 0.9rem', borderBottom: `2px solid ${column.accent}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-main)' }}>
                <span style={{ fontWeight: '800', fontSize: '0.85rem', color: column.accent }}>{column.title}</span>
                <span style={{ fontSize: '0.82rem', fontWeight: '700' }}>{toCommaString(subtotal)} 원</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '460px' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ ...th, width: '32%' }}>내용</th>
                      <th style={{ ...th, width: '22%', textAlign: 'right' }}>금액</th>
                      <th style={{ ...th, width: '14%' }}>은행</th>
                      <th style={{ ...th, width: '22%' }}>날짜</th>
                      <th style={{ ...th, width: '10%' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e._id} style={{ borderBottom: '1px solid var(--border-color)', background: e.source && e.source !== 'manual' && !e.locked ? '#f4f8ff' : '#fff' }}>
                        <td style={{ padding: '0.15rem 0.25rem' }}>
                          <input
                            value={e.label || ''}
                            onChange={(ev) => updateEntry(e._id, 'label', ev.target.value)}
                            disabled={!canEdit}
                            placeholder="항목명"
                            title={e.source && e.source !== 'manual'
                              ? `계약·청구·차량 정보에서 자동으로 가져온 줄입니다${e.locked ? ' (직접 고쳐서 더 이상 자동으로 바뀌지 않습니다)' : ''}`
                              : undefined}
                            style={{ ...cellInput, fontWeight: e.locked ? '700' : '400' }}
                          />
                          <select
                            value={e.category || '기타'}
                            onChange={(ev) => updateEntry(e._id, 'category', ev.target.value)}
                            disabled={!canEdit}
                            style={{ ...cellInput, fontSize: '0.68rem', color: 'var(--text-muted)', padding: '0 0.35rem' }}
                          >
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '0.15rem 0.25rem' }}>
                          <MoneyInput
                            value={e.amount}
                            onChange={(ev) => updateEntry(e._id, 'amount', ev.target.value)}
                            disabled={!canEdit}
                            style={cellInput}
                          />
                        </td>
                        <td style={{ padding: '0.15rem 0.25rem' }}>
                          <input
                            list="ledger-banks"
                            value={e.bank || ''}
                            onChange={(ev) => updateEntry(e._id, 'bank', ev.target.value)}
                            disabled={!canEdit}
                            style={cellInput}
                          />
                        </td>
                        <td style={{ padding: '0.15rem 0.25rem' }}>
                          <input
                            type="date"
                            value={e.date || ''}
                            onChange={(ev) => updateEntry(e._id, 'date', ev.target.value)}
                            disabled={!canEdit}
                            style={{ ...cellInput, fontSize: '0.72rem' }}
                          />
                        </td>
                        <td style={{ padding: '0.15rem 0.25rem', textAlign: 'center' }}>
                          {canEdit && (
                            <button type="button" onClick={() => removeRow(e._id)} style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>아직 적은 내역이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => addRow(column)}
                  style={{ width: '100%', border: 'none', borderTop: '1px solid var(--border-color)', background: '#fff', padding: '0.55rem', fontSize: '0.78rem', fontWeight: '700', color: column.accent, cursor: 'pointer' }}
                >
                  <Plus size={13} style={{ verticalAlign: '-2px' }} /> 줄 추가
                </button>
              )}
            </div>
          );
        })}
      </div>
      <datalist id="ledger-banks">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>

      {/* 계약 구간 이력 */}
      <div style={{ ...card, padding: '1.2rem' }}>
        <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', fontWeight: '800' }}>계약 구간</h5>
        <p style={{ margin: '0 0 0.9rem', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          연장할 때 계약서를 새로 쓰더라도 갑지는 나누지 않고 이 목록만 늘립니다.
          갑지를 쪼개면 차량가가 들어 있는 최초 계약은 적자로, 렌트료만 쌓이는 연장 계약은 폭리로 보여 둘 다 틀린 숫자가 됩니다.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '620px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)' }}>
                {['구간', '계약번호', '시작일', '종료일', '기간(개월)', '월 렌트료', '구간 정산금액'].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i >= 4 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const rows = entries.filter((e) => (e.periodSeq || 1) === p.seq);
                const bal = rows.reduce((sum, e) => sum + (e.side === '입금' ? 1 : -1) * (Number(e.amount) || 0), 0);
                return (
                  <tr key={p.seq} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.5rem 0.4rem', fontWeight: '700' }}>{periodName(p.seq)}</td>
                    <td style={{ padding: '0.5rem 0.4rem' }}>{p.contractNo || '-'}</td>
                    <td style={{ padding: '0.5rem 0.4rem', whiteSpace: 'nowrap' }}>{toDateInput(p.startDate) || '-'}</td>
                    <td style={{ padding: '0.5rem 0.4rem', whiteSpace: 'nowrap' }}>{toDateInput(p.endDate) || '-'}</td>
                    <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{p.termMonths || '-'}</td>
                    <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}>{toCommaString(p.monthlyRent)}</td>
                    <td style={{ padding: '0.5rem 0.4rem', textAlign: 'right', fontWeight: '700', color: bal < 0 ? '#d9534f' : '#2f6f4e' }}>
                      {signed(bal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 고정 조건 · 할부 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div style={{ ...card, padding: '1.2rem' }}>
          <h5 style={{ margin: '0 0 0.8rem', fontSize: '0.88rem', fontWeight: '800' }}>장기렌트 고정 조건</h5>
          <p style={{ margin: '0 0 0.9rem', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            계약서에서 가져온 값입니다. 여기서 고친 값은 이 갑지 안에서만 쓰이고 계약서·차량 DB로는 넘어가지 않습니다.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            {[['월 렌트료', 'monthlyRent', 'money'], ['계약 기간(개월)', 'termMonths', 'number'],
              ['보증금', 'deposit', 'money'], ['선납금', 'advancePayment', 'money'],
              ['인수가', 'takeoverPrice', 'money'], ['렌트료 개시일', 'rentStartDate', 'date'],
              ['결제일', 'paymentDay', 'text']].map(([label, key, type]) => (
              <div key={key}>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</label>
                {type === 'money' ? (
                  <MoneyInput value={t[key]} onChange={(e) => setTermsField(key, e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '0.45rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem' }} />
                ) : (
                  <input
                    type={type === 'date' ? 'date' : (type === 'number' ? 'number' : 'text')}
                    value={type === 'date' ? toDateInput(t[key]) : (t[key] ?? '')}
                    onChange={(e) => setTermsField(key, e.target.value)}
                    disabled={!canEdit}
                    style={{ width: '100%', padding: '0.45rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...card, padding: '1.2rem' }}>
          <h5 style={{ margin: '0 0 0.8rem', fontSize: '0.88rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            회사 할부 · 대출
            <label style={{ fontSize: '0.76rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={!!loan.executed} disabled={!canEdit}
                onChange={(e) => setLoanField('executed', e.target.checked)} />
              실행함
            </label>
          </h5>
          <p style={{ margin: '0 0 0.9rem', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            "가져오기"를 누르면 월할부금이 <strong>이미 지나간 회차까지만</strong> 지출로 깔립니다.
            남은 회차를 미리 깔면 아직 나가지도 않은 돈이 정산금액에 섞입니다.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            {[['차용처', 'lender', 'text'], ['실행일', 'executedDate', 'date'],
              ['원금', 'amount', 'money'], ['이자율(연 %)', 'interestRate', 'number'],
              ['기간(개월)', 'termMonths', 'number'], ['월 할부금', 'monthlyPayment', 'money'],
              ['상환 완료일', 'finishedDate', 'date']].map(([label, key, type]) => (
              <div key={key}>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</label>
                {type === 'money' ? (
                  <MoneyInput value={loan[key]} onChange={(e) => setLoanField(key, e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '0.45rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem' }} />
                ) : (
                  <input
                    type={type === 'date' ? 'date' : (type === 'number' ? 'number' : 'text')}
                    value={type === 'date' ? toDateInput(loan[key]) : (loan[key] ?? '')}
                    onChange={(e) => setLoanField(key, e.target.value)}
                    disabled={!canEdit}
                    style={{ width: '100%', padding: '0.45rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 차량 연결 팝업 */}
      {linkOpen && (
        <div
          onClick={() => setLinkOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(560px, 92vw)', maxHeight: '80vh', overflow: 'auto', padding: '1.2rem' }}>
            <h5 style={{ margin: '0 0 0.3rem', fontSize: '0.95rem', fontWeight: '800' }}>차량 연결</h5>
            <p style={{ margin: '0 0 0.8rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              아직 갑지가 없는 차량만 나옵니다. 연결하면 차량번호·차대번호·계약 조건이 채워집니다.
            </p>
            <input
              value={linkQuery}
              onChange={(e) => searchLinkable(e.target.value)}
              placeholder="차량코드 · 차량번호 · 차대번호 · 차종"
              autoFocus
              style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '0.7rem' }}
            />
            {linkResults.map((v) => (
              <div
                key={v._id}
                onClick={() => handleLink(v._id)}
                style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '0.4rem', cursor: 'pointer', fontSize: '0.82rem' }}
              >
                <strong>{v.code || '코드없음'}</strong> · {v.carModel} {v.carSpec || ''}
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {v.plateNo || '차량번호 미정'} · {v.vin || '차대번호 미정'} · {v.status}
                </div>
              </div>
            ))}
            {linkResults.length === 0 && (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>연결할 수 있는 차량이 없습니다.</div>
            )}
          </div>
        </div>
      )}
      {/* 계약 연장 팝업 */}
      {extendOpen && (
        <div
          onClick={() => setExtendOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(620px, 92vw)', maxHeight: '80vh', overflow: 'auto', padding: '1.2rem' }}>
            <h5 style={{ margin: '0 0 0.3rem', fontSize: '0.95rem', fontWeight: '800' }}>계약 연장 등록</h5>
            <p style={{ margin: '0 0 0.8rem', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              연장 계약서를 고르면 이 갑지의 {periodName(latestSeq + 1)} 구간이 됩니다.
              그 계약서로 갑지가 따로 만들어져 있으면 이 갑지로 합쳐집니다.
            </p>
            <input
              value={extendQuery}
              onChange={(e) => searchExtendable(e.target.value)}
              placeholder="계약번호로 검색 (예: CUST001-2601-01)"
              autoFocus
              style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '0.7rem' }}
            />
            {extendResults.map((c) => (
              <div
                key={c._id}
                onClick={() => handleExtend(c._id, c.contractNo)}
                style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '0.4rem', cursor: 'pointer', fontSize: '0.82rem' }}
              >
                <strong>{c.contractNo}</strong> · {c.companyId?.name || '개인'}
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {toDateInput(c.contractDate)} ~ {toDateInput(c.endDate)} · {c.termMonths || '-'}개월 · 월 {toCommaString(c.pricing?.monthlyFee)}원
                </div>
              </div>
            ))}
            {extendResults.length === 0 && (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>계약서를 찾지 못했습니다.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LedgerView;
