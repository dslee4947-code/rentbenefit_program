import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Plus, Save, Trash2, RefreshCw, ArrowLeft, Link2, Printer, FileSpreadsheet, ArrowUp, ArrowDown, CalendarPlus, Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { toCommaString } from '../../utils/format.js';
import MoneyInput from './MoneyInput.jsx';
import { useSaveShortcut } from './useSaveShortcut.js';
import { calculateQuoteOption } from '../../../../shared/quoteCalc.js';

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
  { key: 'purchasedAt', label: '구매일' },
  { key: 'contractEndAt', label: '계약종료일' },
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
  const base = new Date(`${String(start).slice(0, 10)}T00:00:00`);
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
function RoundChecklist({ title, verb, accent, tint, blocks, canEdit, askAmount, onPay, onCancel, onAddRound, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const [paying, setPaying] = useState(null); // { key, round, date, amount }

  const all = blocks.flatMap((b) => b.rounds);
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
                  return (
                    <tr key={r.round} style={{ borderBottom: '1px solid var(--border-color)', background: r.paid ? '#fff' : '#fffdf7' }}>
                      <td style={{ ...cellPad, fontSize: '0.78rem', fontWeight: '700' }}>{r.round}회</td>
                      {hasDue && <td style={{ ...cellPad, fontSize: '0.74rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.dueDate || '-'}</td>}
                      <td style={{ ...cellPad, fontSize: '0.78rem', textAlign: 'right', whiteSpace: 'nowrap', color: r.paid ? 'inherit' : 'var(--text-muted)' }}>
                        {isPaying && askAmount ? (
                          <MoneyInput
                            value={paying.amount}
                            onChange={(ev) => setPaying((p) => ({ ...p, amount: ev.target.value }))}
                            onKeyDown={payKeys}
                            placeholder="금액"
                            style={editCell}
                          />
                        ) : (r.paid ? toCommaString(r.paidAmount) : (b.defaultAmount ? toCommaString(b.defaultAmount) : '-'))}
                        {r.note && !isPaying && (
                          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }} title="자동이체 수수료를 떼고 들어온 회차입니다">{r.note}</div>
                        )}
                      </td>
                      <td style={{ ...cellPad, whiteSpace: 'nowrap' }}>
                        {r.paid ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', justifyContent: 'center' }}>
                            <Check size={13} color={accent} />
                            <span style={{ fontSize: '0.74rem', color: accent, fontWeight: '700' }}>{r.paidDate || '날짜 없음'}</span>
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
                        ) : canEdit ? (
                          <button
                            type="button"
                            onClick={() => startPay(b, r.round)}
                            style={{ width: '100%', border: `1px solid ${accent}`, background: '#fff', color: accent, borderRadius: '6px', padding: '0.25rem 0', fontSize: '0.74rem', fontWeight: '700', cursor: 'pointer' }}
                          >
                            {verb} 완료
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>미{verb}</span>
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

/**
 * 견적서에서 이 차의 계산 결과를 꺼낸다.
 *
 * 견적서에는 계산 결과가 아니라 입력값(comparisonVehicles)이 저장돼 있어서 견적 화면과 같은 식으로
 * 다시 계산한다. 비교 차량이 여러 대면 견적서를 저장할 때 보고 있던 차(activeVehicleId)를,
 * 안이 여러 개면 계약한 기간(pricing.paymentTerm)과 같은 안을 고른다.
 */
const quotePlanOf = (quote) => {
  const vehicles = quote?.comparisonVehicles || [];
  if (!vehicles.length) return null;
  const vehicle = vehicles.find((v) => v.id === quote.activeVehicleId) || vehicles[0];
  const options = vehicle.options || [];
  const term = Number(quote.pricing?.paymentTerm) || 0;
  const selectedId = (vehicle.selectedOptionIds || [])[0];
  const opt = options.find((o) => term && Math.round(Number(o.termYears) * 12) === term)
    || options.find((o) => o.id === selectedId)
    || options[0];
  if (!opt) return null;
  try {
    const calc = calculateQuoteOption(opt, vehicle);
    const years = Number(opt.termYears) || 0;
    const maintenanceOn = opt.isMaintenanceEnabled !== undefined ? opt.isMaintenanceEnabled !== false : vehicle.isMaintenanceEnabled !== false;
    return {
      months: Math.round(years * 12),
      baseInsurance: (Number(vehicle.globalInsuranceFee) || 0) * years,
      ownCarInsurance: (calc.ownCarInsuranceFee || 0) * years,
      pandanbi: calc.pandanbi || 0,
      benefitFee: calc.companyCommission || 0,
      maintenanceOn,
      maintenanceFee: calc.maintenanceFeeTotal || 0,
      tireFee: calc.tireCostTotal || 0,
      // 견적 원가에는 베네핏 수수료가 들어 있다. 수수료도 회사 몫이라 예상 이익에서는 원가에서 빼고 본다.
      costExCommission: (calc.totalCost || 0) - (calc.companyCommission || 0),
      quoteMonthlyRent: calc.monthlyLeaseFee || 0,
      takeoverPrice: calc.takeoverPrice || 0,
      advancePayment: calc.advancePayment || 0
    };
  } catch {
    return null;
  }
};

// 운영하면서 나간 돈으로 보지 않는 분류. 차를 사고 등록하고 세금·보험·할부를 내는 돈은 판관비가 아니다.
// 차량작업(썬팅·PPF·블랙박스 등)은 판관비가 아니라 판매 수수료에서 충당하므로 따로 본다.
// 대출금(캐피탈·렌공에서 빌려 들어온 돈)과 할부금(그 상환)은 차를 사는 돈이라 운영비가 아니다.
const NOT_OPERATING = new Set(['계약금', '차량가', '등록비용', '할부이자', '할부금', '대출금', '보험', '자동차세', '검사비', '제세공과', '수리·사고', '정기점검', '차량작업']);
const TIRE_LABEL = /타이어/;

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

function Section({ no, title, children }) {
  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.7rem 0.8rem' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: '800', marginBottom: '0.45rem' }}>{no}. {title}</div>
      {children}
    </div>
  );
}

const Divider = () => <div style={{ borderTop: '1px dashed var(--border-color)', margin: '0.35rem 0' }} />;

/**
 * 수익성 검토.
 *
 * 견적서에서 잡아 둔 비용(보험·자차·판관비·베네핏 수수료·정비)과 원장에 실제로 쌓인 출금을 나란히 놓는다.
 * 견적이 맞았는지, 어디서 새고 있는지를 차 한 대 단위로 보려는 칸이다.
 * 계약 구간을 골라 봐도 이 칸은 차 1대 전체 기준이다. 견적이 차 1대 전체 기간을 놓고 계산한 값이기 때문이다.
 */
function ProfitReview({ ledgerId, entries, terms, periods, rentBySeq, memo, maturityPlan, canEdit, onMemoChange, onMaturityChange }) {
  const [state, setState] = useState({ loading: true, quote: null, estimate: null, reason: '' });

  useEffect(() => {
    let alive = true;
    fetch(`${API_HOST}/api/ledgers/${ledgerId}/quote`)
      .then((res) => (res.ok ? res.json() : { quote: null, reason: '견적서를 불러오지 못했습니다.' }))
      .then((data) => { if (alive) setState({ loading: false, quote: data.quote, estimate: data.estimate || null, reason: data.reason || '' }); })
      .catch(() => { if (alive) setState({ loading: false, quote: null, estimate: null, reason: '견적서를 불러오지 못했습니다.' }); });
    return () => { alive = false; };
  }, [ledgerId]);

  // 견적서가 없으면 서버가 렌트차량 DB 값으로 같은 식을 돌려 준 추정치(estimate)로 비교한다
  const quotePlan = useMemo(() => quotePlanOf(state.quote), [state.quote]);
  const plan = quotePlan || state.estimate;

  const actual = useMemo(() => {
    const out = { insurance: 0, repair: 0, maintenance: 0, tire: 0, operating: 0, operatingByCat: {}, rentReceived: 0, salesCommission: 0, vehicleWork: 0, fines: 0, rentExtra: 0 };
    entries.forEach((e) => {
      const amount = Number(e.amount) || 0;
      if (!amount) return;
      if (e.side === '입금') {
        if (rentRoundOf(e) || e.category === '렌트료') {
          out.rentReceived += amount;
          // 월 렌트료보다 더 받은 금액. 과태료·미납통행료를 다음 렌트료에 얹어 받은 돈이다.
          const monthly = rentBySeq[e.periodSeq || 1] || 0;
          if (monthly && amount > monthly) out.rentExtra += amount - monthly;
        } else if (isSalesCommission(e)) out.salesCommission += amount;
        return;
      }
      const cat = e.category || '기타';
      if (TIRE_LABEL.test(e.label || '')) { out.tire += amount; return; }
      if (cat === '과태료·통행료') out.fines += amount;
      else if (cat === '차량작업') out.vehicleWork += amount;
      else if (cat === '보험') out.insurance += amount;
      else if (cat === '수리·사고') out.repair += amount;
      else if (cat === '정기점검') out.maintenance += amount;
      else if (!NOT_OPERATING.has(cat)) {
        out.operating += amount;
        out.operatingByCat[cat] = (out.operatingByCat[cat] || 0) + amount;
      }
    });

    /**
     * 과태료·미납통행료는 회사가 먼저 내고 다음 달 렌트료에 얹어 받는다.
     * 렌트료로 더 받은 만큼은 돌려받은 돈이라 운영비가 아니다. 덜 받은 나머지만 운영비로 남긴다.
     * 더 받은 돈이 과태료보다 많아도(연체 이자 등) 과태료 금액까지만 회수로 본다.
     */
    out.finesRecovered = Math.min(out.fines, out.rentExtra);
    const finesLeft = out.fines - out.finesRecovered;
    if (finesLeft > 0) {
      out.operating += finesLeft;
      out.operatingByCat['과태료·통행료 (미회수)'] = finesLeft;
    }
    return out;
  }, [entries, rentBySeq]);

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
    const insuranceBudget = plan.baseInsurance + plan.ownCarInsurance;
    const ownLeft = plan.ownCarInsurance - actual.repair;
    const pandanbiLeft = plan.pandanbi - actual.operating;
    const opCats = Object.entries(actual.operatingByCat).sort((a, b) => b[1] - a[1]);
    const commissionNet = actual.salesCommission - actual.vehicleWork;

    /**
     * 예상 이익 = 지금 받는 월 렌트료로 계약 기간을 채웠을 때의 매출 - 견적에서 잡아 둔 비용.
     *
     * 월 렌트료·인수가·선납금은 원장 고정 조건(실제 계약)을 먼저 쓰고, 비어 있으면 견적 값을 쓴다.
     * 보증금은 돌려줄 돈이라 매출에 넣지 않는다.
     * 기간은 견적 기간이다. 비용이 그 기간을 놓고 잡힌 값이라 기간을 바꾸면 비교가 맞지 않는다.
     *
     * 연장한 갑지는 구간마다 렌트료 × 기간을 더한다. 차를 인수하는 건 마지막 구간이 끝날 때라
     * 인수가도 마지막 구간 것만 넣는다. 연장 구간의 보험·세금은 견적에 없어 비용에서 빠져 있다.
     */
    const multi = (periods || []).length > 1;
    const rentLines = multi
      ? periods.map((p) => {
        const monthly = Number(p.monthlyRent) || 0;
        const months = Number(p.termMonths) || (p.seq === 1 ? plan.months : 0);
        return { key: p.seq, label: `${periodName(p.seq)} ${toCommaString(monthly)} × ${months}개월`, months, total: monthly * months };
      })
      : [{ key: 1, months: plan.months, total: (Number(terms?.monthlyRent) || plan.quoteMonthlyRent || 0) * plan.months }];
    const rent = multi ? Number(periods[periods.length - 1].monthlyRent) || 0 : Number(terms?.monthlyRent) || plan.quoteMonthlyRent || 0;
    const takeover = multi
      ? Number(periods[periods.length - 1].takeoverPrice) || 0
      : Number(terms?.takeoverPrice) || plan.takeoverPrice || 0;
    const advance = multi
      ? periods.reduce((sum, p) => sum + (Number(p.advancePayment) || 0), 0)
      : Number(terms?.advancePayment) || plan.advancePayment || 0;
    const totalMonths = rentLines.reduce((sum, l) => sum + l.months, 0);
    const rentTotal = rentLines.reduce((sum, l) => sum + l.total, 0);
    const returned = maturityPlan === '반납';
    // 반납이면 인수가가 들어오지 않는다. 대신 차를 중고차로 팔아 메워야 한다(아래 목표 매각가).
    const revenue = rentTotal + (returned ? 0 : takeover) + advance;
    const cost = plan.costExCommission || 0;
    // CMS 수수료는 견적에 없는 비용이다. 렌트료를 받는 회차마다 한 번씩 나간다.
    const cmsTotal = CMS_FEE * totalMonths;
    const expected = revenue - cost - cmsTotal;
    const operatingProfit = expected - plan.benefitFee;

    // 지금까지 실제 비용이 예상을 넘은 만큼은 이익에서 깎인다. 정비 미포함 고객의 정비비는 전부 예상 밖 비용이다.
    const maintenanceSpent = actual.maintenance + actual.tire;
    const overrun = Math.max(0, actual.insurance + actual.repair - insuranceBudget)
      + Math.max(0, actual.operating - plan.pandanbi)
      + (plan.maintenanceOn ? Math.max(0, maintenanceSpent - (plan.maintenanceFee + plan.tireFee)) : maintenanceSpent);
    // 판매 수수료와 차량작업비는 견적에 없는 돈이다. 수수료에서 작업비를 뺀 나머지가 이익에 더해진다.
    const adjusted = expected - overrun + commissionNet;

    /**
     * 만기 반납 차의 중고차 목표 매각가.
     *
     * 목표 이익은 "고객이 인수했다면 남았을 이익"(견적이 전제한 이익)이다. 반납이면 인수가가 빠져
     * 이익이 마이너스로 보이는데, 차를 팔아서 그 목표 이익까지 채우려면 최소 얼마를 받아야 하는지 낸다.
     *   목표 매각가 = 목표 이익 - 차를 팔기 전 이익(초과 비용·판매 수수료 반영)
     */
    const targetProfit = rentTotal + takeover + advance - cost - cmsTotal;
    // 인수가 없이 남는 이익. 반납이면 위 adjusted와 같고, 미정·인수일 때도 참고로 같은 기준으로 낸다.
    const beforeSale = rentTotal + advance - cost - cmsTotal - overrun + commissionNet;
    const targetSalePrice = targetProfit - beforeSale;
    const profitColor = (n) => (n >= 0 ? '#2f6f4e' : '#d9534f');

    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.8rem' }}>
        <div style={{ gridColumn: '1 / -1', border: '1px solid #c9d6ea', background: '#f7f9fd', borderRadius: '8px', padding: '0.8rem 0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '800' }}>예상 수익 (지금 월 렌트료 기준)</span>
            <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
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
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.3rem 1.6rem' }}>
            <div>
              {multi ? (
                <>
                  {rentLines.map((l) => <Row key={l.key} label={l.label} value={won(l.total)} muted />)}
                  <Row label={`렌트료 합계 (${totalMonths}개월)`} value={won(rentTotal)} />
                </>
              ) : (
                <>
                  <Row
                    label="월 렌트료"
                    value={`${won(rent)}${plan.quoteMonthlyRent && Math.round(plan.quoteMonthlyRent) !== Math.round(rent) ? ` (견적 ${toCommaString(plan.quoteMonthlyRent)})` : ''}`}
                  />
                  <Row label={`렌트료 합계 (${plan.months}개월)`} value={won(rentTotal)} muted />
                </>
              )}
              <Row label={returned ? '인수가 (반납이라 매출에서 뺌)' : '인수가'} value={won(returned ? 0 : takeover)} muted />
              <Row label="선납금" value={won(advance)} muted />
              <Row label="예상 매출" value={won(revenue)} strong />
              <Row label="예상 비용 (견적)" value={`- ${won(cost)}`} strong />
              <Row label={`CMS 자동이체 수수료 (${CMS_FEE}원 × ${totalMonths}회)`} value={`- ${won(cmsTotal)}`} muted />
              {multi && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  예상 비용은 최초 계약 기준입니다. 연장 구간의 보험료·자동차세 등은 들어 있지 않습니다.
                </div>
              )}
            </div>
            <div>
              <Row label="예상 이익 (베네핏 수수료 포함)" value={won(expected)} strong color={profitColor(expected)} />
              <Row label="· 베네핏 수수료" value={won(plan.benefitFee)} muted />
              <Row label="· 영업이익" value={won(operatingProfit)} muted />
              <Row label="매출 대비 이익률" value={revenue > 0 ? `${((expected / revenue) * 100).toFixed(1)}%` : '-'} muted />
              <Divider />
              <Row label="지금까지 예상보다 더 나간 비용" value={overrun ? `- ${won(overrun)}` : '없음'} color={overrun ? '#d9534f' : undefined} />
              <Row label="판매 수수료 − 차량작업비" value={`${commissionNet >= 0 ? '+ ' : '- '}${won(Math.abs(commissionNet))}`} color={commissionNet < 0 ? '#d9534f' : undefined} />
              <Row label="반영한 예상 이익" value={won(adjusted)} strong color={profitColor(adjusted)} />
              <Row label="지금까지 받은 렌트료" value={`${won(actual.rentReceived)} / ${won(rentTotal)}`} muted />
              <Meter used={actual.rentReceived} budget={rentTotal} />
            </div>
          </div>

          {returned ? (
            <div style={{ marginTop: '0.8rem', border: '1px solid #4a6fa5', background: '#fff', borderRadius: '8px', padding: '0.7rem 0.8rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: '800', color: '#4a6fa5', marginBottom: '0.4rem' }}>만기 반납 · 중고차 목표 매각가</div>
              <Row label="목표 이익 (고객이 인수했다면 남았을 이익)" value={won(targetProfit)} />
              <Row label="차를 팔기 전 이익 (반납 기준, 위 반영한 예상 이익)" value={won(beforeSale)} color={profitColor(beforeSale)} />
              <Divider />
              <Row label="중고차로 최소 이만큼은 받아야 합니다" value={won(targetSalePrice)} strong color="#4a6fa5" />
              <Row
                label="계약 인수가와 비교"
                value={`${won(takeover)} ${targetSalePrice >= takeover ? '+' : '-'} ${won(Math.abs(targetSalePrice - takeover))}`}
                muted
              />
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem', lineHeight: 1.5 }}>
                초과 비용이 생기거나 판매 수수료에서 작업비를 더 쓰면 목표 매각가가 그만큼 올라갑니다.
                보증금은 반납할 때 돌려주는 돈이라 계산에 넣지 않았습니다.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              만기에 반납받으면 목표 이익을 채우려면 중고차로 {won(targetSalePrice)} 이상 받아야 합니다.
            </div>
          )}
        </div>

        <Section no={1} title="보험료 · 자차보험료">
          <Row label="견적 보험료 (대인·대물 등)" value={won(plan.baseInsurance)} muted />
          <Row label="견적 자차보험료" value={won(plan.ownCarInsurance)} muted />
          <Row label="견적 보험료 합계" value={won(insuranceBudget)} strong />
          <Row label="실제 보험 납부" value={won(actual.insurance)} />
          <Meter used={actual.insurance} budget={insuranceBudget} />
          <Divider />
          <Row label="수리 · 사고 비용" value={won(actual.repair)} />
          <Row label="자차보험료에서 쓴 금액" value={won(Math.min(actual.repair, plan.ownCarInsurance))} />
          <Meter used={actual.repair} budget={plan.ownCarInsurance} />
          <Row label={ownLeft >= 0 ? '자차보험료 남은 금액' : '자차보험료 초과'} value={won(Math.abs(ownLeft))} strong color={ownLeft >= 0 ? '#2f6f4e' : '#d9534f'} />
        </Section>

        <Section no={2} title="판관비 · 베네핏 수수료 · 판매 수수료">
          <Row label="견적 판관비" value={won(plan.pandanbi)} strong />
          <Row label="베네핏 수수료" value={won(plan.benefitFee)} strong />
          <Divider />
          <Row label="판매 수수료 (SC 입금)" value={won(actual.salesCommission)} strong />
          <Row label="차량작업비 (썬팅·PPF·블랙박스 등)" value={won(actual.vehicleWork)} />
          {actual.salesCommission > 0 ? (
            <>
              {/* 판매 수수료 중 작업비로 쓴 비율. 내부 기준(50%)을 넘으면 빨강, 40%부터 주황 */}
              <Meter used={actual.vehicleWork} budget={actual.salesCommission} limit={VEHICLE_WORK_LIMIT_RATE * 100} />
              <Row label="작업비 빼고 남은 판매 수수료" value={won(commissionNet)} strong color={commissionNet >= 0 ? '#2f6f4e' : '#d9534f'} />
            </>
          ) : (
            <Row label="판매 수수료 입금이 아직 없습니다" value="" muted />
          )}
          <Divider />
          {actual.fines > 0 && (
            <>
              <Row label="과태료 · 미납통행료 (회사 대납)" value={won(actual.fines)} muted />
              <Row label="· 렌트료에 얹어 회수" value={`- ${won(actual.finesRecovered)}`} muted color="#2f6f4e" />
            </>
          )}
          <Row label="운영하며 들어간 비용" value={won(actual.operating)} />
          {opCats.map(([cat, sum]) => (
            <Row key={cat} label={`· ${cat}`} value={won(sum)} muted />
          ))}
          {opCats.length === 0 && <Row label="· 아직 없음" value="" muted />}
          <Meter used={actual.operating} budget={plan.pandanbi} />
          <Row label={pandanbiLeft >= 0 ? '판관비 남은 금액' : '판관비 초과'} value={won(Math.abs(pandanbiLeft))} strong color={pandanbiLeft >= 0 ? '#2f6f4e' : '#d9534f'} />
        </Section>

        <Section no={3} title={plan.maintenanceOn ? '정비 (정비 포함 고객)' : '정비 (정비 미포함 고객)'}>
          {plan.maintenanceOn ? (
            <>
              <Row label="견적 정비비 (정기점검 등)" value={won(plan.maintenanceFee)} muted />
              <Row label="실제 정기점검" value={won(actual.maintenance)} />
              <Meter used={actual.maintenance} budget={plan.maintenanceFee} />
              <Divider />
              <Row label="견적 타이어 교체비" value={won(plan.tireFee)} muted />
              <Row label="실제 타이어" value={won(actual.tire)} />
              <Meter used={actual.tire} budget={plan.tireFee} />
              <Divider />
              <Row
                label={(plan.maintenanceFee + plan.tireFee) - (actual.maintenance + actual.tire) >= 0 ? '정비 예산 남은 금액' : '정비 예산 초과'}
                value={won(Math.abs((plan.maintenanceFee + plan.tireFee) - (actual.maintenance + actual.tire)))}
                strong
                color={(plan.maintenanceFee + plan.tireFee) - (actual.maintenance + actual.tire) >= 0 ? '#2f6f4e' : '#d9534f'}
              />
            </>
          ) : (
            <>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                견적에 정비가 들어 있지 않은 고객입니다. 아래 금액은 회사가 대신 낸 정비 비용입니다.
              </div>
              <Row label="정기점검" value={won(actual.maintenance)} />
              <Row label="타이어" value={won(actual.tire)} />
            </>
          )}
        </Section>
      </div>
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
        {!quotePlan && state.estimate && (
          <div style={{ marginTop: '0.7rem', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {state.reason} 그래서 렌트차량 DB 값에 견적서 계산식을 돌린 추정치입니다. 가정한 값: {state.estimate.assumptions.join(' · ')}
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
function LedgerView({ showToast, currentUser }) {
  const canEdit = currentUser?.role !== 'viewer';

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
  const [ledgers, setLedgers] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  // 기본은 차량 구매일 최신순. 새로 들인 차가 맨 위에 와야 자금팀이 방금 산 차를 바로 찾는다.
  const [sortKey, setSortKey] = useState('purchasedAt');
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
    setSortKey('purchasedAt'); setSortOrder('desc');
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
    return shown
      .map((p) => {
        const seq = p.seq || 1;
        const monthlyRent = Number(p.monthlyRent) || (seq === 1 ? Number(terms.monthlyRent) || 0 : 0);
        const termMonths = Number(p.termMonths) || (seq === 1 ? Number(terms.termMonths) || 0 : 0);
        const start = seq === 1 ? (terms.rentStartDate || p.startDate) : p.startDate;

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
      });
  }, [ledger, periods, periodView, entries]);

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
    setEntries((prev) => [{
      _id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      isNew: true,
      side: '입금',
      group: '고객입금',
      category: '렌트료',
      label: `렌트료 ${round}회차${tag}`,
      amount: block.monthlyRent,
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
            <option value="createdAt:desc">최근 만든 순</option>
            {SORTABLE.filter((c) => c.key).flatMap((c) => ([
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} 오름차순</option>,
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} 내림차순</option>
            ]))}
          </select>
          {(query || statusFilter || typeFilter || sortKey !== 'purchasedAt' || sortOrder !== 'desc') && (
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
                    <td style={{ padding: '0.55rem 0.4rem', whiteSpace: 'nowrap' }}>{toDateInput(l.purchasedAt) || '-'}</td>
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
                    <span style={{ color: 'var(--text-muted)' }}>{bankText(r.bank)}</span>
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
                  onPay={payRentRound} onCancel={cancelRentRound}
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
                  onPay={payExpenseRound} onCancel={cancelExpenseRound}
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

      {/* 수익성 검토 - 견적서에서 잡아 둔 비용과 원장에 실제로 나간 돈을 비교한다 */}
      <ProfitReview
        ledgerId={ledger._id}
        entries={entries}
        terms={ledger.terms}
        periods={periods}
        rentBySeq={rentBySeq}
        memo={ledger.profitReport}
        canEdit={canEdit}
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
