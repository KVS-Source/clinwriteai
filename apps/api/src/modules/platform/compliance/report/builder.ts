// Compliance report builder — shared between the JSON and PDF routes so
// both outputs score from one query set, zero drift.

import type { PrismaClient } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import { PostgresAuditRepository } from '../../../../audit/postgres-repository.js'

export interface ComplianceReport {
  window: { from: string; to: string }
  audit: {
    totalEvents: number
    byAction: Array<{ action: string; count: number }>
    chainIntegrity: Awaited<ReturnType<PostgresAuditRepository['verifyChain']>>
  }
  ai: {
    totalCalls: number
    totalCostUsd: number
    totalInputTokens: number
    totalOutputTokens: number
  }
  identity: {
    userCount: number
    activeSessionCount: number
  }
  generatedAt: string
}

export async function buildComplianceReport(
  prisma: PrismaClient,
  auditSecret: string,
  window: { from: Date; to: Date },
  _log?: FastifyBaseLogger,
): Promise<ComplianceReport> {
  const [auditTotal, auditByAction, aiSummary, userCount, activeSessionCount, chainResult] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::bigint AS count FROM audit_events WHERE "timestamp" BETWEEN $1 AND $2',
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe<Array<{ action: string; count: bigint }>>(
      'SELECT action, COUNT(*)::bigint AS count FROM audit_events WHERE "timestamp" BETWEEN $1 AND $2 GROUP BY action ORDER BY count DESC',
      window.from, window.to,
    ),
    prisma.aiCallRecord.aggregate({
      where: { createdAt: { gte: window.from, lte: window.to } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: { _all: true },
    }),
    prisma.user.count(),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    (async () => {
      const repo = new PostgresAuditRepository(prisma, auditSecret)
      return repo.verifyChain()
    })(),
  ])

  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    audit: {
      totalEvents: Number(auditTotal[0]?.count ?? 0),
      byAction: auditByAction.map(r => ({ action: r.action, count: Number(r.count) })),
      chainIntegrity: chainResult,
    },
    ai: {
      totalCalls: aiSummary._count._all,
      totalCostUsd: Number(aiSummary._sum.costUsd ?? 0),
      totalInputTokens: aiSummary._sum.inputTokens ?? 0,
      totalOutputTokens: aiSummary._sum.outputTokens ?? 0,
    },
    identity: {
      userCount,
      activeSessionCount,
    },
    generatedAt: new Date().toISOString(),
  }
}
