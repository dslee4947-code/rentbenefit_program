import express from 'express';
import { checkAdminPermission } from '../middleware/roleMiddleware.js';
import { runExcelAutoSync, getExcelAutoSyncStatus, setExcelSyncSwitch } from '../utils/excelAutoSync.js';

/**
 * 자금팀 엑셀(OneDrive) 자동 갱신 상태와 [지금 갱신] (utils/excelAutoSync.js).
 * 상태는 원장 화면을 보는 사람 누구나, 실행은 관리자만(회사 장부의 급여가 함께 바뀐다).
 */
const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    res.json({ success: true, ...(await getExcelAutoSyncStatus()) });
  } catch (error) {
    res.status(500).json({ success: false, message: `상태를 읽지 못했습니다: ${error.message}` });
  }
});

// body.dryRun=true면 바뀔 내용만 계산한다
router.post('/run', checkAdminPermission, async (req, res) => {
  try {
    const result = await runExcelAutoSync({ trigger: 'manual', dryRun: Boolean(req.body?.dryRun), user: req.user });
    if (result.skipped) return res.status(409).json({ success: false, message: result.message });
    res.json({ success: result.ok, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: `엑셀 갱신 중 오류: ${error.message}` });
  }
});

// 엑셀 연동 끄기/켜기. 직원이 엑셀 대신 프로그램에서 바로 관리하게 되면 끈다.
router.post('/switch', checkAdminPermission, async (req, res) => {
  try {
    const on = Boolean(req.body?.on);
    await setExcelSyncSwitch({ on, user: req.user });
    res.json({ success: true, message: on ? '엑셀 연동을 다시 켰습니다.' : '엑셀 연동을 껐습니다. 이제 원장은 프로그램에서 직접 관리합니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: `설정을 바꾸지 못했습니다: ${error.message}` });
  }
});

export default router;
