import React, { useState, useEffect } from 'react';
import { Search, Calendar, User, DollarSign, Clock, Settings, FileText, SlidersHorizontal, Info } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;

function VehicleListView({ showToast }) {
  const [vehicles, setVehicles] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterModel, setFilterModel] = useState('전체');
  const [filterBranch, setFilterBranch] = useState('전체');
  const [filterManager, setFilterManager] = useState('전체');
  const [filterStatus, setFilterStatus] = useState('전체');
  const [sortByExpiry, setSortByExpiry] = useState(false); // 종료임박순

  // Detail Modal State
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [activeTab, setActiveTab] = useState('customer'); // 'customer' | 'pricing' | 'schedule'
  const [selectedContract, setSelectedContract] = useState(null);
  const [selectedSchedules, setSelectedSchedules] = useState([]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [resVeh, resCon] = await Promise.all([
        fetch(`${API_HOST}/api/vehicles`),
        fetch(`${API_HOST}/api/contracts`)
      ]);

      const vehData = resVeh.ok ? await resVeh.json() : [];
      const conData = resCon.ok ? await resCon.json() : [];

      setVehicles(vehData);
      setContracts(conData);
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

  const handleOpenDetail = async (vehicle) => {
    // Find active contract for this vehicle
    const activeContract = contracts.find(
      c => c.vehicle?._id === vehicle._id || c.vehicle === vehicle._id
    );
    
    setSelectedVehicle(vehicle);
    setSelectedContract(activeContract || null);
    setActiveTab('customer');

    if (activeContract) {
      // Fetch schedules for this contract
      try {
        const res = await fetch(`${API_HOST}/api/schedules?targetContract=${activeContract._id}`);
        if (res.ok) {
          const scheds = await res.json();
          setSelectedSchedules(scheds);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      setSelectedSchedules([]);
    }
  };

  const handleCloseDetail = () => {
    setSelectedVehicle(null);
    setSelectedContract(null);
    setSelectedSchedules([]);
  };

  // Helper: calculate remaining months/days
  const getRemainingTime = (endDateStr) => {
    if (!endDateStr) return '-';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDateStr);
    
    const diffTime = end.getTime() - today.getTime();
    if (diffTime < 0) return '종료됨';

    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const months = Math.floor(diffDays / 30.5);
    const days = Math.round(diffDays % 30.5);

    if (months > 0) {
      return `${months}개월 ${days}일 남음`;
    }
    return `${days}일 남음`;
  };

  // List processing: merge vehicles with their contract states
  const processedList = vehicles.map(vehicle => {
    const activeContract = contracts.find(
      c => c.vehicle?._id === vehicle._id || c.vehicle === vehicle._id
    );

    return {
      ...vehicle,
      customerName: activeContract?.customer?.name || '-',
      contractStatus: activeContract?.status || '계약 없음',
      contractEndDate: activeContract?.endDate || null,
      remainingTime: activeContract ? getRemainingTime(activeContract.endDate) : '-',
      manager: activeContract?.managerMain || '-',
      branch: activeContract?.branch || '-',
      activeContract: activeContract || null
    };
  });

  // Filter & Search application
  let filteredList = processedList.filter(item => {
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchCode = item.code.toLowerCase().includes(q);
      const matchModel = item.model.toLowerCase().includes(q);
      const matchCustomer = item.customerName.toLowerCase().includes(q);
      const matchPlate = item.plateNo?.toLowerCase().includes(q) || false;
      if (!matchCode && !matchModel && !matchCustomer && !matchPlate) return false;
    }

    // Model Filter
    if (filterModel !== '전체' && !item.model.toLowerCase().includes(filterModel.toLowerCase())) return false;

    // Branch Filter
    if (filterBranch !== '전체' && item.branch !== filterBranch) return false;

    // Manager Filter
    if (filterManager !== '전체' && item.manager !== filterManager) return false;

    // Status Filter
    if (filterStatus !== '전체') {
      if (filterStatus === '계약중' && item.contractStatus !== '진행중') return false;
      if (filterStatus === '미계약' && item.contractStatus !== '계약 없음') return false;
      if (filterStatus === '종료됨' && item.contractStatus !== '종료') return false;
    }

    return true;
  });

  // Sorting
  if (sortByExpiry) {
    filteredList.sort((a, b) => {
      if (!a.contractEndDate) return 1;
      if (!b.contractEndDate) return -1;
      return new Date(a.contractEndDate) - new Date(b.contractEndDate);
    });
  }

  // Get unique filter values
  const uniqueModels = Array.from(new Set(vehicles.map(v => v.model.split(' ')[0])));
  const uniqueBranches = Array.from(new Set(contracts.map(c => c.branch).filter(Boolean)));
  const uniqueManagers = Array.from(new Set(contracts.map(c => c.managerMain).filter(Boolean)));

  return (
    <div className="vehicle-list-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Filtering Row */}
      <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          
          {/* Search */}
          <div style={{ flex: 2, minWidth: '240px', position: 'relative' }}>
            <input 
              type="text" 
              placeholder="차량코드, 차종, 고객명, 차량번호 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.6rem 0.6rem 2.2rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
            />
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          </div>

          {/* Model Filter */}
          <div style={{ flex: 1, minWidth: '120px' }}>
            <select 
              value={filterModel}
              onChange={(e) => setFilterModel(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: '#fff' }}
            >
              <option value="전체">차종: 전체</option>
              {uniqueModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Branch Filter */}
          <div style={{ flex: 1, minWidth: '120px' }}>
            <select 
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: '#fff' }}
            >
              <option value="전체">지점: 전체</option>
              {uniqueBranches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {/* Manager Filter */}
          <div style={{ flex: 1, minWidth: '120px' }}>
            <select 
              value={filterManager}
              onChange={(e) => setFilterManager(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: '#fff' }}
            >
              <option value="전체">담당자: 전체</option>
              {uniqueManagers.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div style={{ flex: 1, minWidth: '120px' }}>
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: '#fff' }}
            >
              <option value="전체">계약상태: 전체</option>
              <option value="계약중">계약중</option>
              <option value="미계약">미계약</option>
              <option value="종료됨">종료됨</option>
            </select>
          </div>
        </div>

        {/* Sorting Toggles */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <SlidersHorizontal size={14} />
            <span>정렬 필터</span>
          </div>
          <button
            onClick={() => setSortByExpiry(!sortByExpiry)}
            style={{
              background: sortByExpiry ? 'rgba(255,98,0,0.1)' : '#fff',
              border: `1px solid ${sortByExpiry ? 'var(--primary)' : 'var(--border-color)'}`,
              color: sortByExpiry ? 'var(--primary)' : 'var(--text-main)',
              padding: '0.4rem 0.8rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            종료임박순 정렬 {sortByExpiry ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Vehicles DB Grid Table */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
              <th style={{ padding: '1rem' }}>차량코드</th>
              <th style={{ padding: '1rem' }}>차종</th>
              <th style={{ padding: '1rem' }}>차량번호</th>
              <th style={{ padding: '1rem' }}>고객명</th>
              <th style={{ padding: '1rem' }}>계약상태</th>
              <th style={{ padding: '1rem' }}>렌트종료일</th>
              <th style={{ padding: '1rem' }}>남은기간</th>
              <th style={{ padding: '1rem' }}>책임담당자</th>
              <th style={{ padding: '1rem', width: '80px' }}>상세</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>로딩 중...</td>
              </tr>
            ) : filteredList.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>검색 결과와 부합하는 차량이 존재하지 않습니다.</td>
              </tr>
            ) : (
              filteredList.map(item => {
                let statusBadge = { bg: '#e2e8f0', text: '#64748b' }; // 계약없음
                if (item.contractStatus === '진행중') {
                  statusBadge = { bg: '#dcfce7', text: '#16a34a' };
                } else if (item.contractStatus === '종료') {
                  statusBadge = { bg: '#fee2e2', text: '#ef4444' };
                }

                return (
                  <tr key={item._id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.2s' }} onClick={() => handleOpenDetail(item)} className="table-row-hover">
                    <td style={{ padding: '1rem', fontWeight: '600', color: 'var(--primary)' }}>{item.code}</td>
                    <td style={{ padding: '1rem', fontWeight: '500' }}>{item.model}</td>
                    <td style={{ padding: '1rem' }}>{item.plateNo || <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>미등록</span>}</td>
                    <td style={{ padding: '1rem' }}>{item.customerName}</td>
                    <td style={{ padding: '1rem' }}>
                      <span style={{ background: statusBadge.bg, color: statusBadge.text, padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600' }}>
                        {item.contractStatus}
                      </span>
                    </td>
                    <td style={{ padding: '1rem' }}>{item.contractEndDate ? new Date(item.contractEndDate).toLocaleDateString() : '-'}</td>
                    <td style={{ padding: '1rem', color: item.remainingTime.includes('남음') ? 'var(--primary)' : 'inherit', fontWeight: item.remainingTime.includes('남음') ? '600' : 'normal' }}>{item.remainingTime}</td>
                    <td style={{ padding: '1rem' }}>{item.manager}</td>
                    <td style={{ padding: '1rem' }}>
                      <button 
                        type="button" 
                        style={{ border: 'none', background: 'var(--bg-main)', color: 'var(--text-main)', padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        보기
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Modal (Tabs: Customer / Pricing / Schedule) */}
      {selectedVehicle && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: '16px', maxWidth: '640px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
            
            {/* Header */}
            <div style={{ background: 'var(--bg-main)', padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ background: 'var(--primary-glow)', color: 'var(--primary)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700', marginRight: '0.5rem' }}>
                  {selectedVehicle.code}
                </span>
                <h4 style={{ display: 'inline-block', fontSize: '1.2rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                  {selectedVehicle.model} ({selectedVehicle.plateNo || '번호판 미지정'})
                </h4>
              </div>
              <button onClick={handleCloseDetail} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: '#fff' }}>
              <button 
                onClick={() => setActiveTab('customer')}
                style={{ flex: 1, padding: '1rem', border: 'none', background: 'none', borderBottom: activeTab === 'customer' ? '3px solid var(--primary)' : 'none', color: activeTab === 'customer' ? 'var(--primary)' : 'var(--text-main)', fontWeight: activeTab === 'customer' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                <User size={16} /> 고객정보
              </button>
              <button 
                onClick={() => setActiveTab('pricing')}
                style={{ flex: 1, padding: '1rem', border: 'none', background: 'none', borderBottom: activeTab === 'pricing' ? '3px solid var(--primary)' : 'none', color: activeTab === 'pricing' ? 'var(--primary)' : 'var(--text-main)', fontWeight: activeTab === 'pricing' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                <DollarSign size={16} /> 계약/금액 정보
              </button>
              <button 
                onClick={() => setActiveTab('schedule')}
                style={{ flex: 1, padding: '1rem', border: 'none', background: 'none', borderBottom: activeTab === 'schedule' ? '3px solid var(--primary)' : 'none', color: activeTab === 'schedule' ? 'var(--primary)' : 'var(--text-main)', fontWeight: activeTab === 'schedule' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                <Calendar size={16} /> 차량일정
              </button>
            </div>

            {/* Tab Body Content */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              
              {/* Tab 1: Customer */}
              {activeTab === 'customer' && (
                selectedContract?.customer ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <h5 style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--text-bright)' }}>고객 인적사항</h5>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', fontSize: '0.85rem' }}>
                      <div><strong style={{ color: 'var(--text-muted)' }}>개인/법인명:</strong> {selectedContract.customer.name}</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>사업자/주민번호:</strong> {selectedContract.customer.bizNo}</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>대표자명:</strong> {selectedContract.customer.ceoName || '-'}</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>이메일:</strong> {selectedContract.customer.email || '-'}</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>담당자/연락처:</strong> {selectedContract.customer.contactName || '-'} / {selectedContract.customer.contactPhone || '-'}</div>
                      <div style={{ gridColumn: 'span 2' }}><strong style={{ color: 'var(--text-muted)' }}>주소:</strong> {selectedContract.customer.address || '-'}</div>
                    </div>
                    
                    <h5 style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--text-bright)', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>자동이체 계좌정보</h5>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', fontSize: '0.85rem' }}>
                      <div><strong style={{ color: 'var(--text-muted)' }}>은행명:</strong> {selectedContract.customer.bank?.name || '-'}</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>계좌번호:</strong> {selectedContract.customer.bank?.account || '-'}</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>예금주:</strong> {selectedContract.customer.bank?.holder || '-'}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', color: 'var(--text-muted)', gap: '0.5rem' }}>
                    <Info size={28} />
                    <span>현재 연계된 계약 고객 정보가 존재하지 않습니다.</span>
                  </div>
                )
              )}

              {/* Tab 2: Pricing */}
              {activeTab === 'pricing' && (
                selectedContract ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <h5 style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--text-bright)' }}>렌트 상세 금액</h5>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', fontSize: '0.85rem' }}>
                      <div><strong style={{ color: 'var(--text-muted)' }}>기본가격:</strong> {selectedContract.pricing?.basePrice?.toLocaleString() || '-'} 원</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>할인금액:</strong> {selectedContract.pricing?.discount?.toLocaleString() || '-'} 원</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>공급가액:</strong> {selectedContract.pricing?.supplyPrice?.toLocaleString() || '-'} 원</div>
                      <div><strong style={{ color: 'var(--text-bright)' }}>월 대여료:</strong> <span style={{ fontWeight: '700', color: 'var(--primary)' }}>{selectedContract.pricing?.monthlyFee?.toLocaleString() || '-'}</span> 원</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>보증금/선수금:</strong> {selectedContract.pricing?.deposit?.toLocaleString() || '0'} 원 / {selectedContract.pricing?.advancePayment?.toLocaleString() || '0'} 원</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>인수가:</strong> {selectedContract.pricing?.takeoverPrice?.toLocaleString() || '-'} 원</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>계산서발행일:</strong> 매월 {selectedContract.pricing?.invoiceDay || '-'} 일</div>
                      <div><strong style={{ color: 'var(--text-muted)' }}>대여료결제일:</strong> 매월 {selectedContract.pricing?.billingDay || '-'} 일</div>
                    </div>

                    <h5 style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--text-bright)', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>지급된 사은품 (GIFT)</h5>
                    {selectedContract.gifts && selectedContract.gifts.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        {selectedContract.gifts.map((g, i) => (
                          <div key={i} style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', background: 'var(--bg-main)', padding: '0.5rem', borderRadius: '4px' }}>
                            <span>{g.name}</span>
                            <span style={{ fontWeight: '600' }}>{g.price?.toLocaleString()}원</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>지급된 사은품 내역이 없습니다.</span>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', color: 'var(--text-muted)', gap: '0.5rem' }}>
                    <Info size={28} />
                    <span>현재 연계된 계약서가 없습니다.</span>
                  </div>
                )
              )}

              {/* Tab 3: Schedules */}
              {activeTab === 'schedule' && (
                selectedSchedules.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <h5 style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--text-bright)', marginBottom: '0.5rem' }}>차량 관리 일정 리스트</h5>
                    {selectedSchedules.map(sched => {
                      let typeColor = '#f59e0b';
                      if (sched.type === '차량검사') typeColor = '#3b82f6';
                      if (sched.type === '렌트만료') typeColor = '#ef4444';
                      if (sched.type === '청구서발송') typeColor = '#10b981';

                      return (
                        <div key={sched._id} style={{ display: 'flex', justifyStyle: 'center', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem', background: 'var(--bg-main)', borderRadius: '6px', borderLeft: `4px solid ${typeColor}` }}>
                          <div>
                            <span style={{ fontSize: '0.8rem', fontWeight: '700', color: typeColor, marginRight: '0.5rem' }}>[{sched.type}]</span>
                            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>예정일: {new Date(sched.dueDate).toLocaleDateString()}</span>
                          </div>
                          <span style={{ 
                            fontSize: '0.75rem', 
                            padding: '0.2rem 0.4rem', 
                            borderRadius: '4px', 
                            background: sched.status === '완료' ? '#dcfce7' : '#fef3c7', 
                            color: sched.status === '완료' ? '#16a34a' : '#d97706',
                            fontWeight: '600'
                          }}>
                            {sched.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', color: 'var(--text-muted)', gap: '0.5rem' }}>
                    <Info size={28} />
                    <span>등록된 점검 및 예정 일정이 없습니다.</span>
                  </div>
                )
              )}

            </div>

            {/* Footer */}
            <div style={{ background: 'var(--bg-main)', padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={handleCloseDetail} style={{ background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.5rem 1.2rem', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}>
                닫기
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default VehicleListView;
