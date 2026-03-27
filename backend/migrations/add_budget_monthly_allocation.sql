ALTER TABLE budgets
ADD COLUMN IF NOT EXISTS monthly_allocation JSONB NOT NULL DEFAULT '{}'::jsonb;
