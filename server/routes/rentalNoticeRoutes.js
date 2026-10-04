import express from 'express';
import multer from 'multer';
import {
  listRentalNotices,
  createRentalNotice,
  updateRentalNotice,
  deleteRentalNotice,
  getRentalNoticeFile
} from '../controllers/rentalNoticeController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = express.Router();

// 대차(단기렌트·사고대차) 차량의 범칙금·과태료·미납통행료 고지서
router.get('/', listRentalNotices);
router.post('/', checkWritePermission, upload.single('file'), createRentalNotice);
router.get('/:id/file', getRentalNoticeFile);
router.patch('/:id', checkWritePermission, updateRentalNotice);
router.delete('/:id', checkWritePermission, deleteRentalNotice);

export default router;
