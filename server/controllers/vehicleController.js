import Vehicle from '../models/Vehicle.js';

const carModelEngMap = {
  '카니발': 'Carnival',
  '쏘나타': 'Sonata',
  '소나타': 'Sonata',
  '그랜저': 'Grandeur',
  '그랜져': 'Grandeur',
  '아반떼': 'Avante',
  '아반테': 'Avante',
  '레이': 'Ray',
  '스타리아': 'Staria',
  '캐스퍼': 'Casper',
  '스포티지': 'Sportage',
  '쏘렌토': 'Sorento',
  '소렌토': 'Sorento',
  '투싼': 'Tucson',
  '싼타페': 'Santafe',
  '산타페': 'Santafe',
  '코나': 'Kona',
  '팰리세이드': 'Palisade',
  '아이오닉': 'Ioniq',
  '봉고': 'Bongo',
  '포터': 'Porter',
  '벤츠': 'Benz',
  'benz': 'Benz',
  '비엠더블유': 'BMW',
  'bmw': 'BMW',
  '아우디': 'Audi',
  '볼보': 'Volvo',
  '렉서스': 'Lexus',
  '토요타': 'Toyota',
  '도요타': 'Toyota',
  '혼다': 'Honda',
  '포드': 'Ford',
  '지프': 'Jeep',
  '테슬라': 'Tesla',
  '모닝': 'Morning',
  '셀토스': 'Seltos',
  '니로': 'Niro',
  'K3': 'K3',
  'K5': 'K5',
  'K7': 'K7',
  'K8': 'K8',
  'K9': 'K9',
  'SM3': 'SM3',
  'SM5': 'SM5',
  'SM6': 'SM6',
  'QM3': 'QM3',
  'QM6': 'QM6',
  'XM3': 'XM3',
  '제네시스': 'Genesis',
  'genesis': 'Genesis'
};

const getCarCodePrefix = (carModel) => {
  if (!carModel) return 'CAR';
  
  const cleaned = carModel.trim();
  
  // 1. Check direct map
  for (const [kr, eng] of Object.entries(carModelEngMap)) {
    if (cleaned.toLowerCase().includes(kr.toLowerCase())) {
      return eng.substring(0, 3).toUpperCase();
    }
  }

  // 2. Extract alphanumeric English characters (e.g. G90, GV80, CLE, BMW)
  const englishWords = cleaned.split(/\s+/).filter(word => /^[A-Za-z0-9]+$/.test(word));
  if (englishWords.length > 0) {
    const wordWithLetters = englishWords.find(word => /[A-Za-z]/.test(word));
    if (wordWithLetters) {
      return wordWithLetters.substring(0, 3).toUpperCase();
    }
    return englishWords[0].substring(0, 3).toUpperCase();
  }

  // 3. Fallback extraction of pure English letters
  const englishOnly = cleaned.replace(/[^A-Za-z]/g, '');
  if (englishOnly.length >= 3) {
    return englishOnly.substring(0, 3).toUpperCase();
  }

  // 4. Default fallback
  return 'CAR';
};

const generateCategoryCode = async (carModel, currentCategory) => {
  const prefix = getCarCodePrefix(carModel); // e.g. "CAR", "SON", "BEN", "G90"
  
  // If currentCategory already matches the pattern prefix-XXX (case-insensitive), keep it
  const prefixRegex = new RegExp(`^${prefix}-\\d+$`, 'i');
  if (currentCategory && prefixRegex.test(String(currentCategory).trim())) {
    return String(currentCategory).trim();
  }

  // Find the highest number suffix among categories matching prefix-XXX
  const searchRegex = new RegExp(`^${prefix}-\\d+$`, 'i');
  const existingVehicles = await Vehicle.find({ category: searchRegex }).lean();

  let maxSeq = 0;
  existingVehicles.forEach(v => {
    if (v.category) {
      const parts = v.category.split('-');
      if (parts.length === 2) {
        const seq = parseInt(parts[1], 10);
        if (!isNaN(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    }
  });

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}-${nextSeq}`;
};

// 1. Get Paginated & Filtered Vehicles
export const getVehicles = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    const { search, status, fuelType, operation } = req.query;

    let filter = {};

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { carNumber: searchRegex },
        { carModel: searchRegex },
        { contractCompany: searchRegex },
        { manager: searchRegex },
        { practicalManager: searchRegex },
        { category: searchRegex },
        { contractNo: searchRegex }
      ];
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (fuelType && fuelType !== 'all') {
      filter.fuelType = fuelType;
    }

    if (operation && operation !== 'all') {
      filter.operation = operation;
    } else {
      filter.operation = { $in: ['장기렌트', '사고대차'] };
    }

    const [vehicles, totalCount, statsResult] = await Promise.all([
      Vehicle.find(filter)
        .sort({ no: 1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Vehicle.countDocuments(filter),
      Vehicle.aggregate([
        {
          $group: {
            _id: '$operation',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const operationOrder = {
      '계약진행중': 1,
      '장기렌트': 2,
      '사고대차': 3,
      '계약변경': 4,
      '계약완료': 5
    };

    vehicles.sort((a, b) => {
      const orderA = operationOrder[a.operation] || 99;
      const orderB = operationOrder[b.operation] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return (a.no || 0) - (b.no || 0);
    });

    const stats = {
      total: 0,
      longTermRent: 0,
      accidentSubstitution: 0,
      contractInProgress: 0
    };

    statsResult.forEach(item => {
      if (item._id === '장기렌트') {
        stats.longTermRent = item.count;
      } else if (item._id === '사고대차') {
        stats.accidentSubstitution = item.count;
      } else if (item._id === '계약진행중') {
        stats.contractInProgress = item.count;
      }
    });

    stats.total = stats.longTermRent + stats.accidentSubstitution;

    const totalPages = Math.ceil(totalCount / limit) || 1;

    res.json({
      success: true,
      vehicles,
      pagination: {
        totalCount,
        totalPages,
        currentPage: page,
        limit
      },
      stats
    });
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.status(500).json({ success: false, message: 'Server error fetching vehicles', error: error.message });
  }
};

// 2. Get Vehicle by ID
export const getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    res.json({ success: true, vehicle });
  } catch (error) {
    console.error('Error fetching vehicle by ID:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// 3. Create New Vehicle
export const createVehicle = async (req, res) => {
  try {
    const existing = await Vehicle.findOne({ carNumber: req.body.carNumber });
    if (existing) {
      return res.status(400).json({ success: false, message: '이미 등록된 차량번호입니다.' });
    }

    if (!req.body.no) {
      const count = await Vehicle.countDocuments();
      req.body.no = count + 1;
    }

    // Auto-generate category code if empty or doesn't match prefix pattern
    if (req.body.carModel) {
      const isPattern = /^[A-Za-z0-9]+-\d+$/.test(String(req.body.category || '').trim());
      if (!req.body.category || !isPattern) {
        req.body.category = await generateCategoryCode(req.body.carModel, req.body.category);
      }
    }

    const newVehicle = await Vehicle.create(req.body);
    res.status(201).json({ success: true, vehicle: newVehicle, message: '차량이 성공적으로 등록되었습니다.' });
  } catch (error) {
    console.error('Error creating vehicle:', error);
    res.status(500).json({ success: false, message: '차량 등록 중 오류 발생', error: error.message });
  }
};

// 4. Update Vehicle
export const updateVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: '차량을 찾을 수 없습니다.' });
    }

    // Check duplicate car number if changed
    if (req.body.carNumber && req.body.carNumber !== vehicle.carNumber) {
      const duplicate = await Vehicle.findOne({ carNumber: req.body.carNumber, _id: { $ne: req.params.id } });
      if (duplicate) {
        return res.status(400).json({ success: false, message: '이미 다른 차량에 사용 중인 차량번호입니다.' });
      }
    }

    // Auto-generate category code if model changed, or if category is empty/not in pattern
    if (req.body.carModel) {
      const isPattern = /^[A-Za-z0-9]+-\d+$/.test(String(req.body.category || '').trim());
      const newPrefix = getCarCodePrefix(req.body.carModel);
      const categoryToUse = req.body.category || vehicle.category;
      const matchesPrefix = new RegExp(`^${newPrefix}-\\d+$`, 'i').test(String(categoryToUse || '').trim());

      if (!categoryToUse || !isPattern || !matchesPrefix) {
        req.body.category = await generateCategoryCode(req.body.carModel, req.body.category || vehicle.category);
      }
    }

    const updatedVehicle = await Vehicle.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.json({ success: true, vehicle: updatedVehicle, message: '차량 정보가 업데이트되었습니다.' });
  } catch (error) {
    console.error('Error updating vehicle:', error);
    res.status(500).json({ success: false, message: '차량 정보 수정 실패', error: error.message });
  }
};

// 5. Delete Vehicle
export const deleteVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: '차량을 찾을 수 없습니다.' });
    }
    res.json({ success: true, message: '차량이 성공적으로 삭제되었습니다.' });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    res.status(500).json({ success: false, message: '차량 삭제 실패', error: error.message });
  }
};

export const seedVehicles = async (req = {}, res = null) => {
  try {
    // Drop old indexes if any legacy vehicleNumber_1 exists
    try {
      await Vehicle.collection.dropIndexes();
    } catch (e) {
      // ignore if collection or index doesn't exist
    }

    await Vehicle.deleteMany({});

    const sampleVehicles = [
      {
        no: 1,
        category: '신차 장기',
        operation: '자사 자산',
        contractCompany: '(주)세종물류',
        manager: '김철수 팀장',
        managerPhone: '010-3849-2011',
        carModel: 'E300 Exclusive 4MATIC',
        carSpec: 'AMG 라인 썬루프 포함',
        carPrice: 91500000,
        year: '2024년식',
        color: '옵시디언 블랙',
        fuelType: '휘발유',
        vin: 'W1K2130831A987654',
        carNumber: '17다4134',
        options: '헤드업 디스플레이, 파노라마 선루프, 통풍시트',
        cc: '1,999cc',
        regDate: '2024-01-15',
        contractDate: '2024-01-10',
        deliveryDate: '2024-01-15',
        rentPeriodYears: '3년',
        rentEndDate: '2027-01-14',
        remainingPeriod: '30개월',
        mileage: 18500,
        practicalManager: '이영희 과장',
        practicalPhone: '010-4820-1928',
        branch: '강남지점',
        deliveryAddress: '서울시 강남구 테헤란로 152',
        rentStartDate: '2024-01-15',
        rentPeriodDays: '1095일',
        remainingPeriodCalc: '912일',
        contractNo: 'RB-202401-001',
        basePrice: 89000000,
        discountAmount: 3000000,
        supplyAmount: 78181818,
        consignmentFee: 250000,
        mandatoryInsuranceFee: 450000,
        acquisitionTax: 5800000,
        bond: 350000,
        stampFee: 10000,
        plateFee: 25000,
        regAgencyFee: 50000,
        commission: 1500000,
        dashcam: '설치',
        dashcamInfo: '아이나비 QXD8000 2채널',
        tinting: '시공',
        tintingInfo: '루마 버텍스 900 전측후면',
        regCost1: 6200000,
        regCost2: 0,
        insuranceCompany: '삼성화재',
        insuranceStartDate: '2024-01-15',
        insuranceFee: 1250000,
        ownCarInsuranceFee: 450000,
        tire: '미쉐린 사계절 19인치',
        regularCheckup: '완료(6개월차)',
        driverAge: '만 26세 이상',
        personalInjury1: '무제한',
        propertyDamage: '3억원',
        personalInjury2: '1억원',
        uninsuredCarInjury: '2억원',
        deductible: 300000,
        insuranceType: '법인임직원특약',
        emergencyService: '가입(무제한)',
        accidentRepair: '없음',
        generalMaintenance: '정상',
        consumablesExchange: '엔진오일 교환 완료',
        tireCount: '4본',
        tireType: '미쉐린',
        tireCost: 1200000,
        carTax: '월대여료 포함',
        lender: '현대캐피탈',
        executionDate: '2024-01-12',
        installmentAmount: 60000000,
        installmentPeriod: '36개월',
        monthlyInstallment: 1850000,
        totalMonthlyInstallment: 66600000,
        totalInterest: 6600000,
        interestRate: '4.5%',
        monthlyFeePayDay: '매월 25일',
        invoiceDate: '매월 25일',
        monthlyPayment: 1450000,
        paymentPeriod: '36개월',
        totalMonthlyPayment: 52200000,
        deposit: 15000000,
        advancePayment: 5000000,
        acquisitionValue: 32000000,
        residualRateP: '35%',
        interest2: '4.2%',
        fineEmail: 'sejong_admin@sejonglogis.com',
        managerMobile: '010-3849-2011',
        sellingAdminExpense: 120000,
        gift1: '코일 매트',
        gift1Price: 150000,
        gift2: '하이패스 단말기',
        gift2Price: 80000,
        gift3: '트렁크 정리함',
        gift3Price: 40000,
        gift4: '',
        gift4Price: 0,
        gift5: '',
        gift5Price: 0,
        totalGiftPrice: 270000,
        dealerCompany: '한성자동차 강남전시장',
        salesRepresentative: '박민수 부장',
        showroom: '강남 대치 전시장',
        accountHolder: '(주)렌트베네핏',
        bank: '신한은행',
        accountNo: '110-482-918231',
        bizOrRegNo: '214-88-92019',
        bizAddress: '서울시 서초구 반포대로 42',
        penaltyRate: '10%',
        overdueInterestRate: '12%',
        corporateRegNo: '110111-4920192',
        individualConsumptionTax: 1250000,
        status: 'rented',
        notes: 'VIP 고객 차종 / 대여 만족도 최상'
      },
      {
        no: 2,
        category: '중고 렌트',
        operation: '위탁 운영',
        contractCompany: '(주)글로벌네트웍스',
        manager: '박성훈 이사',
        managerPhone: '010-9182-3741',
        carModel: 'GV80 3.5T 가솔린 AWD',
        carSpec: '6인승 시그니처 디자인 II',
        carPrice: 84000000,
        year: '2023년식',
        color: '비크 블랙',
        fuelType: '휘발유',
        vin: 'KMHN84129PJ102938',
        carNumber: '125호8712',
        options: '파퓰러 패키지, 22인치 휠, 빌트인 캠',
        cc: '3,470cc',
        regDate: '2023-05-20',
        contractDate: '2023-06-01',
        deliveryDate: '2023-06-01',
        rentPeriodYears: '2년',
        rentEndDate: '2025-05-31',
        remainingPeriod: '10개월',
        mileage: 42000,
        practicalManager: '최동현 대리',
        practicalPhone: '010-8271-9281',
        branch: '서초지점',
        deliveryAddress: '서울시 서초구 서초대로 301',
        rentStartDate: '2023-06-01',
        rentPeriodDays: '730일',
        remainingPeriodCalc: '310일',
        contractNo: 'RB-202306-042',
        basePrice: 82000000,
        discountAmount: 2000000,
        supplyAmount: 72727272,
        consignmentFee: 200000,
        mandatoryInsuranceFee: 420000,
        acquisitionTax: 5300000,
        bond: 300000,
        stampFee: 10000,
        plateFee: 25000,
        regAgencyFee: 50000,
        commission: 1200000,
        dashcam: '설치',
        dashcamInfo: '파인뷰 LX7000',
        tinting: '시공',
        tintingInfo: '솔라가드 새턴',
        regCost1: 5600000,
        regCost2: 0,
        insuranceCompany: 'DB손해보험',
        insuranceStartDate: '2023-06-01',
        insuranceFee: 1180000,
        ownCarInsuranceFee: 420000,
        tire: '한국타이어 벤투스 22인치',
        regularCheckup: '완료(12개월차)',
        driverAge: '만 30세 이상',
        personalInjury1: '무제한',
        propertyDamage: '5억원',
        personalInjury2: '1억원',
        uninsuredCarInjury: '2억원',
        deductible: 300000,
        insuranceType: '법인임직원특약',
        emergencyService: '가입',
        accidentRepair: '범퍼 단순도색 1회',
        generalMaintenance: '양호',
        consumablesExchange: '브레이크 패드 교환',
        tireCount: '4본',
        tireType: '한국타이어',
        tireCost: 1400000,
        carTax: '포함',
        lender: 'KB캐피탈',
        executionDate: '2023-05-28',
        installmentAmount: 50000000,
        installmentPeriod: '24개월',
        monthlyInstallment: 2200000,
        totalMonthlyInstallment: 52800000,
        totalInterest: 2800000,
        interestRate: '5.1%',
        monthlyFeePayDay: '매월 10일',
        invoiceDate: '매월 10일',
        monthlyPayment: 1320000,
        paymentPeriod: '24개월',
        totalMonthlyPayment: 31680000,
        deposit: 10000000,
        advancePayment: 0,
        acquisitionValue: 28000000,
        residualRateP: '38%',
        interest2: '4.8%',
        fineEmail: 'global_admin@gnw.co.kr',
        managerMobile: '010-9182-3741',
        sellingAdminExpense: 100000,
        gift1: '골프백 세트',
        gift1Price: 350000,
        gift2: '차량용 공기청정기',
        gift2Price: 120000,
        gift3: '',
        gift3Price: 0,
        gift4: '',
        gift4Price: 0,
        gift5: '',
        gift5Price: 0,
        totalGiftPrice: 470000,
        dealerCompany: '현대자동차 서초지점',
        salesRepresentative: '강성민 차장',
        showroom: '서초 남부순환로 전시장',
        accountHolder: '(주)렌트베네핏',
        bank: '국민은행',
        accountNo: '817-291-029182',
        bizOrRegNo: '107-86-49201',
        bizAddress: '서울시 서초구 서초대로 301',
        penaltyRate: '10%',
        overdueInterestRate: '12%',
        corporateRegNo: '110111-2049182',
        individualConsumptionTax: 1100000,
        status: 'rented',
        notes: '6개월 주기 정기점검 완료'
      },
      {
        no: 3,
        category: '신차 장기',
        operation: '자사 자산',
        contractCompany: '개인 (강윤성 님)',
        manager: '강윤성 님',
        managerPhone: '010-9310-3980',
        carModel: 'AMG GT43 4MATIC+ 4도어',
        carSpec: '가솔린 V6 터보 435마력',
        carPrice: 147000000,
        year: '2024년식',
        color: '셀레나이트 그레이',
        fuelType: '휘발유',
        vin: 'W1K2906591A102938',
        carNumber: '48하9201',
        options: 'AMG 가변 배기, 탄소섬유 트림, 부메스터 오디오',
        cc: '2,999cc',
        regDate: '2024-03-10',
        contractDate: '2024-03-01',
        deliveryDate: '2024-03-10',
        rentPeriodYears: '4년',
        rentEndDate: '2028-03-09',
        remainingPeriod: '44개월',
        mileage: 12000,
        practicalManager: '강윤성 님',
        practicalPhone: '010-9310-3980',
        branch: '송파지점',
        deliveryAddress: '서울시 송파구 올림픽로 300',
        rentStartDate: '2024-03-10',
        rentPeriodDays: '1460일',
        remainingPeriodCalc: '1320일',
        contractNo: 'RB-202403-089',
        basePrice: 143000000,
        discountAmount: 4000000,
        supplyAmount: 127272727,
        consignmentFee: 300000,
        mandatoryInsuranceFee: 550000,
        acquisitionTax: 9800000,
        bond: 600000,
        stampFee: 10000,
        plateFee: 25000,
        regAgencyFee: 50000,
        commission: 2500000,
        dashcam: '설치',
        dashcamInfo: '벤츠 순정 2채널 르노가디언',
        tinting: '시공',
        tintingInfo: '후퍼옵틱 프라티넘',
        regCost1: 10400000,
        regCost2: 0,
        insuranceCompany: 'KB손해보험',
        insuranceStartDate: '2024-03-10',
        insuranceFee: 1950000,
        ownCarInsuranceFee: 680000,
        tire: '피렐리 P ZERO 20인치',
        regularCheckup: '완료(3개월차)',
        driverAge: '만 35세 이상',
        personalInjury1: '무제한',
        propertyDamage: '10억원',
        personalInjury2: '1억원',
        uninsuredCarInjury: '5억원',
        deductible: 500000,
        insuranceType: '개인고객특약',
        emergencyService: '가입(무제한)',
        accidentRepair: '없음',
        generalMaintenance: '최상',
        consumablesExchange: '엔진오일/필터 오리지널 교환',
        tireCount: '4본',
        tireType: '피렐리',
        tireCost: 2200000,
        carTax: '포함',
        lender: '하나캐피탈',
        executionDate: '2024-03-05',
        installmentAmount: 100000000,
        installmentPeriod: '48개월',
        monthlyInstallment: 2450000,
        totalMonthlyInstallment: 117600000,
        totalInterest: 17600000,
        interestRate: '4.8%',
        monthlyFeePayDay: '매월 15일',
        invoiceDate: '매월 15일',
        monthlyPayment: 2150000,
        paymentPeriod: '48개월',
        totalMonthlyPayment: 103200000,
        deposit: 30000000,
        advancePayment: 10000000,
        acquisitionValue: 48000000,
        residualRateP: '34%',
        interest2: '4.5%',
        fineEmail: 'korean_ceo@naver.com',
        managerMobile: '010-9310-3980',
        sellingAdminExpense: 200000,
        gift1: '유리막 코팅 시공권',
        gift1Price: 600000,
        gift2: 'PPF 보호필름 패키지',
        gift2Price: 450000,
        gift3: '벤츠 보스턴백',
        gift3Price: 200000,
        gift4: '',
        gift4Price: 0,
        gift5: '',
        gift5Price: 0,
        totalGiftPrice: 1250000,
        dealerCompany: 'KCC오토 송파전시장',
        salesRepresentative: '정우성 이사',
        showroom: '송파 방이동 벤츠 타워',
        accountHolder: '(주)렌트베네핏',
        bank: '하나은행',
        accountNo: '382-910293-84701',
        bizOrRegNo: '820419-1092831',
        bizAddress: '서울시 송파구 잠실동 201',
        penaltyRate: '15%',
        overdueInterestRate: '12%',
        corporateRegNo: '',
        individualConsumptionTax: 2100000,
        status: 'rented',
        notes: '고성능 스포츠 세단 / 특별 관리 대상'
      }
    ];

    await Vehicle.insertMany(sampleVehicles);
    console.log('[Seed] 113-column vehicle sample data seeded successfully!');

    if (res && res.json) {
      res.json({
        success: true,
        message: '전체 113개 엑셀 컬럼 사양 샘플 데이터가 성공적으로 초기화되었습니다.',
        count: sampleVehicles.length
      });
    }
  } catch (error) {
    console.error('Error seeding vehicles:', error);
    if (res && res.status) {
      res.status(500).json({ success: false, message: '샘플 데이터 시딩 오류', error: error.message });
    }
  }
};

export const seedSampleVehicles = seedVehicles;

