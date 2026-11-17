import { useState } from 'react';
import { X } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';
import { READ_SOURCE, consumablesOf } from './serviceDocs.js';
import { HistoryFilterRow, FilterBadge } from './ServiceHistoryFilter.jsx';
import { filterHistory, filterActive, kstYmd } from './serviceHistoryFilter.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 서버(utils/vehicleServicePlan.js, models/VehicleService.js)와 같은 값
const KINDS = ['자동차검사', '정기점검', '소모품교환', '고장수리', '사고수리', '기타'];
const STATUSES = ['예정', '입고', '수리 중', '완료'];
const METHODS = ['직원', '외주 탁송', '센터 픽업·딜리버리', '고객 직접'];
const PAYERS = ['자차 보험', '상대방 보험', '보증·리콜(무상)', '회사 부담', '고객 부담'];
const FUELS = ['', '바닥', '1/4', '1/2', '3/4', '가득'];
const CONSUMABLES = ['엔진오일·오일필터', '에어필터', '에어컨 필터', '브레이크 패드(앞)', '브레이크 패드(뒤)', '브레이크 오일', '타이어', '와이퍼', '배터리', '냉각수'];

const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;
const won = (n) => `${Math.round(n).toLocaleString()}원`;

/** Date → datetime-local 값(한국 시간) */
const toLocalInput = (d) => {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const k = new Date(t.getTime() - t.getTimezoneOffset() * 60000);
  return k.toISOString().slice(0, 16);
};

const emptyLeg = (method = '직원') => ({ method, from: '', to: '', person: '', distanceKm: '', vendor: '', fee: '' });

/**
 * @param {object|null} record 고칠 기록
 * @param {{kind: string, date: string, status?: string}} [preset] 달력 빈칸을 눌러 새로 적을 때. 앞날이면 '예정'으로 입고 날에, 지난 날·오늘이면 '완료'로 출고 날에 넣는다.
 *   status를 주면 그 상태로 연다. 정기점검 목록의 [일정 잡기]는 '예정', [완료 처리]는 잡아 둔 기록을 '완료'로 연다.
 */
const formOf = (record, preset) => {
  const blank = { callAfterIn: '', callGuide: '', callAfterOut: '', mood: '', contactName: '', contactPhone: '', nextTodo: '' };
  if (!record) {
    const future = preset?.status === '예정' || (preset?.date && preset.date > new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));
    return {
      ...blank,
      kind: preset?.kind || '정기점검', status: future ? '예정' : '완료', staff: '', shop: '',
      inAt: future ? `${preset.date}T10:00` : '', outAt: preset?.date && !future ? `${preset.date}T18:00` : '', mileageIn: '', mileageOut: '', fuelIn: '', fuelOut: '',
      transport: { in: emptyLeg(), out: emptyLeg() },
      payer: '', insurer: '', claimNo: '', fault: '', deductible: '', loaner: '',
      costs: { repair: '', vat: '', insurancePaid: '' },
      request: '', description: '', memo: '', parts: [], consumables: [], lines: [], invoice: null, carAgeExtended: false
    };
  }
  const leg = (l) => ({ ...emptyLeg(l?.method || ''), ...Object.fromEntries(Object.entries(l || {}).map(([k, v]) => [k, v ?? ''])) });
  return {
    ...blank,
    callAfterIn: record.callAfterIn || '', callGuide: record.callGuide || '', callAfterOut: record.callAfterOut || '', mood: record.mood || '',
    contactName: record.contactName || '', contactPhone: record.contactPhone || '', nextTodo: record.nextTodo || '',
    kind: record.kind, status: preset?.status || record.status || '완료', staff: record.staff || '', shop: record.shop || '',
    // 예전 간단 양식 기록은 입고·출고 시각이 없다. 날짜를 출고로 보여 준다.
    // 잡아 둔 일정을 완료로 열면 출고는 오늘로 채운다(받은 날이 다음 점검을 세는 기준이 된다).
    inAt: toLocalInput(record.inAt),
    outAt: toLocalInput(record.outAt || (preset?.status === '완료' && record.status !== '완료' ? new Date() : !record.inAt ? record.date : null)),
    mileageIn: record.mileageIn ?? '', mileageOut: record.mileageOut ?? (record.mileageIn ? '' : record.mileage ?? ''),
    fuelIn: record.fuelIn || '', fuelOut: record.fuelOut || '',
    transport: { in: leg(record.transport?.in), out: leg(record.transport?.out) },
    payer: record.payer || '', insurer: record.insurer || '', claimNo: record.claimNo || '', fault: record.fault || '',
    deductible: record.deductible ?? '', loaner: record.loaner || '',
    costs: { repair: record.costs?.repair ?? (record.costs ? '' : record.amount || ''), vat: record.costs?.vat ?? '', insurancePaid: record.costs?.insurancePaid ?? '' },
    request: record.request || '', description: record.description || '', memo: record.memo || '',
    parts: record.parts || [], consumables: record.consumables || [], carAgeExtended: Boolean(record.carAgeExtended),
    lines: (record.lines || []).map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v ?? '']))), invoice: record.invoice || null
  };
};

// ── 지난 기록에서 따라오는 값 ──
// 새 기록을 열면 같은 종류의 지난 기록에서 연락처·픽업지·정비소를 가져온다(대표님 2026-11-17).
// 정기점검이면 지난 정기점검의 스피드메이트·블루핸즈 지점, 타이어(소모품교환)면 쌍성처럼 종류마다 다니던 곳이 따라온다.
// 연락처·픽업지는 같은 종류에 없으면 이 차의 가장 최근 기록에서 가져온다. 비어 있는 칸만 채운다.
const SHOP_PLACEHOLDER = /^\s*입고지\s*\/\s*담당자\s*$/;
const isAutoMemo = (m) => /^(구글 캘린더 이관|원장 이관|부가세 줄)/.test(String(m || ''));
const doneOf = (history) => (history || []).filter((r) => !r.status || r.status === '완료')
  .sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1));
const previousOf =(history, kind) => doneOf(history).find((r) => r.kind === kind) || null;

// 연락처는 렌트차량 DB의 운전자가 먼저다(대표님 2026-11-17). 없으면 지난 기록, 그것도 없으면 계약 담당자(driver.source가 계약…).
const prefillFrom = (history, kind, f, driver) => {
  const done = doneOf(history);
  const same = done.find((r) => r.kind === kind);
  const latest = (pick) => [same, ...done].find((r) => r && pick(r));
  const next = { ...f, transport: { in: { ...f.transport.in }, out: { ...f.transport.out } } };
  const filled = [];
  const shopRec = latest((r) => r.kind === kind && r.shop && !SHOP_PLACEHOLDER.test(r.shop));
  if (!f.shop && shopRec) { next.shop = shopRec.shop; filled.push('정비소'); }
  const hasDriver = driver && (driver.name || driver.phone);
  const contact = latest((r) => r.contactName || r.contactPhone);
  if (!f.contactName && !f.contactPhone) {
    if (hasDriver && driver.source === '운전자') {
      next.contactName = driver.name || '';
      next.contactPhone = driver.phone || '';
      filled.push('운전자 연락처');
    } else if (contact) {
      next.contactName = contact.contactName || '';
      next.contactPhone = contact.contactPhone || '';
      filled.push('연락처');
    } else if (hasDriver) {
      next.contactName = driver.name || '';
      next.contactPhone = driver.phone || '';
      filled.push(`${driver.source} 연락처`);
    }
  }
  const pickup = latest((r) => r.transport?.in?.from || r.transport?.out?.to);
  if (pickup) {
    const pi = pickup.transport?.in || {};
    const po = pickup.transport?.out || {};
    if (!f.transport.in.from && pi.from) { next.transport.in.from = pi.from; next.transport.in.method = pi.method || next.transport.in.method; filled.push('픽업지'); }
    if (!f.transport.out.to && (po.to || pi.from)) { next.transport.out.to = po.to || pi.from; next.transport.out.method = po.method || pi.method || next.transport.out.method; }
  }
  return { next, filled };
};

// ── 캘린더 AS 서식 붙여 넣기 ──
// 직원들이 구글 캘린더에 쓰는 서식(진행일자 / 진행자 - < 차종 / 차량번호 > AS (입고지 / 담당자) …)을 그대로 붙여 넣으면 칸을 채운다.
// 서식에 남은 안내 글자(픽업장소, 주행거리 km 등)는 비어 있는 것으로 본다.
const PLACEHOLDER = /^(픽업장소|픽업시간|픽업시 인도자|인도장소|인도시간|인도시 인수자|주행거리\s*km|주유상태|픽업방법|인도방법|입고지|담당자|진행자|진행일자|없음)$/;
const clean = (v) => {
  const t = String(v || '').trim();
  return PLACEHOLDER.test(t) ? '' : t;
};
const lineOf = (text, label) => {
  // 이름 뒤에 ':'가 있어야 그 줄로 본다('픽업후 확인전화'를 '픽업'으로 읽지 않게). 빈칸이면 다음 줄로 넘어가지 않는다.
  const re = new RegExp(`^[ \\t]*${label}[ \\t]*:[ \\t]*(.*)$`, 'm');
  return clean((text.match(re) || [])[1]);
};
const methodOf = (t) => {
  if (!t) return '';
  if (/탁송/.test(t)) return '외주 탁송';
  if (/센터|픽딜/.test(t)) return '센터 픽업·딜리버리';
  if (/고객/.test(t)) return '고객 직접';
  return '직원';
};
const kmOf = (t) => (String(t || '').match(/([\d,]{2,})\s*km/i) || [])[1]?.replace(/,/g, '') || '';
const amountOf = (t) => {
  const won1 = String(t || '').match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/);
  if (won1) return won1[1].replace(/,/g, '');
  const man = String(t || '').match(/(\d+(?:\.\d+)?)\s*만\s*원/);
  if (man) return String(Math.round(Number(man[1]) * 10000));
  return /무상|무료/.test(String(t || '')) ? '0' : '';
};
const timeOf = (t) => (String(t || '').match(/(\d{1,2}):(\d{2})/) || []).slice(1).map((x) => x.padStart(2, '0')).join(':');

/** 붙여 넣은 서식 → 양식에 덮을 값. 서식에서 읽은 칸만 돌려준다. */
const PHONE = /(0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/;
const ADDRESS = /(특별시|광역시|[가-힣]+도\s|[가-힣]+시\s|[가-힣]+군\s|[가-힣]+구\s).*(로|길|동|리)\s*\d/;
const parseTemplate = (raw, form) => {
  // 'AS (…)'를 다음 줄에 쓰기도 한다: "…<쏘나타 / 142호9106>\nAS (스피드메이트 …)"
  const text = String(raw || '').replace(/\r/g, '').replace(/>\s*\n\s*AS/g, '> AS');
  const p = {};
  // 서식 앞에 적는 연락처·주소 줄. 첫 줄 "유현승 교수님 / 010-4129-1918", 그다음 주소(첫 주소가 픽업지)
  const head = text.split(/\n[^\n]*<[^>]+>/)[0].split('\n').map((l) => l.trim()).filter(Boolean);
  const contactLine = head.find((l) => PHONE.test(l) && !ADDRESS.test(l));
  if (contactLine) {
    p.contactPhone = contactLine.match(PHONE)[1];
    p.contactName = contactLine.replace(PHONE, '').replace(/[/,:]+\s*$/, '').replace(/\s*\/\s*$/, '').trim();
  }
  const firstAddress = head.find((l) => ADDRESS.test(l));
  if (firstAddress) p.pickupPlace = firstAddress.replace(/^(픽업|주소)\s*:\s*/, '');
  const header = text.split('\n').find((l) => /<[^>]+>\s*AS/.test(l)) || '';
  if (header) {
    const staff = clean((header.split('<')[0].split('/').pop() || '').replace(/-\s*$/, ''));
    if (staff) p.staff = staff;
    const shop = (header.match(/AS\s*\(([^)]*)\)/) || [])[1] || '';
    if (shop && !/^\s*입고지\s*\/\s*담당자\s*$/.test(shop)) p.shop = shop.trim();
    const pd = (header.match(/픽업\s*&\s*딜리버리\s*:?\s*(.*)$/) || [])[1] || '';
    const [pm, dm] = pd.split('/').map(clean);
    if (pm) p.inMethod = methodOf(pm);
    if (dm) p.outMethod = methodOf(dm);
    const ymd = (header.match(/(\d{2})(\d{2})(\d{2})/) || []).slice(1);
    if (ymd.length) p.baseDate = `20${ymd[0]}-${ymd[1]}-${ymd[2]}`;
  }
  [['request', '점검 의뢰'], ['callAfterIn', '(?:입고|픽업)후 확인전화'], ['description', '점검 내용'], ['callGuide', '점검 안내 전화'],
    ['mood', '고객님\\s*성향\\s*및\\s*기분'], ['callAfterOut', '인도 확인 전화'], ['memo', '특이사항'], ['nextTodo', '다음\\s*(?:점검\\s*때\\s*)?할\\s*일']].forEach(([k, label]) => {
    const v = lineOf(text, label);
    if (v) p[k] = v;
  });
  const cost = lineOf(text, '점검 비용');
  if (cost) {
    const a = amountOf(cost);
    if (a !== '') p.amount = a;
    if (/무상|보증|리콜/.test(cost)) p.payer = '보증·리콜(무상)';
  }
  // 방문정비는 픽업·인도 대신 '방문 :' 한 줄로 쓴다. 픽업 줄이 없을 때만 픽업으로 읽는다
  [['in', '픽업'], ['out', '인도'], ['in', '방문']].forEach(([side, label]) => {
    if (label === '방문' && p.in) return;
    const v = lineOf(text, label);
    if (!v) return;
    // 칸 구분은 띄어쓰기가 붙은 '/'. '주유 1/8'처럼 붙여 쓴 '/'는 자르지 않는다.
    // 칸을 빼고 쓰기도 해서("고객 직접방문 / 21,300km / 고객이동") 자리 대신 내용으로 가른다.
    const parts = v.split(/\s+\/\s*|\s*\/\s+/).map(clean).filter(Boolean);
    const take = (test) => { const i = parts.findIndex(test); return i < 0 ? '' : parts.splice(i, 1)[0]; };
    const km = take((x) => /\d\s*km/i.test(x));
    const time = take((x) => /\d{1,2}:\d{2}/.test(x) && x.length <= 12);
    const fuel = take((x) => /주유|^\d\/\d$|^\d{1,3}\s*%$|가득|바닥/.test(x));
    const method = take((x) => /이동|탁송|픽딜|센터|직원|기사|지원/.test(x) && parts.length > 1);
    const [place = '', person = ''] = parts;
    let base = (side === 'in' ? form.inAt : form.outAt).slice(0, 10) || p.baseDate || '';
    // '25일 화성 근무처'처럼 장소 앞에 날짜가 있으면 그 날로 본다
    const day = (String(place || '').match(/^(\d{1,2})일/) || [])[1];
    if (base && day) base = `${base.slice(0, 8)}${day.padStart(2, '0')}`;
    const leg = { place, person, km: kmOf(km), fuel: String(fuel || '').replace(/^주유\s*/, ''), method: methodOf(method), at: base && timeOf(time) ? `${base}T${timeOf(time)}` : '' };
    if (Object.values(leg).some(Boolean)) p[side] = leg;
  });
  // 서식의 픽업 칸이 '고객 직접방문'처럼 장소가 아니면 위에 적힌 주소를 픽업지로 쓴다
  if (p.pickupPlace && (!p.in || !ADDRESS.test(p.in.place || ''))) p.in = { ...(p.in || {}), place: p.pickupPlace };
  return p;
};

/**
 * 정비·수리 한 건 입력 (2026-11-17 간소화).
 *
 * 직원들이 쓰던 구글 캘린더 AS 서식과 같은 순서로 칸을 둔다:
 * 접수(종류·상태·진행자·입고지) → 점검(의뢰·전화·내용·비용·고객 기분) → 픽업·인도 → 특이사항 → 파일.
 * 차 그림(수리 부위)·정기점검 횟수·계약 대비 주행·탁송 거리 계산 칸은 뺐다. 예전 기록에 있던 값은 그대로 저장된다.
 *
 * 견적서·점검 결과서(PDF·엑셀·사진)를 올리면 글자를 읽어 비용·작업 내용·주행거리를 채우고 파일로 붙인다(서버 utils/repairInvoice.js).
 *
 * @param {object} props
 * @param {object} props.row 차량 한 줄(서버 rowOf)
 * @param {object|null} props.record 고칠 기록. 없으면 새로 적는다
 * @param {{kind: string, date: string, status?: string}} [props.preset] 달력·목록에서 날짜·종류를 골라 열 때
 */
export default function VehicleServiceForm({ row, record, preset, history = [], page = false, onPick, onClose, onSaved, showToast }) {
  // 새 기록이면 지난 같은 종류 기록에서 정비소·연락처·픽업지를 채워 연다
  const [init] = useState(() => {
    const f = formOf(record, preset);
    return record ? { next: f, filled: [] } : prefillFrom(history, f.kind, f, row?.driver);
  });
  const [prefilled, setPrefilled] = useState(init.filled);
  const [form, setForm] = useState(init.next);
  const previous = previousOf(history.filter((r) => String(r._id) !== String(record?._id) && (!record || String(r.date) < String(record.date))), form.kind);
  // 새 기록에서 종류를 바꾸면 그 종류의 지난 기록으로 빈칸을 다시 채운다
  const changeKind = (kind) => setForm((f) => {
    if (record) return { ...f, kind };
    const { next, filled } = prefillFrom(history, kind, { ...f, kind }, row?.driver);
    setPrefilled(filled);
    return next;
  });
  // 같은 입고에 함께 한 작업(새 기록에서만). 예: 사고수리로 들어가 고장수리·정기점검도 함께.
  // 저장하면 작업마다 기록이 하나씩 생긴다(정기점검 회차·다음 점검일·수리비 합계를 종류별로 세기 때문).
  // 픽업·인도·연락처·전화·특이사항·파일은 함께 쓰고, 작업 내용과 금액만 작업마다 따로 적는다.
  const [extras, setExtras] = useState([]);
  const [extraWork, setExtraWork] = useState({}); // { 종류: { description, repair, vat } }
  const toggleExtra = (k) => setExtras((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  const setWork = (k, patch) => setExtraWork((w) => ({ ...w, [k]: { ...(w[k] || {}), ...patch } }));
  const kindsAll = [form.kind, ...extras.filter((k) => k !== form.kind)];
  const [files, setFiles] = useState([]);
  const [histFilterValue, setHistFilterValue] = useState({}); // 지난 기록 칸별 필터
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [readInfo, setReadInfo] = useState(null); // { source, parsed, filled: [] } 마지막으로 읽은 결과
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setLeg = (side, patch) => setForm((f) => ({ ...f, transport: { ...f.transport, [side]: { ...f.transport[side], ...patch } } }));
  const setCost = (patch) => setForm((f) => ({ ...f, costs: { ...f.costs, ...patch } }));
  const toggleConsumable = (c) => setForm((f) => ({
    ...f, consumables: f.consumables.includes(c) ? f.consumables.filter((x) => x !== c) : [...f.consumables, c]
  }));

  /** 붙여 넣은 캘린더 서식으로 칸을 채운다. 서식에 적힌 칸만 덮어쓴다. */
  const fillFromTemplate = () => {
    const p = parseTemplate(pasteText, form);
    const filled = [];
    setForm((f) => {
      const next = { ...f, transport: { in: { ...f.transport.in }, out: { ...f.transport.out } }, costs: { ...f.costs } };
      ['staff', 'shop', 'contactName', 'contactPhone', 'request', 'callAfterIn', 'description', 'callGuide', 'mood', 'callAfterOut', 'memo', 'nextTodo', 'payer'].forEach((k) => {
        if (p[k]) { next[k] = p[k]; filled.push(k); }
      });
      if (p.amount !== undefined) { next.costs.repair = p.amount; next.costs.vat = ''; filled.push('amount'); }
      if (p.inMethod) next.transport.in.method = p.inMethod;
      if (p.outMethod) next.transport.out.method = p.outMethod;
      [['in', 'inAt', 'mileageIn', 'fuelIn', 'from'], ['out', 'outAt', 'mileageOut', 'fuelOut', 'to']].forEach(([side, at, km, fuel, placeKey]) => {
        const s = p[side];
        if (!s) return;
        if (s.place) next.transport[side][placeKey] = s.place;
        if (s.person) next.transport[side].person = s.person;
        if (s.method) next.transport[side].method = s.method;
        if (s.km) next[km] = s.km;
        if (s.fuel) next[fuel] = s.fuel;
        if (s.at) next[at] = s.at;
        filled.push(side);
      });
      return next;
    });
    if (filled.length) {
      showToast?.('서식에서 읽은 칸을 채웠습니다. 저장 전에 확인해 주세요.', 'success');
      setPasteOpen(false);
    } else {
      showToast?.('서식에서 읽을 칸을 찾지 못했습니다. "점검 의뢰 :", "픽업 :" 같은 줄이 있는지 확인해 주세요.', 'error');
    }
  };

  /**
   * 내역서에서 읽은 값을 양식에 넣는다. 작업 줄·공급가·부가세는 내역서를 따르고,
   * 업체·날짜·주행거리·작업 내용처럼 사람이 먼저 적었을 수 있는 칸은 비어 있을 때만 채운다.
   */
  const applyParsed = (p, text) => {
    const filled = [];
    const f = form; // 읽는 동안에는 양식을 만지지 않는다(버튼이 '읽는 중')
    const next = { ...f, lines: p.lines.map((l) => ({ ...l })), invoice: { bizNo: p.bizNo, issuedDate: p.issuedDate, partsTotal: p.partsTotal, laborTotal: p.laborTotal, supply: p.supply, vat: p.vat, discount: p.discount, total: p.total, text } };
    if (p.lines.length) filled.push(`작업 ${p.lines.length}줄`);
    if (p.supply || p.vat) { next.costs = { ...f.costs, repair: p.supply || f.costs.repair, vat: p.vat || f.costs.vat }; filled.push('비용'); }
    if (!f.shop && p.shop) { next.shop = p.shop; filled.push('입고지'); }
    if (!f.inAt && p.inDate) { next.inAt = `${p.inDate}T10:00`; filled.push('픽업일'); }
    const out = p.outDate || p.issuedDate;
    if (!f.outAt && out) { next.outAt = `${out}T18:00`; filled.push('인도일'); }
    if (p.mileage && !f.mileageOut && !f.mileageIn) { next.mileageOut = String(p.mileage); filled.push('주행거리'); }
    if (!f.description && p.lines.length) { next.description = p.summary || p.lines.map((l) => l.name).join(', '); filled.push('점검 내용'); }
    if (!f.insurer && p.insurer) { next.insurer = p.insurer; filled.push('보험사'); }
    if (!f.claimNo && p.claimNo) { next.claimNo = p.claimNo; filled.push('접수번호'); }
    const added = consumablesOf(p.lines).filter((c) => !f.consumables.includes(c));
    if (added.length) { next.consumables = [...f.consumables, ...added]; filled.push(`소모품 ${added.length}개`); }
    setForm(next);
    return filled;
  };

  /** 견적서·결과서 파일을 서버에 보내 읽고, 파일은 기록에 붙인다 */
  const readInvoice = async (file) => {
    setReading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_HOST}/api/vehicle-services/read-invoice`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      setFiles((fs) => (fs.some((x) => x.name === file.name && x.size === file.size) ? fs : [...fs, file]));
      if (!res.ok || !data.success) { showToast?.(`${data.message || '내용을 읽지 못했습니다.'} 파일은 붙여 둡니다.`, 'error'); return; }
      const filled = applyParsed(data.parsed, data.text);
      setReadInfo({ source: data.source, parsed: data.parsed, filled });
      showToast?.(`읽었습니다${data.parsed.total ? ` · 합계 ${won(data.parsed.total)}` : ''}. 채운 칸을 확인해 주세요.`, 'success');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    if (!form.inAt && !form.outAt) { showToast?.('픽업 또는 인도 날짜를 적어 주세요.', 'error'); return; }
    // 잡아 둔 검사·점검을 완료로 바꿀 때는 견적서·점검 결과서를 올려야 한다(대표님 2026-11-17).
    // 완료해야 목록에서 빠지고 다음 일정이 그날부터 다시 잡히므로, 증빙 없이 끝난 것으로 처리되지 않게 한다.
    const finishing = form.status === '완료' && ['정기점검', '자동차검사'].includes(form.kind) && record && record.status && record.status !== '완료';
    const hasFile = files.length || (record?.attachments || []).length || record?.fileName;
    if (finishing && !hasFile) { showToast?.('완료하려면 견적서나 점검 결과서를 올려 주세요.', 'error'); return; }
    setSaving(true);
    try {
      const others = record ? [] : kindsAll.slice(1);
      const together = others.length ? `같은 입고: ${kindsAll.join(' + ')}` : '';
      const payload = { ...form, memo: [form.memo, together].filter(Boolean).join(' / ') };
      let res;
      if (record) {
        res = await fetch(`${API_HOST}/api/vehicle-services/${record._id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      } else {
        const fd = new FormData();
        fd.append('vehicleId', row.vehicleId);
        fd.append('kind', form.kind);
        fd.append('data', JSON.stringify(payload));
        files.forEach((f) => fd.append('files', f));
        res = await fetch(`${API_HOST}/api/vehicle-services`, { method: 'POST', body: fd });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { showToast?.(data.message || '저장하지 못했습니다.', 'error'); return; }
      // 고치는 기록에 새로 올린 내역서·사진은 따로 붙인다
      if (record && files.length) {
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        const up = await fetch(`${API_HOST}/api/vehicle-services/${record._id}/files`, { method: 'POST', body: fd });
        const upData = await up.json().catch(() => ({}));
        if (!up.ok || !upData.success) showToast?.(upData.message || '파일을 붙이지 못했습니다. 내용은 저장했습니다.', 'error');
      }
      // 함께 한 작업은 같은 입고 정보로 기록을 하나씩 더 만든다. 파일은 첫 기록에만 붙는다
      let made = 0;
      for (const k of others) {
        const w = extraWork[k] || {};
        const fd = new FormData();
        fd.append('vehicleId', row.vehicleId);
        fd.append('kind', k);
        fd.append('data', JSON.stringify({
          ...payload,
          kind: k,
          description: w.description || '',
          costs: { repair: w.repair || '', vat: w.vat || '', insurancePaid: '' },
          lines: [],
          invoice: null,
          consumables: ['정기점검', '소모품교환'].includes(k) ? form.consumables : [],
          carAgeExtended: k === '자동차검사' ? form.carAgeExtended : false
        }));
        const r2 = await fetch(`${API_HOST}/api/vehicle-services`, { method: 'POST', body: fd }).then((x) => x.json()).catch(() => ({}));
        if (r2.success) made += 1;
        else showToast?.(`${k} 기록을 만들지 못했습니다: ${r2.message || ''}`, 'error');
      }
      showToast?.(others.length ? `${kindsAll.slice(0, made + 1).join(' · ')} ${made + 1}건을 저장했습니다.` : (data.message || '저장했습니다.'), 'success');
      onSaved?.();
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const checks = row?.checks;
  const nextRound = form.kind === '정기점검' && !record?.checkRound ? (checks?.done || 0) + 1 : record?.checkRound;
  const insured = ['자차 보험', '상대방 보험'].includes(form.payer);
  const total = num(form.costs.repair) + num(form.costs.vat);
  const existingFiles = (record?.attachments || []).length || (record?.fileName ? 1 : 0);

  // ── 모양
  const card = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.8rem 0.9rem' };
  const h2 = { margin: '0 0 0.55rem', fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-bright)' };
  const row2 = { display: 'grid', gridTemplateColumns: '108px 1fr', gap: '0.5rem', alignItems: 'center', marginBottom: '0.45rem' };
  const lab = { fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 };
  const input = { width: '100%', padding: '0.4rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.82rem', boxSizing: 'border-box' };
  const area = { ...input, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 };
  const hint = { fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' };
  const two = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' };
  const btn = { border: '1px solid var(--border-color)', background: '#fff', borderRadius: '7px', padding: '0.4rem 0.8rem', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' };
  // 컴포넌트로 만들면 입력할 때마다 다시 만들어져 글자 칸이 포커스를 잃는다. 그래서 함수로 그린다.
  const chips = (items, value, onChange) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
      {items.map((it) => (
        <button key={it} type="button" onClick={() => onChange(value === it ? '' : it)}
          style={{ border: `1px solid ${value === it ? 'var(--primary)' : 'var(--border-color)'}`, background: value === it ? 'var(--primary)' : '#fff', color: value === it ? '#fff' : 'var(--text-muted)', borderRadius: '999px', padding: '0.22rem 0.65rem', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}>
          {it}
        </button>
      ))}
    </div>
  );
  const field = (label, el) => <div style={row2}><span style={lab}>{label}</span>{el}</div>;
  const text = (key, placeholder) => <input style={input} value={form[key]} onChange={(e) => set({ [key]: e.target.value })} placeholder={placeholder} />;

  // 픽업·인도 한 줄: 장소 / 날짜·시간 / 넘겨준·받은 사람 / 주행거리 / 주유 / 방법
  const handover = (side) => {
    const l = form.transport[side];
    const pick = side === 'in';
    const at = pick ? 'inAt' : 'outAt';
    const km = pick ? 'mileageIn' : 'mileageOut';
    const fuel = pick ? 'fuelIn' : 'fuelOut';
    const placeKey = pick ? 'from' : 'to';
    const td = { padding: '0.2rem' };
    return (
      <tr>
        <td style={{ ...td, ...lab, whiteSpace: 'nowrap' }}>{pick ? '픽업' : '인도'}</td>
        <td style={td}><input style={input} value={l[placeKey]} onChange={(e) => setLeg(side, { [placeKey]: e.target.value })} placeholder={pick ? '픽업 장소' : '인도 장소'} /></td>
        <td style={td}><input type="datetime-local" style={input} value={form[at]} onChange={(e) => set({ [at]: e.target.value })} /></td>
        <td style={td}><input style={input} value={l.person} onChange={(e) => setLeg(side, { person: e.target.value })} placeholder={pick ? '넘겨준 분' : '받은 분'} /></td>
        <td style={td}><MoneyInput style={{ ...input, textAlign: 'right' }} value={form[km]} onChange={(e) => set({ [km]: e.target.value })} placeholder="km" /></td>
        <td style={td}><input list="vs-fuels" style={input} value={form[fuel]} onChange={(e) => set({ [fuel]: e.target.value })} placeholder="1/2" /></td>
        <td style={td}>
          <select style={input} value={l.method} onChange={(e) => setLeg(side, { method: e.target.value })}>
            <option value="">-</option>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {l.method === '외주 탁송' && <MoneyInput style={{ ...input, marginTop: '0.25rem' }} value={l.fee} onChange={(e) => setLeg(side, { fee: e.target.value })} placeholder="탁송료" />}
        </td>
      </tr>
    );
  };

  // 이 차의 지난 기록 표(최근 것이 위). 줄을 누르면 그 기록을 고친다
  const historyRows = [...history].sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1));
  // 지난 기록 칸별 필터. 칸 순서는 표 머리와 같다(마지막 '고치기' 칸은 필터 없음)
  const histCols = [
    { key: '날짜', type: 'date', get: (r) => kstYmd(r.date) },
    { key: '차량번호', type: 'select', get: (r) => r.plateNo || row?.plateNo },
    { key: '주행거리', type: 'range', get: (r) => r.mileageOut || r.mileage || r.mileageIn },
    { key: '작업', type: 'select', get: (r) => r.kind },
    { key: '작업 내용', type: 'text', get: (r) => `${r.description || ''} ${r.request || ''}` },
    { key: '정비소', type: 'text', get: (r) => r.shop },
    { key: '금액', type: 'range', get: (r) => r.amount },
    { key: '상태', type: 'select', get: (r) => r.status || '완료' },
    { key: '고치기' }
  ];
  const shownRows = filterHistory(historyRows, histCols, histFilterValue);
  const histFilterOn = filterActive(histFilterValue);
  const summaryOf = (r) => {
    const t = String(r.description || r.request || '').replace(/\s+/g, ' ').trim();
    return t.length > 60 ? `${t.slice(0, 60)}…` : t;
  };
  const th = { textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: 700, fontSize: '0.76rem', color: 'var(--text-muted)', background: 'var(--bg-main)', whiteSpace: 'nowrap' };
  const tdc = { padding: '0.4rem 0.5rem', borderTop: '1px solid var(--border-color)', fontSize: '0.8rem', verticalAlign: 'top' };

  return (
    <div style={page ? { padding: '0.2rem 0' } : { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1100, overflowY: 'auto', padding: '1.5rem 1rem' }}>
      <div style={{ maxWidth: page ? '1200px' : '880px', margin: '0 auto', background: 'var(--bg-main)', borderRadius: '12px', padding: page ? '0' : '1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {page && <button type="button" onClick={onClose} style={btn}>← 목록으로</button>}
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-bright)' }}>정비·수리 기록 {record ? '고치기' : '입력'}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {row?.plateNo} · {row?.carModel} · {row?.partyName || '-'}
              {form.kind === '정기점검' && nextRound ? ` · 정기점검 ${nextRound}회차` : ''}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
            <button type="button" onClick={onClose} style={btn}>닫기</button>
            <button type="button" onClick={save} disabled={saving} style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: '7px', padding: '0.45rem 1.1rem', fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}>{saving ? '저장 중…' : '저장'}</button>
            <button type="button" onClick={onClose} title="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
          </div>
        </div>

        {/* 빨리 채우기: 캘린더 서식 붙여 넣기 · 견적서·결과서 올리기 */}
        <div style={{ ...card, borderColor: 'var(--primary)', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={() => setPasteOpen((v) => !v)} style={{ ...btn, borderColor: 'var(--primary)', color: 'var(--primary)' }}>📋 캘린더 서식 붙여 넣기</button>
            <label style={{ ...btn, background: 'var(--primary)', color: '#fff', border: 'none', cursor: reading ? 'wait' : 'pointer' }}>
              {reading ? '읽는 중…' : '📄 견적서·점검 결과서 올리기'}
              <input type="file" accept=".pdf,.xlsx,.xls,image/*" style={{ display: 'none' }} disabled={reading}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readInvoice(f); }} />
            </label>
            <span style={hint}>둘 중 하나로 칸을 채운 뒤 확인하고 저장하세요.</span>
          </div>
          {pasteOpen && (
            <div>
              <textarea style={{ ...area, minHeight: '150px', fontSize: '0.78rem' }} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                placeholder={'구글 캘린더에 쓰던 서식을 그대로 붙여 넣으세요.\n진행일자 / 진행자 - < 차종 / 차량번호 > AS (입고지 / 담당자) - 픽업&딜리버리 : 픽업방법 / 인도방법\n점검 의뢰 :\n입고후 확인전화 :\n점검 내용 :\n…'} />
              <button type="button" onClick={fillFromTemplate} disabled={!pasteText.trim()} style={{ ...btn, marginTop: '0.3rem', background: 'var(--text-bright)', color: '#fff', border: 'none' }}>칸 채우기</button>
            </div>
          )}
          {readInfo && (
            <div style={hint}>
              {READ_SOURCE[readInfo.source] || readInfo.source}로 읽음 · 채운 칸: {readInfo.filled.join(', ') || '없음'}
              {readInfo.parsed?.plateNo && row?.plateNo && readInfo.parsed.plateNo !== row.plateNo.replace(/\s/g, '') && (
                <b style={{ color: '#b91c1c' }}> · ⚠ 파일의 차량번호 {readInfo.parsed.plateNo}가 이 차({row.plateNo})와 다릅니다</b>
              )}
              {readInfo.parsed?.kindGuess && readInfo.parsed.kindGuess !== form.kind && (
                <> · 파일로 보면 <b>{readInfo.parsed.kindGuess}</b> 같습니다 <button type="button" onClick={() => set({ kind: readInfo.parsed.kindGuess })} style={{ ...btn, padding: '0 0.4rem', fontSize: '0.74rem' }}>종류 바꾸기</button></>
              )}
            </div>
          )}
        </div>

        {/* 지난 같은 종류 기록: 다음에 할 일 · 특이사항 */}
        {previous && (
          <div style={{ ...card, background: '#fffbeb', borderColor: '#fcd34d' }}>
            <h3 style={{ ...h2, marginBottom: '0.3rem' }}>
              지난 {previous.kind} · {String(previous.date).slice(0, 10)}
              <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {[previous.shop, previous.checkRound ? `${previous.checkRound}회차` : '', previous.mileage ? `${Number(previous.mileage).toLocaleString()}km` : ''].filter(Boolean).map((x) => ` · ${x}`).join('')}
              </span>
            </h3>
            {previous.nextTodo && <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#b45309' }}>📌 이번에 할 일: {previous.nextTodo}</div>}
            {previous.memo && !isAutoMemo(previous.memo) && <div style={{ fontSize: '0.8rem' }}>특이사항: {previous.memo}</div>}
            {previous.description && <div style={{ ...hint, whiteSpace: 'pre-wrap' }}>지난 점검 내용: {previous.description}</div>}
            {prefilled.length > 0 && <div style={hint}>{prefilled.join(' · ')}을(를) 지난 기록·렌트차량 DB 운전자에서 채웠습니다. 바뀌었으면 고쳐 주세요.</div>}
          </div>
        )}

        {/* 1. 접수 */}
        <div style={card}>
          <h3 style={h2}>① 접수</h3>
          {field(record ? '종류' : '주 작업', chips(KINDS, form.kind, (v) => { if (v) { changeKind(v); setExtras((xs) => xs.filter((x) => x !== v)); } }))}
          {!record && field('같이 한 작업', (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {KINDS.filter((k) => k !== form.kind).map((k) => {
                  const on = extras.includes(k);
                  return (
                    <button key={k} type="button" onClick={() => toggleExtra(k)}
                      style={{ border: `1px solid ${on ? '#0f766e' : 'var(--border-color)'}`, background: on ? '#ccfbf1' : '#fff', color: on ? '#0f766e' : 'var(--text-muted)', borderRadius: '999px', padding: '0.22rem 0.65rem', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}>
                      {on ? '✓ ' : '+ '}{k}
                    </button>
                  );
                })}
              </div>
              <div style={hint}>한 번 입고해서 여러 작업을 했으면 모두 고르세요(여러 개 가능). 저장하면 작업마다 기록이 하나씩 만들어집니다.</div>
            </div>
          ))}
          {record && <div style={{ ...hint, marginTop: '-0.2rem', marginBottom: '0.4rem' }}>같은 입고의 다른 작업은 아래 [+ 새 기록]에서 '같이 한 작업'으로 더하세요.</div>}
          {field('진행 상태', chips(STATUSES, form.status, (v) => v && set({ status: v })))}
          {field('진행자 · 정비소', (
            <div style={two}>
              {text('staff', '진행자 (예: 두식)')}
              {text('shop', '정비소 / 담당자 (예: 스피드메이트 증평점 / 010-…)')}
            </div>
          ))}
          {field('연락할 분', (
            <div style={two}>
              {text('contactName', '이름 (예: 유현승 교수님)')}
              {text('contactPhone', '전화 (예: 010-4129-1918)')}
            </div>
          ))}
        </div>

        {/* 2. 점검 */}
        <div style={card}>
          <h3 style={h2}>② 점검</h3>
          {/* 의뢰·작업 내용은 글이 길어 칸을 크게, 나란히 둔다 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0.7rem', marginBottom: '0.6rem' }}>
            <div>
              <div style={{ ...lab, marginBottom: '0.25rem' }}>점검 의뢰 (고객 요청)</div>
              <textarea style={{ ...area, minHeight: '170px' }} value={form.request} onChange={(e) => set({ request: e.target.value })} placeholder={'고객이 요청한 것\n예) 1. 엔진경고등 점등\n2. 브레이크 밟을 때 소리'} />
            </div>
            <div>
              <div style={{ ...lab, marginBottom: '0.25rem' }}>{extras.length ? `${form.kind} — ` : ''}점검 내용 (실제로 한 작업)</div>
              <textarea style={{ ...area, minHeight: '170px' }} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder={'실제로 한 작업\n예) 엔진오일·오일필터·에어필터 교환, 와이퍼 교환'} />
            </div>
          </div>
          {field('입고후 확인전화', text('callAfterIn', '언제, 누구와 (예: 9월 22일 어드바이저)'))}
          {field('점검 안내 전화', text('callGuide', '언제, 누구에게 (예: 25일 13:05 고객님)'))}
          {field(extras.length ? `${form.kind} 비용` : '점검 비용', (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.4rem', alignItems: 'center' }}>
                <MoneyInput style={input} value={form.costs.repair} onChange={(e) => setCost({ repair: e.target.value })} placeholder="금액 (공급가)" />
                <MoneyInput style={input} value={form.costs.vat} onChange={(e) => setCost({ vat: e.target.value })} placeholder="부가세 (없으면 비움)" />
                <b style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>합계 {won(total)}</b>
              </div>
              <div style={{ marginTop: '0.35rem' }}>{chips(PAYERS, form.payer, (v) => set({ payer: v }))}</div>
              {insured && (
                <div style={{ ...two, marginTop: '0.35rem' }}>
                  <input style={input} value={form.insurer} onChange={(e) => set({ insurer: e.target.value })} placeholder="보험사" />
                  <input style={input} value={form.claimNo} onChange={(e) => set({ claimNo: e.target.value })} placeholder="접수번호" />
                  <input style={input} value={form.fault} onChange={(e) => set({ fault: e.target.value })} placeholder="과실 (예: 상대 100 : 0)" />
                  <MoneyInput style={input} value={form.deductible} onChange={(e) => set({ deductible: e.target.value })} placeholder="자기부담금" />
                </div>
              )}
            </div>
          ))}
          {/* 같이 한 작업마다 작업 내용·금액. 위 칸은 주 작업 것이다 */}
          {!record && kindsAll.slice(1).map((k) => (
            <div key={k} style={{ border: '1px solid #99f6e4', background: '#f0fdfa', borderRadius: '8px', padding: '0.55rem 0.65rem', marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f766e', marginBottom: '0.3rem' }}>같이 한 작업 · {k}</div>
              <textarea style={{ ...area, minHeight: '90px' }} value={extraWork[k]?.description || ''} onChange={(e) => setWork(k, { description: e.target.value })}
                placeholder={k === '정기점검' ? '예) 엔진오일·오일필터·에어필터 교환' : k === '고장수리' ? '예) 엔진경고등 — 점화코일 교환' : '이 작업에서 한 일'} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.4rem', alignItems: 'center', marginTop: '0.35rem' }}>
                <MoneyInput style={input} value={extraWork[k]?.repair || ''} onChange={(e) => setWork(k, { repair: e.target.value })} placeholder={`${k} 금액 (공급가)`} />
                <MoneyInput style={input} value={extraWork[k]?.vat || ''} onChange={(e) => setWork(k, { vat: e.target.value })} placeholder="부가세 (없으면 비움)" />
                <b style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>합계 {won(num(extraWork[k]?.repair) + num(extraWork[k]?.vat))}</b>
              </div>
            </div>
          ))}
          {field('고객 성향·기분', text('mood', '대체적으로 만족'))}
        </div>

        {/* 3. 픽업 · 인도 */}
        <div style={card}>
          <h3 style={h2}>③ 픽업 · 인도</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '720px' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                  {['', '장소', '날짜·시간', '넘겨준·받은 분', '주행거리', '주유', '방법'].map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '0.2rem', fontWeight: 700 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {handover('in')}
                {handover('out')}
              </tbody>
            </table>
          </div>
          <datalist id="vs-fuels">{FUELS.filter(Boolean).map((f) => <option key={f} value={f} />)}</datalist>
          <div style={{ marginTop: '0.45rem' }}>{field('인도 확인 전화', text('callAfterOut', '언제, 누구와'))}</div>
          {field('특이사항', <textarea style={area} value={form.memo} onChange={(e) => set({ memo: e.target.value })} placeholder="없음" />)}
          {field('다음에 할 일', text('nextTodo', '다음 점검 때 챙길 것 (예: 브레이크 패드 30% 남음, 다음에 교환)'))}
          {kindsAll.some((k) => ['사고수리', '고장수리'].includes(k)) && field('대차 제공', text('loaner', '수리 동안 내준 차 (예: 아반떼 125호5281, 2/26~3/5)'))}
          {kindsAll.some((k) => ['정기점검', '소모품교환'].includes(k)) && field('바꾼 소모품', (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.7rem', fontSize: '0.78rem' }}>
              {CONSUMABLES.map((c) => (
                <label key={c} style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.consumables.includes(c)} onChange={() => toggleConsumable(c)} />{c}
                </label>
              ))}
            </div>
          ))}
          {kindsAll.includes('자동차검사') && (
            <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.8rem', fontWeight: 700, color: '#c2410c', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.carAgeExtended} onChange={(e) => set({ carAgeExtended: e.target.checked })} />
              차령 연장도 함께 신청함 (체크한 검사만 차령 1년 연장으로 셉니다)
            </label>
          )}
        </div>

        {/* 4. 파일 */}
        <div style={card}>
          <h3 style={h2}>④ 파일 (견적서 · 점검 결과서 · 사진)</h3>
          {existingFiles > 0 && <div style={hint}>이 기록에 이미 붙은 파일 {existingFiles}개. 새로 고르면 저장할 때 더 붙습니다.</div>}
          <input type="file" multiple onChange={(e) => {
            const picked = [...e.target.files];
            e.target.value = '';
            setFiles((fs) => [...fs, ...picked]);
            // 여기로 견적서를 올려도 칸이 채워지게 한다. 아직 아무 서류도 읽지 않았을 때 첫 PDF·엑셀 한 장만 읽는다
            // (사진은 차 상태 사진이 많아 읽지 않는다. 사진 견적서는 위 [견적서·점검 결과서 올리기]로)
            const doc = picked.find((f) => /\.(pdf|xlsx?)$/i.test(f.name));
            if (doc && !readInfo && !form.invoice && !reading) readInvoice(doc);
          }} style={{ fontSize: '0.8rem' }} />
          <div style={hint}>PDF·엑셀 견적서를 고르면 내용을 읽어 빈 칸을 채웁니다. 사진 견적서는 위 [견적서·점검 결과서 올리기]를 쓰세요.</div>
          {files.length > 0 && (
            <div style={{ ...hint, display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`}>📎 {f.name} <button type="button" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer', padding: 0 }}>×</button></span>
              ))}
            </div>
          )}
          {form.lines.length > 0 && (
            <details style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontWeight: 700 }}>견적서에서 읽은 작업 {form.lines.length}줄 보기</summary>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.3rem' }}>
                <tbody>
                  {form.lines.map((l, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.2rem' }}>{l.name}</td>
                      <td style={{ padding: '0.2rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{num(l.amount) ? won(num(l.amount)) : ''}</td>
                      <td style={{ width: '24px', textAlign: 'center' }}>
                        <button type="button" title="줄 지우기" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))} style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}><X size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {form.invoice?.total ? <div style={hint}>견적서 합계 {won(num(form.invoice.total))}{form.invoice.bizNo ? ` · 사업자번호 ${form.invoice.bizNo}` : ''}</div> : null}
            </details>
          )}
          <div style={hint}>파일은 계약자 OneDrive 폴더의 차량번호 폴더에 날짜별로 저장됩니다.</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
          <button type="button" onClick={onClose} style={btn}>{page ? '← 목록으로' : '닫기'}</button>
          <button type="button" onClick={save} disabled={saving} style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: '7px', padding: '0.5rem 1.4rem', fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}>{saving ? '저장 중…' : '저장'}</button>
        </div>

        {/* 5. 이 차의 지난 기록 */}
        {page && (
          <div style={card}>
            <h3 style={{ ...h2, display: 'flex', alignItems: 'center' }}>
              {row?.plateNo} 지난 정비·검사 기록 {historyRows.length}건
              <FilterBadge active={histFilterOn} shown={shownRows.length} total={historyRows.length} onReset={() => setHistFilterValue({})} />
              <button type="button" onClick={() => onPick?.(null)} style={{ ...btn, marginLeft: 'auto', padding: '0.25rem 0.7rem' }}>+ 새 기록</button>
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
                <thead>
                  <tr>{['날짜', '차량번호', '주행거리', '작업', '작업 내용', '정비소', '금액', '상태', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                  {historyRows.length > 0 && <HistoryFilterRow rows={historyRows} columns={histCols} value={histFilterValue} onChange={setHistFilterValue} />}
                </thead>
                <tbody>
                  {historyRows.length === 0 && <tr><td colSpan={9} style={{ ...tdc, textAlign: 'center', color: 'var(--text-muted)' }}>기록이 없습니다.</td></tr>}
                  {historyRows.length > 0 && shownRows.length === 0 && <tr><td colSpan={9} style={{ ...tdc, textAlign: 'center', color: 'var(--text-muted)' }}>필터에 맞는 기록이 없습니다.</td></tr>}
                  {shownRows.map((r) => {
                    const current = record && String(r._id) === String(record._id);
                    const km = r.mileageOut || r.mileage || r.mileageIn;
                    return (
                      <tr key={r._id} onClick={() => !current && onPick?.(r)} style={{ cursor: current ? 'default' : 'pointer', background: current ? '#eef3fe' : undefined }}>
                        <td style={{ ...tdc, whiteSpace: 'nowrap', fontWeight: 700 }}>{kstYmd(r.date)}</td>
                        <td style={{ ...tdc, whiteSpace: 'nowrap' }}>{r.plateNo || row?.plateNo}</td>
                        <td style={{ ...tdc, whiteSpace: 'nowrap', textAlign: 'right' }}>{km ? `${Number(km).toLocaleString()}km` : '-'}</td>
                        <td style={{ ...tdc, whiteSpace: 'nowrap', fontWeight: 700 }}>{r.kind}{r.checkRound ? ` ${r.checkRound}회차` : ''}{r.carAgeExtended ? ' · 차령연장' : ''}</td>
                        <td style={{ ...tdc, color: 'var(--text-muted)' }}>{summaryOf(r) || '-'}</td>
                        <td style={{ ...tdc, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.shop}>{r.shop || '-'}</td>
                        <td style={{ ...tdc, whiteSpace: 'nowrap', textAlign: 'right' }}>{r.amount ? won(r.amount) : '-'}</td>
                        <td style={{ ...tdc, whiteSpace: 'nowrap' }}>{r.status || '완료'}</td>
                        <td style={{ ...tdc, whiteSpace: 'nowrap', color: current ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 700 }}>{current ? '지금 고치는 중' : '고치기 ›'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
