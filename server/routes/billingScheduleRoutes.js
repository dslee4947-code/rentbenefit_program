import express from 'express';
import multer from 'multer';
import {
  generateSchedule,
  getScheduleByContract,
  getDueRounds,
  updateRound,
  issueRound,
  addRoundAttachment,
  removeRoundAttachment,
  bulkUpdateRoundStatus,
  addUpcomingAttachment,
  getIssuedRounds,
  getSchedulesSummary,
  importBillingHistory,
  downloadHistoryTemplate,
  updateRoundPayment,
  updateAttachmentNoticeStatus,
  getOverdueNotices,
  getFineNotices,
  sendNoticeMail
} from '../controllers/billingScheduleController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = express.Router();

// 고정 경로를 :id 보다 먼저 선언해야 'due'가 id로 잘못 해석되지 않는다
router.get('/due', getDueRounds);
router.get('/issued', getIssuedRounds);
router.get('/history-template', downloadHistoryTemplate);
// 납부기한이 지났는데 고객이 아직 안 낸 고지서
router.get('/overdue-notices', getOverdueNotices);
// 고지서 관리 화면 목록 (계약을 가로질러 모은다)
router.get('/fine-notices', getFineNotices);
router.post('/import-history', checkWritePermission, upload.single('file'), importBillingHistory);
router.get('/', getSchedulesSummary);
router.get('/contract/:contractId', getScheduleByContract);
// 회차를 고르지 않고 '다음에 나갈 청구서'에 서류를 붙인다
router.post('/contract/:contractId/upcoming/attachments', checkWritePermission, upload.single('file'), addUpcomingAttachment);
router.patch('/rounds/bulk-status', checkWritePermission, bulkUpdateRoundStatus);
router.post('/generate/:contractId', checkWritePermission, generateSchedule);
router.put('/:id/rounds/:no', checkWritePermission, updateRound);
router.patch('/:id/rounds/:no/payment', checkWritePermission, updateRoundPayment);
router.post('/:id/rounds/:no/issue', checkWritePermission, upload.single('file'), issueRound);
router.post('/:id/rounds/:no/attachments', checkWritePermission, upload.single('file'), addRoundAttachment);
router.delete('/:id/rounds/:no/attachments/:index', checkWritePermission, removeRoundAttachment);
// 고지서 안내 메일 (계약의 범칙금 E-MAIL로 원본을 붙여 보낸다)
router.post('/:id/rounds/:no/attachments/:index/notify', checkWritePermission, sendNoticeMail);
// 고객이 직접 낸 고지서 표시 (청구액에서 빼되 기록은 남긴다)
router.patch('/:id/rounds/:no/attachments/:index/notice-status', checkWritePermission, updateAttachmentNoticeStatus);

export default router;
