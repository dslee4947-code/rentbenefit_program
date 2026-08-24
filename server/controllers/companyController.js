import Company from '../models/Company.js';
import Customer from '../models/Customer.js';

// @desc    Get all companies (optional search by name/bizNo)
// @route   GET /api/companies
// @access  Public
export const getCompanies = async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search && search.trim()) {
      const term = search.trim();
      query.$or = [
        { name: { $regex: term, $options: 'i' } },
        { bizNo: { $regex: term, $options: 'i' } },
      ];
    }

    const companies = await Company.find(query).sort({ name: 1 });
    res.json(companies);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get company by ID
// @route   GET /api/companies/:id
// @access  Public
export const getCompanyById = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (company) {
      res.json(company);
    } else {
      res.status(404).json({ message: 'Company not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create new company
// @route   POST /api/companies
// @access  Public
export const createCompany = async (req, res) => {
  try {
    const { bizNo, name, bizType, ceoName, address, billingEmail, folderName, memo } = req.body;

    if (!name) {
      return res.status(400).json({ message: '법인명(name)은 필수입니다.' });
    }

    if (bizNo) {
      const existing = await Company.findOne({ bizNo });
      if (existing) {
        return res.status(400).json({ message: '이미 등록된 사업자번호입니다.' });
      }
    }

    const company = await Company.create({
      bizNo: bizNo || undefined,
      name,
      bizType,
      ceoName,
      address,
      billingEmail,
      folderName,
      memo,
    });

    res.status(201).json(company);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: '이미 등록된 사업자번호입니다.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update company
// @route   PUT /api/companies/:id
// @access  Public
export const updateCompany = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const { bizNo, name, bizType, ceoName, address, billingEmail, folderName, memo } = req.body;

    if (bizNo !== undefined && bizNo !== company.bizNo) {
      if (bizNo) {
        const duplicate = await Company.findOne({ bizNo, _id: { $ne: req.params.id } });
        if (duplicate) {
          return res.status(400).json({ message: '이미 다른 법인에 등록된 사업자번호입니다.' });
        }
        company.bizNo = bizNo;
      } else {
        company.bizNo = undefined;
      }
    }

    company.name = name !== undefined ? name : company.name;
    company.bizType = bizType !== undefined ? bizType : company.bizType;
    company.ceoName = ceoName !== undefined ? ceoName : company.ceoName;
    company.address = address !== undefined ? address : company.address;
    company.billingEmail = billingEmail !== undefined ? billingEmail : company.billingEmail;
    company.folderName = folderName !== undefined ? folderName : company.folderName;
    company.memo = memo !== undefined ? memo : company.memo;

    const updated = await company.save();
    res.json(updated);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: '이미 다른 법인에 등록된 사업자번호입니다.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get customers affiliated with a company (+ their role/isPrimary at this company)
// @route   GET /api/companies/:id/customers
// @access  Public
export const getCompanyCustomers = async (req, res) => {
  try {
    const customers = await Customer.find(
      { 'companies.companyId': req.params.id },
      'customerId name contactName contactPhone email companies'
    ).lean();

    const result = customers.map((c) => {
      const membership = c.companies.find((m) => m.companyId?.toString() === req.params.id);
      return {
        _id: c._id,
        customerId: c.customerId,
        name: c.name,
        contactName: c.contactName,
        contactPhone: c.contactPhone,
        email: c.email,
        role: membership?.role || '',
        isPrimary: !!membership?.isPrimary
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
