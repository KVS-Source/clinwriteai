import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { VoiceNote } from '@platform/types'
import { documentsApi } from '../api'

interface Props {
  documentId:  string
  sectionRef:  string  // e.g. "§11.4.1 Progression-Free Survival"
}

type RecordState = 'idle' | 'recording' | 'transcribing' | 'complete'

const CANNED_TRANSCRIPT = 'Consider adding a subgroup analysis reference here — the forest plot for PFS by PD-L1 expression level showed particularly strong separation in the high expressors above 80 percent.'

const RECORDING_DURATION_MS = 3_000
const TRANSCRIBING_DURATION_MS = 500

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
  const [state,        setState]        = useState<RecordState>('idle')
  const [elapsedMs,    setElapsedMs]    = useState(0)
  const [transcript,   setTranscript]   = useState<string | null>(null)
  const [insertToast,  setInsertToast]  = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { data: pastNotes = [] } = useQuery({
    queryKey: ['voice-notes', documentId],
    queryFn:  () => documentsApi.getVoiceNotes(documentId),
    enabled:  !!documentId,
  })

  // Clean up any running timer on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const startRecording = () => {
    if (state !== 'idle' && state !== 'complete') return
    setState('recording')
    setElapsedMs(0)
    setTranscript(null)
    setInsertToast(null)

    const startedAt = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt
      setElapsedMs(elapsed)
      if (elapsed >= RECORDING_DURATION_MS) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        setState('transcribing')
        setTimeout(() => {
          setTranscript(CANNED_TRANSCRIPT)
          setState('complete')
        }, TRANSCRIBING_DURATION_MS)
      }
    }, 100)
  }

  const insertTranscript = async () => {
    if (!transcript) return
    try {
      await documentsApi.addVoiceNote(documentId, {
        sectionRef,
        actorId:   'user-MW',
        actorName: 'Marcus Webb',
        audioRef:  'blob:mock-audio-url',
        transcript,
        duration:  Math.floor(elapsedMs / 1000),
        createdAt: new Date().toISOString(),
      })
      setInsertToast(`Inserted into ${sectionRef.split(' ')[0]}`)
    } catch {
      setInsertToast('Insert failed. Retry.')
    }
  }

  const copyText = () => {
    if (!transcript) return
    navigator.clipboard?.writeText(transcript).catch(() => { /* ignore */ })
    setInsertToast('Copied to clipboard')
  }

  const isRecording = state === 'recording'
  const isTranscribing = state === 'transcribing'
  const timerLabel = formatMMSS(elapsedMs / 1000)

  const shortSectionRef = useMemo(() => sectionRef.split(' ')[0] || sectionRef, [sectionRef])

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4" style={{ gap: 16 }}>

      {/* ===== Record to section ===== */}
      <div className="flex flex-col gap-2.5">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Record to section</p>

        {/* Target section chip */}
        <div
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
          style={{ borderColor: '#E2E8F0', backgroundColor: '#F1F5F9' }}
        >
          <span className="truncate text-xs font-semibold text-slate-900">{sectionRef}</span>
          <button className="flex flex-none text-slate-500 hover:text-slate-700" aria-label="Change section">
            <EditPencilIcon />
          </button>
        </div>

        {/* Record button + label */}
        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={startRecording}
            disabled={isRecording || isTranscribing}
            aria-label={isRecording ? 'Recording…' : 'Tap to record'}
            className="flex h-16 w-16 items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: isRecording ? '#BE123C' : '#E11D48',
              cursor:          (isRecording || isTranscribing) ? 'default' : 'pointer',
              animation:       isRecording ? 'auroraPulse 2s ease-out infinite' : undefined,
            }}
          >
            <MicIcon size={24} colour="#FFFFFF" />
          </button>
          <p className="text-xs text-slate-500">
            {state === 'idle'         && 'Tap to record'}
            {state === 'recording'    && 'Recording…'}
            {state === 'transcribing' && 'Transcribing…'}
            {state === 'complete'     && 'Tap to record again'}
          </p>
        </div>

        {/* Timer */}
        <div className="mt-3 text-center font-mono text-2xl font-bold text-slate-900">
          {timerLabel}
        </div>

        {/* Waveform */}
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
      </div>

      {/* ===== Last transcription (only when complete) ===== */}
      {transcript && (
        <>
          <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />
          <div className="flex flex-col gap-2.5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Last transcription</p>
            <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-3.5">
              <p className="text-[11px] text-slate-500">
                Recorded {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {timerLabel}
              </p>
              <p className="text-[13px] leading-relaxed text-slate-900">{transcript}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={insertTranscript}
                  className="flex-1 rounded-md bg-blue-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  Insert into {shortSectionRef}
                </button>
                <button
                  type="button"
                  onClick={copyText}
                  className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-50"
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
          <span
            className="rounded-full border px-[7px] py-px text-[11px] font-semibold text-slate-600"
            style={{ backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' }}
          >
            {pastNotes.length}
          </span>
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
              className="flex items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-slate-100"
            >
              <span className="flex flex-none text-slate-400"><MicIcon size={12} /></span>
              <span className="flex-1 truncate text-xs text-slate-500">
                Recording · {new Date(note.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {formatMMSS(note.duration)}
              </span>
              <ChevronRightSmall />
            </button>
          ))
        )}
      </div>
    </div>
  )
}
