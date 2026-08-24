import React, { useState, useEffect } from 'react';
import { Calendar, Phone, MapPin, User, FileText, CheckCircle, Clock, XCircle, CreditCard, ShoppingBag, ChevronDown, ChevronUp, Info } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);
const API_ORDERS_URL = `${API_HOST}/api/orders`;

function MyOrdersView({ currentUser, showToast, setView, onOrderCancelled }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrders, setExpandedOrders] = useState({});

  const fetchMyOrders = async () => {
    if (!currentUser?._id) return;
    try {
      setLoading(true);
      const response = await fetch(`${API_ORDERS_URL}/user/${currentUser._id}`);
      if (response.ok) {
        const data = await response.json();
        setOrders(data);
      } else {
        throw new Error('내 주문 내역을 불러오지 못했습니다.');
      }
    } catch (error) {
      console.error(error);
      showToast('주문 내역을 불러오는 과정에서 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyOrders();
  }, [currentUser]);

  const handleCancelOrder = async (orderId) => {
    if (!window.confirm('상담 대기 중인 주문을 취소하시겠습니까?')) return;

    try {
      const response = await fetch(`${API_ORDERS_URL}/${orderId}/cancel`, {
        method: 'PUT',
      });

      if (response.ok) {
        showToast('주문 취소 요청이 완료되었습니다.', 'success');
        fetchMyOrders();
        if (onOrderCancelled) {
          onOrderCancelled();
        }
      } else {
        throw new Error('주문 취소 실패');
      }
    } catch (error) {
      console.error(error);
      showToast('주문 취소에 실패했습니다. 고객센터로 문의 바랍니다.', 'error');
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

  const toggleOrderExpand = (orderId) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  const expandAllOrders = () => {
    const allExp = {};
    orders.forEach(o => {
      allExp[o._id] = true;
    });
    setExpandedOrders(allExp);
  };

  const collapseAllOrders = () => {
    setExpandedOrders({});
  };

  return (
    <div className="my-orders-view-container fade-in" style={{ padding: '2rem 1rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="dashboard-title-box" style={{ marginBottom: '2.2rem', borderBottom: '2px solid var(--border-color)', paddingBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <ShoppingBag style={{ color: 'var(--primary)' }} />
          <span>내 주문 / 견적 내역</span>
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.4rem' }}>
          고객님께서 신청하신 차량 견적 및 주문 목록입니다. 전문 카매니저가 검토 후 신속히 연락드리겠습니다.
        </p>
      </div>

      {loading ? (
        <div className="loading-spinner-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '5rem 0' }}>
          <div className="checkout-spinner" />
          <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>주문 내역을 조회하는 중입니다...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-orders-box" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6rem 2rem', background: '#ffffff', border: '1px dashed var(--border-color)', borderRadius: '16px', color: '#94a3b8' }}>
          <ShoppingBag size={48} />
          <p style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '1rem' }}>아직 신청하신 주문/견적 내역이 없습니다.</p>
          <button 
            className="checkout-primary-btn" 
            style={{ width: 'auto', marginTop: '1.5rem', padding: '0.8rem 1.5rem' }}
            onClick={() => setView('main')}
          >
            차량 보러가기
          </button>
        </div>
      ) : (
        <>
          {/* 일괄 펼침 제어판 */}
          <div className="order-list-controls" style={{ marginBottom: '1.2rem' }}>
            <span className="total-stats-text">
              전체 내역: 총 <strong>{orders.length}</strong>건의 신청 정보가 존재합니다.
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

          {/* 내 주문 테이블 */}
          <div className="order-table-container fade-in">
            <table className="order-table single-master-table">
              <thead>
                <tr>
                  <th className="text-center" style={{ width: '70px' }}>상세</th>
                  <th>상담 번호 & 신청일시</th>
                  <th>구분 & 신청 차량</th>
                  <th className="hide-on-mobile">차량 번호</th>
                  <th className="hide-on-mobile">희망 이용 기간</th>
                  <th>예상 요금</th>
                  <th>결제 수단 & 상태</th>
                  <th>진행 상태</th>
                  <th style={{ width: '120px' }}>상담 취소</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const isExpanded = !!expandedOrders[order._id];
                  return (
                    <React.Fragment key={order._id}>
                      <tr className={`main-order-row ${isExpanded ? 'row-expanded' : ''}`}>
                        {/* 상세 정보 토글 */}
                        <td className="text-center">
                          <button 
                            onClick={() => toggleOrderExpand(order._id)}
                            className={`row-detail-toggle-btn ${isExpanded ? 'active' : ''}`}
                            title="상세 수령인 및 인도지 주소 보기"
                          >
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            <span>{isExpanded ? '닫기' : '상세'}</span>
                          </button>
                        </td>

                        {/* 상담 번호 & 일시 */}
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

                        {/* 구분 & 신청 차량 */}
                        <td>
                          <div className="vehicle-cell">
                            <span className={`v-type-tag ${
                              order.orderType === '장기렌트' ? 'tag-long' : 
                              order.orderType === '단기렌트' ? 'tag-short' : 'tag-used'
                            }`}>
                              {order.orderType}
                            </span>
                            <strong className="vehicle-name-text">
                              {order.vehicle?.vehicleName || '차량 정보 없음'}
                            </strong>
                          </div>
                        </td>

                        {/* 차량 번호 */}
                        <td className="hide-on-mobile">
                          <span className="vehicle-number-text">
                            {order.vehicle?.vehicleNumber || '-'}
                          </span>
                        </td>

                        {/* 희망 이용 기간 */}
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

                        {/* 결제 수단 & 상태 */}
                        <td>
                          <div className="payment-cell">
                            <span className="pay-method">{order.payment?.method || '미지정'}</span>
                            <span className={`pay-status-badge ${order.payment?.isPaid ? 'paid' : 'unpaid'}`}>
                              {order.payment?.isPaid ? '결제완료' : '미결제'}
                            </span>
                          </div>
                        </td>

                        {/* 진행 상태 */}
                        <td>
                          <span className={`status-badge ${getStatusBadgeClass(order.status)}`}>
                            {getStatusLabel(order.status)}
                          </span>
                        </td>

                        {/* 취소 처리 */}
                        <td>
                          {order.status === 'pending' ? (
                            <button
                              className="table-delete-btn"
                              style={{ margin: 0, borderColor: '#fca5a5', color: '#ef4444' }}
                              onClick={() => handleCancelOrder(order._id)}
                              title="상담 접수 취소"
                            >
                              <XCircle size={13} />
                              <span>취소 요청</span>
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                              취소 불가
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* 확장된 행 상세 정보 */}
                      {isExpanded && (
                        <tr className="order-details-expanded-row">
                          <td colSpan="9">
                            <div className="expanded-row-inner-panel fade-in">
                              <div className="detail-panel-section">
                                <h5 className="panel-sub-title">
                                  <Info size={13} /> 배송 수령인 및 주소지 정보
                                </h5>
                                <div className="panel-info-grid">
                                  <div className="panel-info-item">
                                    <strong>수령인:</strong>
                                    <span>{order.deliveryAddress?.recipient || currentUser?.name || '-'}</span>
                                  </div>
                                  <div className="panel-info-item">
                                    <strong>연락처:</strong>
                                    <span>{order.deliveryAddress?.phone || '-'}</span>
                                  </div>
                                  <div className="panel-info-item full-width">
                                    <strong>배송지 주소:</strong>
                                    <span>
                                      {order.deliveryAddress?.address || '주소 정보 없음'} {order.deliveryAddress?.detailAddr || ''}
                                      {order.deliveryAddress?.zipCode ? ` (우편번호: ${order.deliveryAddress.zipCode})` : ''}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {order.memo && (
                                <div className="detail-panel-section">
                                  <h5 className="panel-sub-title">
                                    <FileText size={13} /> 견적 신청 메모
                                  </h5>
                                  <div className="panel-memo-box">
                                    <em>"{order.memo}"</em>
                                  </div>
                                </div>
                              )}
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
        </>
      )}
    </div>
  );
}

export default MyOrdersView;
