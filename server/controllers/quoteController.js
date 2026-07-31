import Quote from '../models/Quote.js';
import Customer from '../models/Customer.js';

// @desc    Get all quotes
// @route   GET /api/quotes
// @access  Public
export const getQuotes = async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {};

    if (status) {
      query.status = status;
    }

    const quotes = await Quote.find(query)
      .populate('customer')
      .sort({ createdAt: -1 });

    if (search) {
      // Filter after populating since we want to search customer name too
      const filteredQuotes = quotes.filter(quote => {
        const matchesCustomer = quote.customer && (
          quote.customer.name.toLowerCase().includes(search.toLowerCase()) ||
          quote.customer.bizNo.includes(search)
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
    const quote = await Quote.findById(req.params.id).populate('customer');
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
      vehicleModel,
      vehicleSpec,
      totalPrice,
      monthlyEstimates,
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
      vehicleModel,
      vehicleSpec,
      totalPrice,
      monthlyEstimates,
      createdBy
    });

    const populatedQuote = await Quote.findById(quote._id).populate('customer');
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

    if (quote) {
      quote.vehicleModel = req.body.vehicleModel || quote.vehicleModel;
      quote.vehicleSpec = req.body.vehicleSpec !== undefined ? req.body.vehicleSpec : quote.vehicleSpec;
      quote.totalPrice = req.body.totalPrice !== undefined ? req.body.totalPrice : quote.totalPrice;
      quote.monthlyEstimates = req.body.monthlyEstimates || quote.monthlyEstimates;
      quote.status = req.body.status || quote.status;

      const updatedQuote = await quote.save();
      const populatedQuote = await Quote.findById(updatedQuote._id).populate('customer');
      res.json(populatedQuote);
    } else {
      res.status(404).json({ message: 'Quote not found' });
    }
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
