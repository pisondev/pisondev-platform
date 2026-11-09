-- +goose Up
-- Bank amounts can carry sen (Rp416.551,65), so money columns keep two decimals.
ALTER TABLE finance.transactions
    ALTER COLUMN amount TYPE numeric(16,2),
    ALTER COLUMN reported_amount TYPE numeric(16,2);
ALTER TABLE finance.subscriptions ALTER COLUMN price TYPE numeric(16,2);
ALTER TABLE finance.weeks
    ALTER COLUMN income TYPE numeric(16,2),
    ALTER COLUMN spent TYPE numeric(16,2);

-- +goose Down
ALTER TABLE finance.transactions
    ALTER COLUMN amount TYPE bigint USING round(amount),
    ALTER COLUMN reported_amount TYPE bigint USING round(reported_amount);
ALTER TABLE finance.subscriptions ALTER COLUMN price TYPE bigint USING round(price);
ALTER TABLE finance.weeks
    ALTER COLUMN income TYPE bigint USING round(income),
    ALTER COLUMN spent TYPE bigint USING round(spent);
