import express from 'express';
import multer from 'multer';
import {
  getServicePlan,
  getVehicleServices,
  createVehicleService,
  updateVehicleService,
  deleteVehicleService,
  getVehicleServiceFile
} from '../controllers/vehicleServiceController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = express.Router();

// 차량 정비·검사 관리: 다음 자동차검사·정기점검 계획과 차량별 정비·수리 이력
router.get('/plan', getServicePlan);
router.get('/vehicle/:vehicleId', getVehicleServices);
// file: 예전 간단 양식(한 장) / files: 상세 양식(수리 내역서·견적서·사진 여러 장)
router.post('/', checkWritePermission, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'files', maxCount: 10 }]), createVehicleService);
router.get('/:id/file', getVehicleServiceFile);
router.patch('/:id', checkWritePermission, updateVehicleService);
router.delete('/:id', checkWritePermission, deleteVehicleService);

export default router;
