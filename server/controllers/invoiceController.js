import Invoice from '../models/Invoice.js';
import Contract from '../models/Contract.js';
import Customer from '../models/Customer.js';

// @desc    Get all invoices
// @route   GET /api/invoices
export const getInvoices = async (req, res) => {
  try {
    const { search, billingMonth } = req.query;
    let query = {};
    
    if (billingMonth) {
      query.billingMonth = billingMonth;
    }
    
    const invoices = await Invoice.find(query)
      .populate('customer')
      .populate({
        path: 'contract',
        populate: { path: 'vehicle' }
      })
      .sort({ createdAt: -1 });
      
    if (search) {
      const filtered = invoices.filter(inv => {
        const matchesCustomer = inv.customer && (
          inv.customer.name.toLowerCase().includes(search.toLowerCase()) ||
          (inv.customer.bizNo || '').includes(search)
        );
        const matchesInvoiceNo = inv.invoiceNo.toLowerCase().includes(search.toLowerCase());
        return matchesCustomer || matchesInvoiceNo;
      });
      return res.json(filtered);
    }
    
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get invoice by ID
// @route   GET /api/invoices/:id
export const getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('customer')
      .populate({
        path: 'contract',
        populate: { path: 'vehicle' }
      });
    if (invoice) {
      res.json(invoice);
    } else {
      res.status(404).json({ message: 'Invoice not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create new invoice
// @route   POST /api/invoices
export const createInvoice = async (req, res) => {
  try {
    const {
      contractId,
      customerId,
      customerName, // 추가: 엑셀 업로드 시 고객사명 직접 입력 가능
      billingMonth,
      invoiceDate,
      dueDate,
      items,
      totalSupplyPrice,
      totalVat,
      totalAmount,
      bankName,
      bankAccount,
      bankHolder,
      remarks,
      createdBy,
      
      // 엑셀 결제금액내역 전용 필드들 추가
      prevUnpaid,
      prevOverpaid,
      maintenanceFee,
      fineFee,
      firstMonthFee,
      lastMonthFee,
      nthPay,
      withdrawDate,
      virtualAccount,
      email,
      vehicles,
      invoiceType
    } = req.body;
    
    let linkedCustomerId = customerId;
    
    // 고객ID가 없고 고객사명이 있을 경우, 자동으로 매핑/신규 생성
    if (!linkedCustomerId && customerName) {
      let customer = await Customer.findOne({ name: customerName });
      if (!customer) {
        // 자동 생성
        const count = await Customer.countDocuments();
        const genCustId = `CUST${String(count + 1).padStart(3, '0')}`;
        customer = await Customer.create({
          customerId: genCustId,
          name: customerName,
          bizNo: '-',
          email: email || 'no-email@rentbenefit.co.kr',
          source: 'excel_invoice'
        });
      }
      linkedCustomerId = customer._id;
    }
    
    if (!linkedCustomerId || !billingMonth || !dueDate || !items || items.length === 0) {
      return res.status(400).json({ message: '필수 필드(고객 정보, 청구 대상 월, 납기일, 품목)가 누락되었습니다.' });
    }
    
    // Auto-generate invoiceNo: INV-YYYYMM-XXX (3 digits sequence)
    const date = new Date(invoiceDate || Date.now());
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const prefix = `INV-${yyyy}${mm}-`;
    
    // Count invoices for current month to generate sequence
    const count = await Invoice.countDocuments({
      invoiceNo: new RegExp(`^${prefix}`)
    });
    const seq = String(count + 1).padStart(3, '0');
    const invoiceNo = `${prefix}${seq}`;
    
    const invoice = await Invoice.create({
      invoiceNo,
      contract: contractId || null,
      customer: linkedCustomerId,
      billingMonth,
      invoiceDate: invoiceDate || Date.now(),
      dueDate,
      items,
      totalSupplyPrice,
      totalVat,
      totalAmount,
      bankName,
      bankAccount,
      bankHolder,
      remarks,
      createdBy,
      
      // 엑셀 전용 필드 매핑
      prevUnpaid: prevUnpaid || 0,
      prevOverpaid: prevOverpaid || 0,
      maintenanceFee: maintenanceFee || 0,
      fineFee: fineFee || 0,
      firstMonthFee: firstMonthFee || 0,
      lastMonthFee: lastMonthFee || 0,
      nthPay: nthPay || 1,
      withdrawDate: withdrawDate || null,
      virtualAccount: virtualAccount || '',
      email: email || '',
      vehicles: vehicles || [],
      invoiceType: invoiceType || 'standard'
    });
    
    res.status(201).json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete invoice
// @route   DELETE /api/invoices/:id
export const deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (invoice) {
      await invoice.deleteOne();
      res.json({ message: 'Invoice removed' });
    } else {
      res.status(404).json({ message: 'Invoice not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
