import express from 'express';
import {
  listTransactions,
  getSummary,
  getDepreciation,
  getMoneyFlow,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  importExcel
} from '../controllers/companyBookController.js';
import { checkFinancePermission } from '../middleware/roleMiddleware.js';
import { uploadSingleFile } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// 대시보드 돈 흐름도는 대표(관리자)도 본다. 연도별 합계만 나가고 사람별 줄은 없다.
router.get('/money-flow', (req, res, next) => (req.user?.role === 'admin' || req.user?.financeTeam === true
  ? next()
  : res.status(403).json({ message: '관리자 권한이 필요합니다.' })), getMoneyFlow);

// 급여·대표 차입금이 사람별로 보이는 장부라 읽기까지 자금팀만
router.use(checkFinancePermission);

router.get('/summary', getSummary);
router.get('/depreciation', getDepreciation);
router.post('/import', uploadSingleFile(), importExcel);

router.route('/transactions')
  .get(listTransactions)
  .post(createTransaction);

router.route('/transactions/:id')
  .put(updateTransaction)
  .delete(deleteTransaction);

export default router;
