# ClinWrite Standalone Deployment — PRD

**Status:** Draft, 2026-10-28
**Keep it simple.** This document deliberately avoids optional complexity. Anything "nice to have" is listed at the end under *Not in v1*.

---

## 1. What we're building

A second way to deliver ClinWrite:

- **Today:** multi-tenant SaaS at `demo.clinwrite.ai`, hosted by GenBioCa.
- **New:** customer runs the whole thing on their own infrastructure. GenBioCa never touches their data after handoff.

To gate what each customer can use (which modules, how many users, when it expires), GenBioCa runs a tiny internal tool called the **License Studio**. It generates a signed license file. The customer imports it; their deployment reads it at startup.

That's it.

---

## 2. Why

Pharma IT departments often forbid vendor-SaaS for regulated workflows. Customer-hosted + air-gapped lets them say yes.

---

## 3. The five modules

ClinWrite ships with these modules. Each is either on or off per customer license.

| Module | Short description |
|---|---|
| **Clinical Writing** | CSRs, protocols, DSURs, investigator brochures. The default. |
| **Scientific Writing** | Publications, manuscripts, abstracts. |
| **Medical Writing** | KOL content, claims matrix, medical affairs material. |
| **Regulatory Writing** | CTD modules, submissions, HA correspondence. |
| **Ideation & Publishing** | Content calendar, ideation cards, calendar publishing. |

The customer buys modules à la carte. Clinical Writing is almost always on; the others are upsells.

---

## 4. Decisions (short list)

| # | Decision | Why |
|---|---|---|
| D1 | Pure air-gap. No outbound from the customer deployment to GenBioCa. | Pharma asked for it. |
| D2 | License is a **signed JWT**. Customer can read it with the published public key. | Audit-friendly. Standard pattern. |
| D3 | **Internal-only** License Studio. CEO + IT head. No customer portal. | Smallest surface. |
| D4 | License sets: modules, user cap, expiry. Nothing else. | Simpler to generate, simpler to explain. |
| D5 | Expiry = **read-only for 30 days**, then full stop. | Protects the audit chain + avoids Friday-5pm renewals. |
| D6 | Customer brings their own LLM API key(s). Multiple providers supported via a simple config file. | We never hold customer AI keys. |
| D7 | Updates = signed Docker images on a public registry. | Simplest. |
| D8 | Studio login = **email magic link + TOTP** (Google Authenticator / Authy). No passwords, no SMS. | Phishing-resistant, SIM-swap-proof, zero infra cost. SMS OTP was ruled out — NIST SP 800-63B deprecates it, SIM-swap is a real risk in India. |
| D9 | **Admin page** inside the Studio manages the operator roster (add / remove / revoke sessions / reset TOTP). **Both CEO and IT Head can access it** so either can replace the other in a bus-factor event. Guardrails: no operator can remove themselves, and the system refuses to delete the last operator. | Formalises "who can sign licenses" inside the tool itself. Symmetric access = business continuity if either person leaves, is unavailable, or loses their 2FA device. |

Not using Shamir secret sharing, revocation-list cron, clock-rollback detection, or any phone-home. If a customer stops paying, their license expires and the grace period handles it. If a customer gets caught sharing their license, we address it commercially, not technically.

---

## 5. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  GenBioCa HQ                                               │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  License Studio (new app, same stack as ClinWrite)  │   │
│  │  • Postgres: tenants, licenses, operators,          │   │
│  │    operator_sessions                                │   │
│  │  • Signing key on a USB drive in the office safe    │   │
│  │  • Backup copy of the key in a sealed envelope      │   │
│  │  • Generates .lic file + README; emails customer    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  GitHub Releases (public)                           │   │
│  │  • Signed Docker images                             │   │
│  │  • Public key for license verification              │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
            │                               │
            │ email .lic                    │ docker pull
            ▼                               ▼
┌────────────────────────────────────────────────────────────┐
│  Customer environment                                      │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ClinWrite stack (same code as SaaS)                 │  │
│  │  Web / API / Worker / Collab / Postgres / Redis      │  │
│  │                                                      │  │
│  │  + License engine (reads /license/current.lic at     │  │
│  │    boot, verifies signature, sets module flags).     │  │
│  │  + AI config file (/config/ai.json) — customer       │  │
│  │    lists which LLM providers they want + keys.       │  │
│  │                                                      │  │
│  │  Zero outbound to GenBioCa.                          │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 5.1 Data model (Studio)

Four tables. Two for the license business, two for operator auth.

```sql
-- tenants
id              uuid PRIMARY KEY
name            text              -- "Acme Pharma Pvt Ltd"
contact_name    text
contact_email   text
created_at      timestamptz
archived_at     timestamptz NULL

-- licenses
id              uuid PRIMARY KEY  -- also the jti claim
tenant_id       uuid REFERENCES tenants
modules         text[]            -- ['clinical-writing', 'scientific-writing']
user_cap        int               -- max active users
issued_at       timestamptz
expires_at      timestamptz
issued_by       text              -- operator email
superseded_by   uuid NULL         -- when renewed
revoked_at      timestamptz NULL
revoked_reason  text NULL
jwt_text        text              -- the signed token we generated

-- operators  (D8 + D9)
id              uuid PRIMARY KEY
email           text UNIQUE       -- must end @genbioca.ai
role            text              -- 'ceo' | 'it-head'
totp_secret     text NULL         -- base32; NULL until enrolled
status          text              -- 'invited' | 'active' | 'suspended'
created_at      timestamptz
last_sign_in_at timestamptz NULL

-- operator_sessions
id              uuid PRIMARY KEY
operator_id     uuid REFERENCES operators
token_hash      text              -- opaque; cookie value is unhashed
created_at      timestamptz
expires_at      timestamptz
revoked_at      timestamptz NULL
```

A new license supersedes the old one. We never update a license row in place.

### 5.2 License JWT

Signed ES256. Payload stays small:

```json
{
  "iss": "clinwrite.genbioca.ai",
  "sub": "<tenant_id>",
  "jti": "<license_id>",
  "iat": 1760640000,
  "exp": 1792176000,
  "tenant_name": "Acme Pharma Pvt Ltd",
  "modules": ["clinical-writing", "scientific-writing"],
  "user_cap": 25
}
```

Verification is one `jwt.verify()` call at API boot.

### 5.3 Multi-provider AI (customer-owned)

The customer puts their LLM API keys in a config file:

```json
// /opt/clinwrite/config/ai.json
{
  "default": "anthropic",
  "providers": {
    "anthropic":    { "api_key": "sk-ant-..." },
    "openai":       { "api_key": "sk-..." },
    "google":       { "api_key": "..." },
    "azure-openai": { "endpoint": "https://...", "api_key": "..." }
  }
}
```

The AI gateway inside ClinWrite looks for the provider named `default` and uses it. If the customer wants to switch to Google Gemini, they change `default` to `google`. No code change.

**That's the whole provider abstraction.** One thin adapter per supported provider, same call shape: `chat({ prompt, maxTokens }) → { text, inputTokens, outputTokens }`.

Providers supported out of the box: `anthropic`, `openai`, `google`, `azure-openai`.

### 5.4 Expiry behaviour

- Before `exp`: everything works.
- After `exp` for 30 days: writes blocked. Reads + exports allowed. Big yellow banner tells users to renew.
- After `exp + 30 days`: all routes return 403. Only the audit-log export route still works, so the customer can get their data out.

### 5.5 Updates

- GenBioCa pushes a new Docker image tag.
- Customer sees release notes in their email.
- When they're ready: `docker compose pull && docker compose up -d`.
- Migrations run automatically on the API container's startup.

Nothing more.

---

## 6. What's already in the current codebase that helps

- Module gating already exists via `FEATURE_MODULES_ENABLED` env var. We'll replace that env var's source with "read from the license JWT at boot" — no other code change.
- Audit chain (`AUDIT_HASH_SECRET` + hash-chained events) works unchanged.
- Role model was simplified last week (`super-admin` retired). Single-tenant deployments have one admin role. Clean.
- Docker Compose + systemd units for standalone already live at `infra/standalone/`.

---

## 7. What needs small changes

| Area | Current | Change |
|---|---|---|
| AI gateway | Single Anthropic provider, GenBioCa key | Four adapters (anthropic, openai, google, azure-openai), each a thin wrapper. Config-file driven. |
| License engine | Doesn't exist. | New Fastify plugin: ~200 lines. Reads `/license/current.lic`, verifies, exposes `app.license`. |
| Module gating source | `FEATURE_MODULES_ENABLED` env var | `app.license.modules` |
| Studio auth | New app, no auth yet. | Email magic link + TOTP (per D8). Two new Postgres tables in the Studio: `operators` (email, role, totp_secret, status) and `operator_sessions` (opaque token, revocable). Admin page (D9) is open to both roles. Server-side guards reject removing yourself and removing the last operator. |
| Seed | Multi-tenant demo users | A single admin created from the license's contact fields, no demo data |
| Release pipeline | Builds Docker images | Also signs them with `cosign` |

---

## 8. Build plan

Keep it to three chunks, roughly sequential:

**Chunk 1 — License engine + minimal Studio.** License plugin in the main app. Studio has the two tables + a sign-and-download screen. Enough to issue a first license and prove the loop works end-to-end. **~2 weeks.**

**Chunk 2 — Multi-provider AI + config loader.** Refactor the current AI gateway behind a provider interface. Add the three new adapters (openai, google, azure-openai). Hot-reload the config on SIGHUP. **~2 weeks.**

**Chunk 3 — Deployment polish.** `cosign` on the release pipeline. Install guide. Pre-flight check script. One pilot customer deployed. **~2 weeks.**

**Total: ~6 weeks for a shippable standalone + working Studio.**

---

## 9. Not in v1

Listed so we're explicit about what we're *not* building:

- Revocation list refresh over cron.
- Clock-rollback detection.
- Customer-facing portal.
- Multiple sub-tenants inside one deployment.
- Online license refresh / phone-home.
- Automated migration dry-run / rollback.
- Shamir split for signing key.
- Local LLM support (Ollama / vLLM).
- Telemetry opt-in.
- Billing automation.

Any of these can land later. None is needed to ship v1.

---

## 10. Open questions

1. **Signing-key backup.** Primary: USB drive in the office safe. Backup: sealed USB in a bank locker? Pick a location.
2. **Pilot customer.** Who? Pre-arrange before Chunk 3.
3. **Install guide scope.** One generic guide, or one per cloud (AWS/Azure/GCP)? Suggest one generic + a per-cloud appendix.
4. **DPA template.** Legal needs to sign off on a "we touch nothing" DPA for pilot. Start this in parallel with Chunk 1.
