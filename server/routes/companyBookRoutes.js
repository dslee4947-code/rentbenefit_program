import express from 'express';
import {
  listTransactions,
  getSummary,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  importExcel
} from '../controllers/companyBookController.js';
import { checkAdminPermission } from '../middleware/roleMiddleware.js';
import { uploadSingleFile } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// 급여·대표 차입금이 사람별로 보이는 장부라 읽기까지 관리자만
router.use(checkAdminPermission);

router.get('/summary', getSummary);
router.post('/import', uploadSingleFile(), importExcel);

router.route('/transactions')
  .get(listTransactions)
  .post(createTransaction);

router.route('/transactions/:id')
  .put(updateTransaction)
  .delete(deleteTransaction);

export default router;
