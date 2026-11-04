-- Free-text Tenant ID the invitee may enter on the accept-invitation page.
-- Optional and unvalidated; separate from users."tenantId" (the tenant link
-- that scopes data access), which is unchanged.
ALTER TABLE "users" ADD COLUMN "tenant_ref" TEXT;
