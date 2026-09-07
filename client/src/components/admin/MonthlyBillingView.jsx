import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Calendar, RefreshCw, Save, FileText, Send, Paperclip, Trash2, AlertCircle, Plus, Upload, History, Mail, Search, X, ChevronDown, ChevronRight } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import MoneyInput from './MoneyInput.jsx';
import IssuedInvoicesView from './IssuedInvoicesView.jsx';
import UpcomingDocUpload from './UpcomingDocUpload.jsx';
import MailTemplateEditor from './MailTemplateEditor.jsx';
import { useTableSort } from './useTableSort.js';
import { useSaveShortcut } from './useSaveShortcut.js';
import { SortableTh, SortControls } from './TableSort.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => (n || n === 0) ? `${Number(n).toLocaleString()}원` : '-';
const ymd = (d) => (d ? String(d).slice(0, 10) : '-');
// 그 날짜까지 며칠 남았는지. 지났으면 음수. 납부기한 D-day에 쓴다.
const daysUntil = (d) => {
  const target = new Date(d);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
};
const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// 출금일에서 '일'만 뽑는다. 결제일별로 묶고 거르는 데 쓴다.
const dayOf = (d) => {
  const s = ymd(d);
  return s === '-' ? null : Number(s.slice(8, 10));
};
// 말일은 달마다 28~31일로 달라서 날짜로 직접 따져야 한다.
const isLastDay = (d) => {
  const s = ymd(d);
  if (s === '-') return false;
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m, 0).getDate() === day;
};

// 실무에서 쓰는 출금일 묶음. 이 다섯 가지가 아니면 '기타'로 모은다.
const DAY_FILTERS = [
  { key: '5', label: '5일', match: (d) => dayOf(d) === 5 },
  { key: '10', label: '10일', match: (d) => dayOf(d) === 10 },
  { key: '15', label: '15일', match: (d) => dayOf(d) === 15 },
  { key: '25', label: '25일', match: (d) => dayOf(d) === 25 },
  { key: 'last', label: '말일', match: (d) => isLastDay(d) }
];
const matchesDayFilter = (key, d) => (key === 'etc'
  ? !DAY_FILTERS.some((f) => f.match(d))
  : Boolean(DAY_FILTERS.find((f) => f.key === key)?.match(d)));

const STATUS_STYLE = {
  '예정': { bg: '#f1f5f9', color: '#475569' },
  '청구됨': { bg: '#e0f2fe', color: '#0284c7' },
  '입금완료': { bg: '#dcfce7', color: '#16a34a' },
  '미납': { bg: '#fee2e2', color: '#ef4444' }
};

// 청구서와 함께 보내는 서류 종류.
// 자유 입력이면 '범칙금'/'범칙금(1월)'/'과태료 범칙금'처럼 제각각이 되어 파일명이 흐트러진다.
const ATTACHMENT_KINDS = ['범칙금', '과태료', '통행료', '정비내역', '기타'];

// 서류에 적은 금액이 어느 청구 항목으로 합산되는지. 서버(billingScheduleController.js)와 같은 규칙이다.
// 정비내역만 '정기점검/정비'로 가고 나머지는 모두 '범칙금/과태료'로 묶는다.
// 종류 이름을 직접 적을 수 있어(주차위반 등) 정해진 목록으로 판정하지 않는다.
const MAINTENANCE_KINDS = ['정비내역', '정비'];
const isMaintenanceKind = (kind) => MAINTENANCE_KINDS.includes(String(kind || '').trim());

const sumAmount = (list) => (list || []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

// 회차에 붙는 추가 청구 항목. 월 렌트료는 계약에서 정해지므로 여기서 고치지 않는다.
// 기타 청구는 항목명을 적을 수 있어야 해서 아래에서 따로 그린다.
const EXTRA_FIELDS = [
  { key: 'prevUnpaid', label: '전월 미결제' },
  { key: 'prevOverpaid', label: '전월 초과입금' },
  { key: 'interest', label: '연체 이자' },
  { key: 'fine', label: '범칙금 / 과태료' },
  { key: 'maintenance', label: '정기점검 / 정비' }
];

/**
 * 청구서 양식. PDF로 만들 대상이라 화면에는 숨겨 두고 이 요소만 캡처한다.
 * 엑셀로 쓰던 청구서 양식(결제금액 내역 / 청구내역 / 상세내역 / 차량 표)을 그대로 옮겼다.
 */
function InvoiceSheet({ innerRef, item, round, vehicles, total }) {
  const company = item?.company;
  const name = company?.name || item?.customer?.name || '-';
  const cell = { border: '1px solid #ccc', padding: '4px 8px', fontSize: '11px' };
  const head = { ...cell, background: '#e8e8e8', fontWeight: 700, textAlign: 'center' };

  // 금액이 적힌 서류. 범칙금이 여러 건이면 합계만 찍지 않고 명세로 펼친다.
  // 고객이 직접 낸 건은 청구액에 안 들어가므로 명세에서도 빼야 한다.
  // 합계에 없는 줄이 명세에 찍히면 법인이 바로 되묻는다.
  const fineDocs = (round?.attachments || [])
    .filter((a) => !isMaintenanceKind(a.kind) && Number(a.amount) > 0 && a.noticeStatus !== '고객납부');
  // 발생일은 적는 칸을 없앴다. 예전에 적어 둔 건이 있을 때만 열을 보여 준다.
  const hasOccurred = fineDocs.some((a) => a.occurredAt);
  const interestLabel = round?.interestRate
    ? `연체 이자 (연 ${round.interestRate}% · ${round.interestDays || 0}일)`
    : '연체 이자';

  const rows = [
    ['전월 미결제금액', round?.prevUnpaid],
    ['전월 초과 입금액', round?.prevOverpaid],
    ['당월 결제금액', round?.monthlyRent],
    ['정기점검', round?.maintenance],
    ['범칙금 / 과태료', round?.fine],
    [interestLabel, round?.interest],
    // 기타 청구는 '기타 80,000원'만 찍히면 무슨 돈인지 되묻게 되므로 적어 둔 항목명을 그대로 쓴다
    ...((round?.extras || []).length
      ? round.extras.map((e) => [e.label || '기타 청구', e.amount])
      : [['기타 청구', round?.other]])
  ];
  const details = [
    ['고객명', name],
    ['거래은행', company?.bank?.bankName || '-'],
    ['계좌번호', company?.bank?.accountNo || '-'],
    ['납입회차', `${round?.no || '-'} 회`],
    ['출금일', ymd(round?.dueDate)]
  ];

  return (
    <div ref={innerRef} style={{ width: '780px', padding: '28px', background: '#fff', color: '#111', fontFamily: "'Malgun Gothic', sans-serif" }}>
      <div style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px' }}>{name}</div>

      <div style={{ background: '#8a8a8a', color: '#fff', padding: '5px 10px', fontWeight: 700, fontSize: '12px' }}>결제금액 내역</div>
      <div style={{ textAlign: 'right', fontSize: '18px', fontWeight: 800, margin: '10px 0' }}>
        {Number(total || 0).toLocaleString()} 원
      </div>

      <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
        <table style={{ width: '50%', borderCollapse: 'collapse' }}>
          <thead><tr><th colSpan={3} style={head}>청구내역</th></tr></thead>
          <tbody>
            {rows.map(([label, value], i) => (
              <tr key={label}>
                <td style={{ ...cell, width: '28px', textAlign: 'center' }}>{i + 1}</td>
                <td style={cell}>{label}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{value ? Number(value).toLocaleString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table style={{ width: '50%', borderCollapse: 'collapse' }}>
          <thead><tr><th colSpan={3} style={head}>상세내역</th></tr></thead>
          <tbody>
            {details.map(([label, value], i) => (
              <tr key={label}>
                <td style={{ ...cell, width: '28px', textAlign: 'center' }}>{i + 1}</td>
                <td style={cell}>{label}</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fineDocs.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
          <thead>
            <tr>
              <th style={{ ...head, width: '36px' }}>No</th>
              <th style={head}>구분</th>
              <th style={head}>차량번호</th>
              {hasOccurred && <th style={head}>발생일</th>}
              <th style={head}>금액</th>
            </tr>
          </thead>
          <tbody>
            {fineDocs.map((a, i) => (
              <tr key={a.fileName || i}>
                <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{a.kind}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{a.plateNo || '-'}</td>
                {hasOccurred && <td style={{ ...cell, textAlign: 'center' }}>{a.occurredAt ? ymd(a.occurredAt) : '-'}</td>}
                <td style={{ ...cell, textAlign: 'right' }}>{Number(a.amount).toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={hasOccurred ? 4 : 3} style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>범칙금 / 과태료 합계</td>
              <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{sumAmount(fineDocs).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
        <thead>
          <tr>
            <th style={{ ...head, width: '36px' }}>No</th>
            <th style={head}>차량번호</th>
            <th style={head}>월 렌트료</th>
            <th style={head}>인도일</th>
          </tr>
        </thead>
        <tbody>
          {(vehicles || []).map((v, i) => (
            <tr key={v._id}>
              <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{v.plateNo || v.code || '-'}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{v.monthlyFee ? Number(v.monthlyFee).toLocaleString() : '-'}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{ymd(v.deliveryDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '28px', borderTop: '2px solid #333', paddingTop: '10px', fontSize: '11px', color: '#444' }}>
        <div style={{ fontWeight: 800, fontSize: '13px', color: '#111' }}>(주)렌트베네핏</div>
        <div>서울시 서초구 양재대로 11길 36, 은관 505호 (양재동, 서울오토갤러리)</div>
        <div>대표이사 신동일 | 사업자번호 422-88-02467 &nbsp;&nbsp; T. 02-547-0303 &nbsp; F. 02-529-3303</div>
      </div>
    </div>
  );
}

/**
 * 월 청구 화면.
 *
 * 회차를 사람이 고르지 않고 청구일로 정한다. 엑셀로 할 때 회차를 손으로 넣다 틀리는 일이 가장 잦았다.
 * 전월 미결제도 직전 회차에서 자동으로 끌어와, 회차를 잘못 보고 금액을 옮겨 적는 실수를 없앤다.
 */
function MonthlyBillingView({ showToast, currentUser }) {
  const [month, setMonth] = useState(thisMonth());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState(null); // 목록에서 고른 항목
  const [schedule, setSchedule] = useState(null); // 그 계약의 회차표 전체
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState(null); // 편집 중인 회차 금액
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  // 담당자가 바뀌면 청구서 받는 주소도 바뀐다. 보내기 전에 이 자리에서 고칠 수 있게 한다.
  const [mailTo, setMailTo] = useState('');
  const [saveMailToCompany, setSaveMailToCompany] = useState(true);
  // 회차에 딸린 서류(범칙금 고지서 등)
  const [attachments, setAttachments] = useState([]);
  const [attachKind, setAttachKind] = useState(ATTACHMENT_KINDS[0]);
  const [attachAmount, setAttachAmount] = useState('');
  const [attachCustomKind, setAttachCustomKind] = useState(''); // '기타'일 때 실제 종류 이름
  const [attachPlateNo, setAttachPlateNo] = useState('');
  const [customPlate, setCustomPlate] = useState(false); // 여러 대 계약에서 목록에 없는 번호를 적을 때
  const [showAllRounds, setShowAllRounds] = useState(false); // 이력에 앞으로 올 회차까지 펼칠지
  const [payInput, setPayInput] = useState({}); // 부분 입금액을 적는 칸 (계약별)
  const [roundPayInput, setRoundPayInput] = useState({}); // 이력 표에서 회차별 일부 납부액
  const [uploading, setUploading] = useState(false);
  const attachInputRef = useRef(null);
  // 계약번호는 외우기 어려워 계약자 이름으로 찾는다
  const [keyword, setKeyword] = useState('');
  // 상태로도 걸러 본다 (미납만 모아 보는 일이 잦다)
  const [statusFilter, setStatusFilter] = useState('all');
  // 출금일 버튼(5·10·15·25·말일). 비어 있으면 전체를 본다. 여러 개를 함께 고를 수 있다.
  const [dayFilter, setDayFilter] = useState([]);
  const [groupByDay, setGroupByDay] = useState(true); // 결제일별로 묶어서 볼지
  const [collapsedDays, setCollapsedDays] = useState([]); // 접어 둔 결제일 묶음
  // 전월 미결제를 한 번에 처리하기 위한 체크 목록
  const [checked, setChecked] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tab, setTab] = useState('due'); // due: 청구 대상, issued: 발행 이력
  const [showDocUpload, setShowDocUpload] = useState(false);
  const [showMailTemplate, setShowMailTemplate] = useState(false);
  // 회차표가 없어 청구 대상에 뜨지 못하는 계약. 원인을 화면에서 바로 알려 준다.
  const [missing, setMissing] = useState([]);
  const sheetRef = useRef(null);

  const fetchDue = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_HOST}/api/billing-schedules/due?month=${month}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        setChecked([]); // 목록이 바뀌면 체크는 푼다. 안 보이는 건이 체크된 채 남으면 위험하다
      }
      else showToast?.(data.message || '청구 대상을 불러오지 못했습니다.', 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [month, showToast]);

  useEffect(() => { fetchDue(); }, [fetchDue]);

  const fetchMissing = useCallback(async () => {
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules`);
      const data = await res.json();
      if (data.success) setMissing(data.missing || []);
    } catch { /* 목록 자체를 막지는 않는다 */ }
  }, []);

  useEffect(() => { fetchMissing(); }, [fetchMissing]);

  /**
   * 직전 회차에서 아직 안 받은 금액을 구한다.
   * 청구했는데 입금이 그만큼 안 들어왔으면 그 차액이 이번 회차의 '전월 미결제'가 된다.
   */
  const unpaidOfPrevRound = (rounds, no) => {
    const prev = (rounds || []).find((r) => r.no === no - 1);
    // 미납으로 찍은 회차만 이월한다. 청구만 나간 상태(청구됨)는 아직 입금 기한 안이라 미결제가 아니다.
    if (!prev || prev.status !== '미납') return 0;
    return Math.max(0, (prev.total || 0) - (prev.paidAmount || 0));
  };

  /**
   * 고른 회차들의 상태를 한 번에 바꾼다.
   * 전월을 미결제로 찍어 두면 이번 회차를 열 때 미수금과 연체 이자가 자동으로 채워진다.
   */
  const bulkSetPrevStatus = async (status) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    const targets = items
      .filter((it) => checked.includes(it.scheduleId) && it.prevRound)
      .map((it) => ({ scheduleId: it.scheduleId, no: it.prevRound.no }));
    if (!targets.length) {
      showToast?.('전월 회차가 있는 건을 골라 주세요.', 'error');
      return;
    }
    if (!window.confirm(`고른 ${targets.length}건의 전월 회차를 '${status}'(으)로 바꿉니다. 진행할까요?`)) return;

    try {
      setBulkBusy(true);
      const res = await fetch(`${API_HOST}/api/billing-schedules/rounds/bulk-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ targets, status })
      });
      const data = await res.json();
      showToast?.(data.message || (data.success ? '바꿨습니다.' : '바꾸지 못했습니다.'), data.success ? 'success' : 'error');
      if (data.success) { setSelected(null); setForm(null); fetchDue(); }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const openRound = async (item) => {
    setSelected(item);
    setSchedule(null);
    setForm(null);
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/contract/${item.contract._id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) {
        showToast?.(data.message || '회차표를 불러오지 못했습니다.', 'error');
        return;
      }
      setSchedule(data.schedule);
      setVehicles(data.vehicles || []);
      // 서류를 올릴 때 매번 차량번호를 옮겨 적지 않도록 첫 차량을 채워 둔다
      const plated = (data.vehicles || []).filter((v) => v.plateNo);
      setAttachPlateNo(plated.length ? plated[0].plateNo : '');
      setCustomPlate(false);
      setShowAllRounds(false);
      setMailTo(data.schedule.company?.billingEmail || '');

      const round = data.schedule.rounds.find((r) => r.no === item.round.no) || item.round;
      setAttachments(round.attachments || []);

      // 전월을 미결제로 찍어 두었으면 미수금과 연체 이자를 서버 계산값으로 채운다.
      // 연체 이율은 렌트차량 DB의 현재 값이라, 요율이 바뀌면 다음 청구부터 바로 반영된다.
      const carried = item.prevRound?.unpaid || unpaidOfPrevRound(data.schedule.rounds, round.no);
      const suggestedInterest = item.suggestedInterest || 0;

      setForm({
        no: round.no,
        monthlyRent: round.monthlyRent ?? 0,
        prevUnpaid: round.prevUnpaid || carried,
        prevOverpaid: round.prevOverpaid || 0,
        interest: round.interest || suggestedInterest,
        fine: round.fine || 0,
        maintenance: round.maintenance || 0,
        other: round.other || 0,
        extras: (round.extras || []).map((e) => ({ label: e.label || '', amount: e.amount || 0 })),
        note: round.note || '',
        carried,
        suggestedInterest,
        interestRate: item.lateInterestRate || 0,
        interestDays: item.overdueDays || 0,
        issuedAt: round.issuedAt || null // 발행한 회차는 서류 상태를 바꿀 수 없다
      });
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  // 서류에 금액을 적어 두면 그 합계가 청구 금액이 된다(사람이 더하다 틀리는 일을 없앤다).
  // 고객이 기한 안에 직접 낸 건은 뺀다. 서버가 청구액을 그렇게 계산하므로 화면도 같아야 한다.
  const willBeBilled = (a) => a.noticeStatus !== '고객납부';
  const docFine = sumAmount(attachments.filter((a) => !isMaintenanceKind(a.kind) && willBeBilled(a)));
  const docMaintenance = sumAmount(attachments.filter((a) => isMaintenanceKind(a.kind) && willBeBilled(a)));
  const hasDocFine = attachments.some((a) => !isMaintenanceKind(a.kind) && Number(a.amount) > 0);
  const hasDocMaintenance = attachments.some((a) => isMaintenanceKind(a.kind) && Number(a.amount) > 0);

  const extrasTotal = form ? (form.extras || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0) : 0;
  const otherTotal = form ? ((form.extras || []).length ? extrasTotal : Number(form.other || 0)) : 0;
  const fineTotal = form ? (hasDocFine ? docFine : Number(form.fine || 0)) : 0;
  const maintenanceTotal = form ? (hasDocMaintenance ? docMaintenance : Number(form.maintenance || 0)) : 0;

  const total = form
    ? Number(form.monthlyRent || 0) + Number(form.prevUnpaid || 0) + Number(form.interest || 0)
      + fineTotal + maintenanceTotal + otherTotal
      - Number(form.prevOverpaid || 0)
    : 0;

  const handleSaveRound = async (silent = false) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      setSaving(true);
      const res = await fetch(`${API_HOST}/api/billing-schedules/${schedule._id}/rounds/${form.no}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ ...form, fine: fineTotal, maintenance: maintenanceTotal, other: otherTotal })
      });
      const data = await res.json();
      if (data.success) {
        if (!silent) {
          showToast?.('회차 내역이 저장되었습니다.', 'success');
          fetchDue();
        }
      } else {
        showToast?.(data.message || '저장에 실패했습니다.', 'error');
      }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // 회차 상세를 열어 둔 동안 Ctrl+S로 저장한다
  useSaveShortcut(Boolean(selected && form) && !saving, () => handleSaveRound());

  /**
   * 회차를 발행한다: 청구서 PDF를 만들어 서버로 보내면 법인 폴더 저장과 메일 발송이 함께 이뤄진다.
   * 저장한 내용으로 발행해야 하므로, 고친 금액이 있으면 먼저 저장하고 발행한다.
   */
  const handleIssue = async (withEmail) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('발행 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    const to = (mailTo || '').trim();
    if (withEmail && !to) {
      showToast?.('받는 사람 이메일을 입력해 주세요.', 'error');
      return;
    }
    // 받는 사람이 미리 채워져 있어 그대로 누르면 실제 고객에게 나간다.
    // 누구에게 무엇이 나가는지 확인창에 또렷하게 보여 준다.
    if (withEmail) {
      const partyName = selected?.company?.name || selected?.customer?.name || selected?.contract?.contractNo || '';
      const ourDomain = to.toLowerCase().endsWith('@sdibenefit.com');
      const message = [
        `${partyName}  ${form.no}회차 청구서`,
        `청구액 ${won(total)}`,
        '',
        `받는 사람 :  ${to}`,
        ourDomain ? '(회사 계정입니다. 시험 발송으로 보입니다)' : '(고객 주소입니다. 실제로 발송됩니다)',
        '',
        '보낼까요?'
      ].join(String.fromCharCode(10));
      if (!window.confirm(message)) return;
    }

    try {
      setIssuing(true);
      await handleSaveRound(true); // 화면에 보이는 금액 그대로 발행되도록 먼저 저장한다

      const element = sheetRef.current;
      if (!element) throw new Error('청구서 양식을 찾지 못했습니다.');

      const blob = await html2pdf()
        .set({
          margin: 5,
          image: { type: 'png' },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        })
        .from(element)
        .outputPdf('blob');

      const fd = new FormData();
      fd.append('file', blob, 'invoice.pdf');
      fd.append('sendEmail', withEmail ? 'true' : 'false');
      if (to) fd.append('to', to);
      if (withEmail && saveMailToCompany) fd.append('saveEmailToCompany', 'true');

      const res = await fetch(`${API_HOST}/api/billing-schedules/${schedule._id}/rounds/${form.no}/issue`, {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' },
        body: fd
      });
      const data = await res.json();
      showToast?.(data.message || (data.success ? '발행했습니다.' : '발행에 실패했습니다.'),
        data.success ? (data.mailError ? 'warning' : 'success') : 'error');
      if (data.success) fetchDue();
    } catch (err) {
      showToast?.(err.message || '청구서 발행 중 오류가 발생했습니다.', 'error');
    } finally {
      setIssuing(false);
    }
  };

  /** 청구서와 함께 보낼 서류를 올린다. 청구서와 같은 폴더에 같은 이름으로 저장된다. */
  const handleUploadAttachment = async (file) => {
    if (!file || !schedule || !form) return;
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      setUploading(true);
      const fd = new FormData();
      fd.append('file', file);
      // '기타'는 적어 넣은 이름을 그대로 쓴다. 파일명과 청구서 명세에 그 이름이 찍힌다.
      fd.append('kind', attachKind === '기타' ? (attachCustomKind.trim() || '기타') : attachKind);
      // 금액이 청구에 반영되는 종류일 때만 보낸다. 종류를 바꾼 뒤 남은 값이 딸려 들어가면 안 된다.
      fd.append('amount', String(Number(attachAmount) || 0));
      if (attachPlateNo.trim()) fd.append('plateNo', attachPlateNo.trim());
      const res = await fetch(`${API_HOST}/api/billing-schedules/${schedule._id}/rounds/${form.no}/attachments`, {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' },
        body: fd
      });
      const data = await res.json();
      if (data.success) {
        setAttachments((prev) => [...prev, data.attachment]);
        // 서버가 서류 금액을 합산해 돌려준 값으로 맞춘다. 화면과 저장된 청구액이 갈리면 안 된다.
        if (data.round) {
          setForm((prev) => prev ? { ...prev, fine: data.round.fine || 0, maintenance: data.round.maintenance || 0 } : prev);
        }
        setAttachAmount('');
        setAttachCustomKind('');
        // 차량번호는 지우지 않는다. 같은 차의 고지서를 이어서 올리는 일이 많다.
        showToast?.(data.message, 'success');
      } else {
        showToast?.(data.message || '서류를 올리지 못했습니다.', 'error');
      }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setUploading(false);
      if (attachInputRef.current) attachInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = async (index) => {
    if (!window.confirm('이 서류를 목록에서 뺄까요?\n저장된 파일은 폴더에 그대로 남습니다.')) return;
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/${schedule._id}/rounds/${form.no}/attachments/${index}`, {
        method: 'DELETE',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      const data = await res.json();
      if (data.success) {
        setAttachments((prev) => prev.filter((_, i) => i !== index));
        if (data.round) {
          setForm((prev) => prev ? { ...prev, fine: data.round.fine || 0, maintenance: data.round.maintenance || 0 } : prev);
        }
        showToast?.(data.message, 'success');
      } else {
        showToast?.(data.message || '빼지 못했습니다.', 'error');
      }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  /**
   * 고지서를 고객이 기한 안에 직접 냈는지 표시한다.
   *
   * 직접 낸 건은 청구서에서 빠져야 한다. 서류를 지우면 그 고지서가 있었다는 기록까지 사라져
   * 나중에 되짚을 수 없으므로, 지우지 않고 상태만 바꾸고 금액을 뺀다.
   *
   * @param {number} index 서류 순번
   * @param {string} noticeStatus '고객납부' 또는 '청구예정'
   */
  const handleNoticeStatus = async (index, noticeStatus) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/${schedule._id}/rounds/${form.no}/attachments/${index}/notice-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ noticeStatus })
      });
      const data = await res.json();
      showToast?.(data.message || (data.success ? '처리했습니다.' : '처리하지 못했습니다.'), data.success ? 'success' : 'error');
      if (data.success) refreshAll();
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  /**
   * 목록과 열려 있는 회차의 이력을 함께 다시 읽는다.
   * 서류를 올린 뒤 이력에 바로 보여야 올라간 것을 확인할 수 있다.
   */
  const refreshAll = async () => {
    fetchDue();
    if (!selected?.contract?._id) return;
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/contract/${selected.contract._id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) return;
      setSchedule(data.schedule);
      const round = data.schedule.rounds.find((r) => r.no === form?.no);
      if (round) {
        setAttachments(round.attachments || []);
        setForm((prev) => prev ? { ...prev, fine: round.fine || 0, maintenance: round.maintenance || 0 } : prev);
      }
    } catch { /* 목록은 이미 새로 읽었다 */ }
  };

  /**
   * 입금액을 적어 회차의 입금 상태를 정한다.
   *
   * 상태를 고르게 하지 않고 금액으로 정한다. 청구액만큼이면 입금완료,
   * 일부거나 0이면 미납이고 남은 금액이 다음 회차 '전월 미결제'로 넘어간다.
   */
  const savePayment = async (item, paidAmount) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/${item.scheduleId}/rounds/${item.round.no}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ paidAmount })
      });
      const data = await res.json();
      showToast?.(data.message || (data.success ? '처리했습니다.' : '처리하지 못했습니다.'), data.success ? 'success' : 'error');
      // 저장한 뒤에는 적어 둔 값을 지운다. 빈 문자열로 두면 새로 받은 미납액이 칸에 안 뜬다.
      if (data.success) { setPayInput((p) => { const next = { ...p }; delete next[item.scheduleId]; return next; }); refreshAll(); }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  /**
   * 미납액을 적어 입금 상태를 정한다.
   *
   * 완납/미납을 눌러 고르지 않는다. 손에 쥔 숫자는 '얼마가 안 들어왔는가'이므로
   * 그 금액만 적게 하고, 0을 적으면 완납이 된다. 서버는 입금액으로 받는다.
   */
  const saveUnpaid = (item, unpaidAmount) => {
    const total = Number(item.round?.total) || 0;
    const unpaid = Math.min(Math.max(Number(unpaidAmount) || 0, 0), total);
    return savePayment(item, total - unpaid);
  };

  // 지금 화면에 적혀 있어야 할 미납액. 아직 결과가 안 정해진 '예정'은 빈칸으로 둔다.
  const unpaidValue = (round, unpaid) => {
    if (round?.status === '미납') return Number(unpaid ?? Math.max(0, (round.total || 0) - (round.paidAmount || 0)));
    if (round?.status === '입금완료') return 0;
    return '';
  };

  /**
   * 이력 표에서 회차 하나의 입금 상태를 바꾼다.
   *
   * 과거 회차를 지금 정리하는 일이 많다(엑셀로 관리하던 미납 기록을 옮기는 등).
   * 바꾸면 서버가 뒤 회차의 전월 미결제와 이자를 다시 계산한다.
   */
  const saveRoundPayment = async (roundNo, paidAmount, status) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!schedule) return;
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/${schedule._id}/rounds/${roundNo}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify(status ? { status, paidAmount: 0 } : { paidAmount })
      });
      const data = await res.json();
      showToast?.(data.message || (data.success ? '처리했습니다.' : '처리하지 못했습니다.'), data.success ? 'success' : 'error');
      if (data.success) { setRoundPayInput((p) => { const next = { ...p }; delete next[roundNo]; return next; }); refreshAll(); }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  // 이력 표도 같은 규칙이다. 적는 숫자는 미납액이고 0이면 완납이다.
  const saveRoundUnpaid = (round, unpaidAmount) => {
    const total = Number(round.total) || 0;
    const unpaid = Math.min(Math.max(Number(unpaidAmount) || 0, 0), total);
    return saveRoundPayment(round.no, total - unpaid);
  };

  const regenerate = async (contractId) => {
    try {
      const res = await fetch(`${API_HOST}/api/billing-schedules/generate/${contractId}`, {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      const data = await res.json();
      showToast?.(data.message || (data.success ? '회차표를 만들었습니다.' : '만들지 못했습니다.'), data.success ? 'success' : 'error');
      if (data.success) { fetchDue(); fetchMissing(); }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  // 계약번호는 외우기 어려우니 계약자 이름으로도 찾을 수 있게 한다
  const kw = keyword.trim().toLowerCase();
  // 출금일 버튼에 붙는 건수는 출금일 필터를 뺀 나머지 조건으로 센다.
  // 그렇지 않으면 5일을 고른 순간 다른 버튼이 모두 0건이 되어 옮겨 다닐 수 없다.
  const dayBaseItems = items.filter((it) => {
    if (statusFilter !== 'all' && it.round?.status !== statusFilter) return false;
    if (!kw) return true;
    return [it.company?.name, it.customer?.name, it.contract?.contractNo]
      .some((v) => (v || '').toLowerCase().includes(kw));
  });
  const filteredItems = dayFilter.length
    ? dayBaseItems.filter((it) => dayFilter.some((key) => matchesDayFilter(key, it.round?.dueDate)))
    : dayBaseItems;

  // 5·10·15·25·말일 어디에도 안 걸리는 출금일이 있을 때만 '기타' 버튼을 낸다
  const etcCount = dayBaseItems.filter((it) => matchesDayFilter('etc', it.round?.dueDate)).length;
  const dayButtons = [
    ...DAY_FILTERS.map((f) => ({ key: f.key, label: f.label, count: dayBaseItems.filter((it) => f.match(it.round?.dueDate)).length })),
    ...(etcCount ? [{ key: 'etc', label: '기타', count: etcCount }] : [])
  ];
  const toggleDayFilter = (key) => {
    setChecked([]); // 안 보이는 행이 선택된 채로 남아 일괄 처리에 딸려 가면 안 된다
    setDayFilter((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  // 이번 달 미납 현황. 목록 위에 한 줄로 보여 주고 눌러서 미납만 볼 수 있게 한다.
  const unpaidItems = items.filter((it) => it.round?.status === '미납');
  const unpaidTotal = unpaidItems.reduce((sum, it) => sum + (it.unpaid || 0), 0);

  // 청구 대상 목록에서 정렬할 수 있는 항목
  const DUE_COLUMNS = [
    { key: 'partyName', label: '계약자', sortValue: (it) => it.company?.name || it.customer?.name },
    { key: 'dueDate', label: '출금일', numeric: true, sortValue: (it) => it.round?.dueDate },
    { key: 'sendDate', label: '발송 예정', numeric: true, sortValue: (it) => it.sendDate },
    { key: 'prevStatus', label: '전월', sortValue: (it) => it.prevRound?.status },
    { key: 'contractNo', label: '계약번호', sortValue: (it) => it.contract?.contractNo },
    { key: 'roundNo', label: '회차', numeric: true, sortValue: (it) => it.round?.no },
    { key: 'total', label: '청구액', numeric: true, sortValue: (it) => it.round?.total },
    { key: 'status', label: '상태', sortValue: (it) => it.round?.status }
  ];
  const dueSort = useTableSort(filteredItems, DUE_COLUMNS);
  const visibleItems = dueSort.rows;

  // 결제일(출금일)별 묶음. 정렬을 걸면 묶음 안에서 그 순서를 따른다.
  const dueGroups = [];
  const groupPos = new Map();
  visibleItems.forEach((it) => {
    const key = ymd(it.round?.dueDate);
    if (!groupPos.has(key)) {
      groupPos.set(key, dueGroups.length);
      dueGroups.push({
        key,
        day: dayOf(it.round?.dueDate),
        lastDay: isLastDay(it.round?.dueDate),
        items: []
      });
    }
    dueGroups[groupPos.get(key)].items.push(it);
  });
  dueGroups.sort((a, b) => a.key.localeCompare(b.key));
  dueGroups.forEach((g) => {
    g.total = g.items.reduce((sum, it) => sum + (Number(it.round?.total) || 0), 0);
    g.unpaidCount = g.items.filter((it) => it.round?.status === '미납').length;
  });
  const isCollapsed = (key) => groupByDay && collapsedDays.includes(key);
  const toggleGroup = (key) => {
    // 접은 묶음의 선택은 풀어 둔다. 안 보이는 행이 일괄 처리에 딸려 가면 안 된다.
    if (!collapsedDays.includes(key)) {
      const hide = new Set((dueGroups.find((g) => g.key === key)?.items || []).map((it) => it.scheduleId));
      setChecked((cur) => cur.filter((id) => !hide.has(id)));
    }
    setCollapsedDays((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };
  const allCollapsed = dueGroups.length > 0 && dueGroups.every((g) => collapsedDays.includes(g.key));

  // 접어 둔 묶음은 화면에 없으니 일괄 처리에서도 빠져야 한다.
  // 1회차는 전월이 없어 일괄 처리 대상이 아니다
  const shownItems = groupByDay
    ? dueGroups.filter((g) => !isCollapsed(g.key)).flatMap((g) => g.items)
    : visibleItems;
  const checkableItems = shownItems.filter((it) => it.prevRound);

  // 이력에 보여 줄 회차. 기본은 지나온 것과 이번 회차까지다.
  // 60회차를 전부 펼치면 정작 봐야 할 최근 건이 묻힌다.
  const allRounds = schedule?.rounds || [];
  const historyRounds = (showAllRounds
    ? [...allRounds]
    : allRounds.filter((r) => (form ? r.no <= form.no : true) || r.issuedAt || (r.attachments || []).length)
  ).slice().reverse();
  const issuedCount = allRounds.filter((r) => r.issuedAt).length;
  const paidCount = allRounds.filter((r) => r.status === '입금완료').length;
  const unpaidCount = allRounds.filter((r) => r.status === '미납').length;
  const fineSum = allRounds.reduce((sum, r) => sum + (Number(r.fine) || 0), 0);

  // 차량번호가 있는 차량만 고를 수 있게 한다(출고 전 차량은 번호가 없다)
  const platedVehicles = vehicles.filter((v) => v.plateNo);

  const labelStyle = { fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' };
  const inputStyle = { width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.85rem' };

  const tabStyle = (key) => ({
    display: 'flex', alignItems: 'center', gap: '0.35rem',
    padding: '0.5rem 1rem', borderRadius: '8px 8px 0 0', border: '1px solid var(--border-color)',
    borderBottom: tab === key ? '2px solid var(--primary)' : '1px solid var(--border-color)',
    background: tab === key ? '#fff' : 'var(--bg-main)',
    color: tab === key ? 'var(--primary)' : 'var(--text-muted)',
    fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer'
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.3rem', borderBottom: '1px solid var(--border-color)' }}>
        <button type="button" onClick={() => setTab('due')} style={tabStyle('due')}>
          <Calendar size={14} /> 청구 대상
        </button>
        <button type="button" onClick={() => setTab('issued')} style={tabStyle('issued')}>
          <History size={14} /> 발행 이력
        </button>
        <button
          type="button"
          onClick={() => setShowMailTemplate((v) => !v)}
          style={{ marginLeft: 'auto', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: showMailTemplate ? 'var(--primary)' : '#fff', color: showMailTemplate ? '#fff' : 'var(--text-muted)', padding: '0.45rem 0.9rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
        >
          <Mail size={14} /> 메일 양식
        </button>
        <button
          type="button"
          onClick={() => setShowDocUpload((v) => !v)}
          style={{ marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--primary)', background: showDocUpload ? 'var(--primary)' : '#fff', color: showDocUpload ? '#fff' : 'var(--primary)', padding: '0.45rem 0.9rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
        >
          <Upload size={14} /> 범칙금 · 과태료 등록
        </button>
      </div>

      {showMailTemplate && (
        <MailTemplateEditor
          onClose={() => setShowMailTemplate(false)}
          showToast={showToast}
          currentUser={currentUser}
        />
      )}

      {showDocUpload && (
        <UpcomingDocUpload
          onClose={() => setShowDocUpload(false)}
          onDone={refreshAll}
          showToast={showToast}
          currentUser={currentUser}
        />
      )}

      {tab === 'issued' && <IssuedInvoicesView showToast={showToast} />}

      {tab === 'due' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
        <Calendar size={16} style={{ color: 'var(--primary)' }} />
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.9rem' }}
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          청구 대상 <strong style={{ color: 'var(--text-bright)' }}>{items.length}건</strong>
          <span style={{ marginLeft: '0.5rem' }}>· 회차는 출금일 기준, 발송은 출금일 10일 전입니다.</span>
        </span>
        {unpaidItems.length > 0 && (
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === '미납' ? 'all' : '미납')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--error)', background: statusFilter === '미납' ? 'var(--error)' : '#fff', color: statusFilter === '미납' ? '#fff' : 'var(--error)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '800', cursor: 'pointer' }}
          >
            <AlertCircle size={14} />
            미납 {unpaidItems.length}건 · {won(unpaidTotal)}
            <span style={{ fontWeight: '600', opacity: 0.85 }}>{statusFilter === '미납' ? '(해제)' : '(보기)'}</span>
          </button>
        )}
        <button
          type="button"
          onClick={fetchDue}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.4rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
        >
          <RefreshCw size={13} /> 새로고침
        </button>
      </div>

      {/* 검색과 필터는 한 줄을 따로 쓴다. 계약자 이름이 길어 좁은 칸에서는 다 보이지 않는다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '280px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="계약자 / 계약번호로 검색"
            style={{ width: '100%', padding: '0.55rem 0.7rem 0.55rem 2.1rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.9rem' }}
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword('')}
              title="검색어 지우기"
              style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '0.55rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.88rem', background: '#fff', cursor: 'pointer' }}
        >
          <option value="all">전체 상태</option>
          {Object.keys(STATUS_STYLE).map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <SortControls
          sort={dueSort}
          selectStyle={{ padding: '0.55rem 0.7rem', fontSize: '0.88rem', borderRadius: '8px' }}
          defaultLabel="정렬 안 함 (출금일순)"
          show={dueSort.active || Boolean(keyword) || statusFilter !== 'all' || dayFilter.length > 0}
          onReset={() => { setKeyword(''); setStatusFilter('all'); setDayFilter([]); }}
        />
        {(keyword || statusFilter !== 'all' || dayFilter.length > 0) && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {visibleItems.length}건 찾음
          </span>
        )}
      </div>

      {/* 출금일 버튼. 결제일이 같은 계약끼리 모아 보는 일이 잦아 한 번에 거를 수 있게 둔다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-muted)', marginRight: '0.2rem' }}>출금일</span>
        <button
          type="button"
          onClick={() => { setChecked([]); setDayFilter([]); }}
          style={{
            border: `1px solid ${dayFilter.length === 0 ? 'var(--primary)' : 'var(--border-color)'}`,
            background: dayFilter.length === 0 ? 'var(--primary)' : '#fff',
            color: dayFilter.length === 0 ? '#fff' : 'var(--text-muted)',
            padding: '0.35rem 0.8rem', borderRadius: '20px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer'
          }}
        >
          전체 {dayBaseItems.length}
        </button>
        {dayButtons.map((b) => {
          const on = dayFilter.includes(b.key);
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => toggleDayFilter(b.key)}
              disabled={!b.count && !on}
              title={b.count ? `${b.label} 출금 ${b.count}건` : '해당 출금일 계약이 없습니다'}
              style={{
                border: `1px solid ${on ? 'var(--primary)' : 'var(--border-color)'}`,
                background: on ? 'var(--primary)' : '#fff',
                color: on ? '#fff' : (b.count ? 'var(--text-bright)' : 'var(--text-muted)'),
                opacity: (b.count || on) ? 1 : 0.5,
                padding: '0.35rem 0.8rem', borderRadius: '20px', fontSize: '0.82rem', fontWeight: '700',
                cursor: (b.count || on) ? 'pointer' : 'not-allowed'
              }}
            >
              {b.label} {b.count}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setGroupByDay((v) => !v)}
          style={{ marginLeft: 'auto', border: '1px solid var(--border-color)', background: groupByDay ? 'var(--bg-main)' : '#fff', color: 'var(--text-muted)', padding: '0.35rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
        >
          {groupByDay ? '결제일 묶음 끄기' : '결제일별로 묶기'}
        </button>
        {groupByDay && dueGroups.length > 0 && (
          <button
            type="button"
            onClick={() => { if (!allCollapsed) setChecked([]); setCollapsedDays(allCollapsed ? [] : dueGroups.map((g) => g.key)); }}
            style={{ border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.35rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
          >
            {allCollapsed ? '모두 펼치기' : '모두 접기'}
          </button>
        )}
      </div>

      {/* 전월 미결제 일괄 처리. 미결제로 찍어 두면 이번 회차에 미수금과 연체 이자가 자동으로 붙는다. */}
      {checked.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', background: 'var(--primary-glow)', border: '1px solid var(--primary)', borderRadius: '8px', padding: '0.6rem 0.9rem' }}>
          <AlertCircle size={15} style={{ color: 'var(--primary)' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-bright)' }}>{checked.length}건 선택</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>전월 회차를 한 번에 처리합니다</span>
          <button
            type="button"
            onClick={() => bulkSetPrevStatus('미납')}
            disabled={bulkBusy}
            style={{ marginLeft: 'auto', background: 'var(--error)', color: '#fff', border: 'none', padding: '0.45rem 0.9rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: bulkBusy ? 'not-allowed' : 'pointer' }}
          >
            전월 미결제로 표시
          </button>
          <button
            type="button"
            onClick={() => bulkSetPrevStatus('입금완료')}
            disabled={bulkBusy}
            style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '0.45rem 0.9rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: bulkBusy ? 'not-allowed' : 'pointer' }}
          >
            전월 입금완료로 표시
          </button>
          <button
            type="button"
            onClick={() => setChecked([])}
            style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.45rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' }}
          >
            선택 해제
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', gap: '1.2rem', alignItems: 'flex-start' }}>
        {/* 청구 대상 목록 */}
        <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
                <th style={{ padding: '0.7rem', width: '36px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={checkableItems.length > 0 && checked.length === checkableItems.length}
                    onChange={(e) => setChecked(e.target.checked ? checkableItems.map((it) => it.scheduleId) : [])}
                    title="전체 선택"
                  />
                </th>
                <SortableTh sort={dueSort} columnKey="partyName" style={{ padding: '0.7rem', textAlign: 'left' }}>계약자</SortableTh>
                <SortableTh sort={dueSort} columnKey="dueDate" style={{ padding: '0.7rem', textAlign: 'center', width: '110px' }}>출금일</SortableTh>
                <SortableTh sort={dueSort} columnKey="sendDate" style={{ padding: '0.7rem', textAlign: 'center', width: '120px' }}>발송 예정</SortableTh>
                <SortableTh sort={dueSort} columnKey="prevStatus" style={{ padding: '0.7rem', textAlign: 'center', width: '130px' }}>전월</SortableTh>
                <SortableTh sort={dueSort} columnKey="contractNo" style={{ padding: '0.7rem', textAlign: 'left' }}>계약번호</SortableTh>
                <SortableTh sort={dueSort} columnKey="roundNo" style={{ padding: '0.7rem', textAlign: 'center', width: '70px' }}>회차</SortableTh>
                <SortableTh sort={dueSort} columnKey="total" style={{ padding: '0.7rem', textAlign: 'right', width: '120px' }}>청구액</SortableTh>
                <SortableTh sort={dueSort} columnKey="status" style={{ padding: '0.7rem', textAlign: 'center', width: '90px' }}>상태</SortableTh>
                <th style={{ padding: '0.7rem', textAlign: 'center', width: '210px' }}>미납액</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>불러오는 중...</td></tr>
              ) : visibleItems.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  {items.length
                    ? '검색 결과가 없습니다.'
                    : '이 달에 청구할 회차가 없습니다. 계약의 결제일과 렌트료 게시일이 정해져 있어야 회차표가 만들어집니다.'}
                </td></tr>
              ) : dueGroups.map((g) => (
                <Fragment key={g.key}>
                  {groupByDay && (
                    <tr
                      onClick={() => toggleGroup(g.key)}
                      style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                    >
                      <td colSpan={10} style={{ padding: '0.5rem 0.7rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {isCollapsed(g.key) ? <ChevronRight size={15} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={15} style={{ color: 'var(--text-muted)' }} />}
                          <span style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--text-bright)' }}>
                            {g.day ? `${g.day}일` : '출금일 미정'}{g.lastDay ? ' (말일)' : ''}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{g.key}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>· {g.items.length}건 · {won(g.total)}</span>
                          {g.unpaidCount > 0 && (
                            <span style={{ fontSize: '0.76rem', fontWeight: '800', color: 'var(--error)' }}>미납 {g.unpaidCount}건</span>
                          )}
                          {isCollapsed(g.key) && (
                            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>접힘 (눌러서 펼치기)</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {!isCollapsed(g.key) && g.items.map((it) => {
                const st = STATUS_STYLE[it.round.status] || STATUS_STYLE['예정'];
                const active = selected?.scheduleId === it.scheduleId;
                const prev = it.prevRound;
                const prevSt = prev ? (STATUS_STYLE[prev.status] || STATUS_STYLE['예정']) : null;
                return (
                  <tr
                    key={it.scheduleId}
                    onClick={() => openRound(it)}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      // 미납은 한눈에 보여야 한다. 고른 행 표시보다 미납 표시를 앞세운다.
                      background: it.round.status === '미납' ? '#fef2f2' : (active ? 'var(--primary-glow)' : 'transparent'),
                      boxShadow: it.round.status === '미납' ? 'inset 3px 0 0 var(--error)' : 'none'
                    }}
                  >
                    <td style={{ padding: '0.7rem', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked.includes(it.scheduleId)}
                        disabled={!prev}
                        title={prev ? '' : '전월 회차가 없습니다 (1회차)'}
                        onChange={(e) => setChecked((cur) => e.target.checked
                          ? [...cur, it.scheduleId]
                          : cur.filter((id) => id !== it.scheduleId))}
                      />
                    </td>
                    <td style={{ padding: '0.7rem', fontWeight: '700' }}>{it.company?.name || it.customer?.name || '-'}</td>
                    <td style={{ padding: '0.7rem', textAlign: 'center' }}>{ymd(it.round.dueDate)}</td>
                    <td style={{ padding: '0.7rem', textAlign: 'center' }}>
                      <div>{ymd(it.sendDate)}</div>
                      {it.round.status === '예정' && it.sendDday !== null && it.sendDday !== undefined && (
                        <div style={{ fontSize: '0.72rem', fontWeight: '700', marginTop: '0.1rem', color: it.sendDday <= 0 ? 'var(--error)' : (it.sendDday <= 1 ? '#d97706' : 'var(--text-muted)') }}>
                          {it.sendDday > 0 ? `D-${it.sendDday}` : (it.sendDday === 0 ? '오늘 발송' : `${-it.sendDday}일 지남`)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.7rem', textAlign: 'center' }}>
                      {prev ? (
                        <>
                          <span style={{ background: prevSt.bg, color: prevSt.color, padding: '0.15rem 0.5rem', borderRadius: '20px', fontSize: '0.72rem', fontWeight: '700' }}>
                            {prev.status}
                          </span>
                          {prev.unpaid > 0 && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--error)', fontWeight: '700', marginTop: '0.15rem' }}>
                              {won(prev.unpaid)}
                            </div>
                          )}
                        </>
                      ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                    </td>
                    <td style={{ padding: '0.7rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{it.contract?.contractNo || '-'}</td>
                    <td style={{ padding: '0.7rem', textAlign: 'center' }}>{it.round.no} / {it.totalRounds}</td>
                    <td style={{ padding: '0.7rem', textAlign: 'right', fontWeight: '700' }}>{won(it.round.total)}</td>
                    <td style={{ padding: '0.7rem', textAlign: 'center' }}>
                      <span style={{ background: st.bg, color: st.color, padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700' }}>
                        {it.round.status}
                      </span>
                      {it.round.status === '미납' && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--error)', fontWeight: '800', marginTop: '0.15rem' }}>
                          미납 {won(it.unpaid)}
                        </div>
                      )}
                      {it.round.status === '입금완료' && it.round.paidAt && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{ymd(it.round.paidAt)}</div>
                      )}
                    </td>
                    <td style={{ padding: '0.5rem 0.7rem' }} onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const cur = unpaidValue(it.round, it.unpaid);
                        const typed = payInput[it.scheduleId];
                        const commit = () => {
                          if (typed === undefined || typed === '') return;
                          if (Number(typed) === Number(cur || 0) && cur !== '') { setPayInput((p) => { const next = { ...p }; delete next[it.scheduleId]; return next; }); return; }
                          saveUnpaid(it, typed);
                        };
                        return (
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            <MoneyInput
                              value={typed ?? cur}
                              onChange={(e) => setPayInput((p) => ({ ...p, [it.scheduleId]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
                              onBlur={commit}
                              placeholder="미납액"
                              title="안 들어온 금액을 적고 Enter. 0을 적으면 완납입니다."
                              style={{
                                width: '110px', padding: '0.3rem 0.45rem', borderRadius: '5px', fontSize: '0.76rem', fontWeight: '700', textAlign: 'right',
                                border: `1px solid ${it.round.status === '미납' ? 'var(--error)' : 'var(--border-color)'}`,
                                color: it.round.status === '미납' ? 'var(--error)' : 'var(--text-bright)'
                              }}
                            />
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {it.round.status === '입금완료' ? '완납' : (it.round.paidAmount > 0 ? `${won(it.round.paidAmount)} 들어옴` : '0 = 완납')}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>

          {/* 고른 계약의 회차 이력. 엑셀로 관리하시던 표와 같은 순서로 둔다. */}
          {selected && schedule && (
            <div style={{ borderTop: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 0.9rem', flexWrap: 'wrap', background: 'var(--bg-main)' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: '800', color: 'var(--text-bright)' }}>
                  {selected.company?.name || selected.customer?.name} 청구 이력
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {selected.contract?.contractNo} · 총 {schedule.totalRounds}회차
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  청구 {issuedCount}건 · 입금 {paidCount}건 · 미납 {unpaidCount}건 · 범칙금 누계 <strong style={{ color: 'var(--error)' }}>{won(fineSum)}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllRounds((v) => !v)}
                  style={{ marginLeft: 'auto', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.76rem', fontWeight: '700', cursor: 'pointer' }}
                >
                  {showAllRounds ? '지나온 회차만' : `전체 ${schedule.totalRounds}회차`}
                </button>
              </div>

              <div style={{ maxHeight: '640px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr style={{ background: '#fff', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontWeight: '700' }}>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', width: '52px' }}>회차</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', width: '100px' }}>날짜</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>월 렌트료</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>전월 미결제</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>이자</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>범칙금</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>정기점검</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>기타청구</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>청구액</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', width: '86px' }}>상태</th>
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', width: '215px' }}>미납액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRounds.map((r) => {
                      const st = STATUS_STYLE[r.status] || STATUS_STYLE['예정'];
                      // 금액이 0인 서류도 보여 준다. 올렸는지 아닌지를 이 표에서 알 수 있어야 한다.
                      const docs = r.attachments || [];
                      const paidDocs = docs.filter((a) => Number(a.amount) > 0);
                      const isCurrent = r.no === form?.no;
                      return (
                        <tr key={r.no} style={{ borderBottom: '1px solid var(--border-color)', background: isCurrent ? 'var(--primary-glow)' : 'transparent' }}>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center', fontWeight: '700' }}>{r.no}</td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>{ymd(r.dueDate)}</td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: 'var(--text-muted)' }}>{won(r.monthlyRent)}</td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                            {r.prevUnpaid ? <span style={{ color: 'var(--error)' }}>{won(r.prevUnpaid)}</span> : '-'}
                            {r.prevOverpaid ? <div style={{ fontSize: '0.71rem', color: '#16a34a' }}>초과 {won(r.prevOverpaid)}</div> : null}
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                            {r.interest ? won(r.interest) : '-'}
                            {r.interest && r.interestRate ? (
                              <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>연 {r.interestRate}% · {r.interestDays || 0}일</div>
                            ) : null}
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                            {r.fine ? <strong style={{ color: 'var(--error)' }}>{won(r.fine)}</strong> : (docs.length ? <span style={{ color: 'var(--text-muted)' }}>0원</span> : '-')}
                            {paidDocs.length > 1 && (
                              <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                                {paidDocs.map((a) => Number(a.amount).toLocaleString()).join(' · ')}
                              </div>
                            )}
                            {docs.length > 0 && (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.2rem', fontSize: '0.71rem', color: 'var(--primary)', fontWeight: '700', marginTop: '0.1rem', flexWrap: 'wrap' }}>
                                <Paperclip size={10} />
                                서류 {docs.length}건
                                {docs.some((a) => !Number(a.amount)) && (
                                  <span style={{ color: '#d97706' }}>· 금액 미입력</span>
                                )}
                                {/* 고객이 직접 낸 건과 기한이 지나 이 회차에 얹힌 건을 갈라 보여 준다 */}
                                {docs.filter((a) => a.noticeStatus === '고객납부').length > 0 && (
                                  <span style={{ color: '#16a34a' }}>
                                    · 고객납부 {docs.filter((a) => a.noticeStatus === '고객납부').length}건
                                  </span>
                                )}
                                {docs.some((a) => a.noticeDueDate && a.noticeStatus !== '고객납부' && daysUntil(a.noticeDueDate) < 0) && (
                                  <span style={{ color: 'var(--error)' }}>· 기한 지남</span>
                                )}
                              </div>
                            )}
                            {docs.length > 0 && (
                              <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                                {[...new Set(docs.map((a) => a.plateNo).filter(Boolean))].join(', ')}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{r.maintenance ? won(r.maintenance) : '-'}</td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                            {r.other ? <span style={{ color: r.other < 0 ? '#16a34a' : 'inherit' }}>{won(r.other)}</span> : '-'}
                            {(r.extras || []).length > 0 && (
                              <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                                {r.extras.map((e) => e.label).filter(Boolean).join(', ')}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: '700' }}>{won(r.total)}</td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>
                            <span style={{ background: st.bg, color: st.color, padding: '0.12rem 0.5rem', borderRadius: '20px', fontSize: '0.71rem', fontWeight: '700' }}>
                              {r.status}
                            </span>
                            {r.paidAt && <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>{ymd(r.paidAt)}</div>}
                            {r.status === '미납' && (
                              <div style={{ fontSize: '0.69rem', color: 'var(--error)', fontWeight: '800' }}>
                                {won(Math.max(0, (r.total || 0) - (r.paidAmount || 0)))}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.3rem 0.5rem' }}>
                            {r.issuedAt ? (
                              <span style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>발행됨 · 고칠 수 없음</span>
                            ) : (
                              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                                {(() => {
                                  const cur = unpaidValue(r);
                                  const typed = roundPayInput[r.no];
                                  const commit = () => {
                                    if (typed === undefined || typed === '') return;
                                    if (Number(typed) === Number(cur || 0) && cur !== '') { setRoundPayInput((p) => { const next = { ...p }; delete next[r.no]; return next; }); return; }
                                    saveRoundUnpaid(r, typed);
                                  };
                                  return (
                                    <MoneyInput
                                      value={typed ?? cur}
                                      onChange={(e) => setRoundPayInput((p) => ({ ...p, [r.no]: e.target.value }))}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
                                      onBlur={commit}
                                      placeholder="미납액"
                                      title="안 들어온 금액을 적으세요. 0을 적으면 완납입니다."
                                      style={{
                                        width: '100px', padding: '0.22rem 0.4rem', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700', textAlign: 'right',
                                        border: `1px solid ${r.status === '미납' ? 'var(--error)' : 'var(--border-color)'}`,
                                        color: r.status === '미납' ? 'var(--error)' : 'var(--text-bright)'
                                      }}
                                    />
                                  );
                                })()}
                                {r.status !== '예정' && (
                                  <button
                                    type="button"
                                    onClick={() => saveRoundPayment(r.no, 0, '예정')}
                                    title="아직 결과가 정해지지 않은 상태로 되돌립니다"
                                    style={{ border: 'none', background: 'none', color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: '700', cursor: 'pointer', padding: '0 0.15rem' }}
                                  >
                                    되돌리기
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ padding: '0.5rem 0.9rem', fontSize: '0.74rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}>
                회차·날짜·월 렌트료는 계약 조건으로 계산된 값이라 전부 들어 있습니다.
                범칙금·기타청구와 입금 여부는 이 프로그램으로 처리한 회차부터 쌓입니다.
              </div>
            </div>
          )}
        </div>

        {/* 회차 상세 */}
        {selected && form && (
          <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1.2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <div style={{ fontWeight: '800', fontSize: '0.95rem', color: 'var(--text-bright)' }}>
                {selected.contract?.contractNo} · {form.no}회차
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                출금일 {ymd(selected.round.dueDate)} · {selected.company?.name || selected.customer?.name || ''}
              </div>
            </div>

            {vehicles.length > 0 && (
              <div style={{ background: 'var(--bg-main)', borderRadius: '8px', padding: '0.7rem 0.8rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-bright)', marginBottom: '0.4rem' }}>
                  차량 {vehicles.length}대
                </div>
                {vehicles.map((v) => (
                  <div key={v._id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-main)', padding: '0.15rem 0' }}>
                    <span>{v.plateNo || v.code} · {v.carModel}</span>
                    <span style={{ fontWeight: '600' }}>{won(v.monthlyFee)}</span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label style={labelStyle}>월 렌트료 (차량 합계)</label>
              <MoneyInput value={form.monthlyRent} onChange={(e) => setForm({ ...form, monthlyRent: e.target.value })} style={inputStyle} />
            </div>

            {EXTRA_FIELDS.map((f) => {
              // 서류에 금액을 적어 두면 그 합계가 청구 금액이 된다. 손으로 고치면 값이 갈리므로 잠근다.
              const lockedByDocs = (f.key === 'fine' && hasDocFine) || (f.key === 'maintenance' && hasDocMaintenance);
              const shownValue = f.key === 'fine' ? fineTotal : (f.key === 'maintenance' ? maintenanceTotal : form[f.key]);
              return (
                <div key={f.key}>
                  <label style={labelStyle}>
                    {f.label}
                    {f.key === 'prevUnpaid' && form.carried > 0 && (
                      <span style={{ marginLeft: '0.4rem', color: 'var(--error)', fontWeight: '700' }}>
                        전월 미결제 {won(form.carried)} 자동 반영
                      </span>
                    )}
                    {f.key === 'interest' && form.suggestedInterest > 0 && (
                      <span style={{ marginLeft: '0.4rem', color: 'var(--error)', fontWeight: '700' }}>
                        연 {form.interestRate}% · {form.interestDays}일 = {won(form.suggestedInterest)}
                      </span>
                    )}
                    {lockedByDocs && (
                      <span style={{ marginLeft: '0.4rem', color: 'var(--primary)', fontWeight: '700' }}>
                        서류 합계 자동
                      </span>
                    )}
                  </label>
                  <MoneyInput
                    value={shownValue}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    style={{ ...inputStyle, ...(lockedByDocs ? { background: 'var(--bg-main)', color: 'var(--text-muted)' } : {}) }}
                    disabled={lockedByDocs}
                  />
                  {f.key === 'interest' && form.suggestedInterest > 0 && Number(form.interest) !== form.suggestedInterest && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, interest: form.suggestedInterest })}
                      style={{ marginTop: '0.25rem', background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', padding: 0 }}
                    >
                      계산값 {won(form.suggestedInterest)} 넣기
                    </button>
                  )}
                </div>
              );
            })}

            {/* 기타 청구는 항목명을 적어 두어야 나중에 무슨 돈인지 알 수 있다 */}
            <div>
              <label style={labelStyle}>기타 청구</label>
              {(form.extras || []).map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <input
                    value={e.label}
                    onChange={(ev) => setForm({
                      ...form,
                      extras: form.extras.map((x, xi) => xi === i ? { ...x, label: ev.target.value } : x)
                    })}
                    placeholder="항목명 (예: 키 분실 재발급)"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <MoneyInput
                    value={e.amount}
                    onChange={(ev) => setForm({
                      ...form,
                      extras: form.extras.map((x, xi) => xi === i ? { ...x, amount: ev.target.value } : x)
                    })}
                    style={{ ...inputStyle, width: '110px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, extras: form.extras.filter((_, xi) => xi !== i) })}
                    style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, extras: [...(form.extras || []), { label: '', amount: 0 }] })}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'none', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer' }}
                >
                  <Plus size={13} /> 항목 추가
                </button>
                {(form.extras || []).length > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                    합계 {won(extrasTotal)}
                  </span>
                )}
              </div>
              {!(form.extras || []).length && Number(form.other) > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  항목명 없이 {won(form.other)}이 잡혀 있습니다. 항목을 추가하면 청구서에 이름이 찍힙니다.
                </div>
              )}
            </div>

            <div>
              <label style={labelStyle}>비고</label>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={inputStyle} />
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>청구 합계</span>
              <span style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--primary)' }}>{won(total)}</span>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={handleSaveRound}
                disabled={saving}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
              >
                <Save size={15} /> {saving ? '저장 중...' : '회차 저장'}
              </button>
              <button
                type="button"
                onClick={() => { setSelected(null); setForm(null); setAttachments([]); }}
                style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.6rem 1rem', borderRadius: '8px', fontWeight: '600', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                닫기
              </button>
            </div>

            {/* 청구서에 함께 보내는 서류 */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                <Paperclip size={14} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-bright)' }}>함께 보낼 서류</span>
              </div>

              {attachments.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.5rem' }}>
                  {attachments.map((a, i) => {
                    const paidByCustomer = a.noticeStatus === '고객납부';
                    const dday = a.noticeDueDate ? daysUntil(a.noticeDueDate) : null;
                    // 기한이 지났는데 고객이 안 냈으면 이번 청구서에 얹혀 나간다. 그 사실이 보여야 한다.
                    const overdue = dday !== null && dday < 0 && !paidByCustomer;
                    return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: paidByCustomer ? '#f0fdf4' : 'var(--bg-main)', borderRadius: '6px', padding: '0.35rem 0.5rem', opacity: paidByCustomer ? 0.75 : 1 }}>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <strong style={{ color: 'var(--primary)' }}>{a.kind}</strong>
                          {a.plateNo ? ` · ${a.plateNo}` : ''}
                          {a.occurredAt ? ` · 위반 ${ymd(a.occurredAt)}` : ''}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.noticeDueDate ? (
                            <>
                              납부기한 {ymd(a.noticeDueDate)}
                              {!paidByCustomer && dday !== null && (
                                <strong style={{ marginLeft: '0.3rem', color: overdue ? 'var(--error)' : (dday <= 3 ? '#d97706' : 'var(--text-muted)') }}>
                                  {dday > 0 ? `D-${dday}` : (dday === 0 ? '오늘까지' : `${-dday}일 지남 · 이번 청구서에 포함`)}
                                </strong>
                              )}
                              {' · '}
                            </>
                          ) : null}
                          {a.fileName}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.8rem', fontWeight: '700', color: paidByCustomer ? 'var(--text-muted)' : 'var(--text-bright)', textDecoration: paidByCustomer ? 'line-through' : 'none', flexShrink: 0 }}>
                        {Number(a.amount) > 0 ? won(a.amount) : '-'}
                      </span>

                      {/* 기한에 확인해서 고객이 냈으면 청구액에서 빼고, 안 냈으면 그대로 청구서에 붙어 나간다 */}
                      <button
                        type="button"
                        onClick={() => handleNoticeStatus(i, paidByCustomer ? '청구예정' : '고객납부')}
                        disabled={Boolean(form?.issuedAt)}
                        title={form?.issuedAt
                          ? '이미 발행한 회차라 바꿀 수 없습니다'
                          : (paidByCustomer ? '다시 청구 대상으로 되돌립니다' : '고객이 직접 냈습니다. 청구액에서 뺍니다.')}
                        style={{
                          flexShrink: 0, whiteSpace: 'nowrap', padding: '0.2rem 0.5rem', borderRadius: '5px',
                          fontSize: '0.72rem', fontWeight: '800',
                          cursor: form?.issuedAt ? 'not-allowed' : 'pointer',
                          opacity: form?.issuedAt ? 0.5 : 1,
                          border: `1px solid ${paidByCustomer ? '#16a34a' : 'var(--border-color)'}`,
                          background: paidByCustomer ? '#16a34a' : '#fff',
                          color: paidByCustomer ? '#fff' : 'var(--text-muted)'
                        }}
                      >
                        {paidByCustomer ? '납부완료' : '납부확인'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(i)}
                        title="목록에서 빼기 (저장된 파일은 남습니다)"
                        style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer', flexShrink: 0 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    );
                  })}
                  {(docFine > 0 || docMaintenance > 0) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: '700', color: 'var(--primary)', padding: '0.2rem 0.5rem' }}>
                      <span>서류 합계</span>
                      <span>
                        {docFine > 0 && `범칙금·과태료 ${won(docFine)}`}
                        {docFine > 0 && docMaintenance > 0 && ' · '}
                        {docMaintenance > 0 && `정비 ${won(docMaintenance)}`}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem' }}>
                <select value={attachKind} onChange={(e) => setAttachKind(e.target.value)} style={{ ...inputStyle, width: '100px' }}>
                  {ATTACHMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                {attachKind === '기타' && (
                  <input
                    value={attachCustomKind}
                    onChange={(e) => setAttachCustomKind(e.target.value)}
                    placeholder="종류 이름"
                    style={{ ...inputStyle, width: '130px' }}
                  />
                )}
                <MoneyInput
                  value={attachAmount}
                  onChange={(e) => setAttachAmount(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="금액 (없으면 비워 두세요)"
                />
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem' }}>
                {platedVehicles.length > 1 && !customPlate ? (
                  <select
                    value={attachPlateNo}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') { setCustomPlate(true); setAttachPlateNo(''); }
                      else setAttachPlateNo(e.target.value);
                    }}
                    style={{ ...inputStyle, flex: 1 }}
                  >
                    {platedVehicles.map((v) => (
                      <option key={v._id} value={v.plateNo}>{v.plateNo} · {v.carModel}</option>
                    ))}
                    <option value="__custom__">직접 입력...</option>
                  </select>
                ) : (
                  <input
                    value={attachPlateNo}
                    onChange={(e) => setAttachPlateNo(e.target.value)}
                    placeholder="차량번호"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                )}
              </div>
              {platedVehicles.length > 1 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  차량 {platedVehicles.length}대 계약입니다. 해당 차량을 고르세요.
                  {customPlate && (
                    <button
                      type="button"
                      onClick={() => { setCustomPlate(false); setAttachPlateNo(platedVehicles[0].plateNo); }}
                      style={{ marginLeft: '0.4rem', border: 'none', background: 'none', color: 'var(--primary)', fontWeight: '700', cursor: 'pointer', padding: 0 }}
                    >
                      목록에서 고르기
                    </button>
                  )}
                </div>
              )}
              <input
                ref={attachInputRef}
                type="file"
                onChange={(e) => handleUploadAttachment(e.target.files?.[0])}
                disabled={uploading}
                style={{ ...inputStyle, padding: '0.3rem' }}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                파일을 고르면 바로 올라갑니다. 여러 건이면 한 건씩 올리세요.
                <br />
                {(selected.company?.name || selected.customer?.name || '거래처')}_청구서_{form.no}회차_
                {attachKind === '기타' ? (attachCustomKind.trim() || '기타') : attachKind}
                {attachPlateNo.trim() ? `_${attachPlateNo.trim()}` : ''} 로 저장되고 메일에 함께 첨부됩니다.
                {isMaintenanceKind(attachKind)
                  ? ' 적어 둔 금액은 정기점검·정비 항목에 더해집니다.'
                  : ' 적어 둔 금액은 범칙금·과태료 항목에 더해집니다. 금액이 없으면 비워 두세요.'}

              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={() => handleIssue(false)}
                disabled={issuing}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: '#fff', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '0.6rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', cursor: issuing ? 'not-allowed' : 'pointer', opacity: issuing ? 0.7 : 1 }}
              >
                <FileText size={15} /> PDF 저장
              </button>
              <button
                type="button"
                onClick={() => handleIssue(true)}
                disabled={issuing}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', cursor: issuing ? 'not-allowed' : 'pointer', opacity: issuing ? 0.7 : 1 }}
              >
                <Send size={15} /> {issuing ? '발행 중...' : '발행 + 메일'}
              </button>
            </div>

            <div>
              <label style={labelStyle}>받는 사람 (청구서 메일)</label>
              <input
                value={mailTo}
                onChange={(e) => setMailTo(e.target.value)}
                style={inputStyle}
                placeholder="billing@example.com"
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={saveMailToCompany} onChange={(e) => setSaveMailToCompany(e.target.checked)} />
                이 주소를 법인 청구 이메일로 저장 (다음 달부터 기본값)
              </label>
              {selected.company?.billingEmail && mailTo !== selected.company.billingEmail && (
                <div style={{ fontSize: '0.72rem', color: 'var(--primary)', marginTop: '0.3rem' }}>
                  기존 등록 주소: {selected.company.billingEmail}
                </div>
              )}
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
              저장 위치: RENT\{selected.company?.name || '거래처'}\02.청구서\{selected.contract?.contractNo}\
            </div>
          </div>
        )}
      </div>

      {/* PDF로 만들 청구서 양식. 화면에는 보이지 않게 두고 이 요소만 캡처한다. */}
      {selected && form && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
          <InvoiceSheet
            innerRef={sheetRef}
            item={selected}
            round={{
              ...form,
              fine: fineTotal,
              maintenance: maintenanceTotal,
              other: otherTotal,
              attachments,
              dueDate: selected.round.dueDate
            }}
            vehicles={vehicles}
            total={total}
          />
        </div>
      )}

      {missing.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #f59e0b', borderRadius: '10px', padding: '0.9rem 1.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
            <AlertCircle size={15} style={{ color: '#d97706' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--text-bright)' }}>
              아직 청구 대상에 없는 계약 {missing.length}건
            </span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
            회차표가 있어야 청구 대상에 뜹니다. 회차표는 출고 준비에서 <strong>월 대여료 결제일</strong>과
            <strong> 렌트료 게시일</strong>을 저장하면 자동으로 만들어집니다.
          </div>
          {missing.map((m) => (
            <div key={m.contractId} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                  {m.partyName || '계약자 미상'} <span style={{ fontWeight: '500', color: 'var(--text-muted)' }}>{m.contractNo}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: m.ready ? '#16a34a' : 'var(--error)', marginTop: '0.1rem' }}>
                  {m.ready ? '지금 만들 수 있습니다.' : m.reason}
                </div>
              </div>
              <button
                type="button"
                disabled={!m.ready}
                onClick={() => regenerate(m.contractId)}
                style={{
                  border: '1px solid var(--primary)',
                  background: m.ready ? 'var(--primary)' : '#fff',
                  color: m.ready ? '#fff' : 'var(--text-muted)',
                  borderColor: m.ready ? 'var(--primary)' : 'var(--border-color)',
                  padding: '0.35rem 0.8rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '700',
                  cursor: m.ready ? 'pointer' : 'not-allowed'
                }}
              >
                회차표 만들기
              </button>
            </div>
          ))}
        </div>
      )}
      </div>
      )}
    </div>
  );
}

export default MonthlyBillingView;
