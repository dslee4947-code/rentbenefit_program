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
  sendDeliveryDocsNow,
  saveFactDoc,
  getFactDocFile,
  saveEndDoc,
  sendEndDoc,
  getEndDocFile, getSettlementInfo
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
// 계약사실 증명원 · 상환스케쥴표 따로 만들어 저장 (장기렌트 청구서 > 계약사실 증명원, 고지서 운전자 변경)
router.post('/:contractId/fact-docs', checkWritePermission, upload.single('file'), saveFactDoc);
router.get('/:contractId/fact-docs/:docId/file', getFactDocFile);
// 계약종료 확인서 (중도해지 · 만기 인수 · 만기 반납) 저장
router.post('/:contractId/end-docs', checkWritePermission, upload.single('file'), saveEndDoc);
router.post('/:contractId/end-docs/send', checkWritePermission, upload.single('file'), sendEndDoc);
router.get('/:contractId/end-docs/:docId/file', getEndDocFile);
router.get('/:contractId/settlement-info', getSettlementInfo);

export default router;
