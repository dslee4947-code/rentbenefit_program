import express from 'express';
import {
  getDocumentStorageSetting,
  updateDocumentStorageSetting,
  previewDocumentStorageSetting
} from '../controllers/settingController.js';
import { checkAdminPermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

// 읽기는 누구나 (화면에서 "어디에 저장되는지"를 보여 주는 데 쓴다)
router.get('/document-storage', getDocumentStorageSetting);

// 바꾸는 것은 관리자만. 경로를 잘못 바꾸면 프로그램 전체의 저장 위치가 흔들린다.
router.post('/document-storage/preview', checkAdminPermission, previewDocumentStorageSetting);
router.put('/document-storage', checkAdminPermission, updateDocumentStorageSetting);

export default router;
