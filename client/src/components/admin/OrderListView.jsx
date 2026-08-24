import React, { useState, useEffect } from 'react';
import { Calendar, Phone, User, FileText, Clock, Trash2, ShieldCheck, CreditCard, Search, ChevronDown, ChevronUp, Mail, Info } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);
const API_ORDERS_URL = `${API_HOST}/api/orders`;

function OrderListView({ showToast }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  
  // Row Expansion State
  const [expandedOrders, setExpandedOrders] = useState({});

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const response = await fetch(API_ORDERS_URL);
      if (response.ok) {
        const data = await response.json();
        setOrders(data);
      } else {
        throw new Error('주문 목록을 불러오지 못했습니다.');
      }
    } catch (error) {
      console.error(error);
      showToast('서버에서 주문 목록을 가져오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleStatusChange = async (orderId, newStatus) => {
    try {
      const response = await fetch(`${API_ORDERS_URL}/${orderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        showToast('주문 상태가 업데이트되었습니다.', 'success');
        fetchOrders();
      } else {
        throw new Error('주문 상태 수정 실패');
      }
    } catch (error) {
      console.error(error);
      showToast('주문 상태 변경에 실패했습니다.', 'error');
    }
  };

  const handleDeleteOrder = async (orderId) => {
    if (!window.confirm('정말로 이 주문 데이터를 삭제하시겠습니까?')) return;

    try {
      const response = await fetch(`${API_ORDERS_URL}/${orderId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        showToast('주문이 삭제되었습니다.', 'success');
        fetchOrders();
      } else {
        throw new Error('주문 삭제 실패');
      }
    } catch (error) {
      console.error(error);
      showToast('주문 삭제에 실패했습니다.', 'error');
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'pending': return 'badge-pending';
      case 'confirmed': return 'badge-confirmed';
      case 'active': return 'badge-active';
      case 'completed': return 'badge-completed';
      case 'cancelled': return 'badge-cancelled';
      default: return '';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'pending': return '상담 대기';
      case 'confirmed': return '주문 확정';
      case 'active': return '이용 중';
      case 'completed': return '완료';
      case 'cancelled': return '취소됨';
      default: return status;
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  // Compile unique lists of users and vehicles from loaded orders for filters
  const uniqueUsers = Array.from(
    new Map(
      orders
        .filter(o => o.user)
        .map(o => [o.user._id, { id: o.user._id, name: o.user.name, email: o.user.email }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const uniqueVehicles = Array.from(
    new Map(
      orders
        .filter(o => o.vehicle)
        .map(o => [o.vehicle._id, { id: o.vehicle._id, vehicleName: o.vehicle.vehicleName, vehicleNumber: o.vehicle.vehicleNumber }])
    ).values()
  ).sort((a, b) => a.vehicleName.localeCompare(b.vehicleName));

  // Multi-Filter & Search Logic
  const filteredOrders = orders.filter((order) => {
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    const matchesUser = userFilter === 'all' || order.user?._id === userFilter;
    const matchesVehicle = vehicleFilter === 'all' || order.vehicle?._id === vehicleFilter;
    
    const matchesSearch = 
      (order.user?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.user?.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.deliveryAddress?.recipient || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.deliveryAddress?.phone || '').includes(searchTerm) ||
      (order.vehicle?.vehicleName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order._id || '').includes(searchTerm);
      
    return matchesStatus && matchesUser && matchesVehicle && matchesSearch;
  });

  const toggleOrderExpand = (orderId) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  const expandAllOrders = () => {
    const allExp = {};
    filteredOrders.forEach(o => {
      allExp[o._id] = true;
    });
    setExpandedOrders(allExp);
  };

  const collapseAllOrders = () => {
    setExpandedOrders({});
  };

  return (
    <div className="order-list-view fade-in">
      {/* 검색 및 필터 헤더 */}
      <div className="order-filter-bar flex-wrap">
        <div className="search-wrap">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="주문자명, 차량명, 연락처, 주문 ID 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="filters-grid">
          {/* 상태 필터 */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="status-filter-select"
          >
            <option value="all">전체 상태</option>
            <option value="pending">상담 대기 (Pending)</option>
            <option value="confirmed">주문 확정 (Confirmed)</option>
            <option value="active">이용 중 (Active)</option>
            <option value="completed">완료 (Completed)</option>
            <option value="cancelled">취소됨 (Cancelled)</option>
          </select>

          {/* 사용자별 필터 */}
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="status-filter-select"
          >
            <option value="all">전체 사용자 ({uniqueUsers.length}명)</option>
            {uniqueUsers.map(user => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.email})
              </option>
            ))}
          </select>

          {/* 상품별 필터 */}
          <select
            value={vehicleFilter}
            onChange={(e) => setVehicleFilter(e.target.value)}
            className="status-filter-select"
          >
            <option value="all">전체 상품 ({uniqueVehicles.length}종)</option>
            {uniqueVehicles.map(veh => (
              <option key={veh.id} value={veh.id}>
                {veh.vehicleName} {veh.vehicleNumber ? `(${veh.vehicleNumber})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 펼치기/접기 일괄 제어 및 간략 통계 */}
      {!loading && filteredOrders.length > 0 && (
        <div className="order-list-controls">
          <span className="total-stats-text">
            검색 결과: 총 <strong>{filteredOrders.length}</strong>건의 주문 내역 (최신 등록순)
          </span>
          <div className="control-buttons">
            <button onClick={expandAllOrders} className="control-btn">
              <ChevronDown size={14} /> 전체 상세 열기
            </button>
            <button onClick={collapseAllOrders} className="control-btn secondary">
              <ChevronUp size={14} /> 전체 상세 닫기
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-spinner-wrap">
          <div className="checkout-spinner" />
          <p>주문 데이터를 불러오는 중입니다...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="empty-orders-box">
          <FileText size={48} />
          <p>검색 조건에 일치하는 주문 내역이 없습니다.</p>
        </div>
      ) : (
        <div className="order-table-container fade-in">
          <table className="order-table single-master-table">
            <thead>
              <tr>
                <th className="text-center" style={{ width: '70px' }}>상세</th>
                <th style={{ width: '120px' }}>주문 번호 & 일시</th>
                <th>주문자 정보</th>
                <th>구분 & 차량명</th>
                <th className="hide-on-mobile" style={{ width: '100px' }}>차량번호</th>
                <th className="hide-on-mobile">이용 기간</th>
                <th>예상 요금</th>
                <th>결제 수단 & 상태</th>
                <th>진행 상태</th>
                <th style={{ width: '90px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const isExpanded = !!expandedOrders[order._id];
                return (
                  <React.Fragment key={order._id}>
                    <tr className={`main-order-row ${isExpanded ? 'row-expanded' : ''}`}>
                      {/* 상세 토글 버튼 */}
                      <td className="text-center">
                        <button 
                          onClick={() => toggleOrderExpand(order._id)}
                          className={`row-detail-toggle-btn ${isExpanded ? 'active' : ''}`}
                          title="배송 주소 및 추가 요청사항 보기"
                        >
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          <span>{isExpanded ? '닫기' : '상세'}</span>
                        </button>
                      </td>

                      {/* 주문 ID & 일시 */}
                      <td>
                        <div className="order-id-cell">
                          <span className="order-id-code" title={order._id}>
                            #{order._id.substring(12)}
                          </span>
                          <span className="order-time-text">
                            {formatDate(order.createdAt)}
                          </span>
                        </div>
                      </td>

                      {/* 주문자 정보 */}
                      <td>
                        <div className="order-user-info-cell">
                          <strong className="user-name-text">{order.user?.name || '비회원'}</strong>
                          <span className="user-email-text">{order.user?.email || '이메일 없음'}</span>
                          {order.deliveryAddress?.phone && (
                            <span className="user-phone-text">{order.deliveryAddress.phone}</span>
                          )}
                        </div>
                      </td>

                      {/* 구분 및 차량명 */}
                      <td>
                        <div className="vehicle-cell">
                          <span className={`v-type-tag ${
                            order.orderType === '장기렌트' ? 'tag-long' : 
                            order.orderType === '단기렌트' ? 'tag-short' : 'tag-used'
                          }`}>
                            {order.orderType}
                          </span>
                          <strong className="vehicle-name-text">
                            {order.vehicle?.vehicleName || '삭제된 차량'}
                          </strong>
                        </div>
                      </td>

                      {/* 차량번호 */}
                      <td className="hide-on-mobile">
                        <span className="vehicle-number-text">
                          {order.vehicle?.vehicleNumber || '-'}
                        </span>
                      </td>

                      {/* 희망 이용기간 */}
                      <td className="hide-on-mobile">
                        {order.rentalPeriod?.startDate ? (
                          <div className="period-cell">
                            <span>
                              {formatDate(order.rentalPeriod.startDate).split(' ')[0]} ~ {formatDate(order.rentalPeriod.endDate).split(' ')[0]}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>

                      {/* 예상 요금 */}
                      <td>
                        <div className="price-cell">
                          <strong>{order.pricing?.totalAmount?.toLocaleString()}원</strong>
                          {order.orderType !== '중고차매물' && <span className="unit-label">/월</span>}
                        </div>
                      </td>

                      {/* 결제 내역 */}
                      <td>
                        <div className="payment-cell">
                          <span className="pay-method">{order.payment?.method || '미지정'}</span>
                          <span className={`pay-status-badge ${order.payment?.isPaid ? 'paid' : 'unpaid'}`}>
                            {order.payment?.isPaid ? '결제완료' : '미결제'}
                          </span>
                        </div>
                      </td>

                      {/* 주문 상태 및 변경 */}
                      <td>
                        <div className="status-selector-cell">
                          <span className={`status-badge ${getStatusBadgeClass(order.status)}`}>
                            {getStatusLabel(order.status)}
                          </span>
                          <select
                            value={order.status}
                            onChange={(e) => handleStatusChange(order._id, e.target.value)}
                            className="table-status-select"
                          >
                            <option value="pending">상담 대기</option>
                            <option value="confirmed">주문 확정</option>
                            <option value="active">이용 중</option>
                            <option value="completed">완료</option>
                            <option value="cancelled">취소 처리</option>
                          </select>
                        </div>
                      </td>

                      {/* 주문 삭제 */}
                      <td>
                        <button
                          className="table-delete-btn"
                          onClick={() => handleDeleteOrder(order._id)}
                          title="주문 데이터 삭제"
                        >
                          <Trash2 size={13} />
                          <span>삭제</span>
                        </button>
                      </td>
                    </tr>

                    {/* 확장 상세 패널 행 */}
                    {isExpanded && (
                      <tr className="order-details-expanded-row">
                        <td colSpan="10">
                          <div className="expanded-row-inner-panel fade-in">
                            {/* 1. 수령 정보 */}
                            <div className="detail-panel-section">
                              <h5 className="panel-sub-title">
                                <Info size={13} /> 배송 및 수령 정보
                              </h5>
                              <div className="panel-info-grid">
                                <div className="panel-info-item">
                                  <strong>수령인:</strong>
                                  <span>{order.deliveryAddress?.recipient || order.user?.name || '-'}</span>
                                </div>
                                <div className="panel-info-item">
                                  <strong>연락처:</strong>
                                  <span>{order.deliveryAddress?.phone || '-'}</span>
                                </div>
                                <div className="panel-info-item full-width">
                                  <strong>인도 주소:</strong>
                                  <span>
                                    {order.deliveryAddress?.address || '주소 없음'} {order.deliveryAddress?.detailAddr || ''} 
                                    {order.deliveryAddress?.zipCode ? ` (우편번호: ${order.deliveryAddress.zipCode})` : ''}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* 2. 요청사항 */}
                            <div className="detail-panel-section">
                              <h5 className="panel-sub-title">
                                <FileText size={13} /> 고객 추가 요청사항 (메모)
                              </h5>
                              <div className="panel-memo-box">
                                {order.memo ? (
                                  <em>"{order.memo}"</em>
                                ) : (
                                  <span className="no-memo">고객이 작성한 메모가 없습니다.</span>
                                )}
                              </div>
                            </div>

                            {/* 3. 결제 트랜잭션 정보 */}
                            <div className="detail-panel-section">
                              <h5 className="panel-sub-title">
                                <ShieldCheck size={13} /> 결제 API 연동 식별값
                              </h5>
                              <div className="panel-payment-ids">
                                <p><strong>포트원 거래고유번호 (Imp Uid):</strong> <code>{order.payment?.impUid || '미연동 (무통장/현장결제)'}</code></p>
                                <p><strong>가맹점 관리번호 (Merchant Uid):</strong> <code>{order.payment?.merchantUid || '없음'}</code></p>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default OrderListView;
