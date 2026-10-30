import express from 'express';
import {
  getFleetFilings,
  updateFleetInfo,
  createFleetFiling,
  updateFleetFiling,
  setFleetFilingStatus,
  deleteFleetFiling,
  importFleetWorkbook,
  uploadFleetNotice,
  getFleetNoticeFile
} from '../controllers/fleetFilingController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';
import { uploadSingleFile } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// 증차·감차 공문. 읽기는 로그인한 사람 누구나, 고치기는 쓰기 권한
router.use(checkWritePermission);

router.get('/', getFleetFilings);
router.put('/info', updateFleetInfo);
router.post('/import', uploadSingleFile(), importFleetWorkbook);
router.post('/notice', uploadSingleFile(), uploadFleetNotice);
router.get('/:id/notice', getFleetNoticeFile);
router.post('/', createFleetFiling);
router.put('/:id', updateFleetFiling);
router.post('/:id/status', setFleetFilingStatus);
router.delete('/:id', deleteFleetFiling);

export default router;
