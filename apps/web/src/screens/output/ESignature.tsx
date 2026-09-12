import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { SignatureMeaning, SignatureRecord } from '@platform/types'
import { documentsApi } from '../../api'

// Signer avatar palette (matches Pattern 7)
const AVATAR_COLOURS: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' },
  EV: { bg: '#FEF3C7', fg: '#D97706' },
  PN: { bg: '#FEE2E2', fg: '#DC2626' },
  AH: { bg: '#E0F2FE', fg: '#0369A1' },
  RT: { bg: '#FCE7F3', fg: '#9D174D' },
  LP: { bg: '#F3F4F6', fg: '#374151' },
}

type RowState = 'signed' | 'you' | 'queued'

// Meaning-of-signature options for the isYou signing form
const MEANING_OPTIONS: { value: SignatureMeaning; title: string; sub: string }[] = [
  { value: 'authored', title: 'I have authored this document',              sub: 'Author sign-off' },
  { value: 'reviewed', title: 'I have reviewed this document',              sub: 'Reviewer sign-off' },
  { value: 'approved', title: 'I approve this document for submission',     sub: 'Approver sign-off' },
]

// Long role/description mapping (for the panel avatar row)
const ROLE_LONG: Record<string, string> = {
  'PV Lead':              'PV Lead · Consulted',
  'Lead Clinical Writer': 'Lead Clinical Writer · Responsible',
  'Regulatory Affairs':   'Regulatory Affairs · Consulted',
  'Clinical PM':          'Clinical PM / Lead · Accountable',
}

// --- Icons ---

function LockIcon({ colour = '#2563EB', size = 20 }: { colour?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={colour} strokeWidth="1.5" className="flex-none">
      <rect x="4" y="8.6" width="12" height="8.4" rx="1.6"/>
      <path d="M6.8 8.6V6.4a3.2 3.2 0 0 1 6.4 0v2.2"/>
      <circle cx="10" cy="12.6" r="1.1" fill={colour}/>
    </svg>
  )
}

function Avatar({ initials, size = 24 }: { initials: string; size?: number }) {
  const c = AVATAR_COLOURS[initials] ?? AVATAR_COLOURS.MW
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
      style={{
        width: size, height: size,
        backgroundColor: c.bg, color: c.fg,
        fontSize: size >= 24 ? 12 : 10,
      }}
    >
      {initials}
    </div>
  )
}

function StatePill({ state }: { state: RowState }) {
  const map = {
    signed: { label: 'Signed ✓',              bg: '#F0FDF4', fg: '#15803D', border: '1px solid #BBF7D0' },
    you:    { label: 'Awaiting your signature', bg: '#EFF6FF', fg: '#2563EB', border: 'none' },
    queued: { label: 'Queued',                bg: '#F8FAFC', fg: '#64748B', border: '1px solid #E2E8F0' },
  }[state]
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ backgroundColor: map.bg, color: map.fg, border: map.border }}
    >
      {map.label}
    </span>
  )
}

function MonoLabel({ children, color = '#64748B' }: { children: React.ReactNode; color?: string }) {
  return (
    <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color }}>
      {children}
    </p>
  )
}

function KVRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5" style={{ borderColor: '#F1F5F9' }}>
      <span className="flex-none text-xs text-slate-500">{label}</span>
      <span
        className="min-w-0 break-all text-right"
        style={mono ? { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#1E293B', fontWeight: 500 } : { fontSize: 12, fontWeight: 600, color: '#1E293B' }}
      >
        {value}
      </span>
    </div>
  )
}

// --- Signer row ---

interface RowProps {
  index:     number
  step:      string
  record:    SignatureRecord
  state:     RowState
  isSelected: boolean
  onSelect:  () => void
}

function SignerRow({ step, record, state, isSelected, onSelect }: RowProps) {
  const baseStyle: React.CSSProperties =
    state === 'signed'
      ? { border: '1px solid #BBF7D0', borderLeft: '4px solid #16A34A', backgroundColor: '#F0FDF4' }
      : state === 'you'
      ? { border: '2px solid #2563EB', backgroundColor: '#FFFFFF', boxShadow: '0 0 0 3px rgba(37,99,235,0.10)' }
      : { border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', opacity: 0.6 }

  const meaningText =
    state === 'signed'
      ? `I have ${record.meaning === 'approved' ? 'approved' : record.meaning} this document`
      : state === 'you'
      ? 'I have authored this document'
      : record.meaning === 'reviewed' ? 'I have reviewed this document'
      : record.meaning === 'approved' ? 'I approve this document for submission'
      : 'I have authored this document'

  const meta =
    state === 'signed'
      ? `${new Date(record.timestamp!).toUTCString().slice(5, 22)} UTC · SHA-256 verified`
      : state === 'you'
      ? 'Signing panel is open at right — complete to release the next signature.'
      : 'Notified once the preceding signature is recorded.'

  const metaColour = state === 'you' ? '#2563EB' : '#64748B'

  return (
    <button
      type="button"
      onClick={onSelect}
      data-signer-id={record.id}
      data-state={state}
      data-selected={isSelected || undefined}
      className="flex items-center gap-3 rounded-lg p-3.5 text-left transition-colors"
      style={baseStyle}
    >
      {/* Step badge */}
      <div
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md font-mono text-[13px] font-bold"
        style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
      >
        {step}
      </div>

      {/* Avatar */}
      <Avatar initials={record.initials} size={28} />

      {/* Main text block */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-bold">{record.signer}</p>
          <p className="whitespace-nowrap font-mono text-[9px] tracking-wider text-slate-500">
            {record.role.toUpperCase()}
          </p>
        </div>
        <p className="text-xs text-slate-500">{meaningText}</p>
        <p className="text-[11px]" style={{ color: metaColour }}>{meta}</p>
      </div>

      {/* Status pill */}
      <StatePill state={state} />
    </button>
  )
}

// --- Panel body: signed ---

function SignedPanel({ record }: { record: SignatureRecord }) {
  const meaningText = record.meaning === 'authored' ? 'I have authored this document'
    : record.meaning === 'approved' ? 'I approve this document for submission'
    : 'I have reviewed this document'

  return (
    <div className="flex flex-col gap-4">
      {/* Meaning of signature card */}
      <div className="rounded-lg p-3 pl-3.5" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
        <MonoLabel color="#15803D">Meaning of signature</MonoLabel>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: '#15803D' }}>{meaningText}</p>
      </div>

      {/* Signature record */}
      <div>
        <MonoLabel>Signature record</MonoLabel>
        <div className="mt-1.5">
          <KVRow label="Signature ID"       value={record.id}                                mono />
          <KVRow label="Recorded"           value={record.timestamp ?? '—'}                  mono />
          <KVRow label="Signer local time"  value="16:32 CET (Amsterdam)" />
          <KVRow label="Time source"        value="ClinWrite.AI time server · NTP stratum 2" />
          <KVRow label="Authentication"     value={record.authMethod ?? '—'} />
          <KVRow label="Document hash signed" value={record.documentHash ?? '—'}             mono />
          <KVRow label="Version at signing" value={record.version_at_signing ?? '—'} />
          <KVRow label="Scope locked"       value="§12 Safety Evaluation, §16.2" />
          <KVRow label="Audit entry"        value="AUD-10228"                                mono />
          <KVRow label="Device"             value="Firefox 131 · Windows 11" />
          <KVRow label="Network"            value="10.42.7.94 · GenBioCa VPN"                mono />
        </div>
      </div>

      {/* Immutability note */}
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5" style={{ backgroundColor: '#F8FAFC' }}>
        <span className="mt-0.5"><LockIcon colour="#94A3B8" size={12} /></span>
        <p className="text-[12px] italic leading-relaxed text-slate-500">
          Signature manifest is immutable. Any later edit to the document voids this signature and restarts the chain.
        </p>
      </div>
    </div>
  )
}

// --- Panel body: queued ---

function QueuedPanel({ record, previousSigner }: { record: SignatureRecord; previousSigner?: SignatureRecord }) {
  const meaningText = record.meaning === 'reviewed' ? 'I have reviewed this document'
    : record.meaning === 'approved' ? 'I approve this document for submission'
    : 'I have authored this document'

  const waitingOn = previousSigner ? `Step ${previousSigner.step} · ${previousSigner.signer}` : '—'

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200 p-3 pl-3.5" style={{ backgroundColor: '#F8FAFC' }}>
        <MonoLabel>Meaning required at signing</MonoLabel>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-900">{meaningText}</p>
      </div>

      <div>
        <MonoLabel>Pending signature</MonoLabel>
        <div className="mt-1.5">
          <KVRow label="Waiting on"              value={waitingOn} />
          <KVRow label="Notification"            value="Queued — email on release" />
          <KVRow label="Due"                     value={record.step === 3 ? '30 Oct 2024 17:00 UTC' : '31 Oct 2024 17:00 UTC'} />
          <KVRow label="Authentication required" value="Password + TOTP" />
          <KVRow label="Delegation"              value="Not permitted — Part 11" />
          <KVRow label="RACI source"             value={record.step === 3 ? 'RACI-VEL301-C3' : 'RACI-VEL301-A1'} mono />
        </div>
      </div>

      <div className="flex gap-2">
        <button className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 transition-colors">
          Send reminder
        </button>
        <button className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 transition-colors">
          View RACI
        </button>
      </div>

      <p className="text-[11px] italic leading-relaxed text-slate-500">
        This signatory is notified automatically once the preceding signature is recorded.
      </p>
    </div>
  )
}

// --- Panel body: you (signing form) ---

interface YouPanelProps {
  record:       SignatureRecord
  meaning:      SignatureMeaning | null
  credential:   string
  onMeaning:    (m: SignatureMeaning) => void
  onCredential: (v: string) => void
}

function YouPanel({ record, meaning, credential, onMeaning, onCredential }: YouPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] leading-relaxed text-slate-500">
        21 CFR Part 11 · Annex 11 compliant — this signature is legally binding and cannot be edited once recorded.
      </p>

      {/* Meaning cards */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-bold">Meaning of signature</p>
          <MonoLabel>REQUIRED</MonoLabel>
        </div>
        {MEANING_OPTIONS.map(opt => {
          const isSelected = meaning === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onMeaning(opt.value)}
              data-meaning={opt.value}
              data-selected={isSelected || undefined}
              className="relative flex flex-col gap-1 rounded-lg p-3 text-left transition-colors"
              style={isSelected ? {
                border: '2px solid #2563EB',
                backgroundColor: '#EFF6FF',
              } : {
                border: '1px solid #E2E8F0',
                backgroundColor: '#FFFFFF',
              }}
            >
              <p className="text-[13px] font-bold" style={{ color: isSelected ? '#1D4ED8' : '#1E293B' }}>{opt.title}</p>
              <MonoLabel>{opt.sub}</MonoLabel>
              {isSelected && (
                <div className="absolute right-3 top-2.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold text-white" style={{ backgroundColor: '#2563EB' }}>
                  ✓
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Credential re-entry */}
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-bold">Confirm your identity</p>
        <div className="flex items-center gap-2">
          <LockIcon colour="#94A3B8" size={12} />
          <p className="truncate text-[13px] text-slate-500">marcus.webb@genbioca.com</p>
        </div>
        <label htmlFor="sig-pw" className="text-xs font-semibold text-slate-500">ClinWrite.AI password</label>
        <input
          id="sig-pw"
          type="password"
          value={credential}
          onChange={e => onCredential(e.target.value)}
          placeholder="Re-enter password"
          className="h-10 rounded-md border px-3 text-sm outline-none focus:border-blue-600 focus:shadow-focus"
          style={{ borderColor: '#E2E8F0', letterSpacing: '0.14em' }}
        />
        <p className="text-[11px] italic text-slate-500">Re-enter credentials each time — signatures cannot be delegated.</p>
      </div>

      {/* Signature manifest preview */}
      <div>
        <MonoLabel>What this signature will record</MonoLabel>
        <div className="mt-1.5">
          <KVRow label="Timestamp"    value={new Date().toUTCString().slice(5, 22) + ' UTC'} mono />
          <KVRow label="Time source"  value="ClinWrite.AI time server · NTP stratum 2" />
          <KVRow label="Document hash" value={record.documentHash ?? '3a9f…c4d2'}          mono />
          <KVRow label="Version"      value="v0.4 → v1.0 on final signature" />
          <KVRow label="Scope locked" value="§1–§16 at time of signing" />
          <KVRow label="Device"       value="Chrome 129 · macOS 15.0" />
        </div>
      </div>
    </div>
  )
}

// --- Main screen ---

export function ESignature() {
  const { projectId, documentId } = useParams()
  const navigate                  = useNavigate()
  const qc                        = useQueryClient()

  const { data: chain = [] } = useQuery({
    queryKey: ['signature-chain', documentId],
    queryFn:  () => documentsApi.getSignatureChain(documentId!),
    enabled:  !!documentId,
  })

  // Local overrides so signing MW visibly promotes MW→signed and EV→awaiting
  const [signedOverrides, setSignedOverrides] = useState<string[]>([])
  const [selectedIndex,   setSelectedIndex]   = useState<number | null>(null)
  const [meaning,         setMeaning]         = useState<SignatureMeaning | null>(null)
  const [credential,      setCredential]      = useState('')

  // Compute effective state per signer
  const derivedStates: RowState[] = useMemo(() => {
    return chain.map((sig, i) => {
      if (sig.status === 'signed' || signedOverrides.includes(sig.id)) return 'signed'
      const previousAllSigned = chain.slice(0, i).every(prev => prev.status === 'signed' || signedOverrides.includes(prev.id))
      return previousAllSigned ? 'you' : 'queued'
    })
  }, [chain, signedOverrides])

  const currentSignerIndex = derivedStates.indexOf('you')

  // Default selection to the current-user "you" row
  useEffect(() => {
    if (selectedIndex === null && currentSignerIndex >= 0) {
      setSelectedIndex(currentSignerIndex)
      // Pre-seed meaning from that signer's meaning
      const s = chain[currentSignerIndex]
      if (s) setMeaning(s.meaning)
    }
  }, [chain, currentSignerIndex, selectedIndex])

  const signedCount = derivedStates.filter(s => s === 'signed').length
  const totalCount  = chain.length
  const progressPct = totalCount > 0 ? Math.round((signedCount / totalCount) * 100) : 0

  const signMut = useMutation({
    mutationFn: (args: { m: SignatureMeaning; cred: string }) => {
      const credentialHash = args.cred.length > 0 ? `sha256-mock-${args.cred.length}` : ''
      return documentsApi.sign(documentId!, {
        meaning:        args.m,
        credentialHash,
        scope:          [],
      })
    },
    onSuccess: () => {
      // Promote the current "you" signer to signed
      if (currentSignerIndex >= 0) {
        const cur = chain[currentSignerIndex]
        setSignedOverrides(prev => [...prev, cur.id])
      }
      setMeaning(null)
      setCredential('')
      qc.invalidateQueries({ queryKey: ['signature-chain', documentId] })
      // If final signature → document now 'signed' — invalidate document too
      qc.invalidateQueries({ queryKey: ['document', documentId] })
    },
  })

  const handleSign = () => {
    if (!meaning || !credential.trim()) return
    signMut.mutate({ m: meaning, cred: credential })
  }

  const handleCancel = () => {
    console.log('[e-sign] cancel signing', { documentId })
    navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}`)
  }

  if (chain.length === 0) {
    return <div className="flex h-full items-center justify-center"><p className="font-mono text-sm text-slate-400">Loading signature chain…</p></div>
  }

  const selectedSigner = selectedIndex !== null ? chain[selectedIndex] : null
  const selectedState  = selectedIndex !== null ? derivedStates[selectedIndex] : null
  const panelTitle     = selectedState === 'signed' ? 'Signature record'
    : selectedState === 'you' ? 'Electronic signature'
    : selectedState === 'queued' ? 'Pending signature'
    : ''
  const panelStep = selectedIndex !== null ? `STEP ${selectedIndex + 1} OF ${totalCount}` : ''

  return (
    <div className="flex h-full flex-col" data-screen="e-signature">

      {/* ============ Document header ============ */}
      <div className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-white px-8 pt-3" style={{ position: 'relative', zIndex: 6 }}>
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">All Projects</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">VELORA-301</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing`)} className="hover:text-slate-900 transition-colors">Clinical Writing</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}`)} className="hover:text-slate-900 transition-colors truncate">
            Clinical Study Report — VELORA-301
          </button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">Sign</span>
        </div>
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-base font-bold tracking-tight">Clinical Study Report — VELORA-301</h1>
            <span className="flex-none font-mono text-[11px] text-slate-500">v0.4 · Final</span>
            <span className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}>
              Pending signature
            </span>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90"
            style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}
          >
            Cancel signing
          </button>
        </div>
      </div>

      {/* ============ Main + panel overlay ============ */}
      <div className="relative flex flex-1 min-h-0">

        {/* Left area */}
        <div className="flex-1 min-w-0 overflow-y-auto px-8 py-7" style={{ backgroundColor: '#F8FAFC' }}>
          <div className="flex flex-col gap-5" style={{ maxWidth: 820 }}>

            {/* Document manifest card */}
            <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4">
              <LockIcon />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-bold">Clinical Study Report — VELORA-301</p>
                <p className="font-mono text-[11px] text-slate-500">v0.4 · 28 Oct 2024 · 47 pages · SHA-256: 3a9f…c4d2</p>
              </div>
              <div className="flex flex-none flex-col gap-0.5 text-right">
                <p className="text-xs text-slate-500">Signature progress</p>
                <p className="text-sm font-bold">{signedCount} of {totalCount} recorded</p>
              </div>
              <div className="w-[120px] flex-none">
                <div className="h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
                  <div className="h-full transition-all" style={{ width: `${progressPct}%`, backgroundColor: '#2563EB' }} />
                </div>
              </div>
            </div>

            {/* Signature chain */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <MonoLabel>Signature chain · sequential</MonoLabel>
                <p className="text-xs text-slate-500">Select a signatory to inspect its record — order is fixed by the project RACI.</p>
              </div>
              {chain.map((record, i) => (
                <SignerRow
                  key={record.id}
                  index={i}
                  step={String(i + 1)}
                  record={record}
                  state={derivedStates[i]}
                  isSelected={selectedIndex === i}
                  onSelect={() => setSelectedIndex(i)}
                />
              ))}
            </div>

            {/* Lock notice */}
            <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }}>
              <span className="mt-0.5"><LockIcon colour="#94A3B8" size={12} /></span>
              <p className="text-[12px] italic leading-relaxed text-slate-500">
                The document is locked for authoring while signatures are being collected. Cancelling signing returns it to In Authoring and voids the signature chain recorded so far.
              </p>
            </div>
          </div>
        </div>

        {/* Right panel — absolute overlay */}
        {selectedSigner && selectedState && (
          <div
            className="absolute top-0 right-0 bottom-0 flex flex-col border-l border-slate-200 bg-white"
            style={{
              width:     480,
              zIndex:    10,
              boxShadow: '-16px 0 40px rgba(15,23,42,0.12)',
              minHeight: 0,
            }}
          >
            {/* Panel header (48px) */}
            <div className="flex h-12 flex-none items-center gap-2 border-b border-slate-200 px-4">
              <span style={{ color: '#2563EB' }}><LockIcon size={14} /></span>
              <h3 className="whitespace-nowrap text-sm font-bold">{panelTitle}</h3>
              <span className="ml-1 whitespace-nowrap font-mono text-[10px] tracking-wider text-slate-500">{panelStep}</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setSelectedIndex(null)}
                aria-label="Close panel"
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Panel body — signer summary + state-specific block */}
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              {/* Signer summary row */}
              <div className="flex items-center gap-2.5">
                <Avatar initials={selectedSigner.initials} size={32} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="truncate text-sm font-bold">{selectedSigner.signer}</p>
                  <p className="text-xs text-slate-500">{ROLE_LONG[selectedSigner.role] ?? selectedSigner.role}</p>
                </div>
                <div className="flex-1" />
                <StatePill state={selectedState} />
              </div>

              {selectedState === 'signed'  && <SignedPanel record={selectedSigner} />}
              {selectedState === 'queued'  && <QueuedPanel record={selectedSigner} previousSigner={chain[selectedIndex! - 1]} />}
              {selectedState === 'you'     && (
                <YouPanel
                  record={selectedSigner}
                  meaning={meaning}
                  credential={credential}
                  onMeaning={setMeaning}
                  onCredential={setCredential}
                />
              )}
            </div>

            {/* Panel footer — varies by state */}
            {selectedState === 'you' && (
              <div className="flex flex-none flex-col border-t border-slate-200" style={{ backgroundColor: '#F8FAFC' }}>
                <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(null)}
                    disabled={signMut.isPending}
                    className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={handleSign}
                    disabled={!meaning || !credential.trim() || signMut.isPending}
                    className="whitespace-nowrap rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {signMut.isPending ? 'Signing…' : 'Sign document'}
                  </button>
                </div>
                <p className="pb-2.5 text-center font-mono text-[10px] font-medium tracking-wider leading-relaxed text-slate-500">
                  By signing you confirm the meaning above under penalty of applicable regulations.
                </p>
              </div>
            )}

            {selectedState === 'signed' && (
              <div className="flex flex-none gap-2 border-t border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }}>
                <button className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors">
                  Download certificate
                </button>
                <button className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors">
                  Verify signature
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
