import express from 'express';
import { getDashboardSummary, getBillingGaps, getExecutiveSummary, getExecutiveBasis } from '../controllers/dashboardController.js';
import { checkAdminPermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/summary', getDashboardSummary);
// 출고 준비가 끝나지 않아 청구가 시작되지 않은 계약
router.get('/billing-gaps', getBillingGaps);
// 대표용 경영 요약. 매출 규모가 담겨 있어 관리자만 본다.
router.get('/executive', checkAdminPermission, getExecutiveSummary);
// 경영 요약 숫자 카드를 누르면 보는 근거 줄
router.get('/executive/basis', checkAdminPermission, getExecutiveBasis);

export default router;
