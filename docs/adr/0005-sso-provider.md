# ADR 0005: SSO provider — WorkOS for B2B federation; Entra ID / Okta as per-tenant IdPs

**Status**: Accepted (2026-10-05, defaults policy)
**Date**: 2026-10-05
**Owner**: Security
**Deciders**: Security, Tech lead, Compliance
**Supersedes**: —
**Superseded by**: —

## Context

Three distinct identity populations use the platform:

1. **Platform operators** (GenBioCa internal — Super Admin + Admin personas). Small, long-lived, our control plane.
2. **Customer tenant users** (per-pharma Admins, writers, reviewers). Each customer has their own corporate IdP — Pfizer uses Okta, Novartis uses Entra ID, mid-caps use Google Workspace, etc. **We do not get to pick their IdP**; we have to federate with whichever one they have.
3. **KOL guest users** (external advisors reviewing content via tokenised URL — Module E `/kol-review/:token`). No SSO; a short-lived JWT in the URL.

The hard requirement is **per-customer-tenant IdP federation** via SAML 2.0 or OIDC. We cannot ship a product that forces every pharma to use the same IdP as us. Options reduce to:

- **Build our own federation layer** on top of Passport.js / Panva's `openid-client`
- **Buy per-tenant federation** from an identity-SaaS vendor
- **Pick one IdP** (Entra ID, Okta, Auth0) and tell customers to federate out from their IdP into ours (works, but adds a hop and vendor relationship pharma buyers resist)

## Decision

**WorkOS** as the SSO federation layer. Customer-tenant users federate from their own corporate IdP (Entra ID / Okta / Google / Ping / anything SAML/OIDC) through WorkOS into our Fastify API.

**Platform operators** (GenBioCa internal) authenticate via the same WorkOS connection using a GenBioCa Entra ID tenant we provision — same federation path, no special case.

**KOL guest users** stay on the tokenised-URL JWT path (`/kol-review/:token`), independent of WorkOS. The guest path is isolated at the API layer with its own rate limits and WAF rules (per Phase 3E design).

## Options considered

### Option A — WorkOS *(chosen)*
- **Pros**
  - **Per-tenant SAML + OIDC federation is their core product.** We get an Admin Portal URL that we hand to a new customer's IT team; they configure their IdP against it in ~30 minutes without our involvement.
  - **Directory sync (SCIM)** included — users provisioned/deprovisioned in the customer's IdP flow through automatically. Critical for Part 11 (deprovisioned user cannot sign).
  - **One SDK** regardless of which IdP the customer uses on the other side.
  - **Flat pricing per connection** (~$125/connection/month at time of writing), not per-seat — scales economically with large customers.
  - **SOC 2 Type II + HIPAA BAA** available.
  - Native support for enterprise niceties: Just-In-Time user creation, group-to-role mapping, audit log export.
- **Cons**
  - Vendor dependency — if WorkOS has an outage, our SSO is down for all tenants. Mitigate with session TTLs long enough that short outages don't force re-auth.
  - Pricing model shifts to per-connection — may become expensive at 100+ customers; revisit at that scale.
- **Rough effort / cost**: ~1 engineer-week to integrate; ~$125 × active connections/month.

### Option B — Build on `openid-client` + Passport.js
- **Pros**: Full control; no vendor; cheap.
- **Cons**
  - **Per-tenant IdP federation is a project**, not a feature. Each new customer requires us to onboard their SAML cert, metadata URL, attribute mapping, SCIM endpoint, group-to-role rules. Multiply by every customer we win.
  - SAML signing cert rotation, SP metadata hosting, assertion encryption, replay-attack mitigation, SP-initiated vs IdP-initiated flow — all our problem.
  - SCIM endpoint is a separate build.
  - 4–8 engineer-weeks initial + ongoing per-customer onboarding time.
- **Rough effort / cost**: 4–8 EW upfront; ongoing per-customer identity-eng time.

### Option C — Auth0 (now part of Okta)
- **Pros**: Mature; large community; owned by Okta so federation is well-trodden.
- **Cons**
  - Pricing model is per-MAU, which gets expensive at scale (pharma seats run $50+/seat/year just for Auth0).
  - Enterprise connections (SAML/OIDC federation) are a paid add-on; pricing escalates fast.
  - More general-purpose than WorkOS's B2B focus — we'd use ~20% of Auth0 and pay for 100%.
- **Rough effort / cost**: ~1 EW to integrate; $$$$/month at scale.

### Option D — Okta direct
- **Pros**: Gold-standard workforce IAM.
- **Cons**
  - Okta's "External Identities" story (B2B federation into your SaaS) is their Auth0 product, i.e. Option C.
  - Direct Okta positions us as using Okta as our own IdP, which doesn't solve the per-customer federation problem.
- **Rejected** as a direct provider; keep as a target IdP that customers federate from.

### Option E — Keycloak (self-hosted)
- **Pros**: Open source, no vendor cost, full control, SAML + OIDC + SCIM.
- **Cons**
  - Ops burden on us: HA deployment, upgrades, patching, security monitoring. Keycloak CVEs ship frequently.
  - Per-customer federation still means hand-configuring Keycloak realms for each tenant — most of the work from Option B remains.
  - No managed BAA — compliance posture is entirely ours.
- **Rejected** — same build-vs-buy argument as Option B.

## Rationale

Three decisive factors:

1. **Per-tenant federation is a product-shaped problem, not a feature.** Every customer brings their own IdP. The work is not writing one SAML flow; it's hosting a self-service IdP-configuration portal for IT teams at every customer. WorkOS is built around exactly this.
2. **SCIM user deprovisioning is a Part 11 requirement**, not optional. When a customer's IdP removes a user, that user's platform session must die within the SCIM polling window (minutes, not days). Hand-building SCIM endpoints is a trap.
3. **Shortens time-to-first-customer-onboarding** from engineering-weeks to ~30 minutes. For a 9-month-to-GA product, this is the right place to spend $125/connection.

The buy-vs-build line: we are not an identity company. We are a regulated-writing company that needs identity to work. WorkOS lets us treat identity federation as a solved problem.

## Consequences

### Positive
- New customer onboarding reduces to: "here is your Admin Portal link; your IT team configures their IdP; done."
- SCIM provisioning works for every customer by default.
- Audit log of every auth event available via WorkOS API — feeds the Part 11 audit trail from Phase 1.
- Per-tenant provider isolation: Pfizer's Okta failure cannot affect Novartis's Entra ID flow.

### Negative
- Vendor dependency on WorkOS. Mitigate with: session TTLs ≥ 1h (short outages don't force re-auth), WorkOS API responses cached where safe, documented runbook for "WorkOS is down" (users cannot start new sessions; active sessions continue).
- Monthly cost grows with customer count. Budget line item from day one.
- WorkOS tracks user auth events — a copy of our auth metadata lives at a third party. Must be reflected in the customer DPA.

### Neutral / downstream work
- Phase 0 Week 2: Legal engages WorkOS for BAA (standard enterprise agreement, ~2 weeks).
- Phase 1 Week 5: integrate WorkOS SDK into `apps/api/src/auth/`; replace the mock `SSO_PROVIDER=mock` in `.env.example` with `workos`.
- Phase 1 Week 5: implement SCIM webhook receiver → user table sync.
- Phase 1 Week 6: write "customer IT self-onboarding" runbook for sales to hand to customer IT teams.
- Admin Portal is handed to customers via a signed URL — the signing logic needs its own ADR extension if we want to rotate signing keys.

## Compliance implications

- **21 CFR Part 11 §11.10(d), §11.300**: User identification and management. SCIM deprovisioning satisfies the "revoke access upon termination" requirement. Document the SCIM poll frequency in the SOP.
- **HIPAA**: WorkOS BAA covers them handling user identity attributes which may include names and emails of workforce members. Confirmed in standard WorkOS enterprise agreement.
- **GDPR**: WorkOS hosts in US and EU regions. EU tenants must route through EU region per customer DPA.
- **GAMP 5**: Identity provider is a Configurable Item. WorkOS version pinning in the Configuration Management plan.

## References

- WorkOS docs: https://workos.com/docs
- WorkOS SOC 2 report: available on request under NDA
- WorkOS vs Auth0 B2B comparison: https://workos.com/blog/workos-vs-auth0
- OIDC spec: https://openid.net/specs/openid-connect-core-1_0.html
