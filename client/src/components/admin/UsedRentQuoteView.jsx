import React, { useRef, useState } from 'react';
import { Search, Save, Printer, Plus, Trash2, FolderOpen, X, AlertTriangle, FileDown, Car, FileSignature, CalendarPlus } from 'lucide-react';
import { printFitted, makeFittedPdf } from '../../utils/printFit.js';
import usePhoneFit, { phoneFitStyles } from '../../utils/usePhoneFit.js';
import MoneyInput from './MoneyInput.jsx';
import ContractExtendDialog from './ContractExtendDialog.jsx';
import { calculateUsedQuoteOption, vehicleAgeLimit, monthsLabel, USED_QUOTE_DEFAULTS } from '../../../../shared/usedQuoteCalc.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 장기렌터카 견적서와 같은 A4 한 장 크기(가로 900px × 세로 1270px)
const SHEET_WIDTH_PX = 900;
const SHEET_HEIGHT_PX = 1270;
const SHEET_MARGIN_PX = 40;
const MAX_OPTIONS = 4;

const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const pct = (n, digits = 1) => `${((Number(n) || 0) * 100).toFixed(digits)}%`;
// 날짜는 한국 날짜로 'YYYY-MM-DD'
const kstYmd = (v) => {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
};
const todayYmd = () => kstYmd(new Date());

const emptyCar = () => ({
  vehicleId: '', contractId: '', customerId: '', companyId: '', partyType: '법인',
  partyName: '', carModel: '', plateNo: '', options: '', registrationDate: '', cc: '', fuelType: '',
  usedPrice: '', newCarPrice: '', startDate: '', currentMonthlyFee: 0, currentTakeover: 0,
  contractNo: '', contractEnd: '', currentDeposit: 0
});

/**
 * 견적 종류별로 다른 것.
 *  중고렌트: 반납받은 차(재고·단기·거래완료)를 새 고객에게. 고객은 새로 적고, 보증금도 새로 받는다. 차량가격 = 평가액.
 *  계약연장: 지금 장기렌트 중인 고객에게 같은 차를 더. 고객·보증금(승계)·시작일(지금 계약 만기일)을 계약에서 가져온다.
 *           차량가격 = 지금 인수가.
 * 계산식은 둘 다 엑셀 '견적서 보고용' 그대로다(대표님 2026-11-02 "중고렌트와 계약 연장 두 개로").
 */
const USED_KINDS = {
  중고렌트: {
    title: '중고렌트 견적서', docType: '중고렌트견적서', saved: '중고렌트 견적',
    priceLabel: '중고차 가격 (평가액)', startLabel: '계약 시작일', sheetPriceHead: '차량가격',
    placeholder: '차량번호 · 차종 · 차대번호 (재고·반납 차)'
  },
  계약연장: {
    title: '계약 연장 견적서', docType: '연장견적서', saved: '계약 연장 견적',
    priceLabel: '현재 인수가 (연장 차량가격)', startLabel: '연장 시작일 (지금 계약 만기일)', sheetPriceHead: '현재 인수가',
    placeholder: '차량번호 · 계약사 · 계약번호 (지금 장기렌트 중인 차)'
  }
};
const defaultSettings = () => ({
  baseInterestRate: USED_QUOTE_DEFAULTS.baseInterestRate * 100,
  insuranceFee: USED_QUOTE_DEFAULTS.insuranceFee,
  registrationFee: USED_QUOTE_DEFAULTS.registrationFee,
  commissionRate: USED_QUOTE_DEFAULTS.commissionRate * 100,
  dealerRate: USED_QUOTE_DEFAULTS.dealerRate * 100,
  inspectionMonthly: USED_QUOTE_DEFAULTS.inspectionMonthly,
  tireUnitCost: USED_QUOTE_DEFAULTS.tireUnitCost
});
const newOption = (termMonths = 12, deposit = '') => ({
  termMonths, mileage: 20000, deposit, advancePayment: 0, takeoverPrice: '', discountRate: 0, consignmentFee: 0,
  maintenance: false, calcMode: 'auto', monthlyFee: '', targetProfit: 0, include: true
});

// 화면 입력(%)을 계산식 값(소수)으로
const carForCalc = (car, s) => ({
  usedPrice: Number(car.usedPrice) || 0,
  newCarPrice: Number(car.newCarPrice) || 0,
  cc: Number(car.cc) || 0,
  baseInterestRate: (Number(s.baseInterestRate) || 0) / 100,
  insuranceFee: Number(s.insuranceFee) || 0,
  registrationFee: Number(s.registrationFee) || 0,
  commissionRate: (Number(s.commissionRate) || 0) / 100,
  dealerRate: (Number(s.dealerRate) || 0) / 100,
  inspectionMonthly: Number(s.inspectionMonthly) || 0,
  tireUnitCost: Number(s.tireUnitCost) || 0
});
const optForCalc = (o) => ({ ...o, discountRate: (Number(o.discountRate) || 0) / 100 });

/**
 * 중고렌트 견적서.
 *
 * 이미 굴러가는 차(만기 연장, 반납받은 차 재렌트)를 다시 빌려주는 견적이다(대표님 2026-11-02).
 * 계산은 렌트팀 엑셀 '중고렌트_견적서 양식'의 '견적서 보고용' 시트와 같다(shared/usedQuoteCalc.js).
 * 렌트차량 DB에서 차를 고르면 차종·등록일·배기량·지금 인수가(= 중고차 가격)·보증금·계약 만기일을 채우고,
 * 렌터카 차령 한도(2000cc 미만 6년, 이상 9년)로 최대 몇 개월까지 계약할 수 있는지 보여 준다.
 * 한도를 넘는 안은 견적서에 넣을 수 없다.
 */
function UsedRentQuoteView({ kind = '중고렌트', showToast, currentUser }) {
  const K = USED_KINDS[kind] || USED_KINDS.중고렌트;
  const isExt = kind === '계약연장';
  const [car, setCar] = useState(emptyCar);
  const [settings, setSettings] = useState(defaultSettings);
  const [options, setOptions] = useState(() => [newOption(12)]);
  const [remark, setRemark] = useState('');
  const [createdBy, setCreatedBy] = useState(currentUser?.name || '이두식');
  const [quoteId, setQuoteId] = useState('');
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [list, setList] = useState([]);
  const [docBusy, setDocBusy] = useState(-1);
  const [extendWith, setExtendWith] = useState(null);

  const sheetOuterRef = useRef(null);
  const sheetRef = useRef(null);
  const fit = phoneFitStyles(usePhoneFit(sheetOuterRef, sheetRef, SHEET_WIDTH_PX, []), SHEET_WIDTH_PX);

  const setCarField = (patch) => setCar((prev) => ({ ...prev, ...patch }));
  const setOpt = (i, patch) => setOptions((prev) => prev.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const ageLimit = vehicleAgeLimit({ registrationDate: car.registrationDate, cc: car.cc }, car.startDate || todayYmd());
  const calcCar = carForCalc(car, settings);
  const rows = options.map((o) => {
    const calc = calculateUsedQuoteOption(optForCalc(o), calcCar);
    const overAge = ageLimit?.maxMonths !== null && ageLimit?.maxMonths !== undefined && Number(o.termMonths) > ageLimit.maxMonths;
    return { opt: o, calc, overAge };
  });
  const sheetRows = rows.filter((r) => r.opt.include && !r.overAge && r.calc.months > 0);

  /** 렌트차량 DB에서 차를 찾는다(차량번호·차종·계약사·계약번호) */
  const runSearch = async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_HOST}/api/vehicles?search=${encodeURIComponent(search.trim())}&limit=30`);
      const data = await res.json();
      // 연장은 지금 계약이 걸린 장기렌트 차만 고른다(끝난 계약의 옛 기록은 빼고)
      const found = (data.vehicles || []).filter((v) => !isExt || (v.contract && typeof v.contract === 'object' && v.status !== '거래완료'));
      setResults(found);
      if (!found.length) showToast?.(isExt ? '지금 계약 중인 차를 찾지 못했습니다. 반납받은 차는 [중고렌트 견적]에서 내 주세요.' : '찾는 차가 없습니다.', 'warning');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSearching(false);
    }
  };

  /** 고른 차로 채운다. 연장이면 지금 인수가가 중고차 가격, 지금 계약 만기일이 시작일이다. */
  const pickVehicle = async (v) => {
    const contract = v.contract && typeof v.contract === 'object' ? v.contract : null;
    const company = contract?.companyId || v.company || null;
    const customer = contract?.customer || null;
    const partyType = company ? '법인' : '개인';
    const partyName = company?.name || customer?.name || v.contractorName || '';
    const newCarPrice = (Number(v.carPrice) || 0) + (Number(v.optionPrice) || 0) || Number(v.supplyPrice) || '';
    // 중고렌트는 새 고객에게 내는 견적이라 예전 계약자를 채우지 않는다
    setCar({
      vehicleId: v._id,
      contractId: isExt ? contract?._id || '' : '',
      customerId: isExt ? customer?._id || '' : '',
      companyId: isExt ? company?._id || '' : '',
      partyType: isExt ? partyType : '법인',
      partyName: isExt ? partyName : '',
      carModel: v.carModel || '',
      plateNo: v.plateNo || '',
      options: v.options || '',
      registrationDate: kstYmd(v.registrationDate),
      cc: v.cc || '',
      fuelType: v.fuelType || '',
      usedPrice: v.takeoverPrice || '',
      newCarPrice,
      // 계약 만기일(저장값은 기간 다음 날 = 연장 시작일)
      startDate: isExt ? kstYmd(contract?.endDate) || todayYmd() : todayYmd(),
      currentMonthlyFee: isExt ? v.monthlyFee || 0 : 0,
      currentTakeover: v.takeoverPrice || 0,
      contractNo: isExt ? contract?.contractNo || '' : '',
      contractEnd: isExt ? kstYmd(contract?.endDate) : '',
      currentDeposit: isExt ? v.deposit || 0 : 0
    });
    // 연장은 계약자가 같아 보증금을 그대로 승계한다(대표님 결정 2026-10-05). 중고렌트는 새로 정한다.
    setOptions((prev) => prev.map((o) => ({ ...o, deposit: isExt ? v.deposit || 0 : '' })));
    setResults([]);
    setQuoteId('');
    showToast?.(`${v.plateNo || ''} ${v.carModel || ''}을(를) 불러왔습니다.`, 'success');

    // 연장한 차는 연장 때마다 차량 기록이 새로 생기고, 그 기록의 차량가 칸에는 직전 인수가가 들어 있다
    // (125호2333: 118,600,000 → 45,114,000 → 31,579,800). 자차 보험비는 신차가격 기준이라
    // 같은 차(차대번호·차량번호)의 기록 중 가장 큰 차량가를 신차가격으로 쓴다.
    const key = v.vin || v.plateNo;
    if (!key) return;
    try {
      const res = await fetch(`${API_HOST}/api/vehicles?search=${encodeURIComponent(key)}&limit=50`);
      const data = await res.json();
      const same = (data.vehicles || []).filter((x) => (v.vin ? x.vin === v.vin : x.plateNo === v.plateNo));
      const original = Math.max(0, ...same.map((x) => (Number(x.carPrice) || 0) + (Number(x.optionPrice) || 0)));
      if (original > (Number(newCarPrice) || 0)) setCar((prev) => (prev.vehicleId === v._id ? { ...prev, newCarPrice: original } : prev));
    } catch {
      // 신차가격은 손으로 고칠 수 있으니 못 찾아도 넘어간다
    }
  };

  const payload = () => ({
    quoteKind: kind,
    usedRent: { car, settings, options, remark },
    sourceVehicle: car.vehicleId || undefined,
    sourceContract: car.contractId || undefined,
    customerId: car.customerId || undefined,
    partyType: car.partyType,
    companyId: car.partyType === '법인' ? (car.companyId || undefined) : undefined,
    customerName: car.partyName,
    companyName: car.partyType === '법인' ? car.partyName : undefined,
    vehicleModel: car.carModel || '차종 미입력',
    vehicleSpec: car.plateNo,
    totalPrice: Number(car.usedPrice) || 0,
    monthlyEstimates: sheetRows.map((r, i) => ({ termMonths: r.calc.months, monthlyFee: r.calc.monthlyFee, name: `${i + 1}안`, contractType: '렌트', maintenanceEnabled: r.opt.maintenance })),
    rentalRemark: remark,
    createdBy
  });

  const saveQuote = async ({ silent = false } = {}) => {
    if (currentUser?.role === 'viewer') { showToast?.('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error'); return ''; }
    if (!car.partyName.trim()) { showToast?.('고객명(계약사)을 넣어 주세요.', 'error'); return ''; }
    if (!car.carModel.trim()) { showToast?.('차종을 넣어 주세요.', 'error'); return ''; }
    setSaving(true);
    try {
      const res = await fetch(quoteId ? `${API_HOST}/api/quotes/${quoteId}` : `${API_HOST}/api/quotes`, {
        method: quoteId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload())
      });
      const data = await res.json();
      if (!res.ok || !data._id) { showToast?.(data.message || '저장하지 못했습니다.', 'error'); return ''; }
      setQuoteId(data._id);
      if (!silent) showToast?.(`${K.saved}을 저장했습니다.`, 'success');
      return data._id;
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
      return '';
    } finally {
      setSaving(false);
    }
  };

  const openList = async () => {
    setListOpen(true);
    try {
      const res = await fetch(`${API_HOST}/api/quotes?kind=${encodeURIComponent(kind)}`);
      const data = await res.json();
      setList(Array.isArray(data) ? data : []);
    } catch {
      showToast?.('견적 목록을 불러오지 못했습니다.', 'error');
    }
  };

  const loadQuote = (q) => {
    const u = q.usedRent || {};
    setCar({ ...emptyCar(), ...(u.car || {}) });
    setSettings({ ...defaultSettings(), ...(u.settings || {}) });
    setOptions(u.options?.length ? u.options : [newOption(12)]);
    setRemark(u.remark || '');
    setCreatedBy(q.createdBy || createdBy);
    setQuoteId(q._id);
    setListOpen(false);
    showToast?.('견적을 불러왔습니다.', 'success');
  };

  const fileTitle = `${K.docType}_${car.partyName || '고객'}_${todayYmd()}`;
  const blockedReason = () => {
    if (!sheetRows.length) return '견적서에 넣을 안이 없습니다. 기간·금액을 넣고 차령 한도 안인지 확인해 주세요.';
    return '';
  };

  /** 화면 모양 그대로 A4 한 장에 맞춰 인쇄한다. 저장된 견적이면 PDF를 고객 폴더에도 남긴다. */
  const printSheet = async () => {
    const why = blockedReason();
    if (why) { showToast?.(why, 'error'); return; }
    printFitted(sheetRef.current, { orientation: 'portrait', marginMm: 0, title: fileTitle });
    const id = quoteId || (currentUser?.role !== 'viewer' ? await saveQuote({ silent: true }) : '');
    if (!id) return;
    try {
      document.body.classList.add('pdf-making');
      const blob = await makeFittedPdf(sheetRef.current, { orientation: 'portrait', marginMm: 0, onePage: true });
      const fd = new FormData();
      fd.append('file', blob, 'quote.pdf');
      fd.append('docType', K.docType);
      const res = await fetch(`${API_HOST}/api/quotes/${id}/document`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) showToast?.(data.message || '견적서 파일을 남기지 못했습니다.', 'warning');
    } catch {
      showToast?.('견적서 파일을 남기지 못했습니다. 인쇄는 그대로 진행됩니다.', 'warning');
    } finally {
      document.body.classList.remove('pdf-making');
    }
  };

  const downloadPdf = async () => {
    const why = blockedReason();
    if (why) { showToast?.(why, 'error'); return; }
    try {
      document.body.classList.add('pdf-making');
      const blob = await makeFittedPdf(sheetRef.current, { orientation: 'portrait', marginMm: 0, onePage: true });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${fileTitle}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      showToast?.('PDF를 만들지 못했습니다.', 'error');
    } finally {
      document.body.classList.remove('pdf-making');
    }
  };

  // 연장 계약서·연장 반영에 넘기는 한 안의 조건
  const extensionTerms = (r) => ({
    startDate: car.startDate,
    termMonths: r.calc.months,
    monthlyFee: r.calc.monthlyFee,
    takeoverPrice: r.calc.takeoverPrice,
    advancePayment: r.calc.advancePayment,
    carPrice: r.calc.vehiclePrice,
    deposit: r.calc.deposit,
    annualMileage: Number(r.opt.mileage) || 0,
    maintenance: r.opt.maintenance === true
  });
  const extensionBlocked = (r) => {
    if (!car.contractId) return '지금 계약 중인 차를 [찾기]로 골라야 연장 계약서를 만들 수 있습니다.';
    if (r.overAge) return '차령 한도를 넘는 안입니다.';
    if (!(r.calc.months > 0) || !(r.calc.monthlyFee > 0)) return '기간과 월 렌트료를 먼저 계산해 주세요.';
    return '';
  };

  /**
   * 이 안으로 연장 계약서 PDF(서명받기 전 본)를 만든다. 신차와 같은 전체 계약서에 '연장 계약·이전 계약번호·보증금 승계'를 찍는다.
   * 모두싸인으로 서명받은 뒤 [연장 반영]에서 서명 완료본을 올리면 연장된다.
   */
  const downloadExtensionContract = async (r, i) => {
    const why = extensionBlocked(r);
    if (why) { showToast?.(why, 'error'); return; }
    setDocBusy(i);
    try {
      const res = await fetch(`${API_HOST}/api/contracts/${car.contractId}/extension-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extensionTerms(r))
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast?.(data.message || '연장 계약서를 만들지 못했습니다.', 'error');
        return;
      }
      const blob = await res.blob();
      const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') || '')?.[1];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name ? decodeURIComponent(name) : `연장계약서_${car.contractNo || ''}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const saved = res.headers.get('X-Saved-Path');
      const saveError = res.headers.get('X-Saved-Error');
      showToast?.(saved
        ? `연장 계약서를 내려받고 계약 폴더에 넣었습니다 (${decodeURIComponent(saved).split(/[\\/]/).slice(-2).join('/')}). 모두싸인으로 서명받은 뒤 [연장 반영]에서 서명 완료본을 올려 주세요.`
        : `연장 계약서를 내려받았습니다.${saveError ? ` 계약 폴더에는 넣지 못했습니다(${decodeURIComponent(saveError)}).` : ''} 모두싸인으로 서명받은 뒤 [연장 반영]에서 서명 완료본을 올려 주세요.`,
      saved || !saveError ? 'success' : 'warning');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setDocBusy(-1);
    }
  };

  // ───── 화면 조각
  const card = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem 1.1rem' };
  const label = { fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.2rem', display: 'block' };
  const input = { width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.55rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem' };
  const cardTitle = { fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-bright)', marginBottom: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.4rem' };
  const btn = (primary) => ({ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 0.9rem', borderRadius: '6px', fontSize: '0.84rem', fontWeight: 700, cursor: 'pointer', border: primary ? 'none' : '1px solid var(--border-color)', background: primary ? 'var(--primary)' : '#fff', color: primary ? '#fff' : 'var(--text-main)' });
  const field = (title, el) => <div><span style={label}>{title}</span>{el}</div>;

  const th = { padding: '0.4rem 0.5rem', background: 'var(--bg-main)', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-color)' };
  const td = { padding: '0.3rem 0.4rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem', minWidth: '130px' };
  const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const optInput = { ...input, padding: '0.3rem 0.45rem', fontSize: '0.82rem' };

  const inputRow = (title, render) => (
    <tr>
      <th style={th}>{title}</th>
      {rows.map((r, i) => <td key={i} style={td}>{render(r.opt, i, r)}</td>)}
    </tr>
  );
  const calcRow = (title, value, opts = {}) => (
    <tr style={opts.strong ? { background: '#f8fafc' } : undefined}>
      <th style={{ ...th, background: opts.strong ? '#eef2ff' : th.background, color: opts.strong ? 'var(--text-bright)' : th.color }}>{title}</th>
      {rows.map((r, i) => {
        const v = value(r.calc, r.opt);
        const color = opts.sign ? (r.calc.profit < 0 ? '#dc2626' : '#15803d') : undefined;
        return <td key={i} style={{ ...tdNum, fontWeight: opts.strong ? 800 : 500, color }}>{v}</td>;
      })}
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 1. 차 고르기 */}
      <div style={card} className="no-print">
        <div style={cardTitle}><Car size={17} style={{ color: 'var(--primary)' }} /> 차 고르기 (렌트차량 DB)</div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            placeholder={K.placeholder} style={{ ...input, flex: '1 1 260px', width: 'auto' }} />
          <button type="button" onClick={runSearch} disabled={searching} style={btn(true)}><Search size={15} /> {searching ? '찾는 중…' : '찾기'}</button>
          <button type="button" onClick={openList} style={btn(false)}><FolderOpen size={15} /> 저장한 {K.saved}</button>
        </div>
        {results.length > 0 && (
          <div style={{ marginTop: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', maxHeight: '260px', overflowY: 'auto' }}>
            {results.map((v) => {
              const contract = v.contract && typeof v.contract === 'object' ? v.contract : null;
              const party = contract?.companyId?.name || v.company?.name || contract?.customer?.name || v.contractorName || '-';
              return (
                <button key={v._id} type="button" onClick={() => pickVehicle(v)}
                  style={{ display: 'flex', width: '100%', gap: '0.6rem', alignItems: 'center', padding: '0.5rem 0.7rem', border: 'none', borderBottom: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: '0.84rem' }}>
                  <b style={{ minWidth: '90px' }}>{v.plateNo || '-'}</b>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.carModel}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{party}</span>
                  <span style={{ fontSize: '0.72rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'var(--bg-main)' }}>{v.status || '-'}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>인수가 {won(v.takeoverPrice)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. 차량 정보 */}
      <div style={card} className="no-print">
        <div style={cardTitle}>■ 차량 정보 {quoteId && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>(저장된 견적을 고치는 중)</span>}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.7rem' }}>
          {field('고객명(계약사)', <input value={car.partyName} onChange={(e) => setCarField({ partyName: e.target.value })} style={input} />)}
          {field('구분', (
            <select value={car.partyType} onChange={(e) => setCarField({ partyType: e.target.value })} style={input}>
              <option value="법인">법인</option><option value="개인">개인</option>
            </select>
          ))}
          {field('차종(모델명)', <input value={car.carModel} onChange={(e) => setCarField({ carModel: e.target.value })} style={input} />)}
          {field('차량번호', <input value={car.plateNo} onChange={(e) => setCarField({ plateNo: e.target.value })} style={input} />)}
          {field('옵션', <input value={car.options} onChange={(e) => setCarField({ options: e.target.value })} style={input} placeholder="-" />)}
          {field('최초등록일', <input type="date" max="9999-12-31" value={car.registrationDate} onChange={(e) => setCarField({ registrationDate: e.target.value })} style={input} />)}
          {field('배기량(cc)', <input type="number" value={car.cc} onChange={(e) => setCarField({ cc: e.target.value })} style={input} />)}
          {field('연료', <input value={car.fuelType} onChange={(e) => setCarField({ fuelType: e.target.value })} style={input} />)}
          {field(K.priceLabel, <MoneyInput value={car.usedPrice} onChange={(e) => setCarField({ usedPrice: e.target.value })} style={input} />)}
          {field('신차가격 (자차 보험비 기준)', <MoneyInput value={car.newCarPrice} onChange={(e) => setCarField({ newCarPrice: e.target.value })} style={input} />)}
          {field(K.startLabel, <input type="date" max="9999-12-31" value={car.startDate} onChange={(e) => setCarField({ startDate: e.target.value })} style={input} />)}
          {field('담당자', <input value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} style={input} />)}
        </div>
        {isExt && car.contractNo && (
          <div style={{ marginTop: '0.6rem', fontSize: '0.82rem', padding: '0.5rem 0.7rem', background: 'var(--bg-main)', borderRadius: '6px' }}>
            <b>지금 계약</b> {car.contractNo} · 만기 {car.contractEnd || '-'} · 월 {won(car.currentMonthlyFee)}원 · 인수가 {won(car.currentTakeover)}원 · 보증금 {won(car.currentDeposit)}원 <b>승계</b>
          </div>
        )}
        {!isExt && car.vehicleId && (
          <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            새 고객에게 내는 견적입니다. 고객명과 보증금을 넣어 주세요. 차량가격은 직전 인수가({won(car.currentTakeover)}원)를 채워 두었으니 중고차 사업부 평가액으로 고쳐 주세요.
          </div>
        )}
        {/* 차령 한도 */}
        <div style={{ marginTop: '0.7rem', padding: '0.6rem 0.8rem', borderRadius: '8px', fontSize: '0.84rem', lineHeight: 1.6,
          background: !ageLimit ? '#fffbeb' : ageLimit.maxMonths === 0 ? '#fef2f2' : '#eff6ff',
          border: `1px solid ${!ageLimit ? '#fcd34d' : ageLimit.maxMonths === 0 ? '#fca5a5' : '#bfdbfe'}` }}>
          {!ageLimit ? (
            <span><AlertTriangle size={14} style={{ verticalAlign: '-2px', color: '#d97706' }} /> 최초등록일을 넣으면 렌터카로 최대 몇 년까지 쓸 수 있는지 계산합니다.</span>
          ) : (
            <>
              <b>차령 한도</b> · 최초등록 {ageLimit.firstRegistered} · {ageLimit.label}
              <div>
                {car.startDate || todayYmd()} 시작이면 <b style={{ color: ageLimit.maxMonths === 0 ? '#dc2626' : 'var(--primary)', fontSize: '0.95rem' }}>
                  최대 {monthsLabel(ageLimit.maxMonths)}{ageLimit.maxMonths >= 12 ? ` (${ageLimit.maxMonths}개월)` : ''}
                </b>까지 계약할 수 있습니다{ageLimit.maxMonths === 0 ? ' — 차령 한도가 끝나 렌트로 더 쓸 수 없습니다.' : '.'}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 3. 공통 조건 */}
      <div style={card} className="no-print">
        <div style={cardTitle}>■ 공통 조건 <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>엑셀 '견적서 보고용' 기본값</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.7rem' }}>
          {field('이자율 (연 %)', <input type="number" step="0.01" value={settings.baseInterestRate} onChange={(e) => setSettings((p) => ({ ...p, baseInterestRate: e.target.value }))} style={input} />)}
          {field('보험 (연)', <MoneyInput value={settings.insuranceFee} onChange={(e) => setSettings((p) => ({ ...p, insuranceFee: e.target.value }))} style={input} />)}
          {field('등록비용', <MoneyInput value={settings.registrationFee} onChange={(e) => setSettings((p) => ({ ...p, registrationFee: e.target.value }))} style={input} />)}
          {field('렌트베네핏 수수료 (%)', <input type="number" step="0.1" value={settings.commissionRate} onChange={(e) => setSettings((p) => ({ ...p, commissionRate: e.target.value }))} style={input} />)}
          {field('딜러 인센 (%)', <input type="number" step="0.1" value={settings.dealerRate} onChange={(e) => setSettings((p) => ({ ...p, dealerRate: e.target.value }))} style={input} />)}
          {field('정기점검 (월)', <MoneyInput value={settings.inspectionMonthly} onChange={(e) => setSettings((p) => ({ ...p, inspectionMonthly: e.target.value }))} style={input} />)}
          {field('타이어 1본', <MoneyInput value={settings.tireUnitCost} onChange={(e) => setSettings((p) => ({ ...p, tireUnitCost: e.target.value }))} style={input} />)}
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          자차 보험비 = 신차가격(천만 원 단위 올림) × 자차 보험율 · 자동차세는 배기량 기준(영업용) · 판관비 = 중고차 가격 × 3% · 이자율은 기간별로 0.10~0.31%p 더해집니다.
        </div>
      </div>

      {/* 4. 안별 조건과 계산 */}
      <div style={card} className="no-print">
        <div style={{ ...cardTitle, justifyContent: 'space-between' }}>
          <span>■ 안별 조건 · 계산</span>
          {options.length < MAX_OPTIONS && (
            <button type="button" onClick={() => setOptions((p) => [...p, newOption(12, car.vehicleId ? p[0]?.deposit : '')])} style={btn(false)}><Plus size={14} /> 안 추가</button>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}></th>
                {rows.map((r, i) => (
                  <th key={i} style={{ ...th, color: r.overAge ? '#dc2626' : 'var(--text-bright)' }}>
                    {i + 1}안
                    {options.length > 1 && (
                      <button type="button" onClick={() => setOptions((p) => p.filter((_, j) => j !== i))} title="이 안 지우기"
                        style={{ marginLeft: '0.4rem', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', verticalAlign: '-2px' }}><Trash2 size={13} /></button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inputRow('기간 (개월)', (o, i, r) => (
                <div>
                  <input type="number" min="1" value={o.termMonths} onChange={(e) => setOpt(i, { termMonths: e.target.value })} style={{ ...optInput, borderColor: r.overAge ? '#dc2626' : undefined }} />
                  {r.overAge && <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: '0.15rem' }}>차령 한도 {ageLimit.maxMonths}개월 초과</div>}
                </div>
              ))}
              {inputRow('약정거리 (km/년)', (o, i) => <MoneyInput value={o.mileage} onChange={(e) => setOpt(i, { mileage: e.target.value })} style={optInput} />)}
              {inputRow('보증금', (o, i) => <MoneyInput value={o.deposit} onChange={(e) => setOpt(i, { deposit: e.target.value })} style={optInput} />)}
              {inputRow('선수금', (o, i) => <MoneyInput value={o.advancePayment} onChange={(e) => setOpt(i, { advancePayment: e.target.value })} style={optInput} />)}
              {inputRow('인수가 (끝날 때)', (o, i) => <MoneyInput value={o.takeoverPrice} onChange={(e) => setOpt(i, { takeoverPrice: e.target.value })} style={optInput} />)}
              {inputRow('할인/면세율 (%)', (o, i) => <input type="number" step="0.1" value={o.discountRate} onChange={(e) => setOpt(i, { discountRate: e.target.value })} style={optInput} />)}
              {inputRow('탁송료', (o, i) => <MoneyInput value={o.consignmentFee} onChange={(e) => setOpt(i, { consignmentFee: e.target.value })} style={optInput} />)}
              {inputRow('정비', (o, i) => (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={o.maintenance} onChange={(e) => setOpt(i, { maintenance: e.target.checked })} /> 가입
                </label>
              ))}
              {inputRow('계산 방식', (o, i) => (
                <select value={o.calcMode} onChange={(e) => setOpt(i, { calcMode: e.target.value })} style={optInput}>
                  <option value="auto">목표 이익 → 렌트료</option>
                  <option value="manual">렌트료 직접 입력</option>
                </select>
              ))}
              {inputRow('월 렌트료 / 목표 이익', (o, i) => (o.calcMode === 'manual'
                ? <MoneyInput value={o.monthlyFee} onChange={(e) => setOpt(i, { monthlyFee: e.target.value })} style={optInput} placeholder="월 렌트료" />
                : <MoneyInput value={o.targetProfit} onChange={(e) => setOpt(i, { targetProfit: e.target.value })} style={optInput} placeholder="목표 영업이익" />))}
              {inputRow('견적서에 넣기', (o, i, r) => (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: r.overAge ? '#dc2626' : undefined }}>
                  <input type="checkbox" checked={o.include && !r.overAge} disabled={r.overAge} onChange={(e) => setOpt(i, { include: e.target.checked })} />
                  {r.overAge ? '한도 초과로 제외' : '넣기'}
                </label>
              ))}
              {isExt && inputRow('연장 계약서', (o, i, r) => {
                const why = extensionBlocked(r);
                const small = { ...btn(false), padding: '0.3rem 0.5rem', fontSize: '0.76rem', width: '100%', justifyContent: 'center', opacity: why ? 0.5 : 1 };
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <button type="button" title={why || '이 안으로 연장 계약서 PDF 만들기'} onClick={() => downloadExtensionContract(r, i)} disabled={docBusy === i} style={small}>
                      <FileSignature size={13} /> {docBusy === i ? '만드는 중…' : '계약서 PDF'}
                    </button>
                    <button type="button" title={why || '서명 완료본을 올려 연장 반영'} onClick={() => { if (why) { showToast?.(why, 'error'); return; } setExtendWith(extensionTerms(r)); }} style={small}>
                      <CalendarPlus size={13} /> 연장 반영
                    </button>
                  </div>
                );
              })}

              {calcRow('차량가격', (c) => won(c.vehiclePrice))}
              {calcRow('조달원금', (c) => won(c.fundingPrincipal))}
              {calcRow('이자부담율', (c) => pct(c.interestRate, 2))}
              {calcRow('조달이자', (c) => won(c.fundingInterest))}
              {calcRow('보험 + 자차 (기간)', (c) => won((c.insuranceFee + c.ownCarInsuranceFee) * c.years))}
              {calcRow('자동차세 (기간)', (c) => won(c.carTaxAnnual * c.years))}
              {calcRow('등록비용', (c) => won(c.registrationFee + c.acquisitionTax + c.publicBond))}
              {calcRow('판관비/노무비', (c) => won(c.pandanbi))}
              {calcRow('수수료 + 딜러', (c) => won(c.companyCommission + c.dealerCommission))}
              {calcRow('정비 + 타이어', (c) => (c.inspectionCost + c.tireCost ? `${won(c.inspectionCost + c.tireCost)}${c.tireCount ? ` (타이어 ${c.tireCount}본)` : ''}` : '-'))}
              {calcRow('총구입가 (원가)', (c) => won(c.totalCost), { strong: true })}
              {calcRow('월 렌트료', (c) => `${won(c.monthlyFee)}원`, { strong: true })}
              {calcRow('총수입 (렌트료 + 인수가 + 선수금)', (c) => won(c.totalRevenue))}
              {calcRow('영업이익', (c) => won(c.profit), { strong: true, sign: true })}
              {calcRow('회사 몫 (이익 + 수수료) / 중고차 가격', (c) => pct(c.profitRate))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. 비고와 버튼 */}
      <div style={card} className="no-print">
        <span style={label}>견적서 비고 (왼쪽 아래 '비고' 칸)</span>
        <textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} style={{ ...input, resize: 'vertical' }}
          placeholder="예: 보증금 12,360,000원 승계 · 종료 후 인수 시 이전등록비 별도" />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.7rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => saveQuote()} disabled={saving} style={btn(false)}><Save size={15} /> {saving ? '저장 중…' : quoteId ? '고친 내용 저장' : '견적 저장'}</button>
          <button type="button" onClick={downloadPdf} style={btn(false)}><FileDown size={15} /> PDF 내려받기</button>
          <button type="button" onClick={printSheet} style={btn(true)}><Printer size={15} /> 인쇄 (PDF 보관)</button>
        </div>
        {isExt && (
          <div style={{ marginTop: '0.6rem', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            연장 계약 순서: 고객이 안을 고르면 위 표의 <b>[계약서 PDF]</b>로 연장 계약서를 받아 모두싸인으로 서명 → 서명 완료본을 <b>[연장 반영]</b>에 올리면 새 계약번호로 연장되고 청구·원장에 반영됩니다.
            연장 계약서는 약관 제2조③에 따라 신차와 같은 전체 계약서입니다(개인정보·신용조회 동의서는 갱신에도 유효해 다시 받지 않아도 됩니다).
          </div>
        )}
      </div>

      {/* 6. 고객용 견적서 (A4 한 장) */}
      <div className="print-fit-scroll m-fit-outer" ref={sheetOuterRef} style={{ overflowX: 'auto', ...fit.outer }}>
        <div ref={sheetRef} className={`used-rent-print-area print-fit m-doc${fit.outer ? ' m-fitted' : ''}`}
          style={{ width: `${SHEET_WIDTH_PX}px`, height: `${SHEET_HEIGHT_PX}px`, margin: '0 auto', background: '#fff', padding: `${SHEET_MARGIN_PX}px`, color: '#000', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', '맑은 고딕', sans-serif", fontSize: '0.76rem', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden', boxShadow: '0 0 0 1px var(--border-color)', ...fit.inner }}>
          <UsedRentSheet kind={kind} car={car} rows={sheetRows} ageLimit={ageLimit} remark={remark} createdBy={createdBy} />
        </div>
      </div>

      {extendWith && (
        <ContractExtendDialog contractId={car.contractId} initial={extendWith} showToast={showToast}
          onClose={() => setExtendWith(null)}
          onDone={(c) => showToast?.(`${c?.contractNo || ''} 연장 계약이 만들어졌습니다.`, 'success')} />
      )}

      {listOpen && (
        <div onClick={() => setListOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 1rem' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: 'min(720px, 100%)', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.9rem 1.1rem', borderBottom: '1px solid var(--border-color)', fontWeight: 800 }}>
              저장한 {K.saved}
              <button type="button" onClick={() => setListOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            {!list.length ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>저장한 {K.saved}이 없습니다.</div>
            ) : list.map((q) => (
              <button key={q._id} type="button" onClick={() => loadQuote(q)}
                style={{ display: 'flex', width: '100%', gap: '0.7rem', padding: '0.6rem 1.1rem', border: 'none', borderBottom: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: '84px' }}>{kstYmd(q.createdAt)}</span>
                <b style={{ minWidth: '120px' }}>{q.customerName || '-'}</b>
                <span style={{ flex: 1 }}>{q.vehicleModel} {q.vehicleSpec || ''}</span>
                <span style={{ color: 'var(--text-muted)' }}>{(q.monthlyEstimates || []).map((m) => `${m.termMonths}개월 ${won(m.monthlyFee)}`).join(' / ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 고객에게 건네는 중고렌트 견적서 한 장. 엑셀 '고객용' 시트와 같은 항목을 장기렌터카 견적서 모양으로 그린다.
 * 신차 견적서의 예상납기·색상 자리에 차량번호·최초등록일과 계약 가능 기간(차령 한도)을 넣었다.
 * 계약 연장 견적서는 계약 가능 기간 대신 연장 시작일을 넣는다.
 */
function UsedRentSheet({ kind, car, rows, ageLimit, remark, createdBy }) {
  const K = USED_KINDS[kind] || USED_KINDS.중고렌트;
  const isExt = kind === '계약연장';
  const cellHead = { background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' };
  const cell = { padding: '4px 6px', border: '1px solid #000' };
  const today = todayYmd();
  const first = rows[0];
  const used = Number(car.usedPrice) || 0;
  const rate = (n) => (used > 0 ? `${Math.round((n / used) * 100)}%` : '-');
  const quoteNo = `RU-${today.replace(/-/g, '').substring(2)}-${String(Math.max(0, Math.round((first?.calc.profit || 0) / 10000))).padStart(3, '0')}`;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', borderBottom: '2.5px double #000', paddingBottom: '0.6rem' }}>
        <div style={{ width: '150px' }}><span style={{ fontSize: '1.1rem', fontWeight: '800', color: '#111e38' }}>(주)렌트베네핏</span></div>
        <h2 style={{ fontSize: '1.8rem', fontWeight: '800', color: '#111e38', margin: 0, letterSpacing: '2px', flex: 1, textAlign: 'center' }}>{K.title}</h2>
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '150px' }}><img src="/logo.png" alt="RENT BENefit" style={{ maxWidth: '120px', height: 'auto' }} /></div>
      </div>

      <div style={{ display: 'flex', gap: '1.0rem', marginBottom: '0.3rem' }}>
        <table style={{ width: '50%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.74rem' }}>
          <tbody>
            <tr><td style={{ ...cellHead, width: '25%' }}>고객명</td><td style={{ ...cell, fontWeight: '700', fontSize: '0.78rem' }}>{car.partyName || '-'} 귀하</td></tr>
            <tr><td style={cellHead}>차종</td><td style={{ ...cell, fontWeight: '600', fontSize: '0.72rem' }}>{car.carModel || '차종 미입력'}</td></tr>
            <tr><td style={cellHead}>차량번호</td><td style={{ ...cell, fontWeight: '700' }}>{car.plateNo || '-'}{car.registrationDate ? <span style={{ fontWeight: 500, fontSize: '0.7rem' }}> (최초등록 {car.registrationDate})</span> : null}</td></tr>
            {/* 연장 견적서에는 계약 가능 기간(차령 한도)을 넣지 않는다(대표님 2026-11-02). 한도는 화면에서만 본다 */}
            {isExt ? (
              <tr><td style={cellHead}>연장 시작일</td><td style={{ ...cell, fontWeight: '700' }}>{car.startDate || '-'}</td></tr>
            ) : (
              <tr>
                <td style={cellHead}>계약 가능 기간</td>
                <td style={{ ...cell, color: '#d9534f', fontWeight: '700', fontSize: '0.72rem' }}>
                  {ageLimit && ageLimit.maxMonths !== null ? `최대 ${monthsLabel(ageLimit.maxMonths)} (${ageLimit.lastDay}까지 반납)` : '-'}
                </td>
              </tr>
            )}
            {isExt ? (
              <tr>
                <td style={cellHead}>현재 계약</td>
                <td style={{ ...cell, fontSize: '0.70rem' }}>
                  {car.contractNo || '-'} · 만기 {car.contractEnd || '-'} · 월 {won(car.currentMonthlyFee)}원
                </td>
              </tr>
            ) : (
              <tr><td style={cellHead}>옵션</td><td style={{ ...cell, fontSize: '0.70rem', color: '#d9534f', fontWeight: '600' }}>{car.options || '-'}</td></tr>
            )}
          </tbody>
        </table>
        <table style={{ width: '50%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.74rem' }}>
          <tbody>
            <tr><td style={{ ...cellHead, width: '25%' }}>작성일</td><td style={{ ...cell, textAlign: 'center' }}>{today}</td></tr>
            <tr><td style={{ ...cellHead, whiteSpace: 'nowrap' }}>견적서 보관 기간</td><td style={{ ...cell, textAlign: 'center' }}>작성일로부터 10일 간 보관</td></tr>
            <tr><td style={cellHead}>견적 번호</td><td style={{ ...cell, textAlign: 'center', fontWeight: '600' }}>{quoteNo}</td></tr>
            <tr><td style={cellHead}>담당자</td><td style={{ ...cell, textAlign: 'center', fontWeight: '700' }}>{createdBy} 팀장</td></tr>
            <tr>
              <td style={cellHead}>연락처</td>
              <td style={{ padding: '2px 6px', border: '1px solid #000', fontSize: '0.70rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TEL</span><span>02-547-0303 / 010-9061-3000</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dotted #ccc', paddingTop: '1px', marginTop: '1px' }}><span>FAX</span><span>02-529-3303</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dotted #ccc', paddingTop: '1px', marginTop: '1px' }}><span>E-Mail</span><span style={{ color: '#0056b3', textDecoration: 'underline' }}>rent@sdibenefit.com</span></div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ background: '#fafafa', border: '1px solid #adadad', padding: '4px 10px', fontSize: '0.68rem', color: '#333', marginBottom: '0.3rem', borderRadius: '4px', lineHeight: '1.3' }}>
        <div style={{ fontWeight: '700', textAlign: 'center', marginBottom: '1px' }}>• 매출액 10억 이하인 경우 및 최근 2개년 재무제표 미제출시에 한함 •</div>
        <div>1. 기업의 신용도 판단 목적으로 대표자의 개인신용정보를 조회할 경우, 렌트베네핏은 해당 기업의 대표자에게 조회 사실 및 이유 등을 사전 고지하여야 합니다.</div>
        <div>2. 렌트베네핏에 장기 견적을 요청한 업무담당자께서는 귀사의 대표자에게 신용조회가 발생할 수 있음을 반드시 사전 보고해 주시기 바랍니다.</div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.74rem', marginBottom: '0.1rem' }}>
        <thead>
          <tr style={{ background: '#dcdcdc', borderBottom: '1.5px solid #000' }}>
            {[['구분', '6%'], ['차종', '32%'], ['수량', '6%'], ['계약기간', '8%'], [K.sheetPriceHead, '12%'], ['보증금', '9%'], ['선수금', '9%'], ['인수가', '9%'], ['월대여료', '11%']].map(([t, w]) => (
              <th key={t} style={{ width: w, padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3].map((index) => {
            const r = rows[index];
            if (!r) {
              return (
                <React.Fragment key={index}>
                  <tr style={{ height: '1.4rem' }}>
                    <td rowSpan={2} style={{ textAlign: 'center', border: '1px solid #000', fontWeight: '700', background: '#fafafa', color: '#ccc' }}>{index + 1}</td>
                    {Array.from({ length: 8 }).map((_, k) => <td key={k} style={{ border: '1px solid #000' }}></td>)}
                  </tr>
                  <tr style={{ height: '1.1rem', background: '#fdfbfa' }}>
                    <td style={{ border: '1px solid #000' }}></td><td colSpan={3} style={{ border: '1px solid #000' }}></td>
                    {Array.from({ length: 4 }).map((_, k) => <td key={k} style={{ border: '1px solid #000' }}></td>)}
                  </tr>
                </React.Fragment>
              );
            }
            const { calc, opt } = r;
            const num = { textAlign: 'right', padding: '4px 4px', border: '1px solid #000' };
            const sub = { textAlign: 'right', padding: '2px 4px', border: '1px solid #000', color: '#555', fontWeight: '600' };
            return (
              <React.Fragment key={index}>
                <tr style={{ height: '1.5rem' }}>
                  <td rowSpan={2} style={{ textAlign: 'center', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', background: '#fafafa' }}>{index + 1}</td>
                  <td style={{ padding: '4px 4px', border: '1px solid #000', fontWeight: '700', fontSize: '0.70rem' }}>{car.carModel}</td>
                  <td style={{ textAlign: 'center', border: '1px solid #000' }}>1</td>
                  <td style={{ textAlign: 'center', border: '1px solid #000' }}>{calc.months}</td>
                  <td style={num}>{won(calc.usedPrice)}</td>
                  <td style={num}>{won(calc.deposit)}</td>
                  <td style={num}>{won(calc.advancePayment)}</td>
                  <td style={num}>{won(calc.takeoverPrice)}</td>
                  <td style={{ ...num, fontWeight: '700', color: '#111e38' }}>{won(calc.monthlyFee)}</td>
                </tr>
                <tr style={{ background: '#fdfbfa', fontSize: '0.66rem', height: '1.2rem' }}>
                  <td style={{ padding: '2px 4px', border: '1px solid #000', color: '#555' }}>정비 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>{opt.maintenance ? '가입' : '미가입'}</strong></td>
                  <td colSpan={3} style={{ border: '1px solid #000' }}></td>
                  <td style={sub}>{rate(calc.deposit)}</td>
                  <td style={sub}>{rate(calc.advancePayment)}</td>
                  <td style={sub}>{rate(calc.takeoverPrice)}</td>
                  <td style={{ border: '1px solid #000' }}></td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div style={{ textAlign: 'right', fontSize: '0.62rem', color: '#555', marginBottom: '0.2rem', fontWeight: '600' }}>
        대당 / {isExt ? '현재 인수가 기준' : '차량가격: 중고차 가격'} / 월대여료 : VAT포함
      </div>

      <div style={{ background: '#fdfbfa', border: '1px dashed #ad885c', padding: '4px 8px', fontSize: '0.66rem', color: '#555', marginBottom: '0.3rem', lineHeight: '1.35' }}>
        <div>• 상기 견적 금액은 운용대수(계약대수/차량보유대수), 차량가 변동 또는 정부 시책에 따라 변동될 수 있습니다.</div>
        <div>• 선납금을 선택하신 경우, 상기 월대여료는 선납금을 계약기간으로 균등하게 나눈 금액을 <b>이미 차감한 실제 매월 납부 금액</b>입니다.</div>
        {!isExt && <div>• 렌터카는 법정 차령(차량 연식) 안에서만 운행할 수 있어, 계약 기간은 위 '계약 가능 기간'을 넘을 수 없습니다.</div>}
        {isExt && <div>• 연장 계약은 {car.startDate || '현재 계약 만기일'}부터 시작하며, 현재 계약의 보증금은 연장 계약으로 그대로 승계됩니다.</div>}
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.3rem' }}>
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.68rem' }}>
            <thead><tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}><th style={{ padding: '3px', fontWeight: '700' }}>월대여료 포함사항</th></tr></thead>
            <tbody>
              <tr>
                <td style={{ padding: '4px 6px', border: '1px solid #000', lineHeight: '1.4', fontWeight: '500' }}>
                  <div>• 보험료, 차량 검사비, 세금, 공과금 전부 포함</div>
                  <div>• 차량점검, 수리 / 소모품 교체 비용 등 불포함</div>
                  <div>• 유류비, 세차비, 과태료, 범칙금은 임차인 부담</div>
                </td>
              </tr>
            </tbody>
          </table>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.66rem' }}>
            <thead><tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}><th colSpan={4} style={{ padding: '3px', fontWeight: '700' }}>보험 가입 내용</th></tr></thead>
            <tbody>
              {[
                ['운전 범위', '임직원', '운전자 연령', '만26세'],
                ['대 인', '무 제 한'], ['대 물', '2 억 원'], ['자 기 신 체', '사상 1억 / 부상 1500만'],
                ['자기부담금(CMD)', '30만원'], ['무보험차상해', '2억원 / 1인당'], ['긴급출동', '5회/년']
              ].map((r) => (
                <tr key={r[0]}>
                  <td style={{ width: '22%', background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700', whiteSpace: 'nowrap' }}>{r[0]}</td>
                  {r.length === 4 ? (
                    <>
                      <td style={{ width: '28%', padding: '2px 4px', border: '1px solid #000', textAlign: 'center' }}>{r[1]}</td>
                      <td style={{ width: '22%', background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>{r[2]}</td>
                      <td style={{ width: '28%', padding: '2px 4px', border: '1px solid #000', textAlign: 'center' }}>{r[3]}</td>
                    </>
                  ) : <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>{r[1]}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.68rem' }}>
            <thead><tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}><th colSpan={2} style={{ padding: '3px', fontWeight: '700' }}>대여 조건</th></tr></thead>
            <tbody>
              <tr>
                <td style={{ width: '40%', background: '#fafafa', padding: '3px 6px', border: '1px solid #000', fontWeight: '700' }}>• 약정주행거리</td>
                <td style={{ padding: '3px 6px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>{first ? `${won(first.opt.mileage)} km/년` : '-'}</td>
              </tr>
              <tr><td style={{ background: '#fafafa', padding: '3px 6px', border: '1px solid #000', fontWeight: '700' }}>• 중도해지 수수료율</td><td style={{ padding: '3px 6px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>35%</td></tr>
              <tr><td style={{ background: '#fafafa', padding: '3px 6px', border: '1px solid #000', fontWeight: '700' }}>• 연체 이율</td><td style={{ padding: '3px 6px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>연 25%</td></tr>
            </tbody>
          </table>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.66rem' }}>
            <thead><tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}><th colSpan={3} style={{ padding: '3px', fontWeight: '700' }}>차량 관리 서비스</th></tr></thead>
            <tbody>
              <tr>
                <td rowSpan={3} style={{ width: '22%', background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700', whiteSpace: 'nowrap' }}>기본제공 사항</td>
                <td style={{ width: '53%', padding: '2px 4px', border: '1px solid #000' }}>• 차량 법정 검사 대행</td>
                <td style={{ width: '25%', padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>가입</td>
              </tr>
              <tr><td style={{ padding: '2px 4px', border: '1px solid #000' }}>• 차량사고시 사고처리 및 사고수리</td><td style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>자기부담금</td></tr>
              <tr><td style={{ padding: '2px 4px', border: '1px solid #000' }}>• 차량사고/고장시 긴급 출동서비스</td><td style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>5회/년</td></tr>
              <tr style={{ background: '#dcdcdc' }}><th colSpan={3} style={{ padding: '3px', fontWeight: '700', borderTop: '1.5px solid #000', borderBottom: '1px solid #000' }}>정비 서비스</th></tr>
              {[
                ['• 순회정비 차량을 이용한 정기 순회점검', first?.opt.maintenance ? '가입' : '미가입'],
                ['• 일반정비(고장수리) 서비스', first?.opt.maintenance ? '가입' : '미가입'],
                ['• 소모품 교환(오일류, 배터리, 기타)', first?.opt.maintenance ? '가입' : '미가입'],
                ['• 타이어 교체', first?.opt.maintenance && first.calc.tireCount > 0 ? `${first.calc.tireCount}본 제공` : '미제공']
              ].map(([t, v], k) => (
                <tr key={t}>
                  {k === 0 && <td rowSpan={4} style={{ width: '22%', background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700', whiteSpace: 'nowrap' }}>서비스별 적용사항</td>}
                  <td style={{ padding: '2px 4px', border: '1px solid #000' }}>{t}</td>
                  <td style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 남은 세로 공간을 비고·특약사항이 가져간다 */}
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.3rem', flex: 1, minHeight: '80px' }}>
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', border: '1.5px solid #000', fontSize: '0.68rem' }}>
          <div style={{ background: '#dcdcdc', borderBottom: '1px solid #000', padding: '3px', fontWeight: '700', textAlign: 'center' }}>비고</div>
          <div style={{ flex: 1, padding: '5px 8px', color: '#333', whiteSpace: 'pre-wrap', lineHeight: '1.4', overflow: 'hidden' }}>{remark}</div>
        </div>
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', border: '1.5px solid #000', fontSize: '0.66rem' }}>
          <div style={{ background: '#dcdcdc', borderBottom: '1px solid #000', padding: '3px', fontWeight: '700', textAlign: 'center', fontSize: '0.68rem' }}>특약사항</div>
          <div style={{ flex: 1, padding: '5px 8px', lineHeight: '1.4', color: '#333', overflow: 'hidden' }}>
            <div>• 계약 종료 후 인수하시는 경우 이전등록 비용(취득세 등)은 인수자 부담입니다.</div>
            <div style={{ marginTop: '2px' }}>• 전기차의 대차는 내연기관 차량으로 제공됩니다.</div>
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid #000', padding: '4px 8px', fontSize: '0.68rem', marginBottom: '0.4rem', display: 'flex', gap: '0.4rem', lineHeight: '1.25' }}>
        <div style={{ fontWeight: '800', whiteSpace: 'nowrap' }}>계약시 필요서류</div>
        <div style={{ color: '#333' }}><strong>• 법인:</strong> 법인등기부등본(원본), 법인인감증명서(원본), 사업자등록증(사본), 사용인감사용시 사용인감계, 대리인 날인시 위임장, CMS통장사본</div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '0.2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: '1.2rem' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: '800', letterSpacing: '2px', color: '#111e38' }}>주식회사 렌트베네핏</span>
          <span style={{ fontSize: '1.0rem', fontWeight: '800', color: '#111e38' }}>대표이사 신 동 일</span>
        </div>
        <div style={{ fontSize: '0.70rem', fontWeight: '800', letterSpacing: '3px', color: '#ad885c', marginTop: '0.2rem' }}>TOTAL CAR PREMIUM SOLUTION</div>
      </div>
    </>
  );
}

export default UsedRentQuoteView;
