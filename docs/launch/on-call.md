---
title: On-Call Rota + Alert Response
status: draft
owner: SRE Lead
reviewers: ["Head of Engineering", "Security Lead"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# On-Call

Primary + secondary rotation. Secondary covers if primary doesn't ack
within 5 minutes.

## Rotation structure

- **Week-long shifts**, Mon 09:00 → Mon 09:00 UTC.
- **Primary + Secondary** always paired; secondary pages if primary silent >5m.
- **Minimum 4 engineers** in the rotation; 1-week on, 3-week off.
- **No solo on-call** — launch gates on hitting 4 trained engineers.

## Compensation

Per-shift stipend + time-off-in-lieu for Sev1 incident response outside
business hours. HR policy TBD.

## Handoff ritual (every Monday 09:00 UTC)

Both engineers (outgoing + incoming) + SRE Lead on a 15-min call:

1. Review last week's incidents (if any) + open follow-up tickets.
2. Review open alerts in Alertmanager.
3. Review the compliance dashboard — any yellow/red stats?
4. Review backup / drill status (last 7 days).
5. Review error budget consumption (SLO dashboard).
6. Flag any planned maintenance / deploys during the incoming week.

Handoff notes go in `#oncall-handoff` channel; outgoing engineer closes
their shift journal.

## Alert → runbook mapping

Every Prometheus alert carries a `runbook:` annotation pointing at a
specific anchor in the compliance runbooks. The paging message surfaces
this URL directly so the on-call doesn't have to search.

| Alert | Runbook | Severity | First response (target 15m) |
|---|---|---|---|
| `ApiDown` | `incident-response.md#prod-api-5xx-storm-sev1-outage` | critical | Check `/health`, `systemctl status`, consider rollback |
| `ApiHighErrorRate` | same | critical | Check Loki for the error class; consider rollback |
| `ApiErrorBudgetFastBurn` | `slo.md#error-budget-policy` | critical | Investigate root cause; freeze releases if confirmed |
| `ApiErrorBudgetSlowBurn` | same | warning | File ticket; investigate next business day unless escalates |
| `ApiHighLatencyP95` | `slo.md#headline-slos` | warning | Check DB connection pool, Redis latency, specific slow routes |
| `ApiHighLatencyP99` | same | warning | Same — p99 tells you about tail; check for a few slow queries |
| `AuditChainBroken` | `incident-response.md#audit-chain-break-sev1--part-11-breach` | **critical / Sev1** | **Preserve state immediately**; follow Part 11 breach procedure |
| `AuditChainVerifyMissing` | same | warning | Chain verify cron is broken — fix the cron, not the chain |
| `AccessReviewOverdue` | `../compliance/SOC2/control-matrix.md#cc6` | warning | Trigger access review manually via `/admin/compliance/access-review` + file |
| `BackupStale` | `disaster-recovery.md#backup-topology` | critical | Check `/opt/platform/logs/backup.log`; if cron failed, run manually; if B2 unreachable, incident |
| `BackupDrillStale` | `disaster-recovery.md#dr-drill-cadence` | warning | Schedule next drill; not an incident unless missed by >60d |
| `QueueBacklogGrowing` | — | warning | Check worker pod health; look at job types piling up |
| `DeadLetterQueueGrowing` | — | critical | Dead letters mean something's permanently broken — don't restart, investigate |
| `DiskSpaceLow` / `MemoryHigh` | — | critical | Classic infra response — identify consumer, trim, consider resize |
| `AiCostSpike` | — | warning | Check `/ai/usage?from=<1h ago>`; identify the module burning; consider quota tightening |
| `AiRateLimitedRateHigh` | — | warning | Customer hitting their cap — contact Account Executive to discuss raising quota |
| `AiGatewayLatencyHigh` | `slo.md#headline-slos` | warning | PII scrub or quota lookup slow — check DB load |

## Paging workflow

1. Alertmanager receives alert from Prometheus.
2. Route by severity:
   - `severity=critical` → PagerDuty (or Opsgenie) → mobile push + SMS to primary.
   - `severity=warning` → #alerts channel; secondary review next business morning.
3. Primary **acknowledges within 5m** (silence) or secondary pages.
4. Open the runbook link; execute the first-response step.
5. Open `#incidents` channel if elevated to a real incident; start a
   timeline in the channel.
6. If Sev1: alert the Compliance Lead and DPO (dedicated distribution list).

## War room protocol (Sev1)

Within 10m of a Sev1 declaration:

- **IC** = primary on-call (unless they explicitly hand off)
- **Scribe** = secondary — timestamped notes in #incidents
- **Comms** = Compliance Lead (customer-facing) + CS Lead (status page)
- **Technical lead** = whoever knows the system in question best

Participants mute status page / Slack notifications and stay in the voice
room until stable. External comms blocked unless IC or Compliance Lead
explicitly authorise.

## Post-incident (within 5 business days)

Follow the post-mortem template in
`docs/compliance/runbooks/incident-response.md`. Filed in the incident
log; action items tracked to closure.

## Known gaps (will fix before GA)

- [ ] PagerDuty/Opsgenie account not yet provisioned — Alertmanager
      currently emails only.
- [ ] Status page provider not chosen (Statuspage.io vs StatusGator vs
      self-hosted). Default state transitions automated via
      Alertmanager → status page webhook.
- [ ] On-call stipend policy not approved by HR.
- [ ] 4-engineer rotation requires 4 trained engineers — hiring + training
      gate for GA.
