-- Fix 3: Correct any negative consumed_amount (invalid state from string coercion bug)
UPDATE budgets SET consumed_amount = 0 WHERE consumed_amount < 0;
