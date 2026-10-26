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
import { getExtensionPreview, extendContract, returnContract, takeoverContract, rerentVehicle } from '../controllers/contractLifecycleController.js';
import { uploadSignedDocument, getSignedDocuments, downloadSignedDocument } from '../controllers/contractSignedController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Excel template download route (Must be registered before /:id)
router.get('/template', getContractTemplate);

// Excel import route
router.post('/import', checkWritePermission, upload.single('file'), importContracts);

// 임시저장 - /:id 보다 먼저 등록해야 "draft"가 :id로 잘못 매칭되지 않는다
router.post('/draft', checkWritePermission, createDraftContract);
// 반납받은 차(재고·단기렌트)를 새 고객에게 재렌트
router.post('/rerent', checkWritePermission, rerentVehicle);

router.route('/')
  .get(getContracts)
  .post(checkWritePermission, createContract);

// 계약서 보관 / 되돌리기. '/:id' 보다 먼저 선언해야 경로가 id로 해석되지 않는다
// 만기 처리 - 연장 (같은 차량에 새 계약을 이어 붙인다)
router.get('/:id/extension-preview', getExtensionPreview);
// 연장: 서명 완료본(file)을 함께 받는다. 없으면 관리자만 사유를 적고 먼저 반영할 수 있다
router.post('/:id/extend', checkWritePermission, upload.single('file'), extendContract);
// 서명 완료본(모두싸인 등에서 서명을 마친 계약서 PDF) — 신차·중고·연장 공통
router.get('/:id/signed', getSignedDocuments);
router.post('/:id/signed', checkWritePermission, upload.single('file'), uploadSignedDocument);
router.get('/:id/signed/:version/file', downloadSignedDocument);
router.post('/:id/return', checkWritePermission, returnContract);
router.post('/:id/takeover', checkWritePermission, takeoverContract);
router.post('/:id/archive', checkWritePermission, archiveContract);
router.post('/:id/unarchive', checkWritePermission, unarchiveContract);

router.route('/:id')
  .get(getContractById)
  .put(checkWritePermission, updateContract)
  .delete(checkWritePermission, deleteContract);

export default router;
