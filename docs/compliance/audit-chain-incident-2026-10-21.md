# Audit chain incident — 2026-10-21

**Severity:** Low (no data loss, no tampering)
**Status:** Resolved
**Fix commit:** `27e7ea5`
**Entries affected:** `audit_events.id = 1953, 1963`

---

## Summary

The audit-chain integrity verifier (hourly scheduled check +
`GET /admin/audit/verify`) raised a `firstBreakAt: 1953` alarm every minute
on staging. Investigation showed:

- No tampering. The row contents of #1953 and #1963 are intact and
  readable.
- All 1,989 other audit entries re-verified cleanly end-to-end.
- Only #1953 and #1963 fail. Both are `action = 'audit_chain_verified'`
  entries — i.e. audit entries about the verifier itself ("audit the
  audit", per Part 11 §11.10(e)).

## Root cause

The two entries were written when "Verify chain" was triggered from the
Compliance screen with no ID range filter (both `fromId` and `toId`
blank). The sealing path wrote these empty values into the audit
`details` payload as the literal string `"undefined"`. Postgres's JSON
canonicalisation dropped them from storage (undefined is not a JSON
value), so the row that was *sealed* and the row that is *stored* no
longer canonicalise to the same bytes:

```
sealed:   { "fromId": "undefined", "toId": "undefined", ... }
stored:   { ... }                                            ← no fromId/toId keys
```

`row_hash = H(prev_hash || canonical(stored) || secret)` therefore
differs from the sealed hash and the verifier flags the row as broken.

## Fix (commit `27e7ea5`)

The sealing path now coerces empty `fromId`/`toId` to the explicit
`null` sentinel the audit payload JSON schema expects, matching what
Postgres actually stores. All audit entries written on or after
`27e7ea5` seal and verify identically.

The two existing broken entries cannot be re-sealed (that would
require editing an immutable Part 11 row, which is explicitly
forbidden — §11.10(c)).

## Decision — mark as known-exception (not silent whitelist)

Per team decision on 2026-10-21 Chetan Amin, the two entries are
documented as "known exceptions" in the verifier
(`apps/api/src/audit/known-exceptions.ts`). The verifier walks past
them when computing the overall `intact` flag so the hourly scheduled
check doesn't page, **but** the response + UI surface them explicitly
in every verify response so operators and auditors always see them.

Why not just leave the alarm red?

1. **Alert fatigue** — a permanently-red integrity alarm trains
   operators to ignore it. The next real break goes unnoticed.
2. **Mislead auditors** — a FDA inspector or SOC 2 auditor seeing a
   persistent "chain broken at #1953" with no explanation loses
   confidence in the whole chain. A documented exception + visible
   chip is defensible.
3. **Masks the fix** — commit `27e7ea5`'s whole point is "no new
   breaks". A visible red flag undermines that.

Why this is still Part 11-safe:

- The two rows **stay in `audit_events`**, immutable, unmodified.
  Part 11 §11.10(c) prohibits *altering* records — the whitelist does
  not touch the records.
- The verifier reports `intact: true, exceptions: [1953, 1963]` —
  never `intact: true` on its own. Transparency, not concealment.
- Any new addition to the exceptions list must pair with (a) a bug-
  fix commit, (b) this kind of incident doc, (c) a signed-off change
  ticket.

## Changes shipped alongside this doc

- `apps/api/src/audit/known-exceptions.ts` — exceptions list +
  helpers (`isKnownAuditException`, `knownExceptionsInRange`).
- `apps/api/src/audit/repository.ts` — `VerifyChainResult` widened to
  `{ intact, firstBreakAt, unexpectedBreaks, exceptions }`.
- `apps/api/src/audit/postgres-repository.ts` — verifier walks past
  known-bad entries (carries the actual stored `row_hash` forward so a
  single bad row doesn't cascade-flag every row after it).
- `apps/api/src/modules/platform/compliance/gauge-scheduler.ts` —
  only alarms on `unexpectedBreaks`; known exceptions log at
  info-level.
- `apps/api/src/modules/platform/tenant-admin/audit/routes.ts` —
  `GET /admin/audit/verify` response adds `exceptions` +
  `unexpectedBreaks`.
- `apps/web/src/platform/screens/tenant-admin/AuditTrailViewerLive
  .tsx` — "Known exceptions (N)" amber chip + per-id reason list under
  the verify-result banner.

## Audit trail of this incident

- 2026-10-21 — chain-break alarm raised on staging
  (`firstBreakAt: 1953` every minute).
- 2026-10-21 — root cause identified (sealing vs storage of empty
  values); commit `27e7ea5` pushed to fix the sealing path.
- 2026-10-21 — decision taken (Chetan Amin) to mark the two existing
  entries as known-exceptions rather than leave the chain flagged.
- 2026-10-21 — exceptions list + verifier change pushed.

If/when a real `firstBreakAt` fires again, it will **not** be #1953 or
#1963 — those are suppressed. Any other id reaching the alarm is a
genuine integrity event and should trigger the incident-response
runbook (`docs/compliance/runbooks/incident-response.md "audit chain
break"`).
