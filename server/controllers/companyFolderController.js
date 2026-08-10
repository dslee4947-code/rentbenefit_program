import CompanyFolder from '../models/CompanyFolder.js';

// @desc    법인명(+사업자번호)으로 저장된 실제 원드라이브 폴더명을 조회
// @route   GET /api/company-folders/lookup?companyName=...&bizNo=...
export const lookupCompanyFolder = async (req, res) => {
  try {
    const { companyName, bizNo } = req.query;
    if (!companyName) {
      return res.status(400).json({ success: false, message: 'companyName은 필수입니다.' });
    }

    let mapping = null;
    if (bizNo) {
      mapping = await CompanyFolder.findOne({ companyName, bizNo });
    }
    if (!mapping) {
      // 사업자번호 없이 등록된 경우, 혹은 사업자번호가 아직 지정 안 된 첫 등록건
      mapping = await CompanyFolder.findOne({ companyName, bizNo: '' });
    }

    res.json({ success: true, folder: mapping || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    법인 폴더명을 등록(기존 폴더명 직접 입력 또는 신규 자동 생성 이름 확정)한다.
//          실제 디렉터리는 문서를 처음 저장하는 시점에 saveDocumentLocal이 만든다 (문서종류 폴더 아래 법인명 하위 폴더).
// @route   POST /api/company-folders
export const registerCompanyFolder = async (req, res) => {
  try {
    const { companyName, bizNo, folderName, autoCreate, paymentDay } = req.body;
    if (!companyName) {
      return res.status(400).json({ success: false, message: 'companyName은 필수입니다.' });
    }

    let finalFolderName = (folderName || '').trim();

    if (autoCreate) {
      // 새 폴더 자동 생성: {결제일}_{법인명} (동명 법인이 이미 등록돼 있으면 사업자번호 뒤 4자리로 구분)
      const dayPrefix = (paymentDay || '25일').trim();
      const existingForName = await CompanyFolder.exists({ companyName });
      finalFolderName = existingForName && bizNo
        ? `${dayPrefix}_${companyName}_${bizNo.slice(-4)}`
        : `${dayPrefix}_${companyName}`;
    }

    if (!finalFolderName) {
      return res.status(400).json({ success: false, message: '폴더명을 입력하거나 자동 생성을 선택해 주세요.' });
    }

    const mapping = await CompanyFolder.findOneAndUpdate(
      { companyName, bizNo: bizNo || '' },
      { companyName, bizNo: bizNo || '', folderName: finalFolderName },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, folder: mapping });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
