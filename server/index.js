import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import userRoutes from './routes/userRoutes.js';
import vehicleRoutes from './routes/vehicleRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import quoteRoutes from './routes/quoteRoutes.js';
import contractRoutes from './routes/contractRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import companyFolderRoutes from './routes/companyFolderRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import inquiryRoutes from './routes/inquiryRoutes.js';

// Load environment variables
dotenv.config();

import cron from 'node-cron';
import { runDatabaseMigration } from './utils/dbMigration.js';
import { syncOutlookContacts } from './utils/outlookSyncService.js';

// Connect to MongoDB database
connectDB().then(async () => {
  await runDatabaseMigration();

  // Initial Outlook contact sync on startup
  syncOutlookContacts();

  // Schedule Outlook contact sync every 6 hours (0 */6 * * *)
  cron.schedule('0 */6 * * *', () => {
    console.log('[Cron Scheduler] Triggering 6-hour Outlook contact sync...');
    syncOutlookContacts();
  });
  console.log('[Cron Scheduler] 6-hour Outlook sync job scheduled successfully.');
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

// In production the client is built into client/dist and served by this same server,
// so the browser calls /api/* on its own origin (no CORS, no mixed content).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, '../client/dist');
const serveClient = process.env.NODE_ENV === 'production';

if (serveClient) {
  app.use(express.static(clientDistPath));
}

// Routes
app.get('/', (req, res) => {
  res.send('Rent Benefit API is running...');
});

app.use('/api/users', userRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/company-folders', companyFolderRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/inquiries', inquiryRoutes);

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
