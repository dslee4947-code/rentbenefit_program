import Customer from '../models/Customer.js';

// @desc    Get all customers
// @route   GET /api/customers
// @access  Private/Admin
export const getCustomers = async (req, res) => {
  try {
    const { search, source, category, page = 1, limit = 50, all } = req.query;

    let query = {};
    
    if (source && source !== 'all') {
      if (source === 'outlook') query.source = 'outlook';
      else if (source === 'manual') query.source = { $ne: 'outlook' };
    }

    if (category && category !== 'all') {
      query.outlookCategory = category;
    }

    if (search && search.trim()) {
      const term = search.trim();
      query.$or = [
        { name: { $regex: term, $options: 'i' } },
        { contactName: { $regex: term, $options: 'i' } },
        { contactPhone: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { bizNo: { $regex: term, $options: 'i' } },
        { outlookCategory: { $regex: term, $options: 'i' } },
        { surname: { $regex: term, $options: 'i' } },
        { givenName: { $regex: term, $options: 'i' } }
      ];
    }

    // If client specifically requests legacy full array format (e.g. export or old code)
    if (all === 'true') {
      const customers = await Customer.find(query).sort({ createdAt: -1 });
      return res.json(customers);
    }
    
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    // Fast parallel execution for paginated items & stats
    const [customers, totalCount, totalAll, totalOutlook, totalManual, categories] = await Promise.all([
      Customer.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Customer.countDocuments(query),
      Customer.countDocuments({}),
      Customer.countDocuments({ source: 'outlook' }),
      Customer.countDocuments({ source: { $ne: 'outlook' } }),
      Customer.distinct('outlookCategory')
    ]);

    res.json({
      customers,
      pagination: {
        totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum)
      },
      stats: {
        total: totalAll,
        outlook: totalOutlook,
        manual: totalManual
      },
      categories: categories.filter(Boolean)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get customer by ID
// @route   GET /api/customers/:id
// @access  Private/Admin
export const getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (customer) {
      res.json(customer);
    } else {
      res.status(404).json({ message: 'Customer not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create new customer
// @route   POST /api/customers
// @access  Private/Admin
export const createCustomer = async (req, res) => {
  try {
    const { name, bizNo, ceoName, address, contactName, contactPhone, email, bank, bizNoTransfer, bizAddress } = req.body;

    const customerExists = await Customer.findOne({ bizNo });
    if (customerExists) {
      return res.status(400).json({ message: 'Customer with this Business/ID Number already exists' });
    }

    // Auto-generate customerId sequentially
    const count = await Customer.countDocuments();
    const customerId = `CUST${String(count + 1).padStart(3, '0')}`;

    const customer = await Customer.create({
      customerId,
      name,
      bizNo,
      ceoName,
      address,
      contactName,
      contactPhone,
      email,
      bank,
      bizNoTransfer,
      bizAddress
    });

    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update customer
// @route   PUT /api/customers/:id
// @access  Private/Admin
export const updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (customer) {
      customer.name = req.body.name || customer.name;
      customer.bizNo = req.body.bizNo || customer.bizNo;
      customer.ceoName = req.body.ceoName !== undefined ? req.body.ceoName : customer.ceoName;
      customer.address = req.body.address !== undefined ? req.body.address : customer.address;
      customer.contactName = req.body.contactName !== undefined ? req.body.contactName : customer.contactName;
      customer.contactPhone = req.body.contactPhone !== undefined ? req.body.contactPhone : customer.contactPhone;
      customer.email = req.body.email || customer.email;
      customer.bank = req.body.bank || customer.bank;
      customer.bizNoTransfer = req.body.bizNoTransfer !== undefined ? req.body.bizNoTransfer : customer.bizNoTransfer;
      customer.bizAddress = req.body.bizAddress !== undefined ? req.body.bizAddress : customer.bizAddress;

      // Outlook Detailed Fields
      if (req.body.surname !== undefined) customer.surname = req.body.surname;
      if (req.body.givenName !== undefined) customer.givenName = req.body.givenName;
      if (req.body.companyName !== undefined) customer.companyName = req.body.companyName;
      if (req.body.department !== undefined) customer.department = req.body.department;
      if (req.body.jobTitle !== undefined) customer.jobTitle = req.body.jobTitle;
      if (req.body.displayName !== undefined) customer.displayName = req.body.displayName;
      if (req.body.mobilePhone !== undefined) customer.mobilePhone = req.body.mobilePhone;
      if (req.body.businessPhone !== undefined) customer.businessPhone = req.body.businessPhone;
      if (req.body.homePhone !== undefined) customer.homePhone = req.body.homePhone;
      if (req.body.faxNumber !== undefined) customer.faxNumber = req.body.faxNumber;
      if (req.body.webPage !== undefined) customer.webPage = req.body.webPage;
      if (req.body.postalCode !== undefined) customer.postalCode = req.body.postalCode;
      if (req.body.businessAddress !== undefined) customer.businessAddress = req.body.businessAddress;
      if (req.body.homeAddress !== undefined) customer.homeAddress = req.body.homeAddress;
      if (req.body.notes !== undefined) customer.notes = req.body.notes;
      if (req.body.outlookCategory !== undefined) customer.outlookCategory = req.body.outlookCategory;

      const updatedCustomer = await customer.save();
      res.json(updatedCustomer);
    } else {
      res.status(404).json({ message: 'Customer not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete customer
// @route   DELETE /api/customers/:id
// @access  Private/Admin
export const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (customer) {
      await Customer.deleteOne({ _id: req.params.id });
      res.json({ message: 'Customer removed' });
    } else {
      res.status(404).json({ message: 'Customer not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Bulk create customers from Excel upload
// @route   POST /api/customers/bulk
// @access  Private/Admin
export const bulkCreateCustomers = async (req, res) => {
  try {
    const { customers } = req.body;
    if (!customers || !Array.isArray(customers)) {
      return res.status(400).json({ message: 'Invalid payload: customers must be an array' });
    }

    const totalReceived = customers.length;
    const bizNos = customers.map(c => c.bizNo).filter(Boolean);

    // Find existing customers with duplicate bizNo
    const existingCustomers = await Customer.find({ bizNo: { $in: bizNos } });
    const existingBizNos = new Set(existingCustomers.map(c => c.bizNo));

    // Filter out duplicates
    const newCustomersToInsert = customers.filter(c => c.bizNo && !existingBizNos.has(c.bizNo));

    let insertedCount = 0;
    if (newCustomersToInsert.length > 0) {
      // Auto-generate customerId for each new customer
      let count = await Customer.countDocuments();
      const customersWithId = newCustomersToInsert.map(cust => {
        count++;
        const customerId = cust.customerId || `CUST${String(count).padStart(3, '0')}`;
        return {
          ...cust,
          customerId
        };
      });

      const result = await Customer.insertMany(customersWithId);
      insertedCount = result.length;
    }

    res.status(201).json({
      message: 'Bulk customer import processed',
      totalReceived,
      inserted: insertedCount,
      skipped: totalReceived - insertedCount
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Trigger manual Outlook contact synchronization
// @route   POST /api/customers/sync-outlook
// @access  Private/Admin
export const triggerOutlookSync = async (req, res) => {
  try {
    const { syncOutlookContacts } = await import('../utils/outlookSyncService.js');
    const result = await syncOutlookContacts();
    if (result.success) {
      res.json({ message: 'Outlook contacts synchronized successfully', data: result });
    } else {
      res.status(500).json({ message: 'Outlook sync failed', error: result.message });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Lookup customer addresses by phone numbers
// @route   POST /api/customers/lookup-addresses
// @access  Private/Admin
export const lookupCustomerAddresses = async (req, res) => {
  try {
    const { phones } = req.body;
    if (!phones || !Array.isArray(phones)) {
      return res.status(400).json({ message: 'Invalid payload: phones must be an array' });
    }

    // 1. Fetch only essential fields from DB to match in-memory (highly performant)
    const customers = await Customer.find(
      {},
      'customerId name contactPhone mobilePhone businessPhone homePhone homeAddress businessAddress address bizAddress surname givenName companyName department jobTitle'
    );

    // 2. Clean phone number function
    const cleanPhone = (phone) => {
      if (!phone) return '';
      let cleaned = phone.replace(/\D/g, ''); // keep only numbers
      if (cleaned.startsWith('82')) {
        cleaned = '0' + cleaned.slice(2);
      }
      return cleaned;
    };

    // 3. Map cleaned phone numbers to customers
    const phoneMap = new Map();
    for (const c of customers) {
      const pFields = [c.contactPhone, c.mobilePhone, c.businessPhone, c.homePhone];
      for (const p of pFields) {
        const cp = cleanPhone(p);
        if (cp && cp.length >= 7) { // Only map strings of length 7 or more
          phoneMap.set(cp, c);
        }
      }
    }

    // 4. Look up each input phone number
    const results = phones.map(inputPhone => {
      const cp = cleanPhone(inputPhone);
      const matched = cp ? phoneMap.get(cp) : null;
      if (matched) {
        return {
          inputPhone,
          matched: true,
          customerId: matched.customerId,
          name: matched.name,
          surname: matched.surname || '',
          givenName: matched.givenName || '',
          companyName: matched.companyName || '',
          department: matched.department || '',
          jobTitle: matched.jobTitle || '',
          matchedPhone: matched.mobilePhone || matched.contactPhone || matched.businessPhone || matched.homePhone || '',
          homeAddress: matched.homeAddress || '',
          businessAddress: matched.businessAddress || '',
          address: matched.address || '',
          bizAddress: matched.bizAddress || ''
        };
      } else {
        return {
          inputPhone,
          matched: false
        };
      }
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



