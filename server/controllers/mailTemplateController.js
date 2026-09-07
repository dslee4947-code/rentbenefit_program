import MailTemplate from '../models/MailTemplate.js';

const KEY = 'invoice';

/**
 * 양식 종류별 기본 문구.
 *
 * 고지서 안내는 청구서와 성격이 다르다. 청구서는 "이만큼 나갑니다"이고,
 * 고지서 안내는 "기한 안에 직접 내시면 청구하지 않습니다"라는 부탁이다.
 * 같은 문구를 쓰면 법인이 이미 청구된 줄 알고 그냥 둔다.
 */
export const TEMPLATE_DEFAULTS = {
  invoice: {},
  'fine-notice': {
    subject: '[렌트베네핏] {{계약자}} {{차량번호}} {{종류}} 고지서 안내 (납부기한 {{납부기한}})',
    body: [
      '{{계약자}} 담당자님께',
      '',
      '아래 고지서가 도착하여 안내드립니다.',
      '',
      '  · 차량번호 : {{차량번호}}',
      '  · 종류     : {{종류}}',
      '  · 위반일   : {{위반일}}',
      '  · 금액     : {{금액}}',
      '  · 납부기한 : {{납부기한}}',
      '',
      '첨부된 고지서로 납부기한 내에 직접 납부해 주시기 바랍니다.',
      '기한 내 납부가 확인되지 않으면 다음 달 렌트료 청구서에 합산하여 청구됩니다.',
      '',
      '납부하셨으면 회신 주시면 청구 대상에서 제외하겠습니다.',
      '감사합니다.'
    ].join('\n')
  },

  /**
   * 고객이 직접 내는 계약에 보내는 안내.
   *
   * 이 법인은 담당자가 운전자를 찾아 고지서를 넘긴다. 담당자가 움직여야 일이 되므로
   * "누가 운전했는지 확인해 달라"는 부탁이 앞에 와야 한다. 대납 안내와 같은 글을 쓰면
   * 담당자가 우리가 알아서 낸 줄 알고 그냥 둔다.
   */
  'fine-notice-driver': {
    subject: '[렌트베네핏] {{계약자}} {{차량번호}} {{종류}} 운전자 확인 요청 (납부기한 {{납부기한}})',
    body: [
      '{{계약자}} 담당자님께',
      '',
      '아래 고지서가 도착하여 안내드립니다.',
      '',
      '  · 차량번호 : {{차량번호}}',
      '  · 종류     : {{종류}}',
      '  · 위반일   : {{위반일}}',
      '  · 금액     : {{금액}}',
      '  · 납부기한 : {{납부기한}}',
      '',
      '해당 일자의 운전자를 확인하시어 첨부된 고지서로 납부기한 내에 직접 납부하도록 안내 부탁드립니다.',
      '',
      '납부를 마치신 후 회신해 주시면 처리 완료로 정리하겠습니다.',
      '기한 내 회신이 없으면 저희가 먼저 납부한 뒤 다음 달 렌트료 청구서에 합산하여 청구드립니다.',
      '',
      '감사합니다.'
    ].join('\n')
  },

  /**
   * 명의를 넘길 때 관공서에 보내는 글.
   *
   * 받는 곳이 고객이 아니라 경찰서·구청이다. 부탁하는 글이 아니라 근거를 대는 글이라
   * 계약 사실과 첨부 서류를 먼저 밝힌다. 계약서를 함께 붙여야 접수가 된다.
   */
  'fine-notice-transfer': {
    subject: '[렌트베네핏] 운전자 확인에 따른 과태료 대상자 변경 요청 ({{차량번호}} / {{고지번호}})',
    body: [
      '담당자님께',
      '',
      '아래 차량은 저희 회사가 소유하고 장기렌트 계약으로 임대 중인 차량입니다.',
      '위반 당시 운전자가 확인되어 대상자 변경을 요청드립니다.',
      '',
      '  · 차량번호   : {{차량번호}}',
      '  · 고지번호   : {{고지번호}}',
      '  · 종류       : {{종류}}',
      '  · 위반일     : {{위반일}}',
      '  · 금액       : {{금액}}',
      '  · 납부기한   : {{납부기한}}',
      '',
      '  · 임차인     : {{계약자}}',
      '  · 계약번호   : {{계약번호}}',
      '  · 운전자     : {{운전자}}',
      '  · 운전자 연락처 : {{운전자연락처}}',
      '',
      '첨부 : 고지서 사본, 자동차대여(장기렌트) 계약서 사본',
      '',
      '확인하시어 대상자 변경 처리 부탁드립니다.',
      '감사합니다.'
    ].join('\n')
  }
};

/**
 * 메일 양식을 가져온다. 없으면 그 종류의 기본값으로 하나 만든다.
 *
 * 서명은 종류가 달라도 같은 회사 서명이라, 청구서 양식에 올려 둔 것을 함께 쓴다.
 * 종류마다 따로 올리게 하면 하나만 바꿨을 때 메일마다 서명이 달라진다.
 *
 * @param {string} [key] 양식 종류 ('invoice' | 'fine-notice')
 * @returns {Promise<object>} 양식
 */
export const getOrCreateTemplate = async (key = KEY) => {
  const found = await MailTemplate.findOne({ key });
  if (found) return found;
  return MailTemplate.create({ key, ...(TEMPLATE_DEFAULTS[key] || {}) });
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
