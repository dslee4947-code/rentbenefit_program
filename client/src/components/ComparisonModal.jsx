import React from 'react';
import { X, Scale, FileText } from 'lucide-react';

function ComparisonModal({ isOpen, onClose, cart, removeFromCart, showToast }) {
  if (!isOpen) return null;

  const handleSubmitQuote = () => {
    alert('비교 견적 상담 신청이 정상 접수되었습니다!\n전문 카매니저가 각 차량별 견적을 상세히 분석하여 24시간 내에 연락드리겠습니다.');
    onClose();
  };

  const getCategoryLabel = (category) => {
    switch (category) {
      case 'Lease': return '금융/운용리스';
      case 'Rent car': return '장기렌트카';
      case 'Short Rent': return '단기렌트카';
      case 'New car': return '신차구입';
      case 'Used car': return '인증중고차';
      case 'Insurance': return '자동차 보험';
      default: return category;
    }
  };

  return (
    <div className="comparison-modal-overlay">
      <div className="comparison-modal-container animate-fade-in">
        <div className="comparison-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Scale style={{ color: 'var(--primary)' }} />
            <h2>비교견적서 (선택 차량 비교)</h2>
          </div>
          <button className="comparison-close-btn" onClick={onClose}>
            <X size={28} />
          </button>
        </div>

        <div className="comparison-body">
          {cart.length < 2 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4rem 1rem',
              color: 'var(--text-muted)',
              gap: '1rem'
            }}>
              <Scale size={48} strokeWidth={1} />
              <span>최소 2대 이상의 차량/견적을 담으셔야 비교견적서 확인이 가능합니다.</span>
              <button 
                className="signup-nav-btn" 
                onClick={onClose}
                style={{ marginTop: '1rem' }}
              >
                차량 추가하러 가기
              </button>
            </div>
          ) : (
            <div className="comparison-table-wrapper">
              <table className="comparison-table">
                <tbody>
                  {/* Image Row */}
                  <tr>
                    <th>차량 이미지</th>
                    {cart.map((item) => (
                      <td key={item.product._id}>
                        <img 
                          src={item.product.imageUrl} 
                          alt={item.product.name} 
                          className="comparison-car-img" 
                          onError={(e) => {
                            e.target.src = 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=800&q=80';
                          }}
                        />
                      </td>
                    ))}
                  </tr>

                  {/* Name Row */}
                  <tr>
                    <th>차량/견적명</th>
                    {cart.map((item) => (
                      <td key={item.product._id} className="comparison-car-name">
                        {item.product.name}
                      </td>
                    ))}
                  </tr>

                  {/* Category Row */}
                  <tr>
                    <th>견적 구분</th>
                    {cart.map((item) => (
                      <td key={item.product._id} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                        {getCategoryLabel(item.product.category)}
                      </td>
                    ))}
                  </tr>

                  {/* Price Row */}
                  <tr>
                    <th>예상 이용료 (원)</th>
                    {cart.map((item) => (
                      <td key={item.product._id} className="comparison-price">
                        {item.product.category === 'Short Rent' ? (
                          <span>일 {item.product.price.toLocaleString()} 원 ~</span>
                        ) : item.product.category === 'Insurance' ? (
                          <span>보험료 산출 상담</span>
                        ) : (
                          <span>월 {item.product.price.toLocaleString()} 원 ~</span>
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Description / Specs Row */}
                  <tr>
                    <th>상세 정보 및 스펙</th>
                    {cart.map((item) => (
                      <td key={item.product._id}>
                        <p className="comparison-desc">
                          {item.product.description}
                        </p>
                      </td>
                    ))}
                  </tr>

                  {/* Action Row */}
                  <tr>
                    <th>비교 해제</th>
                    {cart.map((item) => (
                      <td key={item.product._id}>
                        <button 
                          className="comparison-remove-btn" 
                          onClick={() => {
                            removeFromCart(item.product._id, item.product.name);
                            showToast(`${item.product.name}이(가) 비교견적서에서 제외되었습니다.`, 'error');
                          }}
                        >
                          제외하기
                        </button>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {cart.length >= 2 && (
          <div className="comparison-footer">
            <button className="btn-secondary" onClick={onClose} style={{ padding: '0.8rem 2rem' }}>
              계속 둘러보기
            </button>
            <button className="comparison-submit-btn" onClick={handleSubmitQuote}>
              <FileText size={18} style={{ marginRight: '0.5rem', display: 'inline', verticalAlign: 'middle' }} />
              선택 차량 비교 상담 신청하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ComparisonModal;
