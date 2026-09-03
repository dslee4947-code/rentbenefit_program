import express from 'express';
import multer from 'multer';
import {
  getContracts,
  getContractById,
  createContract,
  createDraftContract,
  updateContract,
  deleteContract,
  importContracts,
  archiveContract,
  unarchiveContract,
  getContractTemplate
} from '../controllers/contractController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Excel template download route (Must be registered before /:id)
router.get('/template', getContractTemplate);

// Excel import route
router.post('/import', checkWritePermission, upload.single('file'), importContracts);

// 임시저장 - /:id 보다 먼저 등록해야 "draft"가 :id로 잘못 매칭되지 않는다
router.post('/draft', checkWritePermission, createDraftContract);

router.route('/')
  .get(getContracts)
  .post(checkWritePermission, createContract);

// 계약서 보관 / 되돌리기. '/:id' 보다 먼저 선언해야 경로가 id로 해석되지 않는다
router.post('/:id/archive', checkWritePermission, archiveContract);
router.post('/:id/unarchive', checkWritePermission, unarchiveContract);

router.route('/:id')
  .get(getContractById)
  .put(checkWritePermission, updateContract)
  .delete(checkWritePermission, deleteContract);

export default router;
