// Compliance-gauge scheduler — keeps the Prometheus gauges the Phase 6
// alerts rely on fresh.
//
// Why in-process: the gauges are published by fastify-metrics which lives
// in the API process. An external cron would need a separate /metrics
// endpoint or textfile-collector dance. In-process keeps the moving
// parts to one; the trade-off is that if the API is down, the gauges
// freeze — but that's fine because `ApiDown` fires first and takes
// precedence over anything downstream.
//
// What it does on each tick:
//   1. Run `verifyChain()` end-to-end. Set `platform_audit_chain_intact`
//      to 1 if intact else 0, and update the "last verify" timestamp.
//   2. Query the newest `access_review_exported` audit event and set
//      `platform_access_review_last_export_seconds` to its timestamp.
//   3. Read a textfile the backup cron writes
//      (`/var/lib/platform/backup.last_success`) to populate the backup
//      gauge. If the file is missing, leave the gauge at 0 so the
//      BackupStale alert fires.
//
// Tick interval is 5 minutes by default — matches the alerts.yml
// `interval: 5m` on the platform-compliance group. For dev we tick
// every 60s so you can watch things change.

import type { PrismaClient } from '@prisma/client'
import { readFile, stat } from 'node:fs/promises'
import { PostgresAuditRepository } from '../../../audit/postgres-repository.js'
import type { PlatformMetrics } from '../metrics/plugin.js'

export interface SchedulerOptions {
  prisma: PrismaClient
  metrics: PlatformMetrics
  auditSecret: string
  tickMs: number
  backupTimestampFile: string      // '/var/lib/platform/backup.last_success'
  drillTimestampFile: string       // '/var/lib/platform/backup.drill_last_success'
  logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
}

export class ComplianceGaugeScheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly repo: PostgresAuditRepository

  constructor(private readonly opts: SchedulerOptions) {
    this.repo = new PostgresAuditRepository(opts.prisma, opts.auditSecret)
  }

  start(): void {
    if (this.timer) return
    // Fire immediately on boot so the gauge is populated before the first
    // Prometheus scrape (otherwise the first ~scrape_interval window shows 0,
    // which would false-positive the AuditChainBroken alert).
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs)
    this.timer.unref()      // don't block process exit on this
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick(): Promise<void> {
    await Promise.all([
      this.updateChainIntegrityGauges(),
      this.updateAccessReviewGauge(),
      this.updateBackupGauges(),
    ])
  }

  private async updateChainIntegrityGauges(): Promise<void> {
    try {
      const r = await this.repo.verifyChain()
      this.opts.metrics.auditChainIntact.set(r.intact ? 1 : 0)
      this.opts.metrics.auditChainLastVerify.set(Date.now() / 1000)
      if (!r.intact) {
        this.opts.logger.error({ firstBreakAt: r.firstBreakAt }, 'audit chain integrity broken')
      }
    } catch (err) {
      // Keep the last-verify gauge pinned so AuditChainVerifyMissing fires
      // if we're persistently failing to verify.
      this.opts.logger.error({ err }, 'chain verify failed')
    }
  }

  private async updateAccessReviewGauge(): Promise<void> {
    try {
      const rows = await this.opts.prisma.$queryRawUnsafe<Array<{ timestamp: Date }>>(
        `SELECT "timestamp" FROM audit_events WHERE action = 'access_review_exported'
         ORDER BY id DESC LIMIT 1`,
      )
      const latest = rows[0]
      if (latest) {
        this.opts.metrics.accessReviewLastExport.set(latest.timestamp.getTime() / 1000)
      }
      // If never exported, gauge stays at 0 → AccessReviewOverdue fires.
    } catch (err) {
      this.opts.logger.error({ err }, 'access review gauge update failed')
    }
  }

  private async updateBackupGauges(): Promise<void> {
    await Promise.all([
      this.readTimestampFile(this.opts.backupTimestampFile, this.opts.metrics.backupLastSuccess),
      this.readTimestampFile(this.opts.drillTimestampFile, this.opts.metrics.backupDrillLastSuccess),
    ])
  }

  private async readTimestampFile(path: string, gauge: PlatformMetrics['backupLastSuccess']): Promise<void> {
    try {
      // We accept either a timestamp written INTO the file (unix seconds)
      // OR an mtime-only touchfile. First try the content; fall back to mtime.
      const raw = await readFile(path, 'utf8').catch(() => null)
      if (raw && raw.trim().length > 0) {
        const n = Number(raw.trim())
        if (!Number.isNaN(n)) {
          gauge.set(n)
          return
        }
      }
      const s = await stat(path)
      gauge.set(s.mtimeMs / 1000)
    } catch {
      // File missing → leave gauge at 0 so the BackupStale alert fires.
    }
  }
}
