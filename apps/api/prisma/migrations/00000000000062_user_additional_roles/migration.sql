-- A user may hold a second platform role alongside users.role (at most 2 in all; rights are the
-- union). Which pairs are allowed is enforced in the API (src/auth/role-combos.ts). Additive and
-- defaulted, so code that doesn't know the column is unaffected.
ALTER TABLE "users" ADD COLUMN "additional_roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
