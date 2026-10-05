// Voice note routes — Module A (API contract §7).
//
//   GET  /documents/:documentId/voice-notes
//   POST /documents/:documentId/voice-notes          (multipart audio upload)
//   GET  /documents/:documentId/voice-notes/:noteId/audio   (presigned download URL)
//   POST /documents/:documentId/voice-notes/:noteId/transcript
//           (writeback from transcription worker — not shipped yet)
//
// Audio bytes go to the BlobStorage 'voice' bucket. Transcription is a
// stub for now: when the Anthropic audio API (or Whisper) lands, a
// worker will process `transcriptStatus=pending` rows and populate the
// transcript field.

import type { FastifyPluginAsync } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { generateBlobKey } from '../../../modules/platform/blob/local-storage.js'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024   // 25 MB — ~5min of mp3

const SUPPORTED_AUDIO_MIME: ReadonlyArray<RegExp> = [
  /^audio\/mpeg$/,
  /^audio\/mp4$/,
  /^audio\/webm$/,
  /^audio\/wav$/,
  /^audio\/x-wav$/,
  /^audio\/ogg$/,
]

const uploadQuerySchema = z.object({
  sectionRef: z.string().min(1),
  durationSeconds: z.coerce.number().int().positive().optional(),
})

export const voiceNotesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:documentId/voice-notes', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.voiceNote.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    })
  })

  app.post('/:documentId/voice-notes', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    // sectionRef + optional durationSeconds come as query params so the
    // multipart body can be pure audio (simplifies client code).
    const parsed = uploadQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const file: MultipartFile | undefined = await request.file().catch(() => undefined)
    if (!file) return reply.code(400).send({ error: 'no_file' })

    const buf = await file.toBuffer()
    if (buf.length > MAX_AUDIO_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: `Audio > ${MAX_AUDIO_BYTES / 1024 / 1024}MB` })
    }
    if (!SUPPORTED_AUDIO_MIME.some(r => r.test(file.mimetype))) {
      return reply.code(400).send({ error: 'unsupported_mime', mimetype: file.mimetype })
    }

    const ext = file.mimetype.split('/')[1]?.split(';')[0] ?? 'bin'
    const blobKey = generateBlobKey(`${documentId}/voice-notes`, ext)
    await app.blob.put({
      bucket: 'voice',
      key: blobKey,
      body: buf,
      contentType: file.mimetype,
      metadata: {
        documentId,
        sectionRef: parsed.data.sectionRef,
        authorId: request.user!.id,
      },
    })

    const note = await app.prisma.voiceNote.create({
      data: {
        documentId,
        sectionRef: parsed.data.sectionRef,
        authorId: request.user!.id,
        audioBlobKey: blobKey,
        audioRegion: process.env.S3_REGION ?? 'us-east-1',
        durationSeconds: parsed.data.durationSeconds ?? null,
        transcriptStatus: 'pending',
      },
    })

    // Enqueue the transcription job. Worker lives in apps/worker and
    // currently writes a deterministic stub transcript — swap to Whisper /
    // Anthropic audio when the provider lands (handler shape stays the same).
    try {
      await app.queue.enqueue('clinical.voice_transcribe', {
        noteId: note.id,
        documentId,
        blobKey,
        actorId: request.user!.id,
      }, { jobId: `voice-transcribe-${note.id}` })
    } catch (err) {
      // Fire-and-forget semantics: Redis down shouldn't 500 the upload.
      // transcriptStatus=pending stays and can be retried later.
      app.log.warn({ err, noteId: note.id }, 'voice transcription enqueue failed — note remains pending')
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'voice_note_added',
      entityType: 'document',
      entityId: documentId,
      details: {
        noteId: note.id,
        sectionRef: parsed.data.sectionRef,
        sizeBytes: buf.length,
        mimetype: file.mimetype,
        durationSeconds: parsed.data.durationSeconds ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(note)
  })

  // Return a short-lived presigned download URL. Clients call this once per
  // playback — never embed the URL in long-lived storage.
  app.get('/:documentId/voice-notes/:noteId/audio', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, noteId } = request.params as { documentId: string; noteId: string }
    const note = await app.prisma.voiceNote.findFirst({ where: { id: noteId, documentId } })
    if (!note) return reply.code(404).send({ error: 'not_found' })

    const url = await app.blob.presignDownload('voice', note.audioBlobKey, { expiresInSeconds: 300 })
    return { url, expiresInSeconds: 300 }
  })
}
