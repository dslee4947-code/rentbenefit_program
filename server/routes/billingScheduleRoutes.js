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
  getSchedulesSummary
} from '../controllers/billingScheduleController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = express.Router();

// 고정 경로를 :id 보다 먼저 선언해야 'due'가 id로 잘못 해석되지 않는다
router.get('/due', getDueRounds);
router.get('/issued', getIssuedRounds);
router.get('/', getSchedulesSummary);
router.get('/contract/:contractId', getScheduleByContract);
// 회차를 고르지 않고 '다음에 나갈 청구서'에 서류를 붙인다
router.post('/contract/:contractId/upcoming/attachments', checkWritePermission, upload.single('file'), addUpcomingAttachment);
router.patch('/rounds/bulk-status', checkWritePermission, bulkUpdateRoundStatus);
router.post('/generate/:contractId', checkWritePermission, generateSchedule);
router.put('/:id/rounds/:no', checkWritePermission, updateRound);
router.post('/:id/rounds/:no/issue', checkWritePermission, upload.single('file'), issueRound);
router.post('/:id/rounds/:no/attachments', checkWritePermission, upload.single('file'), addRoundAttachment);
router.delete('/:id/rounds/:no/attachments/:index', checkWritePermission, removeRoundAttachment);

export default router;
