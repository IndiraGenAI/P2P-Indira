-- Advance PO: persisted advance amount + expected invoice type metadata
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(18,2);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_invoice_type VARCHAR(50);

COMMENT ON COLUMN purchase_orders.advance_amount IS 'PO amount * advance_percentage / 100 when is_advance_po';
COMMENT ON COLUMN purchase_orders.expected_invoice_type IS 'e.g. PREPAYMENT when advance PO with pct > 0';
