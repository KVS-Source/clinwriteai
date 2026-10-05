// Voice transcription worker — Module A voice notes.
//
// Current behaviour: stub transcript. When the real provider lands
// (Whisper via OpenAI, or Anthropic Claude audio once that API ships),
// this handler swaps the stub for a real STT call. The handler shape,
// return value, and the VoiceNote row update stay identical.
//
// Idempotency: jobs are enqueued with jobId=`voice-transcribe-${noteId}`,
// so BullMQ dedupes across retries. The handler also returns early if
// the note is already transcribed, so even a reset-and-rerun won't
// double-write.
//
// Observability: durationMs logged by the generic worker wrapper in
// apps/worker/src/index.ts; failures surface via bullmq_queue_failed
// gauge + the Phase 6 QueueBacklogGrowing alert.

import type { JobHandler } from './types.js'

interface VoiceTranscribePayload {
  noteId: string
  documentId: string
  blobKey: string
  actorId: string
}

const STUB_TRANSCRIPT_HEAD = '[stub transcript — real STT provider (Whisper/Claude audio) not wired yet]'

export const handleVoiceTranscribe: JobHandler<VoiceTranscribePayload> = async (job, { prisma, log }) => {
  const { noteId } = job.data

  const note = await prisma.voiceNote.findUnique({ where: { id: noteId } })
  if (!note) {
    log.warn({ noteId }, 'voice note not found — ignoring job')
    return { skipped: 'not_found' }
  }
  if (note.transcriptStatus === 'complete') {
    log.info({ noteId }, 'voice note already transcribed — idempotent return')
    return { skipped: 'already_complete', transcriptLength: note.transcript.length }
  }

  // Deterministic stub so tests and demos see sensible, non-empty text
  // instead of blank fields. Reflects what we know (duration, section).
  const duration = note.durationSeconds ?? 0
  const transcript = [
    STUB_TRANSCRIPT_HEAD,
    `Section: ${note.sectionRef}`,
    `Approximate duration: ${duration}s`,
    `Author: ${note.authorId}`,
    `Captured on: ${note.createdAt.toISOString()}`,
  ].join('\n')

  const updated = await prisma.voiceNote.update({
    where: { id: noteId },
    data: {
      transcript,
      transcriptStatus: 'complete',
      transcriptionEngine: 'stub',
    },
  })

  log.info({ noteId, transcriptLength: transcript.length }, 'voice transcription complete (stub)')
  return { noteId: updated.id, transcriptLength: transcript.length, engine: 'stub' }
}
