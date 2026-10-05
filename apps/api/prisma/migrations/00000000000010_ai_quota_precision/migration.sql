-- Widen monthly_cap_usd precision to Decimal(14,6).
-- Fixes semantic drift: tiny caps rounding to 0.00 flipped quota off.

-- AlterTable
ALTER TABLE "ai_tenant_quotas" ALTER COLUMN "monthlyCapUsd" SET DATA TYPE DECIMAL(14,6);


