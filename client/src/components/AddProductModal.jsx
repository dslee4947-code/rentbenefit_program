import React from 'react';
import { X } from 'lucide-react';

function AddProductModal({
  isAddModalOpen,
  setIsAddModalOpen,
  newProduct,
  setNewProduct,
  handleCreateProduct
}) {
  const openUploadWidget = (e) => {
    e.preventDefault();
    if (!window.cloudinary) {
      alert("Cloudinary 업로드 위젯 스크립트가 아직 로드되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    // Read from Vite environment variables (prefixed with VITE_)
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

    if (!cloudName || !uploadPreset) {
      alert("Cloudinary 환경변수 설정이 필요합니다. client/.env 파일에 VITE_CLOUDINARY_CLOUD_NAME 및 VITE_CLOUDINARY_UPLOAD_PRESET 값을 확인해 주세요.");
      return;
    }

    window.cloudinary.openUploadWidget(
      {
        cloudName: cloudName,
        uploadPreset: uploadPreset,
        sources: ["local", "url", "camera"],
        multiple: false,
        resourceType: "image",
        cropping: true, // Enable crop tool
        clientAllowedFormats: ["png", "jpg", "jpeg", "webp"],
      },
      (error, result) => {
        if (!error && result && result.event === "success") {
          const uploadedUrl = result.info.secure_url;
          setNewProduct({
            ...newProduct,
            imageUrl: uploadedUrl
          });
        }
      }
    );
  };

  return (
    <div className={`modal-overlay ${isAddModalOpen ? 'open' : ''}`}>
      <div className="modal-container">
        <div className="modal-header">
          <h2>새 차량 등록</h2>
          <button className="close-btn" onClick={() => setIsAddModalOpen(false)}>
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleCreateProduct}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">차량명 *</label>
              <input 
                type="text" 
                className="form-control"
                placeholder="예: Mercedes-Benz S 500"
                required
                value={newProduct.name}
                onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label className="form-label">구분 *</label>
              <select 
                className="form-control"
                value={newProduct.category}
                onChange={(e) => setNewProduct({...newProduct, category: e.target.value})}
              >
                <option value="New car">신차구입 (S BENefit)</option>
                <option value="Rent car">장기렌트 (RENT BENefit)</option>
                <option value="Lease">금융/리스 (FIN BENefit)</option>
                <option value="Used car">인증중고차</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">월 이용료 (원) *</label>
              <input 
                type="number" 
                className="form-control"
                placeholder="예: 450000"
                required
                value={newProduct.price}
                onChange={(e) => setNewProduct({...newProduct, price: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label className="form-label">등록 수량 (대) *</label>
              <input 
                type="number" 
                className="form-control"
                placeholder="예: 5"
                required
                value={newProduct.stock}
                onChange={(e) => setNewProduct({...newProduct, stock: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label className="form-label">차량 이미지 업로드</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input 
                  type="text" 
                  className="form-control"
                  placeholder="이미지 URL을 입력하거나 우측 버튼으로 업로드하세요."
                  value={newProduct.imageUrl}
                  onChange={(e) => setNewProduct({...newProduct, imageUrl: e.target.value})}
                  style={{ flex: 1 }}
                />
                <button 
                  type="button"
                  onClick={openUploadWidget}
                  style={{
                    background: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '0 1rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    whiteSpace: 'nowrap'
                  }}
                >
                  이미지 업로드
                </button>
              </div>

              {/* Image Preview Block */}
              {newProduct.imageUrl && (
                <div className="image-preview-container" style={{
                  marginTop: '0.8rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  background: '#f8f9fa'
                }}>
                  <img 
                    src={newProduct.imageUrl} 
                    alt="Preview" 
                    style={{
                      width: '80px',
                      height: '80px',
                      objectFit: 'cover',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1'
                    }} 
                  />
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem', fontWeight: 'bold' }}>이미지 미리보기</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-main)', wordBreak: 'break-all' }}>{newProduct.imageUrl}</span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setNewProduct({ ...newProduct, imageUrl: '' })}
                    style={{
                      background: '#fee2e2',
                      color: '#ef4444',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '0.4rem 0.8rem',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">차량 상세 설명 *</label>
              <textarea 
                className="form-control"
                placeholder="차량의 스펙 및 상세 설명을 입력해주세요..."
                required
                value={newProduct.description}
                onChange={(e) => setNewProduct({...newProduct, description: e.target.value})}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={() => setIsAddModalOpen(false)}>
              취소
            </button>
            <button type="submit" className="btn-primary">
              등록하기
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddProductModal;
