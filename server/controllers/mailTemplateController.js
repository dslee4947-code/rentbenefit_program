import MailTemplate from '../models/MailTemplate.js';

const KEY = 'invoice';

/**
 * 청구서 메일 양식을 가져온다. 없으면 기본값으로 하나 만든다.
 * @returns {Promise<object>} 양식
 */
export const getOrCreateTemplate = async () => {
  const found = await MailTemplate.findOne({ key: KEY });
  if (found) return found;
  return MailTemplate.create({ key: KEY });
};

// @desc    청구서 메일 양식 조회 (서명 이미지는 용량이 커서 별도 주소로 내려준다)
// @route   GET /api/mail-templates/invoice
export const getInvoiceTemplate = async (req, res) => {
  try {
    const t = await getOrCreateTemplate();
    res.json({
      success: true,
      template: {
        subject: t.subject,
        body: t.body,
        signatureFileName: t.signature?.fileName || '',
        hasSignature: Boolean(t.signature?.data?.length),
        signatureUpdatedAt: t.signature?.updatedAt || null,
        updatedAt: t.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    제목·본문 저장
// @route   PUT /api/mail-templates/invoice
export const updateInvoiceTemplate = async (req, res) => {
  try {
    const t = await getOrCreateTemplate();
    if (req.body.subject !== undefined) t.subject = String(req.body.subject).trim();
    if (req.body.body !== undefined) t.body = String(req.body.body);
    t.updatedBy = req.headers['x-user-name'] || undefined;
    await t.save();
    res.json({ success: true, message: '메일 양식을 저장했습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    서명 이미지 올리기
// @route   POST /api/mail-templates/invoice/signature
export const uploadSignature = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '올릴 이미지가 없습니다.' });
    if (!/^image\//.test(req.file.mimetype)) {
      return res.status(400).json({ success: false, message: '이미지 파일만 올릴 수 있습니다. (png, jpg 등)' });
    }
    const t = await getOrCreateTemplate();
    t.signature = {
      fileName: req.file.originalname,
      contentType: req.file.mimetype,
      data: req.file.buffer,
      updatedAt: new Date()
    };
    await t.save();
    res.json({
      success: true,
      fileName: req.file.originalname,
      message: `서명 이미지를 저장했습니다. (${Math.round(req.file.size / 1024)}KB)`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    서명 이미지 내려주기 (화면 미리보기용)
// @route   GET /api/mail-templates/invoice/signature
export const getSignature = async (req, res) => {
  try {
    const t = await MailTemplate.findOne({ key: KEY });
    if (!t?.signature?.data?.length) return res.status(404).send('서명 이미지가 없습니다.');
    res.set('Content-Type', t.signature.contentType || 'image/png');
    res.set('Cache-Control', 'no-store'); // 바꾼 이미지가 바로 보이도록
    res.send(t.signature.data);
  } catch (error) {
    res.status(500).send(error.message);
  }
};

// @desc    서명 이미지 지우기
// @route   DELETE /api/mail-templates/invoice/signature
export const deleteSignature = async (req, res) => {
  try {
    const t = await getOrCreateTemplate();
    t.signature = undefined;
    await t.save();
    res.json({ success: true, message: '서명 이미지를 지웠습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
