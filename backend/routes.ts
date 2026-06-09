import { Router, Request, Response, NextFunction } from 'express';
import { pool } from './server';
import { generateVerificationCode, createRateLimiter } from './auth';
import { QueryResult } from 'pg';

const router = Router();

// Extended Request type
interface AuthenticatedRequest extends Request {
  telegramUser?: any;
  telegramInitData?: any;
}

// Rate limiters
const orderRateLimiter = createRateLimiter(5, 60000); // 5 orders per minute
const walletRateLimiter = createRateLimiter(10, 60000); // 10 wallet operations per minute

// ============================================================================
// USER ROUTES
// ============================================================================

/**
 * GET /api/user - Get current user profile
 */
router.get('/user', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const telegramId = req.telegramUser.id;

    let result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);

    if (result.rows.length === 0) {
      // Create new user
      const firstName = req.telegramUser.first_name || '';
      const username = req.telegramUser.username || null;

      result = await pool.query(
        'INSERT INTO users (telegram_id, username, first_name, role) VALUES ($1, $2, $3, $4) RETURNING *',
        [telegramId, username, firstName, 'customer']
      );
    }

    const user = result.rows[0];

    // Get dealer info if user is a dealer
    if (user.role === 'dealer') {
      const dealerResult = await pool.query('SELECT * FROM dealers_info WHERE user_id = $1', [user.id]);
      if (dealerResult.rows.length > 0) {
        user.dealer_info = dealerResult.rows[0];
      }
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/user/switch-role - Switch user role to dealer
 */
router.post('/user/switch-role', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { name, phone, region, districts } = req.body;

    if (!name || !phone || !region || !districts) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const telegramId = req.telegramUser.id;

    // Get user
    let userResult = await pool.query('SELECT id, role FROM users WHERE telegram_id = $1', [telegramId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Create dealer application
    await pool.query(
      `INSERT INTO dealer_applications (user_id, name, phone, region, districts) 
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, name, phone, region, Array.isArray(districts) ? districts.join(',') : districts]
    );

    // Update user role to dealer (pending approval)
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['dealer', userId]);

    res.json({ message: 'Dealer application submitted. Awaiting admin approval.' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// CATEGORY & COLLECTION ROUTES
// ============================================================================

/**
 * GET /api/categories - Get all categories with collections
 */
router.get('/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.description,
              json_agg(json_build_object('id', col.id, 'name', col.name, 'price_per_square_meter', col.price_per_square_meter)) as collections
       FROM categories c
       LEFT JOIN collections col ON c.id = col.category_id
       GROUP BY c.id, c.name, c.description
       ORDER BY c.id`
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/collections/:categoryId - Get collections for a specific category
 */
router.get('/collections/:categoryId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { categoryId } = req.params;

    const result = await pool.query('SELECT * FROM collections WHERE category_id = $1 ORDER BY id', [categoryId]);

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ORDER ROUTES
// ============================================================================

/**
 * POST /api/orders - Create a new order
 */
router.post('/orders', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { full_name, phone, region, district, width, height, collection_id, address } = req.body;

    // Validation
    if (!full_name || !phone || !region || !district || !width || !height || !collection_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Rate limiting
    if (!orderRateLimiter(req.telegramUser.id.toString())) {
      return res.status(429).json({ error: 'Too many orders. Please wait before creating another.' });
    }

    // Get customer user
    let userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [
      req.telegramUser.id,
    ]);

    let customerId = userResult.rows[0]?.id;

    if (!customerId) {
      userResult = await pool.query(
        'INSERT INTO users (telegram_id, first_name, role) VALUES ($1, $2, $3) RETURNING id',
        [req.telegramUser.id, req.telegramUser.first_name, 'customer']
      );
      customerId = userResult.rows[0].id;
    }

    // Get collection to calculate price
    const collectionResult = await pool.query('SELECT price_per_square_meter FROM collections WHERE id = $1', [
      collection_id,
    ]);

    if (collectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const pricePerSqm = parseFloat(collectionResult.rows[0].price_per_square_meter);
    const area = (width / 100) * (height / 100);
    const totalPrice = area * pricePerSqm;
    const verificationCode = generateVerificationCode();

    // Create order
    const orderResult = await pool.query(
      `INSERT INTO orders 
       (customer_id, full_name, phone, address, width, height, collection_id, total_price, verification_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [customerId, full_name, phone, address || `${region}, ${district}`, width, height, collection_id, totalPrice, verificationCode, 'New']
    );

    const order = orderResult.rows[0];

    // TODO: Send Telegram notification to dealers in this district
    // notifyDealers(region, district, order);

    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/:orderId - Get order details (customer only)
 */
router.get('/orders/:orderId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const result = await pool.query(
      `SELECT o.*, c.name as collection_name, cat.name as category_name
       FROM orders o
       LEFT JOIN collections c ON o.collection_id = c.id
       LEFT JOIN categories cat ON c.category_id = cat.id
       WHERE o.id = $1`,
      [orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = result.rows[0];

    // Verify authorization (customer or assigned dealer)
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [
      req.telegramUser.id,
    ]);

    const userId = userResult.rows[0]?.id;

    if (order.customer_id !== userId && order.dealer_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Hide sensitive data based on role
    if (order.customer_id !== userId) {
      delete order.phone; // Don't show customer phone to dealers
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders - Get user's orders
 */
router.get('/orders', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [
      req.telegramUser.id,
    ]);

    if (userResult.rows.length === 0) {
      return res.json([]);
    }

    const userId = userResult.rows[0].id;

    const result = await pool.query(
      `SELECT o.*, c.name as collection_name
       FROM orders o
       LEFT JOIN collections c ON o.collection_id = c.id
       WHERE o.customer_id = $1 OR o.dealer_id = $1
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders/:orderId/unlock - Dealer unlocks customer contact
 */
router.post('/orders/:orderId/unlock', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const unlockCost = 25000; // Fixed cost

    // Rate limiting
    if (!walletRateLimiter(req.telegramUser.id.toString())) {
      return res.status(429).json({ error: 'Too many unlock attempts. Please wait.' });
    }

    // Get order
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    if (order.dealer_id) {
      return res.status(400).json({ error: 'Order already claimed by another dealer' });
    }

    // Get dealer user
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [
      req.telegramUser.id,
    ]);

    const userId = userResult.rows[0]?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check dealer info and balance
    const dealerResult = await pool.query(
      'SELECT * FROM dealers_info WHERE user_id = $1 AND is_approved = true AND is_blocked = false',
      [userId]
    );

    if (dealerResult.rows.length === 0) {
      return res.status(403).json({ error: 'Dealer not approved or is blocked' });
    }

    const dealer = dealerResult.rows[0];

    if (dealer.balance < unlockCost) {
      return res.status(402).json({ error: 'Insufficient balance', required: unlockCost, current: dealer.balance });
    }

    // Start transaction
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Deduct balance
      await client.query('UPDATE dealers_info SET balance = balance - $1 WHERE id = $2', [
        unlockCost,
        dealer.id,
      ]);

      // Record transaction
      await client.query(
        'INSERT INTO transactions (dealer_id, amount, type, description, order_id) VALUES ($1, $2, $3, $4, $5)',
        [userId, unlockCost, 'charge', 'Order contact unlock', orderId]
      );

      // Assign dealer to order
      await client.query('UPDATE orders SET dealer_id = $1, status = $2 WHERE id = $3', [
        userId,
        'Contacted',
        orderId,
      ]);

      await client.query('COMMIT');

      res.json({
        message: 'Contact unlocked successfully',
        phone: order.phone,
        address: order.address,
        balance_remaining: dealer.balance - unlockCost,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders/:orderId/complete - Mark order as completed with verification code
 */
router.post('/orders/:orderId/complete', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const { verification_code } = req.body;

    if (!verification_code) {
      return res.status(400).json({ error: 'Verification code required' });
    }

    // Get order
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    // Verify code
    if (order.verification_code !== verification_code) {
      return res.status(403).json({ error: 'Invalid verification code' });
    }

    // Get user ID
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [
      req.telegramUser.id,
    ]);

    const userId = userResult.rows[0]?.id;

    // Verify authorization (dealer on order)
    if (order.dealer_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update order status
    await pool.query('UPDATE orders SET status = $1, completed_at = NOW() WHERE id = $2', ['Completed', orderId]);

    // Increment dealer's total_orders
    await pool.query('UPDATE dealers_info SET total_orders = total_orders + 1 WHERE user_id = $1', [userId]);

    res.json({ message: 'Order completed successfully. Awaiting customer feedback.' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DEALER WALLET ROUTES
// ============================================================================

/**
 * GET /api/dealer/wallet - Get dealer wallet info
 */
router.get('/dealer/wallet', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [
      req.telegramUser.id,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    const dealerResult = await pool.query(
      'SELECT id, balance, total_orders, rating FROM dealers_info WHERE user_id = $1',
      [userId]
    );

    if (dealerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dealer info not found' });
    }

    const dealer = dealerResult.rows[0];

    // Get recent transactions
    const transResult = await pool.query(
      'SELECT * FROM transactions WHERE dealer_id = $1 ORDER BY created_at DESC LIMIT 20',
      [userId]
    );

    res.json({
      ...dealer,
      transactions: transResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/dealer/deposit - Simulate deposit (mock Payme/Click integration)
 */
router.post('/dealer/deposit', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!walletRateLimiter(req.telegramUser.id.toString())) {
      return res.status(429).json({ error: 'Too many operations. Please wait.' });
    }

    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [
      req.telegramUser.id,
    ]);

    const userId = userResult.rows[0]?.id;

    if (!userId) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update balance
    await pool.query('UPDATE dealers_info SET balance = balance + $1 WHERE user_id = $2', [amount, userId]);

    // Record transaction
    await pool.query(
      'INSERT INTO transactions (dealer_id, amount, type, description) VALUES ($1, $2, $3, $4)',
      [userId, amount, 'deposit', 'Manual deposit']
    );

    res.json({ message: 'Deposit successful', amount });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ADMIN ROUTES (Protected)
// ============================================================================

/**
 * POST /api/admin/collections/update-price - Update collection price
 */
router.post('/admin/collections/update-price', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // TODO: Add admin verification
    const { collection_id, price_per_square_meter } = req.body;

    if (!collection_id || !price_per_square_meter) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await pool.query('UPDATE collections SET price_per_square_meter = $1, updated_at = NOW() WHERE id = $2', [
      price_per_square_meter,
      collection_id,
    ]);

    res.json({ message: 'Price updated successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/metrics - Get platform metrics
 */
router.get('/admin/metrics', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // TODO: Add admin verification

    const metrics = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM dealers_info WHERE is_approved = true'),
      pool.query('SELECT SUM(amount) as total FROM transactions WHERE type = $1', ['charge']),
      pool.query('SELECT COUNT(*) as count FROM orders'),
      pool.query('SELECT COUNT(*) as count FROM orders WHERE status = $1', ['New']),
    ]);

    res.json({
      active_dealers: parseInt(metrics[0].rows[0].count),
      gross_revenue: parseFloat(metrics[1].rows[0].total || 0),
      total_orders: parseInt(metrics[2].rows[0].count),
      new_orders: parseInt(metrics[3].rows[0].count),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
