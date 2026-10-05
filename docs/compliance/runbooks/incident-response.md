---
title: Incident Response Runbook
status: draft
owner: Security Lead
reviewers: ["Compliance Lead", "On-call engineering"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# Incident Response Runbook

Executable playbook for security + reliability incidents. Keep it short so
on-call reads it in 30 seconds under pressure.

## Severity levels

| Sev | Definition | Target response | Target resolution |
|---|---|---|---|
| **Sev1** | Confirmed data breach, prod outage >5 min, data loss, audit chain break | <15 min | <4 h |
| **Sev2** | Partial outage, significant data integrity issue, AI prompt leaked PII | <30 min | <8 h |
| **Sev3** | Minor degradation, single user affected, suspected (unconfirmed) security event | <2 h | <24 h |
| **Sev4** | Non-urgent — low-impact bug, maintenance tasks | <24 h | best effort |

## Decision tree — "is this a Sev1?"

```
Confirmed data breach (customer data exposed)?       → Sev1
Audit chain break (verify-chain intact:false)?       → Sev1
Prod API returning 5xx for >5 min for all users?     → Sev1
Backup pipeline silent for >24h?                     → Sev1 (SOC 2 CC7.5)
AI quota disabled but calls succeeding anyway?       → Sev2 (quota semantic drift)
Single endpoint returning 500 for subset of users?   → Sev2
Dependabot critical CVE in prod dependency?          → Sev2
Secret appeared in a public commit?                  → Sev1 + rotate immediately
```

## Immediate actions (first 15 minutes — Sev1)

1. **Acknowledge** — in the #incidents channel; name the IC (Incident Commander).
2. **Preserve evidence** — do not delete logs; snapshot the DB if feasible.
3. **Communicate** — bump the status page; notify Compliance Lead for breach-class.
4. **Contain** — if active exploit, consider:
   - Rotating `JWT_SECRET` (invalidates all sessions)
   - Blocking offending IP at Cloudflare WAF
   - Disabling the compromised user via `/admin/users/:id` DELETE
   - Flipping `FEATURE_AI_GATEWAY=false` if AI pipeline is the vector
5. **Investigate** — pull audit_events and Loki logs for the affected window.

## Common response procedures

### Audit chain break (Sev1 — Part 11 breach)

1. Snapshot `audit_events` to a read-only table immediately:
   ```sql
   CREATE TABLE audit_events_snap_INCIDENT_ID AS SELECT * FROM audit_events;
   ```
2. Run `GET /admin/compliance/verify-chain` to confirm + locate `firstBreakAt`.
3. Isolate the time window of the break using `audit_events.id` ordering.
4. Determine whether:
   - A trigger was disabled by someone with raw DB access (check `pg_trigger`).
   - A row was inserted out of order (shouldn't be possible via app).
   - `AUDIT_HASH_SECRET` rotated (would break ALL rows from rotation point —
     different signature than a single break).
5. File a Part 11 compliance incident report within 24h.
6. If customer data integrity is proven lost (unlikely — hash chain detects
   but doesn't repair), notify customers per BAA / DPA terms.

### Secret in public commit (Sev1)

1. Rotate the secret immediately via sops+age — do NOT delete the commit.
2. Force-push rewrite is NOT the fix; the secret is already indexed by
   crawlers. Rotation is the only remediation.
3. If `AUDIT_HASH_SECRET` was leaked: Part 11 incident — the chain can be
   forged with the secret. Rotation breaks the historical chain but is
   mandatory. File incident; new chain begins at rotation point; old chain
   is archived with its own verification artefact.
4. Scrub access logs; who had read access to this secret?
5. Review how it ended up in the commit. Pre-commit hook + CI gate exist
   (`.githooks/pre-commit` + `.github/workflows/secret-scan.yml`); confirm
   the author's local hook was active (`git config core.hooksPath` →
   `.githooks`) and check whether `--no-verify` was used.

### Data breach / unauthorised access (Sev1)

1. Identify scope — `GET /admin/compliance/report?from=...&to=...` for the
   affected window.
2. Preserve evidence (snapshot audit_events + Loki logs + Nginx access log).
3. Contain — rotate affected credentials; revoke sessions:
   ```sql
   UPDATE sessions SET revoked_at = NOW() WHERE user_id = <compromised>;
   ```
4. Notify Compliance + DPO within 1 hour.
5. Within 72 hours (GDPR Art. 33): notify supervisory authority if the
   breach is likely to result in risk to data subjects.
6. Within 72 hours (HIPAA): notify Compliance for Breach Notification Rule
   assessment.
7. Customer notification per DPA terms (usually 24-72h).
8. Post-mortem within 5 business days.

### Prod API 5xx storm (Sev1 outage)

1. Check `/health` — does it respond?
2. If yes: inspect `/metrics` — is DB connection pool exhausted? Redis down?
3. If no: inspect `systemctl status platform-api`.
4. Short-circuit: `systemctl restart platform-api` can buy time to investigate.
5. Rollback: `scripts/deploy.sh` with the prior commit SHA — the deploy script
   is idempotent and swaps the systemd target cleanly.
6. Post-mortem.

### AI prompt leaked PII (Sev2)

1. `GET /admin/compliance/report` to confirm `piiScrubbed=true` for recent calls
   (expected). If a prompt went through with piiScrubbed=false and clearly
   contained PII, the scrubber missed a pattern.
2. Identify the pattern that leaked.
3. Add a regex to `pii-scrub.ts` + unit test.
4. Confirm no downstream training on the leaked data (contact Anthropic DPA
   terms — their logging retention is in the DPA).
5. If leak involved HIPAA PHI or GDPR special category data: Sev1, follow
   breach procedure above.

## Post-mortem template

For every Sev1 + Sev2 incident, within 5 business days:

```markdown
# Incident Post-Mortem — <TITLE>

- Date / time: <UTC range>
- Sev: 1 | 2
- Status: resolved | ongoing | mitigated
- IC: <role>

## Summary
<2-3 sentences>

## Impact
- Users affected: <count or 'all'>
- Duration: <HH:MM>
- Data at risk: <describe or 'none confirmed'>

## Timeline
- HH:MM — event
- HH:MM — detection
- HH:MM — mitigation applied
- HH:MM — resolved

## Root cause
<technical analysis>

## What went well
- …

## What went badly
- …

## Action items (owner, due date)
- [ ] …

## Updates to this runbook
- …
```

## Contact tree

| Role | Primary | Backup |
|---|---|---|
| Incident Commander | Security Lead | Head of Engineering |
| Communications | Compliance Lead | Customer Success Lead |
| Technical lead | On-call engineer | SRE Lead |
| Legal / regulator liaison | DPO | External counsel |

## Regulator-notification clocks

| Regulator | Trigger | Clock | Channel |
|---|---|---|---|
| GDPR supervisory authority (ICO / CNIL / etc.) | Personal data breach likely to risk data subjects | 72h | Online form per authority |
| HIPAA (HHS/OCR) | PHI breach affecting ≥500 individuals | 60 days (<500: annual rollup) | OCR portal |
| HHS/OCR (<500) | PHI breach affecting <500 | Annual aggregated | OCR portal |
| FDA | Audit-chain compromise on Part 11 record | Discretionary — consult Compliance | Form 1571 for IND, FDA ESG for other |
| Customers | Per DPA | Usually 24-72h | Direct email + status page |
