import express from 'express';
import {
  getFleetFilings,
  updateFleetInfo,
  createFleetFiling,
  updateFleetFiling,
  setFleetFilingStatus,
  deleteFleetFiling,
  importFleetWorkbook,
  uploadFleetNotice,
  getFleetNoticeFile
} from '../controllers/fleetFilingController.js';
import { getCarAgeFilings, createCarAgeFiling, updateCarAgeFiling, setCarAgeFilingStatus, deleteCarAgeFiling } from '../controllers/carAgeFilingController.js';
import { getScrapFilings, createScrapFiling, updateScrapFiling, setScrapFilingStatus, deleteScrapFiling } from '../controllers/scrapFilingController.js';
import { listScrapFiles, uploadScrapFile, getScrapFile, deleteScrapFile, sendScrapMail, listRegCerts, uploadRegCert, getRegCert } from '../controllers/scrapMailController.js';
import { getLongTermList, importLongTermList } from '../controllers/longTermListController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';
import { uploadSingleFile } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// 증차·감차 공문. 읽기는 로그인한 사람 누구나, 고치기는 쓰기 권한
router.use(checkWritePermission);

router.get('/', getFleetFilings);
// 차령조정(차령 연장) 신청서. '/:id'보다 먼저 둔다.
router.get('/car-age', getCarAgeFilings);
router.post('/car-age', createCarAgeFiling);
router.put('/car-age/:id', updateCarAgeFiling);
router.post('/car-age/:id/status', setCarAgeFilingStatus);
router.delete('/car-age/:id', deleteCarAgeFiling);
// 대폐차 신고서. '/:id'보다 먼저 둔다.
router.get('/scrap', getScrapFilings);
router.post('/scrap', createScrapFiling);
router.get('/scrap/certs', listRegCerts);
router.post('/scrap/certs', uploadSingleFile(), uploadRegCert);
router.get('/scrap/certs/:plateNo', getRegCert);
router.put('/scrap/:id', updateScrapFiling);
router.post('/scrap/:id/status', setScrapFilingStatus);
router.delete('/scrap/:id', deleteScrapFiling);
router.get('/scrap/:id/files', listScrapFiles);
router.post('/scrap/:id/files', uploadSingleFile(), uploadScrapFile);
router.get('/scrap/:id/files/:fileId', getScrapFile);
router.delete('/scrap/:id/files/:fileId', deleteScrapFile);
router.post('/scrap/:id/mail', uploadSingleFile(), sendScrapMail);
// 차고지 감면 공문에 붙이는 장기렌트 차량 명세
router.get('/long-term-list', getLongTermList);
router.post('/long-term-list/import', uploadSingleFile(), importLongTermList);
router.put('/info', updateFleetInfo);
router.post('/import', uploadSingleFile(), importFleetWorkbook);
router.post('/notice', uploadSingleFile(), uploadFleetNotice);
router.get('/:id/notice', getFleetNoticeFile);
router.post('/', createFleetFiling);
router.put('/:id', updateFleetFiling);
router.post('/:id/status', setFleetFilingStatus);
router.delete('/:id', deleteFleetFiling);

export default router;
