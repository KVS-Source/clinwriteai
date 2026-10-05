---
title: Disaster Recovery Plan
status: draft
owner: SRE Lead
reviewers: ["Head of Engineering", "Compliance Lead"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# Disaster Recovery Plan

## Targets

| Metric | Target | Rationale |
|---|---|---|
| **RTO** (Recovery Time Objective) | **4 hours** | Writer productivity + regulator timeline tolerance |
| **RPO** (Recovery Point Objective) | **1 hour** | Hourly transaction log shipping + nightly full backup |
| **MTBF** (Mean Time Between Failures) | 90 days | Infrastructure stability target |

## Scope

What this plan covers:
- Loss of the primary VPS (hardware failure, provider incident, ransomware)
- Database corruption or accidental destructive query
- Backup pipeline failure
- Regional outage at the hosting provider

Out of scope:
- Loss of GitHub (code is reproducible from any clone + the hashed deps)
- Loss of a single engineer's laptop (nothing production-critical lives there)

## Backup topology

```
Primary VPS (Hetzner, FSN1)                    Off-site (Backblaze B2, EU-central)
┌──────────────────────────┐                   ┌─────────────────────────────────┐
│ Postgres 16              │   nightly dump    │ /backups/pg/YYYY/MM/DD.sql.gz   │
│                          ├──────────────────>│                                 │
│                          │   hourly WAL ship │ /backups/pg-wal/.../*.wal       │
│                          │                   │                                 │
│ MinIO (documents, voice, │   nightly rclone  │ /backups/minio/YYYY/MM/DD/      │
│  exports, eCTD)          ├──────────────────>│                                 │
│                          │                   │                                 │
│ sops-encrypted .env.enc  │   nightly         │ /backups/env/YYYY/MM/DD.tar.gz  │
│                          ├──────────────────>│  (encrypted at rest with age)   │
└──────────────────────────┘                   └─────────────────────────────────┘
```

Backup script lives at `infra/standalone/scripts/backup.sh`.
Retention: 90 days hot in B2 Standard; archived to B2 Archive after 90d (365d total).

## Recovery scenarios

### Scenario 1 — Primary VPS lost; database intact on new VPS from backup

**Trigger:** Hetzner declares primary VPS lost / unrecoverable within 1h of outage.

**Procedure:**
1. Provision replacement VPS (same spec; Hetzner API or console) — target: 15 min.
2. SSH in; run `infra/standalone/scripts/bootstrap.sh` to install Docker,
   Postgres image, nginx, systemd units, age key material (pulled from
   sealed-hardcopy backup if needed). Target: 30 min.
3. Restore Postgres from latest B2 snapshot:
   ```bash
   /opt/platform/scripts/restore.sh --from s3://backups/pg/<YYYY/MM/DD>.sql.gz
   # Apply WAL to RPO target:
   /opt/platform/scripts/restore.sh --apply-wal-up-to <ts>
   ```
   Target: 60 min for a ~10GB database.
4. Restore MinIO buckets via rclone from B2. Target: parallel with (3), 30-60 min.
5. Restore secrets:
   ```bash
   age -d -i /etc/platform/age.key /backups/env/<YYYY/MM/DD>.tar.gz.age \
     | tar xz -C /opt/platform/env
   ```
6. Point DNS at new VPS IP via Cloudflare API. TTL is 60s, so propagation
   is <5 min. Target: 10 min total including verification.
7. Run `/health` + `/admin/compliance/verify-chain` to confirm restoration.
   Target: 5 min.
8. Resume services; write a `disaster_recovery_executed` audit event.

**Total:** <4h end-to-end. Verified via quarterly drill.

### Scenario 2 — Database corruption (not malicious)

**Trigger:** Query returns inconsistent results; verifyChain returns `intact:false`
with a firstBreakAt that doesn't match a known rotation.

**Procedure:**
1. **Preserve current state** — do NOT run migrations or writes.
   ```sql
   CREATE TABLE audit_events_corruption_<ts> AS SELECT * FROM audit_events;
   ```
2. Point-in-time restore to just before the corruption window:
   ```bash
   /opt/platform/scripts/restore.sh --from latest-pre-corruption --target-time <ISO>
   ```
3. Replay audit_events since restore point from the preserved snapshot
   IF chain is intact from that point forward. Otherwise accept the data
   loss — Part 11 integrity is more important than recovering individual rows.
4. Full compliance incident per `incident-response.md`.

### Scenario 3 — Ransomware on primary

**Trigger:** Files on primary are encrypted/unreadable; attacker demands ransom.

**Procedure:**
1. **Do not pay.** Isolate the VPS from the network immediately (Hetzner
   firewall block).
2. Treat as Scenario 1 — restore from off-site B2. B2 has versioning
   enabled; even if attacker compromised the backup upload creds (unlikely
   because sops+age), prior versions are recoverable.
3. Rotate ALL secrets after restore.
4. Full forensic engagement — the primary disk image may need to go to
   a specialist firm.

### Scenario 4 — Hetzner region outage

**Trigger:** Hetzner FSN1 datacentre offline for >1h.

**Procedure:**
1. Monitor Hetzner status page for ETA.
2. If ETA >RTO (4h), execute Scenario 1 to a different Hetzner region or
   secondary provider (we maintain backup provider credentials sealed).
3. If ETA <RTO, wait — switching providers for a 2h outage adds more risk
   than the outage itself.

## DR drill cadence

- **Quarterly**: Full restore to a staging VPS from latest backup; run smoke
  test; produce after-action report filed in SOC 2 evidence.
- **Monthly**: Backup integrity verification — pick a random nightly backup,
  decompress + verify checksum + sample-restore a single table.
- **After every major arch change**: Mini-drill to confirm the backup still
  reflects reality.

## Communication plan during DR

1. Internal: #incidents channel (name the IC, state RTO target, update every 30 min).
2. Status page: within 15 min of declaring an outage incident.
3. Customers: via DPA notification channel within 1h of confirmed outage >15 min.
4. Compliance Lead informed for Part 11 impact assessment within 1h.

## Known DR limitations

- **AI call records**: during a DR window, in-flight AI calls fail. On
  recovery, modules may need manual re-run for critical operations.
- **Session state**: all users will be logged out after a restore (new
  JWT_SECRET on restore + sessions table may miss rows between RPO point
  and failure).
- **Rate-limit state**: Redis state is ephemeral; limiters reset on recovery.
- **Live editing / presence**: Socket.io sessions all terminate; users see
  "lost connection" and must re-connect.

## Post-DR verification checklist

- [ ] `/health` returns 200
- [ ] `/ready` returns 200
- [ ] `GET /admin/compliance/verify-chain` returns `intact:true`
- [ ] Audit event `disaster_recovery_executed` present
- [ ] Smoke test: login + list projects + GET /auth/me
- [ ] Random sample of DB queries matches expected row counts vs pre-DR
- [ ] All systemd units `active`
- [ ] All docker containers healthy
- [ ] Grafana + Prometheus scraping again
- [ ] After-action report filed within 5 business days
