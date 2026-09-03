import express from 'express';
import multer from 'multer';
import {
  getInvoiceTemplate,
  updateInvoiceTemplate,
  uploadSignature,
  getSignature,
  deleteSignature
} from '../controllers/mailTemplateController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

// 서명 이미지는 메일에 붙는 그림이라 크지 않다. 5MB면 넉넉하다.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = express.Router();

router.get('/invoice', getInvoiceTemplate);
router.put('/invoice', checkWritePermission, updateInvoiceTemplate);
router.get('/invoice/signature', getSignature);
router.post('/invoice/signature', checkWritePermission, upload.single('file'), uploadSignature);
router.delete('/invoice/signature', checkWritePermission, deleteSignature);

export default router;
