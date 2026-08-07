import React, { useState, useEffect } from 'react';
import { ArrowLeft, CreditCard, Building2, Landmark, MapPin, User, Phone, Mail, FileText, CheckCircle, Car, Calendar, ShieldCheck } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;
function CheckoutPage({ cart, cartTotal, currentUser, onBack, showToast, onOrderComplete }) {
  const [form, setForm] = useState({
    name: currentUser?.name || '',
    phone: '',
    email: currentUser?.email || '',
    address: currentUser?.address || '',
    detailAddr: '',
    zipCode: '',
    paymentMethod: '카드',
    startDate: '',
    endDate: '',
    memo: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // ── 포트원(아임포트) SDK 초기화 ──────────────────────────
  useEffect(() => {
    if (window.IMP) {
      window.IMP.init('imp42215488');
    }
  }, []);

  const getCategoryLabel = (category) => {
    switch (category) {
      case 'Lease': return '금융/운용리스';
      case 'Rent car': return '장기렌트';
      case 'Short Rent': return '단기렌트';
      case 'New car': return '신차구입';
      case 'Used car': return '인증중고차';
      case 'Insurance': return '자동차 보험';
      default: return category;
    }
  };

  const getPriceLabel = (item) => {
    if (item.product.category === 'Short Rent') return `일 ${item.product.price.toLocaleString()}원`;
    if (item.product.category === 'Insurance') return '보험료 상담';
    if (item.product.category === 'Used car') return `${item.product.price.toLocaleString()}원`;
    return `월 ${item.product.price.toLocaleString()}원`;
  };

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // ── 포트원 결제 요청 핸들러 ─────────────────────────────
  // ── 포트원 결제 요청 및 주문 생성 핸들러 ─────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!currentUser) {
      showToast('주문 및 결제는 로그인 후 이용 가능합니다.', 'error');
      return;
    }

    if (!form.name || !form.phone || !form.address) {
      showToast('이름, 연락처, 주소는 필수 입력 항목입니다.', 'error');
      return;
    }

    const orderName = cart.map((i) => i.product.name).join(', ');
    const merchantUid = `benefit_${Date.now()}`;

    // 공통 주문 데이터 페이로드 가공
    const items = cart.map((item) => {
      let orderType = '장기렌트';
      if (item.product.category === 'Short Rent') orderType = '단기렌트';
      else if (item.product.category === 'Used car') orderType = '중고차매물';

      let shortTermDetails = undefined;
      if (orderType === '단기렌트') {
        const totalDays = form.startDate && form.endDate 
          ? Math.max(1, Math.ceil((new Date(form.endDate) - new Date(form.startDate)) / (1000 * 60 * 60 * 24)))
          : 1;
        shortTermDetails = {
          dailyRate: item.product.price,
          totalDays: totalDays,
          pickupLocation: '본사',
          returnLocation: '본사'
        };
      }

      let longTermDetails = undefined;
      if (orderType === '장기렌트') {
        longTermDetails = {
          contractMonths: 36,
          monthlyPayment: item.product.price,
          deposit: 0,
          mileageLimit: 20000
        };
      }

      return {
        vehicle: item.product._id,
        orderType: orderType,
        rentalPeriod: {
          startDate: form.startDate ? new Date(form.startDate) : undefined,
          endDate: form.endDate ? new Date(form.endDate) : undefined,
        },
        longTermDetails,
        shortTermDetails,
        pricing: {
          basePrice: item.product.price,
          tax: 0,
          discount: 0,
          totalAmount: item.product.price * (item.quantity || 1),
        }
      };
    });

    const orderPayload = {
      user: currentUser._id,
      items: items,
      deliveryAddress: {
        recipient: form.name,
        phone: form.phone,
        address: form.address,
        detailAddr: form.detailAddr,
        zipCode: form.zipCode || '',
      },
      paymentMethod: form.paymentMethod,
      memo: form.memo,
    };

    // 1. 무통장입금 / 현장결제는 PG 결제창 없이 바로 백엔드로 직접 주문 생성
    if (form.paymentMethod === '무통장입금' || form.paymentMethod === '현장결제') {
      setIsSubmitting(true);
      try {
        const response = await fetch(`${API_HOST}/api/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...orderPayload,
            payment: {
              method: form.paymentMethod,
              isPaid: false,
            }
          }),
        });

        if (response.ok) {
          setIsSuccess(true);
          showToast('주문이 성공적으로 접수되었습니다!', 'success');
        } else {
          const errData = await response.json();
          alert(`주문 접수 실패!\n\n에러 정보:\n${JSON.stringify(errData, null, 2)}`);
          showToast(`주문 접수 실패: ${errData.message || '알 수 없는 오류'}`, 'error');
        }
      } catch (error) {
        console.error('주문 접수 에러:', error);
        alert(`주문 접수 통신 실패!\n\n에러 메시지:\n${error.message}`);
        showToast('서버 통신 실패로 주문을 생성하지 못했습니다.', 'error');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // 2. 카드 / 계좌이체 → 포트원 결제창 호출 및 결제 검증 후 주문 생성
    if (!window.IMP) {
      showToast('결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'error');
      return;
    }

    console.log('[포트원] 결제 요청 시작:', { merchantUid, orderName, cartTotal });
    setIsSubmitting(true);

    const payMethodMap = {
      '카드': 'card',
      '계좌이체': 'trans'
    };

    window.IMP.request_pay(
      {
        pg: 'html5_inicis.INIpayTest',
        pay_method: payMethodMap[form.paymentMethod] || 'card',
        merchant_uid: merchantUid,
        name: orderName,
        amount: cartTotal,
        buyer_email: form.email || '',
        buyer_name: form.name,
        buyer_tel: form.phone,
        buyer_addr: `${form.address} ${form.detailAddr}`.trim(),
        buyer_postcode: form.zipCode || '',
      },
      async (rsp) => {
        console.log('[포트원] 결제 응답:', rsp);
        if (rsp.success) {
          try {
            // 결제 완료 후 서버에서 결제 검증(위변조 및 더블주문 확인) 진행
            const verifyRes = await fetch(`${API_HOST}/api/orders/verify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                imp_uid: rsp.imp_uid,
                merchant_uid: rsp.merchant_uid,
                amount: cartTotal,
                orderData: orderPayload
              }),
            });

            const verifyData = await verifyRes.json();

            if (verifyRes.ok) {
              setIsSuccess(true);
              showToast('결제 검증 완료 및 주문이 등록되었습니다!', 'success');
            } else {
              alert(`결제 검증 실패!\n\n에러 정보:\n${JSON.stringify(verifyData, null, 2)}`);
              showToast(`결제 검증 실패: ${verifyData.message || '비정상 결제 거래'}`, 'error');
            }
          } catch (error) {
            console.error('결제 검증 요청 실패:', error);
            alert(`결제 검증 통신 실패!\n\n에러 메시지:\n${error.message}`);
            showToast('결제는 성공하였으나 서버 검증에 실패했습니다. 고객센터로 문의하세요.', 'error');
          } finally {
            setIsSubmitting(false);
          }
        } else {
          setIsSubmitting(false);
          alert(`포트원 결제 실패!\n\n에러 정보:\n${JSON.stringify(rsp, null, 2)}`);
          showToast(
            rsp.error_msg?.includes('cancel')
              ? '결제가 취소되었습니다.'
              : `결제 실패: ${rsp.error_msg}`,
            'error'
          );
        }
      }
    );
  };

  const paymentMethods = [
    { value: '카드', label: '신용/체크카드', icon: CreditCard },
    { value: '계좌이체', label: '계좌이체', icon: Building2 },
    { value: '무통장입금', label: '무통장입금', icon: Landmark },
    { value: '현장결제', label: '현장결제', icon: MapPin },
  ];

  // 성공 화면
  if (isSuccess) {
    const isAdmin = currentUser?.user_type === 'admin';

    return (
      <div className="checkout-success-wrapper">
        <div className="checkout-success-card">
          <div className="success-icon-ring">
            <CheckCircle size={52} />
          </div>
          <h2>주문이 접수되었습니다!</h2>
          <p>전문 카매니저가 <strong>24시간 내</strong>에 연락드리겠습니다.</p>
          <div className="success-order-summary">
            {cart.map((item, index) => (
              <div key={`${item.product._id}-${index}`} className="success-order-item">
                <span className="success-item-tag">{getCategoryLabel(item.product.category)}</span>
                <span className="success-item-name">{item.product.name}</span>
              </div>
            ))}
          </div>
          <div className="success-contact-box">
            <Phone size={16} />
            <span>문의: <strong>010-2020-3300</strong> / <strong>02-547-0303</strong></span>
          </div>

          <div style={{ display: 'flex', gap: '1rem', width: '100%', marginTop: '1rem' }}>
            <button 
              className="checkout-primary-btn" 
              style={{ background: '#ffffff', border: '1px solid var(--primary)', color: 'var(--primary)', boxShadow: 'none' }}
              onClick={() => onOrderComplete('main')}
            >
              메인으로 돌아가기
            </button>
            <button 
              className="checkout-primary-btn" 
              onClick={() => onOrderComplete(isAdmin ? 'admin' : 'mypage')}
            >
              {isAdmin ? '주문 / 결제 관리' : '내 주문내역 확인'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-page-wrapper">
      {/* 헤더 */}
      <div className="checkout-page-header">
        <button className="checkout-back-btn" onClick={onBack}>
          <ArrowLeft size={20} />
          <span>돌아가기</span>
        </button>
        <div className="checkout-page-title">
          <CreditCard size={22} style={{ color: 'var(--primary)' }} />
          <h1>주문 / 결제</h1>
        </div>
        <div style={{ width: 100 }} />
      </div>

      <form className="checkout-layout" onSubmit={handleSubmit}>
        {/* 왼쪽: 주문 상품 목록 */}
        <div className="checkout-left">
          <div className="checkout-section-card">
            <h3 className="checkout-section-title">
              <Car size={18} /> 선택 차량 / 견적 목록
            </h3>
            <div className="checkout-item-list">
              {cart.map((item, index) => (
                <div key={`${item.product._id}-${index}`} className="checkout-item-row">
                  <img
                    src={item.product.imageUrl}
                    alt={item.product.name}
                    className="checkout-item-img"
                    onError={(e) => {
                      e.target.src = 'https://images.unsplash.com/photo-1542282088-fe8426682b8f?auto=format&fit=crop&w=400&q=80';
                    }}
                  />
                  <div className="checkout-item-info">
                    <span className="checkout-item-category">{getCategoryLabel(item.product.category)}</span>
                    <p className="checkout-item-name">{item.product.name}</p>
                    <p className="checkout-item-desc">{item.product.description}</p>
                  </div>
                  <div className="checkout-item-price-col">
                    <span className="checkout-item-price">{getPriceLabel(item)}</span>
                    {item.product.category !== 'Insurance' && item.product.category !== 'Used car' && (
                      <span className="checkout-item-unit">~ / 예상</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 렌트 기간 */}
            <div className="checkout-period-box">
              <h4 className="checkout-sub-title">
                <Calendar size={16} /> 희망 이용 기간 (선택)
              </h4>
              <div className="checkout-date-row">
                <div className="co-form-group">
                  <label className="co-form-label">시작일</label>
                  <input
                    type="date"
                    name="startDate"
                    value={form.startDate}
                    onChange={handleChange}
                    className="co-form-control"
                  />
                </div>
                <div className="co-form-group">
                  <label className="co-form-label">종료일</label>
                  <input
                    type="date"
                    name="endDate"
                    value={form.endDate}
                    onChange={handleChange}
                    className="co-form-control"
                  />
                </div>
              </div>
            </div>

            {/* 주문 합계 */}
            <div className="checkout-total-box">
              <div className="checkout-total-row">
                <span>예상 월 이용료 합계</span>
                <span className="checkout-total-amount">월 {cartTotal.toLocaleString()}원 ~</span>
              </div>
              <p className="checkout-total-note">
                * 실제 요금은 전문 카매니저 상담 후 확정됩니다.
              </p>
            </div>
          </div>
        </div>

        {/* 오른쪽: 주문자 정보 + 결제 방식 */}
        <div className="checkout-right">
          {/* 주문자 정보 */}
          <div className="checkout-section-card">
            <h3 className="checkout-section-title">
              <User size={18} /> 주문자 정보
            </h3>
            <div className="co-form-grid">
              <div className="co-form-group">
                <label className="co-form-label">이름 <span className="required">*</span></label>
                <div className="co-input-wrap">
                  <User size={15} className="co-input-icon" />
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="홍길동"
                    className="co-form-control with-icon"
                    required
                  />
                </div>
              </div>
              <div className="co-form-group">
                <label className="co-form-label">연락처 <span className="required">*</span></label>
                <div className="co-input-wrap">
                  <Phone size={15} className="co-input-icon" />
                  <input
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="010-0000-0000"
                    className="co-form-control with-icon"
                    required
                  />
                </div>
              </div>
              <div className="co-form-group co-full-width">
                <label className="co-form-label">이메일</label>
                <div className="co-input-wrap">
                  <Mail size={15} className="co-input-icon" />
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="example@email.com"
                    className="co-form-control with-icon"
                  />
                </div>
              </div>
              <div className="co-form-group co-full-width">
                <label className="co-form-label">주소 <span className="required">*</span></label>
                <div className="co-input-wrap">
                  <MapPin size={15} className="co-input-icon" />
                  <input
                    type="text"
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    placeholder="시/도, 시/군/구"
                    className="co-form-control with-icon"
                    required
                  />
                </div>
              </div>
              <div className="co-form-group co-full-width">
                <label className="co-form-label">상세 주소</label>
                <input
                  type="text"
                  name="detailAddr"
                  value={form.detailAddr}
                  onChange={handleChange}
                  placeholder="상세 주소 입력 (선택)"
                  className="co-form-control"
                />
              </div>
              <div className="co-form-group co-full-width">
                <label className="co-form-label">
                  <FileText size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  특이사항 / 요청사항
                </label>
                <textarea
                  name="memo"
                  value={form.memo}
                  onChange={handleChange}
                  placeholder="색상 선호도, 옵션 요청, 기타 문의 사항을 자유롭게 입력해주세요."
                  className="co-form-control"
                  rows={3}
                />
              </div>
            </div>
          </div>

          {/* 결제 방식 */}
          <div className="checkout-section-card">
            <h3 className="checkout-section-title">
              <CreditCard size={18} /> 결제 방식
            </h3>
            <div className="checkout-payment-grid">
              {paymentMethods.map(({ value, label, icon: Icon }) => (
                <label
                  key={value}
                  className={`payment-method-card ${form.paymentMethod === value ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={value}
                    checked={form.paymentMethod === value}
                    onChange={handleChange}
                    style={{ display: 'none' }}
                  />
                  <Icon size={22} />
                  <span>{label}</span>
                  {form.paymentMethod === value && (
                    <CheckCircle size={16} className="payment-check" />
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* 안내 사항 */}
          <div className="checkout-notice-box">
            <ShieldCheck size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
            <p>
              주문 접수 후 <strong>전문 카매니저</strong>가 직접 연락드려 최종 조건을 안내해 드립니다.
              실제 결제는 상담 완료 후 진행됩니다.
            </p>
          </div>

          {/* 제출 버튼 */}
          <button
            type="submit"
            className={`checkout-primary-btn ${isSubmitting ? 'loading' : ''}`}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="checkout-spinner" />
            ) : (
              <>
                <CheckCircle size={20} />
                주문 접수하기
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default CheckoutPage;
