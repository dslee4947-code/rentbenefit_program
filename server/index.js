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
import invoiceRoutes from './routes/invoiceRoutes.js';
import billingScheduleRoutes from './routes/billingScheduleRoutes.js';
import ledgerRoutes from './routes/ledgerRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import companyFolderRoutes from './routes/companyFolderRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import inquiryRoutes from './routes/inquiryRoutes.js';

// Load environment variables
dotenv.config();

import cron from 'node-cron';
import { protect } from './middleware/authMiddleware.js';
import { runDatabaseMigration } from './utils/dbMigration.js';
import { syncOutlookContacts } from './utils/outlookSyncService.js';
import { syncInvoiceSendSchedules } from './utils/invoiceScheduleJob.js';
import { syncFineNoticeSchedules } from './utils/fineNoticeScheduleJob.js';

// Connect to MongoDB database
connectDB().then(async () => {
  await runDatabaseMigration();

  // 아웃룩 연락처 동기화는 켜지자마자 하지 않는다.
  //
  // 연락처가 1만 8천 건이라 훑는 동안 서버가 다른 요청을 늦게 처리한다.
  // 배포 직후가 사람들이 가장 많이 들어오는 때라, 2분 뒤로 미뤄 첫 화면부터 열리게 한다.
  setTimeout(() => {
    console.log('[Outlook Sync] 기동 2분 뒤 첫 동기화를 시작합니다.');
    syncOutlookContacts();
  }, 2 * 60 * 1000);

  // Schedule Outlook contact sync every 6 hours (0 */6 * * *)
  cron.schedule('0 */6 * * *', () => {
    console.log('[Cron Scheduler] Triggering 6-hour Outlook contact sync...');
    syncOutlookContacts();
  });
  console.log('[Cron Scheduler] 6-hour Outlook sync job scheduled successfully.');

  // 청구서 발송 일정(출금일 10일 전)을 캘린더에 맞춰 둔다.
  // 매일 새벽에 한 번이면 충분하다. 회차는 하루 사이에 바뀌지 않는다.
  syncInvoiceSendSchedules().catch((err) => console.error('[청구서 발송 일정] 실패:', err.message));
  cron.schedule('10 3 * * *', () => {
    syncInvoiceSendSchedules().catch((err) => console.error('[청구서 발송 일정] 실패:', err.message));
  });
  console.log('[Cron Scheduler] 청구서 발송 일정 동기화 예약 완료 (매일 03:10).');

  // 고지서 납부기한을 캘린더에 맞춰 둔다. 기한은 고지서마다 다르고 지나면 렌트료에 얹어 청구하므로
  // 매일 한 번 훑어 새로 올라온 건을 올리고 고객이 낸 건은 닫는다.
  syncFineNoticeSchedules().catch((err) => console.error('[고지서 납부기한] 실패:', err.message));
  cron.schedule('20 3 * * *', () => {
    syncFineNoticeSchedules().catch((err) => console.error('[고지서 납부기한] 실패:', err.message));
  });
  console.log('[Cron Scheduler] 고지서 납부기한 동기화 예약 완료 (매일 03:20).');
});

const app = express();

// Middleware
const allowedOrigins = [
  process.env.CLIENT_URL,
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
app.use('/api/ledgers', protect, ledgerRoutes);
app.use('/api/documents', protect, documentRoutes);
app.use('/api/company-folders', protect, companyFolderRoutes);
app.use('/api/companies', protect, companyRoutes);
app.use('/api/dashboard', protect, dashboardRoutes);
app.use('/api/inquiries', protect, inquiryRoutes);

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
