import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/authRoutes';
import studentRoutes from './routes/studentRoutes';
import adminRoutes from './routes/adminRoutes';
import telegramRoutes from './routes/telegramRoutes';

const app = express();

// Behind Nginx every request would otherwise share the proxy's IP, so the
// login rate limiter would lock out the whole library after 20 attempts.
if (config.isProduction) app.set('trust proxy', 1);

// ─── Security ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ─── Root & Health Check ──────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Library Study Tracker API is running smoothly',
    version: '1.0.0',
    status: 'healthy',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      student: '/api/me',
      admin: '/api/admin',
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    status: 'ok',
    env: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});


// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/me', studentRoutes);
app.use('/api/admin', adminRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ─── Central Error Handler ────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
