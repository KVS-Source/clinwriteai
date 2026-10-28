-- comments.external_email — populated when a guest (via the magic-link
-- redemption endpoint) leaves a comment. Nullable; internal reviewers
-- continue to leave it unset. Enables the UI to distinguish guest
-- comments from internal ones without a join on guest_invitations.
--
-- Also enables the DPDPA erasure path described in
-- docs/roles-and-permissions.md §6.4: on a data-principal deletion
-- request, we null this column (and the matching row in guest_invitations)
-- but preserve the comment body — the audit chain still interprets.

ALTER TABLE "comments" ADD COLUMN "external_email" TEXT;
CREATE INDEX "comments_external_email_idx" ON "comments" ("external_email");
