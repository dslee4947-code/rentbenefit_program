import React from 'react';
import { FileText, Eye } from 'lucide-react';

function ProductCard({ product, addToCart, onViewDetail }) {
  // 영어 카테고리명을 고품격 한글 브랜드 명칭으로 변환
  const getCategoryLabel = (category) => {
    switch (category) {
      case 'Lease': return '금융/운용리스';
      case 'Rent car': return '장기렌트카';
      case 'Short Rent': return '단기렌트';
      case 'New car': return '신차구입 (S)';
      case 'Used car': return '인증중고차';
      default: return category;
    }
  };

  const handleCardClick = () => {
    if (onViewDetail) onViewDetail(product);
  };

  return (
    <div
      className={`product-card car-card${onViewDetail ? ' clickable-card' : ''}`}
      onClick={handleCardClick}
      style={onViewDetail ? { cursor: 'pointer' } : {}}
    >
      <div className="product-img-container car-img-container">
        <img 
          src={product.imageUrl} 
          alt={product.name} 
          className="product-img car-img"
          onError={(e) => {
            e.target.src = 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=800&q=80';
          }}
        />
        <span className="product-tag car-tag">{getCategoryLabel(product.category)}</span>
        {onViewDetail && (
          <div className="card-hover-overlay">
            <Eye size={28} />
            <span>상세 보기</span>
          </div>
        )}
      </div>
      <div className="product-info car-info">
        <h3 className="product-title car-title">{product.name}</h3>
        <p className="product-desc car-desc">{product.description}</p>
        <div className="product-meta car-meta">
          <div className="price-container">
            <span className="price-label">월 이용료</span>
            <span className="product-price car-price">{product.price.toLocaleString()} 원 ~</span>
          </div>
          <button
            className="add-cart-btn car-quote-btn"
            onClick={(e) => {
              e.stopPropagation();
              addToCart(product);
            }}
          >
            <FileText size={16} />
            <span>견적 담기</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProductCard;
