import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

interface TelegramInitData {
  query_id?: string;
  user?: string;
  auth_date?: string;
  hash?: string;
  [key: string]: any;
}

interface AuthenticatedRequest extends Request {
  telegramUser?: any;
  telegramInitData?: TelegramInitData;
}

/**
 * Verify Telegram WebApp initData signature
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-from-the-web-app
 */
export const verifyTelegramInitData = (
  initData: string,
  botToken: string
): { valid: boolean; data?: TelegramInitData } => {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');

    if (!hash) {
      return { valid: false };
    }

    // Remove hash from params for verification
    params.delete('hash');

    // Sort parameters by key
    const sortedParams = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Create HMAC-SHA256 hash
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(sortedParams).digest('hex');

    if (computedHash !== hash) {
      return { valid: false };
    }

    // Verify auth_date is not too old (within 1 hour)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 3600) {
      console.warn('Auth data expired');
      return { valid: false };
    }

    // Parse user data
    const data: TelegramInitData = {};
    params.forEach((value, key) => {
      if (key === 'user') {
        data.user = JSON.parse(value);
      } else {
        data[key] = value;
      }
    });

    return { valid: true, data };
  } catch (error) {
    console.error('Telegram verification error:', error);
    return { valid: false };
  }
};

/**
 * Express middleware to verify Telegram authentication
 */
export const telegramAuthMiddleware = (botToken: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const initData = req.headers['x-telegram-init-data'] as string;

      if (!initData) {
        return res.status(401).json({ error: 'Missing Telegram init data' });
      }

      const { valid, data } = verifyTelegramInitData(initData, botToken);

      if (!valid || !data?.user) {
        return res.status(401).json({ error: 'Invalid Telegram signature' });
      }

      req.telegramUser = data.user;
      req.telegramInitData = data;
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  };
};

/**
 * Generate random verification code for order completion
 */
export const generateVerificationCode = (): string => {
  return Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
};

/**
 * Rate limiting helper
 */
export const createRateLimiter = (maxRequests: number = 10, windowMs: number = 60000) => {
  const requestMap = new Map<string, number[]>();

  return (identifier: string): boolean => {
    const now = Date.now();
    const requests = requestMap.get(identifier) || [];

    // Remove old requests outside the window
    const recentRequests = requests.filter((time) => now - time < windowMs);

    if (recentRequests.length >= maxRequests) {
      return false;
    }

    recentRequests.push(now);
    requestMap.set(identifier, recentRequests);
    return true;
  };
};
