import express from 'express';
import { checkWritePermission } from '../middleware/roleMiddleware.js';
import { listShortTerm, createShortTerm, updateShortTerm, returnShortTerm } from '../controllers/shortTermBillingController.js';

// 단기렌트 월 청구 등록·반납. 청구서는 장기렌트 청구서 화면에서 발행한다
const router = express.Router();
router.get('/', listShortTerm);
router.post('/', checkWritePermission, createShortTerm);
router.patch('/:id', checkWritePermission, updateShortTerm);
router.post('/:id/return', checkWritePermission, returnShortTerm);
export default router;
