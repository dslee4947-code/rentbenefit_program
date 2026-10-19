import express from 'express';
import { getShortTermRates, updateShortTermRates } from '../controllers/shortTermRateController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

// 단기렌트·사고대차 단가표. 읽기는 누구나(영업·배차가 쓴다), 저장은 쓰기 권한(요금 규칙은 컨트롤러에서 관리자만)
router.route('/')
  .get(getShortTermRates)
  .put(checkWritePermission, updateShortTermRates);

export default router;
