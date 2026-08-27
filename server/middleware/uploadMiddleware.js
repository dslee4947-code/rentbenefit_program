import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// multer 에러(용량 초과 등)를 원본 메시지 대신 프론트가 처리할 수 있는 JSON으로 변환.
// PNG(무손실)로 캡처한 고해상도 PDF는 JPEG보다 용량이 커질 수 있어 여유있게 20MB로 설정.
export const uploadSingleFile = (fieldName = 'file') => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? '파일 용량이 너무 큽니다. (최대 20MB)'
        : `파일 업로드 오류: ${err.message}`;
      return res.status(400).json({ success: false, message });
    }
    if (err) {
      return res.status(400).json({ success: false, message: err.message || '파일 업로드 오류가 발생했습니다.' });
    }
    next();
  });
};
