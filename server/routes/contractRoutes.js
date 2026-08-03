import express from 'express';
import {
  getContracts,
  getContractById,
  createContract,
  updateContract,
  deleteContract
} from '../controllers/contractController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.route('/')
  .get(getContracts)
  .post(checkWritePermission, createContract);

router.route('/:id')
  .get(getContractById)
  .put(checkWritePermission, updateContract)
  .delete(checkWritePermission, deleteContract);

export default router;
