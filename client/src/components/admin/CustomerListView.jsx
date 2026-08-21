import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Search, 
  RefreshCw, 
  Plus, 
  Building, 
  Phone, 
  Mail, 
  MapPin, 
  Edit3, 
  Trash2, 
  X, 
  CheckCircle2,
  AlertCircle,
  Eye
} from 'lucide-react';
import OutlookContactModal from './OutlookContactModal';
import * as XLSX from 'xlsx';

function CustomerListView({ showToast, currentUser }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterSource, setFilterSource] = useState('all'); // 'all' | 'outlook' | 'manual'
  const [filterCategory, setFilterCategory] = useState('all'); // outlook folder filter
  const [categories, setCategories] = useState([]);
  
  // Multi-window Outlook Contact Card Manager State
  const [openOutlookWindows, setOpenOutlookWindows] = useState([]); 
  const [maxZIndex, setMaxZIndex] = useState(1000);

  // Open / Focus Multi-Window Customer Handler
  const handleOpenOutlookWindow = (customer) => {
    if (!customer) return;

    setOpenOutlookWindows(prev => {
      const existing = prev.find(w => w.customer._id === customer._id);
      const nextZIndex = maxZIndex + 1;
      setMaxZIndex(nextZIndex);

      if (existing) {
        // Bring existing window to front
        return prev.map(w => w.customer._id === customer._id ? { ...w, zIndex: nextZIndex } : w);
      } else {
        // Open new independent window with cascade offset
        const openCount = prev.length;
        const initialPosition = {
          x: Math.min(window.innerWidth - 960, 80 + (openCount % 10) * 35),
          y: Math.min(window.innerHeight - 690, 50 + (openCount % 10) * 30)
        };
        return [...prev, { customer, position: initialPosition, zIndex: nextZIndex }];
      }
    });
  };

  const handleCloseOutlookWindow = (customerId) => {
    setOpenOutlookWindows(prev => prev.filter(w => w.customer._id !== customerId));
  };

  const handleFocusOutlookWindow = (customerId) => {
    const nextZIndex = maxZIndex + 1;
    setMaxZIndex(nextZIndex);
    setOpenOutlookWindows(prev => prev.map(w => w.customer._id === customerId ? { ...w, zIndex: nextZIndex } : w));
  };
  
  // Pagination State
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalCount: 0, totalPages: 1, limit: 50 });
  const [stats, setStats] = useState({ total: 0, outlook: 0, manual: 0 });

  // Outlook Sync State
  const [isSyncing, setIsSyncing] = useState(false);

  // Modal State for Add/Edit
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    bizNo: '',
    ceoName: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    bankName: '',
    bankAccount: '',
    bankHolder: ''
  });

  // Lookup Modal State
  const [showLookupModal, setShowLookupModal] = useState(false);
  const [lookupText, setLookupText] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupSummary, setLookupSummary] = useState(null);

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;

  // 0. Debounce Search Term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1); // Reset page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // 1. 고객 목록 불러오기 (서버 초고속 페이징)
  const fetchCustomers = async (targetPage = page) => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams({
        page: targetPage,
        limit: 50,
        search: debouncedSearch,
        source: filterSource,
        category: filterCategory
      });

      const res = await fetch(`${API_BASE_URL}/api/customers?${queryParams.toString()}`);
      if (!res.ok) throw new Error('고객 목록을 불러오지 못했습니다.');
      const data = await res.json();

      if (data.customers) {
        setCustomers(data.customers);
        setPagination(data.pagination || { totalCount: 0, totalPages: 1, limit: 50 });
        setStats(data.stats || { total: 0, outlook: 0, manual: 0 });
        if (data.categories) setCategories(data.categories);
      } else {
        setCustomers(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      showToast?.(err.message || '고객 목록 로딩 오류', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers(page);
  }, [page, debouncedSearch, filterSource, filterCategory]);

  // 2. 아웃룩 수동 동기화 실행
  const handleOutlookSync = async () => {
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      setIsSyncing(true);
      showToast?.('아웃룩 전체 연락처(1.8만 건) 동기화를 진행 중입니다...', 'info');
      const res = await fetch(`${API_BASE_URL}/api/customers/sync-outlook`, {
        method: 'POST',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });
      const data = await res.json();

      if (res.ok && data.data?.success) {
        showToast?.(`아웃룩 동기화 완료! (총 ${data.data.totalCount}건 중 신규 ${data.data.addedCount}건, 갱신 ${data.data.updatedCount}건)`, 'success');
        fetchCustomers(1);
      } else {
        showToast?.(`동기화 실패: ${data.error || data.message || '오류 발생'}`, 'error');
      }
    } catch (err) {
      showToast?.(`아웃룩 동기화 중 에러 발생: ${err.message}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // 4. 모달 열기 (신규/수정)
  const openAddModal = () => {
    setEditingCustomer(null);
    setFormData({
      name: '',
      bizNo: '',
      ceoName: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      bankName: '',
      bankAccount: '',
      bankHolder: ''
    });
    setShowModal(true);
  };

  const openEditModal = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || '',
      bizNo: customer.bizNo || '',
      ceoName: customer.ceoName || '',
      contactName: customer.contactName || '',
      contactPhone: customer.contactPhone || '',
      email: customer.email || '',
      address: customer.address || '',
      bankName: customer.bank?.name || '',
      bankAccount: customer.bank?.account || '',
      bankHolder: customer.bank?.holder || ''
    });
    setShowModal(true);
  };

  // 5. 고객 정보 저장 (생성/수정)
  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      const payload = {
        name: formData.name,
        bizNo: formData.bizNo,
        ceoName: formData.ceoName,
        contactName: formData.contactName,
        contactPhone: formData.contactPhone,
        email: formData.email,
        address: formData.address,
        bank: {
          name: formData.bankName,
          account: formData.bankAccount,
          holder: formData.bankHolder
        }
      };

      let res;
      if (editingCustomer) {
        res = await fetch(`${API_BASE_URL}/api/customers/${editingCustomer._id}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'X-User-Role': currentUser?.role || 'viewer'
          },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch(`${API_BASE_URL}/api/customers`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-User-Role': currentUser?.role || 'viewer'
          },
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || '저장에 실패했습니다.');
      }

      showToast?.(editingCustomer ? '고객 정보가 수정되었습니다.' : '신규 고객이 등록되었습니다.', 'success');
      setShowModal(false);
      fetchCustomers();
    } catch (err) {
      showToast?.(err.message, 'error');
    }
  };

  // 6. 고객 삭제
  const handleDeleteCustomer = async (id, name) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 및 삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm(`'${name}' 고객 정보를 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/customers/${id}`, {
        method: 'DELETE',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });
      if (!res.ok) throw new Error('삭제에 실패했습니다.');
      showToast?.('고객 정보가 삭제되었습니다.', 'success');
      fetchCustomers();
    } catch (err) {
      showToast?.(err.message, 'error');
    }
  };

  // 7. 연락처로 주소 조회 기능 관련 핸들러들
  const handleExcelUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const extractedPhones = [];
        for (const row of rawRows) {
          for (const cell of row) {
            if (cell && typeof cell === 'string') {
              const digitsOnly = cell.replace(/\D/g, '');
              if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
                extractedPhones.push(cell.trim());
              }
            } else if (cell && typeof cell === 'number') {
              const strCell = String(cell);
              if (strCell.length >= 7 && strCell.length <= 15) {
                extractedPhones.push(strCell);
              }
            }
          }
        }
        
        if (extractedPhones.length === 0) {
          showToast?.('엑셀 파일에서 유효한 연락처를 찾을 수 없습니다.', 'error');
          return;
        }

        const uniquePhones = [...new Set(extractedPhones)];
        setLookupText(uniquePhones.join('\n'));
        showToast?.(`엑셀에서 ${uniquePhones.length}개의 연락처를 추출했습니다.`, 'success');
      } catch (err) {
        showToast?.(`엑셀 파일을 읽는 도중 오류가 발생했습니다: ${err.message}`, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handlePerformLookup = async () => {
    const lines = lookupText.split(/[\n,]+/).map(p => p.trim()).filter(Boolean);
    if (lines.length === 0) {
      showToast?.('조회할 연락처를 입력하거나 엑셀 파일을 업로드해 주세요.', 'error');
      return;
    }

    try {
      setLookupLoading(true);
      setLookupResults([]);
      setLookupSummary(null);

      const res = await fetch(`${API_BASE_URL}/api/customers/lookup-addresses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phones: lines })
      });

      if (!res.ok) {
        throw new Error('주소 조회 요청에 실패했습니다.');
      }

      const data = await res.json();
      setLookupResults(data);

      const matchedCount = data.filter(r => r.matched).length;
      setLookupSummary({
        total: data.length,
        matched: matchedCount,
        unmatched: data.length - matchedCount
      });
      showToast?.('주소 조회가 완료되었습니다.', 'success');
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleDownloadExcel = () => {
    if (lookupResults.length === 0) return;

    try {
      const excelRows = lookupResults.map((r) => {
        return {
          '연락처': r.inputPhone,
          '아웃룩 고객명': r.matched ? (r.surname || r.name || '') : '',
          '집주소': r.matched ? (r.homeAddress || '') : '',
          '근무처 주소': r.matched ? (r.businessAddress || '') : ''
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(excelRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '주소 조회 결과');

      // Autofit columns
      const maxColWidths = [];
      excelRows.forEach(row => {
        Object.keys(row).forEach((key, colIndex) => {
          const val = row[key] ? String(row[key]) : '';
          const len = val.split('').reduce((acc, char) => acc + (char.charCodeAt(0) > 127 ? 2 : 1), 0);
          maxColWidths[colIndex] = Math.max(maxColWidths[colIndex] || 12, len + 2);
        });
      });
      worksheet['!cols'] = maxColWidths.map(w => ({ wch: w }));

      XLSX.writeFile(workbook, `고객_주소_조회_결과_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast?.('엑셀 파일이 다운로드되었습니다.', 'success');
    } catch (err) {
      showToast?.(`엑셀 저장 중 오류가 발생했습니다: ${err.message}`, 'error');
    }
  };

  const handleDownloadTemplate = () => {
    try {
      const templateData = [
        { '연락처': '010-1234-5678' },
        { '연락처': '02-987-6543' },
        { '연락처': '01011112222' }
      ];
      const worksheet = XLSX.utils.json_to_sheet(templateData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '조회 양식');
      worksheet['!cols'] = [{ wch: 20 }];
      XLSX.writeFile(workbook, '고객_주소_조회_양식.xlsx');
      showToast?.('양식 파일이 다운로드되었습니다.', 'success');
    } catch (err) {
      showToast?.(`양식 다운로드 중 오류가 발생했습니다: ${err.message}`, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* 상단 액션 툴바 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        flexWrap: 'wrap', 
        gap: '1rem',
        background: 'var(--bg-surface)', 
        padding: '1.2rem 1.5rem', 
        borderRadius: '12px',
        border: '1px solid var(--border-color)'
      }}>
        {/* 검색 및 필터 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: '300px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="고객명, 담당자, 연락처, 이메일, 사업자번호 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.65rem 1rem 0.65rem 2.4rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-main)',
                color: 'var(--text-bright)',
                fontSize: '0.9rem'
              }}
            />
          </div>

          <select
            value={filterSource}
            onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
            style={{
              padding: '0.65rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-main)',
              color: 'var(--text-bright)',
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            <option value="all">전체 출처 보기</option>
            <option value="outlook">📧 아웃룩 연동 데이터</option>
            <option value="manual">👤 직접 등록 데이터</option>
          </select>

          {categories.length > 0 && (
            <select
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
              style={{
                padding: '0.65rem 1rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-main)',
                color: 'var(--text-bright)',
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              <option value="all">📂 모든 아웃룩 폴더 보기</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>📁 {cat}</option>
              ))}
            </select>
          )}
        </div>

        {/* 오른쪽 실행 버튼들 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <button
            onClick={handleOutlookSync}
            disabled={isSyncing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.2rem',
              borderRadius: '8px',
              border: '1px solid var(--primary)',
              background: 'var(--primary-glow)',
              color: 'var(--primary)',
              fontWeight: '600',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              transition: 'all 0.2s'
            }}
          >
            <RefreshCw size={16} className={isSyncing ? 'spin-anim' : ''} />
            <span>{isSyncing ? '동기화 진행 중...' : '아웃룩 실시간 동기화'}</span>
          </button>

          <button
            onClick={() => setShowLookupModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.2rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-main)',
              color: 'var(--text-bright)',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.9rem',
              transition: 'all 0.2s'
            }}
          >
            <Building size={16} />
            <span>연락처로 주소 조회 (엑셀)</span>
          </button>

          <button
            onClick={openAddModal}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.2rem',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--primary)',
              color: '#ffffff',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.9rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
            }}
          >
            <Plus size={16} />
            <span>신규 고객 등록</span>
          </button>
        </div>
      </div>

      {/* 요약 통계 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div style={{ background: 'var(--bg-surface)', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>전체 등록 고객</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-bright)', marginTop: '0.3rem' }}>{stats.total.toLocaleString()} 명</h3>
        </div>
        <div style={{ background: 'var(--bg-surface)', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>📧 아웃룩 연동 고객</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0078d4', marginTop: '0.3rem' }}>
            {stats.outlook.toLocaleString()} 명
          </h3>
        </div>
        <div style={{ background: 'var(--bg-surface)', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>👤 수동 등록 고객</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--primary)', marginTop: '0.3rem' }}>
            {stats.manual.toLocaleString()} 명
          </h3>
        </div>
      </div>

      {/* 고객 DB 테이블 목록 */}
      <div style={{ 
        background: 'var(--bg-surface)', 
        borderRadius: '12px', 
        border: '1px solid var(--border-color)', 
        overflow: 'hidden' 
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            고객 DB를 초고속 조회 중입니다...
          </div>
        ) : customers.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            검색 결과 또는 등록된 고객 정보가 없습니다.
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', minWidth: '180px' }}>성</th>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', minWidth: '240px' }}>이름</th>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', minWidth: '240px' }}>회사</th>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', width: '200px' }}>수정한 날짜</th>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', textAlign: 'center', width: '120px' }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((cust) => {
                    const formattedDate = cust.updatedAt 
                      ? new Date(cust.updatedAt).toLocaleString('ko-KR', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          weekday: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : '-';

                    return (
                      <tr 
                        key={cust._id} 
                        onClick={() => handleOpenOutlookWindow(cust)}
                        style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                        className="outlook-row-hover"
                      >
                        {/* 1. 성 (메인 이름) */}
                        <td style={{ padding: '0.9rem 1.2rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                          {cust.surname || cust.name || '-'}
                        </td>

                        {/* 2. 이름 */}
                        <td style={{ padding: '0.9rem 1.2rem', fontWeight: '600', color: 'var(--text-main)' }}>
                          {cust.givenName || cust.displayName || cust.contactName || '-'}
                        </td>

                        {/* 3. 회사 */}
                        <td style={{ padding: '0.9rem 1.2rem', color: 'var(--text-main)', fontWeight: '500' }}>
                          {cust.companyName || (cust.surname ? cust.name : '-') || '-'}
                        </td>

                        {/* 4. 수정한 날짜 */}
                        <td style={{ padding: '0.9rem 1.2rem', color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                          {formattedDate}
                        </td>

                        {/* 5. 관리 */}
                        <td style={{ padding: '0.9rem 1.2rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem' }}>
                            <button
                              onClick={() => handleOpenOutlookWindow(cust)}
                              title="아웃룩 연락처 상세 카드 보기"
                              style={{
                                border: 'none',
                                background: 'rgba(0, 120, 212, 0.1)',
                                color: '#0078d4',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                padding: '0.3rem 0.6rem',
                                fontSize: '0.78rem',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.2rem'
                              }}
                            >
                              <Eye size={13} />
                              <span>상세</span>
                            </button>
                            <button
                              onClick={() => handleDeleteCustomer(cust._id, cust.name)}
                              title="삭제"
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#ff4d4f',
                                cursor: 'pointer',
                                padding: '0.25rem'
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 하위 서버 페이징 컨트롤 바 */}
            <div style={{
              display: 'flex',
              justify: 'space-between',
              alignItems: 'center',
              padding: '1rem 1.5rem',
              background: 'var(--bg-main)',
              borderTop: '1px solid var(--border-color)',
              fontSize: '0.85rem',
              color: 'var(--text-muted)'
            }}>
              <div>
                총 <strong style={{ color: 'var(--text-bright)' }}>{pagination.totalCount.toLocaleString()}</strong>건 중{' '}
                {pagination.totalCount > 0 ? ((page - 1) * 50) + 1 : 0} - {Math.min(page * 50, pagination.totalCount)}건 표시
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: page <= 1 ? 'transparent' : 'var(--bg-surface)',
                    color: page <= 1 ? 'var(--text-muted)' : 'var(--text-bright)',
                    cursor: page <= 1 ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  ◀ 이전
                </button>

                <span style={{ fontWeight: '600', color: 'var(--text-bright)' }}>
                  {page} / {pagination.totalPages || 1} 페이지
                </span>

                <button
                  onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: page >= pagination.totalPages ? 'transparent' : 'var(--bg-surface)',
                    color: page >= pagination.totalPages ? 'var(--text-muted)' : 'var(--text-bright)',
                    cursor: page >= pagination.totalPages ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  다음 ▶
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 등록 / 수정 모달 */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: 'var(--bg-surface)',
            width: '100%',
            maxWidth: '560px',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            overflow: 'hidden'
          }}>
            {/* 모달 헤더 */}
            <div style={{
              padding: '1.2rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                {editingCustomer ? '고객 정보 수정' : '신규 고객 등록'}
              </h3>
              <button 
                onClick={() => setShowModal(false)}
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* 모달 폼 바디 */}
            <form onSubmit={handleSaveCustomer} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    개인/법인명 *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    사업자/주민번호 *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.bizNo}
                    onChange={(e) => setFormData({ ...formData, bizNo: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    대표자명
                  </label>
                  <input
                    type="text"
                    value={formData.ceoName}
                    onChange={(e) => setFormData({ ...formData, ceoName: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    담당자명
                  </label>
                  <input
                    type="text"
                    value={formData.contactName}
                    onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    연락처
                  </label>
                  <input
                    type="text"
                    value={formData.contactPhone}
                    onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    이메일 *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                  주소
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                />
              </div>

              {/* 모달 푸터 버튼 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  취소
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#fff',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 연락처로 주소 조회 모달 */}
      {showLookupModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1100,
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: 'var(--bg-surface)',
            padding: '2rem',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            width: '90%',
            maxWidth: '850px',
            maxHeight: '90vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: 'var(--text-bright)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Building size={22} style={{ color: 'var(--primary)' }} />
                <span>연락처로 고객 주소 조회 (집/근무처)</span>
              </h3>
              <button 
                onClick={() => {
                  setShowLookupModal(false);
                  setLookupText('');
                  setLookupResults([]);
                  setLookupSummary(null);
                }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              고객 연락처 목록(전화번호)을 직접 입력하거나 엑셀 파일을 업로드해 보세요. 
              데이터베이스(아웃룩 동기화 데이터 포함)의 모든 고객 연락처를 조회하여 <strong>집 주소</strong>와 <strong>근무처 주소</strong>를 매칭한 결과를 엑셀 파일로 저장할 수 있습니다.
            </div>

            {/* 입력 영역 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* 엑셀 파일 업로드 */}
              <div style={{ 
                border: '1px dashed var(--border-color)', 
                borderRadius: '8px', 
                padding: '1.5rem', 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center',
                gap: '0.8rem',
                background: 'var(--bg-main)',
                minHeight: '180px'
              }}>
                <div style={{ width: '45px', height: '45px', borderRadius: '50%', background: 'rgba(34, 197, 94, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Building size={22} style={{ color: '#22c55e' }} />
                </div>
                <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-bright)' }}>엑셀 파일 가져오기</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  전화번호가 포함된 열이 있는<br />엑셀 파일(.xlsx, .xls)을 선택하세요.
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={handleDownloadTemplate}
                    type="button"
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '6px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: 'var(--text-muted)',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      border: '1px solid var(--border-color)',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)' }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                  >
                    양식 다운로드
                  </button>
                  <label style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: '#22c55e',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    transition: 'all 0.2s'
                  }}>
                    파일 선택
                    <input 
                      type="file" 
                      accept=".xlsx, .xls" 
                      onChange={handleExcelUpload} 
                      style={{ display: 'none' }} 
                    />
                  </label>
                </div>
              </div>

              {/* 직접 붙여넣기 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-bright)' }}>연락처 직접 붙여넣기</span>
                <textarea
                  rows={7}
                  placeholder="예:&#13;010-1234-5678&#13;01098765432&#13;02-111-2222 (한 줄에 하나씩 입력)"
                  value={lookupText}
                  onChange={(e) => setLookupText(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-main)',
                    color: 'var(--text-bright)',
                    fontSize: '0.85rem',
                    fontFamily: 'monospace',
                    resize: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem' }}>
              <button
                onClick={handlePerformLookup}
                disabled={lookupLoading || !lookupText.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.7rem 1.5rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'var(--primary)',
                  color: '#ffffff',
                  fontWeight: '600',
                  cursor: (lookupLoading || !lookupText.trim()) ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  opacity: (lookupLoading || !lookupText.trim()) ? 0.6 : 1
                }}
              >
                {lookupLoading ? <RefreshCw size={16} className="spin-anim" /> : <Search size={16} />}
                <span>{lookupLoading ? '조회 중...' : '주소 조회 실행'}</span>
              </button>
            </div>

            {/* 결과 영역 */}
            {lookupSummary && (
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ background: 'var(--bg-main)', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.85rem', border: '1px solid var(--border-color)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>전체 입력:</span>{' '}
                      <strong style={{ color: 'var(--text-bright)' }}>{lookupSummary.total}건</strong>
                    </div>
                    <div style={{ background: 'var(--bg-main)', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.85rem', border: '1px solid var(--border-color)' }}>
                      <span style={{ color: '#22c55e' }}>매칭 성공:</span>{' '}
                      <strong style={{ color: '#22c55e' }}>{lookupSummary.matched}건</strong>
                    </div>
                    <div style={{ background: 'var(--bg-main)', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.85rem', border: '1px solid var(--border-color)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>매칭 실패:</span>{' '}
                      <strong style={{ color: 'var(--text-muted)' }}>{lookupSummary.unmatched}건</strong>
                    </div>
                  </div>

                  <button
                    onClick={handleDownloadExcel}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.6rem 1.2rem',
                      borderRadius: '6px',
                      border: 'none',
                      background: '#22c55e',
                      color: '#ffffff',
                      fontWeight: '600',
                      cursor: 'pointer',
                      fontSize: '0.85rem'
                    }}
                  >
                    <span>엑셀 결과 다운로드 (.xlsx)</span>
                  </button>
                </div>

                {/* 테이블 프리뷰 */}
                <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '0.6rem 0.8rem' }}>연락처</th>
                        <th style={{ padding: '0.6rem 0.8rem' }}>상태</th>
                        <th style={{ padding: '0.6rem 0.8rem' }}>아웃룩 고객명</th>
                        <th style={{ padding: '0.6rem 0.8rem' }}>집주소</th>
                        <th style={{ padding: '0.6rem 0.8rem' }}>근무처 주소</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lookupResults.slice(0, 5).map((r, i) => (
                        <tr key={i} style={{ borderBottom: i < 4 && i < lookupResults.length - 1 ? '1px solid var(--border-color)' : 'none', color: 'var(--text-bright)' }}>
                          <td style={{ padding: '0.6rem 0.8rem' }}>{r.inputPhone}</td>
                          <td style={{ padding: '0.6rem 0.8rem' }}>
                            <span style={{ 
                              padding: '0.2rem 0.5rem', 
                              borderRadius: '4px', 
                              fontSize: '0.7rem', 
                              fontWeight: 'bold', 
                              background: r.matched ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: r.matched ? '#22c55e' : '#ef4444'
                            }}>
                              {r.matched ? '성공' : '실패'}
                            </span>
                          </td>
                          <td style={{ padding: '0.6rem 0.8rem' }}>{r.surname || r.name || '-'}</td>
                          <td style={{ padding: '0.6rem 0.8rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.homeAddress || '-'}</td>
                          <td style={{ padding: '0.6rem 0.8rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.businessAddress || '-'}</td>
                        </tr>
                      ))}
                      {lookupResults.length > 5 && (
                        <tr>
                          <td colSpan={5} style={{ padding: '0.6rem 0.8rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-main)' }}>
                            외 {lookupResults.length - 5}건이 더 있습니다. 전체 결과는 상단의 엑셀 파일로 다운로드해 확인하세요.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 독립 다중 아웃룩 연락처 팝업 창 관리자 (Multi-window Support) */}
      {openOutlookWindows.map(win => (
        <OutlookContactModal
          key={win.customer._id}
          windowId={win.customer._id}
          customer={win.customer}
          initialPosition={win.position}
          zIndex={win.zIndex}
          isTopWindow={win.zIndex === maxZIndex}
          onFocus={() => handleFocusOutlookWindow(win.customer._id)}
          onClose={() => handleCloseOutlookWindow(win.customer._id)}
          onSave={async (id, updatedData) => {
            if (currentUser?.role === 'viewer') {
              showToast?.('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
              return;
            }
            const res = await fetch(`${API_BASE_URL}/api/customers/${id}`, {
              method: 'PUT',
              headers: { 
                'Content-Type': 'application/json',
                'X-User-Role': currentUser?.role || 'viewer'
              },
              body: JSON.stringify(updatedData)
            });
            if (!res.ok) {
              const errData = await res.json();
              throw new Error(errData.message || '저장에 실패했습니다.');
            }
            showToast?.('아웃룩 연락처 정보가 저장되었습니다.', 'success');
            handleCloseOutlookWindow(id);
            fetchCustomers(page);
          }}
          onDelete={(id, name) => handleDeleteCustomer(id, name)}
          showToast={showToast}
        />
      ))}
    </div>
  );
}

export default CustomerListView;
