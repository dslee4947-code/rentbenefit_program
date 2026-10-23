import express from 'express';
import multer from 'multer';
import {
  getDeliveryDocsQueue,
  getDeliveryDocs,
  saveDeliveryDocsInput,
  approveDeliveryDocs,
  cancelDeliveryDocs,
  getDeliveryDocsFile,
  runDeliveryDocsNow,
  searchDeliveryDocs,
  sendDeliveryDocsNow
} from '../controllers/deliveryDocsController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

// 인도 서류 발송 (계약사실 증명원 + 상환스케쥴)
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// 고정 경로를 :contractId 보다 먼저 둔다
router.get('/queue', getDeliveryDocsQueue);
router.get('/search', searchDeliveryDocs);
router.post('/run', checkWritePermission, runDeliveryDocsNow);

router.get('/:contractId', getDeliveryDocs);
router.put('/:contractId', checkWritePermission, saveDeliveryDocsInput);
router.post('/:contractId/approve', checkWritePermission, upload.single('file'), approveDeliveryDocs);
router.post('/:contractId/send-now', checkWritePermission, upload.single('file'), sendDeliveryDocsNow);
router.post('/:contractId/cancel', checkWritePermission, cancelDeliveryDocs);
router.get('/:contractId/file', getDeliveryDocsFile);

export default router;
