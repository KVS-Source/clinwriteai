// Voice transcription worker — Module A voice notes.
//
// Transcription provider: OpenAI Whisper when OPENAI_API_KEY is set,
// deterministic stub otherwise (keeps CI + dev-without-keys working).
// Swapping to Claude audio (when Anthropic ships it) means replacing
// the Whisper branch with the equivalent SDK call; the shape of the
// row update is identical.
//
// Idempotency: jobs are enqueued with jobId=`voice-transcribe-${noteId}`,
// so BullMQ dedupes across retries. The handler also returns early if
// the note is already transcribed, so even a reset-and-rerun won't
// double-write.
//
// Observability: durationMs logged by the generic worker wrapper in
// apps/worker/src/index.ts; failures surface via bullmq_queue_failed
// gauge + the Phase 6 QueueBacklogGrowing alert. Whisper failures mark
// the row transcriptStatus='failed' with the error message so the UI
// can surface a retry affordance.

import type { JobHandler } from './types.js'
import { createBlobReaderFromEnv } from '../blob-reader.js'

interface VoiceTranscribePayload {
  noteId: string
  documentId: string
  blobKey: string
  actorId: string
}

const STUB_TRANSCRIPT_HEAD = '[stub transcript — real STT provider (Whisper/Claude audio) not wired yet]'

// File-ish wrapper around the audio bytes. OpenAI's SDK accepts anything
// that implements the WHATWG File API's name/type/arrayBuffer surface.
// Node's Buffer narrows to ArrayBufferLike (allowing SharedArrayBuffer),
// but File's BlobPart requires ArrayBuffer-backed views — copy via Uint8Array
// against a fresh ArrayBuffer slice to satisfy the type.
function makeAudioFile(bytes: Buffer, contentType: string | null): File {
  const type = contentType ?? 'audio/webm'
  const ext  = type.includes('mp4')  ? 'mp4'
             : type.includes('ogg')  ? 'ogg'
             : type.includes('wav')  ? 'wav'
             : type.includes('mpeg') ? 'mp3'
             : 'webm'
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const view = new Uint8Array(ab)
  return new File([view], `voice.${ext}`, { type })
}

async function transcribeWithWhisper(args: {
  apiKey: string
  model:  string
  audio:  Buffer
  contentType: string | null
}): Promise<{ transcript: string; engine: string }> {
  const { default: OpenAI } = await import('openai').catch(() => {
    throw new Error('OPENAI_API_KEY is set but the openai package is not installed. Run `npm i openai` in apps/worker.')
  })
  const client = new OpenAI({ apiKey: args.apiKey })
  const file = makeAudioFile(args.audio, args.contentType)
  const result = await client.audio.transcriptions.create({
    model: args.model,
    file,
    response_format: 'text',
  })
  // response_format='text' → the SDK returns a plain string.
  const text = typeof result === 'string' ? result : (result as { text?: string }).text ?? ''
  return { transcript: text.trim(), engine: args.model }
}

function buildStubTranscript(note: { sectionRef: string; durationSeconds: number | null; authorId: string; createdAt: Date }): string {
  return [
    STUB_TRANSCRIPT_HEAD,
    `Section: ${note.sectionRef}`,
    `Approximate duration: ${note.durationSeconds ?? 0}s`,
    `Author: ${note.authorId}`,
    `Captured on: ${note.createdAt.toISOString()}`,
  ].join('\n')
}

export const handleVoiceTranscribe: JobHandler<VoiceTranscribePayload> = async (job, { prisma, log }) => {
  const { noteId, blobKey } = job.data

  const note = await prisma.voiceNote.findUnique({ where: { id: noteId } })
  if (!note) {
    log.warn({ noteId }, 'voice note not found — ignoring job')
    return { skipped: 'not_found' }
  }
  if (note.transcriptStatus === 'complete') {
    log.info({ noteId }, 'voice note already transcribed — idempotent return')
    return { skipped: 'already_complete', transcriptLength: note.transcript.length }
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  const useWhisper = !!openaiKey

  let transcript: string
  let engine: string

  if (useWhisper) {
    try {
      const reader = createBlobReaderFromEnv()
      const { bytes, contentType } = await reader.read('voice', blobKey)
      const result = await transcribeWithWhisper({
        apiKey: openaiKey!,
        model:  process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'whisper-1',
        audio:  bytes,
        contentType,
      })
      transcript = result.transcript
      engine     = result.engine
      if (!transcript) {
        // Empty transcript from a silent clip — treat as success but note it,
        // otherwise the UI shows a transcription row with no content.
        transcript = '[Whisper returned an empty transcript — the clip may be silent.]'
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ noteId, err: message }, 'Whisper transcription failed — marking row failed')
      await prisma.voiceNote.update({
        where: { id: noteId },
        data: {
          transcriptStatus: 'failed',
          transcript: `[Transcription failed: ${message}]`,
          transcriptionEngine: 'whisper-error',
        },
      })
      return { noteId, error: message, engine: 'whisper-error' }
    }
  } else {
    transcript = buildStubTranscript(note)
    engine     = 'stub'
  }

  const updated = await prisma.voiceNote.update({
    where: { id: noteId },
    data: {
      transcript,
      transcriptStatus: 'complete',
      transcriptionEngine: engine,
    },
  })

  log.info({ noteId, transcriptLength: transcript.length, engine }, 'voice transcription complete')
  return { noteId: updated.id, transcriptLength: transcript.length, engine }
}
