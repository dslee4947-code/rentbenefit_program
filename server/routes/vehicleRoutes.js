import express from 'express';
import { 
  getVehicles, 
  createVehicle, 
  updateVehicle, 
  deleteVehicle 
} from '../controllers/vehicleController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/', getVehicles);
router.post('/', checkWritePermission, createVehicle);
router.put('/:id', checkWritePermission, updateVehicle);
router.delete('/:id', checkWritePermission, deleteVehicle);

export default router;
