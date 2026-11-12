import express from 'express';
import multer from 'multer';
import {
  getDeliveryDocs,
  saveDeliveryDocsInput,
  searchDeliveryDocs,
  saveFactDoc,
  sendFactDoc,
  getFactDocFile,
  saveEndDoc,
  sendEndDoc,
  getEndDocFile, getSettlementInfo
} from '../controllers/deliveryDocsController.js';
import { getDepositNotices, sendDepositNotice } from '../controllers/depositNoticeController.js';
import { getReleaseReport, saveReleaseReport } from '../controllers/releaseReportController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

// 계약사실 증명원 · 상환스케쥴표 · 계약 종료 서류 · 보증금·선수금 안내문
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// 고정 경로를 :contractId 보다 먼저 둔다
router.get('/search', searchDeliveryDocs);
router.get('/deposit-notices', getDepositNotices);

router.get('/:contractId', getDeliveryDocs);
// 렌트출고 보고 글
router.get('/:contractId/release-report', getReleaseReport);
router.put('/:contractId/release-report/:vehicleId', checkWritePermission, saveReleaseReport);
router.put('/:contractId', checkWritePermission, saveDeliveryDocsInput);
router.post('/:contractId/deposit-notice/send', checkWritePermission, upload.single('file'), sendDepositNotice);
// 계약사실 증명원 · 상환스케쥴표 따로 만들어 저장 (장기렌트 청구서 > 계약사실 증명원, 고지서 운전자 변경)
router.post('/:contractId/fact-docs', checkWritePermission, upload.single('file'), saveFactDoc);
router.post('/:contractId/fact-docs/send', checkWritePermission, upload.single('file'), sendFactDoc);
router.get('/:contractId/fact-docs/:docId/file', getFactDocFile);
// 계약종료 확인서 (중도해지 · 만기 인수 · 만기 반납) 저장
router.post('/:contractId/end-docs', checkWritePermission, upload.single('file'), saveEndDoc);
router.post('/:contractId/end-docs/send', checkWritePermission, upload.single('file'), sendEndDoc);
router.get('/:contractId/end-docs/:docId/file', getEndDocFile);
router.get('/:contractId/settlement-info', getSettlementInfo);

export default router;
