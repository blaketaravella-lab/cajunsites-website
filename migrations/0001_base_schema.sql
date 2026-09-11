CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_customer_id TEXT,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT,
  payment_link_id TEXT,
  customer_name TEXT,
  business_name TEXT,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Paid - Awaiting Onboarding',
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  welcome_email_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_stripe_customer ON customers(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_subscription ON customers(stripe_subscription_id);
