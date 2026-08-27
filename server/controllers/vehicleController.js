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

  for (const [kr, eng] of Object.entries(carModelEngMap)) {
    if (cleaned.toLowerCase().includes(kr.toLowerCase())) {
      return eng.substring(0, 3).toUpperCase();
    }
  }

  const englishWords = cleaned.split(/\s+/).filter(word => /^[A-Za-z0-9]+$/.test(word));
  if (englishWords.length > 0) {
    const wordWithLetters = englishWords.find(word => /[A-Za-z]/.test(word));
    if (wordWithLetters) {
      return wordWithLetters.substring(0, 3).toUpperCase();
    }
    return englishWords[0].substring(0, 3).toUpperCase();
  }

  const englishOnly = cleaned.replace(/[^A-Za-z]/g, '');
  if (englishOnly.length >= 3) {
    return englishOnly.substring(0, 3).toUpperCase();
  }

  return 'CAR';
};

// carModel 기준으로 "GRA-001" 같은 차량 코드를 자동 생성한다.
const generateVehicleCode = async (carModel, currentCode) => {
  const prefix = getCarCodePrefix(carModel);

  const prefixRegex = new RegExp(`^${prefix}-\\d+$`, 'i');
  if (currentCode && prefixRegex.test(String(currentCode).trim())) {
    return String(currentCode).trim();
  }

  const searchRegex = new RegExp(`^${prefix}-\\d+$`, 'i');
  const existingVehicles = await Vehicle.find({ code: searchRegex }).lean();

  let maxSeq = 0;
  existingVehicles.forEach(v => {
    if (v.code) {
      const parts = v.code.split('-');
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

// @desc    Get paginated & filtered vehicles
// @route   GET /api/vehicles
// @access  Public
export const getVehicles = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    const { search, status, fuelType } = req.query;

    let filter = {};

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { code: searchRegex },
        { carModel: searchRegex },
        { plateNo: searchRegex },
        { vin: searchRegex }
      ];
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (fuelType && fuelType !== 'all') {
      filter.fuelType = fuelType;
    }

    const [vehicles, totalCount, statsResult] = await Promise.all([
      Vehicle.find(filter)
        .populate({
          path: 'contract',
          select: 'contractNo customer companyId partyType',
          populate: [
            { path: 'customer', select: 'name surname givenName' },
            { path: 'companyId', select: 'name' }
          ]
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Vehicle.countDocuments(filter),
      Vehicle.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    const stats = { total: 0, rented: 0, available: 0, maintenance: 0, reserved: 0 };
    statsResult.forEach(item => {
      if (item._id && Object.prototype.hasOwnProperty.call(stats, item._id)) {
        stats[item._id] = item.count;
      }
      stats.total += item.count;
    });

    const totalPages = Math.ceil(totalCount / limit) || 1;

    res.json({
      success: true,
      vehicles,
      pagination: { totalCount, totalPages, currentPage: page, limit },
      stats
    });
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.status(500).json({ success: false, message: 'Server error fetching vehicles', error: error.message });
  }
};

// @desc    Get vehicle by ID
// @route   GET /api/vehicles/:id
// @access  Public
export const getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id).populate({
      path: 'contract',
      populate: [{ path: 'customer' }, { path: 'companyId', select: 'name' }]
    });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    res.json({ success: true, vehicle });
  } catch (error) {
    console.error('Error fetching vehicle by ID:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Create new vehicle (standalone / not tied to a contract - 예: 재고 차량)
// @route   POST /api/vehicles
// @access  Public
export const createVehicle = async (req, res) => {
  try {
    if (req.body.plateNo && req.body.plateNo.trim()) {
      const existing = await Vehicle.findOne({ plateNo: req.body.plateNo.trim() });
      if (existing) {
        return res.status(400).json({ success: false, message: '이미 등록된 차량번호입니다.' });
      }
    }

    if (!req.body.code) {
      req.body.code = await generateVehicleCode(req.body.carModel, req.body.code);
    }

    const newVehicle = await Vehicle.create(req.body);
    res.status(201).json({ success: true, vehicle: newVehicle, message: '차량이 성공적으로 등록되었습니다.' });
  } catch (error) {
    console.error('Error creating vehicle:', error);
    res.status(500).json({ success: false, message: '차량 등록 중 오류 발생', error: error.message });
  }
};

// @desc    Update vehicle
// @route   PUT /api/vehicles/:id
// @access  Public
export const updateVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: '차량을 찾을 수 없습니다.' });
    }

    if (req.body.plateNo && req.body.plateNo !== vehicle.plateNo) {
      const duplicate = await Vehicle.findOne({ plateNo: req.body.plateNo, _id: { $ne: req.params.id } });
      if (duplicate) {
        return res.status(400).json({ success: false, message: '이미 다른 차량에 사용 중인 차량번호입니다.' });
      }
    }

    if (req.body.carModel && req.body.carModel !== vehicle.carModel && !req.body.code) {
      req.body.code = await generateVehicleCode(req.body.carModel, vehicle.code);
    }

    const updatedVehicle = await Vehicle.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.json({ success: true, vehicle: updatedVehicle, message: '차량 정보가 업데이트되었습니다.' });
  } catch (error) {
    console.error('Error updating vehicle:', error);
    res.status(500).json({ success: false, message: '차량 정보 수정 실패', error: error.message });
  }
};

// @desc    Delete vehicle
// @route   DELETE /api/vehicles/:id
// @access  Public
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
