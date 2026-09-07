import express from 'express';
import { getDashboardSummary, getBillingGaps } from '../controllers/dashboardController.js';

const router = express.Router();

router.get('/summary', getDashboardSummary);
// 출고 준비가 끝나지 않아 청구가 시작되지 않은 계약
router.get('/billing-gaps', getBillingGaps);

export default router;
