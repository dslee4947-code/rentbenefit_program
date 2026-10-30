import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import userRoutes from './routes/userRoutes.js';
import vehicleRoutes from './routes/vehicleRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import quoteRoutes from './routes/quoteRoutes.js';
import contractRoutes from './routes/contractRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import mailTemplateRoutes from './routes/mailTemplateRoutes.js';
import ocrRoutes from './routes/ocrRoutes.js';
import rentalNoticeRoutes from './routes/rentalNoticeRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import billingScheduleRoutes from './routes/billingScheduleRoutes.js';
import ledgerRoutes from './routes/ledgerRoutes.js';
import companyFolderRoutes from './routes/companyFolderRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import settingRoutes from './routes/settingRoutes.js';
import companyBookRoutes from './routes/companyBookRoutes.js';
import shortTermRateRoutes from './routes/shortTermRateRoutes.js';
import inquiryRoutes from './routes/inquiryRoutes.js';
import vehicleServiceRoutes from './routes/vehicleServiceRoutes.js';
import excelSyncRoutes from './routes/excelSyncRoutes.js';
import { templateRouter as contractTemplateRoutes, documentRouter as contractDocumentRoutes } from './routes/contractDocumentRoutes.js';
import deliveryDocsRoutes from './routes/deliveryDocsRoutes.js';
import { runExcelAutoSync, isExcelAutoSyncEnabled } from './utils/excelAutoSync.js';

// Load environment variables
dotenv.config();

import cron from 'node-cron';
import { protect } from './middleware/authMiddleware.js';
import { runDatabaseMigration } from './utils/dbMigration.js';
import { syncOutlookContacts } from './utils/outlookSyncService.js';
import { syncInvoiceSendSchedules } from './utils/invoiceScheduleJob.js';
import { syncFineNoticeSchedules } from './utils/fineNoticeScheduleJob.js';
import { syncVehicleServiceSchedules } from './utils/vehicleServiceScheduleJob.js';
import { refreshAllUnbilledInterest } from './controllers/billingScheduleController.js';
import { runDeliveryDocsSend } from './controllers/deliveryDocsController.js';
import { syncCalendarInbox } from './utils/calendarInboxSync.js';
import { syncInspectionValidity } from './utils/cybertsInspection.js';
import { isGoogleCalendarConfigured } from './utils/googleCalendar.js';

// Connect to MongoDB database
connectDB().then(async () => {
  await runDatabaseMigration();

  // 시험 서버(시험용 DB로 띄운 것)는 정기 작업을 하나도 돌리지 않는다.
  // 캘린더·아웃룩 동기화와 청구서 자동 발송은 시험 DB여도 실제 외부(고객 메일·캘린더)에 닿는다.
  if (process.env.SCHEDULED_JOBS === 'off') {
    console.log('[Cron Scheduler] SCHEDULED_JOBS=off — 정기 작업을 모두 끕니다 (시험 서버).');
    return;
  }

  // 아웃룩 연락처 동기화는 켜지자마자 하지 않는다.
  //
  // 연락처가 1만 8천 건이라 훑는 동안 서버가 다른 요청을 늦게 처리한다.
  // 배포 직후가 사람들이 가장 많이 들어오는 때라, 2분 뒤로 미뤄 첫 화면부터 열리게 한다.
  setTimeout(() => {
    console.log('[Outlook Sync] 기동 2분 뒤 첫 동기화를 시작합니다.');
    syncOutlookContacts();
  }, 2 * 60 * 1000);

  // 정기 작업 시각은 모두 한국 시간이다.
  // 운영 서버(Fly.io)는 UTC로 돌아서, 시간대를 적지 않으면 '10 3 * * *'가 한국 시간 12:10에 돈다.
  const CRON_OPTIONS = { timezone: 'Asia/Seoul' };

  // Schedule Outlook contact sync every 6 hours (0 */6 * * *)
  cron.schedule('0 */6 * * *', () => {
    console.log('[Cron Scheduler] Triggering 6-hour Outlook contact sync...');
    syncOutlookContacts();
  }, CRON_OPTIONS);
  console.log('[Cron Scheduler] 6-hour Outlook sync job scheduled successfully.');

  // 청구서 발송 일정(출금일 10일 전)을 캘린더에 맞춰 둔다.
  // 매일 새벽에 한 번이면 충분하다. 회차는 하루 사이에 바뀌지 않는다.
  syncInvoiceSendSchedules().catch((err) => console.error('[청구서 발송 일정] 실패:', err.message));
  cron.schedule('10 3 * * *', () => {
    syncInvoiceSendSchedules().catch((err) => console.error('[청구서 발송 일정] 실패:', err.message));
  }, CRON_OPTIONS);
  console.log('[Cron Scheduler] 청구서 발송 일정 동기화 예약 완료 (매일 03:10).');

  // 고지서 납부기한을 캘린더에 맞춰 둔다. 기한은 고지서마다 다르고 지나면 렌트료에 얹어 청구하므로
  // 매일 한 번 훑어 새로 올라온 건을 올리고 고객이 낸 건은 닫는다.
  syncFineNoticeSchedules().catch((err) => console.error('[고지서 납부기한] 실패:', err.message));
  cron.schedule('20 3 * * *', () => {
    syncFineNoticeSchedules().catch((err) => console.error('[고지서 납부기한] 실패:', err.message));
  }, CRON_OPTIONS);
  console.log('[Cron Scheduler] 고지서 납부기한 동기화 예약 완료 (매일 03:20).');

  // 사이버검사소에서 차마다 검사 유효기간을 받아 온다. 검사를 받으면 사이트 만료일이 다음 해로 바뀐다.
  // 정비·검사 일정(03:30)이 새 만료일로 계산되도록 그보다 먼저 돈다.
  cron.schedule('0 3 * * *', () => {
    syncInspectionValidity()
      .then((r) => console.log(`[검사 유효기간] ${r.checked}대 중 ${r.found}대 조회 · 바뀜 ${r.changed} · 없음 ${r.notFound.length}`))
      .catch((err) => console.error('[검사 유효기간] 실패:', err.message));
  }, CRON_OPTIONS);
  console.log('[Cron Scheduler] 사이버검사소 검사 유효기간 조회 예약 완료 (매일 03:00).');

  // 차마다 다음 자동차검사·정기점검을 캘린더에 하나씩 맞춰 둔다(직원용 알림, 고객 메일 없음).
  // 날짜가 지나면 상태가 바뀌고 기록이 들어오면 다음 회차로 넘어가므로 매일 한 번 훑는다.
  syncVehicleServiceSchedules().catch((err) => console.error('[정비·검사 일정] 실패:', err.message));
  cron.schedule('30 3 * * *', () => {
    syncVehicleServiceSchedules().catch((err) => console.error('[정비·검사 일정] 실패:', err.message));
  }, CRON_OPTIONS);
  console.log('[Cron Scheduler] 정비·검사 일정 동기화 예약 완료 (매일 03:30).');

  // 받지 않은 연체 이자 내역을 원장 입금일 기준으로 다시 센다. 미납이 이어지면 청구서마다 한 달치가 늘어난다.
  // 청구서에 누적으로 남기는 값이라 날마다 한 번 맞춘다(원장 엑셀 마감 21:00 뒤 새벽).
  cron.schedule('40 3 * * *', () => {
    refreshAllUnbilledInterest()
      .then((r) => console.log(`[연체 이자 내역] 회차표 ${r.schedules}개 중 ${r.changed}개 갱신`))
      .catch((err) => console.error('[연체 이자 내역] 실패:', err.message));
  }, CRON_OPTIONS);
  console.log('[Cron Scheduler] 연체 이자 내역 갱신 예약 완료 (매일 03:40).');

  // 청구서는 자동으로 보내지 않는다(2026-10-30 대표님). 승인한 청구서는 발송일에 담당자가
  // 청구서 발송 센터에서 날짜별 [보내기]를 눌러야 나간다.
  // 담당자 알림 메일(9시 '오늘 보낼 청구서', 16시 '내일 발송 승인 대기')도 보내지 않는다. 다른 메일과 섞여
  // 관리가 어렵다고 하셔서(2026-10-30 대표님) 할 일은 프로그램 화면(청구서 발송 센터)에서만 본다.

  // 인도 서류(계약사실 증명원·상환스케쥴) 발송. 인도일 다음 날 아침 9시, 담당자가 승인한 건만 보낸다.
  cron.schedule('5 9 * * *', () => {
    runDeliveryDocsSend().catch((err) => console.error('[인도 서류 발송] 실패:', err.message));
  }, CRON_OPTIONS);
  // 승인 안 한 인도 서류 알림 메일은 보내지 않는다(2026-10-30 대표님). 인도 서류 화면에서 본다.
  console.log('[Cron Scheduler] 인도 서류 발송 예약 완료 (매일 09:05). 담당자 알림 메일은 보내지 않음.');

  // 구글 업무캘린더 → 정비 기록 '확인 대기'. 직원이 핸드폰 캘린더에 적은 정비 일정을 10분마다 읽어 온다.
  // 열쇠(GOOGLE_SERVICE_ACCOUNT_KEY)가 없는 서버에서는 아무것도 하지 않는다.
  if (isGoogleCalendarConfigured()) {
    const readCalendar = () => syncCalendarInbox()
      .then((r) => { if (r.waiting || r.noPlate || r.flagged) console.log(`[캘린더 읽기] 일정 ${r.read}건 · 새 대기 ${r.waiting} · 번호없음 ${r.noPlate} · 옮긴 뒤 바뀜 ${r.flagged}`); })
      .catch((err) => console.error('[캘린더 읽기] 실패:', err.message));
    cron.schedule('*/10 7-22 * * *', readCalendar, CRON_OPTIONS);
    console.log('[Cron Scheduler] 구글 캘린더 정비 일정 읽기 예약 완료 (07:00~22:59 10분마다).');
  }

  // 자금팀 엑셀(OneDrive) → 차량 손익 원장·회사 장부. 직원은 엑셀만 고치고 프로그램이 받아 온다.
  // 직원 근무 시간(09:00~20:00)에 10분마다 보고, 마지막 저장 후 10분 동안 손대지 않은 파일만 반영한다
  // (고치는 중인 숫자가 들어오지 않게). 퇴근 뒤 21:00에 그날 고친 것을 한 번 더 전체 맞춘다.
  // 밤에는 엑셀이 바뀌지 않으므로 보지 않는다(2026-10-19 대표님). 운영 서버에서만 돈다(utils/excelAutoSync.js).
  // 관리자가 원장 화면에서 엑셀 연동을 끄면(프로그램에서 직접 관리하기로 바꾸면) 정기 실행은 아무것도 하지 않는다.
  if (isExcelAutoSyncEnabled()) {
    const syncExcel = (trigger) => runExcelAutoSync({ trigger })
      .then((r) => { if (r.ledger || r.companyBook || r.errors?.length) console.log(`[엑셀 자동 갱신] ${r.message}`); })
      .catch((err) => console.error('[엑셀 자동 갱신] 실패:', err.message));
    cron.schedule('*/10 9-20 * * *', () => syncExcel('interval'), CRON_OPTIONS);
    cron.schedule('0 21 * * *', () => syncExcel('daily'), CRON_OPTIONS);
    console.log('[Cron Scheduler] 엑셀 자동 갱신 예약 완료 (09:00~20:59 10분마다 확인 · 21:00 하루 마감 전체).');
  } else {
    console.log('[Cron Scheduler] 엑셀 자동 갱신은 이 서버에서 끕니다 (운영 서버에서만 돈다. 켜려면 EXCEL_AUTO_SYNC=on).');
  }
});

const app = express();

// Middleware
// 화면(Vercel) 주소. CLIENT_URL은 쉼표로 여러 개를 적을 수 있고, 끝의 '/'는 떼고 비교한다
// (브라우저가 보내는 Origin에는 '/'가 없어서, 'https://….vercel.app/'로 적으면 로그인이 "서버에 연결할 수 없습니다"로 막힌다).
// Vercel 운영 주소와 미리보기 주소(rentbenefit-program-….vercel.app)는 설정과 상관없이 허용한다.
const VERCEL_ORIGIN = /^https:\/\/rentbenefit-program(-[a-z0-9-]+)?\.vercel\.app$/;
const allowedOrigins = [
  ...String(process.env.CLIENT_URL || '').split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean),
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin || 
      allowedOrigins.includes(origin) ||
      VERCEL_ORIGIN.test(origin) ||
      origin.startsWith('http://localhost:') || 
      origin.startsWith('http://127.0.0.1:') ||
      /^http:\/\/(192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)
    ) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy does not allow this origin'));
    }
  },
  credentials: true
}));
app.use(express.json());

// 응답을 gzip으로 줄여서 보낸다.
//
// 이게 없으면 화면 코드(2.3MB)와 목록 응답이 통째로 오간다. 사무실 밖이나 휴대폰에서
// 특히 느렸던 이유다. 압축하면 보통 3~5배 줄고, 서버가 쓰는 시간은 그보다 훨씬 적다.
app.use(compression());

// In production the client is built into client/dist and served by this same server,
// so the browser calls /api/* on its own origin (no CORS, no mixed content).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, '../client/dist');

// 화면 파일이 함께 올라온 경우에만 서버가 화면까지 내준다.
//
// 화면은 Vercel이 맡고 있어서 서버에는 화면 파일이 없을 수 있다. 그때도 화면을 내주려 하면
// 없는 파일을 찾다가 오류가 난다. 파일이 실제로 있을 때만 켠다.
const serveClient = process.env.NODE_ENV === 'production' && fs.existsSync(clientDistPath);

if (serveClient) {
  app.use(express.static(clientDistPath));
}

// Routes
app.get('/', (req, res) => {
  res.send('Rent Benefit API is running...');
});

// 로그인한 사람만 데이터에 접근할 수 있다.
//
// 예전에는 주소만 알면 로그인 없이 고객 1만 8천 명의 이름·전화번호·사업자번호가 그대로 나왔다.
// 회원가입·로그인은 열려 있어야 하므로 users만 라우트 안에서 개별로 검사한다.
app.use('/api/users', userRoutes);
app.use('/api/vehicles', protect, vehicleRoutes);
app.use('/api/customers', protect, customerRoutes);
app.use('/api/quotes', protect, quoteRoutes);
app.use('/api/contracts', protect, contractRoutes);
app.use('/api/schedules', protect, scheduleRoutes);
app.use('/api/invoices', protect, invoiceRoutes);
app.use('/api/billing-schedules', protect, billingScheduleRoutes);
app.use('/api/mail-templates', protect, mailTemplateRoutes);
app.use('/api/ocr', protect, ocrRoutes);
app.use('/api/rental-notices', protect, rentalNoticeRoutes);
app.use('/api/ledgers', protect, ledgerRoutes);
app.use('/api/company-folders', protect, companyFolderRoutes);
app.use('/api/companies', protect, companyRoutes);
app.use('/api/dashboard', protect, dashboardRoutes);
app.use('/api/inquiries', protect, inquiryRoutes);
app.use('/api/settings', protect, settingRoutes);
app.use('/api/company-book', protect, companyBookRoutes);
app.use('/api/short-term-rates', protect, shortTermRateRoutes);
app.use('/api/vehicle-services', protect, vehicleServiceRoutes);
app.use('/api/excel-sync', protect, excelSyncRoutes);
app.use('/api/contract-templates', protect, contractTemplateRoutes);
app.use('/api/contract-documents', protect, contractDocumentRoutes);
app.use('/api/delivery-docs', protect, deliveryDocsRoutes);

// Client-side routing: any non-/api request falls through to the SPA entry point
if (serveClient) {
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Error handling middleware
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
});

app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);
  res.json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});
