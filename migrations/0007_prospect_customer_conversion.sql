ALTER TABLE prospects ADD COLUMN customer_id INTEGER;
ALTER TABLE prospects ADD COLUMN converted_at TEXT;
ALTER TABLE prospects ADD COLUMN checkout_started_at TEXT;
ALTER TABLE customers ADD COLUMN source_prospect_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_customer_id
ON prospects(customer_id)
WHERE customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_source_prospect
ON customers(source_prospect_id)
WHERE source_prospect_id IS NOT NULL;
