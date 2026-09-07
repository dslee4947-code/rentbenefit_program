import { uploadDocumentToSharePoint, saveFileLocally } from '../utils/documentStorageService.js';

// @desc    견적서/계약서/청구서/정비내역서 PDF를 사업부별 SharePoint 문서함에 업로드
// @route   POST /api/documents/upload
export const uploadDocument = async (req, res) => {
  try {
    const { businessLine, customerName, docType, fileName } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: '업로드할 파일이 없습니다.' });
    }
    if (!businessLine || !customerName || !docType || !fileName) {
      return res.status(400).json({ success: false, message: 'businessLine, customerName, docType, fileName은 필수입니다.' });
    }

    const result = await uploadDocumentToSharePoint({
      businessLine,
      customerName,
      docType,
      fileName,
      fileBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    res.json({ success: true, message: '문서함에 저장되었습니다.', webUrl: result.webUrl });
  } catch (error) {
    console.error('Error uploading document to SharePoint:', error);
    res.status(500).json({ success: false, message: error.message || '문서함 저장 중 오류가 발생했습니다.' });
  }
};

// @desc    견적서/계약서/청구서/차량정비 PDF를 로컬 원드라이브 폴더에 직접 저장 (폴더 자동 생성)
// @route   POST /api/documents/save-local
// RENT 사업부는 "RENT/{문서종류 최상위 폴더}/{법인명}/파일" 구조로 저장한다
// (예: RENT/03.청구서/(주)한촌/청구서_....pdf). 법인명은 companyFolderName(등록된 실제 폴더명)이
// 있으면 그걸 쓰고, 없으면 customerName을 그대로 하위 폴더명으로 사용한다.
export const saveDocumentLocal = async (req, res) => {
  try {
    const { businessLine, customerName, companyFolderName, docType, fileName } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: '업로드할 파일이 없습니다.' });
    }
    if (!businessLine || !customerName || !docType || !fileName) {
      return res.status(400).json({ success: false, message: '필수 매개변수가 누락되었습니다.' });
    }

    const { fileName: finalFileName, localPath } = await saveFileLocally({
      businessLine,
      companySubfolderName: companyFolderName || customerName,
      docType,
      fileName,
      fileBuffer: req.file.buffer
    });

    console.log(`[Local Save] Saved file to: ${localPath}`);

    res.json({
      success: true,
      message: '문서함(원드라이브)에 성공적으로 저장되었습니다.',
      fileName: finalFileName,
      localPath
    });
  } catch (error) {
    console.error('Error saving document locally:', error);
    res.status(500).json({ success: false, message: error.message || '로컬 저장 중 오류가 발생했습니다.' });
  }
};
