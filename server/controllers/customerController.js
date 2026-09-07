import Customer from '../models/Customer.js';
import Company from '../models/Company.js';

// 고객 검색이 훑는 항목. 계약서 등록 화면의 검색창이 찾던 범위와 같다.
const SEARCHABLE_CUSTOMER_FIELDS = [
  'name', 'surname', 'givenName', 'contactName', 'customerId',
  'contactPhone', 'mobilePhone', 'email', 'bizNo', 'outlookCategory', 'companyName'
];

/**
 * 하이픈·공백을 무시하는 검색 정규식을 만든다.
 *
 * 사업자번호를 '1234567890'으로 쳐도 '123-45-67890'을 찾아야 하고 전화번호도 마찬가지다.
 * 글자 사이사이에 하이픈·공백이 와도 되도록 열어 둔다.
 *
 * @returns {RegExp|null} 찾을 글자가 없으면 null
 */
const looseSearchRegex = (raw) => {
  const chars = String(raw ?? '').replace(/[-\s]/g, '');
  if (!chars) return null;

  // 너무 긴 검색어는 정규식이 무거워지므로 앞부분만 쓴다(찾는 결과는 달라지지 않는다)
  const escaped = chars
    .slice(0, 40)
    .split('')
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  return new RegExp(escaped.join('[-\\s]*'), 'i');
};

// 고객 목록을 정렬할 수 있는 항목. 화면(고객 DB 표)의 열과 같은 이름을 쓴다.
// 아무 값이나 그대로 넘기면 색인 없는 항목으로 정렬해 조회가 느려지므로 여기 적힌 것만 받는다.
const SORTABLE_CUSTOMER_FIELDS = [
  'surname', 'givenName', 'name', 'companyName', 'mobilePhone',
  'contactPhone', 'email', 'outlookCategory', 'updatedAt', 'createdAt'
];

// @desc    Get all customers
// @route   GET /api/customers
// @access  Private/Admin
export const getCustomers = async (req, res) => {
  try {
    const { search, source, category, page = 1, limit = 50, all, sort, order } = req.query;

    let query = {};
    
    if (source && source !== 'all') {
      if (source === 'outlook') query.source = 'outlook';
      else if (source === 'manual') query.source = { $ne: 'outlook' };
    }

    if (category && category !== 'all') {
      query.outlookCategory = category;
    }

    if (search && search.trim()) {
      const searchRegex = looseSearchRegex(search);
      if (searchRegex) query.$or = SEARCHABLE_CUSTOMER_FIELDS.map((field) => ({ [field]: searchRegex }));
    }

    // 목록 정렬. 페이지를 나눠 보내므로 정렬은 서버에서 해야 한다.
    // (화면에서 정렬하면 지금 보고 있는 50건 안에서만 순서가 바뀐다)
    const sortField = SORTABLE_CUSTOMER_FIELDS.includes(sort) ? sort : 'createdAt';
    const sortDir = order === 'asc' ? 1 : -1;
    const sortSpec = { [sortField]: sortDir };

    // If client specifically requests legacy full array format (e.g. export or old code)
    if (all === 'true') {
      const customers = await Customer.find(query).sort(sortSpec);
      return res.json(customers);
    }
    
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    // Fast parallel execution for paginated items & stats
    const [customers, totalCount, totalAll, totalOutlook, totalManual, categories] = await Promise.all([
      Customer.find(query).sort(sortSpec).skip(skip).limit(limitNum),
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
    const customer = await Customer.findById(req.params.id)
      .populate('companies.companyId', 'name bizNo bizType ceoName');
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

// @desc    Add (or update) a company affiliation for a customer.
//          한 고객이 법인 여러 곳에 소속될 수 있음. isPrimary는 고객당 한 곳만
//          허용되므로, true로 지정하면 기존 소속들의 isPrimary는 자동 해제된다.
// @route   POST /api/customers/:id/companies
// @access  Public
export const addCustomerCompany = async (req, res) => {
  try {
    const { companyId, role, isPrimary } = req.body;
    if (!companyId) {
      return res.status(400).json({ message: 'companyId는 필수입니다.' });
    }

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ message: '법인을 찾을 수 없습니다.' });
    }

    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const primaryFlag = !!isPrimary;
    if (primaryFlag) {
      customer.companies.forEach((c) => { c.isPrimary = false; });
    }

    const existing = customer.companies.find((c) => c.companyId?.toString() === companyId);
    if (existing) {
      existing.role = role !== undefined ? role : existing.role;
      existing.isPrimary = primaryFlag;
    } else {
      customer.companies.push({ companyId, role: role || '', isPrimary: primaryFlag });
    }

    await customer.save();
    const populated = await Customer.findById(customer._id).populate('companies.companyId', 'name bizNo bizType');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Remove a company affiliation from a customer
// @route   DELETE /api/customers/:id/companies/:companyId
// @access  Public
export const removeCustomerCompany = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    customer.companies = customer.companies.filter(
      (c) => c.companyId?.toString() !== req.params.companyId
    );

    await customer.save();
    const populated = await Customer.findById(customer._id).populate('companies.companyId', 'name bizNo bizType');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


