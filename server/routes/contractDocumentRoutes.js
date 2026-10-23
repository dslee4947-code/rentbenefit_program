import express from 'express';
import multer from 'multer';
import {
  listTemplates,
  getTemplate,
  uploadTemplate,
  activateTemplate,
  getTemplateMedia,
  downloadTemplateFile,
  getTemplatePdf,
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  refreshDocument,
  confirmDocument,
  getDocumentPdf
} from '../controllers/contractDocumentController.js';
import { checkWritePermission, checkAdminPermission } from '../middleware/roleMiddleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// 전자계약서 양식(엑셀) — 올리기·사용 중 정하기는 관리자만
export const templateRouter = express.Router();
templateRouter.get('/', listTemplates);
templateRouter.get('/:id', getTemplate);
templateRouter.get('/:id/media', getTemplateMedia);
templateRouter.get('/:id/file', downloadTemplateFile);
templateRouter.get('/:id/pdf', getTemplatePdf);
templateRouter.post('/', checkAdminPermission, upload.single('file'), uploadTemplate);
templateRouter.patch('/:id/activate', checkAdminPermission, activateTemplate);

// 계약마다 하나인 전자계약서
export const documentRouter = express.Router();
documentRouter.get('/', listDocuments);
documentRouter.get('/:id/pdf', getDocumentPdf);
documentRouter.get('/:id', getDocument);
documentRouter.post('/', checkWritePermission, createDocument);
documentRouter.patch('/:id', checkWritePermission, updateDocument);
documentRouter.post('/:id/refresh', checkWritePermission, refreshDocument);
documentRouter.post('/:id/confirm', checkWritePermission, confirmDocument);
