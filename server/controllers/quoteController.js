import Quote from '../models/Quote.js';
import Customer from '../models/Customer.js';

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
