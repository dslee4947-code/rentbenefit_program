import Inquiry from '../models/Inquiry.js';

// @desc    Get inquiries (default: 대기중인 것만, ?status=all 이면 전체)
// @route   GET /api/inquiries
// @access  Public
export const getInquiries = async (req, res) => {
  try {
    const { status, search } = req.query;
    const query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    let inquiries = await Inquiry.find(query)
      .populate('customer')
      .sort({ createdAt: -1 });

    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      inquiries = inquiries.filter(i => (
        (i.customer?.name || '').toLowerCase().includes(term) ||
        (i.customer?.surname || '').toLowerCase().includes(term) ||
        (i.customer?.givenName || '').toLowerCase().includes(term) ||
        (i.content || '').toLowerCase().includes(term)
      ));
    }

    res.json(inquiries);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create new inquiry
// @route   POST /api/inquiries
// @access  Public
export const createInquiry = async (req, res) => {
  try {
    const { customerId, content, assignee, createdBy } = req.body;
    if (!customerId || !content || !content.trim()) {
      return res.status(400).json({ message: '고객과 문의 내용은 필수입니다.' });
    }

    const inquiry = await Inquiry.create({
      customer: customerId,
      content: content.trim(),
      assignee: assignee || '',
      createdBy: createdBy || ''
    });

    const populated = await Inquiry.findById(inquiry._id).populate('customer');
    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update inquiry (내용/담당자 수정, 상태 변경 포함)
// @route   PUT /api/inquiries/:id
// @access  Public
export const updateInquiry = async (req, res) => {
  try {
    const inquiry = await Inquiry.findById(req.params.id);
    if (!inquiry) {
      return res.status(404).json({ message: 'Inquiry not found' });
    }

    if (req.body.content !== undefined) inquiry.content = req.body.content;
    if (req.body.assignee !== undefined) inquiry.assignee = req.body.assignee;

    if (req.body.status !== undefined && req.body.status !== inquiry.status) {
      inquiry.status = req.body.status;
      if (req.body.status === '처리완료') {
        inquiry.resolvedAt = new Date();
        inquiry.resolvedBy = req.body.resolvedBy || '';
      } else {
        inquiry.resolvedAt = undefined;
        inquiry.resolvedBy = undefined;
      }
    }

    const updated = await inquiry.save();
    const populated = await Inquiry.findById(updated._id).populate('customer');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete inquiry
// @route   DELETE /api/inquiries/:id
// @access  Public
export const deleteInquiry = async (req, res) => {
  try {
    const inquiry = await Inquiry.findById(req.params.id);
    if (!inquiry) {
      return res.status(404).json({ message: 'Inquiry not found' });
    }
    await Inquiry.deleteOne({ _id: req.params.id });
    res.json({ message: 'Inquiry removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
