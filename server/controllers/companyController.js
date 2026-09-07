import fs from 'fs';
import path from 'path';
import Company from '../models/Company.js';
import Customer from '../models/Customer.js';
import CompanyDocument from '../models/CompanyDocument.js';
import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import { parseBusinessRegistration } from '../utils/ocrService.js';
import { saveFileLocally, readSavedFile, sanitizePathSegment } from '../utils/documentStorageService.js';

// multer/busboy는 multipart 파일명(Content-Disposition)을 기본적으로 latin1로 디코딩한다.
// 한글 등 비ASCII 파일명이 깨져서 들어오므로(예: "사업자등록증.pdf" -> mojibake), UTF-8로 재해석한다.
// 참고용 원본 파일명 표시에만 쓰고, 실제 저장 파일명은 서버에서 새로 생성해 이 문제를 원천적으로 피한다.
const decodeOriginalName = (name) => {
  try {
    return Buffer.from(name || '', 'latin1').toString('utf8');
  } catch {
    return name || '';
  }
};

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
      corporateRegistrationNo,
      name,
      bizType,
      ceoName,
      address,
      billingEmail,
      folderName,
      memo,
      bank,
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
      corporateRegistrationNo: corporateRegistrationNo || undefined,
      name,
      bizType,
      ceoName,
      address,
      billingEmail,
      folderName,
      memo,
      bank: bank || undefined,
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
      corporateRegistrationNo,
      name,
      bizType,
      ceoName,
      address,
      billingEmail,
      folderName,
      memo,
      bank,
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

    company.corporateRegistrationNo = corporateRegistrationNo !== undefined ? corporateRegistrationNo : company.corporateRegistrationNo;
    company.name = name !== undefined ? name : company.name;
    company.bizType = bizType !== undefined ? bizType : company.bizType;
    company.ceoName = ceoName !== undefined ? ceoName : company.ceoName;
    company.address = address !== undefined ? address : company.address;
    company.billingEmail = billingEmail !== undefined ? billingEmail : company.billingEmail;
    company.folderName = folderName !== undefined ? folderName : company.folderName;
    company.memo = memo !== undefined ? memo : company.memo;
    if (bank !== undefined) company.bank = bank;

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

// @desc    법인 삭제 - 계약/차량에 연결된 법인은 그 연결을 먼저 정리해야 삭제 가능
// @route   DELETE /api/companies/:id
// @access  Public
export const deleteCompany = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ message: '법인을 찾을 수 없습니다.' });
    }

    const [contractCount, vehicleCount] = await Promise.all([
      Contract.countDocuments({ companyId: req.params.id }),
      Vehicle.countDocuments({ company: req.params.id })
    ]);

    if (contractCount > 0 || vehicleCount > 0) {
      return res.status(400).json({
        message: `이 법인과 연결된 계약 ${contractCount}건, 차량 ${vehicleCount}건이 있어 삭제할 수 없습니다. 먼저 계약서/차량 쪽 연결을 정리해 주세요.`
      });
    }

    await Customer.updateMany(
      { 'companies.companyId': req.params.id },
      { $pull: { companies: { companyId: req.params.id } } }
    );
    await CompanyDocument.deleteMany({ company: req.params.id });
    await company.deleteOne();

    res.json({ message: `"${company.name}" 법인이 삭제되었습니다.` });
  } catch (error) {
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
      'customerId name surname givenName contactName contactPhone mobilePhone email companies'
    ).lean();

    const result = customers.map((c) => {
      const membership = c.companies.find((m) => m.companyId?.toString() === req.params.id);
      return {
        _id: c._id,
        customerId: c.customerId,
        name: c.name,
        surname: c.surname,
        givenName: c.givenName,
        contactName: c.contactName,
        contactPhone: c.contactPhone,
        mobilePhone: c.mobilePhone,
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

    // 어떤 항목도 읽어내지 못한 경우, 빈 값으로 폼을 덮어쓰지 않도록 알려준다.
    const hasAnyField = Boolean(result.bizNo || result.name || result.ceoName || result.address);
    if (!hasAnyField) {
      return res.status(422).json({
        message: '파일에서 사업자 정보를 찾지 못했습니다. 더 선명한 파일로 다시 시도하거나 직접 입력해 주세요.',
        code: 'OCR_NO_FIELDS'
      });
    }

    res.json(result);
  } catch (error) {
    const notConfigured = error.code === 'OCR_NOT_CONFIGURED';
    if (notConfigured) {
      console.log('[OCR Controller] OCR 미설정 - 자동 완성 없이 직접 입력으로 안내합니다.');
    } else {
      console.error('[OCR Controller] OCR processing failed:', error);
    }
    res.status(notConfigured ? 503 : 500).json({
      message: error.message || '사업자등록증 분석에 실패했습니다.',
      code: error.code
    });
  }
};

// @desc    법인 문서함에 파일 업로드 (사업자등록증/계약서/청구서/견적서/기타).
//          실제 파일은 RENT/{문서종류}/{법인명}/에 저장되고, DB에는 검색용 메타데이터만 남는다.
// @route   POST /api/companies/:id/documents
// @access  Public
export const uploadCompanyDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '업로드할 파일이 없습니다.' });
    }

    const { docType } = req.body;
    if (!docType) {
      return res.status(400).json({ message: '문서 종류(docType)는 필수입니다.' });
    }

    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ message: '법인을 찾을 수 없습니다.' });
    }

    // 업로드한 원본 파일명을 신뢰하지 않고, "{문서종류}_{법인명}.{확장자}" 형태로 서버가 직접 생성한다.
    // 원본 파일명은 한글이 포함되면 인코딩이 깨지기 쉽고(OneDrive 동기화 오류의 원인),
    // 이렇게 하면 그 문제를 원천적으로 피하면서 파일명만 보고도 무슨 문서인지 바로 알 수 있다.
    const ext = path.extname(req.file.originalname) || '';
    const companyLabel = sanitizePathSegment(company.folderName || company.name);
    const generatedFileName = `${sanitizePathSegment(docType)}_${companyLabel}${ext}`;

    const { fileName, localPath } = await saveFileLocally({
      businessLine: 'rental',
      companySubfolderName: company.folderName || company.name,
      docType,
      fileName: generatedFileName,
      fileBuffer: req.file.buffer
    });

    const doc = await CompanyDocument.create({
      company: company._id,
      docType,
      fileName,
      originalName: decodeOriginalName(req.file.originalname),
      localPath,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.body.uploadedBy || ''
    });

    res.status(201).json(doc);
  } catch (error) {
    console.error('[Company Document] Upload failed:', error);
    res.status(500).json({ message: error.message || '문서 저장 중 오류가 발생했습니다.' });
  }
};

// @desc    법인 문서함 목록 조회 (문서 종류/파일명 검색 가능)
// @route   GET /api/companies/:id/documents
// @access  Public
export const getCompanyDocuments = async (req, res) => {
  try {
    const { docType, search } = req.query;
    const query = { company: req.params.id };

    if (docType && docType !== 'all') {
      query.docType = docType;
    }
    if (search && search.trim()) {
      const term = search.trim();
      query.$or = [
        { fileName: { $regex: term, $options: 'i' } },
        { originalName: { $regex: term, $options: 'i' } }
      ];
    }

    const documents = await CompanyDocument.find(query).sort({ createdAt: -1 });
    res.json(documents);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    법인 문서함의 파일 다운로드
// @route   GET /api/companies/:id/documents/:docId/download
// @access  Public
export const downloadCompanyDocument = async (req, res) => {
  try {
    const doc = await CompanyDocument.findOne({ _id: req.params.docId, company: req.params.id });
    if (!doc) {
      return res.status(404).json({ message: '문서를 찾을 수 없습니다.' });
    }
    // 파일은 OneDrive에 있다. 받아서 그대로 내려 준다.
    const buffer = await readSavedFile(doc.localPath);
    if (!buffer) {
      return res.status(410).json({ message: '파일이 원드라이브에서 이동되었거나 삭제되어 다운로드할 수 없습니다.' });
    }

    const downloadName = doc.originalName || doc.fileName || '문서';
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    법인 문서함에서 항목 제거 (DB 메타데이터만 삭제 - 원드라이브 실제 파일은 보존)
// @route   DELETE /api/companies/:id/documents/:docId
// @access  Public
export const deleteCompanyDocument = async (req, res) => {
  try {
    const doc = await CompanyDocument.findOneAndDelete({ _id: req.params.docId, company: req.params.id });
    if (!doc) {
      return res.status(404).json({ message: '문서를 찾을 수 없습니다.' });
    }
    res.json({ message: '문서함 목록에서 제거되었습니다. (원드라이브 파일은 그대로 남아있습니다)' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
