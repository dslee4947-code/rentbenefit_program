import React from 'react';
import { X, ClipboardList, Minus, Plus, Trash2, ExternalLink, CreditCard } from 'lucide-react';

function CartDrawer({
  isCartOpen,
  setIsCartOpen,
  cart,
  cartItemCount,
  updateQuantity,
  removeFromCart,
  cartTotal,
  showToast,
  onOpenComparison,
  onViewDetail,
  onCheckout
}) {
  const handleSubmitQuote = () => {
    alert('견적 상담 신청이 정상 접수되었습니다!\n벤츠 판매왕 신동일 대표의 BENefit 전문 카매니저가 24시간 내에 신속히 연락드리겠습니다. 감사합니다.');
    setIsCartOpen(false);
  };

  const getCategoryLabel = (category) => {
    switch (category) {
      case 'Lease': return '금융/리스';
      case 'Rent car': return '장기렌트';
      case 'Short Rent': return '단기렌트';
      case 'New car': return '신차구입';
      case 'Used car': return '인증중고차';
      case 'Insurance': return '자동차 보험';
      default: return category;
    }
  };

  const handleItemClick = (product) => {
    if (onViewDetail) {
      setIsCartOpen(false);
      onViewDetail(product);
    }
  };

  return (
    <>
      <div 
        className={`cart-drawer-overlay ${isCartOpen ? 'open' : ''}`} 
        onClick={() => setIsCartOpen(false)}
      />
      <div className={`cart-drawer ${isCartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <h2>견적 문의 바구니 ({cartItemCount})</h2>
          <button className="close-btn" onClick={() => setIsCartOpen(false)}>
            <X size={24} />
          </button>
        </div>

        <div className="cart-items">
          {cart.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-muted)',
              gap: '1rem'
            }}>
              <ClipboardList size={48} strokeWidth={1} />
              <span>바구니에 담긴 차량이 없습니다.</span>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.product._id}
                className="cart-item cart-item-clickable"
                onClick={() => handleItemClick(item.product)}
                title="클릭하면 상세 페이지로 이동합니다"
              >
                <div className="cart-item-img-wrap">
                  <img src={item.product.imageUrl} alt={item.product.name} className="cart-item-img" />
                  {onViewDetail && (
                    <div className="cart-item-img-overlay">
                      <ExternalLink size={16} />
                    </div>
                  )}
                </div>
                <div className="cart-item-info">
                  <h4 className="cart-item-title">
                    {item.product.name}
                    {onViewDetail && (
                      <ExternalLink size={12} style={{ marginLeft: '4px', opacity: 0.5, verticalAlign: 'middle' }} />
                    )}
                  </h4>
                  <p className="cart-item-price">
                    {item.product.category === 'Short Rent' ? (
                      `일 ${item.product.price.toLocaleString()}원 ~`
                    ) : item.product.category === 'Insurance' ? (
                      '보험료 상담'
                    ) : (
                      `월 ${item.product.price.toLocaleString()}원 ~`
                    )}
                  </p>
                  <span style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>
                    [{getCategoryLabel(item.product.category)}]
                  </span>
                </div>
                <div
                  className="quantity-controls"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.product.category !== 'Insurance' && (
                    <>
                      <button className="qty-btn" onClick={() => updateQuantity(item.product._id, -1)}>
                        <Minus size={12} />
                      </button>
                      <span style={{ minWidth: '30px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>
                        {item.quantity} 대
                      </span>
                      <button className="qty-btn" onClick={() => updateQuantity(item.product._id, 1)}>
                        <Plus size={12} />
                      </button>
                    </>
                  )}
                  <button 
                    className="close-btn" 
                    onClick={() => removeFromCart(item.product._id, item.product.name)}
                    style={{ marginLeft: '0.5rem', color: 'var(--error)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="cart-footer">
            <div className="cart-total-row">
              <span>예상 월 이용료 합계</span>
              <span className="cart-total-price">월 {cartTotal.toLocaleString()}원 ~</span>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
              <button 
                className="checkout-btn" 
                onClick={() => {
                  setIsCartOpen(false);
                  onOpenComparison();
                }}
                style={{ flex: 1, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.82rem' }}
              >
                비교견적서
              </button>
              <button
                className="checkout-btn"
                onClick={handleSubmitQuote}
                style={{ flex: 1, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.82rem' }}
              >
                무료상담
              </button>
            </div>
            <button
              className="checkout-btn cart-checkout-btn"
              onClick={() => {
                setIsCartOpen(false);
                onCheckout && onCheckout();
              }}
            >
              <CreditCard size={17} style={{ marginRight: '0.4rem', display: 'inline', verticalAlign: 'middle' }} />
              결제하기
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default CartDrawer;
