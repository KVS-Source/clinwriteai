# Backup & Restore Runbook

## Backup schedule

- **Automatic**: every 6 hours via `platform-backup.timer`
- **Target**: Backblaze B2 bucket in a different region to the VPS
- **Retention**: 30 daily, 12 weekly, 24 monthly (enforced by B2 lifecycle rules)
- **Encryption**: age-encrypted before leaving the VPS

## What's backed up

| Data | Backup method | RTO (restore time) | RPO (data loss window) |
|---|---|---|---|
| Postgres (all app data + audit trail) | `pg_dump --format=custom` → age-encrypted → B2 | ~15 min for 10 GB DB | ≤6h |
| MinIO (document binaries + voice + exports) | `rclone sync` to B2 | ~30 min for 100 GB | ≤24h (nightly sync) |
| Redis (BullMQ state) | AOF persistence + Postgres is source of truth | — | — |
| Grafana dashboards + Prom rules | In git | Immediate (re-provisioned on redeploy) | 0 |
| Secrets (sops `.env.enc`) | In a private secrets repo | Immediate | 0 |
| Age private keys | Password manager + sealed hardcopy in safe | Immediate | 0 |

## Monthly restore drill (MANDATORY)

**Why**: Backups you don't test are not backups. GAMP 5 / SOC 2 both require periodic restore verification.

**Who**: On-call engineer; rotate monthly.

**When**: First Monday of each month at 03:00 UTC.

**How**:

```bash
# On the staging VPS
sudo /opt/platform/scripts/restore.sh --drill
```

This:
1. Finds the latest B2 backup
2. Fetches + decrypts to `/var/backups/platform/restore-<ts>/`
3. Restores into a scratch DB `platform_restore_test_<ts>`
4. Runs integrity queries (row counts + audit-chain integrity check)
5. Drops the scratch DB
6. Emits a Prometheus metric: `platform_backup_drill_last_success_seconds`

**Pass criteria**:
- Script exits 0
- `platform_backup_drill_last_success_seconds` metric updated
- `audit_chain_breaks` count is 0 in the verification query

**If it fails**:
- Alert fires in Grafana
- On-call pages the DevOps lead
- Last successful backup is restored to a fresh test VPS to verify tape, not just script
- Root cause is logged in `docs/incidents/` with a corrective action

## Real restore (DESTRUCTIVE — production incident only)

```bash
# On the production VPS (ONLY in a declared incident)
sudo /opt/platform/scripts/restore.sh                    # restores latest
sudo /opt/platform/scripts/restore.sh --at 20261005-120000  # restores specific
```

The script:
1. Prompts for 10s confirmation (Ctrl+C to abort)
2. Stops `platform-api` + `platform-worker`
3. Fetches + decrypts the chosen backup
4. `pg_restore --clean --if-exists` into the production DB
5. Runs integrity checks
6. Restarts services

**Expected downtime**: ~15 min for 10 GB DB.

**Data loss**: anything written between the chosen backup and the incident is lost. Communicate to users via status page.

## Verification checklist (post-restore)

- [ ] `curl /health` returns 200
- [ ] Users can log in
- [ ] Spot-check a known-good project's document count matches pre-incident
- [ ] Audit trail hash chain validates (`platform_audit_chain_valid` Prom metric)
- [ ] Scheduled jobs are running (`SELECT * FROM bullmq_jobs WHERE state='active'`)
- [ ] Document the restore event as an audit entry (manual INSERT into `audit_events`)

## Disaster scenarios

### Scenario 1: VPS hardware failure
- Hetzner reports the host is dead; a new VPS gets a new IP in 1–2h.
- Run `bootstrap.sh` on the new VPS → fetch latest backup from B2 → restore.
- Update Cloudflare DNS A record.
- **Total RTO**: ~3h.

### Scenario 2: Postgres data corruption
- `restore.sh --at <timestamp before corruption>` restores to pre-corruption state.
- **Total RTO**: ~15–30 min.

### Scenario 3: Backup chain broken (missing backups, bad encryption)
- Spot discovered during monthly drill.
- Investigate root cause (B2 lifecycle too aggressive? Age key wrong?).
- If no valid backup exists for the needed window → data loss is permanent for that window.
- This is why the drill is monthly, not quarterly.

### Scenario 4: Age key compromised
- Rotate the age key (see [`sops/README.md`](sops/README.md))
- Re-encrypt all `.env.enc` files with the new key
- Rotate every secret that was in the old `.env.enc` files (DB password, API keys, etc.)
- Historical backups encrypted with the old key become unreadable with the new key — they're safely dead

### Scenario 5: B2 bucket deleted / credentials lost
- Enable B2 Object Lock + 2FA on the B2 account to prevent accidental deletion.
- Secondary offsite via a second rclone remote (e.g. Wasabi) if the SOC 2 audit requires geographic redundancy.
