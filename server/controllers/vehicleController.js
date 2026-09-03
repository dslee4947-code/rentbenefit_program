import XLSX from 'xlsx';
import Vehicle from '../models/Vehicle.js';
import Company from '../models/Company.js';
import Contract from '../models/Contract.js';
import { buildScheduleForContract } from './billingScheduleController.js';
import { ensureCustomerFolders, buildContractFolderName, sanitizePathSegment } from '../utils/documentStorageService.js';
import path from 'path';
import fs from 'fs';
import Customer from '../models/Customer.js';
import { looksLikeResidentRegistrationNumber } from '../utils/validators.js';

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
          select: 'contractNo customer companyId partyType status managerMain managerMainPhone managerOps managerOpsPhone',
          populate: [
            { path: 'customer', select: 'name surname givenName' },
            // 목록 자체는 법인명만 쓰지만, 수정 모달이 목록 데이터를 그대로 열어
            // 법인 정보를 보여주므로 상세와 같은 항목을 함께 내려준다.
            // (페이지당 건수가 제한돼 있어 늘어나는 응답 크기는 미미하다)
            { path: 'companyId', select: 'name bizNo bizType ceoName address billingEmail corporateRegistrationNo' }
          ]
        })
        // 계약서 없이 직접 등록된 차량은 contract가 없고 company를 직접 가리킨다
        .populate('company', 'name bizNo bizType ceoName address billingEmail corporateRegistrationNo')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Vehicle.countDocuments(filter),
      Vehicle.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    const stats = { total: 0, '계약중': 0, '장기렌트': 0, '사고대차': 0, '예약': 0, '거래완료': 0 };
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
      // 상세 화면에서 법인 정보를 보여주므로 이름만이 아니라 법인 관리에 입력된 항목을 함께 가져온다.
      // 차량에 복사해 두지 않고 계약을 통해 참조하므로, 법인 정보를 고치면 여기에도 바로 반영된다.
      populate: [
        { path: 'customer' },
        { path: 'companyId', select: 'name bizNo bizType ceoName address billingEmail' }
      ]
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

/**
 * 계약자 입력을 법인 연결로 바꾼다. 엑셀 일괄 업로드와 화면 저장이 함께 쓴다.
 *
 * overwrite=false (엑셀 업로드): 법인의 비어 있던 항목만 채운다.
 *   법인 관리에서 정리해 둔 정보를 일괄 업로드가 되돌리면 안 되기 때문이다.
 * overwrite=true (화면에서 직접 수정): 사용자가 그 값을 보면서 고친 것이므로 입력한 대로 반영한다.
 *
 * @returns {Promise<{partyType: string, company: object|null, contractorName: string, createdCompanyName: string|null}>}
 */
const resolveCompanyLink = async ({ partyType, companyInput = {}, contractorName, overwrite = false }) => {
  // 어느 법인을 고칠지 id로 정해서 왔다면 그건 '이 법인을 고쳐라'는 뜻이므로 계약구분과 무관하게 처리한다.
  // 계약으로 만들어진 차량은 법인을 계약이 들고 있어 차량 쪽 partyType이 '개인'인데,
  // 그것 때문에 법인 정보 수정이 통째로 무시되던 문제가 있었다.
  const editingKnownCompany = Boolean(companyInput._id);

  const isCorporate = editingKnownCompany || (partyType
    ? String(partyType).startsWith('법인')
    : Boolean(companyInput.bizNo || companyInput.corporateRegistrationNo));

  if (!isCorporate) {
    return { partyType: '개인', company: null, contractorName: contractorName || '', createdCompanyName: null };
  }

  const companyName = contractorName || companyInput.name || companyInput.ceoName;

  // 어느 법인을 고치는지 id로 정해서 온 경우(계약에 이미 연결된 법인을 화면에서 수정할 때)는
  // 그 법인을 그대로 고친다. 사업자번호로 다시 찾으면, 사업자번호 자체를 고치는 순간
  // 못 찾고 같은 법인을 하나 더 만들어 버린다.
  let company = companyInput._id
    ? await Company.findById(companyInput._id)
    : (companyInput.bizNo
      ? await Company.findOne({ bizNo: companyInput.bizNo })
      : (companyName ? await Company.findOne({ name: companyName }) : null));

  let createdCompanyName = null;

  if (company) {
    let touched = false;
    if (overwrite && companyName && !companyInput.name && company.name !== companyName) {
      company.name = companyName;
      touched = true;
    }
    ['name', 'ceoName', 'bizNo', 'corporateRegistrationNo', 'address', 'billingEmail'].forEach((field) => {
      if (field === 'name' && !overwrite) return; // 일괄 업로드는 법인명을 바꾸지 않는다
      const value = companyInput[field];
      if (value === undefined) return;
      if (overwrite ? company[field] !== value : (!company[field] && value)) {
        company[field] = value;
        touched = true;
      }
    });
    if (touched) await company.save();
  } else if (companyName || companyInput.bizNo) {
    const { _id, ...newCompanyFields } = companyInput;
    company = await Company.create({
      name: companyName || companyInput.bizNo,
      bizType: '법인사업자',
      ...newCompanyFields
    });
    createdCompanyName = company.name;
  }

  return {
    // id로 지정해 고친 경우엔 계약구분을 바꾸지 않는다(계약이 정본이다)
    partyType: editingKnownCompany && partyType ? partyType : '법인',
    company,
    contractorName: '',
    createdCompanyName
  };
};

/**
 * 요청 본문의 계약자 입력(_company/_contractorName)을 차량에 저장할 형태로 바꾼다.
 * '_'로 시작하는 키는 차량 스키마에 없으므로 여기서 소비하고 지운다.
 */
const applyCompanyLinkToBody = async (body) => {
  if (!('_company' in body) && !('_contractorName' in body)) return;

  const companyInput = body._company || {};
  const contractorName = body._contractorName;
  delete body._company;
  delete body._contractorName;

  const linked = await resolveCompanyLink({
    partyType: body.partyType,
    companyInput,
    contractorName,
    overwrite: true
  });

  // 계약에 묶인 차량은 계약이 정본이라, 차량의 법인 연결과 계약구분을 여기서 바꾸지 않는다.
  // (법인 정보 자체는 위에서 이미 고쳐졌고, 그 법인을 쓰는 모든 곳에 반영된다)
  if (body._keepContractLink) {
    delete body._keepContractLink;
    return;
  }

  body.partyType = linked.partyType;
  body.contractorName = linked.contractorName;
  body.company = linked.company ? linked.company._id : null;

  // 차량에 출금 계좌를 따로 적지 않았으면 법인에 등록된 통장을 가져와 채운다.
  // 차량마다 계좌가 다를 수 있으므로, 이미 적혀 있으면 덮어쓰지 않는다.
  const companyBank = linked.company?.bank;
  const hasOwnBank = body.banking && (body.banking.holder || body.banking.bankName || body.banking.accountNo);
  if (companyBank && !hasOwnBank && (companyBank.holder || companyBank.bankName || companyBank.accountNo)) {
    body.banking = {
      holder: companyBank.holder || '',
      bankName: companyBank.bankName || '',
      accountNo: companyBank.accountNo || ''
    };
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

    await applyCompanyLinkToBody(req.body);

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

    // 계약서가 보관된 계약의 차량은 고칠 수 없다.
    // 보관은 "이 계약 내용을 확정했다"는 뜻이라, 확정 후 차량 정보가 조용히 바뀌면
    // 이미 나간 계약서·청구서와 값이 어긋난다. 고치려면 계약서를 먼저 되돌려야 한다.
    if (vehicle.contract) {
      const contract = await Contract.findById(vehicle.contract).select('status contractNo').lean();
      if (contract?.status === '보관됨') {
        return res.status(409).json({
          success: false,
          locked: true,
          message: `계약번호 ${contract.contractNo} 계약서가 보관되어 있어 차량 정보를 수정할 수 없습니다. 계약서 등록 화면에서 되돌린 뒤 수정해 주세요.`
        });
      }
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

    await applyCompanyLinkToBody(req.body);

    const updatedVehicle = await Vehicle.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('company', 'name bizNo bizType ceoName corporateRegistrationNo address billingEmail');

    // 청구 회차표를 다시 만든다.
    //
    // 회차표를 만들려면 월 대여료 결제일과 렌트료 게시일이 있어야 하는데 둘 다 출고 준비에서 정한다.
    // 그래서 계약 등록 때는 대개 못 만들고 넘어가고, 여기서 처음 만들어진다.
    // 이걸 안 하면 회차표가 없어 청구 대상 목록에 영영 뜨지 않는다.
    // 이미 청구가 나간 회차는 buildScheduleForContract가 그대로 두므로 다시 만들어도 안전하다.
    let billingMessage = '';
    if (updatedVehicle?.contract) {
      try {
        const schedule = await buildScheduleForContract(updatedVehicle.contract);
        billingMessage = ` 청구 회차표 ${schedule.rounds.length}회차가 준비되었습니다.`;
      } catch (err) {
        // 아직 값이 덜 찬 것뿐이라 차량 저장까지 되돌리지 않는다. 무엇이 빠졌는지만 알려 준다.
        billingMessage = ` (청구 회차표는 아직 만들지 못했습니다: ${err.message})`;
      }
    }

    res.json({
      success: true,
      vehicle: updatedVehicle,
      message: `차량 정보가 업데이트되었습니다.${billingMessage}`
    });
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

/**
 * 엑셀 양식의 열 정의. 계약서 업로드와 같은 방식으로, 열 제목을 정규화해 맞춘다.
 * labels의 첫 값이 양식에 찍히는 제목이고, 나머지는 사용자가 제목을 조금 바꿔도
 * 읽히도록 하는 별칭이다. 순서가 곧 양식의 열 순서다.
 *
 * 고객/법인/계약 정보는 여기에 없다. 차량이 아니라 계약에 속한 정보라
 * 계약서 등록에서 연결된다(차량 DB는 contract 참조만 가진다).
 */
const VEHICLE_EXCEL_COLUMNS = [
  // 계약자 - 사업자번호가 있으면 법인을 찾아 연결하고, 없으면 그 정보로 법인을 새로 만든다
  { key: 'partyType', type: 'text', labels: ['계약구분'], hint: '법인 / 개인' },
  { key: '_contractorName', type: 'text', labels: ['계약자', '계약사'], hint: '법인이면 법인명, 개인이면 이름' },
  { key: '_company.ceoName', type: 'text', labels: ['대표자명'] },
  { key: '_company.bizNo', type: 'text', labels: ['사업자번호', '사업자/주민번호'], hint: '이 번호로 법인을 찾아 연결' },
  { key: '_company.corporateRegistrationNo', type: 'text', labels: ['법인등록번호', '법인/식별번호'] },
  { key: '_company.address', type: 'text', labels: ['사업장주소', '사업장 주소', '사업자 주소'] },
  { key: '_company.billingEmail', type: 'text', labels: ['청구이메일', '청구서수신이메일'] },

  { key: 'banking.holder', type: 'text', labels: ['예금주명', '예금주'] },
  { key: 'banking.bankName', type: 'text', labels: ['은행'] },
  { key: 'banking.accountNo', type: 'text', labels: ['계좌번호'] },

  { key: 'loan.executed', type: 'boolean', labels: ['대출실행'], hint: '실행/미실행' },
  { key: 'loan.lender', type: 'text', labels: ['차용처'] },
  { key: 'loan.executedDate', type: 'date', labels: ['실행일'], hint: 'YYYY-MM-DD' },
  { key: 'loan.amount', type: 'number', labels: ['할부이용금액'] },
  { key: 'loan.termMonths', type: 'number', labels: ['할부기간', '기간'] },
  { key: 'loan.monthlyPayment', type: 'number', labels: ['월할부금'] },

  { key: 'code', type: 'text', labels: ['차량코드', '구분'], hint: '비우면 차종 기준으로 자동 생성' },
  { key: 'carModel', type: 'text', labels: ['차종'], required: true, hint: '예: 그랜저 하이브리드' },
  { key: 'carSpec', type: 'text', labels: ['사양', '차량 사양'] },
  { key: 'fuelType', type: 'text', labels: ['유종'], hint: '가솔린/디젤/LPG/하이브리드/전기' },
  { key: 'cc', type: 'number', labels: ['배기량', '배기량cc', 'CC'] },
  { key: 'exteriorColor', type: 'text', labels: ['외장색상', '외장색', '색상'] },
  { key: 'interiorColor', type: 'text', labels: ['내장색상', '내장색'] },
  { key: 'options', type: 'text', labels: ['옵션', '차량옵션'] },

  { key: 'year', type: 'text', labels: ['연식'], hint: '예: 2026년식' },
  { key: 'vin', type: 'text', labels: ['차대번호', '차대 번호'] },
  { key: 'plateNo', type: 'text', labels: ['차량번호', '차량 번호'] },
  { key: 'registrationDate', type: 'date', labels: ['등록일'], hint: 'YYYY-MM-DD' },

  { key: 'carPrice', type: 'number', labels: ['차량가', '차량가격'] },
  { key: 'discount', type: 'number', labels: ['할인금액'] },
  { key: 'supplyPrice', type: 'number', labels: ['공급가액'] },
  { key: 'deliveryFee', type: 'number', labels: ['탁송료'] },
  { key: 'acquisitionTax', type: 'number', labels: ['취득세'] },
  { key: 'publicBond', type: 'number', labels: ['공채'] },
  { key: 'registrationAgencyFee', type: 'number', labels: ['등록대행료'] },
  { key: 'deposit', type: 'number', labels: ['보증금'] },
  { key: 'advancePayment', type: 'number', labels: ['선수금'] },
  { key: 'takeoverPrice', type: 'number', labels: ['인수가'] },
  { key: 'monthlyFee', type: 'number', labels: ['월렌트료', '월대여료', '월 납입금'] },
  { key: 'paymentTerm', type: 'number', labels: ['납입개월수', '납입기간'] },
  { key: 'individualConsumptionTax', type: 'number', labels: ['자동차세', '개별소비세'], hint: '계약기간 총액' },

  { key: 'status', type: 'text', labels: ['상태', '운영'], hint: '장기렌트/사고대차/예약/거래완료 (비우면 장기렌트)' },

  { key: 'insurance.company', type: 'text', labels: ['보험사', '보험 회사'] },
  { key: 'insurance.type', type: 'text', labels: ['보험등급'], hint: '일반형/고급형' },
  { key: 'insurance.driverAge', type: 'text', labels: ['운전자연령'] },
  { key: 'insurance.liabilityLimit', type: 'text', labels: ['대인'] },
  { key: 'insurance.propertyLimit', type: 'text', labels: ['대물'] },
  { key: 'insurance.personalInjury', type: 'text', labels: ['자기신체'] },
  { key: 'insurance.uninsuredInjury', type: 'text', labels: ['무보험차상해'] },
  { key: 'insurance.deductible', type: 'number', labels: ['자기부담금'] },
  { key: 'insurance.emergencyService', type: 'text', labels: ['긴급출동'] },

  { key: 'maintenance.enabled', type: 'boolean', labels: ['정비가입'], hint: '가입/미가입' },
  { key: 'maintenance.tireType', type: 'text', labels: ['타이어등급', '타이어'] },
  { key: 'maintenance.mileage', type: 'number', labels: ['연간주행거리', '약정주행거리', '운행 거리'] },
  { key: 'maintenance.regularCheck', type: 'text', labels: ['순회점검', '정기점검'] },
  { key: 'maintenance.consumables', type: 'text', labels: ['소모품'] },
  { key: 'maintenance.generalMaintenance', type: 'text', labels: ['일반정비'] },

  { key: 'deliveryDate', type: 'date', labels: ['인도일', '인도 날짜'], hint: 'YYYY-MM-DD' },
  { key: 'rentBillingDate', type: 'date', labels: ['렌트료게시일', '렌트료 개시일'], hint: 'YYYY-MM-DD' },
  { key: 'monthlyPaymentDay', type: 'text', labels: ['월결제일', '월 대여료 결제일'], hint: '5 / 10 / 15 / 25 / 말일' },
  { key: 'interestRate', type: 'number', labels: ['금리'], hint: '퍼센트 (예: 6)' },
  { key: 'lateInterestRate', type: 'number', labels: ['연체이율'], hint: '연 %' },
  { key: 'earlyTerminationRate', type: 'number', labels: ['중도해지수수료율', '위약금률'], hint: '%' },
  { key: 'companyCommission', type: 'number', labels: ['회사수수료'] },
  { key: 'dealerCommission', type: 'number', labels: ['타딜러수수료'] },
  { key: 'sellingAdminExpense', type: 'number', labels: ['판관비'] },
  { key: 'driver', type: 'text', labels: ['운전자'] },
  { key: 'vehicleManager', type: 'text', labels: ['차량관리자'] },

  { key: 'accessories.blackboxPrice', type: 'number', labels: ['블랙박스가격', '블랙박스'] },
  { key: 'accessories.blackboxInfo', type: 'text', labels: ['블랙박스정보'] },
  { key: 'accessories.tintingPrice', type: 'number', labels: ['틴팅가격'] },
  { key: 'accessories.tintingInfo', type: 'text', labels: ['틴팅정보', '선팅정보', '썬팅정보'] },
  { key: 'accessories.tireInfo', type: 'text', labels: ['타이어정보'] },

  // 아래는 차량이 아니라 '계약'을 만들 때 쓰는 값이다.
  // 계약번호가 같은 줄끼리 묶어 계약 한 건으로 만들고, 그 계약으로 청구 회차표가 생긴다.
  { key: '_contractNo', type: 'text', labels: ['계약번호'], hint: '같은 번호끼리 한 계약으로 묶임' },
  { key: '_contractDate', type: 'date', labels: ['계약일'], hint: 'YYYY-MM-DD' },
  { key: '_rentYears', type: 'number', labels: ['렌트 기간(Y)', '렌트기간년'], hint: '년 단위 (예: 4)' },
  { key: '_finesEmail', type: 'text', labels: ['범칙금 E-MAIL', '범칙금이메일'] },
  { key: '_managerMain', type: 'text', labels: ['책임담당자'] },
  { key: '_managerOps', type: 'text', labels: ['실무담당자'] },
  { key: '_branch', type: 'text', labels: ['지점'] }
];

// 다음 고객 코드. 대량 업로드 한 번 동안만 기억한다.
let customerSeqCache = null;

/**
 * 겹치지 않는 고객 코드(CUST000123)를 만든다.
 *
 * 자리수를 맞추지 않고 저장된 코드가 섞여 있어(CUST18563과 CUST023924가 함께 있다)
 * 문자열로 정렬하면 가장 큰 번호를 찾지 못한다. 그래서 숫자로 바꿔 최댓값을 구한다.
 * 한 번 구한 뒤에는 메모리에서 이어 붙여, 163줄을 올리는 동안 매번 다시 세지 않는다.
 *
 * @returns {Promise<string>} 고객 코드
 */
const nextCustomerId = async () => {
  if (customerSeqCache === null) {
    const all = await Customer.find({ customerId: /^CUST\d+$/ }).select('customerId').lean();
    customerSeqCache = all.reduce((max, c) => {
      const n = Number(String(c.customerId).slice(4));
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
  }
  for (let tries = 0; tries < 100; tries += 1) {
    customerSeqCache += 1;
    const candidate = `CUST${String(customerSeqCache).padStart(6, '0')}`;
    if (!(await Customer.findOne({ customerId: candidate }).select('_id').lean())) return candidate;
  }
  throw new Error('고객 코드를 만들지 못했습니다.');
};

/**
 * 계약자에 해당하는 고객(Customer)을 찾거나 만든다.
 *
 * 계약(Contract)에 customer가 반드시 있어야 해서, 대량 업로드에서도 하나씩 맞춰 준다.
 * 이름이 같으면 같은 고객으로 본다. 사업자번호로 먼저 찾는 이유는 상호가 조금씩
 * 다르게 적히는 일이 잦아서다(㈜/주식회사 표기 차이 등).
 *
 * @param {object} params
 * @param {string} params.name 계약자명
 * @param {string} [params.bizNo] 사업자번호
 * @param {object} [params.company] 연결된 법인
 * @returns {Promise<object>} 고객
 */
const findOrCreateCustomer = async ({ name, bizNo, company }) => {
  let customer = bizNo ? await Customer.findOne({ bizNo }) : null;
  if (!customer) customer = await Customer.findOne({ name });
  if (customer) return customer;

  const customerId = await nextCustomerId();
  return Customer.create({
    customerId,
    name,
    ...(bizNo ? { bizNo } : {}),
    ceoName: company?.ceoName,
    address: company?.address,
    email: company?.billingEmail,
    source: 'excel'
  });
};

/**
 * 계약 기간(개월)을 정한다. 실제 운영 엑셀은 '렌트 기간(Y)'에 년 단위로 적혀 있고,
 * 새 양식은 '납입개월수'에 개월로 적힌다. 둘 다 받는다.
 *
 * @param {object} row 한 줄에서 뽑은 값
 * @returns {number} 개월 수
 */
const resolveTermMonths = (row) => {
  if (row.paymentTerm) return Number(row.paymentTerm);
  if (row._rentYears) return Math.round(Number(row._rentYears) * 12);
  return 0;
};

/**
 * 엑셀에 계약번호가 비어 있을 때만 쓰는 채번. 계약서 등록 화면과 같은 규칙이다.
 * @param {object} customer 고객
 * @param {Date} date 계약일
 * @returns {Promise<string>} 계약번호
 */
const generateContractNoForImport = async (customer, date) => {
  const prefix = `${customer.customerId || 'CUST000'}-${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, '0')}-`;
  const count = await Contract.countDocuments({ contractNo: new RegExp('^' + prefix) });
  return `${prefix}${String(count + 1).padStart(2, '0')}`;
};

const STATUS_BY_LABEL = {
  '장기렌트': '장기렌트', '사고대차': '사고대차', '예약': '예약', '거래완료': '거래완료',
  // 이전 상태값으로 올라온 엑셀도 새 분류로 매핑해 받아준다
  '가용': '장기렌트', '대여중': '장기렌트', '정비': '사고대차',
  // 운영 엑셀의 '운영' 열에 쓰던 값들
  '계약전': '예약', '계약변경': '거래완료'
};

const normalizeHeader = (value) => String(value ?? '').replace(/[\s()·/_-]/g, '').toLowerCase();

const parseExcelDate = (value) => {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  // 엑셀은 날짜를 1900-01-00 기준 일련번호로 저장한다
  if (typeof value === 'number') {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
};

const parseCellValue = (raw, type) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;

  if (type === 'number') {
    // "1,200,000원" 처럼 단위나 쉼표가 섞여 들어와도 읽는다
    const digits = String(raw).replace(/[^0-9.-]/g, '');
    const num = Number(digits);
    return Number.isFinite(num) ? num : undefined;
  }
  if (type === 'date') return parseExcelDate(raw);
  if (type === 'boolean') {
    // 부정 표현을 나열하고 나머지를 참으로 본다.
    // '미실행'이 빠져 있으면 '실행'과 구분되지 않아 반대로 저장되므로 항목마다 짝을 맞춘다.
    const text = String(raw).trim();
    return !/^(미가입|미실행|미적용|해당없음|없음|아니오|n|no|false|0|x)$/i.test(text);
  }
  return String(raw).trim();
};

// 퍼센트로 쓰는 값들. 엑셀에서 25%로 보이는 칸은 실제로 0.25로 저장돼 있어 되돌려 준다.
const PERCENT_KEYS = new Set(['lateInterestRate', 'earlyTerminationRate', 'interestRate']);

/**
 * 퍼센트 칸을 사람이 읽는 값(25)으로 맞춘다.
 *
 * 0 < 값 <= 1 이면 엑셀 퍼센트 서식으로 보고 100을 곱한다.
 * 연체 이율이 1% 이하인 계약은 없으므로 이 기준으로 갈라도 안전하다.
 *
 * @param {number} value 셀 값
 * @returns {number} 퍼센트 값
 */
const normalizePercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return n;
  return n <= 1 ? Number((n * 100).toFixed(3)) : n;
};

/**
 * 결제일 표기를 맞춘다. 운영 엑셀에는 '말', '말일', '매월 말일'이 섞여 있는데
 * 날짜 계산은 '말일' 하나만 알아본다. 숫자는 문자열로 바꾼다.
 *
 * @param {string|number} value 셀 값
 * @returns {string} 결제일
 */
const normalizePaymentDay = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return text;
  if (/말/.test(text)) return '말일';
  const digits = text.replace(/[^0-9]/g, '');
  return digits || text;
};

const setNestedValue = (target, path, value) => {
  const parts = path.split('.');
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    node[parts[i]] = node[parts[i]] || {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
};

// @desc    차량 일괄 등록용 엑셀 양식 내려받기
// @route   GET /api/vehicles/template
// @access  Public
export const getVehicleTemplate = async (req, res) => {
  try {
    // 1행: 열 제목(업로드 시 이 줄을 보고 열을 찾는다)
    // 2행: 입력 안내. 업로드할 때는 값이 아니라 안내문인지 판별해 건너뛴다.
    const headerRow = VEHICLE_EXCEL_COLUMNS.map((col) => col.labels[0] + (col.required ? ' *' : ''));
    const hintRow = VEHICLE_EXCEL_COLUMNS.map((col) => col.hint || '');

    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, hintRow]);
    worksheet['!cols'] = VEHICLE_EXCEL_COLUMNS.map((col) => ({
      wch: Math.max(12, col.labels[0].length * 2 + 2)
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '차량DB_양식');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="RentVehicle_Template.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error('Error building vehicle template:', error);
    res.status(500).json({ success: false, message: '양식 생성 실패', error: error.message });
  }
};

// @desc    엑셀로 차량 일괄 등록
// @route   POST /api/vehicles/import
// @access  Public
export const importVehicles = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '업로드된 파일이 없습니다.' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

    if (rows.length < 2) {
      return res.status(400).json({ success: false, message: '엑셀에 입력된 데이터가 없습니다.' });
    }

    // 열 제목 -> 컬럼 정의 매핑
    const columnByIndex = {};
    (rows[0] || []).forEach((header, index) => {
      const normalized = normalizeHeader(header).replace(/\*$/, '');
      const column = VEHICLE_EXCEL_COLUMNS.find((col) =>
        col.labels.some((label) => normalizeHeader(label) === normalized)
      );
      if (column) columnByIndex[index] = column;
    });

    if (!Object.values(columnByIndex).some((col) => col.key === 'carModel')) {
      return res.status(400).json({
        success: false,
        message: '"차종" 열을 찾지 못했습니다. 내려받은 양식의 첫 줄(열 제목)을 지우거나 바꾸지 말고 그대로 사용해 주세요.'
      });
    }

    const hintTexts = new Set(VEHICLE_EXCEL_COLUMNS.map((col) => col.hint).filter(Boolean));
    const created = [];
    const errors = [];
    const createdCompanies = []; // 업로드 중 새로 만들어진 법인 (사용자에게 알려 준다)
    const partyNames = new Set(); // 폴더를 만들 계약자. 한 법인에 차가 여러 대여도 폴더는 하나다

    // 계약 1건 = 청구가 같은 회차로 도는 차량 묶음.
    //
    // 묶는 기준은 인도일이 아니라 '렌트료 개시일'이다.
    // 실제로 보내던 청구서를 맞춰 보니, 인도일이 2/4·2/8·2/11·3/2로 갈리는 차 8대가
    // 개시일이 모두 3/5로 같아서 한 장으로 나가고 있었다.
    // 회차는 개시일로 도니 개시일이 같으면 같은 청구서에 실을 수 있고,
    // 인도가 늦은 차는 첫 달에 일할로 정산된다.
    //
    // 계약번호로 묶지 않는 이유: 초기에 차 한 대마다 번호를 따로 매겨서
    // 같은 조건으로 나간 20대가 계약 20건으로 쪼개져 있다(청구서가 매달 20장이 된다).
    // 계약번호는 묶음에서 가장 빠른 번호를 대표로 쓴다.
    const contractGroups = new Map();
    customerSeqCache = null; // 업로드마다 다시 센다

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const excelRowNo = rowIndex + 1; // 엑셀 화면의 행 번호(1행이 제목)

      // 양식 2행의 안내문을 그대로 두고 업로드하는 경우가 많아 걸러낸다
      const looksLikeHintRow = row.some((cell) => hintTexts.has(String(cell ?? '').trim()));
      if (looksLikeHintRow) continue;

      const payload = {};
      Object.entries(columnByIndex).forEach(([index, column]) => {
        let value = parseCellValue(row[index], column.type);
        if (value === undefined) return;
        if (PERCENT_KEYS.has(column.key)) value = normalizePercent(value);
        if (column.key === 'monthlyPaymentDay') value = normalizePaymentDay(value);
        setNestedValue(payload, column.key, value);
      });

      if (!payload.carModel) {
        // 완전히 빈 줄은 조용히 건너뛰고, 뭔가 적혀 있는데 차종만 없으면 알려준다
        if (row.some((cell) => String(cell ?? '').trim() !== '')) {
          errors.push({ row: excelRowNo, message: '차종이 비어 있어 건너뛰었습니다.' });
        }
        continue;
      }

      // 계약자 정보를 법인 연결로 바꾼다.
      // '_'로 시작하는 키는 차량에 저장하지 않고 여기서 소비한다.
      const companyInput = payload._company || {};
      const contractorName = payload._contractorName;
      delete payload._company;
      delete payload._contractorName;

      // 사업자번호 칸에 주민등록번호가 적힌 줄은 개인 계약자다.
      // 운영 엑셀은 '사업자/주민번호' 한 칸에 둘을 같이 쓰는데, 법인으로 만들려 하면
      // 주민등록번호는 저장이 거부되어 그 줄 전체가 등록되지 않는다.
      // 주민등록번호는 어디에도 저장하지 않고, 이름만 개인 계약자로 남긴다.
      if (looksLikeResidentRegistrationNumber(companyInput.bizNo)) {
        errors.push({
          row: excelRowNo,
          message: `${contractorName || '이 줄'}은 주민등록번호가 적혀 있어 개인 계약자로 등록했습니다. 번호는 저장하지 않았습니다.`
        });
        delete companyInput.bizNo;
        delete companyInput.corporateRegistrationNo;
        payload.partyType = '개인';
      }

      try {
        const linked = await resolveCompanyLink({
          partyType: payload.partyType,
          companyInput,
          contractorName,
          overwrite: false
        });
        payload.partyType = linked.partyType;
        if (linked.createdCompanyName) createdCompanies.push(linked.createdCompanyName);

        if (linked.partyType === '법인') {
          if (linked.company) {
            payload.company = linked.company._id;
            partyNames.add(linked.company.name);
          } else {
            errors.push({ row: excelRowNo, message: '법인명과 사업자번호가 모두 비어 법인을 연결하지 못했습니다.' });
          }
        } else if (linked.contractorName) {
          payload.contractorName = linked.contractorName;
          partyNames.add(linked.contractorName);
        }
      } catch (err) {
        errors.push({ row: excelRowNo, message: `법인 연결 실패: ${err.message}` });
      }

      if (payload.status) {
        const mapped = STATUS_BY_LABEL[payload.status];
        if (!mapped) {
          errors.push({ row: excelRowNo, message: `상태 "${payload.status}"를 알 수 없어 '장기렌트'로 등록했습니다.` });
        }
        payload.status = mapped || '장기렌트';
      }
      if (payload.insurance?.type) {
        payload.insurance.type = payload.insurance.type === '고급형' || payload.insurance.type === 'premium'
          ? 'premium'
          : 'standard';
      }

      // 계약을 만들 값은 차량에 저장하지 않는다
      const contractInfo = {
        contractNo: String(payload._contractNo || '').trim(),
        contractDate: payload._contractDate,
        rentYears: payload._rentYears,
        finesEmail: payload._finesEmail,
        managerMain: payload._managerMain,
        managerOps: payload._managerOps,
        branch: payload._branch,
        paymentTerm: payload.paymentTerm,
        partyName: payload.company ? (await Company.findById(payload.company).select('name').lean())?.name : payload.contractorName
      };
      ['_contractNo', '_contractDate', '_rentYears', '_finesEmail', '_managerMain', '_managerOps', '_branch']
        .forEach((k) => delete payload[k]);

      let vehicle;
      try {
        // 엑셀에 코드가 적혀 있으면 그대로 쓴다. 회사에서 쓰던 코드라 바꾸면 다른 장부와 대조가 안 된다.
        payload.code = String(payload.code || '').trim() || await generateVehicleCode(payload.carModel, '');
        vehicle = await Vehicle.create(payload);
        created.push(vehicle);
      } catch (err) {
        errors.push({ row: excelRowNo, message: err.message });
        continue;
      }

      // 계약이 될 수 없는 줄은 차량만 등록하고 넘어간다.
      // 사고대차·계약전처럼 렌트 계약이 아닌 차도 있어서 막지 않는다.
      if (payload.status !== '장기렌트') continue;

      const ymd = (d) => (d instanceof Date && !Number.isNaN(d.getTime())
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        : '');
      const key = [
        contractInfo.partyName || '',
        // 개시일이 없으면 인도일로 대신한다(개시일을 안 적은 계약이 있다)
        ymd(payload.rentBillingDate) || ymd(payload.deliveryDate),
        String(payload.monthlyPaymentDay || ''),
        resolveTermMonths({ paymentTerm: contractInfo.paymentTerm, _rentYears: contractInfo.rentYears })
      ].join('::');

      if (!contractGroups.has(key)) {
        contractGroups.set(key, { info: contractInfo, vehicles: [], rows: [], contractNos: [] });
      }
      const group = contractGroups.get(key);
      group.vehicles.push(vehicle);
      group.rows.push(excelRowNo);
      if (contractInfo.contractNo) group.contractNos.push(contractInfo.contractNo);
    }

    // ── 계약 만들기 ────────────────────────────────────────
    //
    // 계약 1건 = 계약번호 1개 = 한 번에 출고된 차량 묶음. 청구서도 이 단위로 나간다.
    // 나중에 추가로 나가는 차는 계약번호가 달라 새 계약이 되고, 청구서도 따로 나간다.
    const contractResults = [];
    const contractWarnings = [];

    for (const [, group] of contractGroups) {
      const { info, vehicles, rows: groupRows } = group;
      const at = `${groupRows.length > 1 ? `${groupRows[0]}~${groupRows[groupRows.length - 1]}행` : `${groupRows[0]}행`}`;

      if (!info.partyName) {
        contractWarnings.push(`${at}: 계약자를 알 수 없어 계약을 만들지 못했습니다.`);
        continue;
      }

      // 한 계약에 묶인 차량은 결제일과 계약기간이 같아야 한다. 어긋나면 회차가 갈려
      // 한 청구서에 실을 수 없으므로 만들지 않고 알려 준다.
      // 인도일은 묶음 안에서 달라도 된다. 개시일이 같으면 회차가 같아 한 청구서로 나간다
      // (인도가 늦은 차는 첫 회차에 일할로 붙는다).
      const pays = new Set(vehicles.map((v) => String(v.monthlyPaymentDay || '').replace('말일', '말')));
      if (pays.size > 1) {
        contractWarnings.push(`${at} 계약번호 ${info.contractNo}: 결제일이 서로 달라(${[...pays].join(', ')}) 계약을 만들지 않았습니다. 계약번호를 나눠 주세요.`);
        continue;
      }

      const termMonths = resolveTermMonths({ paymentTerm: info.paymentTerm, _rentYears: info.rentYears });
      if (!termMonths) {
        contractWarnings.push(`${at} 계약번호 ${info.contractNo}: 렌트 기간이 없어 계약을 만들지 못했습니다.`);
        continue;
      }

      try {
        const head = vehicles[0];
        const company = head.company ? await Company.findById(head.company) : null;
        const customer = await findOrCreateCustomer({
          name: info.partyName,
          bizNo: company?.bizNo,
          company
        });

        // 계약번호는 묶음에서 가장 빠른 번호를 대표로 쓴다. 회사에서 이미 쓰던 번호라
        // 새로 매기면 기존 서류·장부와 대조가 안 된다.
        const contractDate = info.contractDate || head.deliveryDate || new Date();
        const groupNos = [...new Set(group.contractNos)].sort();
        let contractNo = groupNos[0] || '';
        if (groupNos.length > 1) {
          contractWarnings.push(`${at}: 계약번호 ${groupNos.join(', ')} ${groupNos.length}건을 ${contractNo} 한 계약(차량 ${vehicles.length}대)으로 묶었습니다.`);
        }
        if (!contractNo) {
          contractNo = await generateContractNoForImport(customer, new Date(contractDate));
          contractWarnings.push(`${at}: 계약번호가 비어 있어 ${contractNo}로 새로 매겼습니다.`);
        }
        if (await Contract.findOne({ contractNo })) {
          contractWarnings.push(`${at}: 계약번호 ${contractNo}가 이미 있어 건너뛰었습니다.`);
          continue;
        }

        const contract = await Contract.create({
          contractNo,
          customer: customer._id,
          partyType: head.partyType || '개인',
          companyId: head.company || undefined,
          leaseCompany: info.partyName,
          vehicles: vehicles.map((v) => v._id),
          vehicle: head._id,
          contractDate: new Date(contractDate),
          deliveryDate: head.deliveryDate,
          termMonths,
          rentPeriodYears: info.rentYears,
          rentStartDate: head.rentBillingDate,
          branch: info.branch,
          managerMain: info.managerMain,
          managerOps: info.managerOps,
          finesEmail: info.finesEmail,
          // 초기에 차량마다 따로 매겼던 번호들. 예전 서류를 찾을 때 필요하다.
          mergedContractNos: groupNos.length > 1 ? groupNos : undefined,
          terms: {
            lateInterestRate: head.lateInterestRate || 25,
            earlyTerminationRate: head.earlyTerminationRate || 35
          },
          status: '진행중'
        });

        await Vehicle.updateMany({ _id: { $in: vehicles.map((v) => v._id) } }, { contract: contract._id });

        // 이 계약의 서류가 들어갈 폴더를 만들어 둔다. 이름은 "계약번호_차종"이라
        // 폴더 목록만 봐도 어느 계약의 무슨 차인지 알 수 있다.
        const docFolderName = buildContractFolderName(contractNo, vehicles);
        await Contract.findByIdAndUpdate(contract._id, { docFolderName });
        try {
          const { root } = ensureCustomerFolders(info.partyName);
          fs.mkdirSync(path.join(root, '01.계약서', docFolderName), { recursive: true });
        } catch (err) {
          contractWarnings.push(`${at} ${contractNo}: 계약 폴더를 만들지 못했습니다 - ${err.message}`);
        }

        // 계약이 생겼으니 청구 회차표까지 만들어 둔다. 값이 덜 차면 이유만 남긴다.
        let rounds = 0;
        try {
          const schedule = await buildScheduleForContract(contract._id);
          rounds = schedule.rounds.length;
        } catch (err) {
          contractWarnings.push(`${at} 계약번호 ${contractNo}: 회차표를 만들지 못했습니다 - ${err.message}`);
        }
        contractResults.push({ contractNo, partyName: info.partyName, vehicleCount: vehicles.length, rounds });
      } catch (err) {
        contractWarnings.push(`${at} 계약번호 ${info.contractNo}: ${err.message}`);
      }
    }

    const uniqueNewCompanies = [...new Set(createdCompanies)];

    // 계약자 폴더를 만든다.
    //
    // 폴더는 차량이 아니라 계약자 단위다. 한 법인이 차를 열 대 굴려도 서류는 한 곳에 모인다.
    // 계약서 등록에서는 이미 만들고 있는데 엑셀 업로드에서는 빠져 있어,
    // 대량으로 올린 차량은 나중에 청구서를 저장할 자리가 없었다.
    // 폴더가 없어도 차량 등록 자체는 끝난 일이라, 실패해도 업로드를 되돌리지 않고 알리기만 한다.
    const folderCreated = [];
    const folderFailed = [];
    for (const name of partyNames) {
      try {
        const { created: isNew } = ensureCustomerFolders(name);
        if (isNew) folderCreated.push(name);
      } catch (err) {
        folderFailed.push(`${name}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      createdCount: created.length,
      errorCount: errors.length,
      errors: errors.slice(0, 30), // 너무 많으면 앞부분만 돌려준다
      createdCompanies: uniqueNewCompanies,
      folderCreatedCount: folderCreated.length,
      folderFailed,
      contractCount: contractResults.length,
      scheduleCount: contractResults.filter((c) => c.rounds > 0).length,
      contracts: contractResults,
      contractWarnings,
      message: [
        `${created.length}대가 등록되었습니다.`,
        uniqueNewCompanies.length ? ` 법인 ${uniqueNewCompanies.length}곳이 새로 등록되었습니다.` : '',
        contractResults.length ? ` 계약 ${contractResults.length}건을 만들었습니다.` : '',
        contractResults.filter((c) => c.rounds > 0).length ? ` (회차표 ${contractResults.filter((c) => c.rounds > 0).length}건)` : '',
        folderCreated.length ? ` 계약자 폴더 ${folderCreated.length}개를 만들었습니다.` : '',
        folderFailed.length ? ` (폴더 ${folderFailed.length}건 실패)` : '',
        contractWarnings.length ? ` 계약 관련 확인 필요 ${contractWarnings.length}건.` : '',
        errors.length ? ` (${errors.length}건은 처리하지 못했습니다)` : ''
      ].join('')
    });
  } catch (error) {
    console.error('Error importing vehicles:', error);
    res.status(500).json({ success: false, message: '엑셀 업로드 처리 실패', error: error.message });
  }
};
