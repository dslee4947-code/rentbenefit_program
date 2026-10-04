import Quote from '../models/Quote.js';
import Customer from '../models/Customer.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { saveDocument, getDocumentSettings, fillPattern } from '../utils/documentStorageService.js';

// @desc    Get all quotes
// @route   GET /api/quotes
// @access  Public
export const getQuotes = async (req, res) => {
  try {
    const { search, status, customerId } = req.query;
    let query = {};

    if (status) {
      query.status = status;
    }
    if (customerId) {
      query.customer = customerId;
    }

    const quotes = await Quote.find(query)
      .populate('customer')
      .populate('companyId')
      .sort({ createdAt: -1 });

    if (search) {
      // Filter after populating since we want to search customer name too
      const filteredQuotes = quotes.filter(quote => {
        const matchesCustomer = quote.customer && (
          quote.customer.name.toLowerCase().includes(search.toLowerCase()) ||
          (quote.customer.bizNo || '').includes(search)
        );
        const matchesModel = quote.vehicleModel.toLowerCase().includes(search.toLowerCase());
        return matchesCustomer || matchesModel;
      });
      return res.json(filteredQuotes);
    }

    res.json(quotes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get quote by ID
// @route   GET /api/quotes/:id
// @access  Public
export const getQuoteById = async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id)
      .populate('customer')
      .populate('companyId');
    if (quote) {
      res.json(quote);
    } else {
      res.status(404).json({ message: 'Quote not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create new quote
// @route   POST /api/quotes
// @access  Public
export const createQuote = async (req, res) => {
  try {
    const {
      customerId, // Existing customer ID (optional if newCustomer provided)
      newCustomer, // Object containing new customer fields (optional)
      partyType,
      companyId,
      customerName,
      companyName,
      companyBizNo,
      vehicleModel,
      vehicleSpec,
      vehicleDetail,
      totalPrice,
      monthlyEstimates,
      rentalRemark,
      specialNoteMerged,
      mergedSpecialNote,
      comparisonVehicles,
      activeVehicleId,
      pricing,
      insurance,
      maintenance,
      createdBy
    } = req.body;

    let linkedCustomerId = customerId;

    // Concurrently create Customer if newCustomer data is supplied
    if (newCustomer && newCustomer.name && newCustomer.bizNo) {
      // Check if customer already exists by bizNo
      let customer = await Customer.findOne({ bizNo: newCustomer.bizNo });
      if (!customer) {
        // Auto-generate customerId sequentially
        const count = await Customer.countDocuments();
        const customerId = `CUST${String(count + 1).padStart(3, '0')}`;

        customer = await Customer.create({
          customerId,
          name: newCustomer.name,
          bizNo: newCustomer.bizNo,
          ceoName: newCustomer.ceoName,
          address: newCustomer.address,
          contactName: newCustomer.contactName,
          contactPhone: newCustomer.contactPhone,
          email: newCustomer.email || 'no-email@rentbenefit.co.kr',
          bank: newCustomer.bank || {}
        });
      }
      linkedCustomerId = customer._id;
    }

    if (!linkedCustomerId) {
      return res.status(400).json({ message: 'Customer information is required' });
    }

    const quote = await Quote.create({
      customer: linkedCustomerId,
      partyType: partyType || '개인',
      companyId: partyType === '법인' ? (companyId || undefined) : undefined,
      customerName,
      companyName: partyType === '법인' ? companyName : undefined,
      companyBizNo: partyType === '법인' ? companyBizNo : undefined,
      vehicleModel,
      vehicleSpec,
      vehicleDetail,
      totalPrice,
      monthlyEstimates,
      rentalRemark,
      specialNoteMerged,
      mergedSpecialNote,
      comparisonVehicles,
      activeVehicleId,
      pricing,
      insurance,
      maintenance,
      createdBy
    });

    const populatedQuote = await Quote.findById(quote._id)
      .populate('customer')
      .populate('companyId');
    logActivity({
      req, dept: '영업부', action: ACTIONS.QUOTE_CREATE,
      target: { model: 'Quote', id: quote._id },
      summary: `${(partyType === '법인' ? companyName : customerName) || '고객'} ${vehicleModel || ''} 견적 작성`.trim()
    });
    res.status(201).json(populatedQuote);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update quote
// @route   PUT /api/quotes/:id
// @access  Public
export const updateQuote = async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);

    if (!quote) {
      return res.status(404).json({ message: 'Quote not found' });
    }

    const {
      customerId,
      partyType,
      companyId,
      customerName,
      companyName,
      companyBizNo,
      vehicleModel,
      vehicleSpec,
      vehicleDetail,
      totalPrice,
      monthlyEstimates,
      rentalRemark,
      specialNoteMerged,
      mergedSpecialNote,
      comparisonVehicles,
      activeVehicleId,
      pricing,
      insurance,
      maintenance,
      status
    } = req.body;

    if (customerId !== undefined) quote.customer = customerId;
    if (partyType !== undefined) quote.partyType = partyType;
    quote.companyId = partyType === '법인' ? (companyId || quote.companyId) : undefined;
    if (customerName !== undefined) quote.customerName = customerName;
    quote.companyName = partyType === '법인' ? (companyName !== undefined ? companyName : quote.companyName) : undefined;
    quote.companyBizNo = partyType === '법인' ? (companyBizNo !== undefined ? companyBizNo : quote.companyBizNo) : undefined;
    quote.vehicleModel = vehicleModel || quote.vehicleModel;
    quote.vehicleSpec = vehicleSpec !== undefined ? vehicleSpec : quote.vehicleSpec;
    if (vehicleDetail !== undefined) quote.vehicleDetail = vehicleDetail;
    quote.totalPrice = totalPrice !== undefined ? totalPrice : quote.totalPrice;
    quote.monthlyEstimates = monthlyEstimates || quote.monthlyEstimates;
    // 빈 문자열로 지우는 것도 유효한 수정이므로 undefined일 때만 기존 값을 유지한다
    if (rentalRemark !== undefined) quote.rentalRemark = rentalRemark;
    if (specialNoteMerged !== undefined) quote.specialNoteMerged = specialNoteMerged;
    if (mergedSpecialNote !== undefined) quote.mergedSpecialNote = mergedSpecialNote;
    if (comparisonVehicles !== undefined) {
      quote.comparisonVehicles = comparisonVehicles;
      // Mixed 타입은 내부 값이 바뀌어도 mongoose가 변경을 감지하지 못해 저장되지 않는다
      quote.markModified('comparisonVehicles');
    }
    if (activeVehicleId !== undefined) quote.activeVehicleId = activeVehicleId;
    if (pricing !== undefined) quote.pricing = pricing;
    if (insurance !== undefined) quote.insurance = insurance;
    if (maintenance !== undefined) quote.maintenance = maintenance;
    quote.status = status || quote.status;

    const updatedQuote = await quote.save();
    const populatedQuote = await Quote.findById(updatedQuote._id)
      .populate('customer')
      .populate('companyId');
    res.json(populatedQuote);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Convert quote to contract status
// @route   PUT /api/quotes/:id/convert
// @access  Public
export const convertQuoteToContract = async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (quote) {
      quote.status = '계약전환';
      await quote.save();
      res.json({ message: 'Quote converted to contract successfully', quote });
    } else {
      res.status(404).json({ message: 'Quote not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete quote
// @route   DELETE /api/quotes/:id
// @access  Public
export const deleteQuote = async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (quote) {
      await Quote.deleteOne({ _id: req.params.id });
      res.json({ message: 'Quote removed' });
    } else {
      res.status(404).json({ message: 'Quote not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 인쇄할 때 만든 견적서 PDF를 계약자 폴더에 남긴다.
 *
 * 예전에는 견적서를 인쇄해도 파일이 남지 않아 "그때 그 견적서가 뭐였지"를 찾을 수 없었다.
 * 견적 내용은 DB에 있지만, 고객에게 실제로 건넨 종이와 같은 모양의 문서는 따로 필요하다.
 *
 * 저장에 실패해도 인쇄 자체를 막지 않는다. 화면에서는 알림만 띄운다.
 *
 * @route POST /api/quotes/:id/document
 */
export const saveQuoteDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '저장할 파일이 없습니다.' });
    }

    const quote = await Quote.findById(req.params.id).populate('customer', 'name');
    if (!quote) return res.status(404).json({ success: false, message: '견적서를 찾을 수 없습니다.' });

    // 견적 단계의 폴더는 상담한 사람 이름으로 모은다.
    //
    // 이 시점에는 어느 법인으로 계약할지 아직 정해지지 않는다. 한 사람이 여러 법인 건을
    // 상담하기도 해서, 법인명으로 묶으면 방금 낸 견적서를 어디서 찾아야 할지 알 수 없다.
    // 계약으로 넘어간 뒤부터는 서류가 법인 앞으로 나가므로 '장기렌트/{법인명}'으로 모인다.
    const partyName = quote.customerName || quote.customer?.name;
    if (!partyName) {
      return res.status(400).json({ success: false, message: '견적서에 고객명이 없어 저장할 자리를 정하지 못했습니다.' });
    }

    const docType = req.body.docType === '비교견적서' ? '비교견적서' : '견적서';
    const settings = await getDocumentSettings();
    const fileName = `${fillPattern(settings.fileNames.quote, {
      문서종류: docType,
      고객명: partyName,
      계약자: partyName, // 예전 설정이 {계약자}를 쓰고 있어도 그대로 채워지게 둔다
      날짜: new Date().toISOString().slice(0, 10)
    })}.pdf`;

    // 같은 날 조건을 고쳐 다시 뽑는 일이 잦다. 이전 것을 남겨야 무엇을 건넸는지 댈 수 있다.
    const saved = await saveDocument({
      partyName,
      kind: 'quote',
      fileName,
      fileBuffer: req.file.buffer,
      keepPrevious: true
    });

    quote.savedDocuments.push({ docType, fileName: saved.fileName, savedPath: saved.localPath });
    await quote.save();

    res.json({ success: true, fileName: saved.fileName, savedPath: saved.localPath });
  } catch (error) {
    console.error('[견적서 저장]', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
