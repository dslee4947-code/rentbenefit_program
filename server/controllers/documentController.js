import { uploadDocumentToSharePoint } from '../utils/documentStorageService.js';

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
