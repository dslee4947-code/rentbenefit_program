import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Car,
  FileText,
  Users,
  Calendar,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Bell,
  Clock,
  ArrowRight,
  AlertTriangle,
  Truck
} from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const DEFAULT_STATS = {
  vehiclesCount: 0,
  customersCount: 0,
  contractsCount: 0,
  schedulesCount: 0
};

const fetchDashboardSummary = async () => {
  const res = await fetch(`${API_HOST}/api/dashboard/summary`);
  if (!res.ok) {
    throw new Error('대시보드 데이터를 불러오는데 실패했습니다. (서버 연결을 확인하세요)');
  }
  return res.json();
};

/**
 * 청구가 시작되지 않은 계약.
 *
 * 출고 준비를 저장하지 않으면 회차표가 없고, 회차표가 없으면 청구 대상 목록에 뜨지 않는다.
 * 계약 등록 화면은 이걸 막지 않으므로, 대시보드에서 잡아 주지 않으면 아무도 모른다.
 */
const fetchBillingGaps = async () => {
  const res = await fetch(`${API_HOST}/api/dashboard/billing-gaps`);
  if (!res.ok) throw new Error('청구 누락 계약을 불러오지 못했습니다.');
  return res.json();
};

const won = (n) => `${Number(n || 0).toLocaleString()}원`;

function DashboardView({ setActiveTab, showToast }) {
  const queryClient = useQueryClient();

  // staleTime keeps cached data visible instantly on re-entry, while a
  // background refetch quietly brings it up to date.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: fetchDashboardSummary,
    staleTime: 30 * 1000
  });

  // 이 목록은 대개 비어 있다. 비었을 때는 화면에 아무것도 그리지 않으므로,
  // 실패해도 토스트를 띄우지 않는다(대시보드를 열 때마다 경고가 뜨면 본문을 가린다).
  const { data: gapData } = useQuery({
    queryKey: ['dashboard-billing-gaps'],
    queryFn: fetchBillingGaps,
    staleTime: 60 * 1000
  });
  const gaps = gapData?.items || [];

  React.useEffect(() => {
    if (isError) {
      showToast('대시보드 데이터를 불러오는데 실패했습니다. (서버 연결을 확인하세요)', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError]);

  const stats = data?.stats || DEFAULT_STATS;
  const notifications = data?.notifications || [];
  const loading = isLoading && !data;

  const handleCompleteSchedule = async (scheduleId) => {
    try {
      const response = await fetch(`${API_HOST}/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: '완료' })
      });
      if (response.ok) {
        showToast('일정이 완료 처리되었습니다.', 'success');
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      } else {
        showToast('일정 상태 수정 실패', 'error');
      }
    } catch (err) {
      showToast('서버 연결 오류', 'error');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', color: 'var(--text-muted)' }}>
        <Clock className="animate-spin" style={{ marginRight: '8px' }} />
        <span>대시보드 데이터를 로딩 중입니다...</span>
      </div>
    );
  }

  return (
    <div className="dashboard-view-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* 4 Core Summary Cards */}
      <div className="stats-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', width: '100%' }}>
        {/* Card 1: Vehicles */}
        <div className="stat-main-card" style={{ background: 'var(--bg-surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: '500' }}>등록 차량 DB</span>
            <Car size={20} style={{ color: 'var(--primary)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-bright)' }}>{stats.vehiclesCount}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>대</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', marginTop: '0.3rem', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setActiveTab('vehicles')}>
            <span>차량 목록 바로가기</span>
            <ChevronRight size={14} />
          </div>
        </div>

        {/* Card 2: Customers */}
        <div className="stat-main-card" style={{ background: 'var(--bg-surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: '500' }}>관리 고객 수</span>
            <Users size={20} style={{ color: '#8b5cf6' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-bright)' }}>{stats.customersCount}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>명</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', marginTop: '0.3rem', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setActiveTab('customers')}>
            <span>고객 DB 관리 바로가기</span>
            <ChevronRight size={14} />
          </div>
        </div>

        {/* Card 3: Active Contracts */}
        <div className="stat-main-card" style={{ background: 'var(--bg-surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: '500' }}>진행중인 계약</span>
            <FileText size={20} style={{ color: '#10b981' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-bright)' }}>{stats.contractsCount}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>건</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', marginTop: '0.3rem', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setActiveTab('contract-register')}>
            <span>계약서 목록 바로가기</span>
            <ChevronRight size={14} />
          </div>
        </div>

        {/* Card 4: Upcoming Schedules */}
        <div className="stat-main-card" style={{ background: 'var(--bg-surface)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: '500' }}>예정된 일정</span>
            <Calendar size={20} style={{ color: '#f59e0b' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-bright)' }}>{stats.schedulesCount}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>건</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', marginTop: '0.3rem', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setActiveTab('calendar')}>
            <span>캘린더 화면 바로가기</span>
            <ChevronRight size={14} />
          </div>
        </div>
      </div>

      {/* 청구가 시작되지 않은 계약 - 있을 때만 보여 준다 */}
      {gaps.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '12px', padding: '1.5rem', boxShadow: 'var(--shadow-premium)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <AlertTriangle size={22} style={{ color: '#b45309', flexShrink: 0, marginTop: '0.1rem' }} />
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#92400e', margin: 0 }}>
                  청구가 시작되지 않은 계약 {gapData.count}건
                </h3>
                <p style={{ color: '#b45309', fontSize: '0.85rem', margin: '0.25rem 0 0', lineHeight: 1.55 }}>
                  회차표가 없어 청구 대상 목록에 뜨지 않습니다. 이대로 두면 매달 렌트료가 청구되지 않습니다.
                </p>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: '600' }}>매달 빠지는 금액</div>
              <div style={{ fontSize: '1.4rem', fontWeight: '700', color: '#b45309' }}>{won(gapData.monthlyLoss)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {gaps.map((it) => (
              <div
                key={it._id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: '1rem', flexWrap: 'wrap',
                  background: '#fff', border: '1px solid #fde68a',
                  borderRadius: '8px', padding: '0.9rem 1.1rem'
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: '600', color: 'var(--text-bright)', fontSize: '0.95rem' }}>
                    {it.partyName}
                    <span style={{ color: 'var(--text-muted)', fontWeight: '400', fontSize: '0.85rem' }}>
                      {' '}· {it.contractNo}
                      {it.carModel ? ` · ${it.carModel}` : ''}
                      {it.plateNo ? ` (${it.plateNo})` : ''}
                    </span>
                  </div>
                  <div style={{ color: '#b45309', fontSize: '0.83rem', marginTop: '0.25rem', lineHeight: 1.5 }}>
                    {it.reason}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.2rem' }}>
                    계약일 {it.contractDate ? new Date(it.contractDate).toLocaleDateString() : '-'}
                    {it.termMonths ? ` · ${it.termMonths}개월` : ''}
                    {it.monthlyFee ? ` · 월 ${won(it.monthlyFee)}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('delivery-prep')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    background: '#b45309', color: '#fff', border: 'none',
                    padding: '0.5rem 0.9rem', borderRadius: '6px',
                    fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <Truck size={15} /> 출고 준비에서 입력
                </button>
              </div>
            ))}
          </div>

          {gapData.noBillingNeededCount > 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.8rem', marginBottom: 0 }}>
              이 밖에 월 렌트료가 0원이라 청구가 필요 없는 계약이 {gapData.noBillingNeededCount}건 있습니다(완납 등 정상 상태라 위 목록에서 뺐습니다).
            </p>
          )}

          {gapData.truncated && (
            <p style={{ color: '#b45309', fontSize: '0.78rem', marginTop: '0.5rem', marginBottom: 0 }}>
              최근 계약 {gapData.scanned}건까지만 확인했습니다. 처리한 뒤 다시 열면 그 앞의 계약도 확인합니다.
            </p>
          )}
        </div>
      )}

      {/* Quick Action Link Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
        {/* Quote Link */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #fff 0%, #fff7f2 100%)', border: '1px solid #ffe5d4', padding: '1.5rem', borderRadius: '12px', cursor: 'pointer', transition: 'transform 0.2s', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }} onClick={() => setActiveTab('quote-input')} className="quick-action-card">
          <div>
            <h4 style={{ color: 'var(--text-bright)', fontSize: '1.05rem', fontWeight: '600', marginBottom: '0.3rem' }}>신규 견적서 작성</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>상담 내용 기록 및 월 렌트료 비교표 생성</p>
          </div>
          <div style={{ width: '40px', height: '40px', background: 'var(--primary)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', color: '#fff' }}>
            <ArrowRight size={18} />
          </div>
        </div>

        {/* Contract Link */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #fff 0%, #f0fdf4 100%)', border: '1px solid #d1fae5', padding: '1.5rem', borderRadius: '12px', cursor: 'pointer', transition: 'transform 0.2s', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }} onClick={() => setActiveTab('contract-register')} className="quick-action-card">
          <div>
            <h4 style={{ color: 'var(--text-bright)', fontSize: '1.05rem', fontWeight: '600', marginBottom: '0.3rem' }}>신규 계약서 등록</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>견적 정보 자동 연동 및 일정 자동 생성</p>
          </div>
          <div style={{ width: '40px', height: '40px', background: '#10b981', borderRadius: '50%', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', color: '#fff' }}>
            <ArrowRight size={18} />
          </div>
        </div>
      </div>

      {/* Urgent Schedules (D-7, D-1) Alert Panel */}
      <div style={{ background: 'var(--bg-surface)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Bell size={20} style={{ color: 'var(--primary)' }} />
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--text-bright)' }}>임박 일정 알림 (D-7 ~ D-1)</h3>
          </div>
          <span style={{ background: 'rgba(255,98,0,0.1)', color: 'var(--primary)', padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '600' }}>
            대기중 {notifications.length}건
          </span>
        </div>

        {notifications.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', gap: '0.8rem', color: 'var(--text-muted)' }}>
            <CheckCircle2 size={36} style={{ color: '#10b981' }} />
            <span style={{ fontSize: '0.95rem', fontWeight: '600' }}>현재 7일 이내의 임박 일정이 없습니다.</span>
            <span style={{ fontSize: '0.8rem' }}>정기점검, 검사 및 렌트 만료 일정이 안전하게 관리되고 있습니다.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {notifications.map(item => {
              let badgeColor = '#ef4444'; // default red
              let dDayText = `D-${item.dDay}`;
              if (item.dDay <= 0) {
                dDayText = 'D-Day';
              }

              // Color coordinate schedule types
              let typeColor = '#f59e0b'; // maintenance - yellow
              if (item.type === '차량검사') typeColor = '#3b82f6'; // blue
              if (item.type === '렌트만료') typeColor = '#ef4444'; // red
              if (item.type === '청구서발송') typeColor = '#10b981'; // green

              return (
                <div 
                  key={item._id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1.2rem',
                    background: 'var(--bg-main)',
                    borderRadius: '8px',
                    borderLeft: `5px solid ${typeColor}`,
                    transition: 'var(--transition-smooth)'
                  }}
                  className="notification-item"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {/* D-Day badge */}
                    <span style={{
                      background: item.dDay === 1 || item.dDay === 0 ? '#ef4444' : '#f97316',
                      color: '#fff',
                      padding: '0.3rem 0.6rem',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      fontWeight: '700'
                    }}>
                      {dDayText}
                    </span>

                    {/* Schedule type badge */}
                    <span style={{
                      background: 'rgba(255,255,255,0.7)',
                      border: `1px solid ${typeColor}`,
                      color: typeColor,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: '600'
                    }}>
                      {item.type}
                    </span>

                    {/* Details */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontWeight: '600', color: 'var(--text-bright)', fontSize: '0.95rem' }}>
                        {item.targetVehicle?.model} ({item.targetVehicle?.code}) - {item.targetContract?.customer?.name || '고객 정보 없음'}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        예정일: {new Date(item.dueDate).toLocaleDateString()} | 차량번호: {item.targetVehicle?.plateNo || '번호판 등록 전'} | 담당자: {item.assignee || '미정'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <button 
                    onClick={() => handleCompleteSchedule(item._id)}
                    style={{
                      background: '#fff',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-main)',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    className="complete-btn"
                  >
                    완료 처리
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

export default DashboardView;
