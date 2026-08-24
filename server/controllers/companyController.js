import Company from '../models/Company.js';
import Customer from '../models/Customer.js';
import { parseBusinessRegistration } from '../utils/ocrService.js';

/**
 * Synchronizes customer associations for a given company.
 * Updates Customer documents' companies arrays to match the provided associations.
 */
const syncCompanyCustomers = async (companyId, customerAssociations) => {
  if (!customerAssociations) return;

  const newAssocMap = new Map();
  customerAssociations.forEach(a => {
    const id = a.customerId || a._id;
    if (id) {
      newAssocMap.set(id.toString(), a);
    }
  });

  // Find all customers currently linked to this company
  const currentAssociatedCustomers = await Customer.find({ 'companies.companyId': companyId });

  for (const customer of currentAssociatedCustomers) {
    const custIdStr = customer._id.toString();
    if (!newAssocMap.has(custIdStr)) {
      // Remove association
      customer.companies = customer.companies.filter(c => c.companyId?.toString() !== companyId.toString());
      await customer.save();
    } else {
      // Update existing association
      const newAssoc = newAssocMap.get(custIdStr);
      const existingAssoc = customer.companies.find(c => c.companyId?.toString() === companyId.toString());
      if (existingAssoc) {
        existingAssoc.role = newAssoc.role || '';
        existingAssoc.isPrimary = !!newAssoc.isPrimary;
        
        // If set as primary, clear primary status for other companies on this customer
        if (newAssoc.isPrimary) {
          customer.companies.forEach(c => {
            if (c.companyId?.toString() !== companyId.toString()) {
              c.isPrimary = false;
            }
          });
        }
        await customer.save();
      }
      newAssocMap.delete(custIdStr);
    }
  }

  // Add new associations
  for (const [custIdStr, newAssoc] of newAssocMap.entries()) {
    const customer = await Customer.findById(custIdStr);
    if (customer) {
      const isPrimary = !!newAssoc.isPrimary;
      if (isPrimary) {
        customer.companies.forEach(c => { c.isPrimary = false; });
      }
      customer.companies.push({
        companyId,
        role: newAssoc.role || '',
        isPrimary
      });
      await customer.save();
    }
  }
};

// @desc    Get all companies (optional search by name/bizNo/customer name)
// @route   GET /api/companies
// @access  Public
export const getCompanies = async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search && search.trim()) {
      const term = search.trim();
      
      // 1. Search customers matching the name or contactName
      const matchingCustomers = await Customer.find(
        {
          $or: [
            { name: { $regex: term, $options: 'i' } },
            { contactName: { $regex: term, $options: 'i' } }
          ]
        },
        'companies.companyId'
      ).lean();
      
      const companyIds = matchingCustomers
        .flatMap(c => c.companies || [])
        .map(m => m.companyId)
        .filter(id => id); // Filter out null/undefined

      // 2. Query companies by name, bizNo, or matching customer associations
      query.$or = [
        { name: { $regex: term, $options: 'i' } },
        { bizNo: { $regex: term, $options: 'i' } },
        { _id: { $in: companyIds } }
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
    const { 
      bizNo, 
      name, 
      bizType, 
      ceoName, 
      address, 
      billingEmail, 
      folderName, 
      memo,
      customerAssociations 
    } = req.body;

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

    if (customerAssociations && Array.isArray(customerAssociations)) {
      await syncCompanyCustomers(company._id, customerAssociations);
    }

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

    const { 
      bizNo, 
      name, 
      bizType, 
      ceoName, 
      address, 
      billingEmail, 
      folderName, 
      memo,
      customerAssociations
    } = req.body;

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

    if (customerAssociations && Array.isArray(customerAssociations)) {
      await syncCompanyCustomers(updated._id, customerAssociations);
    }

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

// @desc    Process uploaded Business Registration Certificate for OCR auto-fill
// @route   POST /api/companies/ocr
// @access  Public
export const processCompanyOCR = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '업로드할 파일이 없습니다.' });
    }

    const result = await parseBusinessRegistration(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    res.json(result);
  } catch (error) {
    console.error('[OCR Controller] OCR processing failed:', error);
    res.status(500).json({ message: error.message || '사업자등록증 분석에 실패했습니다.' });
  }
};
