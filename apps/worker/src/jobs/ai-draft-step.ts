// Fine-grained step logger for the AI drafter. Every meaningful
// milestone the worker reaches gets a row in ai_draft_steps so the
// AI Debug panel can render a verbose play-by-play ("source X loaded
// 240KB, extracted 12,480 chars", "§6.2 TBDs: 3", "validation pass
// 2 flagged §8.4"). Pure side-channel — never throws or blocks the
// job, so a logging failure never breaks a draft.
//
// Usage:
//   const steps = createStepLogger(prisma, log, { documentId, versionId })
//   await steps.emit('source_loaded', 'Protocol v2 loaded', {
//     sectionId: null,
//     details:   { uploadId: 'u1', bytes: 245_000, chars: 12_480 },
//   })

import type { PrismaClient } from '@prisma/client'

export type AiDraftStepKind =
  | 'job_started'
  | 'policy_loaded'
  | 'prompt_assembled'
  | 'source_loaded'
  | 'source_skipped'
  | 'section_start'
  | 'section_ai_call'
  | 'section_response'
  | 'section_tbds'
  | 'section_committed'
  | 'section_skipped'
  | 'section_errored'
  | 'validation_pass_start'
  | 'validation_pass_end'
  | 'tbd_autofill_run'
  | 'job_complete'
  | 'job_cancelled'
  | 'job_paused'
  | 'warning'

export interface StepEmitOptions {
  sectionId?: string | null
  details?:   Record<string, unknown>
}

export interface StepLogger {
  emit(kind: AiDraftStepKind, message: string, opts?: StepEmitOptions): Promise<void>
  /** Wrap the next emit's elapsedMs calculation with a fresh start marker —
   *  useful when the draft enters a new phase (validation, retry) where
   *  per-step elapsed should restart. Rarely needed; the default is "since
   *  createStepLogger()". */
  restartClock(): void
}

interface LoggerCtx {
  documentId: string
  versionId:  string | null
}

interface MinimalLog {
  warn:  (obj: unknown, msg?: string) => void
  info?: (obj: unknown, msg?: string) => void
}

export function createStepLogger(
  prisma: PrismaClient,
  log:    MinimalLog,
  ctx:    LoggerCtx,
): StepLogger {
  let start = Date.now()
  return {
    restartClock() { start = Date.now() },
    async emit(kind, message, opts = {}) {
      const elapsedMs = Date.now() - start
      try {
        await prisma.aiDraftStep.create({
          data: {
            documentId: ctx.documentId,
            versionId:  ctx.versionId,
            kind,
            message:    message.slice(0, 1_000),
            sectionId:  opts.sectionId ?? null,
            details:    (opts.details ?? {}) as unknown as object,
            elapsedMs,
          },
        })
      } catch (err) {
        // Never let a logging failure break the draft. Writers will
        // notice the missing steps in the panel but the worker keeps
        // going; this is a diagnostic side-channel only.
        log.warn({ err, documentId: ctx.documentId, kind }, 'ai-draft step log insert failed')
      }
    },
  }
}

/** No-op logger — for tests / contexts where we don't care about steps. */
export function nullStepLogger(): StepLogger {
  return {
    restartClock() {},
    async emit() {},
  }
}
