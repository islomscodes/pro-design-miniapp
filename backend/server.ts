import express, { Express, Request, Response, NextFunction } from 'express';
import { Pool, QueryResult } from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import { telegramAuthMiddleware, generateVerificationCode, createRateLimiter } from './auth';
import routes from './routes';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3001;
const botToken = process.env.TELEGRAM_BOT_TOKEN || '';

// Database pool configuration
export const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pro_design',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Extended Request type for authenticated requests
interface AuthenticatedRequest extends Request {
  telegramUser?: any;
  telegramInitData?: any;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Apply Telegram authentication to all API routes except specific endpoints
const publicRoutes = ['/health', '/api/public'];
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (publicRoutes.some((route) => req.path.startsWith(route))) {
    return next();
  }
  telegramAuthMiddleware(botToken)(req as AuthenticatedRequest, res, next);
});

// Register routes
app.use('/api', routes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);

  if (err.message.includes('pool')) {
    return res.status(503).json({ error: 'Database connection error' });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Database connection test
pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
});

pool
  .query('SELECT NOW()')
  .then(() => console.log('Database connected successfully'))
  .catch((err) => console.error('Database connection failed:', err));

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await pool.end();
  process.exit(0);
});

// Start server
app.listen(port, () => {
  console.log(`Pro Design Server running on port ${port}`);
});

export default app;
