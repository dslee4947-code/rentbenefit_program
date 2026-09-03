import express from 'express';
import multer from 'multer';
import {
  getVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getVehicleTemplate,
  importVehicles
} from '../controllers/vehicleController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = express.Router();

// '/:id'보다 먼저 선언해야 template/import가 차량 id로 해석되지 않는다
router.get('/template', getVehicleTemplate);
router.post('/import', checkWritePermission, upload.single('file'), importVehicles);

router.get('/', getVehicles);
router.post('/', checkWritePermission, createVehicle);
router.put('/:id', checkWritePermission, updateVehicle);
router.delete('/:id', checkWritePermission, deleteVehicle);

export default router;
