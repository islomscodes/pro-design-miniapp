-- Pro Design Mini App - PostgreSQL Schema
-- Production-ready with cascade deletions and indexing

-- Users Table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255),
  first_name VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('customer', 'dealer')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_role ON users(role);

-- Dealers Info Table
CREATE TABLE dealers_info (
  id SERIAL PRIMARY KEY,
  user_id INT UNIQUE NOT NULL,
  region VARCHAR(255) NOT NULL,
  district VARCHAR(255) NOT NULL,
  balance NUMERIC(12, 2) DEFAULT 0.00,
  rating NUMERIC(3, 2) DEFAULT 5.00,
  total_orders INT DEFAULT 0,
  is_approved BOOLEAN DEFAULT false,
  is_blocked BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_dealers_info_region_district ON dealers_info(region, district);
CREATE INDEX idx_dealers_info_is_approved ON dealers_info(is_approved);
CREATE INDEX idx_dealers_info_is_blocked ON dealers_info(is_blocked);

-- Categories Table
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default categories
INSERT INTO categories (name, description) VALUES
  ('Combo', 'Combination blinds'),
  ('Gorizontal', 'Horizontal blinds'),
  ('Dikey', 'Vertical blinds'),
  ('Double', 'Double layer blinds'),
  ('Pardalik', 'Roman blinds'),
  ('Plise', 'Pleated blinds')
ON CONFLICT (name) DO NOTHING;

-- Collections Table
CREATE TABLE collections (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  price_per_square_meter NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX idx_collections_category_id ON collections(category_id);

-- Orders Table
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL,
  dealer_id INT,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  address TEXT,
  width NUMERIC(8, 2) NOT NULL,
  height NUMERIC(8, 2) NOT NULL,
  area NUMERIC(10, 2) GENERATED ALWAYS AS ((width / 100) * (height / 100)) STORED,
  collection_id INT,
  total_price NUMERIC(12, 2) NOT NULL,
  verification_code VARCHAR(4),
  status VARCHAR(50) NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Contacted', 'Completed', 'Cancelled')),
  customer_rating INT CHECK (customer_rating IS NULL OR (customer_rating >= 1 AND customer_rating <= 5)),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (dealer_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL
);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_dealer_id ON orders(dealer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);

-- Transactions Table
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  dealer_id INT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'charge')),
  description TEXT,
  order_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dealer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE INDEX idx_transactions_dealer_id ON transactions(dealer_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_type ON transactions(type);

-- Audit Log for Security
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT,
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(100),
  resource_id INT,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Admin Settings Table
CREATE TABLE admin_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(255) UNIQUE NOT NULL,
  setting_value JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dealer Application Table
CREATE TABLE dealer_applications (
  id SERIAL PRIMARY KEY,
  user_id INT UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  region VARCHAR(255) NOT NULL,
  districts TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by INT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_dealer_applications_status ON dealer_applications(status);
CREATE INDEX idx_dealer_applications_user_id ON dealer_applications(user_id);
