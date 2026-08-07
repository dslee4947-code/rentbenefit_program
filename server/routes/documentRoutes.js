import express from 'express';
import multer from 'multer';
import { uploadDocument } from '../controllers/documentController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

const router = express.Router();

router.post('/upload', checkWritePermission, upload.single('file'), uploadDocument);

export default router;
