import { useEffect, useRef, useState } from 'react'

// Browser-only voice notes for the KOL advisory board screen. Nothing here touches the API:
// audio lives in memory as an object URL and disappears when the tab is closed or refreshed.

export interface LocalVoiceNote {
  id:          string
  label:       string
  url:         string        // object URL — owned by the screen once handed over via onSave
  durationSec: number | null
  sizeBytes:   number
  source:      'recorded' | 'uploaded'
  createdAt:   string
}

const MAX_UPLOAD_BYTES  = 25 * 1024 * 1024
const MAX_RECORD_SECONDS = 10 * 60
const ACCENT = '#7C3AED'

export function formatClock(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) return '—:—'
  const s = Math.max(0, Math.round(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

type Phase = 'idle' | 'recording' | 'ready'

interface Preview {
  url:         string
  durationSec: number | null
  sizeBytes:   number
  source:      'recorded' | 'uploaded'
}

const RECORDING_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

export function VoiceNoteRecorder({ onSave }: { onSave: (note: LocalVoiceNote) => void }) {
  const [phase,   setPhase]   = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error,   setError]   = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [label,   setLabel]   = useState('')

  const recorderRef  = useRef<MediaRecorder | null>(null)
  const streamRef    = useRef<MediaStream | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const previewRef   = useRef<Preview | null>(null)   // for cleanup on unmount
  previewRef.current = preview

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }
  const clearTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  // Leaving the panel stops the microphone and frees audio that was never saved.
  useEffect(() => () => {
    clearTimer()
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null
      recorderRef.current.stop()
    }
    releaseMic()
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url)
  }, [])

  const replacePreview = (next: Preview | null) => {
    setPreview(prev => {
      if (prev) URL.revokeObjectURL(prev.url)
      return next
    })
  }

  const start = async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError("This browser can't record audio. Choose an audio file instead.")
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      const name = (e as { name?: string } | null)?.name
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is blocked. Allow it in your browser\'s site settings, or choose an audio file instead.'
          : name === 'NotFoundError'
            ? 'No microphone was found. Connect one, or choose an audio file instead.'
            : 'Could not start the microphone. Try again, or choose an audio file instead.',
      )
      return
    }
    streamRef.current = stream

    const mime = RECORDING_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunksRef.current = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = () => {
      const type = recorder.mimeType || mime || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      releaseMic()
      clearTimer()
      if (blob.size === 0) {
        setPhase('idle')
        setError('Nothing was recorded. Try again.')
        return
      }
      replacePreview({
        url: URL.createObjectURL(blob),
        durationSec: (Date.now() - startedAtRef.current) / 1000,
        sizeBytes: blob.size,
        source: 'recorded',
      })
      setLabel(l => l || 'Voice note')
      setPhase('ready')
    }
    recorderRef.current = recorder
    startedAtRef.current = Date.now()
    setElapsed(0)
    recorder.start()
    setPhase('recording')
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setElapsed(secs)
      if (secs >= MAX_RECORD_SECONDS) stop()
    }, 250)
  }

  const stop = () => {
    const r = recorderRef.current
    if (r && r.state !== 'inactive') r.stop()
  }

  const onFile = (file: File | undefined) => {
    setError(null)
    if (!file) return
    if (!file.type.startsWith('audio/')) {
      setError('That file is not audio. Choose an MP3, WAV, M4A or WebM file.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is too large (${formatSize(file.size)}). The limit is ${formatSize(MAX_UPLOAD_BYTES)}.`)
      return
    }
    const url = URL.createObjectURL(file)
    const probe = new Audio(url)
    const next: Preview = { url, durationSec: null, sizeBytes: file.size, source: 'uploaded' }
    probe.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(probe.duration)) {
        setPreview(p => (p && p.url === url ? { ...p, durationSec: probe.duration } : p))
      }
    })
    replacePreview(next)
    setLabel(file.name.replace(/\.[^.]+$/, '') || 'Voice note')
    setPhase('ready')
  }

  const discard = () => {
    replacePreview(null)
    setLabel('')
    setPhase('idle')
    setError(null)
  }

  const save = () => {
    if (!preview) return
    onSave({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim() || 'Voice note',
      url: preview.url,
      durationSec: preview.durationSec,
      sizeBytes: preview.sizeBytes,
      source: preview.source,
      createdAt: new Date().toISOString(),
    })
    // Ownership of the object URL moves to the screen — don't revoke it here.
    previewRef.current = null
    setPreview(null)
    setLabel('')
    setPhase('idle')
  }

  return (
    <div className="flex flex-col gap-4 p-5" data-voice-recorder>
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900" data-voice-local-notice>
        <span className="font-semibold">Not saved to the server.</span> Voice notes stay in this browser tab only, are not
        transcribed, and are lost when you refresh or close the page.
      </p>

      {phase === 'idle' && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={start}
            data-voice-start
            className="flex h-10 items-center justify-center gap-2 rounded-md px-4 text-[13px] font-semibold text-white"
            style={{ backgroundColor: ACCENT }}
          >
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-white" />
            Start recording
          </button>
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest text-slate-400" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" />
          </div>
          <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            Choose an audio file
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              data-voice-file
              onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }}
            />
          </label>
          <p className="text-[11px] text-slate-500">MP3, WAV, M4A or WebM, up to {formatSize(MAX_UPLOAD_BYTES)}.</p>
        </div>
      )}

      {phase === 'recording' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-5" role="status" data-voice-recording>
          <span className="flex items-center gap-2 text-[13px] font-semibold text-red-700">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
            Recording
          </span>
          <span className="font-mono text-[28px] font-bold text-slate-900">{formatClock(elapsed)}</span>
          <button
            type="button"
            onClick={stop}
            data-voice-stop
            className="h-9 rounded-md bg-red-700 px-5 text-[13px] font-semibold text-white"
          >Stop</button>
          <p className="text-[11px] text-slate-500">Stops automatically at {formatClock(MAX_RECORD_SECONDS)}.</p>
        </div>
      )}

      {phase === 'ready' && preview && (
        <div className="flex flex-col gap-3" data-voice-ready>
          <audio controls src={preview.url} className="w-full" />
          <p className="font-mono text-[11px] text-slate-500">
            {preview.source === 'recorded' ? 'Recorded' : 'Uploaded'} · {formatClock(preview.durationSec)} · {formatSize(preview.sizeBytes)}
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Name</span>
            <input
              type="text"
              value={label}
              maxLength={80}
              onChange={e => setLabel(e.target.value)}
              data-voice-label
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px] outline-none focus:border-violet-500"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={discard}
              className="h-9 rounded-md border border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >Discard</button>
            <button
              type="button"
              onClick={save}
              data-voice-save
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: ACCENT }}
            >Add to session</button>
          </div>
        </div>
      )}

      {error && <p className="text-[12px] font-semibold text-red-700" role="alert" data-voice-error>{error}</p>}
    </div>
  )
}
