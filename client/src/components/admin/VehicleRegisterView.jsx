import React, { useState, useEffect } from 'react';
import { FileText, Paperclip, AlertCircle, Sparkles } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';
import { useSaveShortcut } from './useSaveShortcut.js';

const BRAND_MODELS = {
  현대: ['아반떼', '쏘나타', '그랜저', '팰리세이드', '스타리아', '아이오닉 5', '투싼', '싼타페'],
  기아: ['K3', 'K5', 'K8', 'K9', '스포티지', '쏘렌토', '카니발', 'EV6', '레이', '모닝'],
  제네시스: ['G70', 'G80', 'G90', 'GV70', 'GV80'],
  벤츠: ['C-Class', 'E-Class', 'S-Class', 'GLE 클래스', 'GLC 클래스', 'EQS'],
  BMW: ['3 Series', '5 Series', '7 Series', 'X5', 'X6', 'i4'],
  아우디: ['A4', 'A6', 'A8', 'Q5', 'Q7', 'e-tron'],
  테슬라: ['Model 3', 'Model Y', 'Model S', 'Model X']
};

const OPERATORS = [
  '(주)렌트베네핏',
  '(주)에스베네핏',
  '(주)파인베네핏'
];

const COLORS = [
  '선택',
  '화이트',
  '블랙',
  '그레이',
  '실버',
  '블루',
  '레드',
  '옐로우'
];

const OPTIONS_LIST = [
  '네비게이션',
  '블루투스',
  '후방센서',
  '핸들열선',
  '후방카메라',
  '스마트키',
  '통풍시트',
  '열선시트',
  '어라운드뷰',
  '기타(직접입력)'
];

function VehicleRegisterView({ onRegisterVehicle, setActiveTab, showToast }) {
  // Form States
  const [registrationMethod, setRegistrationMethod] = useState('장기렌트'); // '장기렌트' | '단기렌트' | '중고차 매물'
  const [price, setPrice] = useState('');
  const [vehicleType, setVehicleType] = useState('국산차'); // '국산차' | '수입차'
  const [brand, setBrand] = useState('현대');
  const [model, setModel] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [year, setYear] = useState('');
  const [firstRegistrationDate, setFirstRegistrationDate] = useState('');
  const [fuelType, setFuelType] = useState('');
  const [displacement, setDisplacement] = useState('');
  const [vin, setVin] = useState('');
  const [color, setColor] = useState('선택');
  const [seatingCapacity, setSeatingCapacity] = useState('');
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [customOption, setCustomOption] = useState('');
  const [showCustomOptionInput, setShowCustomOptionInput] = useState(false);
  const [insuranceAge, setInsuranceAge] = useState('만 21세 이상'); // '만 21세 이상' | '만 26세 이상'
  const [fileName, setFileName] = useState('');
  const [fileUrl, setFileUrl] = useState('');

  // Validation States
  const [vinError, setVinError] = useState('');
  const [formSubmitted, setFormSubmitted] = useState(false);

  // Update models list when brand changes
  useEffect(() => {
    if (BRAND_MODELS[brand]) {
      setModel(BRAND_MODELS[brand][0]);
    } else {
      setModel('');
    }
  }, [brand]);

  // VIN (차대번호) Validation: 17 alphanumeric, excluding I, O, Q
  const handleVinChange = (e) => {
    const value = e.target.value.toUpperCase();
    // Allow typing only characters that match
    const filteredValue = value.replace(/[^A-HJ-NPR-Z0-9]/g, '');
    
    setVin(filteredValue);

    if (filteredValue.length === 0) {
      setVinError('');
    } else if (filteredValue.length < 17) {
      setVinError('차대번호는 영문자와 숫자 조합 17자리여야 합니다.');
    } else {
      setVinError('');
    }
  };

  // Option Checkbox Toggles
  const handleOptionChange = (option) => {
    if (option === '기타(직접입력)') {
      setShowCustomOptionInput(!showCustomOptionInput);
    }

    setSelectedOptions(prev => {
      if (prev.includes(option)) {
        return prev.filter(item => item !== option);
      } else {
        return [...prev, option];
      }
    });
  };

  // File Upload Simulation
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showToast('파일 용량은 5MB 이하여야 합니다.', 'error');
      return;
    }

    const fileExt = file.name.split('.').pop().toLowerCase();
    const validExtensions = ['jpg', 'jpeg', 'png', 'pdf'];
    if (!validExtensions.includes(fileExt)) {
      showToast('jpg, jpeg, png, pdf 파일만 업로드할 수 있습니다.', 'error');
      return;
    }

    setFileName(file.name);
    // Setup dummy URL
    setFileUrl('/uploads/docs/' + file.name);
    showToast('차량 등록증 파일이 첨부되었습니다.', 'success');
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    setFormSubmitted(true);

    // Validations
    if (!brand || !model || !vehicleName || !vehicleNumber || !operatorName || !year || !firstRegistrationDate || !fuelType || !displacement || !vin || color === '선택' || !seatingCapacity || !price) {
      showToast('모든 필수 항목(*)을 채워주세요.', 'error');
      return;
    }

    if (isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
      showToast('올바른 가격을 입력해주세요.', 'error');
      return;
    }

    if (vin.length !== 17) {
      setVinError('차대번호는 17자리여야 합니다.');
      showToast('차대번호 입력 오류를 확인하세요.', 'error');
      return;
    }

    if (vinError) {
      showToast('차대번호 입력을 확인하세요.', 'error');
      return;
    }

    // Combine options
    let finalOptions = selectedOptions.filter(o => o !== '기타(직접입력)');
    if (showCustomOptionInput && customOption.trim()) {
      finalOptions.push(customOption.trim());
    }

    const payload = {
      vehicleType,
      brand,
      model,
      vehicleName,
      vehicleNumber,
      operatorName,
      year,
      firstRegistrationDate,
      fuelType,
      displacement: parseFloat(displacement),
      registrationDocumentUrl: fileUrl,
      vin,
      color,
      seatingCapacity: parseInt(seatingCapacity, 10),
      options: finalOptions,
      insuranceAge,
      mileage: 0,
      isDailyRent: registrationMethod === '단기렌트',
      isMonthlyRent: registrationMethod === '장기렌트',
      isUsedCar: registrationMethod === '중고차 매물',
      registrationMethod,
      price: parseFloat(price),
      groupName: '-',
      status: '대기중'
    };

    onRegisterVehicle(payload);
  };

  // Form Submit Handler
  // Ctrl+S로 등록한다
  useSaveShortcut(true, () => handleSubmit());

  // Construct options display text
  const getOptionsDisplayText = () => {
    let list = selectedOptions.filter(o => o !== '기타(직접입력)');
    if (showCustomOptionInput && customOption.trim()) {
      list.push(customOption.trim());
    }
    return list.length === 0 ? '옵션없음' : list.join(', ');
  };

  return (
    <div className="vehicle-register-view-container fade-in">
      <form onSubmit={handleSubmit} className="register-main-form">
        <div className="register-grid">
          {/* LEFT COLUMN */}
          <div className="form-column">
            {/* 차량 등록 방법 */}
            <div className="form-group row-style">
              <label className="required-label">차량 등록 방법</label>
              <div className="button-selector-group">
                <button 
                  type="button"
                  className={`selector-btn ${registrationMethod === '장기렌트' ? 'active' : ''}`}
                  onClick={() => setRegistrationMethod('장기렌트')}
                >
                  장기렌트
                </button>
                <button 
                  type="button"
                  className={`selector-btn ${registrationMethod === '단기렌트' ? 'active' : ''}`}
                  onClick={() => setRegistrationMethod('단기렌트')}
                >
                  단기렌트
                </button>
                <button 
                  type="button"
                  className={`selector-btn ${registrationMethod === '중고차 매물' ? 'active' : ''}`}
                  onClick={() => setRegistrationMethod('중고차 매물')}
                >
                  중고차 매물
                </button>
              </div>
            </div>

            {/* 금액 / 이용료 */}
            <div className="form-group row-style">
              <label className="required-label">
                {registrationMethod === '중고차 매물' ? '판매 금액 (원)' : registrationMethod === '단기렌트' ? '일 이용료 (원)' : '월 이용료 (원)'}
              </label>
              <MoneyInput 
                placeholder={registrationMethod === '중고차 매물' ? '예: 18500000' : registrationMethod === '단기렌트' ? '예: 55000' : '예: 450000'} 
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={`register-text-input ${formSubmitted && !price ? 'error-border' : ''}`}
              />
            </div>

            {/* 차량 구분 */}
            <div className="form-group row-style">
              <label className="required-label">차량 구분</label>
              <div className="button-selector-group">
                <button 
                  type="button"
                  className={`selector-btn ${vehicleType === '국산차' ? 'active' : ''}`}
                  onClick={() => setVehicleType('국산차')}
                >
                  국산차
                </button>
                <button 
                  type="button"
                  className={`selector-btn ${vehicleType === '수입차' ? 'active' : ''}`}
                  onClick={() => setVehicleType('수입차')}
                >
                  수입차
                </button>
              </div>
            </div>

            {/* 브랜드 */}
            <div className="form-group row-style">
              <label className="required-label">브랜드</label>
              <select 
                value={brand} 
                onChange={(e) => setBrand(e.target.value)}
                className={`register-select-input ${formSubmitted && !brand ? 'error-border' : ''}`}
              >
                {Object.keys(BRAND_MODELS).map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* 모델 */}
            <div className="form-group row-style">
              <label className="required-label">모델</label>
              <select 
                value={model} 
                onChange={(e) => setModel(e.target.value)}
                className={`register-select-input ${formSubmitted && !model ? 'error-border' : ''}`}
              >
                {BRAND_MODELS[brand] ? (
                  BRAND_MODELS[brand].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))
                ) : (
                  <option value="">모델을 선택해 주세요.</option>
                )}
              </select>
            </div>

            {/* 차량명 */}
            <div className="form-group row-style">
              <label className="required-label">차량명</label>
              <input 
                type="text" 
                placeholder="업체에서 관리하기 쉽게 차량명을 등록하세요." 
                value={vehicleName}
                onChange={(e) => setVehicleName(e.target.value)}
                className={`register-text-input ${formSubmitted && !vehicleName ? 'error-border' : ''}`}
              />
            </div>

            {/* 차량번호 */}
            <div className="form-group row-style">
              <label className="required-label">차량번호</label>
              <input 
                type="text" 
                placeholder="서울01호1234, 123호1234" 
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                className={`register-text-input ${formSubmitted && !vehicleNumber ? 'error-border' : ''}`}
              />
            </div>

            {/* 사업자 연결 */}
            <div className="form-group row-style">
              <label className="required-label">사업자 연결</label>
              <select 
                value={operatorName} 
                onChange={(e) => setOperatorName(e.target.value)}
                className={`register-select-input ${formSubmitted && !operatorName ? 'error-border' : ''}`}
              >
                <option value="">선택</option>
                {OPERATORS.map(op => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            </div>

            {/* 연식 & 최초등록일 */}
            <div className="form-group row-style split-group">
              <div className="split-cell">
                <span className="required-label">연식</span>
                <input 
                  type="text" 
                  placeholder="2020" 
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className={`register-text-input ${formSubmitted && !year ? 'error-border' : ''}`}
                />
              </div>
              <div className="split-cell">
                <span className="required-label">최초등록일</span>
                <input 
                  type="text" 
                  placeholder="YYYYMMDD" 
                  value={firstRegistrationDate}
                  onChange={(e) => setFirstRegistrationDate(e.target.value)}
                  className={`register-text-input ${formSubmitted && !firstRegistrationDate ? 'error-border' : ''}`}
                />
              </div>
            </div>

            {/* 유종 & 배기량 */}
            <div className="form-group row-style split-group">
              <div className="split-cell">
                <span className="required-label">유종</span>
                <select 
                  value={fuelType} 
                  onChange={(e) => setFuelType(e.target.value)}
                  className={`register-select-input ${formSubmitted && !fuelType ? 'error-border' : ''}`}
                >
                  <option value="">선택해 주세요.</option>
                  <option value="가솔린">가솔린</option>
                  <option value="디젤">디젤</option>
                  <option value="하이브리드">하이브리드</option>
                  <option value="전기">전기</option>
                  <option value="LPG">LPG</option>
                </select>
              </div>
              <div className="split-cell">
                <span className="required-label">배기량 (cc)</span>
                <input 
                  type="number" 
                  placeholder="1998" 
                  value={displacement}
                  onChange={(e) => setDisplacement(e.target.value)}
                  className={`register-text-input ${formSubmitted && !displacement ? 'error-border' : ''}`}
                />
              </div>
            </div>

            {/* 차량 등록증 */}
            <div className="form-group row-style file-upload-group">
              <label className="required-label">차량 등록증</label>
              <div className="file-input-wrapper">
                <input 
                  type="text" 
                  placeholder={fileName || "차량 등록증 파일을 첨부해 주세요."} 
                  disabled
                  className="register-text-input file-display"
                />
                <label className="file-attach-btn">
                  차량 등록증 첨부
                  <input 
                    type="file" 
                    accept=".jpg,.jpeg,.png,.pdf" 
                    onChange={handleFileUpload} 
                    style={{ display: 'none' }} 
                  />
                </label>
              </div>
              <div className="upload-notice">
                <p className="red-notice">차량등록증을 등록해야 보험사 청구가 가능합니다.</p>
                <p className="gray-notice">파일은 5MB 이하 jpg / jpeg / png / pdf 확장자만 등록 가능합니다.</p>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="form-column">
            {/* 차대번호 */}
            <div className="form-group row-style vin-group">
              <label className="required-label">차대번호</label>
              <div className="vin-input-wrapper">
                <input 
                  type="text" 
                  placeholder="KMHMA14TPPU000001" 
                  value={vin}
                  onChange={handleVinChange}
                  maxLength="17"
                  className={`register-text-input vin-input ${vinError || (formSubmitted && !vin) ? 'error-border' : ''}`}
                />
                {vinError && (
                  <div className="error-message-bubble">
                    <AlertCircle size={12} />
                    <span>{vinError}</span>
                  </div>
                )}
                <p className="vin-subtext">I, O, Q를 제외한 영문자와 숫자 17자리만 입력 가능합니다. ({vin.length}/17)</p>
              </div>
            </div>

            {/* 차량색상 & 승차 인원 */}
            <div className="form-group row-style split-group">
              <div className="split-cell">
                <span className="required-label">차량색상</span>
                <select 
                  value={color} 
                  onChange={(e) => setColor(e.target.value)}
                  className={`register-select-input ${formSubmitted && color === '선택' ? 'error-border' : ''}`}
                >
                  {COLORS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="split-cell">
                <span className="required-label">승차 인원</span>
                <input 
                  type="number" 
                  placeholder="숫자를 입력해주세요." 
                  value={seatingCapacity}
                  onChange={(e) => setSeatingCapacity(e.target.value)}
                  className={`register-text-input ${formSubmitted && !seatingCapacity ? 'error-border' : ''}`}
                />
              </div>
            </div>

            {/* 차량 옵션 */}
            <div className="form-group row-style options-checkboxes-group">
              <label>차량 옵션</label>
              <div className="checkboxes-grid">
                {OPTIONS_LIST.map((option) => (
                  <label key={option} className="checkbox-item-label">
                    <input 
                      type="checkbox"
                      checked={selectedOptions.includes(option)}
                      onChange={() => handleOptionChange(option)}
                    />
                    <span className="custom-check-box" />
                    <span>{option.replace('(직접입력)', '')}</span>
                  </label>
                ))}
              </div>

              {showCustomOptionInput && (
                <input 
                  type="text" 
                  placeholder="기타 옵션을 직접 입력해주세요."
                  value={customOption}
                  onChange={(e) => setCustomOption(e.target.value)}
                  className="register-text-input custom-option-input fade-in"
                />
              )}
            </div>

            {/* 차량 옵션 (텍스트 목록) */}
            <div className="form-group row-style options-display-group">
              <label>차량 옵션</label>
              <div className="options-display-box">
                {getOptionsDisplayText()}
              </div>
            </div>

            {/* 보험 연령 */}
            <div className="form-group row-style" style={{ marginBottom: '1.5rem' }}>
              <label className="required-label">보험 연령</label>
              <div className="button-selector-group">
                <button 
                  type="button"
                  className={`selector-btn ${insuranceAge === '만 21세 이상' ? 'active' : ''}`}
                  onClick={() => setInsuranceAge('만 21세 이상')}
                >
                  만 21세 이상
                </button>
                <button 
                  type="button"
                  className={`selector-btn ${insuranceAge === '만 26세 이상' ? 'active' : ''}`}
                  onClick={() => setInsuranceAge('만 26세 이상')}
                >
                  만 26세 이상
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* BOTTOM REGISTER BUTTON */}
        <div className="form-actions-row">
          <button type="submit" className="submit-register-btn">
            등록하기
          </button>
        </div>
      </form>
    </div>
  );
}

export default VehicleRegisterView;
