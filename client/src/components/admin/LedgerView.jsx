import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Plus, Save, Trash2, RefreshCw, ArrowLeft, Link2, Printer, FileSpreadsheet, ArrowUp, ArrowDown, CalendarPlus, Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { toCommaString } from '../../utils/format.js';
import MoneyInput from './MoneyInput.jsx';
import ShortTermTargetPanel from './ShortTermTargetPanel.jsx';
import { useSaveShortcut } from './useSaveShortcut.js';
import { quotePlanOf, planInterestTotal, planRevenue, isDepositOffsetTakeover } from '../../../../shared/ledgerPlan.js';
import { hasOwnLoan } from '../../../../shared/companyFunding.js';
import useBackClose from '../../utils/useBackClose.js';
import { matchRentToRounds } from './rentMatch.js';

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

/**
 * 갑지 입력 열. group은 새 줄이 저장될 열, side는 정산 부호다.
 *
 * 예전 '기타' 열(수수료·캐시백·환급)도 회사로 들어오는 돈이라 고객입금 열에 합쳐 보여 준다.
 * 이미 group '기타'로 저장된 줄은 그대로 두고 화면에서만 한 열에 모은다(includes).
 */
const COLUMNS = [
  { group: '회사출금', includes: ['회사출금'], title: '회사출금액 (지출)', side: '지출', accent: '#d9534f' },
  { group: '고객입금', includes: ['고객입금', '기타'], title: '고객입금액 · 기타 (입금)', side: '입금', accent: '#2f6f4e' }
];

const STATUSES = ['차량미배정', '운용중', '거래완료', '보류'];
const LEDGER_TYPES = ['장기렌트', '단기렌트', '기타'];

// 목록의 형태. 판매가 끝난 차는 장기·단기와 상관없이 완료로 모은다(서버 formOf와 같은 기준).
const FORMS = ['장기', '단기', '완료'];
const FORM_STYLE = {
  장기: { background: '#eef3fa', color: '#4a6fa5' },
  단기: { background: '#fff7e6', color: '#fa8c16' },
  완료: { background: '#f0f0f0', color: '#8c8c8c' }
};

/**
 * 목록에서 정렬할 수 있는 항목.
 *
 * key는 서버가 아는 이름이고, 표 머리글을 누르면 그 기준으로 정렬한다.
 * 누적지출·누적입금·정산금액은 저장된 값이 아니라 줄을 합쳐 만든 값이라 서버에서 계산 후 정렬한다.
 */
const SORTABLE = [
  { key: 'form', label: '형태' },
  { key: 'ledgerNo', label: '구분(갑지)' },
  { key: 'contractorName', label: '계약자명' },
  { key: 'customerName', label: '고객명' },
  { key: 'carModel', label: '차종' },
  { key: null, label: '차량 사양' },
  { key: 'plateNo', label: '차량번호' },
  { key: null, label: '차대번호' },
  { key: 'deliveredAt', label: '출고일' },
  { key: 'contractEndAt', label: '계약종료일' },
  { key: null, label: '상태' },
  { key: 'paidOut', label: '누적지출', numeric: true },
  { key: 'paidIn', label: '누적입금', numeric: true },
  { key: 'balance', label: '정산금액(보증금 제외)', numeric: true }
];

const toDateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
// 1구간은 최초 계약, 그 뒤로는 1차·2차 연장이다
const periodName = (seq) => (seq === 1 ? '최초 계약' : `${seq - 1}차 연장`);
const signed = (n) => `${n < 0 ? '-' : ''}${toCommaString(Math.abs(n || 0))} 원`;

const card = {
  background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)',
  boxShadow: 'var(--shadow-premium)'
};
const th = {
  padding: '0.5rem 0.4rem', fontSize: '0.75rem', fontWeight: '700',
  color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', textAlign: 'left'
};
const cellPad = { padding: '0.4rem 0.45rem' };
const addCell = {
  width: '100%', padding: '0.4rem 0.45rem', border: '1px solid var(--border-color)',
  borderRadius: '6px', fontSize: '0.78rem', background: '#fff', boxSizing: 'border-box'
};
const editCell = { ...addCell, padding: '0.3rem 0.4rem' };
const iconBtn = (color) => ({
  border: 'none', background: 'none', color, cursor: 'pointer', padding: '0 0.15rem'
});

/**
 * 날짜 입력칸. 달력을 열지 않고 261029처럼 쳐 넣으면 2026-10-29가 된다.
 *
 * 칸을 벗어나거나 Enter를 누를 때 정리한다. 타이핑 도중에 고쳐 버리면
 * 26까지 쳤을 때 값이 멋대로 바뀌어 다음 글자를 못 친다.
 */
function DateText({ value, onChange, disabled, style, placeholder = 'YYMMDD' }) {
  const [text, setText] = useState(value || '');
  // 바깥에서 값이 바뀌면 칸에 다시 비춘다. useEffect로 하면 한 번 더 그려지므로
  // 리액트가 권하는 대로 그리는 도중에 맞춘다.
  const [seen, setSeen] = useState(value || '');
  if (seen !== (value || '')) { setSeen(value || ''); setText(value || ''); }

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

const RENT_LABEL = /렌트료|렌트\s*\d+\s*회차/;

/**
 * CMS 자동이체 수수료(건당). 월 렌트료에서 떼고 들어온다.
 *
 * 250원 + 부가세 = 275원 (대표님 확인, 2026-09-29). 원장에서 월 렌트료보다 적게 들어온 금액 중 가장 흔한 값도 275원이었다.
 * 원장 대부분은 수수료를 떼기 전 금액으로 적혀 있어, 수익성 검토에서 회차마다 따로 비용으로 잡는다.
 */
const CMS_FEE = 275;
// 월 렌트료보다 이 금액 미만으로 적게 들어온 회차는 미납이 아니라 CMS 수수료 차감으로 본다
const CMS_SHORT_TOLERANCE = 2000;

/**
 * 이 줄이 월 렌트료 몇 회차인지. 렌트료 줄이 아니거나 회차를 모르면 null.
 *
 * 엑셀에서 옮겨 온 줄은 round가 비어 있고 이름에만 "렌트료 3회차"로 남아 있는 경우가 있어
 * 이름에서도 회차를 읽는다.
 */
const rentRoundOf = (e) => {
  if (e.category !== '렌트료' && !RENT_LABEL.test(e.label || '')) return null;
  if (e.round) return Number(e.round);
  const m = /(\d+)\s*회차/.exec(e.label || '');
  return m ? Number(m[1]) : null;
};

// 화면에서 막 만든 줄의 임시 id. 저장하면 서버가 진짜 id로 바꾼다.
const newEntryId = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 렌트료 개시일에서 n회차 예정일을 낸다. 1월 31일 시작이면 2월은 말일로 맞춘다.
const dueDateOf = (start, round) => {
  if (!start) return '';
  // 'YYYY-MM-DD'는 그 날짜 그대로, 시각이 붙은 값(DB 저장값)은 한국 시간으로 읽는다.
  // 한국 자정은 UTC 전날 15시라 앞 10글자만 자르면 하루 앞당겨진다(3/31 → 3/30, 말일 결제가 30일로 보였다).
  const s = String(start);
  const base = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(start);
  if (Number.isNaN(base.getTime())) return '';
  const target = new Date(base.getFullYear(), base.getMonth() + round - 1, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(base.getDate(), lastDay));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
};

/**
 * 회차표. 고객입금 열의 월 렌트료, 회사출금 열의 보험료·자동차세·자동차 검사에 쓴다.
 *
 * 회차마다 돈이 오갔는지 체크한다. 체크한 회차는 따로 저장하지 않고 열에 있는
 * "렌트료 n회차", "보험 n회차" 줄 그 자체다. 그래서 자동 연동으로 들어온 줄,
 * 엑셀에서 옮겨 온 줄, 여기서 찍은 줄이 모두 같은 회차 칸에 모인다.
 *
 * blocks: [{ key, heading, defaultAmount, rounds: [{ round, dueDate, paid, paidAmount, paidDate, entryIds }] }]
 * 계약 구간이 여러 개면 렌트료는 구간마다 block이 하나씩이다.
 *
 * askAmount가 켜져 있으면 체크할 때 금액도 받는다. 렌트료는 월 렌트료로 정해져 있지만
 * 보험료·자동차세는 회차마다 금액이 달라서 그때 적어야 한다.
 */
function RoundChecklist({ title, verb, accent, tint, blocks, canEdit, askAmount, onPay, onCancel, onEdit, onAddRound, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const [paying, setPaying] = useState(null); // { key, round, date, amount }
  // 이미 찍은 회차의 금액·날짜 고치기(잘못 적었을 때). 지우고 다시 찍지 않아도 된다(대표님 2026-10-22)
  const [fixing, setFixing] = useState(null); // { key, round, date, amount, entryIds }

  // 쉬는 달(렌트료 표에서 0원인 회차)은 받을 돈이 없으니 진행 칸 수에서 뺀다
  const all = blocks.flatMap((b) => b.rounds).filter((r) => !r.free);
  const paidCount = all.filter((r) => r.paid).length;
  const paidSum = all.reduce((s, r) => s + r.paidAmount, 0);
  const hasDue = all.some((r) => r.dueDate);

  const startPay = (block, round) => {
    // 금액은 바로 앞 회차에 낸 금액을 먼저 채워 둔다. 보험료 분납처럼 대개 같은 금액이 이어진다.
    const before = [...block.rounds].reverse().find((r) => r.round < round && r.paid);
    setPaying({ key: block.key, round, date: localToday(), amount: before?.paidAmount || block.defaultAmount || '' });
  };

  const confirmPay = () => {
    const date = parseDateInput(paying.date);
    if (!date) { window.alert(`${verb}일을 261029 처럼 여섯 자리나 2026-10-29 형식으로 적어 주세요.`); return; }
    const amount = Number(paying.amount) || 0;
    if (askAmount && !amount) { window.alert('금액을 적어 주세요.'); return; }
    onPay(blocks.find((b) => b.key === paying.key), paying.round, date, amount);
    setPaying(null);
  };

  const payKeys = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); confirmPay(); }
    if (ev.key === 'Escape') setPaying(null);
  };

  const startFix = (block, r) => {
    setPaying(null);
    setFixing({ key: block.key, round: r.round, date: r.paidDate || '', amount: r.paidAmount || '', entryIds: r.entryIds });
  };
  const confirmFix = () => {
    const date = parseDateInput(fixing.date);
    if (!date) { window.alert(`${verb}일을 261029 처럼 여섯 자리나 2026-10-29 형식으로 적어 주세요.`); return; }
    const amount = Number(fixing.amount) || 0;
    if (!amount) { window.alert('금액을 적어 주세요. 이 회차를 없애려면 × 로 취소해 주세요.'); return; }
    onEdit(fixing.entryIds, fixing.round, date, amount);
    setFixing(null);
  };
  const fixKeys = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); confirmFix(); }
    if (ev.key === 'Escape') setFixing(null);
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border-color)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.8rem', background: tint, border: 'none', borderBottom: open ? '1px solid var(--border-color)' : 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ fontWeight: '800', fontSize: '0.8rem', color: accent, whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {verb} {paidCount} / {all.length}회
        </span>
        <span style={{ flex: 1, height: '6px', background: 'rgba(0,0,0,0.07)', borderRadius: '3px', overflow: 'hidden', minWidth: '40px' }}>
          <span style={{ display: 'block', height: '100%', width: `${all.length ? (paidCount / all.length) * 100 : 0}%`, background: accent }} />
        </span>
        <span style={{ fontSize: '0.78rem', fontWeight: '700', whiteSpace: 'nowrap' }}>{toCommaString(paidSum)} 원</span>
      </button>

      {open && (
        <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '58px' }} />
              {hasDue && <col style={{ width: '92px' }} />}
              <col />
              <col style={{ width: '170px' }} />
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: '#fafafa' }}>
                <th style={th}>회차</th>
                {hasDue && <th style={th}>예정일</th>}
                <th style={{ ...th, textAlign: 'right' }}>금액</th>
                <th style={{ ...th, textAlign: 'center' }}>{verb}</th>
              </tr>
            </thead>
            {blocks.map((b) => (
              <tbody key={b.key}>
                {b.heading && (
                  <tr>
                    <td colSpan={hasDue ? 4 : 3} style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem', fontWeight: '800', background: 'var(--bg-main)', color: 'var(--text-muted)' }}>
                      {b.heading}
                    </td>
                  </tr>
                )}
                {b.rounds.map((r) => {
                  const isPaying = paying && paying.key === b.key && paying.round === r.round;
                  const isFixing = fixing && fixing.key === b.key && fixing.round === r.round;
                  return (
                    <tr key={r.round} style={{ borderBottom: '1px solid var(--border-color)', background: r.paid ? '#fff' : (r.free ? '#f8fafc' : (r.overdue ? '#fef2f2' : '#fffdf7')) }}>
                      <td style={{ ...cellPad, fontSize: '0.78rem', fontWeight: '700' }}>{r.round}회</td>
                      {hasDue && <td style={{ ...cellPad, fontSize: '0.74rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.dueDate || '-'}</td>}
                      <td style={{ ...cellPad, fontSize: '0.78rem', textAlign: 'right', whiteSpace: 'nowrap', color: r.paid ? 'inherit' : 'var(--text-muted)' }}>
                        {isFixing ? (
                          <MoneyInput
                            value={fixing.amount}
                            onChange={(ev) => setFixing((f) => ({ ...f, amount: ev.target.value }))}
                            onKeyDown={fixKeys}
                            placeholder="금액"
                            autoFocus
                            style={editCell}
                          />
                        ) : isPaying && askAmount ? (
                          <MoneyInput
                            value={paying.amount}
                            onChange={(ev) => setPaying((p) => ({ ...p, amount: ev.target.value }))}
                            onKeyDown={payKeys}
                            placeholder="금액"
                            style={editCell}
                          />
                        ) : (r.combinedInto || (r.overdue && !r.paid) ? ''
                          : r.free && !r.paid ? <span style={{ color: 'var(--text-muted)' }}>0 · 쉼</span>
                          : (r.paid ? toCommaString(r.paidAmount) : ((r.expected ?? b.defaultAmount) ? toCommaString(r.expected ?? b.defaultAmount) : '-')))}
                        {r.note && !isPaying && (
                          <div style={{ fontSize: '0.66rem', color: r.noteColor || 'var(--text-muted)', whiteSpace: 'normal' }} title={r.noteTitle || '자동이체 수수료를 떼고 들어온 회차입니다'}>{r.note}</div>
                        )}
                      </td>
                      <td style={{ ...cellPad, whiteSpace: 'nowrap' }}>
                        {r.combinedInto ? (
                          <span style={{ display: 'block', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700, color: '#15803d' }} title="몰아서 들어온 돈입니다. 금액은 들어온 회차에 있습니다.">→ {r.combinedInto}회 때 함께 입금</span>
                        ) : r.paid && isFixing ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <input
                              value={fixing.date}
                              onChange={(ev) => setFixing((f) => ({ ...f, date: ev.target.value }))}
                              onKeyDown={fixKeys}
                              placeholder="YYMMDD"
                              title={`${verb}일. 261029 처럼 여섯 자리로 쳐도 됩니다`}
                              style={{ ...editCell, minWidth: 0 }}
                            />
                            <button type="button" onClick={confirmFix} title="고친 내용 반영" style={iconBtn(accent)}><Check size={14} /></button>
                            <button type="button" onClick={() => setFixing(null)} title="닫기" style={iconBtn('var(--text-muted)')}><X size={14} /></button>
                          </div>
                        ) : r.paid ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', justifyContent: 'center' }}>
                            <Check size={13} color={accent} />
                            <span style={{ fontSize: '0.74rem', color: accent, fontWeight: '700' }}>{r.paidDate || '날짜 없음'}</span>
                            {canEdit && onEdit && (
                              <button type="button" onClick={() => startFix(b, r)} title={`${verb} 금액·날짜 수정`} style={iconBtn('var(--primary)')}>
                                <Pencil size={13} />
                              </button>
                            )}
                            {canEdit && (
                              <button type="button" onClick={() => onCancel(r.entryIds, b, r.round)} title={`${verb} 취소`} style={iconBtn('var(--error)')}>
                                <X size={13} />
                              </button>
                            )}
                          </div>
                        ) : isPaying ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <input
                              value={paying.date}
                              onChange={(ev) => setPaying((p) => ({ ...p, date: ev.target.value }))}
                              onKeyDown={payKeys}
                              autoFocus={!askAmount}
                              placeholder="YYMMDD"
                              title={`${verb}일. 261029 처럼 여섯 자리로 쳐도 됩니다`}
                              style={{ ...editCell, minWidth: 0 }}
                            />
                            <button type="button" onClick={confirmPay} title={`${verb} 확인`} style={iconBtn(accent)}><Check size={14} /></button>
                            <button type="button" onClick={() => setPaying(null)} title="닫기" style={iconBtn('var(--text-muted)')}><X size={14} /></button>
                          </div>
                        ) : r.free ? (
                          <span style={{ display: 'block', textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }} title="렌트료 표에서 0원인 달입니다. 이 계약은 11개월 받고 12개월째는 받지 않습니다.">청구 없음 (쉬는 달)</span>
                        ) : canEdit ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          {r.overdue && <span style={{ textAlign: 'center', fontSize: '0.72rem', fontWeight: 800, color: '#dc2626' }}>미입금</span>}
                          <button
                            type="button"
                            onClick={() => startPay(b, r.round)}
                            style={{ width: '100%', border: `1px solid ${accent}`, background: '#fff', color: accent, borderRadius: '6px', padding: '0.25rem 0', fontSize: '0.74rem', fontWeight: '700', cursor: 'pointer' }}
                          >
                            {verb} 완료
                          </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.74rem', color: r.overdue ? '#dc2626' : 'var(--text-muted)', fontWeight: r.overdue ? 800 : 400 }}>미{verb}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
          {canEdit && onAddRound && (
            <button
              type="button"
              onClick={onAddRound}
              style={{ width: '100%', border: 'none', borderTop: '1px dashed var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.4rem', fontSize: '0.74rem', fontWeight: '600', cursor: 'pointer' }}
            >
              <Plus size={12} style={{ verticalAlign: '-2px' }} /> 회차 추가
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 회차가 있는 줄들을 회차 칸에 나눠 담는다.
 *
 * 이름에 "3회차"가 적힌 줄은 그 칸에 넣는다. 엑셀에서 옮겨 온 "자동차세", "검사"처럼
 * 회차 없이 적힌 줄은 날짜 순으로 비어 있는 칸을 앞에서부터 채운다.
 * 칸보다 줄이 많으면 칸을 늘려서 빠지는 줄이 없게 한다.
 */
const fillRounds = (rows, count) => {
  const slots = new Map();
  const loose = [];
  rows.forEach((e) => {
    const round = Number(e.round) || Number(/(\d+)\s*회차/.exec(e.label || '')?.[1]) || 0;
    if (!round) { loose.push(e); return; }
    if (!slots.has(round)) slots.set(round, []);
    slots.get(round).push(e);
  });
  loose.sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
  let next = 1;
  loose.forEach((e) => {
    while (slots.has(next)) next += 1;
    slots.set(next, [e]);
  });

  const total = Math.max(count, ...slots.keys(), 0);
  return Array.from({ length: total }, (_, i) => {
    const round = i + 1;
    const hits = slots.get(round) || [];
    const dates = hits.map((e) => e.date).filter(Boolean).sort();
    return {
      round,
      paid: hits.length > 0,
      paidAmount: hits.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
      paidDate: dates[dates.length - 1] || '',
      entryIds: hits.map((e) => e._id)
    };
  });
};

/**
 * 회사출금 열 맨 위에 고정으로 놓는 항목.
 *
 * single: 한 번만 나가는 돈. 줄이 없어도 빈 칸을 보여 줘서 빠뜨린 걸 바로 알 수 있게 한다.
 * rounds: 회차로 나가는 돈. 월 렌트료처럼 회차표로 보여 준다.
 *   count는 기본 회차 수다. 자동차세는 1년에 2번(6월·12월), 검사는 1년에 1번으로 잡고
 *   모자라면 회차표 아래 "회차 추가"로 늘린다.
 */
const EXPENSE_FIXED = [
  { category: '계약금', label: '계약금', kind: 'single' },
  { category: '차량가', label: '차량가', kind: 'single' },
  { category: '등록비용', label: '등록비용', kind: 'single' },
  { category: '보험', label: '보험료', entryLabel: '보험', kind: 'rounds', count: () => 9 },
  { category: '자동차세', label: '자동차세', entryLabel: '자동차세', kind: 'rounds', count: (months) => (months ? Math.ceil(months / 6) : 2) },
  { category: '검사비', label: '자동차 검사', entryLabel: '자동차 검사', kind: 'rounds', count: (months) => (months ? Math.ceil(months / 12) : 1) }
];
const FIXED_CATEGORIES = new Set(EXPENSE_FIXED.map((f) => f.category));

// 견적서에서 이 차의 견적 비용을 꺼내는 식(quotePlanOf)은 서버의 기준표 저장과 같이 쓰려고 shared/ledgerPlan.js에 있다.

// 운영하면서 나간 돈으로 보지 않는 분류. 차를 사고 등록하고 취득세·보험·할부를 내는 돈은 판관비가 아니다.
// 차량작업(썬팅·PPF·블랙박스 등)은 판관비가 아니라 판매 수수료에서 충당하므로 따로 본다.
// 대출금(캐피탈·렌공에서 빌려 들어온 돈)과 할부금(그 상환)은 차를 사는 돈이라 운영비가 아니다.
// 자동차세·자동차 검사비·탁송료는 판관비(차량가 3%)에서 나가는 돈이다(대표님 2026-10-28). 그래서 여기 넣지 않는다.
const NOT_OPERATING = new Set(['계약금', '차량가', '등록비용', '할부이자', '할부금', '대출금', '보험', '제세공과', '수리·사고', '정기점검', '차량작업']);

/**
 * 보험료 정산(대표님 2026-10-23). 보험료 = 보험 + 공제조합 보험료 − 보험료 환급(고객입금 열의 '삼성보험료 환급'·'자차보험 환급' 등).
 * 공제조합 출자금은 나중에 돌려받는 돈이라 보험료가 아니다. 수리비는 보험료와 따로 본다(자차보험료로 막는 돈).
 */
const isCoopShare = (e) => e.category === '공제조합' && /출자/.test(e.label || '');
// 엑셀 갑지에는 보험료 환급을 회사출금 열에 마이너스로 적은 줄도 있다('보험료 해지 환급금' -747,750, 분류 환급, Benz-018).
// 판관비에서 빠지던 돈이라 보험료를 줄이는 줄로 본다(2026-10-28)
const isInsuranceRefundOut = (e) => e.side === '지출' && e.category === '환급' && /보험|공제|자차/.test(e.label || '');
const isInsurancePremium = (e) => e.side === '지출' && (e.category === '보험' || (e.category === '공제조합' && !isCoopShare(e)) || isInsuranceRefundOut(e));
const isInsuranceRefund = (e) => e.side === '입금' && /환급/.test(`${e.category || ''} ${e.label || ''}`) && /보험|공제|자차/.test(e.label || '');

/**
 * 회사가 먼저 낸 돈을 고객에게서 돌려받았는지 한 건씩 맞춘다(대표님 2026-10-23).
 *   과태료·통행료: 언제나 고객 몫이다.
 *   정비(정기점검·타이어 등): 정비 미포함 고객이면 고객 몫이다. 회사가 내더라도 렌트료에 얹어 받거나 고객이 통장으로 넣어 준다.
 *
 * 돌려받은 곳은 이 순서로 찾는다.
 *   1) 같은 종류의 마이너스 출금 줄(상계) — 화우 정기점검 717,745 → -717,745처럼 받은 돈을 출금 취소로 적은 경우
 *   2) 고객이 따로 넣은 입금 줄(이름에 정비·점검·과태료 등)
 *   3) 낸 날 뒤 100일 안의 렌트료 입금 중 월 렌트료보다 더 들어온 돈(차액). 과태료는 다음 달 렌트료에 얹어 빠져나간다.
 *      청구가 한두 달 늦은 경우가 있어 100일로 본다(Benz-003 2023-09-04 과태료 → 11/30 24회차)
 *   4) 청구서 회차의 범칙금·정비 금액(입금완료). 청구서로 받는 계약은 원장 렌트료 줄에 렌트료만 적기도 한다.
 * 금액은 95%까지 맞으면 같은 건으로 보고, 차이가 나면 적어 준다(화우 정비: 원장 717,745 / 청구 712,745).
 * 예전에는 렌트료 차액을 통째로 더해 보았는데, 1회차 일할 정산처럼 큰 차액이 과태료를 전부 덮어 '회수'로 보였다.
 *
 * @returns {Array<{entry, kind: 'fine'|'maint', via: string|null, got: number}>} 줄마다 돌려받은 곳(없으면 null)과 받은 금액
 */
const RECOVER_WINDOW_DAYS = 100;
const OFFSET_WINDOW_DAYS = 365;
const RECOVER_LABEL = { fine: /과태료|통행료|범칙금|주차/, maint: /정비|점검|타이어|오일|정기/ };
const recoverKindOf = (e) => {
  if (e.category === '과태료·통행료') return 'fine';
  if (e.category === '정기점검' || matchMaintenance(e)) return 'maint';
  return null;
};
const matchRecoveries = (entries, rentBySeq, billingRounds = [], { maintenance = false } = {}) => {
  const dayOf = (d) => Math.floor(new Date(String(d).slice(0, 10)).getTime() / 864e5);
  const ymd = (d) => String(d).slice(0, 10);
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
  const targets = entries
    .filter((e) => e.side === '지출' && Number(e.amount) > 0 && e.date)
    .map((e) => ({ e, kind: recoverKindOf(e) }))
    .filter((t) => t.kind === 'fine' || (maintenance && t.kind === 'maint'))
    .sort((a, b) => byDate(a.e, b.e));
  const offsets = entries.filter((e) => e.side === '지출' && Number(e.amount) < 0 && e.date)
    .map((e) => ({ e, kind: recoverKindOf(e), left: -Number(e.amount) }));
  const deposits = entries.filter((e) => e.side === '입금' && e.date && !(rentRoundOf(e) || e.category === '렌트료')
    && !['보증금', '인수가', '선납금', '대출금'].includes(e.category) && !isInsuranceRefund(e))
    .map((e) => ({ e, left: Number(e.amount) || 0 }));
  const rents = entries.filter((e) => e.side === '입금' && (rentRoundOf(e) || e.category === '렌트료') && e.date)
    .map((e) => ({ e, left: (Number(e.amount) || 0) - (rentBySeq[e.periodSeq || 1] || 0) }))
    .filter((r) => r.left > 0)
    .sort((a, b) => byDate(a.e, b.e));
  const billed = billingRounds.filter((r) => r.status === '입금완료' && (r.paidAt || r.dueDate))
    .map((r) => ({ r, day: ymd(r.paidAt || r.dueDate), left: { fine: Number(r.fine) || 0, maint: Number(r.maintenance) || 0 } }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const enough = (left, amount) => left >= amount * 0.95;
  const diffNote = (got, amount) => (got !== amount ? ` (차이 ${toCommaString(amount - got)})` : '');
  return targets.map(({ e, kind }) => {
    const amount = Number(e.amount);
    const after = (d, days) => dayOf(d) >= dayOf(e.date) && dayOf(d) - dayOf(e.date) <= days;
    const take = (left) => Math.min(left, amount);

    const off = offsets.find((x) => x.kind === kind && after(x.e.date, OFFSET_WINDOW_DAYS) && enough(x.left, amount));
    if (off) {
      const got = take(off.left); off.left -= got;
      return { entry: e, kind, got, via: `${ymd(off.e.date)} ${off.e.label} ${toCommaString(off.e.amount)}로 상계(돌려받음)${diffNote(got, amount)}` };
    }
    const dep = deposits.find((x) => RECOVER_LABEL[kind].test(x.e.label || '') && after(x.e.date, RECOVER_WINDOW_DAYS) && enough(x.left, amount));
    if (dep) {
      const got = take(dep.left); dep.left -= got;
      return { entry: e, kind, got, via: `${ymd(dep.e.date)} 고객 입금 '${dep.e.label}'${diffNote(got, amount)}` };
    }
    const rent = rents.find((x) => dayOf(x.e.date) > dayOf(e.date) && after(x.e.date, RECOVER_WINDOW_DAYS) && enough(x.left, amount));
    if (rent) {
      const got = take(rent.left); rent.left -= got;
      return { entry: e, kind, got, via: `${ymd(rent.e.date)} ${rent.e.label || '렌트료'}에 얹어 받음${diffNote(got, amount)}` };
    }
    const bill = billed.find((x) => after(x.day, RECOVER_WINDOW_DAYS) && enough(x.left[kind], amount));
    if (bill) {
      const got = take(bill.left[kind]); bill.left[kind] -= got;
      return { entry: e, kind, got, via: `${bill.day} 청구서 ${bill.r.no}회 ${kind === 'fine' ? '범칙금' : '정비비'}로 받음${diffNote(got, amount)}` };
    }
    return { entry: e, kind, got: 0, via: null };
  });
};

/**
 * 원장 출금 줄을 견적의 정비 항목에 맞춘다. 이름(자유 입력)으로 판정하므로 위에서부터 먼저 맞는 것을 쓴다.
 * "브레이크 오일"은 브레이크 패드가 아니라 오일류라 먼저 본다. 브레이크 앞·뒤는 원장에서 구분이 안 돼 한 줄로 본다.
 * 정비 항목인데 분류가 '기타'라 운영비(판관비)로 잡히던 줄(배터리 교체 등)도 여기서 정비로 옮긴다.
 */
const MAINTENANCE_MATCH = [
  // 얼라이먼트는 타이어를 바꿀 때 같이 하므로 견적의 타이어 교체비에 들어 있다
  { key: 'tire', name: '타이어', rx: /타이어|얼라인먼트|얼라이먼트|얼라인|휠\s*정렬/ },
  { key: 'transmissionOil', name: '변속기·브레이크 오일', rx: /미션|변속기|감속기|브레이크\s*오일/ },
  { key: 'brake', name: '브레이크 패드·라이닝', rx: /브레이크|패드|라이닝/ },
  { key: 'regularCheck', name: '정기점검·엔진오일', rx: /정기\s*점검|엔진\s*오일|오일\s*교환|오일및/ },
  { key: 'acFilter', name: '에어컨 필터', rx: /에어컨\s*필터|향균|항균/ },
  { key: 'wiper', name: '와이퍼', rx: /와이퍼/ },
  { key: 'tireRotation', name: '타이어 위치 교환', rx: /위치\s*교환|로테이션/ },
  { key: 'battery', name: '배터리', rx: /배터리|밧데리/ },
  { key: 'sparkPlug', name: '점화플러그', rx: /점화\s*플러그|플러그/ },
  { key: 'coolant', name: '부동액·냉각수', rx: /부동액|냉각수/ }
];
// 견적 정비 항목 key를 원장 대조 줄로 묶는다(브레이크 앞·뒤 → 브레이크)
const planKeyOf = (key) => (key === 'brakeFront' || key === 'brakeRear' ? 'brake' : key);
const matchMaintenance = (e) => {
  const label = e.label || '';
  // 차량작업(썬팅·블랙박스 등)과 수리·사고는 정비가 아니다. 단 타이어는 차량작업으로 분류돼 있어도 정비로 본다.
  const hit = MAINTENANCE_MATCH.find((m) => m.rx.test(label));
  if (!hit) return e.category === '정기점검' ? 'regularCheck' : null;
  if (hit.key !== 'tire' && ['차량작업', '수리·사고'].includes(e.category)) return null;
  return hit.key;
};

// 차량작업비는 판매 수수료의 이 비율까지만 쓴다. 화면에 한도 금액은 보이지 않고 막대 색으로만 알린다
const VEHICLE_WORK_LIMIT_RATE = 0.5;

/**
 * 판매 수수료 입금 줄인지.
 *
 * 판매 수수료는 SC로 들어온다. 가끔 다른 통장으로 들어온 줄도 이름이 "판매 수수료"라 함께 센다.
 * B 통장의 승계·이전·추가 수수료는 차를 팔고 받은 돈이 아니라서 뺀다.
 */
const isSalesCommission = (e) => e.side === '입금' && e.category === '수수료'
  && ((e.bank || '').trim() === 'SC' || /판매/.test(e.label || ''));

const won = (n) => `${toCommaString(n)} 원`;

/** 고객 몫으로 낸 돈 건별: 낸 날 → 돌려받은 곳. 못 찾은 건은 빨갛게. 건수가 많아 접어 둔다 */
function RecoveryList({ matches }) {
  if (!matches.length) return null;
  const missing = matches.filter((m) => !m.via).length;
  return (
    <details style={{ margin: '0.2rem 0 0.3rem', padding: '0.3rem 0.45rem', background: 'var(--bg-main)', borderRadius: '6px', fontSize: '0.7rem', lineHeight: 1.55 }}>
      <summary style={{ cursor: 'pointer', fontWeight: '700', color: missing ? '#d9534f' : 'var(--text-muted)' }}>
        건별로 보기 · {matches.length}건 중 돌려받은 곳 못 찾음 {missing}건
      </summary>
      {matches.map((m) => (
        <div key={m.entry._id || `${m.entry.date}-${m.entry.amount}-${m.entry.label}`} style={{ color: m.via ? 'var(--text-muted)' : '#d9534f' }}>
          {String(m.entry.date).slice(0, 10)} {m.entry.label} {toCommaString(m.entry.amount)}
          {' → '}{m.via || '돌려받은 곳을 못 찾음'}
        </div>
      ))}
    </details>
  );
}

// 예산 대비 사용 막대. 80%를 넘으면 주황, 넘치면 빨강
// limit(%)을 주면 그 선을 기준으로 색을 정한다. 화면에 선은 드러내지 않고 색으로만 알린다.
function Meter({ used, budget, limit = 100 }) {
  if (!(budget > 0)) return null;
  const p = Math.round((used / budget) * 100);
  const color = p > limit ? '#d9534f' : (p >= limit * 0.8 ? '#e08a1e' : '#2f6f4e');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
      <div style={{ flex: 1, height: '6px', background: 'var(--bg-main)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(p, 100)}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: '0.74rem', fontWeight: '800', color, minWidth: '3.2rem', textAlign: 'right' }}>{p}% 사용</span>
    </div>
  );
}

function Row({ label, value, strong, muted, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: strong ? '0.82rem' : '0.78rem', fontWeight: strong ? '800' : '400', color: color || (muted ? 'var(--text-muted)' : 'inherit'), padding: '0.18rem 0' }}>
      <span>{label}</span><span style={{ whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

/**
 * 개별소비세 출금인지. 면세로 산 차의 조건이 깨져 나중에 낸 개별소비세는 차를 살 때 냈어야 할 돈이라 차량 구입가로 본다
 * (2026-10-05 대표님 결정). 원장에서는 '개별소비세 환급'(분류 환급)·'개별소비세 납부'·'개소세'(분류 제세공과) 등으로 적혀 있어
 * 분류가 아니라 이름으로 판정한다. 예전에는 '환급'으로 분류된 줄이 운영비(판관비)로 계산됐다.
 * 개별소비세와 함께 돌려내는 교육세도 같은 돈이다. '교육세' 줄은 분류가 자동차세로 잡혀 있어 이름으로 함께 본다(2026-10-28).
 */
const isExciseTax = (e) => e.side === '지출' && /개별\s*소비세|개소세|교육세/.test(e.label || '');

const bucketOf = (e) => {
  const cat = e.category || '기타';
  if (isExciseTax(e)) return 'purchase';
  if (cat === '보증금' || isCoopShare(e)) return 'deposit';
  if (cat === '할부금' || cat === '대출금') return 'loan';
  if (cat === '차량가' || cat === '계약금') return 'purchase';
  if (['등록비용', '제세공과'].includes(cat)) return 'registration';
  if (matchMaintenance(e)) return 'maintenance';
  if (cat === '수리·사고') return 'ownCar';
  if (['보험', '공제조합'].includes(cat) || isInsuranceRefundOut(e)) return 'insurance';
  if (cat === '할부이자') return 'finance';
  if (cat === '차량작업') return 'vehicleWork';
  return 'operating';
};

/**
 * 정비 항목별 견적 대 실제.
 * 견적은 "1회 단가 × 계약 기간 횟수"(단가표로 낸 견적) 또는 항목 금액(예전 견적)이다.
 * 실제는 원장 출금 줄 이름으로 항목을 맞춘 합계다. 계약 중간이면 실제가 적은 게 정상이라 '쓴 비율'로 본다.
 */
function MaintenanceByItem({ plan, actual }) {
  const lines = plan.maintenanceLines || [];
  if (!lines.length) return null;
  const rows = new Map();
  lines.forEach((l) => {
    const key = planKeyOf(l.key);
    const name = key === 'brake' ? '브레이크 패드·라이닝' : (key === 'tire' ? `타이어 (${plan.tireCount || l.times || 0}본)` : l.name);
    const r = rows.get(key) || { key, name, times: 0, plan: 0, unitText: [] };
    r.plan += l.cost || 0;
    if (l.times !== null && l.times !== undefined) {
      r.times += l.times;
      if (l.unitPrice !== null && l.unitPrice !== undefined) r.unitText.push(`${toCommaString(l.unitPrice)}×${l.times}${l.unit || '회'}`);
    }
    rows.set(key, r);
  });
  // 견적에 없는데 실제로 나간 정비 항목도 보여 준다
  Object.entries(actual.maintByKey || {}).forEach(([key]) => {
    if (!rows.has(key)) {
      const m = MAINTENANCE_MATCH.find((x) => x.key === key);
      rows.set(key, { key, name: m ? m.name : key, times: 0, plan: 0, unitText: [], notInQuote: true });
    }
  });

  const cell = { padding: '0.22rem 0.3rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.72rem' };
  return (
    <div style={{ marginTop: '0.6rem' }}>
      <div style={{ fontSize: '0.74rem', fontWeight: '800', marginBottom: '0.25rem' }}>
        항목별 견적 대 실제{plan.gradeLabel ? ` · 정비 단가표 ${plan.gradeLabel}` : ''}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th style={{ ...cell, textAlign: 'left' }}>항목</th>
            <th style={{ ...cell, textAlign: 'right' }}>견적</th>
            <th style={{ ...cell, textAlign: 'right' }}>실제</th>
            <th style={{ ...cell, textAlign: 'right' }}>쓴 비율</th>
          </tr>
        </thead>
        <tbody>
          {[...rows.values()].map((r) => {
            const used = actual.maintByKey?.[r.key] || { count: 0, amount: 0 };
            const p = r.plan > 0 ? Math.round((used.amount / r.plan) * 100) : null;
            const color = r.plan <= 0 ? (used.amount > 0 ? '#d9534f' : 'inherit') : (p > 100 ? '#d9534f' : (p >= 80 ? '#e08a1e' : '#2f6f4e'));
            return (
              <tr key={r.key}>
                <td style={cell} title={r.unitText.join(' + ')}>
                  {r.name}
                  {r.notInQuote && <span style={{ color: '#d9534f' }}> (견적에 없음)</span>}
                  {r.unitText.length > 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.66rem' }}>{r.unitText.join(' + ')}</div>}
                </td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{toCommaString(r.plan)}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{toCommaString(used.amount)}{used.count ? <span style={{ color: 'var(--text-muted)' }}> ({used.count}건)</span> : ''}</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: '800', color }}>{p === null ? (used.amount > 0 ? '초과' : '-') : `${p}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '0.25rem', lineHeight: 1.5 }}>
        실제는 원장 출금 이름으로 항목을 맞춘 값입니다(예: '정기점검비-카랑' → 정기점검·엔진오일). 계약 중간이면 쓴 비율이 낮은 것이 정상입니다.
      </div>
    </div>
  );
}

/**
 * 수익성 검토 한 장 (대표님 2026-10-29).
 *
 * 예전에는 기준표·예상 수익·예산 현황·1~4번 카드에 같은 숫자가 네 번씩 나오고, '남는 돈'이 칸마다 다른 전제로 여섯 가지가 나왔다.
 * 새로 온 직원이 어느 숫자를 믿어야 할지 몰라 표 하나로 합쳤다. 항목마다 견적(계약 때) · 지금까지 · 만기 예상 · 차이를 놓고,
 * 남는 돈은 영업이익(베네핏 수수료까지 뺀 돈)과 회사 몫(영업이익 + 베네핏 수수료) 둘만 쓴다.
 *
 * 만기 예상은 이렇게 본다.
 *   차량 구입: 실제(없으면 견적)
 *   보험료: 낸 속도로 남은 기간을 채운다. 1년이 지나기 전에는 1년치를 먼저 내 속도가 높게 나오므로 견적을 쓴다.
 *   자차(수리·사고비): 수리비는 자차보험료에서 나간다. 앞으로 수리가 없다고 보고 실제만 넣어, 남는 자차보험료가 이익이 된다.
 *   등록·정비·타이어·판관비: 견적과 실제 중 큰 값(정비 포함 고객에게는 약속한 정비를 다 해 준다)
 *   이자·베네핏 수수료: 견적 그대로. 이자는 원리금 균등상환 계약 기간 총 이자다(대표님 2026-10-28).
 *   자동차세는 판관비에서 나가는 돈이라 판관비 줄에 합친다(대표님 2026-10-28). 따로 두면 실제 자동차세가 두 번 잡힌다.
 * 견적 칸의 남는 돈은 저장된 기준표의 남는 금액과 같다. CMS 수수료·판매 수수료·차량작업비는 견적에 없는 돈이라 견적 칸이 0이다.
 * 줄을 누르면 그 항목의 원장 줄과 세부(정비 항목별, 판관비 분류별, 이자 계산)가 펼쳐진다.
 */
const PLAN_SOURCE_COLOR = (text = '') => {
  if (/견적서|원장/.test(text)) return { background: '#dcfce7', color: '#166534' };
  if (/기본|3%|추정/.test(text)) return { background: '#fef3c7', color: '#92400e' };
  return { background: '#e2e8f0', color: '#334155' };
};
// 표 줄 → 기준표 칸(값의 출처). 추정한 기준표만 칸마다 출처를 붙인다
const ROW_SOURCE_KEY = {
  revenue: 'revenue', purchase: 'netVehiclePrice', registration: 'registrationCost', insurance: 'baseInsurance', ownCar: 'ownCarInsurance',
  maintenance: 'maintenance', tire: 'maintenance', finance: 'interest', operating: 'pandanbi', benefitFee: 'benefitFee'
};

function EntryList({ list }) {
  if (!list?.length) return <div style={{ color: 'var(--text-muted)' }}>원장에 적힌 줄이 없습니다.</div>;
  return list.map((e, i) => (
    <div key={e._id || i} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', color: 'var(--text-muted)' }}>
      <span>{e.date ? String(e.date).slice(0, 10) : '날짜 없음'} · {e.label || e.category} <span style={{ fontSize: '0.66rem' }}>({e.category})</span></span>
      <span style={{ whiteSpace: 'nowrap' }}>{toCommaString(e.amount)}</span>
    </div>
  ));
}

function ProfitBoard({ plan, saved, source, sources, entries, actual, terms, periods, maturityPlan, onMaturityChange, benefitRate, canEdit, isAdmin, saving, onSave, closed }) {
  const [open, setOpen] = useState(null);
  const groups = useMemo(() => {
    const g = { purchase: [], registration: [], insurance: [], ownCar: [], maintenance: [], finance: [], operating: [], vehicleWork: [], loan: [], deposit: [] };
    entries.forEach((e) => {
      if (e.side !== '지출' || !(Number(e.amount) > 0)) return;
      g[bucketOf(e)].push(e);
    });
    Object.values(g).forEach((list) => list.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999'))));
    return g;
  }, [entries]);
  const n = (v) => Number(v) || 0;
  const sumOf = (list) => list.reduce((s, e) => s + n(e.amount), 0);
  const pctText = (r) => `${Number((r * 100).toFixed(2))}%`;

  // 매출. 월 렌트료·인수가·선납금은 원장 계약 조건(실제 계약)을 먼저 쓰고, 연장한 갑지는 구간마다 렌트료 × 기간을 더한다.
  // 차를 인수하는 건 마지막 구간이 끝날 때라 인수가는 마지막 구간 것만 넣는다. 보증금은 돌려줄 돈이라 넣지 않는다.
  const multi = (periods || []).length > 1;
  const singleRent = Number(terms?.monthlyRent) || plan.quoteMonthlyRent || 0;
  const rentLines = multi
    ? periods.map((p) => {
      const monthly = Number(p.monthlyRent) || 0;
      const months = Number(p.termMonths) || (p.seq === 1 ? plan.months : 0);
      return { key: p.seq, label: `${periodName(p.seq)} ${toCommaString(monthly)} × ${months}개월`, months, total: monthly * months };
    })
    : [{ key: 1, label: `월 렌트료 ${toCommaString(singleRent)} × ${plan.months}개월`, months: plan.months, total: singleRent * plan.months }];
  const last = multi ? periods[periods.length - 1] : null;
  const takeover = multi ? n(last.takeoverPrice) : Number(terms?.takeoverPrice) || plan.takeoverPrice || 0;
  const advance = multi ? periods.reduce((s, p) => s + n(p.advancePayment), 0) : Number(terms?.advancePayment) || plan.advancePayment || 0;
  const totalMonths = rentLines.reduce((s, l) => s + l.months, 0);
  const rentTotal = rentLines.reduce((s, l) => s + l.total, 0);
  const returned = maturityPlan === '반납';
  const revenueNow = rentTotal + (returned ? 0 : takeover) + advance;
  const cmsTotal = CMS_FEE * totalMonths;
  const elapsed = rentTotal > 0 ? Math.min(1, n(actual.rentReceived) / rentTotal) : 0;
  // 견적이 계약 전체보다 짧으면(연장한 차) 보험료를 연 보험료로 전체 기간만큼 채운다
  const scale = plan.months > 0 && totalMonths > plan.months ? totalMonths / plan.months : 1;

  // 보험료 = 보험 + 공제조합 보험료 − 보험료 환급(입금)
  const insuranceRefund = entries.filter(isInsuranceRefund).reduce((s, e) => s + n(e.amount), 0);
  const premiumPaid = sumOf(groups.insurance) - insuranceRefund;
  const yearShare = totalMonths > 0 ? Math.min(1, 12 / totalMonths) : 1;
  const premiumProjected = elapsed >= yearShare && elapsed > 0 ? premiumPaid / elapsed : Math.max(premiumPaid, n(plan.baseInsurance) * scale);
  const baseInsuranceYear = plan.months > 0 ? (n(plan.baseInsurance) * 12) / plan.months : 0;
  const contractYears = Math.max(totalMonths, plan.months) / 12;
  const monthsSincePremium = actual.firstPremiumDate
    ? (new Date().getFullYear() - Number(actual.firstPremiumDate.slice(0, 4))) * 12 + (new Date().getMonth() + 1 - Number(actual.firstPremiumDate.slice(5, 7)))
    : 0;
  // 보험은 1년치를 먼저 내므로 시작한 해도 1년으로 센다
  const premiumYears = actual.firstPremiumDate ? Math.min(Math.max(1, Math.floor(monthsSincePremium / 12) + 1), Math.ceil(contractYears)) : 0;
  const premiumPerYear = premiumYears ? premiumPaid / premiumYears : 0;

  const repair = sumOf(groups.ownCar);
  const tireList = groups.maintenance.filter((e) => matchMaintenance(e) === 'tire');
  const maintList = groups.maintenance.filter((e) => matchMaintenance(e) !== 'tire');
  const tireUsed = sumOf(tireList);
  const maintUsed = sumOf(maintList);
  // 정비 미포함 고객의 정비비는 고객 몫이다. 돌려받은 것은 회사 비용이 아니다(matchRecoveries)
  const maintUnrecovered = sumOf(groups.maintenance) - n(actual.maintRecovered);
  // 과태료·통행료는 고객 몫이라 돌려받은 만큼 판관비에서 뺀다
  const finesLeft = n(actual.finesPaid) - n(actual.finesRecovered);
  const operatingUsed = sumOf(groups.operating) - n(actual.finesRecovered);
  const operatingByCat = Object.entries(groups.operating.reduce((m, e) => ({ ...m, [e.category || '기타']: (m[e.category || '기타'] || 0) + n(e.amount) }), {}))
    .sort((a, b) => b[1] - a[1]);
  const purchaseUsed = sumOf(groups.purchase);
  const vehicleWork = sumOf(groups.vehicleWork);
  const salesCommission = n(actual.salesCommission);

  const interestTotal = planInterestTotal(plan);
  const maintenancePlan = plan.maintenanceOn ? n(plan.maintenanceFee) + n(plan.tireFee) : 0;
  const listed = n(plan.netVehiclePrice) + n(plan.registrationCost) + n(plan.baseInsurance) + n(plan.ownCarInsurance)
    + n(plan.carTaxTotal) + interestTotal + n(plan.pandanbi) + maintenancePlan;
  // 딜러 수수료·고잔가 수수료 등 위 줄에 없는 견적 비용
  const others = n(plan.costExCommission) - listed;
  const operatingPlan = n(plan.pandanbi) + n(plan.carTaxTotal);
  const carPriceBase = benefitRate > 0 ? n(plan.benefitFee) / benefitRate : 0;
  const ownLoan = hasOwnLoan(entries);

  const income = [
    {
      key: 'revenue', name: '매출',
      desc: `렌트료${takeover ? ` + 인수가${returned ? '(반납이라 뺌)' : ''}` : ''}${advance ? ' + 선납금' : ''}`,
      plan: planRevenue(plan), used: n(actual.rentReceived), projected: revenueNow,
      detail: (
        <>
          {rentLines.map((l) => <Row key={l.key} label={l.label} value={won(l.total)} muted />)}
          <Row label={returned ? '인수가 (반납이라 매출에서 뺌)' : '인수가'} value={won(returned ? 0 : takeover)} muted />
          {advance > 0 && <Row label="선납금" value={won(advance)} muted />}
          <Row label="지금까지 받은 렌트료" value={`${won(actual.rentReceived)} / ${won(rentTotal)}`} />
          <Meter used={n(actual.rentReceived)} budget={rentTotal} />
          {plan.quoteMonthlyRent > 0 && !multi && Math.round(plan.quoteMonthlyRent) !== Math.round(singleRent) && (
            <Row label="견적서 월 렌트료 (계약과 다름)" value={won(plan.quoteMonthlyRent)} muted />
          )}
        </>
      )
    },
    ...(salesCommission > 0 ? [{
      key: 'salesCommission', name: '판매 수수료', desc: '차를 팔고 SC로 받은 수수료. 견적에 없는 돈',
      plan: 0, used: salesCommission, projected: salesCommission
    }] : [])
  ];

  const costs = [
    {
      key: 'purchase', name: '차량 구입', desc: '차량가 + 옵션 − 할인 + 탁송료',
      plan: n(plan.netVehiclePrice), used: purchaseUsed, projected: purchaseUsed || n(plan.netVehiclePrice), list: groups.purchase,
      detail: (
        <div style={{ marginBottom: '0.3rem' }}>
          실제 = 원장 차량가 {won(actual.vehiclePrice)} + 계약금 {won(actual.vehicleDeposit)}
          {actual.vehicleExcise ? ` + 나중에 낸 개별소비세·교육세 ${won(actual.vehicleExcise)}` : ''} (대출로 낸 금액 포함)
        </div>
      )
    },
    {
      key: 'registration', name: '등록·취득세', desc: '취득세·공채·등록대행료',
      plan: n(plan.registrationCost), used: sumOf(groups.registration), projected: Math.max(sumOf(groups.registration), n(plan.registrationCost)), list: groups.registration
    },
    {
      key: 'insurance', name: '보험료', desc: '대인·대물 등 기본 보험료 (공제조합 포함)',
      plan: n(plan.baseInsurance), used: premiumPaid, projected: premiumProjected, list: groups.insurance,
      detail: (
        <div style={{ marginBottom: '0.3rem' }}>
          <Row label="견적 1년 보험료" value={won(Math.round(baseInsuranceYear))} muted />
          <Row label={`실제 1년 평균${premiumYears ? ` (${premiumYears}년치)` : ''}`} value={won(Math.round(premiumPerYear))} />
          {insuranceRefund > 0 && <Row label="· 보험료 환급 (빼고 계산)" value={`- ${won(insuranceRefund)}`} muted />}
          {actual.coopShare > 0 && <Row label="· 공제조합 출자금 (돌려받을 돈이라 보험료에서 뺌)" value={won(actual.coopShare)} muted />}
        </div>
      )
    },
    {
      key: 'ownCar', name: '자차 (수리·사고비)', desc: '수리비는 자차보험료에서 나간다. 앞으로 수리가 없다고 보고 남는 만큼 이익',
      plan: n(plan.ownCarInsurance), used: repair, projected: repair, list: groups.ownCar
    },
    ...(plan.maintenanceOn ? [
      {
        key: 'maintenance', name: '정비', desc: `정비 단가표 항목${plan.gradeLabel ? ` · ${plan.gradeLabel}` : ''}`,
        plan: n(plan.maintenanceFee), used: maintUsed, projected: Math.max(maintUsed, n(plan.maintenanceFee)), list: maintList,
        detail: <MaintenanceByItem plan={plan} actual={actual} />
      },
      {
        key: 'tire', name: '타이어', desc: `${plan.tireCount ? `${plan.tireCount}본 · ` : ''}얼라이먼트 포함`,
        plan: n(plan.tireFee), used: tireUsed, projected: Math.max(tireUsed, n(plan.tireFee)), list: tireList
      }
    ] : (groups.maintenance.length ? [{
      key: 'maintenance', name: '정비 (고객 몫)', desc: '정비 미포함 고객. 회사가 낸 정비비 중 못 돌려받은 것',
      plan: 0, used: maintUnrecovered, projected: maintUnrecovered,
      detail: <RecoveryList matches={actual.maintMatches || []} />
    }] : [])),
    {
      key: 'finance', name: '이자',
      desc: `${plan.fundingRepaymentMode === 'balloon' ? '만기 인수가 상환' : '원리금 균등상환'} 계약 기간 총 이자${n(plan.interestRate) ? ` · 연 ${(n(plan.interestRate) * 100).toFixed(2)}%` : ''}`,
      plan: interestTotal, used: sumOf(groups.finance), projected: interestTotal, list: groups.finance,
      detail: (
        <div style={{ marginBottom: '0.3rem' }}>
          {plan.fundingPrincipal > 0 && (
            <Row label={`조달원금 ${toCommaString(Math.round(plan.fundingPrincipal))} × 연 ${(n(plan.interestRate) * 100).toFixed(2)}% × ${plan.months}개월`} value={won(Math.round(n(plan.grossFundingInterest)))} muted />
          )}
          {plan.depositInterestBenefit > 0 && <Row label="− 보증금 이자 이득 (보증금 × 금리 × 기간)" value={`- ${won(Math.round(plan.depositInterestBenefit))}`} muted />}
          {plan.advancePaymentInterest > 0 && <Row label="+ 선수금분 이자" value={won(Math.round(plan.advancePaymentInterest))} muted />}
          <div>
            지금까지 칸: {ownLoan ? '캐피탈·할부로 산 차라 원장 할부이자' : groups.finance.length ? '담보대출로 산 차라 엑셀 갑지 이자 줄' : '갑지에 이자 줄이 없습니다'}
          </div>
        </div>
      )
    },
    {
      key: 'operating', name: '판관비', desc: `자동차세·검사비·탁송료·못 받은 과태료 등${carPriceBase > 0 && plan.pandanbi ? ` · 차량가 ${pctText(n(plan.pandanbi) / carPriceBase)}` : ''}`,
      plan: operatingPlan, used: operatingUsed, projected: Math.max(operatingUsed, operatingPlan), list: groups.operating,
      detail: (
        <div style={{ marginBottom: '0.3rem' }}>
          {n(plan.carTaxTotal) > 0 && <Row label="견적 = 판관비 + 계약 기간 자동차세" value={`${toCommaString(Math.round(n(plan.pandanbi)))} + ${toCommaString(Math.round(n(plan.carTaxTotal)))}`} muted />}
          {operatingByCat.map(([cat, sum]) => <Row key={cat} label={`· ${cat}`} value={won(sum)} muted />)}
          {actual.finesPaid > 0 && (
            <>
              <Row label="− 과태료·통행료 돌려받음 (상계·고객 입금·렌트료·청구서)" value={`- ${won(actual.finesRecovered)}`} muted />
              <RecoveryList matches={actual.fineMatches || []} />
            </>
          )}
        </div>
      )
    },
    ...(Math.abs(others) >= 1000 ? [{ key: 'others', name: '기타 견적 비용', desc: '딜러 수수료 등', plan: others, used: null, projected: others }] : []),
    ...(vehicleWork > 0 ? [{
      key: 'vehicleWork', name: '차량작업', desc: '썬팅·PPF·블랙박스 등. 판매 수수료로 충당',
      plan: 0, used: vehicleWork, projected: vehicleWork, list: groups.vehicleWork
    }] : []),
    { key: 'cms', name: 'CMS 자동이체 수수료', desc: `${CMS_FEE}원 × ${totalMonths}회. 견적에 없는 돈`, plan: 0, used: null, projected: cmsTotal },
    {
      key: 'benefitFee', name: '베네핏 수수료', desc: `회사 몫 · 차량가 × ${benefitRate !== null && benefitRate !== undefined ? pctText(benefitRate) : '견적 수수료율'}`,
      plan: n(plan.benefitFee), used: null, projected: n(plan.benefitFee)
    }
  ];

  const total = (rows, k) => rows.reduce((s, r) => s + n(r[k]), 0);
  const planProfit = total(income, 'plan') - total(costs, 'plan');
  const projProfit = total(income, 'projected') - total(costs, 'projected');
  const benefitFee = n(plan.benefitFee);
  const diffOf = (r, isIncome) => (isIncome ? r.projected - r.plan : r.plan - r.projected);
  const reasons = [...income.map((r) => ({ r, d: diffOf(r, true) })), ...costs.map((r) => ({ r, d: diffOf(r, false) }))]
    .filter((x) => Math.abs(x.d) >= 1000)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 3);

  // 만기에 반납받으면 인수가 대신 차를 중고로 팔아 계약 때 예상한 남는 돈을 채워야 한다
  const beforeSale = projProfit - (returned ? 0 : takeover);
  const targetSalePrice = planProfit - beforeSale;

  const warnings = [];
  const warn = (text, tone = 'warn') => warnings.push({ text, tone });
  if (closed) warn('거래완료된 차입니다. 실제 결과는 위 정산계이고, 이 표는 계약 기준으로 본 참고용입니다(이자 추정·남은 회차 포함).', 'info');
  if (purchaseUsed > 0 && n(plan.netVehiclePrice) - purchaseUsed >= 10000) {
    warn(`차를 견적보다 ${won(n(plan.netVehiclePrice) - purchaseUsed)} 적게 주고 샀습니다. 할인을 받았거나 면세로 산 차입니다. 면세라면 조건이 깨질 때 개별소비세를 다시 내야 할 수 있으니 면세 조건을 확인하세요.${actual.vehicleDeposit === 0 ? ' 원장에 계약금 출금이 없습니다. 계약금을 빠뜨리지 않았는지도 확인하세요.' : ''}`);
  }
  if (baseInsuranceYear > 0 && premiumPerYear > baseInsuranceYear) {
    warn(`보험료가 견적보다 많이 나갑니다. 1년 평균 ${won(Math.round(premiumPerYear))} / 견적 ${won(Math.round(baseInsuranceYear))} (${Math.round((premiumPerYear / baseInsuranceYear) * 100)}%)`);
  }
  if (repair > n(plan.ownCarInsurance) * scale) warn(`수리·사고비 ${won(repair)}가 자차보험료 ${won(Math.round(n(plan.ownCarInsurance) * scale))}를 넘었습니다.`);
  costs.filter((r) => ['maintenance', 'tire', 'operating'].includes(r.key) && r.plan > 0 && r.used > r.plan)
    .forEach((r) => warn(`${r.name}가 견적을 넘었습니다. 견적 ${won(Math.round(r.plan))}, 지금까지 ${won(Math.round(r.used))}`));
  if (!plan.maintenanceOn && maintUnrecovered > 0) warn(`정비 미포함 고객인데 회사가 낸 정비비 ${won(maintUnrecovered)}를 아직 못 돌려받았습니다. 렌트료에 얹어 받거나 고객 입금을 받으세요.`);
  if (finesLeft > 0) warn(`과태료·통행료 ${won(finesLeft)}를 아직 고객에게서 못 돌려받았습니다(판관비에 들어가 있습니다).`);
  if (salesCommission > 0 && vehicleWork > salesCommission * VEHICLE_WORK_LIMIT_RATE) warn(`차량작업비가 판매 수수료의 ${Math.round((vehicleWork / salesCommission) * 100)}%입니다.`);
  if (multi) warn('견적 칸은 최초 계약 기준입니다. 만기 예상에는 연장 구간의 렌트료와 보험료를 넣었습니다.', 'info');
  warn(returned
    ? `만기 반납: 중고차로 최소 ${won(targetSalePrice)}은 받아야 계약 때 예상한 남는 돈을 채웁니다(계약 인수가 ${won(takeover)}). 보증금은 돌려주는 돈이라 넣지 않았습니다.`
    : `만기에 반납받으면 중고차로 ${won(targetSalePrice)} 이상 받아야 계약 때 예상한 남는 돈을 채웁니다.`, 'info');

  const cell = { padding: '0.32rem 0.45rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.76rem', verticalAlign: 'top' };
  const num = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };
  const signed = (v) => (Math.abs(v) < 1 ? '' : `${v > 0 ? '+' : '-'} ${toCommaString(Math.round(Math.abs(v)))}`);
  const colorOf = (v) => (Math.abs(v) < 1 ? 'inherit' : v > 0 ? '#2f6f4e' : '#d9534f');
  const history = saved?.history || [];

  const renderRow = (r, isIncome) => {
    const expandable = Boolean(r.detail || r.list?.length);
    const expanded = open === r.key;
    const d = diffOf(r, isIncome);
    const tagText = source !== '견적서' ? sources?.[ROW_SOURCE_KEY[r.key]] : null;
    return (
      <React.Fragment key={r.key}>
        <tr style={{ cursor: expandable ? 'pointer' : 'default' }} onClick={() => expandable && setOpen(expanded ? null : r.key)}>
          <td style={cell}>
            <b>{expandable ? (expanded ? '▾ ' : '▸ ') : '· '}{r.name}</b>
            {tagText && <span style={{ ...PLAN_SOURCE_COLOR(tagText), fontSize: '0.62rem', padding: '0 0.3rem', borderRadius: '4px', marginLeft: '0.3rem', whiteSpace: 'nowrap' }}>{tagText}</span>}
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{r.desc}</div>
          </td>
          <td style={num}>{r.plan ? toCommaString(Math.round(r.plan)) : '-'}</td>
          <td style={{ ...num, color: 'var(--text-muted)' }}>{r.used === null || r.used === undefined ? '-' : toCommaString(Math.round(r.used))}</td>
          <td style={{ ...num, fontWeight: '700' }}>{toCommaString(Math.round(r.projected))}</td>
          <td style={{ ...num, fontWeight: '800', color: colorOf(d) }}>{signed(d)}</td>
        </tr>
        {expanded && (
          <tr>
            <td colSpan={5} style={{ ...cell, background: '#fafbfd', paddingLeft: '1.4rem', fontSize: '0.72rem', lineHeight: 1.55 }}>
              {r.detail}
              {r.list && <EntryList list={r.list} />}
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };
  const groupRow = (label) => (
    <tr><td colSpan={5} style={{ ...cell, background: 'var(--bg-main)', fontWeight: '800', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</td></tr>
  );

  return (
    <div style={{ display: 'grid', gap: '0.8rem' }}>
      {/* 머리: 기준표 출처·저장 상태, 만기 처리 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: '800' }}>
          최초 계약 {plan.months}개월
          <span style={{ ...PLAN_SOURCE_COLOR(source), fontSize: '0.68rem', padding: '0.05rem 0.4rem', borderRadius: '4px', marginLeft: '0.4rem' }}>
            {source === '견적서' ? '견적서 기준' : '추정 (견적서 없음)'}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {saved ? `기준 저장됨 · ${String(saved.savedAt || '').slice(0, 10)} ${saved.savedBy || ''}` : '기준 저장 전 · 지금 값으로 계산'}
          {canEdit && (!saved || isAdmin) && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.74rem', fontWeight: '700', border: '1px solid #4a6fa5', borderRadius: '6px', background: saved ? '#fff' : '#4a6fa5', color: saved ? '#4a6fa5' : '#fff', cursor: 'pointer' }}
              title={saved ? '관리자만: 지금 값으로 다시 계산해 기준을 바꿉니다. 바꾸기 전 값은 기록에 남습니다.' : '지금 값을 이 차의 계약 기준으로 저장합니다. 저장하면 렌트차량 DB를 고쳐도 견적 칸이 바뀌지 않습니다.'}
            >
              {saving ? '저장 중…' : (saved ? '다시 계산' : '기준으로 저장')}
            </button>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            만기 처리
            <select
              value={maturityPlan || '미정'}
              onChange={(e) => onMaturityChange(e.target.value)}
              disabled={!canEdit}
              title="미정이면 인수로 보고 계산합니다"
              style={{ padding: '0.2rem 0.4rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.76rem', background: '#fff' }}
            >
              {['미정', '인수', '반납'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </span>
      </div>

      {/* ① 결론 */}
      <div style={{ border: '2px solid #2f6f4e', background: '#f3faf6', borderRadius: '8px', padding: '0.7rem 0.8rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.5rem' }}>
          {[
            ['계약 때 예상 남는 돈', planProfit, `회사 몫 ${toCommaString(Math.round(planProfit + benefitFee))}`],
            ['지금 예상 남는 돈', projProfit, `회사 몫 ${toCommaString(Math.round(projProfit + benefitFee))}`],
            ['차이', projProfit - planProfit, projProfit >= planProfit ? '계약 때보다 더 남음' : '계약 때보다 덜 남음']
          ].map(([label, value, note], i) => (
            <div key={label}>
              <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)' }}>{label}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: '800', color: i === 2 ? colorOf(value) : (value < 0 ? '#d9534f' : '#2f6f4e') }}>
                {i === 2 ? signed(value) || '0' : toCommaString(Math.round(value))} 원
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{note}</div>
            </div>
          ))}
        </div>
        {reasons.length > 0 && (
          <div style={{ fontSize: '0.74rem', marginTop: '0.45rem' }}>
            <b>차이가 큰 항목</b>{' '}
            {reasons.map(({ r, d }, i) => (
              <span key={r.key}>{i > 0 && ' · '}{r.name} <b style={{ color: colorOf(d) }}>{signed(d)}</b></span>
            ))}
          </div>
        )}
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
          남는 돈 = 영업이익(베네핏 수수료까지 뺀 돈). 회사 몫 = 영업이익 + 베네핏 수수료.
        </div>
      </div>

      {/* ② 항목표 */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '560px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th style={{ ...cell, textAlign: 'left' }}>항목</th>
              <th style={{ ...num, width: '15%' }}>견적 (계약 때)</th>
              <th style={{ ...num, width: '15%' }}>지금까지</th>
              <th style={{ ...num, width: '15%' }}>만기 예상</th>
              <th style={{ ...num, width: '13%' }}>차이</th>
            </tr>
          </thead>
          <tbody>
            {groupRow('들어오는 돈')}
            {income.map((r) => renderRow(r, true))}
            {groupRow('나가는 돈')}
            {costs.map((r) => renderRow(r, false))}
            <tr style={{ background: '#f3faf6' }}>
              <td style={{ ...cell, fontWeight: '800' }}>남는 돈 (영업이익)</td>
              <td style={{ ...num, fontWeight: '800', color: planProfit < 0 ? '#d9534f' : '#2f6f4e' }}>{toCommaString(Math.round(planProfit))}</td>
              <td style={num} />
              <td style={{ ...num, fontWeight: '800', color: projProfit < 0 ? '#d9534f' : '#2f6f4e' }}>{toCommaString(Math.round(projProfit))}</td>
              <td style={{ ...num, fontWeight: '800', color: colorOf(projProfit - planProfit) }}>{signed(projProfit - planProfit)}</td>
            </tr>
            <tr>
              <td style={{ ...cell, color: 'var(--text-muted)' }}>회사 몫 (영업이익 + 베네핏 수수료)</td>
              <td style={{ ...num, color: 'var(--text-muted)' }}>{toCommaString(Math.round(planProfit + benefitFee))}</td>
              <td style={num} />
              <td style={{ ...num, color: 'var(--text-muted)' }}>{toCommaString(Math.round(projProfit + benefitFee))}</td>
              <td style={num} />
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '0.35rem', lineHeight: 1.55 }}>
          만기 예상: 차량 구입은 실제, 보험료는 낸 속도로 채움, 수리비는 더 안 생긴다고 봄, 등록·정비·타이어·판관비는 견적과 실제 중 큰 값, 이자·베네핏 수수료는 견적 그대로.
          차이는 +면 견적보다 남는 돈이 늘어난 것입니다. 줄을 누르면 원장 줄과 세부가 펼쳐집니다(지난 기간 {Math.round(elapsed * 100)}%, 받은 렌트료 기준).
        </div>
      </div>

      {/* ③ 확인할 것 */}
      {warnings.length > 0 && (
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          {warnings.map((w, i) => (
            <div
              key={i}
              style={{
                fontSize: '0.74rem', lineHeight: 1.55, padding: '0.4rem 0.55rem', borderRadius: '6px',
                ...(w.tone === 'warn' ? { border: '1px solid #f0c36d', background: '#fff8e6' } : { border: '1px solid #c9d6ea', background: '#f7f9fd' })
              }}
            >
              {w.tone === 'warn' ? '⚠ ' : 'ⓘ '}{w.text}
            </div>
          ))}
        </div>
      )}

      {(saved?.assumptions?.length > 0 || saved?.ledgerNotes?.length > 0 || history.length > 0) && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {saved?.assumptions?.length > 0 && <div>{saved.note ? `${saved.note} ` : ''}가정한 값: {saved.assumptions.join(' · ')}</div>}
          {saved?.ledgerNotes?.length > 0 && <div style={{ color: '#b45309' }}>원장 값을 쓴 칸: {saved.ledgerNotes.join(' · ')}</div>}
          {history.length > 0 && (
            <details style={{ marginTop: '0.25rem' }}>
              <summary style={{ cursor: 'pointer' }}>기준을 바꾼 기록 {history.length}건</summary>
              {history.map((h, i) => (
                <div key={i}>
                  {String(h.replacedAt || '').slice(0, 10)} {h.replacedBy} 다시 계산 · 이전 남는 금액 {toCommaString(h.operatingProfit)}원 ({h.source}, {String(h.savedAt || '').slice(0, 10)} 저장){h.reason ? ` · 이유: ${h.reason}` : ''}
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 수익성 검토.
 *
 * 견적서에서 잡아 둔 비용(보험·자차·판관비·베네핏 수수료·정비)과 원장에 실제로 쌓인 출금을 나란히 놓는다.
 * 견적이 맞았는지, 어디서 새고 있는지를 차 한 대 단위로 보려는 칸이다.
 * 계약 구간을 골라 봐도 이 칸은 차 1대 전체 기준이다. 견적이 차 1대 전체 기간을 놓고 계산한 값이기 때문이다.
 */
function ProfitReview({ ledgerId, entries, terms, periods, rentBySeq, billingRounds, memo, maturityPlan, canEdit, isAdmin, showToast, onMemoChange, onMaturityChange, closed = false }) {
  const [state, setState] = useState({ loading: true, quote: null, estimate: null, reason: '', savedPlan: null });
  const [planSaving, setPlanSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${API_HOST}/api/ledgers/${ledgerId}/quote`)
      .then((res) => (res.ok ? res.json() : { quote: null, reason: '견적서를 불러오지 못했습니다.' }))
      .then((data) => { if (alive) setState({ loading: false, quote: data.quote, estimate: data.estimate || null, reason: data.reason || '', savedPlan: data.savedPlan || null }); })
      .catch(() => { if (alive) setState({ loading: false, quote: null, estimate: null, reason: '견적서를 불러오지 못했습니다.', savedPlan: null }); });
    return () => { alive = false; };
  }, [ledgerId]);

  /**
   * 견적 비용은 저장된 '계약 손익 기준표'를 먼저 쓴다. 없으면 견적서로, 견적서도 없으면 서버가 원장·렌트차량 DB 값으로
   * 같은 식을 돌려 준 추정치(estimate)로 비교한다. 저장해 두면 렌트차량 DB를 고쳐도 기준이 바뀌지 않는다.
   */
  const quotePlan = useMemo(() => quotePlanOf(state.quote), [state.quote]);
  const livePlan = quotePlan || state.estimate;
  const plan = state.savedPlan?.values || livePlan;

  const saveProfitPlan = async () => {
    let reason = '';
    if (state.savedPlan) {
      reason = window.prompt('저장된 기준표를 지금 값으로 다시 계산합니다. 바꾸는 이유를 적어 주세요(예: 견적서 연결, 렌트차량 DB 수정).', '');
      if (reason === null) return;
    }
    setPlanSaving(true);
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/${ledgerId}/profit-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setState((prev) => ({ ...prev, savedPlan: data.savedPlan }));
      showToast?.(`계약 손익 기준표를 ${state.savedPlan ? '다시 계산해' : ''} 저장했습니다. 남는 금액 ${toCommaString(data.savedPlan.operatingProfit)}원`, 'success');
    } catch (err) {
      showToast?.(err.message || '기준표를 저장하지 못했습니다.', 'error');
    } finally {
      setPlanSaving(false);
    }
  };

  const actual = useMemo(() => {
    const out = {
      insurance: 0, insuranceRefund: 0, firstPremiumDate: '', coopShare: 0,
      repair: 0, maintenance: 0, tire: 0, operating: 0, operatingByCat: {}, rentReceived: 0, salesCommission: 0, vehicleWork: 0, fines: 0,
      // 정비 항목별 실제 지출(건수·금액)과 차 구입·등록·금융·세금 실제 출금
      maintByKey: {}, vehiclePurchase: 0, vehiclePrice: 0, vehicleDeposit: 0, vehicleExcise: 0, registration: 0, loanInterest: 0, loanRepayment: 0, carTax: 0
    };
    entries.forEach((e) => {
      const amount = Number(e.amount) || 0;
      if (!amount) return;
      if (e.side === '입금') {
        if (rentRoundOf(e) || e.category === '렌트료') out.rentReceived += amount;
        else if (isSalesCommission(e)) out.salesCommission += amount;
        else if (isInsuranceRefund(e)) out.insuranceRefund += amount;
        return;
      }
      const cat = e.category || '기타';
      // 나중에 낸 개별소비세는 차량가에 들어갔어야 할 돈이다. 운영비·등록세금으로 세지 않고 차량 구입에 넣는다.
      if (isExciseTax(e)) { out.vehiclePurchase += amount; out.vehicleExcise += amount; return; }
      // 차를 산 돈 = 차량가 출금 + 계약금 출금. 계약금을 먼저 내고 나머지를 차량가로 내기 때문이다.
      if (cat === '차량가') { out.vehiclePurchase += amount; out.vehiclePrice += amount; }
      if (cat === '계약금') { out.vehiclePurchase += amount; out.vehicleDeposit += amount; }
      if (cat === '등록비용' || cat === '제세공과') out.registration += amount;
      if (cat === '할부이자') out.loanInterest += amount;
      if (cat === '할부금') out.loanRepayment += amount;
      if (cat === '자동차세') out.carTax += amount;
      const maintKey = matchMaintenance(e);
      if (maintKey) {
        const slot = out.maintByKey[maintKey] || (out.maintByKey[maintKey] = { count: 0, amount: 0 });
        slot.count += 1;
        slot.amount += amount;
        if (maintKey === 'tire') out.tire += amount;
        else out.maintenance += amount;
        return;
      }
      if (cat === '과태료·통행료') out.fines += amount;
      else if (cat === '차량작업') out.vehicleWork += amount;
      // 공제조합 보험료는 보험이다(예전에는 판관비로 잡혀 '판관비 초과'가 떴다, Benz-003). 출자금은 돌려받을 돈이라 따로 둔다
      else if (isCoopShare(e)) out.coopShare += amount;
      else if (isInsurancePremium(e)) {
        out.insurance += amount;
        const d = String(e.date || '').slice(0, 10);
        if (amount > 0 && d && (!out.firstPremiumDate || d < out.firstPremiumDate)) out.firstPremiumDate = d;
      }
      else if (cat === '수리·사고') out.repair += amount;
      else if (cat === '정기점검') out.maintenance += amount;
      else if (!NOT_OPERATING.has(cat)) {
        out.operating += amount;
        out.operatingByCat[cat] = (out.operatingByCat[cat] || 0) + amount;
      }
    });

    /**
     * 과태료·미납통행료(언제나)와 정비비(정비 미포함 고객)는 고객 몫이다. 한 건씩 돌려받은 곳을 맞추고(matchRecoveries)
     * 돌려받은 것은 회사 비용이 아니다. 못 받은 것만 비용으로 남긴다(과태료는 운영비, 정비는 정비 초과).
     */
    const maintenanceOn = Boolean(plan?.maintenanceOn);
    const matches = matchRecoveries(entries, rentBySeq, billingRounds, { maintenance: !maintenanceOn });
    const sumOf = (list, f) => list.reduce((s, m) => s + f(m), 0);
    out.fineMatches = matches.filter((m) => m.kind === 'fine');
    out.finesPaid = sumOf(out.fineMatches, (m) => Number(m.entry.amount));
    out.finesRecovered = sumOf(out.fineMatches, (m) => m.got);
    out.maintMatches = matches.filter((m) => m.kind === 'maint');
    out.maintPaid = sumOf(out.maintMatches, (m) => Number(m.entry.amount));
    out.maintRecovered = sumOf(out.maintMatches, (m) => m.got);
    out.maintUnrecovered = out.maintPaid - out.maintRecovered;
    const finesLeft = out.finesPaid - out.finesRecovered;
    if (finesLeft > 0) {
      out.operating += finesLeft;
      out.operatingByCat['과태료·통행료 (미회수)'] = finesLeft;
    }
    out.insuranceNet = out.insurance - out.insuranceRefund;
    return out;
  }, [entries, rentBySeq, billingRounds, plan?.maintenanceOn]);

  let body;
  if (state.loading) {
    body = <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>견적서를 찾는 중…</div>;
  } else if (!plan) {
    body = (
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        {state.quote
          ? '이 견적서는 계산에 쓰는 입력값이 저장되기 전에 만든 것이라 견적 비용을 다시 계산할 수 없습니다. 견적 화면에서 한 번 불러와 저장하면 볼 수 있습니다.'
          : `${state.reason || '연결된 견적서가 없습니다.'} 차량을 연결하면 렌트차량 DB 값으로 추정해 보여 줍니다.`}
      </div>
    );
  } else {
    body = (
      <ProfitBoard
        plan={plan}
        saved={state.savedPlan}
        source={state.savedPlan?.source || (quotePlan ? '견적서' : '추정')}
        sources={state.savedPlan?.sources || (quotePlan ? null : state.estimate?.sources) || {}}
        entries={entries}
        actual={actual}
        terms={terms}
        periods={periods}
        maturityPlan={maturityPlan}
        onMaturityChange={onMaturityChange}
        benefitRate={plan.benefitRate ?? quotePlan?.benefitRate ?? (state.savedPlan?.source === '견적서' ? null : 0.03)}
        canEdit={canEdit}
        isAdmin={isAdmin}
        saving={planSaving}
        onSave={saveProfitPlan}
        closed={closed}
      />
    );
  }

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '0.7rem 0.9rem', borderBottom: '2px solid #4a6fa5', background: 'var(--bg-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: '800', fontSize: '0.85rem', color: '#4a6fa5' }}>수익성 검토</span>
        {quotePlan && (
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            견적서 기준 · {state.quote.vehicleModel} · {quotePlan.months}개월 안 · {toDateInput(state.quote.createdAt)} 작성
          </span>
        )}
        {!quotePlan && state.estimate && (
          <span style={{ fontSize: '0.74rem', fontWeight: '700', color: '#e08a1e' }}>
            견적서 없음 · 렌트차량 DB 기준 추정 · {state.estimate.vehicleLabel} · {state.estimate.months}개월
          </span>
        )}
      </div>
      <div style={{ padding: '0.8rem 0.9rem' }}>
        {body}
        {!quotePlan && state.estimate && !state.savedPlan && (
          <div style={{ marginTop: '0.7rem', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {state.reason} 그래서 렌트차량 DB 값에 견적서 계산식을 돌린 추정치입니다. 월 렌트료·선납금·보증금·인수가는 원장 계약 조건을 먼저 씁니다. 가정한 값: {state.estimate.assumptions.join(' · ')}
            {state.estimate.ledgerNotes?.length > 0 && (
              <div style={{ marginTop: '0.3rem', color: '#b45309' }}>
                렌트차량 DB가 원장과 달라 원장 값을 썼습니다(렌트차량 DB를 맞춰 주세요): {state.estimate.ledgerNotes.join(' · ')}
              </div>
            )}
          </div>
        )}
      </div>
      <textarea
        value={memo || ''}
        onChange={(e) => onMemoChange(e.target.value)}
        readOnly={!canEdit}
        placeholder="검토 의견을 적어 주세요. 저장(Ctrl+S)하면 함께 저장됩니다."
        rows={3}
        style={{ display: 'block', width: '100%', boxSizing: 'border-box', border: 'none', borderTop: '1px solid var(--border-color)', padding: '0.8rem 0.9rem', fontSize: '0.82rem', lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', outline: 'none' }}
      />
    </div>
  );
}

/**
 * 차량 손익 원장 (갑지).
 *
 * 목록에서 차량을 찾아 들어가면 그 차 한 대의 정산 카드가 열린다.
 * 엑셀 "렌트베네핏 장기렌트_갑지.xlsx"의 시트 한 장이 이 화면 하나다.
 */
/**
 * 갑지 맨 위 '판매 대금' 칸 (대표님 2026-10-28).
 *
 * 판매 대금을 넣고 [판매 처리]를 누르면 갑지·차량·계약이 한 번에 거래완료가 된다(서버 vehicleSaleController).
 * 엑셀에서 인수가 줄이 이미 들어왔는데 차가 아직 운행 중이면 그 줄로 미리 채워 처리하라고 알린다.
 */
function SalePanel({ ledger, entries, canEdit, dirty, authHeaders, showToast, onDone }) {
  // 계약에서 자동으로 만든 예정 인수가 줄(잠기지 않은 줄)은 실제로 받은 돈이 아니다. 엑셀에서 들어온 줄은 잠겨 있다.
  const takeoverLine = entries.find((e) => e.side === '입금' && e.category === '인수가' && Number(e.amount) > 0 && !(e.source === 'contract' && !e.locked));
  const [form, setForm] = useState(() => ({
    kind: '인수',
    date: takeoverLine?.date || '',
    amount: takeoverLine ? Number(takeoverLine.amount) : '',
    buyer: '',
    memo: ''
  }));
  const [busy, setBusy] = useState(false);
  const sale = ledger.sale?.at ? ledger.sale : null;
  // 저장 직후 응답은 차량이 id로만 와서 상태를 모른다. 그때는 갑지 상태만 보고 판단한다.
  const vehicleStatus = typeof ledger.vehicle === 'object' ? ledger.vehicle?.status : undefined;
  const box = { ...card, padding: '0.8rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' };
  const input = { padding: '0.4rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', background: '#fff', boxSizing: 'border-box' };
  const btn = (bg, fg) => ({ border: `1px solid ${bg === '#fff' ? 'var(--border-color)' : bg}`, background: bg, color: fg, padding: '0.45rem 0.9rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700', cursor: busy ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' });

  const send = async (method, body) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_HOST}/api/ledgers/${ledger._id}/sale`, { method, headers: authHeaders, body: body ? JSON.stringify(body) : undefined });
      const d = await res.json().catch(() => ({}));
      showToast(d.message || (res.ok ? '처리했습니다.' : '처리하지 못했습니다.'), res.ok && d.success ? 'success' : 'error');
      if (res.ok && d.success) onDone();
    } finally { setBusy(false); }
  };

  if (sale) {
    return (
      <div style={{ ...box, background: '#f0fdf4', borderColor: '#86efac' }}>
        <b style={{ color: '#15803d', fontSize: '0.86rem' }}>판매 완료</b>
        <span style={{ fontSize: '0.82rem' }}>
          {sale.kind} · {toDateInput(sale.date)} · <b>{toCommaString(sale.amount)}원</b>{sale.buyer ? ` · ${sale.buyer}` : ''}
        </span>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          {sale.by ? `${sale.by} · ` : ''}{toDateInput(sale.at)} 처리 · 차량·계약 거래완료{sale.memo ? ` · ${sale.memo}` : ''}
        </span>
        {canEdit && (
          <button type="button" disabled={busy} style={{ ...btn('#fff', 'var(--text-muted)'), marginLeft: 'auto' }}
            onClick={() => { if (window.confirm('판매를 취소할까요? 판매 대금 줄을 빼고 차량·계약·갑지를 판매 전으로 되돌립니다.')) send('DELETE'); }}>
            판매 취소
          </button>
        )}
      </div>
    );
  }

  // 예전 방식(계약 화면 [인수] 등)으로 이미 끝난 차
  if (ledger.status === '거래완료' && (!ledger.vehicle || !vehicleStatus || vehicleStatus === '거래완료')) {
    return (
      <div style={{ ...box, padding: '0.55rem 1.1rem' }}>
        <b style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>거래완료</b>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {takeoverLine ? `인수가 ${toDateInput(takeoverLine.date)} ${toCommaString(takeoverLine.amount)}원` : '판매 대금 줄이 없습니다. 판매 금액을 아래 원장에 넣어 주세요.'}
        </span>
      </div>
    );
  }

  const waiting = takeoverLine || ledger.status === '거래완료';
  const submit = () => {
    if (dirty) { showToast('저장하지 않은 내용이 있습니다. 먼저 [저장]을 눌러 주세요.', 'error'); return; }
    if (!form.date) { showToast('판매일을 넣어 주세요.', 'error'); return; }
    if (!(Number(form.amount) > 0)) { showToast('판매 대금을 넣어 주세요.', 'error'); return; }
    if (form.kind === '매각' && !form.buyer.trim()) { showToast('매각한 곳을 넣어 주세요.', 'error'); return; }
    const who = form.kind === '매각' ? `${form.buyer}에 매각` : '고객 인수';
    if (!window.confirm(`${ledger.header?.plateNo || ledger.ledgerNo} ${who}, ${form.date}, ${toCommaString(form.amount)}원\n\n갑지·차량·계약을 거래완료로 바꾸고 검사·정비 알림을 끕니다. 진행할까요?`)) return;
    send('POST', form);
  };

  return (
    <div style={{ ...box, background: waiting ? '#fff7ed' : '#fff', borderColor: waiting ? '#fdba74' : 'var(--border-color)' }}>
      <b style={{ fontSize: '0.86rem', color: waiting ? '#c2410c' : 'var(--text-bright)' }}>판매 대금</b>
      {waiting && (
        <span style={{ fontSize: '0.76rem', fontWeight: '700', color: '#c2410c', flexBasis: '100%' }}>
          {takeoverLine ? `원장에 인수가 ${toDateInput(takeoverLine.date)} ${toCommaString(takeoverLine.amount)}원이 있습니다. ` : '갑지는 거래완료입니다. '}
          {vehicleStatus ? `차량은 아직 '${vehicleStatus}'입니다. ` : ''}확인하고 [판매 처리]를 눌러 주세요.
        </span>
      )}
      <span style={{ display: 'inline-flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
        {['인수', '매각'].map((k) => (
          <button key={k} type="button" disabled={!canEdit} onClick={() => setForm((f) => ({ ...f, kind: k }))}
            title={k === '인수' ? '고객(임차인)이 차를 삼' : '중고차 매매상 등 다른 곳에 팜'}
            style={{ border: 'none', padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer', background: form.kind === k ? 'var(--primary)' : '#fff', color: form.kind === k ? '#fff' : 'var(--text-muted)' }}>
            {k}
          </button>
        ))}
      </span>
      <DateText value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} disabled={!canEdit} placeholder="판매일 YYMMDD" style={{ ...input, width: '120px' }} />
      <MoneyInput value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} disabled={!canEdit} placeholder="판매 대금 (원)" style={{ ...input, width: '140px' }} />
      {form.kind === '매각' && (
        <input value={form.buyer} onChange={(e) => setForm((f) => ({ ...f, buyer: e.target.value }))} disabled={!canEdit} placeholder="매각한 곳" style={{ ...input, width: '150px' }} />
      )}
      <input value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} disabled={!canEdit} placeholder="메모 (선택)" style={{ ...input, flex: '1 1 140px', minWidth: '120px' }} />
      {canEdit && (
        <button type="button" disabled={busy} onClick={submit} style={btn(waiting ? '#c2410c' : 'var(--primary)', '#fff')}>
          {busy ? '처리 중...' : '판매 처리'}
        </button>
      )}
    </div>
  );
}

function LedgerView({ showToast, currentUser }) {
  const canEdit = currentUser?.role !== 'viewer';

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
  const [ledgers, setLedgers] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  // 기본 순서: 계약차량 → 단기렌트 → 장기렌트 → 그 밖(거래완료 등), 각 묶음 안에서 최근 출고순 (서버가 정렬)
  const [sortKey, setSortKey] = useState('default');
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

  // 구간마다 이어진 계약의 청구서 회차. 원장 렌트료 입금을 청구서 회차(출금일)에 맞춰 보여 준다(rentMatch.js)
  const contractIdOfPeriod = useCallback((p) => {
    const c = p.contract || ((p.seq || 1) === 1 && periods.length <= 1 ? ledger?.contract : null);
    return c ? String(c._id || c) : '';
  }, [ledger, periods]);
  const [scheduleRounds, setScheduleRounds] = useState({});
  useEffect(() => {
    const ids = [...new Set(periods.map(contractIdOfPeriod).filter(Boolean))];
    if (!ids.length) return undefined;
    let alive = true;
    Promise.all(ids.map((id) => fetch(`${API_HOST}/api/billing-schedules/contract/${id}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => [id, d?.success ? d.schedule?.rounds || null : null])))
      .then((pairs) => { if (alive) setScheduleRounds(Object.fromEntries(pairs.filter(([, v]) => v))); });
    return () => { alive = false; };
  }, [periods, contractIdOfPeriod]);
  // 과태료를 청구서 범칙금으로 돌려받았는지 볼 때 쓴다(수익성 검토)
  const billingRounds = useMemo(() => Object.values(scheduleRounds).flat(), [scheduleRounds]);

  // 구간별 월 렌트료. 렌트료 줄이 이보다 크면 과태료 등을 얹어 받은 것으로 본다(수익성 검토).
  const rentBySeq = useMemo(() => Object.fromEntries(periods.map((p) => [
    p.seq || 1,
    Number(p.monthlyRent) || Number(ledger?.terms?.monthlyRent) || 0
  ])), [periods, ledger]);

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
      if (typeFilter) params.set('form', typeFilter);
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

  // 자금팀 엑셀(OneDrive) 자동 갱신. 원장 입출금은 엑셀이 원본이다(서버 utils/excelAutoSync.js, 2026-10-18).
  const [excelSync, setExcelSync] = useState(null);
  const [excelSyncing, setExcelSyncing] = useState(false);
  const fetchExcelSync = useCallback(() => {
    fetch(`${API_HOST}/api/excel-sync/status`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setExcelSync)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (viewMode === 'list') fetchExcelSync();
  }, [viewMode, fetchExcelSync]);

  const runExcelSyncNow = async () => {
    if (!window.confirm('OneDrive의 자금팀 엑셀을 지금 차량 손익 원장과 회사 장부에 반영합니다.\n(반영 전 지금 원장을 OneDrive에 백업합니다) 진행할까요?')) return;
    setExcelSyncing(true);
    try {
      const res = await fetch(`${API_HOST}/api/excel-sync/run`, { method: 'POST', headers: authHeaders, body: JSON.stringify({}) });
      const data = await res.json();
      showToast(data.message || (res.ok ? '반영했습니다.' : '반영하지 못했습니다.'), res.ok && data.success !== false ? 'success' : 'warning');
      fetchExcelSync();
      fetchLedgers();
    } catch (err) {
      showToast(err.message || '반영하지 못했습니다.', 'error');
    } finally {
      setExcelSyncing(false);
    }
  };

  // 직원이 익숙해지면 엑셀 대신 프로그램에서 바로 관리한다. 그때 끈다(끄지 않으면 엑셀이 프로그램 수정분을 덮는다).
  const toggleExcelSync = async () => {
    const turnOn = Boolean(excelSync?.switchedOff);
    const ask = turnOn
      ? '엑셀 연동을 다시 켭니다.\n다음 갱신부터 OneDrive 엑셀 내용으로 원장 입출금 줄이 바뀝니다. 그동안 프로그램에서 고친 입출금 줄은 엑셀에 없으면 사라집니다. 진행할까요?'
      : '엑셀 연동을 끕니다.\n이제 원장 입출금은 프로그램에서 직접 고치고, OneDrive 엑셀을 고쳐도 프로그램에 들어오지 않습니다.\n끄기 전에 [지금 갱신]으로 엑셀 최종본을 한 번 반영해 두세요. 끌까요?';
    if (!window.confirm(ask)) return;
    try {
      const res = await fetch(`${API_HOST}/api/excel-sync/switch`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ on: turnOn }) });
      const data = await res.json();
      showToast(data.message || (res.ok ? '바꿨습니다.' : '바꾸지 못했습니다.'), res.ok ? 'success' : 'warning');
      fetchExcelSync();
    } catch (err) {
      showToast(err.message || '바꾸지 못했습니다.', 'error');
    }
  };

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
    setExtraRounds({});
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
    if (dirty && !window.confirm('저장하지 않은 내용이 있습니다. 목록으로 나가시겠습니까?')) return false;
    setViewMode('list');
    setLedger(null);
    fetchLedgers();
    return true;
  };
  // 뒤로 가기(핸드폰 화면 쓸기)로 닫는다 — utils/useBackClose.js
  useBackClose(viewMode === 'detail', backToList);
  useBackClose(linkOpen, () => setLinkOpen(false));
  useBackClose(extendOpen, () => setExtendOpen(false));

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
    setSortKey('default'); setSortOrder('desc');
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
  /**
   * 계약 조건 표의 한 칸을 고친다. 구간이 저장돼 있으면 그 구간을, 없으면(연장 없는 갑지) 고정 조건을 고친다.
   * 마지막 구간은 지금 유효한 계약이라 고정 조건(terms)도 같이 맞춘다. 보증금은 승계되므로 고정 조건 쪽은 두지 않는다.
   */
  const TERMS_FROM_LAST = ['monthlyRent', 'termMonths', 'advancePayment', 'takeoverPrice', 'rentStartDate'];
  const setPeriodField = (seq, key, value) => {
    setLedger((prev) => {
      const list = prev.contractPeriods || [];
      if (!list.length) {
        if (key === 'startDate') return { ...prev, header: { ...prev.header, contractedAt: value } };
        if (key === 'endDate') return { ...prev, header: { ...prev.header, contractEndAt: value } };
        return { ...prev, terms: { ...prev.terms, [key]: value } };
      }
      const lastSeq = Math.max(...list.map((p) => p.seq));
      return {
        ...prev,
        contractPeriods: list.map((p) => (p.seq === seq ? { ...p, [key]: value } : p)),
        terms: seq === lastSeq && TERMS_FROM_LAST.includes(key) ? { ...prev.terms, [key]: value } : prev.terms
      };
    });
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

    const typedRound = RENT_LABEL.test(d.label || '') ? /(\d+)\s*회차/.exec(d.label)?.[1] : null;

    setEntries((prev) => [{
      _id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      isNew: true,
      side: column.side,
      group: column.group,
      category: typedRound ? '렌트료' : '기타',
      round: typedRound ? Number(typedRound) : undefined,
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

  /**
   * 장기렌트 월 렌트료 회차표에 깔 내용. 장기렌트가 아니면 null.
   *
   * 구간마다 계약 기간(개월)만큼 회차를 만든다. 이미 입금된 회차가 기간보다 많으면
   * (기간을 잘못 적었거나 연체분을 나중에 받은 경우) 그 회차까지 늘려서 빠지는 줄이 없게 한다.
   */
  const rentBlocks = useMemo(() => {
    if (!ledger || (ledger.ledgerType || '장기렌트') !== '장기렌트') return null;
    const terms = ledger.terms || {};
    const shown = periods.filter((p) => periodView === null || p.seq === periodView);

    // 청구서 회차가 있는 구간: 청구서 회차(출금일·그 달 몫)마다 칸을 만들고 입금을 날짜로 맞춘다.
    // 갑지 번호는 들어온 순서라 빠진 달이 안 보였다. 여기서는 안 들어온 회차가 '미입금'으로 남는다.
    const KIND_COLOR = { '늦게 입금': '#b45309', '미납→합산': '#b45309', '일부 입금': '#b45309', '미입금': '#dc2626', '날짜 확인': '#7c3aed' };
    const bySchedule = shown.map((p) => {
      const seq = p.seq || 1;
      const rounds = scheduleRounds[contractIdOfPeriod(p)];
      if (!rounds?.length) return null;
      const deposits = entries
        .filter((e) => (e.periodSeq || 1) === seq && rentRoundOf(e))
        .map((e) => ({ _id: e._id, date: e.date, amount: Number(e.amount) || 0, round: rentRoundOf(e) }));
      const m = matchRentToRounds(rounds, deposits, new Date(), { perCarRent: Number(p.monthlyRent) || Number(terms.monthlyRent) || 0 });
      const rows = m.rows.map((r) => ({
        round: r.no,
        dueDate: r.due,
        expected: r.own,
        free: r.kind === '청구 없음',
        paid: r.entryIds.length > 0,
        paidAmount: r.paidAmount,
        paidDate: r.paidDate,
        entryIds: r.combinedInto ? [] : r.entryIds,
        combinedInto: r.combinedInto,
        overdue: r.overdue,
        note: ['정상', '청구 없음', '예정', '미입금', '미납→합산'].includes(r.kind) ? (r.kind === '미납→합산' ? '' : (r.note || '')) : `${r.kind}${r.note ? ` · ${r.note}` : ''}`,
        noteColor: KIND_COLOR[r.kind],
        noteTitle: r.kind
      }));
      const missing = rows.filter((r) => r.overdue).map((r) => r.round);
      const monthlyRent = Number(p.monthlyRent) || Number(terms.monthlyRent) || 0;
      return {
        key: `rent-${seq}`,
        seq,
        monthlyRent,
        defaultAmount: monthlyRent,
        heading: `${shown.length > 1 ? `${periodName(seq)} · ` : ''}청구서 회차 기준 ${rows.length}회`
          + (missing.length ? ` · 미입금 ${missing.join('·')}회` : ' · 미입금 없음')
          + (m.unmatched.length ? ` · 회차를 못 찾은 입금 ${m.unmatched.length}건(${m.unmatched.map((u) => `${u.date} ${toCommaString(u.amount)}`).join(', ')})` : ''),
        rounds: rows
      };
    });
    if (bySchedule.some(Boolean)) {
      // 청구서가 없는 구간은 예전처럼 갑지 번호대로
      return bySchedule.map((b, i) => b || fallbackBlock(shown[i]));
    }

    // 회차마다 금액이 다른 계약(렌트료 표, ledger.rentPlan). 예: ㈜에이치와이파트너즈
    //   1~11회 그랜저 월 115만 → 12회 쉼(0원) → 13~23회 다른 차 월 107만 → 24회 쉼 …
    // 차·금액이 바뀌는 구간마다 묶음을 나누고, 0원 회차는 '쉬는 달'로 바로 앞 구간 끝에 둔다.
    const plan = [...(ledger.rentPlan || [])].sort((a, b) => a.round - b.round);
    if (plan.length && periods.length <= 1 && (periodView === null || periodView === 1)) {
      const start = terms.rentStartDate || periods[0]?.startDate;
      const byRound = new Map();
      entries.forEach((e) => {
        if ((e.periodSeq || 1) !== 1) return;
        const round = rentRoundOf(e);
        if (!round) return;
        if (!byRound.has(round)) byRound.set(round, []);
        byRound.get(round).push(e);
      });
      const stages = [];
      for (const p of plan) {
        const amount = Number(p.amount) || 0;
        const last = stages[stages.length - 1];
        if (amount === 0 && last) { last.items.push(p); continue; }
        if (last && last.amount === amount && (last.plateNo || '') === (p.plateNo || '') && !last.items.some((x) => !(Number(x.amount) > 0))) {
          last.items.push(p);
          continue;
        }
        stages.push({ amount, plateNo: p.plateNo || '', carModel: p.carModel || '', items: [p] });
      }
      return stages.map((st, i) => {
        const rounds = st.items.map((p) => {
          const hits = byRound.get(p.round) || [];
          const dates = hits.map((e) => e.date).filter(Boolean).sort();
          const expected = Number(p.amount) || 0;
          const r = {
            round: p.round,
            dueDate: dueDateOf(start, p.round),
            paid: hits.length > 0,
            paidAmount: hits.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
            paidDate: dates[dates.length - 1] || '',
            entryIds: hits.map((e) => e._id),
            expected,
            free: expected === 0
          };
          const short = expected - r.paidAmount;
          return r.paid && short > 0 && short < CMS_SHORT_TOLERANCE ? { ...r, note: `CMS −${toCommaString(short)}` } : r;
        });
        const paidRounds = st.items.filter((p) => Number(p.amount) > 0).map((p) => p.round);
        const freeRounds = st.items.filter((p) => !(Number(p.amount) > 0)).map((p) => p.round);
        const car = [st.carModel, st.plateNo].filter(Boolean).join(' ');
        return {
          key: `rent-1-s${i + 1}`,
          seq: 1,
          monthlyRent: st.amount,
          defaultAmount: st.amount,
          heading: `${paidRounds[0]}~${paidRounds[paidRounds.length - 1]}회${car ? ` · ${car}` : ''} · 월 ${toCommaString(st.amount)} 원`
            + (freeRounds.length ? ` · ${freeRounds.join('·')}회 쉼` : ''),
          rounds
        };
      });
    }

    function fallbackBlock(p) {
        const seq = p.seq || 1;
        const monthlyRent = Number(p.monthlyRent) || (seq === 1 ? Number(terms.monthlyRent) || 0 : 0);
        const termMonths = Number(p.termMonths) || (seq === 1 ? Number(terms.termMonths) || 0 : 0);
        const start = p.rentStartDate || (seq === 1 ? terms.rentStartDate : null) || p.startDate;

        const byRound = new Map();
        entries.forEach((e) => {
          if ((e.periodSeq || 1) !== seq) return;
          const round = rentRoundOf(e);
          if (!round) return;
          if (!byRound.has(round)) byRound.set(round, []);
          byRound.get(round).push(e);
        });

        const count = Math.max(termMonths, ...byRound.keys(), 0);
        const rounds = Array.from({ length: count }, (_, i) => {
          const round = i + 1;
          const hits = byRound.get(round) || [];
          const dates = hits.map((e) => e.date).filter(Boolean).sort();
          return {
            round,
            dueDate: dueDateOf(start, round),
            paid: hits.length > 0,
            paidAmount: hits.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
            paidDate: dates[dates.length - 1] || '',
            entryIds: hits.map((e) => e._id)
          };
        }).map((r) => {
          const short = monthlyRent - r.paidAmount;
          return r.paid && short > 0 && short < CMS_SHORT_TOLERANCE ? { ...r, note: `CMS −${toCommaString(short)}` } : r;
        });
        return {
          key: `rent-${seq}`,
          seq,
          monthlyRent,
          defaultAmount: monthlyRent,
          heading: shown.length > 1 ? `${periodName(seq)} · ${rounds.length}회 · 월 ${toCommaString(monthlyRent)} 원` : null,
          rounds
        };
    }

    return shown.map((p) => fallbackBlock(p));
  }, [ledger, periods, periodView, entries, scheduleRounds, contractIdOfPeriod]);

  // 회사출금 회차표에서 "회차 추가"로 늘린 칸 수. 체크하면 줄이 생겨 그 뒤로는 저절로 남는다.
  const [extraRounds, setExtraRounds] = useState({});

  // 회차표 기본 칸 수는 차 1대의 전체 계약 기간으로 잡는다
  const totalMonths = useMemo(() => {
    const sum = periods.reduce((s2, p) => s2 + (Number(p.termMonths) || 0), 0);
    return sum || Number(ledger?.terms?.termMonths) || 0;
  }, [periods, ledger]);

  const payExpenseRound = (block, round, date, amount) => {
    setEntries((prev) => [{
      _id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      isNew: true,
      side: '지출',
      group: '회사출금',
      category: block.fixed.category,
      label: `${block.fixed.entryLabel} ${round}회차`,
      amount,
      bank: draft['회사출금']?.bank || 'B',
      date,
      round,
      periodSeq: periodView || latestSeq
    }, ...prev]);
    setDirty(true);
  };

  const cancelExpenseRound = (ids, block, round) => {
    if (!window.confirm(`${block.fixed.label} ${round}회차 납부를 취소할까요? 이 회차의 출금 줄이 지워집니다.`)) return;
    setEntries((prev) => prev.filter((e) => !ids.includes(e._id)));
    setDirty(true);
  };

  // 계약금·차량가·등록비용 빈 칸에서 "입력"을 누르면 이름이 채워진 줄을 만들고 바로 고치는 상태로 연다
  const fillFixedSingle = (fixed) => {
    const id = newEntryId();
    setEntries((prev) => [{
      _id: id,
      isNew: true,
      side: '지출',
      group: '회사출금',
      category: fixed.category,
      label: fixed.label,
      amount: '',
      bank: draft['회사출금']?.bank || 'B',
      date: '',
      periodSeq: periodView || latestSeq
    }, ...prev]);
    setEditingId(id);
    setDirty(true);
  };

  // 회차표에서 입금 완료를 찍으면 고객입금 열에 "렌트료 n회차" 줄이 생긴다
  const payRentRound = (block, round, date) => {
    const tag = block.seq > 1 ? ` (${block.seq - 1}차 연장)` : '';
    const expected = block.rounds?.find((r) => r.round === round)?.expected;
    setEntries((prev) => [{
      _id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      isNew: true,
      side: '입금',
      group: '고객입금',
      category: '렌트료',
      label: `렌트료 ${round}회차${tag}`,
      amount: expected ?? block.monthlyRent,
      bank: draft['고객입금']?.bank || 'B',
      date,
      round,
      periodSeq: block.seq
    }, ...prev]);
    setDirty(true);
  };

  const cancelRentRound = (ids, block, round) => {
    if (!window.confirm(`${periodName(block.seq)} 렌트료 ${round}회차 입금을 취소할까요? 이 회차의 입금 줄이 지워집니다.`)) return;
    setEntries((prev) => prev.filter((e) => !ids.includes(e._id)));
    setDirty(true);
  };

  /**
   * 회차표에서 이미 찍은 회차의 금액·날짜를 고친다(렌트료·보험료·자동차세·검사 공통).
   * 한 회차가 여러 줄(나눠 들어온 돈)이면 가장 늦은 줄에서 차이를 맞춰 회차 합계가 적은 금액이 되게 한다.
   */
  const editRoundEntries = (ids, round, date, amount) => {
    setEntries((prev) => {
      const hits = prev.filter((e) => ids.includes(e._id))
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      if (!hits.length) return prev;
      const last = hits[hits.length - 1];
      const others = hits.slice(0, -1).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      return prev.map((e) => (e._id === last._id ? { ...e, amount: Math.max(0, amount - others), date } : e));
    });
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
    let depositIn = 0;
    let depositOut = 0;
    entries.forEach((e) => {
      if (periodView !== null && (e.periodSeq || 1) !== periodView) return;
      const amount = Number(e.amount) || 0;
      if (!amount) return;
      const bank = (e.bank || '미지정').trim() || '미지정';
      if (!byBank[bank]) byBank[bank] = { bank, paidOut: 0, paidIn: 0, deposit: 0 };
      // 보증금은 돌려줄 돈이라 정산계에서 뺀다(서버 summarizeLedger와 같은 규칙)
      const isDeposit = e.category === '보증금';
      if (e.side === '입금') { byBank[bank].paidIn += amount; paidIn += amount; if (isDeposit) { depositIn += amount; byBank[bank].deposit += amount; } }
      else { byBank[bank].paidOut += amount; paidOut += amount; if (isDeposit) { depositOut += amount; byBank[bank].deposit -= amount; } }
    });
    // 엑셀 상단 박스가 B / SC 두 줄이라 그 순서를 지키고, 나머지 은행은 뒤에 붙인다
    const order = ['B', 'SC'];
    const rows = Object.values(byBank).sort((a, b) => {
      const ai = order.indexOf(a.bank); const bi = order.indexOf(b.bank);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.bank.localeCompare(b.bank);
    });
    // 거래완료 차에 인수가 줄 없이 남은 보증금은 인수가와 상계된 돈이라 정산계에서 빼지 않는다(서버와 같은 규칙)
    const takeoverOffset = isDepositOffsetTakeover(ledger?.status, entries, depositIn - depositOut) ? depositIn - depositOut : 0;
    if (takeoverOffset) rows.forEach((r) => { r.deposit = 0; });
    return {
      rows, paidOut, paidIn, takeoverOffset,
      depositHeld: takeoverOffset ? 0 : depositIn - depositOut,
      balance: paidIn - paidOut - depositIn + depositOut + takeoverOffset
    };
  }, [entries, periodView, ledger?.status]);

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
          ...(ledger.contractPeriods?.length ? {
            contractPeriods: ledger.contractPeriods.map((p) => ({
              seq: p.seq, termMonths: p.termMonths, monthlyRent: p.monthlyRent, deposit: p.deposit,
              advancePayment: p.advancePayment, takeoverPrice: p.takeoverPrice,
              startDate: toDateInput(p.startDate), endDate: toDateInput(p.endDate), rentStartDate: toDateInput(p.rentStartDate)
            }))
          } : {}),
          ledgerType: ledger.ledgerType, status: ledger.status, note: ledger.note,
          profitReport: ledger.profitReport ?? '',
          maturityPlan: ledger.maturityPlan || '미정'
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

  // 갑지를 열어 둔 동안 Ctrl+S로 저장한다
  useSaveShortcut(viewMode === 'detail' && canEdit && !saving, () => handleSave());

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
            <option value="">전체 형태</option>
            {FORMS.map((t) => <option key={t} value={t}>{t}</option>)}
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
            <option value="default:desc">기본 순서 (계약차량 · 단기 · 장기 · 완료, 최근 출고순)</option>
            <option value="createdAt:desc">최근 만든 순</option>
            {SORTABLE.filter((c) => c.key).flatMap((c) => ([
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} 오름차순</option>,
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} 내림차순</option>
            ]))}
          </select>
          {(query || statusFilter || typeFilter || sortKey !== 'default' || sortOrder !== 'desc') && (
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

        {excelSync && (() => {
          const when = (x) => (x ? new Date(x).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
          const last = excelSync.lastRun;
          return (
            <div style={{ ...card, padding: '0.7rem 1rem', display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <RefreshCw size={14} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: '260px', lineHeight: 1.6 }}>
                <div>
                  <b style={{ color: 'var(--text-bright)' }}>자금팀 엑셀 자동 갱신</b>{' '}
                  {excelSync.switchedOff
                    ? `꺼짐 · 원장은 프로그램에서 직접 관리합니다 (${when(excelSync.switchedAt)}${excelSync.switchedBy ? ` ${excelSync.switchedBy}` : ''})`
                    : excelSync.enabled
                      ? '켜짐 · 근무 시간(09:00~20:00) 10분마다 확인해 저장 후 10분 지나면 반영 · 21:00 하루 마감'
                      : '이 서버에서는 정기 실행이 꺼져 있습니다 (운영 서버에서만 동작)'}
                </div>
                <div>
                  마지막 반영 {when(last?.at)}{last?.message ? ` · ${last.message}` : ''}
                  {!excelSync.switchedOff && excelSync.lastCheck?.waiting?.length ? ` · ${excelSync.lastCheck.waiting.join(' ')}` : ''}
                </div>
                {!excelSync.switchedOff && (
                  <div style={{ color: '#b45309' }}>
                    입출금 줄은 OneDrive 엑셀이 원본입니다. 여기서 고친 입출금 줄은 다음 갱신 때 엑셀 내용으로 바뀌니 엑셀에서 고쳐 주세요.
                  </div>
                )}
              </div>
              {currentUser?.role === 'admin' && (
                <button
                  type="button"
                  onClick={toggleExcelSync}
                  title={excelSync.switchedOff ? 'OneDrive 엑셀을 다시 원장의 원본으로 씁니다' : '엑셀 대신 프로그램에서 바로 관리하게 되면 끕니다'}
                  style={{ border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.45rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' }}
                >
                  {excelSync.switchedOff ? '엑셀 연동 다시 켜기' : '엑셀 연동 끄기'}
                </button>
              )}
              {currentUser?.role === 'admin' && !excelSync.switchedOff && (
                <button
                  type="button"
                  onClick={runExcelSyncNow}
                  disabled={excelSyncing}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--primary)', background: '#fff', color: 'var(--primary)', padding: '0.45rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700', cursor: excelSyncing ? 'wait' : 'pointer' }}
                >
                  <RefreshCw size={14} /> {excelSyncing ? '반영 중…' : '지금 갱신'}
                </button>
              )}
            </div>
          );
        })()}

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
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: '700', padding: '0.15rem 0.5rem', borderRadius: '10px', ...(FORM_STYLE[l.form] || FORM_STYLE.장기) }}>
                        {l.form || '장기'}
                      </span>
                    </td>
                    <td style={{ padding: '0.55rem 0.4rem', fontWeight: '700', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{l.ledgerNo}</td>
                    <td style={{ padding: '0.55rem 0.4rem' }}>{l.header?.contractorName || l.company?.name || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem' }}>{l.header?.customerName || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem' }}>{l.header?.carModel || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem' }}>{l.header?.carSpec || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>{l.header?.plateNo || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>{l.header?.vin || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>{toDateInput(l.deliveredAt) || '-'}</td>
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>{toDateInput(l.header?.contractEndAt) || '-'}</td>
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
    ['등록일', 'registeredAt', 'date'], ['출고일', 'deliveredAt', 'date'],
    ['계약일', 'contractedAt', 'date'], ['계약종료일', 'contractEndAt', 'date'],
    ['배기량', 'cc', 'number']
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* 상단 바 */}
      <div className="m-first" style={{ ...card, padding: '1rem 1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
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

      {/* 판매 대금 — 넣으면 갑지·차량·계약이 거래완료가 된다. 갑지마다 새로 그리도록 key를 준다 */}
      <SalePanel
        key={`${ledger._id}-${ledger.sale?.at || ''}-${ledger.status}`}
        ledger={ledger}
        entries={entries}
        canEdit={canEdit}
        dirty={dirty}
        authHeaders={authHeaders}
        showToast={showToast}
        onDone={() => openLedger(ledger._id)}
      />

      {/* 상단 정보 (핸드폰은 두 칸씩) */}
      <div style={{ ...card, padding: '1.2rem' }}>
        <div className="m-two-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
          {headerFields.map(([label, key, type]) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</label>
              {type === null ? (
                <div style={{ padding: '0.45rem 0.5rem', background: 'var(--bg-main)', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '700' }}>{ledger.ledgerNo}</div>
              ) : type === 'date' ? (
                <DateText
                  value={toDateInput(h[key])}
                  onChange={(v) => setHeaderField(key, v)}
                  disabled={!canEdit}
                  style={{ width: '100%', padding: '0.45rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', background: '#fff' }}
                />
              ) : (
                <input
                  type={type === 'number' ? 'number' : 'text'}
                  value={h[key] ?? ''}
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

      {/* 집계 박스 - 엑셀 상단 박스와 같은 값. 핸드폰은 정산 결과부터 보이게 맨 위로 */}
      <div className="m-second" style={{ ...card, padding: '1.2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          {[
            { title: '지출계 (회사출금액)', pick: (r) => r.paidOut, total: summary.paidOut, color: '#d9534f' },
            { title: '수입계 (고객입금액)', pick: (r) => r.paidIn, total: summary.paidIn, color: '#2f6f4e' },
            { title: summary.takeoverOffset ? '정산계 (보증금 = 인수가 상계)' : '정산계 (보증금 제외)', pick: (r) => r.paidIn - r.paidOut - r.deposit, total: summary.balance, color: summary.balance < 0 ? '#d9534f' : '#2f6f4e' }
          ].map((box) => (
            <div key={box.title} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '0.5rem 0.7rem', background: 'var(--bg-main)', fontSize: '0.78rem', fontWeight: '800' }}>{box.title}</div>
              <div style={{ padding: '0.4rem 0.7rem' }}>
                {summary.rows.map((r) => (
                  <div key={r.bank} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '0.2rem 0' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{bankText(r.bank)}</span>
                    <span>{signed(box.pick(r))}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: '800', padding: '0.4rem 0 0.2rem', borderTop: '1px solid var(--border-color)', marginTop: '0.3rem', color: box.color }}>
                  <span>계</span><span>{signed(box.total)}</span>
                </div>
                {box.title.startsWith('정산계') && summary.depositHeld !== 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', paddingTop: '0.2rem' }}>
                    보관 중인 보증금 {signed(summary.depositHeld)} (돌려줄 돈이라 정산계에서 뺌)
                  </div>
                )}
                {box.title.startsWith('정산계') && summary.takeoverOffset > 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', paddingTop: '0.2rem' }}>
                    거래완료인데 인수가 줄이 없어 보증금 {signed(summary.takeoverOffset)}을 인수가와 상계한 것으로 봄 (정산계에 넣음)
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 입력 그리드 - 회사출금액 / 고객입금액·기타 두 열 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1rem', alignItems: 'start' }}>
        {COLUMNS.map((column) => {
          const allRows = entries.filter((e) => column.includes.includes(e.group || '회사출금')
            && (periodView === null || (e.periodSeq || 1) === periodView));
          const subtotal = allRows.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
          const showRent = column.side === '입금' && rentBlocks;
          const isExpense = column.side === '지출';

          // 회사출금 열: 계약금·차량가·등록비용은 맨 위 고정 줄, 보험료·자동차세·검사는 회차표
          const expenseBlocks = isExpense
            ? EXPENSE_FIXED.filter((f) => f.kind === 'rounds').map((f) => ({
              key: f.category,
              fixed: f,
              defaultAmount: 0,
              rounds: fillRounds(
                allRows.filter((e) => e.category === f.category),
                f.count(totalMonths) + (extraRounds[f.category] || 0)
              )
            }))
            : [];
          const fixedTop = isExpense
            ? EXPENSE_FIXED.filter((f) => f.kind === 'single').flatMap((f) => {
              const hits = allRows.filter((e) => e.category === f.category);
              return hits.length ? hits.map((e) => ({ ...e, fixedRow: true })) : [{ _id: `slot-${f.category}`, placeholder: f }];
            })
            : [];

          let rows = allRows;
          if (showRent) rows = allRows.filter((e) => !rentRoundOf(e));
          if (isExpense) rows = [...fixedTop, ...allRows.filter((e) => !FIXED_CATEGORIES.has(e.category))];
          const d = draft[column.group] || {};
          const addOnEnter = (e) => { if (e.key === 'Enter') addFromDraft(column); };

          return (
            <div key={column.group} style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '0.7rem 0.9rem', borderBottom: `2px solid ${column.accent}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-main)' }}>
                <span style={{ fontWeight: '800', fontSize: '0.85rem', color: column.accent }}>{column.title}</span>
                <span style={{ fontSize: '0.82rem', fontWeight: '700', whiteSpace: 'nowrap' }}>{toCommaString(subtotal)} 원</span>
              </div>

              {showRent && (rentBlocks.some((b) => b.rounds.length) ? (
                <RoundChecklist
                  title="월 렌트료" verb="입금" accent="#2f6f4e" tint="#f3f8f5"
                  blocks={rentBlocks} canEdit={canEdit}
                  onPay={payRentRound} onCancel={cancelRentRound} onEdit={editRoundEntries}
                />
              ) : (
                <div style={{ padding: '0.6rem 0.9rem', fontSize: '0.75rem', color: 'var(--text-muted)', background: '#f3f8f5', borderBottom: '1px solid var(--border-color)' }}>
                  아래 고정 조건에 월 렌트료와 계약 기간(개월)을 적으면 렌트료 회차표가 만들어집니다.
                </div>
              ))}
              {expenseBlocks.map((b) => (
                <RoundChecklist
                  key={b.key}
                  title={b.fixed.label} verb="납부" accent="#d9534f" tint="#fcf4f4"
                  blocks={[b]} canEdit={canEdit} askAmount defaultOpen={false}
                  onPay={payExpenseRound} onCancel={cancelExpenseRound} onEdit={editRoundEntries}
                  onAddRound={() => setExtraRounds((prev) => ({ ...prev, [b.key]: (prev[b.key] || 0) + 1 }))}
                />
              ))}

              {/*
                칸 너비를 colgroup 하나로 정해 두고 추가 줄과 목록 줄이 같이 쓴다.
                금액·은행·날짜·관리는 고정 폭이고 남는 폭은 전부 내용 칸이 가져간다.
                내용이 넘치면 … 으로 줄이고, 마우스를 올리면 전체 내용이 뜬다.
              */}

              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  <col />
                  <col style={{ width: '108px' }} />
                  <col style={{ width: '64px' }} />
                  <col style={{ width: '96px' }} />
                  <col style={{ width: '62px' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    <th style={th}>내용</th>
                    <th style={{ ...th, textAlign: 'right' }}>금액</th>
                    <th style={th}>은행</th>
                    <th style={th}>날짜</th>
                    <th style={{ ...th, textAlign: 'center' }}>관리</th>
                  </tr>
                  {/* 맨 위 추가 줄. 여기서 친 줄이 아래 목록 맨 위에 쌓인다 */}
                  {canEdit && (
                    <tr style={{ background: '#fbfcfe', borderBottom: '1px solid var(--border-color)' }}>
                      <td style={cellPad}>
                        <input
                          list={`labels-${column.group}`}
                          value={d.label || ''}
                          onChange={(e) => setDraftField(column.group, 'label', e.target.value)}
                          onKeyDown={addOnEnter}
                          placeholder="내용 (예: 주유비)"
                          style={addCell}
                        />
                      </td>
                      <td style={cellPad}>
                        <MoneyInput
                          value={d.amount ?? ''}
                          onChange={(e) => setDraftField(column.group, 'amount', e.target.value)}
                          onKeyDown={addOnEnter}
                          placeholder="금액"
                          style={addCell}
                        />
                      </td>
                      <td style={cellPad}>
                        <input
                          list="ledger-banks"
                          value={d.bank ?? 'B'}
                          onChange={(e) => setDraftField(column.group, 'bank', e.target.value)}
                          onKeyDown={addOnEnter}
                          placeholder="은행"
                          style={addCell}
                        />
                      </td>
                      <td style={cellPad}>
                        <DateText
                          value={d.date || ''}
                          onChange={(v) => setDraftField(column.group, 'date', v)}
                          style={addCell}
                        />
                      </td>
                      <td style={{ ...cellPad, textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => addFromDraft(column)}
                          title="추가 (Enter)"
                          style={{ background: column.accent, color: '#fff', border: 'none', width: '100%', padding: '0.4rem 0', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          <Plus size={12} style={{ verticalAlign: '-2px' }} />추가
                        </button>
                      </td>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {rows.map((e) => {
                    if (e.placeholder) {
                      return (
                        <tr key={e._id} style={{ borderBottom: '1px solid var(--border-color)', background: '#fcf7f7' }}>
                          <td style={{ ...cellPad, fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)' }}>{e.placeholder.label}</td>
                          <td colSpan={3} style={{ ...cellPad, fontSize: '0.74rem', color: 'var(--text-muted)' }}>아직 적지 않았습니다</td>
                          <td style={{ ...cellPad, textAlign: 'center' }}>
                            {canEdit && (
                              <button type="button" onClick={() => fillFixedSingle(e.placeholder)} title={`${e.placeholder.label} 입력`} style={{ ...iconBtn(column.accent), fontSize: '0.74rem', fontWeight: '700' }}>
                                입력
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }
                    const editing = editingId === e._id;
                    const auto = e.source && e.source !== 'manual';
                    return (
                      <tr
                        key={e._id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          background: editing ? '#fffbe6' : (e.fixedRow ? '#fcf7f7' : (auto && !e.locked ? '#f4f8ff' : '#fff'))
                        }}
                      >
                        {editing ? (
                          <>
                            <td style={cellPad}>
                              <input
                                list={`labels-${column.group}`}
                                value={e.label || ''}
                                onChange={(ev) => updateEntry(e._id, 'label', ev.target.value)}
                                placeholder="내용"
                                autoFocus
                                style={editCell}
                              />
                            </td>
                            <td style={cellPad}>
                              <MoneyInput value={e.amount} onChange={(ev) => updateEntry(e._id, 'amount', ev.target.value)} style={editCell} />
                            </td>
                            <td style={cellPad}>
                              <input list="ledger-banks" value={e.bank || ''} onChange={(ev) => updateEntry(e._id, 'bank', ev.target.value)} style={editCell} />
                            </td>
                            <td style={cellPad}>
                              <DateText value={e.date || ''} onChange={(v) => updateEntry(e._id, 'date', v)} style={editCell} />
                            </td>
                            <td style={{ ...cellPad, textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <button type="button" onClick={() => setEditingId(null)} title="입력 마침" style={iconBtn('#2f6f4e')}>
                                <Check size={14} />
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td
                              style={{ ...cellPad, fontSize: '0.78rem', fontWeight: e.locked ? '700' : '400', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={auto
                                ? `${e.label} — 계약·청구·차량 정보에서 자동으로 가져온 줄입니다${e.locked ? ' (직접 고쳐서 더 이상 자동으로 바뀌지 않습니다)' : ''}`
                                : e.label}
                            >
                              {/* 예전 '기타' 열에 적었던 줄은 표시를 달아 구분한다 */}
                              {e.group === '기타' && (
                                <span style={{ fontSize: '0.66rem', fontWeight: '700', color: '#4a6fa5', background: '#eef3fa', borderRadius: '4px', padding: '0.05rem 0.3rem', marginRight: '0.3rem' }}>기타</span>
                              )}
                              {e.label || <span style={{ color: 'var(--text-muted)' }}>(내용 없음)</span>}
                            </td>
                            <td style={{ ...cellPad, fontSize: '0.78rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{toCommaString(e.amount)}</td>
                            <td style={{ ...cellPad, fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bankText(e.bank)}>
                              {e.bank || '-'}
                            </td>
                            <td style={{ ...cellPad, fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{e.date || '-'}</td>
                            <td style={{ ...cellPad, textAlign: 'center', whiteSpace: 'nowrap' }}>
                              {canEdit && (
                                <>
                                  <button type="button" onClick={() => setEditingId(e._id)} title="수정" style={iconBtn('var(--primary)')}>
                                    <Pencil size={13} />
                                  </button>
                                  <button type="button" onClick={() => removeRow(e._id)} title="삭제" style={iconBtn('var(--error)')}>
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>아직 적은 내역이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* 단기렌트 차는 견적서 3년·선수금 30%·잔가 0% 월 렌트료를 매달 벌어 오는지 본다 */}
      {ledger.ledgerType === '단기렌트' && (
        <ShortTermTargetPanel
          ledgerId={ledger._id}
          reloadKey={ledger.updatedAt}
          canEdit={canEdit}
          authHeaders={authHeaders}
          showToast={showToast}
        />
      )}

      {/* 수익성 검토 - 견적서에서 잡아 둔 비용과 원장에 실제로 나간 돈을 비교한다 */}
      <ProfitReview
        ledgerId={ledger._id}
        entries={entries}
        terms={ledger.terms}
        periods={periods}
        rentBySeq={rentBySeq}
        billingRounds={billingRounds}
        memo={ledger.profitReport}
        canEdit={canEdit}
        isAdmin={currentUser?.role === 'admin'}
        closed={ledger.status === '거래완료'}
        showToast={showToast}
        onMemoChange={(v) => { setLedger((prev) => ({ ...prev, profitReport: v })); setDirty(true); }}
        maturityPlan={ledger.maturityPlan}
        onMaturityChange={(v) => { setLedger((prev) => ({ ...prev, maturityPlan: v })); setDirty(true); }}
      />

      <datalist id="ledger-banks">
        {BANKS.map((b) => <option key={b} value={b}>{BANK_LABELS[b] || b}</option>)}
      </datalist>
      {/* 합친 열은 예전 열에서 쓰던 항목명도 함께 추천한다 */}
      {COLUMNS.map((column) => (
        <datalist key={column.group} id={`labels-${column.group}`}>
          {[...new Set(column.includes.flatMap((g) => labelHints[g] || []))].map((l) => <option key={l} value={l} />)}
        </datalist>
      ))}

      {/* 계약 조건·구간과 회사 할부·대출은 입력칸이라 평소에는 접어 둔다(대표님 2026-10-29, 수익성 검토 정리).
          조건이 아직 없는 갑지는 펼쳐서 바로 적게 한다. */}
      <details open={!ledger.contractPeriods?.length && !Number(t.monthlyRent)} style={{ ...card, padding: '0.8rem 1.2rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.88rem', fontWeight: '800' }}>
          계약 조건 · 회사 할부 (입력칸)
          <span style={{ fontSize: '0.74rem', fontWeight: '600', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
            {periodName(periods[periods.length - 1]?.seq || 1)} 월 {toCommaString(periods[periods.length - 1]?.monthlyRent || t.monthlyRent || 0)}원
            {periods[periods.length - 1]?.termMonths || t.termMonths ? ` · ${periods[periods.length - 1]?.termMonths || t.termMonths}개월` : ''}
            {t.paymentDay ? ` · 결제일 ${t.paymentDay}` : ''}
            {loan.executed ? ' · 회사 할부 실행함' : ''}
          </span>
        </summary>
        <div style={{ display: 'grid', gap: '1rem', marginTop: '0.8rem' }}>
      {/* 계약 조건 · 구간. 최초 계약과 연장마다 한 줄. 예전에는 '계약 구간'과 '고정 조건(마지막 계약만)'이 따로 있어
          보증금·인수가가 어느 계약 것인지 안 보였다(대표님 2026-10-23, 화우 Benz-003) */}
      <div style={{ ...card, padding: '1.2rem' }}>
        <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', fontWeight: '800' }}>계약 조건 · 구간</h5>
        <p style={{ margin: '0 0 0.9rem', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          최초 계약과 연장 계약을 한 줄씩 적습니다. 지금 유효한 조건은 맨 아래 줄이고, 청구·수익성 계산은 이 줄 값을 씁니다.
          연장해도 갑지는 나누지 않습니다 — 나누면 차량가가 있는 최초 계약은 적자로, 연장 계약은 폭리로 보입니다.
          여기서 고친 값은 이 갑지 안에서만 쓰이고 계약서·차량 DB로는 넘어가지 않습니다.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '960px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)' }}>
                {['구간', '계약번호', '시작일', '종료일', '기간(개월)', '월 렌트료', '보증금', '선납금', '인수가', '1회차 출금일'].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i >= 4 && i !== 9 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p, idx) => {
                const stored = Boolean(ledger.contractPeriods?.length);
                const isLast = idx === periods.length - 1;
                const valueOf = (key) => {
                  // 엑셀에서 옮긴 갑지는 인수가가 구간이 아니라 고정 조건에만 들어 있다(Benz-017 덕신설비). 마지막 구간은 그 값을 보여 준다
                  if (stored && key === 'takeoverPrice' && isLast && (p[key] === undefined || p[key] === null || p[key] === '')) return t.takeoverPrice;
                  if (stored) return p[key];
                  if (key === 'startDate') return ledger.header?.contractedAt;
                  if (key === 'endDate') return ledger.header?.contractEndAt;
                  return t[key];
                };
                const cellInput = { width: '100%', padding: '0.3rem 0.35rem', border: '1px solid var(--border-color)', borderRadius: '5px', fontSize: '0.78rem', boxSizing: 'border-box', background: '#fff' };
                // 0원이면 비워 두고 안내 글(승계·-)이 보이게 한다
                const money = (key, placeholder) => (
                  <MoneyInput value={placeholder && !Number(valueOf(key)) ? '' : (valueOf(key) ?? '')} onChange={(e) => setPeriodField(p.seq, key, e.target.value)} disabled={!canEdit}
                    placeholder={placeholder} style={{ ...cellInput, textAlign: 'right' }} />
                );
                const date = (key) => (
                  <input type="date" value={toDateInput(valueOf(key))} onChange={(e) => setPeriodField(p.seq, key, e.target.value)}
                    disabled={!canEdit} style={cellInput} />
                );
                const td = { padding: '0.35rem 0.3rem', verticalAlign: 'middle' };
                return (
                  <tr key={p.seq} style={{ borderBottom: '1px solid var(--border-color)', background: isLast && periods.length > 1 ? '#f7f9fd' : undefined }}>
                    <td style={{ ...td, fontWeight: '700', whiteSpace: 'nowrap' }}>
                      {periodName(p.seq)}
                      {isLast && periods.length > 1 && <div style={{ fontSize: '0.68rem', fontWeight: '600', color: 'var(--primary)' }}>지금 계약</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{p.contractNo || '-'}</td>
                    <td style={{ ...td, minWidth: '118px' }}>{date('startDate')}</td>
                    <td style={{ ...td, minWidth: '118px' }}>{date('endDate')}</td>
                    <td style={{ ...td, width: '64px' }}>
                      <input type="number" value={valueOf('termMonths') ?? ''} onChange={(e) => setPeriodField(p.seq, 'termMonths', e.target.value)}
                        disabled={!canEdit} style={{ ...cellInput, textAlign: 'right' }} />
                    </td>
                    <td style={{ ...td, minWidth: '100px' }}>{money('monthlyRent')}</td>
                    {/* 연장 때 보증금은 대개 그대로 이어간다. 새로 받은 돈이 없으면 0(승계)으로 둔다 — 넣으면 보증금이 두 번 들어온 것이 된다 */}
                    <td style={{ ...td, minWidth: '100px' }}>{money('deposit', p.seq > 1 ? '승계' : '')}</td>
                    <td style={{ ...td, minWidth: '90px' }}>{money('advancePayment')}</td>
                    {/* 인수가는 차를 넘길 때 한 번 받는다. 계산에는 마지막 구간 것만 쓴다 */}
                    <td style={{ ...td, minWidth: '100px' }}>
                      {money('takeoverPrice', isLast ? '' : '-')}
                      {/* 인수할 때 보증금을 인수가에서 빼고 나머지만 받는다(화우: 22,105,860 − 12,360,000 = 9,745,860) */}
                      {/* 계약이 끝났는데 보증금이 남아 있으면 인수가와 상계한 것(대표님 2026-10-28) */}
                      {isLast && summary.takeoverOffset > 0 ? (
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: '0.15rem', whiteSpace: 'nowrap' }}>
                          보증금 {toCommaString(summary.takeoverOffset)}과 상계
                        </div>
                      ) : isLast && Number(valueOf('takeoverPrice')) > 0 && Number(t.deposit) > 0 && (
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: '0.15rem', whiteSpace: 'nowrap' }}>
                          보증금 빼고 받을 돈 {toCommaString(Number(valueOf('takeoverPrice')) - Number(t.deposit))}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, minWidth: '118px' }}>{date('rentStartDate')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.8rem', fontSize: '0.76rem' }}>
          <label style={{ fontWeight: '700', color: 'var(--text-muted)' }}>결제일</label>
          <input value={t.paymentDay ?? ''} onChange={(e) => setTermsField('paymentDay', e.target.value)} disabled={!canEdit}
            style={{ width: '140px', padding: '0.3rem 0.4rem', border: '1px solid var(--border-color)', borderRadius: '5px', fontSize: '0.78rem' }} />
          {periods.length > 1 && (
            <span style={{ color: 'var(--text-muted)' }}>
              보증금 보관 {toCommaString(t.deposit || 0)}원 (연장 구간 보증금이 비어 있으면 승계)
            </span>
          )}
        </div>
      </div>

      {/* 회사 할부 · 대출 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>

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
        </div>
      </details>

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
