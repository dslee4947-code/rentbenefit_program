import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  FileText,
  Search,
  Plus,
  Trash2,
  Printer,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Calendar,
  DollarSign,
  User,
  Car,
  Upload,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  ListChecks
} from 'lucide-react';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;

// 렌터카 DB(Vehicle)를 법인(계약사)별로 묶고, 같은 법인 안에서도 계약번호(같은 계약/출고 건)별로 다시 묶는다.
// 계약번호가 비어있는 차량은 서로 다른 시점에 계약된 것일 수 있어 차량번호 기준으로 각각 독립된 건으로 취급한다.
function groupVehiclesByCompanyAndContract(vehicles) {
  const companies = {};
  vehicles.forEach(v => {
    // 원본 데이터에 같은 법인이 "회사명_1", "회사명_2"... 처럼 차량별 순번이 붙어 저장된 경우가 많아
    // 끝의 "_숫자" 접미사를 제거해야 같은 법인끼리 정상적으로 묶인다.
    const companyName = (v.contractCompany || '').trim().replace(/_\d+$/, '') || '미지정 법인';
    if (!companies[companyName]) companies[companyName] = {};
    const contractNo = (v.contractNo || '').trim();
    const batchKey = contractNo || `단독-${v.carNumber || v._id}`;
    if (!companies[companyName][batchKey]) {
      companies[companyName][batchKey] = { batchKey, contractNo: contractNo || null, vehicles: [] };
    }
    companies[companyName][batchKey].vehicles.push(v);
  });

  return Object.entries(companies).map(([companyName, batches]) => {
    const batchList = Object.values(batches).sort((a, b) => (a.contractNo || '').localeCompare(b.contractNo || ''));
    const totalMonthly = batchList.reduce((sum, b) => sum + b.vehicles.reduce((s, v) => s + (v.monthlyPayment || 0), 0), 0);
    const totalVehicles = batchList.reduce((sum, b) => sum + b.vehicles.length, 0);
    return { companyName, batches: batchList, totalMonthly, totalVehicles };
  }).sort((a, b) => a.companyName.localeCompare(b.companyName));
}

// 차량 1대의 계약기간 전체에 대한 월별 납부 스케줄을 계산한다 (DB에 저장하지 않고 매번 계산)
function computeMonthlySchedule(vehicle) {
  const monthlyFee = vehicle.monthlyPayment || 0;
  const startStr = vehicle.rentStartDate || vehicle.deliveryDate || vehicle.contractDate || '';
  const start = startStr ? new Date(startStr) : null;
  const validStart = start && !isNaN(start.getTime());

  let months = parseInt(vehicle.rentPeriodYears, 10) * 12;
  if (!months || isNaN(months)) months = 60;

  if (validStart && vehicle.rentEndDate) {
    const end = new Date(vehicle.rentEndDate);
    if (!isNaN(end.getTime())) {
      const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      if (diffMonths > 0) months = diffMonths;
    }
  }

  const rows = [];
  for (let i = 1; i <= months; i++) {
    let dateLabel = '-';
    if (validStart) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      dateLabel = d.toISOString().substring(0, 10);
    }
    rows.push({ no: i, date: dateLabel, monthlyFee });
  }
  return rows;
}

// 차량의 월 대여료 결제일(monthlyFeePayDay)을 정렬 가능한 값으로 변환한다. "말일"은 항상 마지막 순서로 취급.
function getPaymentDaySortInfo(payDayRaw) {
  const raw = (payDayRaw || '').trim();
  if (raw.includes('말일')) return { sortValue: 32, label: '말일' };
  const m = raw.match(/(\d+)\s*일/);
  if (m) return { sortValue: parseInt(m[1], 10), label: `매월 ${m[1]}일` };
  return { sortValue: 999, label: '결제일 미지정' };
}

// 법인 그룹 목록을 대표 차량(첫 배치의 첫 차량)의 결제일 기준으로 묶고, 결제일 오름차순으로 정렬한다.
function groupCompaniesByPaymentDay(companyGroups) {
  const buckets = {};
  companyGroups.forEach(group => {
    const representativeVehicle = group.batches[0]?.vehicles[0];
    const { sortValue, label } = getPaymentDaySortInfo(representativeVehicle?.monthlyFeePayDay);
    const key = `${sortValue}_${label}`;
    if (!buckets[key]) buckets[key] = { sortValue, label, companyGroups: [] };
    buckets[key].companyGroups.push(group);
  });
  return Object.values(buckets).sort((a, b) => a.sortValue - b.sortValue);
}

// 법인 1개 행 + 하위 계약번호 목록. "렌터카 DB에서 생성" 청구서 화면과 "월 대여료 현황" 화면에서 공용으로 사용.
function CompanyEntry({ group, expandedCompany, onToggleCompany, selectedBatchKey, onSelectBatch }) {
  return (
    <div>
      <div
        onClick={() => onToggleCompany(group.companyName)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem',
          padding: '0.55rem 0.6rem', borderRadius: '6px', cursor: 'pointer',
          background: expandedCompany === group.companyName ? 'var(--primary-glow)' : 'var(--bg-main)',
          border: '1px solid var(--border-color)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
          {expandedCompany === group.companyName ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Building2 size={14} style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.companyName}</span>
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>차량 {group.totalVehicles}대</span>
      </div>
      {expandedCompany === group.companyName && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', margin: '0.3rem 0 0.5rem 1.4rem' }}>
          {group.batches.map(batch => (
            <div
              key={batch.batchKey}
              onClick={() => onSelectBatch(group.companyName, batch)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem',
                padding: '0.45rem 0.6rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem',
                background: selectedBatchKey === batch.batchKey ? 'var(--primary)' : 'transparent',
                color: selectedBatchKey === batch.batchKey ? '#fff' : 'var(--text-main)',
                border: `1px solid ${selectedBatchKey === batch.batchKey ? 'var(--primary)' : 'var(--border-color)'}`
              }}
            >
              <span>{batch.contractNo ? `계약번호: ${batch.contractNo}` : '계약번호 없음 (개별 건)'}</span>
              <span style={{ opacity: 0.85, flexShrink: 0 }}>차량 {batch.vehicles.length}대</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 법인 -> 계약번호(건) 트리 (법인명 검색 포함). "렌터카 DB에서 생성" 청구서 화면에서 사용.
function CompanyBatchTree({ groups, expandedCompany, onToggleCompany, selectedBatchKey, onSelectBatch }) {
  const [companySearch, setCompanySearch] = useState('');
  const filteredGroups = companySearch.trim()
    ? groups.filter(g => g.companyName.toLowerCase().includes(companySearch.trim().toLowerCase()))
    : groups;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{ position: 'relative', marginBottom: '0.4rem' }}>
        <Search size={14} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={companySearch}
          onChange={(e) => setCompanySearch(e.target.value)}
          placeholder="법인명 검색..."
          style={{
            width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.6rem 0.5rem 1.9rem',
            border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem',
            outline: 'none', background: '#fff', color: '#333'
          }}
        />
      </div>
      {groups.length === 0 ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>렌터카 DB에 등록된 차량이 없습니다.</div>
      ) : filteredGroups.length === 0 ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>검색 결과가 없습니다.</div>
      ) : filteredGroups.map(group => (
        <CompanyEntry
          key={group.companyName}
          group={group}
          expandedCompany={expandedCompany}
          onToggleCompany={onToggleCompany}
          selectedBatchKey={selectedBatchKey}
          onSelectBatch={onSelectBatch}
        />
      ))}
    </div>
  );
}

function BillingView({ showToast, currentUser }) {
  // Page-level tab: '청구서' | '월대여료 현황' - 월대여료 현황을 첫 화면으로 노출
  const [pageTab, setPageTab] = useState('schedule');

  // Tabs: 'list' | 'create' | 'db-generate'
  const [activeSubTab, setActiveSubTab] = useState('list');
  const [invoices, setInvoices] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state for selecting contract
  const [showContractModal, setShowContractModal] = useState(false);
  const [contractSearchQuery, setContractSearchQuery] = useState('');

  // Refs
  const excelInputRef = useRef(null);

  // Selected billing details
  const [selectedContract, setSelectedContract] = useState(null);
  const [billingMonth, setBillingMonth] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Invoice items state
  const [items, setItems] = useState([
    { desc: '', supplyPrice: 0, vat: 0, total: 0 }
  ]);

  // Bank settings
  const [bankName, setBankName] = useState('국민은행');
  const [bankAccount, setBankAccount] = useState('431801-01-235453');
  const [bankHolder, setBankHolder] = useState('(주)렌트베네핏');
  const [remarks, setRemarks] = useState('※ 기일 내에 미입금 시 연체료가 발생할 수 있습니다.\n※ 입금 시 반드시 계약자(또는 회사명) 명의로 입금해 주시기 바랍니다.');

  // Invoice Detail view modal
  const [viewingInvoice, setViewingInvoice] = useState(null);

  // 렌터카 DB 기반 청구서 생성 / 월대여료 현황 - 법인/계약번호 트리 공용 상태
  const [billingVehicles, setBillingVehicles] = useState([]);
  const [expandedCompany, setExpandedCompany] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null); // { companyName, vehicles, contractNo }
  const [dbForm, setDbForm] = useState({
    billingMonth: '', invoiceDate: '', dueDate: '',
    prevUnpaid: 0, prevOverpaid: 0, maintenanceFee: 0, fineFee: 0,
    nthPay: 1, bankName: '신한은행', bankAccount: '', virtualAccount: '', email: ''
  });

  const companyGroups = useMemo(() => groupVehiclesByCompanyAndContract(billingVehicles), [billingVehicles]);

  // 월 대여료 현황 탭 전용: 법인명 검색 + 결제일 오름차순 그룹핑
  const [scheduleCompanySearch, setScheduleCompanySearch] = useState('');
  const scheduleFilteredCompanyGroups = useMemo(() => {
    if (!scheduleCompanySearch.trim()) return companyGroups;
    const q = scheduleCompanySearch.trim().toLowerCase();
    return companyGroups.filter(g => g.companyName.toLowerCase().includes(q));
  }, [companyGroups, scheduleCompanySearch]);
  const scheduleDayGroups = useMemo(() => groupCompaniesByPaymentDay(scheduleFilteredCompanyGroups), [scheduleFilteredCompanyGroups]);

  // 선택된 법인의 실제 원드라이브(RENT) 폴더명 매핑 상태
  const [companyFolder, setCompanyFolder] = useState(null); // { folderName } or null(미등록)
  const [checkingFolder, setCheckingFolder] = useState(false);
  const [folderInputMode, setFolderInputMode] = useState('existing'); // 'existing' | 'auto'
  const [folderNameInput, setFolderNameInput] = useState('');
  const [pdfInvoice, setPdfInvoice] = useState(null); // PDF 캡처용 숨김 렌더 대상 청구서

  useEffect(() => {
    if (!selectedBatch) {
      setCompanyFolder(null);
      setFolderNameInput('');
      return;
    }
    const bizNo = selectedBatch.vehicles[0]?.bizOrRegNo || '';
    setCheckingFolder(true);
    fetch(`${API_HOST}/api/company-folders/lookup?companyName=${encodeURIComponent(selectedBatch.companyName)}&bizNo=${encodeURIComponent(bizNo)}`)
      .then(res => res.json())
      .then(data => {
        setCompanyFolder(data.folder || null);
        setFolderNameInput('');
        setFolderInputMode('existing');
      })
      .catch(err => console.error(err))
      .finally(() => setCheckingFolder(false));
  }, [selectedBatch]);

  const getPaymentDayLabel = (vehicle) => {
    const raw = vehicle?.monthlyFeePayDay || '';
    if (raw.includes('말일')) return '말일';
    const m = raw.match(/(\d+)\s*일/);
    return m ? `${m[1]}일` : '25일';
  };

  // 법인 폴더명을 확정(기존 폴더명 입력 또는 신규 자동 생성)하고 표준 하위 폴더 구조를 만든다
  const resolveCompanyFolder = async () => {
    if (!selectedBatch) return null;
    if (companyFolder) return companyFolder;

    const bizNo = selectedBatch.vehicles[0]?.bizOrRegNo || '';
    const isAuto = folderInputMode === 'auto';
    if (!isAuto && !folderNameInput.trim()) {
      showToast('기존 원드라이브 폴더명을 입력하거나 "새 폴더 자동 생성"을 선택해 주세요.', 'error');
      return null;
    }

    try {
      const res = await fetch(`${API_HOST}/api/company-folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({
          companyName: selectedBatch.companyName,
          bizNo,
          folderName: isAuto ? '' : folderNameInput.trim(),
          autoCreate: isAuto,
          paymentDay: getPaymentDayLabel(selectedBatch.vehicles[0])
        })
      });
      const data = await res.json();
      if (data.success) {
        setCompanyFolder(data.folder);
        return data.folder;
      }
      showToast(data.message || '폴더 등록 실패', 'error');
      return null;
    } catch (err) {
      showToast('폴더 등록 중 오류가 발생했습니다.', 'error');
      return null;
    }
  };

  // 방금 생성된 청구서를 PDF로 만들어 법인 폴더의 "02.청구서" 하위 폴더에 저장한다
  const invoicePdfRef = useRef(null);
  const generateAndSaveInvoicePdf = async (invoiceId, folderName, companyName) => {
    try {
      const res = await fetch(`${API_HOST}/api/invoices/${invoiceId}`);
      const fullInvoice = await res.json();
      setPdfInvoice(fullInvoice);

      // InvoiceTemplate이 렌더링될 때까지 잠깐 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      const element = invoicePdfRef.current;
      if (!element) return;

      const fileName = `청구서_${companyName}_${fullInvoice.billingMonth}.pdf`;
      const pdfBlob = await html2pdf()
        .set({
          margin: 5,
          filename: fileName,
          image: { type: 'png' },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        })
        .from(element)
        .outputPdf('blob');

      const formData = new FormData();
      formData.append('file', pdfBlob, fileName);
      formData.append('businessLine', 'rental');
      formData.append('companyFolderName', folderName);
      formData.append('customerName', companyName);
      formData.append('docType', '청구서');
      formData.append('fileName', fileName);

      const uploadRes = await fetch(`${API_HOST}/api/documents/save-local`, {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' },
        body: formData
      });
      const uploadData = await uploadRes.json();

      if (uploadData.success) {
        showToast(`청구서 PDF가 [RENT\\${folderName}\\02.청구서]에 저장되었습니다.`, 'success');
      } else {
        showToast(uploadData.message || '청구서 PDF 저장 실패', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('청구서 PDF 생성/저장 중 오류가 발생했습니다.', 'error');
    } finally {
      setPdfInvoice(null);
    }
  };

  // Initialize dates
  useEffect(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    setBillingMonth(`${yyyy}-${mm}`);
    setInvoiceDate(today.toISOString().substring(0, 10));

    // Default due date: 25th of current month
    const defaultDue = new Date(yyyy, today.getMonth(), 25);
    setDueDate(defaultDue.toISOString().substring(0, 10));
    setDbForm(prev => ({ ...prev, billingMonth: `${yyyy}-${mm}`, invoiceDate: today.toISOString().substring(0, 10), dueDate: defaultDue.toISOString().substring(0, 10) }));

    fetchInvoices();
    fetchContracts();
    fetchBillingVehicles();
  }, []);

  const fetchBillingVehicles = async () => {
    try {
      const res = await fetch(`${API_HOST}/api/vehicles?limit=1000`);
      if (res.ok) {
        const data = await res.json();
        setBillingVehicles(data.vehicles || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectBatch = (companyName, batch) => {
    setSelectedBatch({ companyName, contractNo: batch.contractNo, vehicles: batch.vehicles });
  };

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_HOST}/api/invoices`);
      if (res.ok) {
        const data = await res.json();
        setInvoices(data);
      }
    } catch (err) {
      console.error(err);
      showToast('청구서 목록 조회 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchContracts = async () => {
    try {
      const res = await fetch(`${API_HOST}/api/contracts`);
      if (res.ok) {
        const data = await res.json();
        setContracts(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Excel upload parser and batch creator (Supports Hybrid parsing for standard sheet & specific '청구서' sheet)
  const handleExcelUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        let payloadList = [];
        
        // Helper to convert Excel serial dates to standard YYYY-MM-DD
        const convertExcelDate = (val) => {
          if (!val) return null;
          if (typeof val === 'number') {
            const date = new Date((val - 25569) * 86400 * 1000);
            return date.toISOString().substring(0, 10);
          }
          const strVal = String(val).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) return strVal;
          return strVal;
        };

        // CASE 1: '청구서' sheet exists (Exact Coordinate Parsing based on provided layout)
        if (workbook.SheetNames.includes('청구서')) {
          const sheet = workbook.Sheets['청구서'];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

          if (rows.length < 15) {
            showToast('청구서 시트의 데이터가 올바르지 않습니다.', 'error');
            return;
          }

          // Parse cells by coordinates
          const customerName = String(rows[1]?.[0] || '').trim();
          const totalAmount = parseInt(rows[3]?.[14] || 0);
          const dueDateVal = convertExcelDate(rows[4]?.[20]) || new Date().toISOString().substring(0, 10);
          const invoiceDateVal = convertExcelDate(rows[5]?.[20]) || new Date().toISOString().substring(0, 10);
          const virtualAccount = String(rows[6]?.[20] || '').trim();

          const prevUnpaid = parseInt(rows[9]?.[3] || rows[9]?.[5] || 0);
          const prevOverpaid = parseInt(rows[10]?.[3] || rows[10]?.[5] || 0);
          const totalRent = parseInt(rows[11]?.[3] || rows[11]?.[5] || 0);
          const maintenanceFee = parseInt(rows[12]?.[3] || rows[12]?.[5] || 0);
          const fineFee = parseInt(rows[13]?.[3] || rows[13]?.[5] || 0);

          const bankName = String(rows[10]?.[8] || rows[10]?.[19] || '').trim();
          const bankAccount = String(rows[11]?.[8] || rows[11]?.[19] || '').trim();
          const nthPay = parseInt(rows[12]?.[8] || rows[12]?.[19] || 1);
          const withdrawDate = convertExcelDate(rows[13]?.[8] || rows[13]?.[19]);

          // Parse vehicles list (rows 16-20)
          const vehicles = [];
          for (let i = 16; i <= 20; i++) {
            const row = rows[i];
            if (!row) continue;

            // Left Column (No 1-5)
            const carNoLeft = String(row[1] || '').trim();
            const rentLeft = parseInt(row[5] || 0);
            const delivLeft = convertExcelDate(row[9]);
            if (carNoLeft && carNoLeft !== '0' && carNoLeft !== '') {
              vehicles.push({ carNo: carNoLeft, monthlyRent: rentLeft, deliveryDate: delivLeft });
            }

            // Right Column (No 6-10)
            const carNoRight = String(row[14] || '').trim();
            const rentRight = parseInt(row[18] || 0);
            const delivRight = convertExcelDate(row[22]);
            if (carNoRight && carNoRight !== '0' && carNoRight !== '') {
              vehicles.push({ carNo: carNoRight, monthlyRent: rentRight, deliveryDate: delivRight });
            }
          }

          const dailyRent = parseInt(rows[23]?.[4] || 0);
          const firstMonthFee = parseInt(rows[23]?.[13] || 0);
          const lastMonthFee = parseInt(rows[23]?.[23] || 0);

          // Get email from '월대여료' sheet if available, otherwise use default
          let email = 'mhgood45@dkin.co.kr';
          if (workbook.SheetNames.includes('월대여료')) {
            const rentSheet = workbook.Sheets['월대여료'];
            const rentRows = XLSX.utils.sheet_to_json(rentSheet);
            if (rentRows.length > 0) {
              const firstRowKeys = Object.keys(rentRows[0]);
              const emailKey = firstRowKeys.find(k => k.toLowerCase().includes('email') || k.includes('이메일') || k.includes('Email') || k.includes('7_1'));
              if (emailKey && rentRows[0][emailKey]) {
                email = String(rentRows[0][emailKey]).trim();
              }
            }
          }

          // Generate standard items
          const items = [];
          if (totalRent > 0) items.push({ desc: '당월 렌트료 합계', supplyPrice: Math.round(totalRent/1.1), vat: totalRent - Math.round(totalRent/1.1), total: totalRent });
          if (prevUnpaid > 0) items.push({ desc: '전월 미제공금액', supplyPrice: Math.round(prevUnpaid/1.1), vat: prevUnpaid - Math.round(prevUnpaid/1.1), total: prevUnpaid });
          if (prevOverpaid > 0) items.push({ desc: '전월 초과입금액', supplyPrice: -Math.round(prevOverpaid/1.1), vat: -(prevOverpaid - Math.round(prevOverpaid/1.1)), total: -prevOverpaid });
          if (maintenanceFee > 0) items.push({ desc: '정기점검 비용', supplyPrice: Math.round(maintenanceFee/1.1), vat: maintenanceFee - Math.round(maintenanceFee/1.1), total: maintenanceFee });
          if (fineFee > 0) items.push({ desc: '범칙금 / 과태료', supplyPrice: Math.round(fineFee/1.1), vat: fineFee - Math.round(fineFee/1.1), total: fineFee });

          if (items.length === 0) {
            items.push({ desc: '장기렌터카 대여료', supplyPrice: Math.round(totalAmount/1.1), vat: totalAmount - Math.round(totalAmount/1.1), total: totalAmount });
          }

          payloadList.push({
            customerName,
            billingMonth: dueDateVal ? dueDateVal.substring(0, 7) : new Date().toISOString().substring(0, 7),
            invoiceDate: invoiceDateVal,
            dueDate: dueDateVal,
            items,
            totalSupplyPrice: Math.round(totalAmount/1.1),
            totalVat: totalAmount - Math.round(totalAmount/1.1),
            totalAmount,
            bankName,
            bankAccount,
            bankHolder: customerName,
            remarks: `입금전용계좌: ${virtualAccount}`,
            createdBy: currentUser?.name || '시스템',
            
            // Custom excel columns mapping
            prevUnpaid,
            prevOverpaid,
            maintenanceFee,
            fineFee,
            firstMonthFee,
            lastMonthFee,
            nthPay,
            withdrawDate,
            virtualAccount,
            email,
            vehicles,
            invoiceType: 'excel_payment'
          });
        }
        // CASE 2: No '청구서' sheet, fallback to standard '월대여료' column parsing
        else if (workbook.SheetNames.includes('월대여료')) {
          const sheet = workbook.Sheets['월대여료'];
          const rawRows = XLSX.utils.sheet_to_json(sheet);

          if (rawRows.length === 0) {
            showToast('월대여료 시트에 데이터가 없습니다.', 'error');
            return;
          }

          const parsedRows = rawRows.map(row => {
            const normRow = {};
            Object.keys(row).forEach(k => {
              normRow[k.trim().replace(/\s+/g, '')] = row[k];
            });
            
            return {
              customerName: normRow['고객명'] || normRow['고객사명'] || normRow['업체명'] || normRow['상호'] || '',
              paymentDate: convertExcelDate(normRow['결제일'] || normRow['청구일'] || normRow['결제일자']),
              baseDate: convertExcelDate(normRow['작성기준일'] || normRow['작성일'] || normRow['청구기준일']),
              virtualAccount: normRow['입금전용계좌'] || normRow['가상계좌'] || normRow['수납계좌'] || '',
              bankName: normRow['거래은행'] || normRow['은행명'] || normRow['은행'] || '',
              bankAccount: normRow['계좌번호'] || normRow['출금계좌'] || '',
              nthPay: parseInt(normRow['납입회차'] || normRow['회차'] || 1),
              withdrawDate: convertExcelDate(normRow['출금일'] || normRow['출금일자']),
              carNo: normRow['차량번호'] || normRow['차호'] || '',
              monthlyRent: parseInt(normRow['월렌트료'] || normRow['대여료'] || normRow['렌트료'] || 0),
              deliveryDate: convertExcelDate(normRow['인도일'] || normRow['인도일자'] || normRow['개시일']),
              email: normRow['담당자E-Mail'] || normRow['담당자이메일'] || normRow['이메일'] || normRow['담당자메일'] || '',
              
              prevUnpaid: parseInt(normRow['전월미제공금액'] || normRow['전월미납액'] || 0),
              prevOverpaid: parseInt(normRow['전월초과입금액'] || normRow['초과입금액'] || 0),
              maintenanceFee: parseInt(normRow['정기점검'] || normRow['정비료'] || 0),
              fineFee: parseInt(normRow['범칙금'] || normRow['과태료'] || 0),
              firstMonthFee: parseInt(normRow['첫달결제금액'] || 0),
              lastMonthFee: parseInt(normRow['마지막달결제금액'] || 0)
            };
          });

          // Group by customer
          const groups = {};
          parsedRows.forEach(row => {
            if (!row.customerName) return;
            const key = `${row.customerName}_${row.paymentDate}`;
            if (!groups[key]) {
              groups[key] = {
                customerName: row.customerName,
                paymentDate: row.paymentDate || new Date().toISOString().substring(0, 10),
                baseDate: row.baseDate || new Date().toISOString().substring(0, 10),
                virtualAccount: row.virtualAccount || '부산은행 / 101-2077-5994-03',
                bankName: row.bankName || '신한은행',
                bankAccount: row.bankAccount || '',
                nthPay: row.nthPay || 1,
                withdrawDate: row.withdrawDate || row.paymentDate || new Date().toISOString().substring(0, 10),
                email: row.email || '',
                prevUnpaid: row.prevUnpaid || 0,
                prevOverpaid: row.prevOverpaid || 0,
                maintenanceFee: row.maintenanceFee || 0,
                fineFee: row.fineFee || 0,
                firstMonthFee: row.firstMonthFee || 0,
                lastMonthFee: row.lastMonthFee || 0,
                vehicles: []
              };
            }
            if (row.carNo) {
              groups[key].vehicles.push({
                carNo: row.carNo,
                monthlyRent: row.monthlyRent,
                deliveryDate: row.deliveryDate
              });
            }
          });

          Object.values(groups).forEach(group => {
            const totalRent = group.vehicles.reduce((sum, v) => sum + v.monthlyRent, 0);
            const totalAmount = totalRent + group.prevUnpaid - group.prevOverpaid + group.maintenanceFee + group.fineFee;
            const supplyPrice = Math.round(totalAmount / 1.1);
            const vat = totalAmount - supplyPrice;

            const items = [];
            if (totalRent > 0) items.push({ desc: '당월 렌트료 합계', supplyPrice: Math.round(totalRent/1.1), vat: totalRent - Math.round(totalRent/1.1), total: totalRent });
            if (group.prevUnpaid > 0) items.push({ desc: '전월 미제공금액', supplyPrice: Math.round(group.prevUnpaid/1.1), vat: group.prevUnpaid - Math.round(group.prevUnpaid/1.1), total: group.prevUnpaid });
            if (group.prevOverpaid > 0) items.push({ desc: '전월 초과입금액', supplyPrice: -Math.round(group.prevOverpaid/1.1), vat: -(group.prevOverpaid - Math.round(group.prevOverpaid/1.1)), total: -group.prevOverpaid });
            if (group.maintenanceFee > 0) items.push({ desc: '정기점검 비용', supplyPrice: Math.round(group.maintenanceFee/1.1), vat: group.maintenanceFee - Math.round(group.maintenanceFee/1.1), total: group.maintenanceFee });
            if (group.fineFee > 0) items.push({ desc: '범칙금 / 과태료', supplyPrice: Math.round(group.fineFee/1.1), vat: group.fineFee - Math.round(group.fineFee/1.1), total: group.fineFee });

            if (items.length === 0) {
              items.push({ desc: '장기렌터카 대여료', supplyPrice, vat, total: totalAmount });
            }

            payloadList.push({
              customerName: group.customerName,
              billingMonth: group.paymentDate ? String(group.paymentDate).substring(0, 7) : new Date().toISOString().substring(0, 7),
              invoiceDate: group.baseDate,
              dueDate: group.paymentDate,
              items,
              totalSupplyPrice: supplyPrice,
              totalVat: vat,
              totalAmount,
              bankName: group.bankName,
              bankAccount: group.bankAccount,
              bankHolder: group.customerName,
              remarks: `입금전용계좌: ${group.virtualAccount}`,
              createdBy: currentUser?.name || '시스템',
              prevUnpaid: group.prevUnpaid,
              prevOverpaid: group.prevOverpaid,
              maintenanceFee: group.maintenanceFee,
              fineFee: group.fineFee,
              firstMonthFee: group.firstMonthFee,
              lastMonthFee: group.lastMonthFee,
              nthPay: group.nthPay,
              withdrawDate: group.withdrawDate,
              virtualAccount: group.virtualAccount,
              email: group.email,
              vehicles: group.vehicles,
              invoiceType: 'excel_payment'
            });
          });
        }

        if (payloadList.length === 0) {
          showToast('유효한 시트(청구서 또는 월대여료)를 찾을 수 없거나 데이터 분석에 실패했습니다.', 'error');
          return;
        }

        // Batch upload
        let successCount = 0;
        for (const payload of payloadList) {
          const response = await fetch(`${API_HOST}/api/invoices`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Role': currentUser?.role || 'viewer'
            },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            successCount++;
          }
        }

        showToast(`엑셀 업로드 완료! 총 ${payloadList.length}건 중 ${successCount}건의 청구서가 등록되었습니다.`, 'success');
        fetchInvoices();
      } catch (err) {
        console.error(err);
        showToast('엑셀 파일 분석 또는 일괄 등록에 실패했습니다.', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // Reset input
  };

  // When a contract is selected, pre-populate billing data
  const handleSelectContract = (contract) => {
    setSelectedContract(contract);
    setShowContractModal(false);
    
    const carModel = contract.vehicle?.model || '차량';
    const carCode = contract.vehicle?.code || '';
    const desc = `장기렌터카 월 대여료 (${carModel}${carCode ? ` / ${carCode}` : ''})`;
    const rentFee = contract.pricing?.monthlyFee || 0;
    
    const supplyPrice = Math.round(rentFee / 1.1);
    const vat = rentFee - supplyPrice;
    
    setItems([
      { desc, supplyPrice, vat, total: rentFee }
    ]);
  };

  const handleAddItemRow = () => {
    setItems([...items, { desc: '', supplyPrice: 0, vat: 0, total: 0 }]);
  };

  const handleRemoveItemRow = (idx) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx, field, value) => {
    const updated = [...items];
    if (field === 'supplyPrice') {
      const supply = parseInt(value) || 0;
      const vat = Math.round(supply * 0.1);
      updated[idx] = {
        ...updated[idx],
        supplyPrice: supply,
        vat: vat,
        total: supply + vat
      };
    } else if (field === 'desc') {
      updated[idx] = { ...updated[idx], desc: value };
    }
    setItems(updated);
  };

  const totalSupplyPrice = items.reduce((sum, item) => sum + item.supplyPrice, 0);
  const totalVat = items.reduce((sum, item) => sum + item.vat, 0);
  const totalAmount = totalSupplyPrice + totalVat;

  const handleSaveInvoice = async (e) => {
    e.preventDefault();
    if (!selectedContract) {
      showToast('연동할 계약서를 선택해 주세요.', 'error');
      return;
    }
    
    if (items.some(item => !item.desc.trim())) {
      showToast('청구 항목 품명을 입력해 주세요.', 'error');
      return;
    }

    try {
      const payload = {
        contractId: selectedContract._id,
        customerId: selectedContract.customer?._id || selectedContract.customer,
        billingMonth,
        invoiceDate,
        dueDate,
        items,
        totalSupplyPrice,
        totalVat,
        totalAmount,
        bankName,
        bankAccount,
        bankHolder,
        remarks,
        createdBy: currentUser?.name || '담당자',
        invoiceType: 'standard'
      };

      const res = await fetch(`${API_HOST}/api/invoices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Role': currentUser?.role || 'viewer'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showToast('장기렌트 청구서가 발행 및 저장되었습니다.', 'success');
        setSelectedContract(null);
        setItems([{ desc: '', supplyPrice: 0, vat: 0, total: 0 }]);
        setActiveSubTab('list');
        fetchInvoices();
      } else {
        const errorData = await res.json();
        showToast(errorData.message || '청구서 발행 실패', 'error');
      }
    } catch (err) {
      showToast('서버 저장 중 오류가 발생했습니다.', 'error');
    }
  };

  // 렌터카 DB에서 선택한 법인/계약번호 묶음으로 청구서를 자동 생성한다 (엑셀 업로드와 동일한 결제금액 내역서 양식)
  const handleGenerateFromDb = async () => {
    if (!selectedBatch) {
      showToast('법인과 계약 건을 먼저 선택해 주세요.', 'error');
      return;
    }

    // 저장할 법인 폴더를 먼저 확정 (미등록이면 입력받은 값으로 등록 + 표준 하위 폴더 생성)
    const folder = await resolveCompanyFolder();
    if (!folder) return;

    const vehicles = selectedBatch.vehicles;
    const totalRent = vehicles.reduce((sum, v) => sum + (v.monthlyPayment || 0), 0);
    const { prevUnpaid, prevOverpaid, maintenanceFee, fineFee } = dbForm;
    const totalAmount = totalRent + prevUnpaid - prevOverpaid + maintenanceFee + fineFee;
    const totalSupply = Math.round(totalAmount / 1.1);
    const totalVatAmt = totalAmount - totalSupply;

    const genItems = [];
    if (totalRent > 0) genItems.push({ desc: '당월 렌트료 합계', supplyPrice: Math.round(totalRent / 1.1), vat: totalRent - Math.round(totalRent / 1.1), total: totalRent });
    if (prevUnpaid > 0) genItems.push({ desc: '전월 미제공금액', supplyPrice: Math.round(prevUnpaid / 1.1), vat: prevUnpaid - Math.round(prevUnpaid / 1.1), total: prevUnpaid });
    if (prevOverpaid > 0) genItems.push({ desc: '전월 초과입금액', supplyPrice: -Math.round(prevOverpaid / 1.1), vat: -(prevOverpaid - Math.round(prevOverpaid / 1.1)), total: -prevOverpaid });
    if (maintenanceFee > 0) genItems.push({ desc: '정기점검 비용', supplyPrice: Math.round(maintenanceFee / 1.1), vat: maintenanceFee - Math.round(maintenanceFee / 1.1), total: maintenanceFee });
    if (fineFee > 0) genItems.push({ desc: '범칙금 / 과태료', supplyPrice: Math.round(fineFee / 1.1), vat: fineFee - Math.round(fineFee / 1.1), total: fineFee });
    if (genItems.length === 0) genItems.push({ desc: '장기렌터카 대여료', supplyPrice: totalSupply, vat: totalVatAmt, total: totalAmount });

    try {
      const res = await fetch(`${API_HOST}/api/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({
          customerName: selectedBatch.companyName,
          billingMonth: dbForm.billingMonth,
          invoiceDate: dbForm.invoiceDate,
          dueDate: dbForm.dueDate,
          items: genItems,
          totalSupplyPrice: totalSupply,
          totalVat: totalVatAmt,
          totalAmount,
          bankName: dbForm.bankName,
          bankAccount: dbForm.bankAccount,
          bankHolder: selectedBatch.companyName,
          remarks: dbForm.virtualAccount ? `입금전용계좌: ${dbForm.virtualAccount}` : '',
          createdBy: currentUser?.name || '시스템',
          prevUnpaid, prevOverpaid, maintenanceFee, fineFee,
          firstMonthFee: 0,
          lastMonthFee: 0,
          nthPay: dbForm.nthPay,
          withdrawDate: dbForm.dueDate,
          virtualAccount: dbForm.virtualAccount,
          email: dbForm.email,
          vehicles: vehicles.map(v => ({ carNo: v.carNumber, monthlyRent: v.monthlyPayment || 0, deliveryDate: v.deliveryDate || null })),
          invoiceType: 'excel_payment'
        })
      });

      if (res.ok) {
        const createdInvoice = await res.json();
        showToast(`[${selectedBatch.companyName}] 청구서가 렌터카 DB 기준으로 생성되었습니다.`, 'success');
        await generateAndSaveInvoicePdf(createdInvoice._id, folder.folderName, selectedBatch.companyName);
        setSelectedBatch(null);
        setDbForm(prev => ({ ...prev, prevUnpaid: 0, prevOverpaid: 0, maintenanceFee: 0, fineFee: 0, virtualAccount: '', email: '' }));
        setActiveSubTab('list');
        fetchInvoices();
      } else {
        const errorData = await res.json();
        showToast(errorData.message || '청구서 생성 실패', 'error');
      }
    } catch (err) {
      showToast('서버 저장 중 오류가 발생했습니다.', 'error');
    }
  };

  const handleDeleteInvoice = async (id) => {
    if (!window.confirm('정말 이 청구서 이력을 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_HOST}/api/invoices/${id}`, {
        method: 'DELETE',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });
      if (res.ok) {
        showToast('청구서 이력이 삭제되었습니다.', 'success');
        fetchInvoices();
      } else {
        showToast('청구서 삭제 실패', 'error');
      }
    } catch (err) {
      showToast('서버 통신 실패', 'error');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const filteredInvoices = invoices.filter(inv => {
    const custName = inv.customer?.name || '';
    const invNo = inv.invoiceNo || '';
    const query = searchQuery.toLowerCase();
    return custName.toLowerCase().includes(query) || invNo.toLowerCase().includes(query);
  });

  const filteredContracts = contracts.filter(c => {
    const custName = c.customer?.name || '';
    const carModel = c.vehicle?.model || '';
    const cNo = c.contractNo || '';
    const query = contractSearchQuery.toLowerCase();
    return custName.toLowerCase().includes(query) || carModel.toLowerCase().includes(query) || cNo.toLowerCase().includes(query);
  });

  return (
    <div style={{ background: 'var(--bg-surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            size: A4 portrait;
            margin: 0 !important;
          }
          body {
            background: #fff !important;
            color: #000 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          aside, header, nav, footer, button, .no-print,
          body .desktop-sidebar, body .mobile-header, .tab-buttons-container, .billing-view-content {
            display: none !important;
          }
          .invoice-print-container {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: 297mm !important;
            margin: 0 !important;
            padding: 15mm 15mm 15mm 15mm !important;
            box-sizing: border-box !important;
            background: #fff !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .invoice-print-container table {
            color: #000 !important;
            border-color: #000 !important;
          }
          .invoice-print-container th, .invoice-print-container td {
            border-color: #000 !important;
          }
        }
        .invoice-print-container {
          display: none;
        }
      `}} />

      <div className="no-print" style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.2rem' }}>
        <button
          onClick={() => setPageTab('schedule')}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.65rem 1.3rem', borderRadius: '8px', border: 'none', fontWeight: '800', fontSize: '0.92rem', cursor: 'pointer',
            background: pageTab === 'schedule' ? 'var(--primary)' : 'var(--bg-main)',
            color: pageTab === 'schedule' ? '#fff' : 'var(--text-muted)'
          }}
        >
          <ListChecks size={16} /> 월 대여료 현황
        </button>
        <button
          onClick={() => setPageTab('invoice')}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.65rem 1.3rem', borderRadius: '8px', border: 'none', fontWeight: '800', fontSize: '0.92rem', cursor: 'pointer',
            background: pageTab === 'invoice' ? 'var(--primary)' : 'var(--bg-main)',
            color: pageTab === 'invoice' ? '#fff' : 'var(--text-muted)'
          }}
        >
          <FileText size={16} /> 청구서
        </button>
      </div>

      {pageTab === 'invoice' && (
      <>
      <div className="billing-view-content no-print">
        <div className="tab-buttons-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              onClick={() => { setActiveSubTab('list'); setViewingInvoice(null); }}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: '6px',
                border: 'none',
                fontWeight: '700',
                cursor: 'pointer',
                background: activeSubTab === 'list' ? 'var(--primary-glow)' : 'transparent',
                color: activeSubTab === 'list' ? 'var(--primary)' : 'var(--text-muted)',
                transition: 'all 0.2s'
              }}
            >
              청구 이력 목록
            </button>
            <button
              onClick={() => { setActiveSubTab('create'); setViewingInvoice(null); }}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: '6px',
                border: 'none',
                fontWeight: '700',
                cursor: 'pointer',
                background: activeSubTab === 'create' ? 'var(--primary-glow)' : 'transparent',
                color: activeSubTab === 'create' ? 'var(--primary)' : 'var(--text-muted)',
                transition: 'all 0.2s'
              }}
            >
              수동 청구서 발행
            </button>
            <button
              onClick={() => { setActiveSubTab('db-generate'); setViewingInvoice(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.6rem 1.2rem',
                borderRadius: '6px',
                border: 'none',
                fontWeight: '700',
                cursor: 'pointer',
                background: activeSubTab === 'db-generate' ? 'var(--primary-glow)' : 'transparent',
                color: activeSubTab === 'db-generate' ? 'var(--primary)' : 'var(--text-muted)',
                transition: 'all 0.2s'
              }}
            >
              <Database size={15} /> 렌터카 DB에서 생성
            </button>
          </div>

          {activeSubTab === 'list' && !viewingInvoice && (
            <div>
              <button 
                onClick={() => excelInputRef.current.click()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: 'var(--primary)',
                  color: '#fff',
                  border: 'none',
                  padding: '0.6rem 1.2rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <Upload size={16} /> 결제 내역 엑셀 업로드
              </button>
              <input 
                type="file" 
                ref={excelInputRef} 
                onChange={handleExcelUpload} 
                accept=".xlsx, .xls, .xlsm" 
                style={{ display: 'none' }} 
              />
            </div>
          )}
        </div>

        {activeSubTab === 'list' && !viewingInvoice && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                <input 
                  type="text" 
                  placeholder="고객명, 청구서번호 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.5rem 0.5rem 2rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    background: 'var(--bg-main)',
                    color: 'var(--text-main)'
                  }}
                />
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left', color: '#333' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-color)', fontWeight: '700', color: '#1e293b' }}>
                    <th style={{ padding: '0.8rem' }}>청구번호</th>
                    <th style={{ padding: '0.8rem' }}>고객명</th>
                    <th style={{ padding: '0.8rem' }}>청구월</th>
                    <th style={{ padding: '0.8rem' }}>양식종류</th>
                    <th style={{ padding: '0.8rem' }}>청구금액</th>
                    <th style={{ padding: '0.8rem' }}>발행일자</th>
                    <th style={{ padding: '0.8rem' }}>지급기일</th>
                    <th style={{ padding: '0.8rem' }}>담당자</th>
                    <th style={{ padding: '0.8rem', width: '120px', textAlign: 'center' }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="9" style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
                  ) : filteredInvoices.length === 0 ? (
                    <tr><td colSpan="9" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>발행된 청구서 이력이 없습니다.</td></tr>
                  ) : (
                    filteredInvoices.map(inv => (
                      <tr key={inv._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.8rem', fontWeight: '700', color: '#0f172a' }}>{inv.invoiceNo}</td>
                        <td style={{ padding: '0.8rem' }}>{inv.customer?.name || '-'}</td>
                        <td style={{ padding: '0.8rem', fontWeight: '600' }}>{inv.billingMonth}</td>
                        <td style={{ padding: '0.8rem' }}>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            backgroundColor: inv.invoiceType === 'excel_payment' ? '#f1f5f9' : '#e0f2fe',
                            color: inv.invoiceType === 'excel_payment' ? '#475569' : '#0369a1'
                          }}>
                            {inv.invoiceType === 'excel_payment' ? '결제금액 내역서' : '수동 일반청구서'}
                          </span>
                        </td>
                        <td style={{ padding: '0.8rem', fontWeight: '700', color: '#0369a1' }}>{inv.totalAmount?.toLocaleString()}원</td>
                        <td style={{ padding: '0.8rem' }}>{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                        <td style={{ padding: '0.8rem' }}>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '-'}</td>
                        <td style={{ padding: '0.8rem' }}>{inv.createdBy}</td>
                        <td style={{ padding: '0.8rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                          <button 
                            onClick={() => setViewingInvoice(inv)}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', padding: '0.3rem 0.6rem', border: '1px solid #cbd5e1', background: '#fff', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '600' }}
                          >
                            <FileText size={12} /> 보기
                          </button>
                          <button 
                            onClick={() => handleDeleteInvoice(inv._id)}
                            style={{ border: 'none', background: '#fee2e2', color: '#ef4444', padding: '0.3rem', borderRadius: '4px', cursor: 'pointer' }}
                            title="청구서 삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeSubTab === 'create' && (
          <form onSubmit={handleSaveInvoice} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', background: 'var(--bg-main)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.4rem', color: 'var(--text-bright)' }}>연동 계약서 선택</label>
                <div style={{ padding: '0.6rem', background: '#f8fafc', color: '#334155', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '600' }}>
                  {selectedContract 
                    ? `[계약번호: ${selectedContract.contractNo}] ${selectedContract.customer?.name} - ${selectedContract.vehicle?.model} (${selectedContract.pricing?.monthlyFee?.toLocaleString()}원)` 
                    : '아래 버튼을 눌러 연동할 계약서를 선택해주세요.'}
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setShowContractModal(true)}
                style={{ background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer', height: 'fit-content' }}
              >
                계약서 불러오기
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.4rem', color: 'var(--text-bright)' }}>청구년월</label>
                <input 
                  type="month" 
                  value={billingMonth} 
                  onChange={(e) => setBillingMonth(e.target.value)} 
                  required
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.9rem', background: 'var(--bg-main)', color: 'var(--text-main)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.4rem', color: 'var(--text-bright)' }}>청구일자</label>
                <input 
                  type="date" 
                  value={invoiceDate} 
                  onChange={(e) => setInvoiceDate(e.target.value)} 
                  required
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.9rem', background: 'var(--bg-main)', color: 'var(--text-main)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.4rem', color: 'var(--text-bright)' }}>지급납기일자</label>
                <input 
                  type="date" 
                  value={dueDate} 
                  onChange={(e) => setDueDate(e.target.value)} 
                  required
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.9rem', background: 'var(--bg-main)', color: 'var(--text-main)' }}
                />
              </div>
            </div>

            <div style={{ background: 'var(--bg-main)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: '800', color: 'var(--text-bright)' }}>청구 상세 내역 항목</h3>
                <button 
                  type="button" 
                  onClick={handleAddItemRow}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'var(--primary-glow)', color: 'var(--primary)', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
                >
                  <Plus size={14} /> 항목 추가
                </button>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.5rem', width: '50%' }}>품명 / 항목</th>
                    <th style={{ padding: '0.5rem', width: '20%' }}>공급가액</th>
                    <th style={{ padding: '0.5rem', width: '15%' }}>부가세(10%)</th>
                    <th style={{ padding: '0.5rem', width: '10%' }}>합계금액</th>
                    <th style={{ padding: '0.5rem', width: '5%', textAlign: 'center' }}>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.4rem' }}>
                        <input 
                          type="text" 
                          placeholder="예: 장기렌터카 월 대여료 (팰리세이드)" 
                          value={item.desc}
                          onChange={(e) => handleItemChange(idx, 'desc', e.target.value)}
                          style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }}
                        />
                      </td>
                      <td style={{ padding: '0.4rem' }}>
                        <input 
                          type="number" 
                          placeholder="공급가액" 
                          value={item.supplyPrice || ''}
                          onChange={(e) => handleItemChange(idx, 'supplyPrice', e.target.value)}
                          style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)', textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-muted)' }}>
                        {item.vat?.toLocaleString()}원
                      </td>
                      <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: '700', color: 'var(--text-bright)' }}>
                        {item.total?.toLocaleString()}원
                      </td>
                      <td style={{ padding: '0.4rem', textAlign: 'center' }}>
                        <button 
                          type="button" 
                          onClick={() => handleRemoveItemRow(idx)}
                          disabled={items.length === 1}
                          style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: items.length > 1 ? 'pointer' : 'not-allowed', opacity: items.length > 1 ? 1 : 0.4 }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--bg-surface)', fontWeight: '700' }}>
                    <td style={{ padding: '0.6rem', textAlign: 'center' }}>총 합계</td>
                    <td style={{ padding: '0.6rem', textAlign: 'right', color: 'var(--primary)' }}>{totalSupplyPrice?.toLocaleString()}원</td>
                    <td style={{ padding: '0.6rem', textAlign: 'right', color: 'var(--text-muted)' }}>{totalVat?.toLocaleString()}원</td>
                    <td style={{ padding: '0.6rem', textAlign: 'right', color: 'var(--text-bright)', fontSize: '0.95rem' }}>{totalAmount?.toLocaleString()}원</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', background: 'var(--bg-main)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: '800', margin: 0, color: 'var(--text-bright)' }}>수납 계좌 정보</h4>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>은행명</label>
                  <input 
                    type="text" 
                    value={bankName} 
                    onChange={(e) => setBankName(e.target.value)} 
                    style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>계좌번호</label>
                  <input 
                    type="text" 
                    value={bankAccount} 
                    onChange={(e) => setBankAccount(e.target.value)} 
                    style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>예금주</label>
                  <input 
                    type="text" 
                    value={bankHolder} 
                    onChange={(e) => setBankHolder(e.target.value)} 
                    style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              <div style={{ background: 'var(--bg-main)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '800', marginBottom: '0.4rem', color: 'var(--text-bright)' }}>하단 안내사항 (Remarks)</label>
                <textarea 
                  value={remarks} 
                  onChange={(e) => setRemarks(e.target.value)}
                  style={{ width: '100%', flex: 1, padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.82rem', fontFamily: 'sans-serif', lineHeight: '1.4', background: 'var(--bg-surface)', color: 'var(--text-main)', resize: 'none' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', marginTop: '1rem' }}>
              <button 
                type="button" 
                onClick={() => setActiveSubTab('list')}
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', padding: '0.6rem 1.5rem', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer' }}
              >
                취소
              </button>
              <button 
                type="submit"
                style={{ background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.8rem', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '700', cursor: 'pointer' }}
              >
                청구서 저장 및 발행
              </button>
            </div>
          </form>
        )}

        {activeSubTab === 'db-generate' && (
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem', alignItems: 'flex-start' }}>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', maxHeight: '640px', overflowY: 'auto' }}>
              <h4 style={{ margin: '0 0 0.8rem 0', fontSize: '0.9rem', fontWeight: '800', color: 'var(--text-bright)' }}>법인 / 계약 건 선택</h4>
              <CompanyBatchTree
                groups={companyGroups}
                expandedCompany={expandedCompany}
                onToggleCompany={(name) => setExpandedCompany(prev => prev === name ? null : name)}
                selectedBatchKey={selectedBatch ? (selectedBatch.contractNo || `단독-${selectedBatch.vehicles[0]?.carNumber}`) : null}
                onSelectBatch={handleSelectBatch}
              />
            </div>

            {!selectedBatch ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px', color: 'var(--text-muted)', fontSize: '0.88rem', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
                왼쪽에서 법인과 계약 건을 선택하면 차량 목록이 자동으로 채워집니다.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <div style={{ background: 'var(--bg-main)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontWeight: '800', color: 'var(--text-bright)', fontSize: '1rem' }}>{selectedBatch.companyName}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {selectedBatch.contractNo ? `계약번호: ${selectedBatch.contractNo}` : '계약번호 없음 (개별 건)'} · 차량 {selectedBatch.vehicles.length}대
                  </div>
                </div>

                <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', color: '#333' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-color)', fontWeight: '700', color: '#1e293b' }}>
                        <th style={{ padding: '0.6rem', textAlign: 'left' }}>차량번호</th>
                        <th style={{ padding: '0.6rem', textAlign: 'left' }}>차종</th>
                        <th style={{ padding: '0.6rem', textAlign: 'right' }}>월 렌트료</th>
                        <th style={{ padding: '0.6rem', textAlign: 'left' }}>인도일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBatch.vehicles.map(v => (
                        <tr key={v._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.6rem', fontWeight: '700' }}>{v.carNumber}</td>
                          <td style={{ padding: '0.6rem' }}>{v.carModel}</td>
                          <td style={{ padding: '0.6rem', textAlign: 'right', color: 'var(--primary)', fontWeight: '700' }}>{(v.monthlyPayment || 0).toLocaleString()}원</td>
                          <td style={{ padding: '0.6rem' }}>{v.deliveryDate || '-'}</td>
                        </tr>
                      ))}
                      <tr style={{ background: 'var(--bg-surface)', fontWeight: '700' }}>
                        <td colSpan={2} style={{ padding: '0.6rem', textAlign: 'center' }}>당월 렌트료 합계</td>
                        <td style={{ padding: '0.6rem', textAlign: 'right', color: 'var(--primary)' }}>
                          {selectedBatch.vehicles.reduce((s, v) => s + (v.monthlyPayment || 0), 0).toLocaleString()}원
                        </td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ background: 'var(--bg-main)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ margin: '0 0 0.6rem 0', fontSize: '0.9rem', fontWeight: '800', color: 'var(--text-bright)' }}>원드라이브 저장 위치</h4>
                  {checkingFolder ? (
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>폴더 정보를 확인하는 중...</div>
                  ) : companyFolder ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                      <span style={{ fontWeight: '700', color: 'var(--primary)' }}>RENT\{companyFolder.folderName}\02.청구서\</span> 에 저장됩니다.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        이 법인의 원드라이브 폴더가 아직 등록되지 않았습니다. 기존에 만들어둔 폴더가 있으면 그 이름을 그대로 입력해 주세요.
                      </div>
                      <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                          <input type="radio" checked={folderInputMode === 'existing'} onChange={() => setFolderInputMode('existing')} /> 기존 폴더명 입력
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                          <input type="radio" checked={folderInputMode === 'auto'} onChange={() => setFolderInputMode('auto')} /> 새 폴더 자동 생성 ({getPaymentDayLabel(selectedBatch.vehicles[0])}_{selectedBatch.companyName})
                        </label>
                      </div>
                      {folderInputMode === 'existing' && (
                        <input
                          type="text"
                          value={folderNameInput}
                          onChange={(e) => setFolderNameInput(e.target.value)}
                          placeholder="예: 25일_(주)한촌_정보연대표님 S500"
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }}
                        />
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', background: 'var(--bg-main)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>청구 대상 월</label>
                    <input type="month" value={dbForm.billingMonth} onChange={(e) => setDbForm({ ...dbForm, billingMonth: e.target.value })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>작성일</label>
                    <input type="date" value={dbForm.invoiceDate} onChange={(e) => setDbForm({ ...dbForm, invoiceDate: e.target.value })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>결제일 / 출금일</label>
                    <input type="date" value={dbForm.dueDate} onChange={(e) => setDbForm({ ...dbForm, dueDate: e.target.value })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>전월 미결제금액</label>
                    <input type="number" value={dbForm.prevUnpaid} onChange={(e) => setDbForm({ ...dbForm, prevUnpaid: parseInt(e.target.value) || 0 })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>전월 초과입금액</label>
                    <input type="number" value={dbForm.prevOverpaid} onChange={(e) => setDbForm({ ...dbForm, prevOverpaid: parseInt(e.target.value) || 0 })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>정기점검 비용</label>
                    <input type="number" value={dbForm.maintenanceFee} onChange={(e) => setDbForm({ ...dbForm, maintenanceFee: parseInt(e.target.value) || 0 })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>범칙금 / 과태료</label>
                    <input type="number" value={dbForm.fineFee} onChange={(e) => setDbForm({ ...dbForm, fineFee: parseInt(e.target.value) || 0 })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>납입회차</label>
                    <input type="number" min="1" value={dbForm.nthPay} onChange={(e) => setDbForm({ ...dbForm, nthPay: parseInt(e.target.value) || 1 })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>거래은행</label>
                    <input type="text" value={dbForm.bankName} onChange={(e) => setDbForm({ ...dbForm, bankName: e.target.value })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>계좌번호(출금)</label>
                    <input type="text" value={dbForm.bankAccount} onChange={(e) => setDbForm({ ...dbForm, bankAccount: e.target.value })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>입금전용계좌</label>
                    <input type="text" value={dbForm.virtualAccount} onChange={(e) => setDbForm({ ...dbForm, virtualAccount: e.target.value })} placeholder="부산은행 / 101-2077-5994-03" style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>담당자 E-Mail</label>
                    <input type="email" value={dbForm.email} onChange={(e) => setDbForm({ ...dbForm, email: e.target.value })} style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.85rem', background: 'var(--bg-surface)', color: 'var(--text-main)' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem' }}>
                  <button type="button" onClick={() => setSelectedBatch(null)} style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', padding: '0.6rem 1.5rem', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer' }}>
                    취소
                  </button>
                  <button type="button" onClick={handleGenerateFromDb} style={{ background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.8rem', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '700', cursor: 'pointer' }}>
                    청구서 생성 및 발행
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {viewingInvoice && (
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', background: '#fff', padding: '1.5rem', marginTop: '1.5rem', color: '#000' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #cbd5e1', paddingBottom: '0.8rem', marginBottom: '1rem' }}>
              <button 
                onClick={() => setViewingInvoice(null)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer', color: '#334155' }}
              >
                <ArrowLeft size={16} /> 목록으로 돌아가기
              </button>
              <button 
                onClick={handlePrint}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.5rem 1.2rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
              >
                <Printer size={16} /> 인쇄하기
              </button>
            </div>

            <div style={{ background: '#f8fafc', padding: '2rem 1rem', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: '800px', background: '#fff', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', padding: '20px', fontFamily: 'sans-serif' }}>
                <InvoiceTemplate invoice={viewingInvoice} />
              </div>
            </div>
          </div>
        )}
      </div>

      {viewingInvoice && (
        <div className="invoice-print-container">
          <InvoiceTemplate invoice={viewingInvoice} />
        </div>
      )}

      {pdfInvoice && (
        <div style={{ position: 'fixed', left: '-9999px', top: 0, width: '800px', background: '#fff', padding: '20px' }}>
          <div ref={invoicePdfRef}>
            <InvoiceTemplate invoice={pdfInvoice} />
          </div>
        </div>
      )}

      {showContractModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 }}>
          <div style={{ width: '100%', maxWidth: '600px', background: 'var(--bg-surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '80vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-bright)' }}>연동할 계약서 선택</h3>
              <button onClick={() => setShowContractModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>&times;</button>
            </div>
            
            <div style={{ position: 'relative' }}>
              <input 
                type="text" 
                placeholder="계약자명, 차종, 계약번호 검색..."
                value={contractSearchQuery}
                onChange={(e) => setContractSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '0.5rem 0.5rem 0.5rem 2rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: 'var(--bg-main)', color: 'var(--text-main)' }}
              />
              <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: '200px' }}>
              {filteredContracts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>진행 중인 계약서 데이터를 찾을 수 없습니다.</div>
              ) : (
                filteredContracts.map(c => (
                  <div 
                    key={c._id} 
                    onClick={() => handleSelectContract(c)}
                    style={{ padding: '0.8rem', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', background: 'var(--bg-main)', display: 'flex', justifyContent: 'space-between', transition: 'all 0.15s' }}
                    className="hover-card"
                  >
                    <div>
                      <div style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.88rem' }}>{c.customer?.name} 귀하</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        계약번호: {c.contractNo} | 차종: {c.vehicle?.model || '-'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ fontWeight: '800', color: 'var(--primary)', fontSize: '0.85rem' }}>{c.pricing?.monthlyFee?.toLocaleString()}원</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>월 렌트료</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {pageTab === 'schedule' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem', alignItems: 'flex-start' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', maxHeight: '640px', overflowY: 'auto' }}>
            <h4 style={{ margin: '0 0 0.8rem 0', fontSize: '0.9rem', fontWeight: '800', color: 'var(--text-bright)' }}>법인 / 계약 건 선택 (결제일 오름차순)</h4>
            <div style={{ position: 'relative', marginBottom: '0.6rem' }}>
              <Search size={14} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={scheduleCompanySearch}
                onChange={(e) => setScheduleCompanySearch(e.target.value)}
                placeholder="법인명 검색..."
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.6rem 0.5rem 1.9rem',
                  border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem',
                  outline: 'none', background: '#fff', color: '#333'
                }}
              />
            </div>
            {companyGroups.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>렌터카 DB에 등록된 차량이 없습니다.</div>
            ) : scheduleDayGroups.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>검색 결과가 없습니다.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                {scheduleDayGroups.map(dayGroup => (
                  <div key={dayGroup.label}>
                    <div style={{
                      fontSize: '0.75rem', fontWeight: '800', color: 'var(--primary)',
                      padding: '0.25rem 0.1rem', marginBottom: '0.35rem', borderBottom: '1px solid var(--border-color)'
                    }}>
                      결제일 {dayGroup.label} ({dayGroup.companyGroups.length}개 법인)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {dayGroup.companyGroups.map(group => (
                        <CompanyEntry
                          key={group.companyName}
                          group={group}
                          expandedCompany={expandedCompany}
                          onToggleCompany={(name) => setExpandedCompany(prev => prev === name ? null : name)}
                          selectedBatchKey={selectedBatch ? (selectedBatch.contractNo || `단독-${selectedBatch.vehicles[0]?.carNumber}`) : null}
                          onSelectBatch={handleSelectBatch}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!selectedBatch ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px', color: 'var(--text-muted)', fontSize: '0.88rem', border: '1px dashed var(--border-color)', borderRadius: '8px', background: 'var(--bg-surface)' }}>
              왼쪽에서 법인과 계약 건을 선택하면 차량별 월별 납부 스케줄이 표시됩니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {selectedBatch.vehicles.map(v => {
                const schedule = computeMonthlySchedule(v);
                return (
                  <div key={v._id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ padding: '0.7rem 1rem', background: '#111e38', color: '#fff', fontWeight: '800', fontSize: '0.85rem', letterSpacing: '0.5px' }}>
                      계약 내용 - {v.contractCompany ? v.contractCompany.replace(/_\d+$/, '') : '미지정 법인'} / {v.carNumber || '-'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem 1rem', padding: '1rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
                      <div><span style={{ color: 'var(--text-muted)' }}>고객명</span><div style={{ fontWeight: '700' }}>{v.contractCompany ? v.contractCompany.replace(/_\d+$/, '') : '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>차량번호</span><div style={{ fontWeight: '700' }}>{v.carNumber || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>차종</span><div style={{ fontWeight: '700' }}>{v.carModel || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>월 렌트료</span><div style={{ fontWeight: '700', color: 'var(--primary)' }}>{(v.monthlyPayment || 0).toLocaleString()}원</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>실행일</span><div style={{ fontWeight: '700' }}>{v.executionDate || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>렌트기간</span><div style={{ fontWeight: '700' }}>{v.rentPeriodYears || '-'}년</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>남은 기간</span><div style={{ fontWeight: '700' }}>{v.remainingPeriod || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>인도일</span><div style={{ fontWeight: '700' }}>{v.deliveryDate || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>렌트 종료</span><div style={{ fontWeight: '700' }}>{v.rentEndDate || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>정기점검</span><div style={{ fontWeight: '700' }}>{v.regularCheckup || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>은행</span><div style={{ fontWeight: '700' }}>{v.bank || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>계좌번호</span><div style={{ fontWeight: '700' }}>{v.accountNo || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>보증금</span><div style={{ fontWeight: '700' }}>{v.deposit ? v.deposit.toLocaleString() + '원' : '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>선수금</span><div style={{ fontWeight: '700' }}>{v.advancePayment ? v.advancePayment.toLocaleString() + '원' : '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>연체이자율</span><div style={{ fontWeight: '700' }}>{v.overdueInterestRate || '-'}</div></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>담당자 Email</span><div style={{ fontWeight: '700' }}>{v.fineEmail || '-'}</div></div>
                    </div>
                    <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', color: '#333' }}>
                        <thead style={{ position: 'sticky', top: 0 }}>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-color)', fontWeight: '700', color: '#1e293b' }}>
                            <th style={{ padding: '0.5rem', textAlign: 'center', width: '70px' }}>회차</th>
                            <th style={{ padding: '0.5rem', textAlign: 'center' }}>날짜</th>
                            <th style={{ padding: '0.5rem', textAlign: 'right' }}>월 렌트료</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schedule.map(row => (
                            <tr key={row.no} style={{ borderBottom: '1px solid #f1f5f9', background: '#fff' }}>
                              <td style={{ padding: '0.4rem', textAlign: 'center' }}>{row.no}</td>
                              <td style={{ padding: '0.4rem', textAlign: 'center' }}>{row.date}</td>
                              <td style={{ padding: '0.4rem', textAlign: 'right' }}>{row.monthlyFee.toLocaleString()}원</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Complete Print/Preview Invoice Template Component
function InvoiceTemplate({ invoice }) {
  const customer = invoice.customer || {};
  const contract = invoice.contract || {};
  const vehicle = contract.vehicle || {};
  
  // Format Date functions
  const formatDateStr = (dateVal) => {
    if (!dateVal) return '-';
    const date = new Date(dateVal);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // If this is an Excel-based custom payment billing format
  if (invoice.invoiceType === 'excel_payment') {
    const totalRent = invoice.vehicles?.reduce((sum, v) => sum + (v.monthlyRent || 0), 0) || 0;
    const dailyRent = invoice.vehicles && invoice.vehicles.length > 0 ? Math.round(totalRent / 30) : 0;
    
    // Display vehicles padding array (Exactly 10 items for 2-column layout)
    const displayVehicles = Array.from({ length: 10 }).map((_, i) => invoice.vehicles?.[i] || null);

    return (
      <div style={{ width: '100%', boxSizing: 'border-box', color: '#000', fontSize: '0.78rem', lineHeight: '1.45', fontFamily: 'sans-serif' }}>
        
        {/* Company Title */}
        <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#000', marginBottom: '0.8rem', textAlign: 'left' }}>
          {customer.name || '-'}
        </div>

        {/* Total Amount Bar */}
        <div style={{ background: '#7f7f7f', color: '#fff', padding: '6px 12px', fontWeight: '800', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '0.9rem', letterSpacing: '1px' }}>결제금액 내역</span>
          <span style={{ fontSize: '1.2rem', fontWeight: '900' }}>{invoice.totalAmount?.toLocaleString()} 원</span>
        </div>

        {/* Meta summary tables */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <table style={{ borderCollapse: 'collapse', width: '320px', fontSize: '0.74rem' }}>
            <tbody>
              <tr style={{ borderBottom: '1.5px solid #000' }}>
                <td style={{ fontWeight: '700', width: '40%', padding: '3px 0', textAlign: 'left' }}>결제일</td>
                <td style={{ textValues: 'right', textAlign: 'right', padding: '3px 0', fontWeight: '700' }}>{formatDateStr(invoice.dueDate)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #ccc' }}>
                <td style={{ fontWeight: '700', padding: '3px 0', textAlign: 'left' }}>작성기준일</td>
                <td style={{ textValues: 'right', textAlign: 'right', padding: '3px 0' }}>{formatDateStr(invoice.invoiceDate)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #ccc' }}>
                <td style={{ fontWeight: '700', padding: '3px 0', textAlign: 'left' }}>입금전용계좌</td>
                <td style={{ textValues: 'right', textAlign: 'right', padding: '3px 0', fontWeight: '700' }}>{invoice.virtualAccount || '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 2-Column Split Details (Billing list & Details) */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '12px' }}>
          
          {/* Left: 청구내역 */}
          <div style={{ width: '50%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: '2px solid #7f7f7f', fontSize: '0.74rem' }}>
              <thead>
                <tr style={{ background: '#bfbfbf', color: '#000', fontWeight: '800', height: '1.6rem', textAlign: 'center' }}>
                  <th colSpan={3} style={{ border: '1px solid #7f7f7f', fontSize: '0.78rem', padding: '3px' }}>청구내역</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', width: '10%', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>1</td>
                  <td style={{ border: '1px solid #ccc', width: '50%', paddingLeft: '8px' }}>전월 미제공금액</td>
                  <td style={{ border: '1px solid #ccc', width: '40%', textAlign: 'right', paddingRight: '8px', fontWeight: '700' }}>
                    {invoice.prevUnpaid ? invoice.prevUnpaid.toLocaleString() : '-'}
                  </td>
                </tr>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>2</td>
                  <td style={{ border: '1px solid #ccc', paddingLeft: '8px' }}>전월 초과 입금액</td>
                  <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '8px', fontWeight: '700' }}>
                    {invoice.prevOverpaid ? invoice.prevOverpaid.toLocaleString() : '-'}
                  </td>
                </tr>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>3</td>
                  <td style={{ border: '1px solid #ccc', paddingLeft: '8px', fontWeight: '700' }}>당월 결제금액</td>
                  <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '8px', fontWeight: '700' }}>
                    {totalRent ? totalRent.toLocaleString() : '-'}
                  </td>
                </tr>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>4</td>
                  <td style={{ border: '1px solid #ccc', paddingLeft: '8px' }}>정기점검</td>
                  <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '8px', fontWeight: '700' }}>
                    {invoice.maintenanceFee ? invoice.maintenanceFee.toLocaleString() : '-'}
                  </td>
                </tr>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>5</td>
                  <td style={{ border: '1px solid #ccc', paddingLeft: '8px' }}>범칙금</td>
                  <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '8px', fontWeight: '700' }}>
                    {invoice.fineFee ? invoice.fineFee.toLocaleString() : '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Right: 상세내역 */}
          <div style={{ width: '50%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: '2px solid #7f7f7f', fontSize: '0.74rem' }}>
              <thead>
                <tr style={{ background: '#bfbfbf', color: '#000', fontWeight: '800', height: '1.6rem', textAlign: 'center' }}>
                  <th colSpan={3} style={{ border: '1px solid #7f7f7f', fontSize: '0.78rem', padding: '3px' }}>상세내역</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', width: '10%', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>1</td>
                  <td style={{ border: '1px solid #ccc', width: '40%', paddingLeft: '8px' }}>고객명</td>
                  <td style={{ border: '1px solid #ccc', width: '50%', textAlign: 'right', paddingRight: '8px', fontWeight: '700' }}>
                    {customer.name || '-'}
                  </td>
                </tr>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>2</td>
                  <td style={{ border: '1px solid #ccc', paddingLeft: '8px', backgroundColor: '#fff2cc' }}>거래은행</td>
                  <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '8px', fontWeight: '700', backgroundColor: '#fff2cc' }}>
                    {invoice.bankName || '-'}
                  </td>
                </tr>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>3</td>
                  <td style={{ border: '1px solid #ccc', paddingLeft: '8px', backgroundColor: '#fff2cc' }}>계좌번호</td>
                  <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '8px', fontWeight: '700', backgroundColor: '#fff2cc' }}>
                    {invoice.bankAccount || '-'}
                  </td>
                </tr>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>4</td>
                  <td style={{ border: '1px solid #ccc', paddingLeft: '8px', backgroundColor: '#fff2cc' }}>납입회차</td>
                  <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '8px', fontWeight: '700', backgroundColor: '#fff2cc' }}>
                    {invoice.nthPay || 1} 회
                  </td>
                </tr>
                <tr style={{ height: '1.8rem' }}>
                  <td style={{ border: '1px solid #ccc', textAlign: 'center', fontWeight: '700', background: '#f8fafc' }}>5</td>
                  <td style={{ border: '1px solid #ccc', paddingLeft: '8px' }}>출금일</td>
                  <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '8px', fontWeight: '700' }}>
                    {formatDateStr(invoice.withdrawDate)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Vehicles list (2 columns layout) */}
        <div style={{ marginBottom: '12px', borderTop: '2px solid #7f7f7f' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', color: '#000' }}>
            <thead>
              <tr style={{ background: '#7f7f7f', color: '#fff', fontWeight: '800', height: '1.5rem', textAlign: 'center' }}>
                <th style={{ border: '1px solid #7f7f7f', width: '4%' }}>No</th>
                <th style={{ border: '1px solid #7f7f7f', width: '18%' }}>차량번호</th>
                <th style={{ border: '1px solid #7f7f7f', width: '14%' }}>월 렌트료</th>
                <th style={{ border: '1px solid #7f7f7f', width: '14%' }}>인도일</th>
                
                <th style={{ border: '1px solid #7f7f7f', width: '4%' }}>No</th>
                <th style={{ border: '1px solid #7f7f7f', width: '18%' }}>차량번호</th>
                <th style={{ border: '1px solid #7f7f7f', width: '14%' }}>월 렌트료</th>
                <th style={{ border: '1px solid #7f7f7f', width: '14%' }}>인도일</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map(idx => {
                const vLeft = displayVehicles[idx];
                const vRight = displayVehicles[idx + 5];
                return (
                  <tr key={idx} style={{ height: '1.8rem', textAlign: 'center' }}>
                    {/* Left Column */}
                    <td style={{ border: '1px solid #ccc', fontWeight: '700', backgroundColor: '#fafafa' }}>{idx + 1}</td>
                    <td style={{ border: '1px solid #ccc' }}>{vLeft ? vLeft.carNo : '-'}</td>
                    <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '6px', fontWeight: vLeft ? '700' : 'normal' }}>
                      {vLeft ? vLeft.monthlyRent?.toLocaleString() : '-'}
                    </td>
                    <td style={{ border: '1px solid #ccc' }}>
                      {vLeft && vLeft.deliveryDate ? formatDateStr(vLeft.deliveryDate) : '-'}
                    </td>
                    
                    {/* Right Column */}
                    <td style={{ border: '1px solid #ccc', fontWeight: '700', backgroundColor: '#fafafa' }}>{idx + 6}</td>
                    <td style={{ border: '1px solid #ccc' }}>{vRight ? vRight.carNo : '-'}</td>
                    <td style={{ border: '1px solid #ccc', textAlign: 'right', paddingRight: '6px', fontWeight: vRight ? '700' : 'normal' }}>
                      {vRight ? vRight.monthlyRent?.toLocaleString() : '-'}
                    </td>
                    <td style={{ border: '1px solid #ccc' }}>
                      {vRight && vRight.deliveryDate ? formatDateStr(vRight.deliveryDate) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Daily Rent & Month Summary */}
        <div style={{ display: 'flex', border: '1.5px solid #000', fontSize: '0.74rem', backgroundColor: '#fafafa', marginBottom: '12px', fontWeight: '700', height: '1.8rem', alignStep: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', width: '33.3%', alignItems: 'center', borderRight: '1px solid #ccc', height: '100%' }}>
            <div style={{ background: '#d9d9d9', width: '40%', textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justify: 'center' }}>1일 렌트료</div>
            <div style={{ width: '60%', textAlign: 'right', paddingRight: '8px' }}>{dailyRent ? dailyRent.toLocaleString() : '-'}</div>
          </div>
          <div style={{ display: 'flex', width: '33.3%', alignItems: 'center', borderRight: '1px solid #ccc', height: '100%' }}>
            <div style={{ background: '#d9d9d9', width: '40%', textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justify: 'center' }}>첫달 결제금액</div>
            <div style={{ width: '60%', textAlign: 'right', paddingRight: '8px' }}>
              {invoice.firstMonthFee ? invoice.firstMonthFee.toLocaleString() : '-'}
            </div>
          </div>
          <div style={{ display: 'flex', width: '33.3%', alignItems: 'center', height: '100%' }}>
            <div style={{ background: '#d9d9d9', width: '40%', textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justify: 'center' }}>마지막달 결제금액</div>
            <div style={{ width: '60%', textAlign: 'right', paddingRight: '8px' }}>
              {invoice.lastMonthFee ? invoice.lastMonthFee.toLocaleString() : '-'}
            </div>
          </div>
        </div>

        {/* Manager Email */}
        <div style={{ display: 'flex', justify: 'flex-end', marginBottom: '20px' }}>
          <div style={{ display: 'flex', border: '1.5px solid #000', width: '280px', fontSize: '0.74rem', height: '1.8rem', alignItems: 'center', fontWeight: '700' }}>
            <div style={{ background: '#d9d9d9', width: '40%', textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justify: 'center' }}>담당자 E-Mail</div>
            <div style={{ width: '60%', textAlign: 'center' }}>{invoice.email || 'mhgood45@dkin.co.kr'}</div>
          </div>
        </div>

        {/* Provider Info */}
        <div style={{ borderTop: '1.5px solid #000', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', color: '#555', fontSize: '0.72rem' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#000', margin: '0 0 4px 0' }}>(주)렌트베네핏</h3>
            <div style={{ marginBottom: '2px' }}>서울시 서초구 양재대로 11길 36, 은관 505호(양재동, 서울오토갤러리) &nbsp;|&nbsp; T. 02-547-0303</div>
            <div>대표이사 신동일 &nbsp;|&nbsp; 사업자번호 422-88-02467 &nbsp;|&nbsp; F. 02-529-3303</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <img src="http://www.sdibenefit.com/images/logo.png" alt="RENT BENefit" style={{ maxHeight: '20px', width: 'auto' }} />
            <span style={{ fontSize: '0.55rem', fontWeight: 'bold', color: '#ad885c', marginTop: '2px', letterSpacing: '1px' }}>RENT BENEFIT</span>
          </div>
        </div>

      </div>
    );
  }

  // Standard '장기렌트 청구서' template rendering
  return (
    <div style={{ width: '100%', boxSizing: 'border-box', color: '#000', fontSize: '0.8rem', lineHeight: '1.4', fontFamily: 'sans-serif' }}>
      
      {/* 1. Header (Title & Invoice Meta) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.2rem', borderBottom: '2px solid #111e38', paddingBottom: '0.6rem' }}>
        <div>
          <h2 style={{ fontSize: '2.0rem', fontWeight: '900', color: '#111e38', margin: 0, letterSpacing: '2px' }}>장기렌트 청구서</h2>
          <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.2rem' }}>청구 번호 : <strong style={{ color: '#000' }}>{invoice.invoiceNo}</strong></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <img src="http://www.sdibenefit.com/images/logo.png" alt="RENT BENefit" style={{ maxHeight: '32px', width: 'auto', objectFit: 'contain' }} />
          <span style={{ fontSize: '0.7rem', color: '#777', fontWeight: '600', marginTop: '0.1rem' }}>TOTAL CAR PREMIUM SOLUTION</span>
        </div>
      </div>

      {/* 2. Customer & Supplier Info Grid */}
      <div style={{ display: 'flex', gap: '1.2rem', marginBottom: '1rem' }}>
        
        {/* Left: 공급받는 자 (고객 정보) */}
        <table style={{ width: '50%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.78rem' }}>
          <tbody>
            <tr style={{ height: '2.2rem', background: '#f1f5f9' }}>
              <td colSpan={2} style={{ padding: '4px 8px', borderBottom: '1.5px solid #000', fontWeight: '800', textAlign: 'center', color: '#1e293b' }}>공급받는 자 (고객 정보)</td>
            </tr>
            <tr>
              <td style={{ width: '25%', background: '#fafafa', padding: '5px 8px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>고객명</td>
              <td style={{ width: '75%', padding: '5px 8px', border: '1px solid #000', fontWeight: '800', fontSize: '0.82rem' }}>{customer.name || '-'} 귀하</td>
            </tr>
            {customer.bizNo && (
              <tr>
                <td style={{ background: '#fafafa', padding: '5px 8px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>사업자번호</td>
                <td style={{ padding: '5px 8px', border: '1px solid #000', fontWeight: '600' }}>{customer.bizNo}</td>
              </tr>
            )}
            <tr>
              <td style={{ background: '#fafafa', padding: '5px 8px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>차량번호</td>
              <td style={{ padding: '5px 8px', border: '1px solid #000', fontWeight: '700', color: '#b91c1c' }}>{vehicle.code || '-'}</td>
            </tr>
            <tr>
              <td style={{ background: '#fafafa', padding: '5px 8px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>차종</td>
              <td style={{ padding: '5px 8px', border: '1px solid #000', fontSize: '0.75rem' }}>{vehicle.model || '-'}</td>
            </tr>
          </tbody>
        </table>

        {/* Right: 공급자 (렌트베네핏 회사 정보) */}
        <table style={{ width: '50%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.78rem' }}>
          <tbody>
            <tr style={{ height: '2.2rem', background: '#f1f5f9' }}>
              <td colSpan={2} style={{ padding: '4px 8px', borderBottom: '1.5px solid #000', fontWeight: '800', textAlign: 'center', color: '#1e293b' }}>공 급 자</td>
            </tr>
            <tr>
              <td style={{ width: '25%', background: '#fafafa', padding: '5px 8px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>등록번호</td>
              <td style={{ width: '75%', padding: '5px 8px', border: '1px solid #000', fontWeight: '800', letterSpacing: '1px' }}>104-86-09613</td>
            </tr>
            <tr>
              <td style={{ background: '#fafafa', padding: '5px 8px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>상호(법인)</td>
              <td style={{ padding: '5px 8px', border: '1px solid #000', fontWeight: '700' }}>주식회사 렌트베네핏</td>
            </tr>
            <tr>
              <td style={{ background: '#fafafa', padding: '5px 8px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>성명(대표)</td>
              <td style={{ padding: '5px 8px', border: '1px solid #000', fontWeight: '700', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>신 동 일</span>
                <span style={{ fontSize: '0.62rem', border: '1px solid red', color: 'red', padding: '1px 3px', borderRadius: '50%', fontWeight: '700', transform: 'rotate(-10deg)', marginRight: '15px' }}>인</span>
              </td>
            </tr>
            <tr>
              <td style={{ background: '#fafafa', padding: '5px 8px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>주소</td>
              <td style={{ padding: '5px 8px', border: '1px solid #000', fontSize: '0.7rem' }}>서울시 강남구 압구정로 104, 렌트베네핏 빌딩 3층</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. Dates summary bar */}
      <div style={{ display: 'flex', border: '1.5px solid #000', padding: '6px 12px', fontSize: '0.8rem', background: '#fafafa', justifyContent: 'space-between', marginBottom: '1rem', fontWeight: '700' }}>
        <div>청구 대상 연월: <span style={{ color: '#0369a1' }}>{invoice.billingMonth?.replace('-', '년 ')}월분</span></div>
        <div>청구 발행일: <span>{formatDateStr(invoice.invoiceDate)}</span></div>
        <div>지급 기일(납기): <span style={{ color: '#b91c1c' }}>{formatDateStr(invoice.dueDate)} 까지</span></div>
      </div>

      {/* 4. Total Amount Highlight Bar */}
      <div style={{ display: 'flex', border: '2px solid #111e38', padding: '8px 16px', background: '#fdfbfa', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
        <span style={{ fontSize: '0.95rem', fontWeight: '800', color: '#111e38' }}>총 청구 금액 (합계)</span>
        <span style={{ fontSize: '1.3rem', fontWeight: '900', color: '#b91c1c' }}>
          KRW {invoice.totalAmount?.toLocaleString()} 원 (VAT 포함)
        </span>
      </div>

      {/* 5. Detail Items List Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.8rem', marginBottom: '1.2rem', textAlign: 'left' }}>
        <thead>
          <tr style={{ background: '#e2e8f0', borderBottom: '1.5px solid #000', fontWeight: '800' }}>
            <th style={{ padding: '6px 8px', border: '1px solid #000', width: '5%' }}>No</th>
            <th style={{ padding: '6px 8px', border: '1px solid #000', width: '50%' }}>청구 항목 / 규격</th>
            <th style={{ padding: '6px 8px', border: '1px solid #000', width: '18%', textAlign: 'right' }}>공급가액</th>
            <th style={{ padding: '6px 8px', border: '1px solid #000', width: '12%', textAlign: 'right' }}>부가세</th>
            <th style={{ padding: '6px 8px', border: '1px solid #000', width: '15%', textAlign: 'right' }}>청구합계액</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items?.map((item, idx) => (
            <tr key={idx} style={{ height: '2.0rem' }}>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'center' }}>{idx + 1}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', fontWeight: '700' }}>{item.desc}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{item.supplyPrice?.toLocaleString()}원</td>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right', color: '#555' }}>{item.vat?.toLocaleString()}원</td>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: '700' }}>{item.total?.toLocaleString()}원</td>
            </tr>
          ))}
          
          {/* Fill blank rows to make look solid if items are few */}
          {invoice.items && invoice.items.length < 4 && Array.from({ length: 4 - invoice.items.length }).map((_, i) => (
            <tr key={`blank-${i}`} style={{ height: '2.0rem' }}>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'center', color: '#ccc' }}>{invoice.items.length + i + 1}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}></td>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}></td>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}></td>
              <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}></td>
            </tr>
          ))}

          {/* Sum rows */}
          <tr style={{ background: '#f8fafc', fontWeight: '800', height: '2.2rem' }}>
            <td colSpan={2} style={{ padding: '5px 8px', border: '1px solid #000', textAlign: 'center' }}>합 계 (SUM)</td>
            <td style={{ padding: '5px 8px', border: '1px solid #000', textAlign: 'right' }}>{invoice.totalSupplyPrice?.toLocaleString()}원</td>
            <td style={{ padding: '5px 8px', border: '1px solid #000', textAlign: 'right' }}>{invoice.totalVat?.toLocaleString()}원</td>
            <td style={{ padding: '5px 8px', border: '1px solid #000', textAlign: 'right', color: '#b91c1c', fontSize: '0.85rem' }}>{invoice.totalAmount?.toLocaleString()}원</td>
          </tr>
        </tbody>
      </table>

      {/* 6. Payment Destination Accounts */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.78rem', marginBottom: '1.2rem' }}>
        <tbody>
          <tr>
            <td style={{ width: '20%', background: '#f1f5f9', padding: '6px 8px', fontWeight: '800', border: '1px solid #000', textAlign: 'center', color: '#1e293b' }}>입금 수납은행</td>
            <td style={{ width: '30%', padding: '6px 8px', border: '1px solid #000', fontWeight: '700' }}>{invoice.bankName}</td>
            <td style={{ width: '20%', background: '#f1f5f9', padding: '6px 8px', fontWeight: '800', border: '1px solid #000', textAlign: 'center', color: '#1e293b' }}>입금 예금주</td>
            <td style={{ width: '30%', padding: '6px 8px', border: '1px solid #000', fontWeight: '700' }}>{invoice.bankHolder}</td>
          </tr>
          <tr>
            <td style={{ background: '#f1f5f9', padding: '6px 8px', fontWeight: '800', border: '1px solid #000', textAlign: 'center', color: '#1e293b' }}>송금 계좌번호</td>
            <td colSpan={3} style={{ padding: '6px 8px', border: '1px solid #000', fontSize: '0.85rem', fontWeight: '800', color: '#0369a1', letterSpacing: '0.5px' }}>
              {invoice.bankAccount}
            </td>
          </tr>
        </tbody>
      </table>

      {/* 7. Remarks */}
      {invoice.remarks && (
        <div style={{ border: '1px dashed #ad885c', padding: '8px 12px', fontSize: '0.72rem', color: '#555', background: '#fdfbfa', whiteSpace: 'pre-wrap', lineHeight: '1.45', borderRadius: '4px' }}>
          {invoice.remarks}
        </div>
      )}

      {/* 8. Direct Stamp signature footer */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '1.5rem', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.8rem', justifyContent: 'center' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: '800', letterSpacing: '2px', color: '#111e38' }}>주식회사 렌트베네핏</span>
          <span style={{ fontSize: '0.95rem', fontWeight: '800', color: '#111e38' }}>대표이사 신 동 일</span>
        </div>
        <div style={{ fontSize: '0.65rem', fontWeight: '700', letterSpacing: '2px', color: '#ad885c', marginTop: '0.1rem' }}>
          RENT BENEFIT TOTAL CAR PREMIUM SOLUTION
        </div>
      </div>

    </div>
  );
}

export default BillingView;
