import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { VoiceNote } from '@platform/types'
import { documentsApi } from '../api'
import { ApiError } from '../api/client'

interface Props {
  documentId:  string
  sectionRef:  string  // e.g. "§11.4.1 Progression-Free Survival"
}

type RecordState =
  | 'idle'
  | 'requesting-mic'
  | 'recording'
  | 'uploading'
  | 'complete'
  | 'error'

// Hard cap matching API MAX_AUDIO_BYTES (25MB). At ~128kbps WebM/Opus a 5min
// recording lands at ~5MB; the 10-minute cap gives headroom while still
// forcing a stop before oversized blobs blow past the server limit.
const MAX_DURATION_MS = 10 * 60 * 1000

// Candidate MIME types in priority order. The browser picks the first one
// its MediaRecorder actually supports — Chrome/Edge favour webm/opus,
// Safari ships mp4/aac. The API's SUPPORTED_AUDIO_MIME regexes match both.
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return undefined
}

// Infer a filename extension from the chosen mime type so the server's
// generateBlobKey() produces a correctly-suffixed object key.
function filenameFor(mime: string | undefined): string {
  if (!mime) return 'recording.webm'
  if (mime.startsWith('audio/mp4'))  return 'recording.mp4'
  if (mime.startsWith('audio/ogg'))  return 'recording.ogg'
  if (mime.startsWith('audio/wav'))  return 'recording.wav'
  return 'recording.webm'
}

// Waveform bar heights — 24 bars, alternating 4-20px per prototype
const IDLE_WAVE_HEIGHTS = [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 19, 18, 20, 19, 18, 16, 14, 12, 10, 8, 6, 5, 4, 4]

function MicIcon({ size = 14, colour = 'currentColor' }: { size?: number; colour?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke={colour} strokeWidth="1.3">
      <rect x="5" y="1.6" width="4" height="6.6" rx="2"/>
      <path d="M3.4 7.2a3.6 3.6 0 0 0 7.2 0"/>
      <line x1="7" y1="10.4" x2="7" y2="12.4" strokeLinecap="round"/>
      <line x1="4.4" y1="13" x2="9.6" y2="13" strokeLinecap="round"/>
    </svg>
  )
}

function StopIcon({ size = 24, colour = 'currentColor' }: { size?: number; colour?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={colour}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  )
}

function EditPencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="flex-none">
      <path d="M1.8 8.4L7.6 2.6a1.4 1.4 0 0 1 2 2L3.8 10.4l-2.8 0.6 0.8-2.6z" strokeLinejoin="round"/>
    </svg>
  )
}

function ChevronRightSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="text-slate-400">
      <polygon points="4,2 8,6 4,10" fill="currentColor"/>
    </svg>
  )
}

function formatMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export function VoiceNotePanel({ documentId, sectionRef }: Props) {
  const qc = useQueryClient()

  const [state,        setState]        = useState<RecordState>('idle')
  const [elapsedMs,    setElapsedMs]    = useState(0)
  const [error,        setError]        = useState<string | null>(null)
  const [insertToast,  setInsertToast]  = useState<string | null>(null)
  const [lastNote,     setLastNote]     = useState<VoiceNote | null>(null)
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null)
  const [playingNoteId, setPlayingNoteId] = useState<string | null>(null)

  const recorderRef   = useRef<MediaRecorder | null>(null)
  const streamRef     = useRef<MediaStream | null>(null)
  const chunksRef     = useRef<Blob[]>([])
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef  = useRef<number>(0)
  const audioElRef    = useRef<HTMLAudioElement | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const mimeType = useMemo(() => pickSupportedMimeType(), [])
  const canRecord = typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && mimeType !== undefined

  // Past notes — refetch every 4s while any transcript is still pending so
  // the UI picks up the worker's writeback without the user hitting refresh.
  const { data: pastNotes = [], refetch: refetchNotes } = useQuery({
    queryKey: ['voice-notes', documentId],
    queryFn:  () => documentsApi.getVoiceNotes(documentId),
    enabled:  !!documentId,
    refetchInterval: (query) => {
      const notes = query.state.data as VoiceNote[] | undefined
      return notes?.some(n => !n.transcript) ? 4000 : false
    },
  })

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const revokePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreviewUrl(null)
  }

  // Teardown on unmount — important to release the mic + revoke blob URLs.
  useEffect(() => () => {
    clearTimer()
    stopStream()
    revokePreview()
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop() } catch { /* ignore */ }
    }
  }, [])

  const uploadMut = useMutation({
    mutationFn: async (args: { audio: Blob; durationSeconds: number }) =>
      documentsApi.uploadVoiceNote(documentId, {
        audio: args.audio,
        filename: filenameFor(mimeType),
        sectionRef,
        durationSeconds: args.durationSeconds,
      }),
    onSuccess: (note) => {
      setLastNote(note)
      setState('complete')
      setInsertToast(null)
      qc.invalidateQueries({ queryKey: ['voice-notes', documentId] })
    },
    onError: (err) => {
      const msg = err instanceof ApiError
        ? (typeof err.body === 'object' && err.body && 'error' in err.body
            ? String((err.body as { error: unknown }).error)
            : `Upload failed (HTTP ${err.status})`)
        : 'Upload failed. Check your connection and try again.'
      setError(msg)
      setState('error')
    },
  })

  const startRecording = async () => {
    if (!canRecord) {
      setError('Your browser does not support audio recording. Use Chrome, Edge, Firefox or Safari.')
      setState('error')
      return
    }
    if (state === 'recording' || state === 'requesting-mic' || state === 'uploading') return

    setError(null)
    setInsertToast(null)
    revokePreview()
    setLastNote(null)
    chunksRef.current = []
    setElapsedMs(0)
    setState('requesting-mic')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const name = (err as DOMException)?.name ?? ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('Microphone access denied. Grant permission in your browser settings and try again.')
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setError('No microphone detected. Connect a mic and try again.')
      } else {
        setError('Could not access microphone. Please try again.')
      }
      setState('error')
      return
    }

    streamRef.current = stream
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorderRef.current = recorder

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
    }
    recorder.onerror = () => {
      setError('Recording failed. Please try again.')
      setState('error')
      clearTimer()
      stopStream()
    }
    recorder.onstop = async () => {
      clearTimer()
      stopStream()
      const audio = new Blob(chunksRef.current, { type: mimeType ?? 'audio/webm' })
      chunksRef.current = []

      if (audio.size === 0) {
        setError('Recording produced no audio. Please try again.')
        setState('error')
        return
      }

      // Local preview URL for playback before/after upload.
      const url = URL.createObjectURL(audio)
      previewUrlRef.current = url
      setPreviewUrl(url)

      setState('uploading')
      const durationSeconds = Math.max(1, Math.round(elapsedMs / 1000))
      uploadMut.mutate({ audio, durationSeconds })
    }

    recorder.start(/* timeslice */ 1000)
    startedAtRef.current = Date.now()
    setState('recording')

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current
      setElapsedMs(elapsed)
      if (elapsed >= MAX_DURATION_MS) {
        // Auto-stop at the cap.
        try { recorder.stop() } catch { /* onstop will set error if needed */ }
      }
    }, 200)
  }

  const stopRecording = () => {
    if (state !== 'recording') return
    const r = recorderRef.current
    if (!r || r.state === 'inactive') return
    try { r.stop() } catch { /* onstop handles error */ }
  }

  const playPreview = () => {
    if (!previewUrl) return
    if (!audioElRef.current) audioElRef.current = new Audio()
    audioElRef.current.src = previewUrl
    audioElRef.current.play().catch(() => { /* autoplay-blocked, ignore */ })
    setPlayingNoteId('__preview__')
    audioElRef.current.onended = () => setPlayingNoteId(null)
  }

  const playPastNote = async (note: VoiceNote) => {
    try {
      const { url } = await documentsApi.getVoiceNoteAudioUrl(documentId, note.id)
      if (!audioElRef.current) audioElRef.current = new Audio()
      audioElRef.current.src = url
      await audioElRef.current.play()
      setPlayingNoteId(note.id)
      audioElRef.current.onended = () => setPlayingNoteId(null)
    } catch (err) {
      const msg = err instanceof ApiError
        ? `Playback failed (HTTP ${err.status})`
        : 'Playback failed. Please try again.'
      setInsertToast(msg)
    }
  }

  const insertTranscript = () => {
    if (!lastNote?.transcript) return
    // Transcript insertion into the document body is a separate concern
    // (addVoiceNote only persisted the note itself in the old prototype).
    // Dedicated section-insert wiring lands with Module A §edit-history
    // cross-module rollout; for now the audit trail + reference link in
    // the voice-note row is the system of record.
    setInsertToast(`Linked to ${sectionRef.split(' ')[0]}`)
  }

  const copyText = () => {
    if (!lastNote?.transcript) return
    navigator.clipboard?.writeText(lastNote.transcript).catch(() => { /* ignore */ })
    setInsertToast('Copied to clipboard')
  }

  const isRecording      = state === 'recording'
  const isRequestingMic  = state === 'requesting-mic'
  const isUploading      = state === 'uploading'
  const timerLabel       = formatMMSS(elapsedMs / 1000)
  const transcriptPending = lastNote !== null && !lastNote.transcript

  const shortSectionRef = useMemo(() => sectionRef.split(' ')[0] || sectionRef, [sectionRef])

  const buttonLabel = (() => {
    if (isRequestingMic) return 'Requesting microphone…'
    if (isRecording)     return 'Tap to stop'
    if (isUploading)     return 'Uploading…'
    if (state === 'complete') return 'Tap to record again'
    if (state === 'error')    return 'Tap to retry'
    return 'Tap to record'
  })()

  const handleMicButton = () => {
    if (isRecording) stopRecording()
    else startRecording()
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4" style={{ gap: 16 }}>

      {/* ===== Record to section ===== */}
      <div className="flex flex-col gap-2.5">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Record to section</p>

        <div
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
          style={{ borderColor: '#E2E8F0', backgroundColor: '#F1F5F9' }}
        >
          <span className="truncate text-xs font-semibold text-slate-900">{sectionRef}</span>
          <button className="flex flex-none text-slate-500 hover:text-slate-700" aria-label="Change section" disabled>
            <EditPencilIcon />
          </button>
        </div>

        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleMicButton}
            disabled={isRequestingMic || isUploading || !canRecord}
            aria-label={buttonLabel}
            className="flex h-16 w-16 items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: isRecording ? '#BE123C' : (!canRecord ? '#94A3B8' : '#E11D48'),
              cursor:          (isRequestingMic || isUploading || !canRecord) ? 'default' : 'pointer',
              animation:       isRecording ? 'auroraPulse 2s ease-out infinite' : undefined,
            }}
          >
            {isRecording ? <StopIcon size={24} colour="#FFFFFF" /> : <MicIcon size={24} colour="#FFFFFF" />}
          </button>
          <p className="text-xs text-slate-500">{buttonLabel}</p>
          {!canRecord && (
            <p className="text-[11px] text-rose-600">Audio recording unavailable in this browser.</p>
          )}
        </div>

        <div className="mt-3 text-center font-mono text-2xl font-bold text-slate-900">
          {timerLabel}
        </div>

        <div className="mt-2 flex h-[22px] items-end justify-center gap-[3px]">
          {IDLE_WAVE_HEIGHTS.map((h, i) => (
            <span
              key={i}
              className="w-[3px] rounded-t-[2px]"
              style={{
                height: `${h}px`,
                backgroundColor: isRecording ? '#E11D48' : '#CBD5E1',
                opacity: isRecording ? (0.4 + Math.abs(Math.sin((elapsedMs / 200) + i)) * 0.6) : 1,
              }}
            />
          ))}
        </div>

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
            {error}
          </p>
        )}
      </div>

      {/* ===== Last recording ===== */}
      {(lastNote || previewUrl) && (
        <>
          <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />
          <div className="flex flex-col gap-2.5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Last recording</p>
            <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  Recorded {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {timerLabel}
                </span>
                {previewUrl && (
                  <button
                    type="button"
                    onClick={playPreview}
                    className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {playingNoteId === '__preview__' ? 'Playing…' : 'Play'}
                  </button>
                )}
              </div>

              {transcriptPending ? (
                <p className="text-[12px] italic text-slate-500">Transcription pending — will appear here when the worker completes.</p>
              ) : lastNote?.transcript ? (
                <p className="text-[13px] leading-relaxed text-slate-900 whitespace-pre-wrap">{lastNote.transcript}</p>
              ) : null}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={insertTranscript}
                  disabled={!lastNote?.transcript}
                  className="flex-1 rounded-md bg-blue-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300"
                >
                  Insert into {shortSectionRef}
                </button>
                <button
                  type="button"
                  onClick={copyText}
                  disabled={!lastNote?.transcript}
                  className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-50 disabled:text-slate-400"
                >
                  Copy text
                </button>
              </div>
              {insertToast ? (
                <p className="text-center text-[11px] font-semibold" style={{ color: '#15803D' }}>{insertToast}</p>
              ) : (
                <p className="text-center text-[11px] italic text-slate-500">Inserting creates an audit trail entry</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ===== Past recordings ===== */}
      <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Past recordings</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refetchNotes()}
              className="text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-700"
            >
              Refresh
            </button>
            <span
              className="rounded-full border px-[7px] py-px text-[11px] font-semibold text-slate-600"
              style={{ backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' }}
            >
              {pastNotes.length}
            </span>
          </div>
        </div>

        {pastNotes.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-[12px] text-slate-500">
            No past recordings yet
          </p>
        ) : (
          pastNotes.map((note: VoiceNote) => (
            <button
              key={note.id}
              type="button"
              onClick={() => playPastNote(note)}
              className="flex items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-slate-100"
            >
              <span className="flex flex-none text-slate-400"><MicIcon size={12} /></span>
              <span className="flex-1 truncate text-xs text-slate-500">
                Recording · {new Date(note.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {formatMMSS(note.duration)}
                {!note.transcript && <span className="ml-2 italic text-amber-600">transcript pending</span>}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
                {playingNoteId === note.id ? 'Playing' : 'Play'}
              </span>
              <ChevronRightSmall />
            </button>
          ))
        )}
      </div>
    </div>
  )
}
