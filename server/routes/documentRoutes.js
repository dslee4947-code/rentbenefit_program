import express from 'express';
import { uploadDocument, saveDocumentLocal } from '../controllers/documentController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';
import { uploadSingleFile } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.post('/upload', checkWritePermission, uploadSingleFile(), uploadDocument);
router.post('/save-local', checkWritePermission, uploadSingleFile(), saveDocumentLocal);

export default router;
