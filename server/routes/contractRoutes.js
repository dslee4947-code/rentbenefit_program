import express from 'express';
import multer from 'multer';
import {
  getContracts,
  getContractById,
  createContract,
  updateContract,
  deleteContract,
  importContracts,
  getContractTemplate
} from '../controllers/contractController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Excel template download route (Must be registered before /:id)
router.get('/template', getContractTemplate);

// Excel import route
router.post('/import', checkWritePermission, upload.single('file'), importContracts);

router.route('/')
  .get(getContracts)
  .post(checkWritePermission, createContract);

router.route('/:id')
  .get(getContractById)
  .put(checkWritePermission, updateContract)
  .delete(checkWritePermission, deleteContract);

export default router;
