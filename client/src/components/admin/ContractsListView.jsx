import React, { useState, useEffect, useRef } from 'react';
import { Search, Receipt, Coins, Users, Trash2, ArrowRight, Upload, AlertCircle, CheckCircle, X, Download, Edit } from 'lucide-react';
import * as XLSX from 'xlsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;

function ContractsListView({ setActiveTab, setPrefilledQuoteData, setPrefilledContractData, showToast, currentUser }) {
  const [contracts, setContracts] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Tab: 'contracts' | 'quotes' | 'customers'
  const [activeSubTab, setActiveSubTab] = useState('contracts');

  // Excel Upload Preview State
  const [previewData, setPreviewData] = useState(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const fileInputRef = useRef(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [resContracts, resQuotes, resCustomers] = await Promise.all([
        fetch(`${API_HOST}/api/contracts`),
        fetch(`${API_HOST}/api/quotes`),
        fetch(`${API_HOST}/api/customers`)
      ]);

      const rawCData = resContracts.ok ? await resContracts.json() : [];
      const rawQData = resQuotes.ok ? await resQuotes.json() : [];
      const rawCustData = resCustomers.ok ? await resCustomers.json() : [];

      const cData = Array.isArray(rawCData) ? rawCData : (rawCData.contracts || rawCData.data || []);
      const qData = Array.isArray(rawQData) ? rawQData : (rawQData.quotes || rawQData.data || []);
      const custData = Array.isArray(rawCustData) ? rawCustData : (rawCustData.customers || rawCustData.data || []);

      setContracts(cData);
      setQuotes(qData);
      setCustomers(custData);
    } catch (err) {
      console.error(err);
      showToast('데이터 조회 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDeleteContract = async (id) => {
    if (currentUser?.role === 'viewer') {
      showToast('수정 및 삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm('정말 이 계약서를 삭제하시겠습니까? 관련 차량 및 등록 일정들도 모두 일괄 삭제됩니다.')) return;

    try {
      const response = await fetch(`${API_HOST}/api/contracts/${id}`, {
        method: 'DELETE',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });

      if (response.ok) {
        showToast('계약서가 성공적으로 삭제되었습니다.', 'success');
        fetchData();
      } else {
        showToast('계약서 삭제 실패', 'error');
      }
    } catch (err) {
      showToast('서버 연결 오류', 'error');
    }
  };

  const handleEditContract = (contract) => {
    if (setPrefilledContractData) {
      setPrefilledContractData(contract);
    }
    if (setPrefilledQuoteData) {
      setPrefilledQuoteData(null);
    }
    setActiveTab('contract-register');
  };

  const handleDeleteQuote = async (id) => {
    if (currentUser?.role === 'viewer') {
      showToast('수정 및 삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm('정말 이 견적서를 삭제하시겠습니까?')) return;

    try {
      const response = await fetch(`${API_HOST}/api/quotes/${id}`, {
        method: 'DELETE',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });

      if (response.ok) {
        showToast('견적서가 삭제되었습니다.', 'success');
        fetchData();
      } else {
        showToast('견적서 삭제 실패', 'error');
      }
    } catch (err) {
      showToast('서버 연결 오류', 'error');
    }
  };

  const handleDeleteCustomer = async (id) => {
    if (currentUser?.role === 'viewer') {
      showToast('수정 및 삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm('정말 이 고객 정보를 삭제하시겠습니까? 해당 고객과 연동된 계약서/견적서 정보에 영향을 미칠 수 있습니다.')) return;

    try {
      const response = await fetch(`${API_HOST}/api/customers/${id}`, {
        method: 'DELETE',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });

      if (response.ok) {
        showToast('고객 정보가 삭제되었습니다.', 'success');
        fetchData();
      } else {
        showToast('고객 정보 삭제 실패', 'error');
      }
    } catch (err) {
      showToast('서버 연결 오류', 'error');
    }
  };

  const handleConvertToContract = (quote) => {
    setPrefilledQuoteData(quote);
    setActiveTab('contract-register');
  };

  // Excel Upload Parsing Handler
  const handleExcelUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Read first sheet
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const rawRows = XLSX.utils.sheet_to_json(sheet);
        if (rawRows.length === 0) {
          showToast('엑셀 파일에 데이터가 존재하지 않습니다.', 'error');
          return;
        }

        // Map Korean headers to database fields
        const mappedCustomers = rawRows.map(row => {
          // Normalize row keys (remove spaces)
          const normRow = {};
          Object.keys(row).forEach(k => {
            normRow[k.trim().replace(/\s+/g, '')] = row[k];
          });

          const customerId = normRow['고객ID'] || normRow['고객id'] || normRow['고객코드'] || normRow['customerId'] || '';
          const name = normRow['고객명(필수)'] || normRow['고객명'] || normRow['개인/법인명'] || normRow['이름'] || normRow['Name'] || '';
          const bizNo = normRow['사업자/주민번호(필수)'] || normRow['사업자/주민번호'] || normRow['사업자번호'] || normRow['주민번호'] || normRow['BizNo'] || '';
          const ceoName = normRow['대표자명'] || normRow['대표자'] || normRow['CeoName'] || '';
          const address = normRow['주소'] || normRow['Address'] || '';
          const contactName = normRow['담당자명'] || normRow['담당자'] || normRow['ContactName'] || '';
          const contactPhone = normRow['연락처'] || normRow['담당자연락처'] || normRow['전화번호'] || normRow['ContactPhone'] || '';
          const email = normRow['이메일'] || normRow['Email'] || normRow['수신메일'] || normRow['참조메일'] || 'no-email@rentbenefit.co.kr';
          const bankName = normRow['은행명'] || normRow['은행'] || normRow['BankName'] || '';
          const bankAccount = normRow['계좌번호'] || normRow['계좌'] || normRow['BankAccount'] || '';
          const bankHolder = normRow['예금주'] || normRow['예금'] || normRow['BankHolder'] || name || '';

          return {
            customerId: String(customerId).trim(),
            name: String(name).trim(),
            bizNo: String(bizNo).trim(),
            ceoName: String(ceoName).trim(),
            address: String(address).trim(),
            contactName: String(contactName).trim(),
            contactPhone: String(contactPhone).trim(),
            email: String(email).trim(),
            bank: {
              name: String(bankName).trim(),
              account: String(bankAccount).trim(),
              holder: String(bankHolder).trim()
            },

            // UI validation flag
            isValid: name && bizNo
          };
        });

        setPreviewData(mappedCustomers);
        setShowPreviewModal(true);
      } catch (err) {
        console.error(err);
        showToast('엑셀 파일 읽기 오류', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    
    // Clear input value to allow uploading same file again
    e.target.value = '';
  };

  const handleSaveBulkImport = async () => {
    if (!previewData || previewData.length === 0) return;

    const validData = previewData.filter(c => c.isValid);
    if (validData.length === 0) {
      showToast('저장할 유효한 고객 정보가 없습니다.', 'error');
      return;
    }

    if (currentUser?.role === 'viewer') {
      showToast('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      const response = await fetch(`${API_HOST}/api/customers/bulk`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Role': currentUser?.role || 'viewer'
        },
        body: JSON.stringify({ customers: validData })
      });

      if (response.ok) {
        const result = await response.json();
        showToast(`업로드 성공! 신규 등록: ${result.inserted}건, 중복 스킵: ${result.skipped}건`, 'success');
        setShowPreviewModal(false);
        setPreviewData(null);
        fetchData(); // Reload Lists
      } else {
        showToast('대량 DB 업로드 실패', 'error');
      }
    } catch (err) {
      showToast('서버 저장 실패', 'error');
    }
  };

  const handleDownloadTemplate = () => {
    // Generate empty instruction excel template
    const headers = [
      '고객 ID', '고객명 (필수)', '사업자/주민번호 (필수)', '대표자명', '주소', 
      '담당자명', '연락처', '이메일', '은행명', '계좌번호', '예금주'
    ];
    const sampleData = [
      {
        '고객 ID': 'CUST001',
        '고객명 (필수)': '홍길동',
        '사업자/주민번호 (필수)': '880101-1234567',
        '대표자명': '',
        '주소': '서울특별시 서초구 양재동 123-45',
        '담당자명': '홍길동',
        '연락처': '010-1234-5678',
        '이메일': 'gildong@example.com',
        '은행명': '신한은행',
        '계좌번호': '110-123-456789',
        '예금주': '홍길동'
      },
      {
        '고객 ID': 'CUST002',
        '고객명 (필수)': '(주)에스벤네핏',
        '사업자/주민번호 (필수)': '123-81-12345',
        '대표자명': '김대표',
        '주소': '서울특별시 서초구 양재대로11길 36',
        '담당자명': '최대리',
        '연락처': '02-123-4567',
        '이메일': 'choi@sbenefit.co.kr',
        '은행명': '국민은행',
        '계좌번호': '123456-02-123456',
        '예금주': '(주)에스벤네핏'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData, { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '고객 템플릿');
    XLSX.writeFile(workbook, '고객_DB_등록_템플릿.xlsx');
  };

  // Filter lists based on search
  const filteredContracts = contracts.filter(c => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.contractNo.includes(q) ||
      c.customer?.name.toLowerCase().includes(q) ||
      c.vehicle?.model.toLowerCase().includes(q) ||
      c.vehicle?.code.toLowerCase().includes(q)
    );
  });

  const filteredQuotes = quotes.filter(q => {
    if (!searchQuery.trim()) return true;
    const searchVal = searchQuery.toLowerCase();
    return (
      q.customer?.name.toLowerCase().includes(searchVal) ||
      q.vehicleModel.toLowerCase().includes(searchVal)
    );
  });

  const filteredCustomers = customers.filter(c => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.customerId && c.customerId.toLowerCase().includes(q)) ||
      c.name.toLowerCase().includes(q) ||
      c.bizNo.includes(q) ||
      c.contactName?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="contracts-list-view fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Sub Tabs Toggle */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: '#fff', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
        <button 
          onClick={() => { setActiveSubTab('contracts'); setSearchQuery(''); }}
          style={{ flex: 1, padding: '1rem', border: 'none', background: activeSubTab === 'contracts' ? 'var(--primary-glow)' : '#fff', borderBottom: activeSubTab === 'contracts' ? '3px solid var(--primary)' : 'none', color: activeSubTab === 'contracts' ? 'var(--primary)' : 'var(--text-main)', fontWeight: activeSubTab === 'contracts' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
        >
          <Receipt size={16} /> 계약서 관리 ({contracts.length})
        </button>
        <button 
          onClick={() => { setActiveSubTab('quotes'); setSearchQuery(''); }}
          style={{ flex: 1, padding: '1rem', border: 'none', background: activeSubTab === 'quotes' ? 'var(--primary-glow)' : '#fff', borderBottom: activeSubTab === 'quotes' ? '3px solid var(--primary)' : 'none', color: activeSubTab === 'quotes' ? 'var(--primary)' : 'var(--text-main)', fontWeight: activeSubTab === 'quotes' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
        >
          <Coins size={16} /> 견적서 목록 ({quotes.length})
        </button>
        <button 
          onClick={() => { setActiveSubTab('customers'); setSearchQuery(''); }}
          style={{ flex: 1, padding: '1rem', border: 'none', background: activeSubTab === 'customers' ? 'var(--primary-glow)' : '#fff', borderBottom: activeSubTab === 'customers' ? '3px solid var(--primary)' : 'none', color: activeSubTab === 'customers' ? 'var(--primary)' : 'var(--text-main)', fontWeight: activeSubTab === 'customers' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
        >
          <Users size={16} /> 고객 DB 관리 ({customers.length})
        </button>
      </div>

      {/* Search & Actions Header */}
      <div style={{ background: '#fff', padding: '1rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, position: 'relative', minWidth: '240px' }}>
          <input 
            type="text" 
            placeholder={
              activeSubTab === 'contracts' ? "계약번호, 고객명, 차종 검색..." : 
              activeSubTab === 'quotes' ? "고객명, 차종 검색..." : "고객명, 사업자번호, 이메일 검색..."
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '0.5rem 0.5rem 0.5rem 2rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }}
          />
          <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        </div>

        {/* Bulk Upload Buttons (Only visible in Customers tab) */}
        {activeSubTab === 'customers' && (
          <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
            <button 
              type="button" 
              onClick={handleDownloadTemplate}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s' }}
            >
              <Download size={14} /> 템플릿 다운로드
            </button>

            <button 
              type="button" 
              onClick={() => fileInputRef.current.click()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.5rem 1.1rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s' }}
            >
              <Upload size={14} /> 고객 엑셀 업로드
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleExcelUpload} 
              accept=".xlsx, .xls" 
              style={{ display: 'none' }} 
            />
          </div>
        )}
      </div>

      {/* Data lists */}
      {activeSubTab === 'contracts' && (
        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
                <th style={{ padding: '0.8rem' }}>계약번호</th>
                <th style={{ padding: '0.8rem' }}>대표자</th>
                <th style={{ padding: '0.8rem' }}>고객명</th>
                <th style={{ padding: '0.8rem' }}>차종</th>
                <th style={{ padding: '0.8rem' }}>계약일</th>
                <th style={{ padding: '0.8rem' }}>월 렌트료</th>
                <th style={{ padding: '0.8rem', width: '60px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
              ) : filteredContracts.length === 0 ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>등록된 계약서가 없습니다.</td></tr>
              ) : (
                filteredContracts.map(c => (
                  <tr key={c._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.8rem', fontWeight: '700' }}>{c.contractNo}</td>
                    <td style={{ padding: '0.8rem' }}>{c.customer?.ceoName || '-'}</td>
                    <td style={{ padding: '0.8rem' }}>{c.customer?.name || '-'}</td>
                    <td style={{ padding: '0.8rem' }}>{c.vehicle?.carModel || '-'}</td>
                    <td style={{ padding: '0.8rem' }}>{new Date(c.contractDate).toLocaleDateString()}</td>
                    <td style={{ padding: '0.8rem', fontWeight: '700' }}>{c.pricing?.monthlyFee?.toLocaleString()}원</td>
                    <td style={{ padding: '0.8rem', display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                      <button 
                        onClick={() => handleEditContract(c)}
                        style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer' }}
                        title="계약서 수정"
                      >
                        <Edit size={16} />
                      </button>
                      <button 
                        onClick={() => handleDeleteContract(c._id)}
                        style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}
                        title="계약서 삭제"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'quotes' && (
        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
                <th style={{ padding: '0.8rem' }}>고객명</th>
                <th style={{ padding: '0.8rem' }}>차종 / 사양</th>
                <th style={{ padding: '0.8rem' }}>차량총액</th>
                <th style={{ padding: '0.8rem' }}>작성일</th>
                <th style={{ padding: '0.8rem' }}>작성자</th>
                <th style={{ padding: '0.8rem' }}>견적 상태</th>
                <th style={{ padding: '0.8rem', width: '120px' }}>관리 및 전환</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
              ) : filteredQuotes.length === 0 ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>등록된 견적서가 없습니다.</td></tr>
              ) : (
                filteredQuotes.map(q => (
                  <tr key={q._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.8rem', fontWeight: '700' }}>{q.customer?.name || '-'}</td>
                    <td style={{ padding: '0.8rem' }}>{q.vehicleModel}</td>
                    <td style={{ padding: '0.8rem' }}>{q.totalPrice ? `${q.totalPrice.toLocaleString()}원` : '-'}</td>
                    <td style={{ padding: '0.8rem' }}>{new Date(q.createdAt).toLocaleDateString()}</td>
                    <td style={{ padding: '0.8rem' }}>{q.createdBy}</td>
                    <td style={{ padding: '0.8rem' }}>
                      <span style={{ 
                        background: q.status === '계약전환' ? '#dcfce7' : '#e2e8f0', 
                        color: q.status === '계약전환' ? '#16a34a' : '#475569',
                        padding: '0.2rem 0.4rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }}>
                        {q.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.8rem', display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                      {q.status !== '계약전환' && (
                        <button 
                          onClick={() => handleConvertToContract(q)}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', border: 'none', background: 'var(--primary-glow)', color: 'var(--primary)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                        >
                          계약전환 <ArrowRight size={10} />
                        </button>
                      )}
                      <button 
                        onClick={() => handleDeleteQuote(q._id)}
                        style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}
                        title="견적서 삭제"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'customers' && (
        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
                <th style={{ padding: '0.8rem' }}>고객 ID</th>
                <th style={{ padding: '0.8rem' }}>고객명</th>
                <th style={{ padding: '0.8rem' }}>사업자/주민번호</th>
                <th style={{ padding: '0.8rem' }}>대표자명</th>
                <th style={{ padding: '0.8rem' }}>담당자 / 연락처</th>
                <th style={{ padding: '0.8rem' }}>이메일</th>
                <th style={{ padding: '0.8rem' }}>이체 은행/계좌</th>
                <th style={{ padding: '0.8rem', width: '60px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
              ) : filteredCustomers.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>등록된 고객 정보가 없습니다. 엑셀을 업로드하여 등록해 보세요.</td></tr>
              ) : (
                filteredCustomers.map(cust => (
                  <tr key={cust._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.8rem', fontWeight: '600', color: 'var(--primary)' }}>{cust.customerId || '-'}</td>
                    <td style={{ padding: '0.8rem', fontWeight: '700' }}>{cust.name}</td>
                    <td style={{ padding: '0.8rem' }}>{cust.bizNo}</td>
                    <td style={{ padding: '0.8rem' }}>{cust.ceoName || '-'}</td>
                    <td style={{ padding: '0.8rem' }}>{cust.contactName || '-'} / {cust.contactPhone || '-'}</td>
                    <td style={{ padding: '0.8rem' }}>{cust.email || '-'}</td>
                    <td style={{ padding: '0.8rem' }}>
                      {cust.bank?.name ? `${cust.bank.name} ${cust.bank.account}` : '-'}
                    </td>
                    <td style={{ padding: '0.8rem' }}>
                      <button 
                        onClick={() => handleDeleteCustomer(cust._id)}
                        style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}
                        title="고객 삭제"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Excel Upload Preview Modal */}
      {showPreviewModal && previewData && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: '16px', maxWidth: '800px', width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
            
            {/* Header */}
            <div style={{ background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Upload size={18} style={{ color: 'var(--primary)' }} />
                <h4 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-bright)' }}>업로드 고객 미리보기 ({previewData.length}건)</h4>
              </div>
              <button onClick={() => setShowPreviewModal(false)} style={{ border: 'none', background: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
            </div>

            {/* Warning details */}
            <div style={{ padding: '0.8rem 1.5rem', background: '#fffbeb', borderBottom: '1px solid #fef3c7', color: '#b45309', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <AlertCircle size={14} />
              <span>빨갛게 표시된 행은 필수 항목(고객명, 사업자번호) 누락으로 업로드 시 제외됩니다. 기존 등록된 동일 사업자번호는 최종 완료 시 자동 스킵됩니다.</span>
            </div>

            {/* Preview table body */}
            <div style={{ padding: '1rem', overflowY: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', fontWeight: '700' }}>
                    <th style={{ padding: '0.6rem' }}>고객 ID</th>
                    <th style={{ padding: '0.6rem' }}>고객명 (필수)</th>
                    <th style={{ padding: '0.6rem' }}>사업자/주민번호 (필수)</th>
                    <th style={{ padding: '0.6rem' }}>대표자명</th>
                    <th style={{ padding: '0.6rem' }}>주소</th>
                    <th style={{ padding: '0.6rem' }}>담당자명</th>
                    <th style={{ padding: '0.6rem' }}>연락처</th>
                    <th style={{ padding: '0.6rem' }}>이메일</th>
                    <th style={{ padding: '0.6rem' }}>은행명 / 계좌번호 / 예금주</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((row, idx) => (
                    <tr 
                      key={idx} 
                      style={{ 
                        borderBottom: '1px solid var(--border-color)',
                        background: !row.isValid ? '#fef2f2' : 'transparent',
                        color: !row.isValid ? '#dc2626' : 'inherit'
                      }}
                    >
                      <td style={{ padding: '0.6rem' }}>{row.customerId || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>자동 채번</span>}</td>
                      <td style={{ padding: '0.6rem', fontWeight: row.isValid ? '600' : 'normal' }}>
                        {row.name || <span style={{ fontStyle: 'italic', color: 'var(--error)' }}>누락</span>}
                      </td>
                      <td style={{ padding: '0.6rem' }}>
                        {row.bizNo || <span style={{ fontStyle: 'italic', color: 'var(--error)' }}>누락</span>}
                      </td>
                      <td style={{ padding: '0.6rem' }}>{row.ceoName || '-'}</td>
                      <td style={{ padding: '0.6rem', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.address || '-'}</td>
                      <td style={{ padding: '0.6rem' }}>{row.contactName || '-'}</td>
                      <td style={{ padding: '0.6rem' }}>{row.contactPhone || '-'}</td>
                      <td style={{ padding: '0.6rem' }}>{row.email || '-'}</td>
                      <td style={{ padding: '0.6rem' }}>
                        {row.bank?.name ? `${row.bank.name} ${row.bank.account} (${row.bank.holder})` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div style={{ background: 'var(--bg-main)', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '0.8rem' }}>
              <button 
                onClick={() => setShowPreviewModal(false)}
                style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.5rem 1.2rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer' }}
              >
                취소
              </button>
              <button 
                onClick={handleSaveBulkImport}
                style={{ background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.5rem 1.5rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
              >
                DB 저장하기 ({previewData.filter(c => c.isValid).length}건)
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default ContractsListView;
