// E-Signature (Screen — Part 11 signature chain, FR-A-062/063/066).
//
// Wired to the real chain API:
//   GET  /documents/:id/signature-chains     → newest chain + records
//   POST /documents/:id/signature-chains     → initiate (InitiateSignatureChain)
//   POST /signature-records/:recordId/sign   → the signature act
//   POST /signature-chains/:chainId/cancel   → cancel (document → in authoring)
// The meaning of each signature is fixed when the chain is initiated, so it is
// shown read-only here. The step the signed-in user may sign is the record
// that is `awaiting` AND has their signerId (no delegation).

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { documentsApi, type SignatureChain, type SignatureRecord as ChainRecord } from '../../api'
import { ApiError } from '../../api/client'
import { useCancelSignatureChain, useCurrentUser, useSignatureChains, useSignRecord } from '../../hooks'
import { useDocumentStore } from '../../store'
import { InitiateSignatureChain } from './InitiateSignatureChain'

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

// 'you' = awaiting and yours to sign; 'awaiting' = awaiting someone else.
type RowState = 'signed' | 'you' | 'awaiting' | 'queued'

const MEANING_TEXT: Record<ChainRecord['meaning'], string> = {
  authored: 'I have authored this document',
  reviewed: 'I have reviewed this document',
  approved: 'I approve this document for submission',
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'

const fmtUtc = (iso: string | null | undefined) =>
  iso ? `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC` : '—'

// Map the API's refusal codes to plain messages.
function signErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string; issues?: Array<{ message: string }> } | null
    switch (body?.error) {
      case 'wrong_signer':   return 'Only the designated signer can sign this step.'
      case 'already_signed': return 'This step has already been signed.'
      case 'not_awaiting':   return "It isn't this step's turn yet — earlier signatures are still pending."
      case 'chain_closed':   return 'This signature chain is closed (completed or cancelled).'
      case 'document_missing_version': return 'The document has no current version to sign.'
      case 'validation':     return body.issues?.[0]?.message ?? 'Please check the details and try again.'
    }
    if (body?.message) return body.message
  }
  return 'Could not record the signature. Please try again.'
}

// --- Icons / primitives ---

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
      style={{ width: size, height: size, backgroundColor: c.bg, color: c.fg, fontSize: size >= 24 ? 12 : 10 }}
    >
      {initials}
    </div>
  )
}

function StatePill({ state }: { state: RowState }) {
  const map = {
    signed:   { label: 'Signed ✓',                bg: '#F0FDF4', fg: '#15803D', border: '1px solid #BBF7D0' },
    you:      { label: 'Awaiting your signature', bg: '#EFF6FF', fg: '#2563EB', border: 'none' },
    awaiting: { label: 'Awaiting signature',      bg: '#FFFBEB', fg: '#B45309', border: '1px solid #FDE68A' },
    queued:   { label: 'Queued',                  bg: '#F8FAFC', fg: '#64748B', border: '1px solid #E2E8F0' },
  }[state]
  return (
    <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: map.bg, color: map.fg, border: map.border }}>
      {map.label}
    </span>
  )
}

function MonoLabel({ children, color = '#64748B' }: { children: React.ReactNode; color?: string }) {
  return <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color }}>{children}</p>
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

function SignerRow({ record, state, isSelected, onSelect }: { record: ChainRecord; state: RowState; isSelected: boolean; onSelect: () => void }) {
  const baseStyle: React.CSSProperties =
    state === 'signed' ? { border: '1px solid #BBF7D0', borderLeft: '4px solid #16A34A', backgroundColor: '#F0FDF4' }
    : state === 'you'  ? { border: '2px solid #2563EB', backgroundColor: '#FFFFFF', boxShadow: '0 0 0 3px rgba(37,99,235,0.10)' }
    : state === 'awaiting' ? { border: '1px solid #FDE68A', backgroundColor: '#FFFFFF' }
    : { border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', opacity: 0.6 }

  const meta =
    state === 'signed'   ? `${fmtUtc(record.timestampUtc)} · document hash bound`
    : state === 'you'    ? 'Your signature is required — complete the panel at right.'
    : state === 'awaiting' ? 'Waiting for this signer.'
    : 'Released once the preceding signature is recorded.'

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
      <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md font-mono text-[13px] font-bold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
        {record.step}
      </div>
      <Avatar initials={initialsOf(record.signerName)} size={28} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-bold">{record.signerName}</p>
          <p className="whitespace-nowrap font-mono text-[9px] tracking-wider text-slate-500">{record.signerRole.toUpperCase()}</p>
        </div>
        <p className="text-xs text-slate-500">{MEANING_TEXT[record.meaning]}</p>
        <p className="text-[11px]" style={{ color: state === 'you' ? '#2563EB' : '#64748B' }}>{meta}</p>
      </div>
      <StatePill state={state} />
    </button>
  )
}

// --- Panel bodies ---

function SignedPanel({ record }: { record: ChainRecord }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg p-3 pl-3.5" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
        <MonoLabel color="#15803D">Meaning of signature</MonoLabel>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: '#15803D' }}>{MEANING_TEXT[record.meaning]}</p>
      </div>
      <div>
        <MonoLabel>Signature record</MonoLabel>
        <div className="mt-1.5">
          <KVRow label="Signature ID"         value={record.id} mono />
          <KVRow label="Recorded (server)"    value={fmtUtc(record.timestampUtc)} mono />
          <KVRow label="Signer local time"    value={record.localTime ?? '—'} />
          <KVRow label="Time source"          value={record.timeSource ?? '—'} />
          <KVRow label="Authentication"       value={record.authMethod ?? '—'} />
          <KVRow label="Document hash signed" value={record.documentHash ?? '—'} mono />
          <KVRow label="Version at signing"   value={record.versionAtSigning ?? '—'} />
          <KVRow label="Scope"                value={record.scopeSections.length ? record.scopeSections.join(', ') : 'Whole document'} />
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5" style={{ backgroundColor: '#F8FAFC' }}>
        <span className="mt-0.5"><LockIcon colour="#94A3B8" size={12} /></span>
        <p className="text-[12px] italic leading-relaxed text-slate-500">
          Signature manifest is immutable. Any later edit to the document voids this signature and restarts the chain.
        </p>
      </div>
    </div>
  )
}

function PendingPanel({ record, previous, state }: { record: ChainRecord; previous?: ChainRecord; state: 'awaiting' | 'queued' }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200 p-3 pl-3.5" style={{ backgroundColor: '#F8FAFC' }}>
        <MonoLabel>Meaning required at signing</MonoLabel>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-900">{MEANING_TEXT[record.meaning]}</p>
      </div>
      <div>
        <MonoLabel>Pending signature</MonoLabel>
        <div className="mt-1.5">
          <KVRow label="Status"      value={state === 'awaiting' ? `Awaiting ${record.signerName}` : 'Queued'} />
          {state === 'queued' && <KVRow label="Waiting on" value={previous ? `Step ${previous.step} · ${previous.signerName}` : '—'} />}
          <KVRow label="Delegation"  value="Not permitted — Part 11" />
          <KVRow label="Scope"       value={record.scopeSections.length ? record.scopeSections.join(', ') : 'Whole document'} />
        </div>
      </div>
      <p className="text-[11px] italic leading-relaxed text-slate-500">
        Only {record.signerName} can sign this step.
      </p>
    </div>
  )
}

function YouPanel({ record, email, credential, onCredential, error }: {
  record: ChainRecord; email: string | undefined; credential: string; onCredential: (v: string) => void; error: string | null
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] leading-relaxed text-slate-500">
        21 CFR Part 11 · Annex 11 — this signature is legally binding and cannot be edited once recorded.
      </p>

      {/* Meaning is fixed when the chain is initiated (shown read-only). */}
      <div className="rounded-lg p-3 pl-3.5" style={{ border: '2px solid #2563EB', backgroundColor: '#EFF6FF' }} data-meaning={record.meaning}>
        <MonoLabel color="#1D4ED8">Meaning of signature</MonoLabel>
        <p className="mt-1 text-[13px] font-bold" style={{ color: '#1D4ED8' }}>{MEANING_TEXT[record.meaning]}</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-bold">Confirm your identity</p>
        <div className="flex items-center gap-2">
          <LockIcon colour="#94A3B8" size={12} />
          <p className="truncate text-[13px] text-slate-500">{email ?? '—'}</p>
        </div>
        <label htmlFor="sig-pw" className="text-xs font-semibold text-slate-500">ClinWrite.AI password</label>
        <input
          id="sig-pw"
          type="password"
          autoComplete="current-password"
          value={credential}
          onChange={e => onCredential(e.target.value)}
          placeholder="Re-enter password"
          className="h-10 rounded-md border px-3 text-sm outline-none focus:border-blue-600 focus:shadow-focus"
          style={{ borderColor: '#E2E8F0', letterSpacing: '0.14em' }}
          data-credential-input
        />
        <p className="text-[11px] italic text-slate-500">Re-enter credentials each time — signatures cannot be delegated.</p>
        {error && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-sign-error>{error}</p>}
      </div>

      <div>
        <MonoLabel>What this signature will record</MonoLabel>
        <div className="mt-1.5">
          <KVRow label="Timestamp"     value="Server time at signing (UTC)" />
          <KVRow label="Document hash" value="SHA-256 of the current version" />
          <KVRow label="Scope"         value={record.scopeSections.length ? record.scopeSections.join(', ') : 'Whole document'} />
          <KVRow label="Device"        value={typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 60) : '—'} />
        </div>
      </div>
    </div>
  )
}

// --- Main screen ---

export function ESignature() {
  const { projectId, documentId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: me } = useCurrentUser()
  const { data: document } = useQuery({
    queryKey: ['document', documentId],
    queryFn:  () => documentsApi.get(documentId!),
    enabled:  !!documentId,
  })
  const { data: chains = [], isLoading, isError, error } = useSignatureChains(documentId!)

  // Push the loaded document into the store so TopNav's enriched breadcrumb
  // picks up the title on the E-Signature tab the same way it does on the
  // Editor tab.
  const setActiveDocument = useDocumentStore(s => s.setActiveDocument)
  useEffect(() => { if (document) setActiveDocument(document) }, [document, setActiveDocument])

  // Newest chain first (API order). An active chain wins; otherwise show the
  // newest completed/cancelled one for its record.
  const chain: SignatureChain | undefined =
    chains.find(c => c.status === 'initiated' || c.status === 'in_progress') ?? chains[0]
  const records = useMemo(() => [...(chain?.records ?? [])].sort((a, b) => a.step - b.step), [chain])
  const chainActive = chain?.status === 'initiated' || chain?.status === 'in_progress'

  const states: RowState[] = useMemo(() => records.map(r =>
    r.status === 'signed' ? 'signed'
    : r.status === 'awaiting' ? (r.signerId === me?.id && chainActive ? 'you' : 'awaiting')
    : 'queued'), [records, me?.id, chainActive])

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [credential, setCredential] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const signMut   = useSignRecord({ chainId: chain?.id ?? '', documentId: documentId! })
  const cancelMut = useCancelSignatureChain({ chainId: chain?.id ?? '', documentId: documentId! })

  // Default selection: the user's own awaiting step, else the first awaiting.
  const yourIndex = states.indexOf('you')
  useEffect(() => {
    if (selectedIndex !== null || records.length === 0) return
    const i = yourIndex >= 0 ? yourIndex : states.indexOf('awaiting')
    if (i >= 0) setSelectedIndex(i)
  }, [records.length, yourIndex, states, selectedIndex])

  const refreshAfterChange = () => {
    // Final signature flips the document to signed + clears the watermark.
    qc.invalidateQueries({ queryKey: ['document', documentId] })
    qc.invalidateQueries({ queryKey: ['signature-chain', documentId] })   // Final Document tab
    qc.invalidateQueries({ queryKey: ['documents'] })
  }

  const handleSign = () => {
    if (selectedIndex === null || !credential.trim()) return
    const record = records[selectedIndex]
    signMut.mutate(
      {
        recordId: record.id,
        body: {
          credentialProof: credential,
          localTime: new Date().toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
          timeSource: 'Signer device clock (server UTC timestamp is authoritative)',
          deviceInfo: navigator.userAgent.slice(0, 200),
        },
      },
      {
        onSuccess: () => {
          setCredential('')
          setSelectedIndex(null)
          refreshAfterChange()
        },
      },
    )
  }

  const handleCancelChain = () => {
    if (!cancelReason.trim()) return
    cancelMut.mutate(cancelReason.trim(), {
      onSuccess: () => {
        setCancelOpen(false)
        setCancelReason('')
        setSelectedIndex(null)
        refreshAfterChange()
      },
    })
  }

  // backToEditor was consumed by the in-screen breadcrumb's document-title
  // link; now that TopNav owns the breadcrumb, the helper is unused.

  if (isLoading) {
    return <div className="flex h-full items-center justify-center"><p className="font-mono text-sm text-slate-400">Loading signature chain…</p></div>
  }
  if (isError) {
    const msg = (error as Error | null)?.message ?? 'Could not load signature chain.'
    return <div className="flex h-full items-center justify-center"><p className="font-mono text-sm text-red-600">{msg}</p></div>
  }

  // No active chain → initiate (or explain why not yet).
  if (!chain || chain.status === 'cancelled') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto p-10" data-screen="e-signature">
        {chain?.status === 'cancelled' && (
          <p className="text-[12px] text-amber-700" data-chain-cancelled>
            The previous signature chain was cancelled{chain.cancelReason ? ` — “${chain.cancelReason}”` : ''}.
          </p>
        )}
        <InitiateSignatureChain documentId={documentId!} projectId={projectId!} documentStatus={document?.status} />
        <button onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}/review`)}
          className="text-[12px] font-semibold text-slate-600 hover:underline">
          Open Reviewer View
        </button>
      </div>
    )
  }

  const signedCount = states.filter(s => s === 'signed').length
  const totalCount  = records.length
  const progressPct = totalCount > 0 ? Math.round((signedCount / totalCount) * 100) : 0
  const selected      = selectedIndex !== null ? records[selectedIndex] : null
  const selectedState = selectedIndex !== null ? states[selectedIndex] : null
  const panelTitle =
    selectedState === 'signed' ? 'Signature record'
    : selectedState === 'you' ? 'Electronic signature'
    : selectedState ? 'Pending signature' : ''
  const title = document?.title ?? 'Document'
  const statusLabel = chain.status === 'complete' ? 'Signed' : 'Pending signature'

  return (
    <div className="flex h-full flex-col" data-screen="e-signature">

      {/* ============ Document header ============ */}
      <div className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-white px-8 pt-3" style={{ position: 'relative', zIndex: 6 }}>
        {/* Breadcrumb moved to TopNav (same cleanup as DocumentEditor). */}
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-base font-bold tracking-tight">{title}</h1>
            <span className="flex-none font-mono text-[11px] text-slate-500">{document?.version ?? ''}</span>
            <span
              className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
              style={chain.status === 'complete' ? { backgroundColor: '#F0FDF4', color: '#15803D' } : { backgroundColor: '#FFFBEB', color: '#B45309' }}
              data-chain-status={chain.status}
            >
              {statusLabel}
            </span>
          </div>
          {chainActive && (
            <button
              type="button"
              onClick={() => setCancelOpen(v => !v)}
              className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}
              data-cancel-chain
            >
              Cancel signature chain
            </button>
          )}
        </div>
        {cancelOpen && chainActive && (
          <div className="mb-3 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3" data-cancel-form>
            <p className="text-[12px] text-amber-900">
              Cancelling voids the signatures recorded so far and returns the document to In Authoring. A reason is required for the audit trail.
            </p>
            <div className="flex gap-2">
              <input
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Reason for cancelling"
                className="h-9 flex-1 rounded-md border border-amber-300 bg-white px-3 text-[13px]"
                data-cancel-reason
              />
              <button
                type="button"
                onClick={handleCancelChain}
                disabled={!cancelReason.trim() || cancelMut.isPending}
                className="rounded-md bg-amber-600 px-3 text-[13px] font-semibold text-white disabled:opacity-50"
              >{cancelMut.isPending ? 'Cancelling…' : 'Confirm cancel'}</button>
            </div>
            {cancelMut.isError && <p className="text-[12px] text-red-800">Could not cancel the chain. Please try again.</p>}
          </div>
        )}
      </div>

      {/* ============ Main + panel overlay ============ */}
      <div className="relative flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto px-8 py-7" style={{ backgroundColor: '#F8FAFC' }}>
          <div className="flex flex-col gap-5" style={{ maxWidth: 820 }}>

            {/* Document manifest card */}
            <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4">
              <LockIcon />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-bold">{title}</p>
                <p className="font-mono text-[11px] text-slate-500">
                  {document?.version ?? '—'} · chain started {fmtUtc(chain.initiatedAt)}
                  {chain.completedAt ? ` · completed ${fmtUtc(chain.completedAt)}` : ''}
                </p>
              </div>
              <div className="flex flex-none flex-col gap-0.5 text-right">
                <p className="text-xs text-slate-500">Signature progress</p>
                <p className="text-sm font-bold" data-signature-progress>{signedCount} of {totalCount} recorded</p>
              </div>
              <div className="w-[120px] flex-none">
                <div className="h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
                  <div className="h-full transition-all" style={{ width: `${progressPct}%`, backgroundColor: '#2563EB' }} />
                </div>
              </div>
            </div>

            {chain.status === 'complete' && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-[13px] text-green-800" data-chain-complete>
                ✓ All signatures recorded — the document is signed and the watermark has been removed.{' '}
                <button onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}/final`)} className="font-semibold underline">
                  Open Final Document
                </button>
              </div>
            )}

            {/* Signature chain */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <MonoLabel>Signature chain · {chain.chainType}</MonoLabel>
                <p className="text-xs text-slate-500">Select a signatory to inspect its record.</p>
              </div>
              {records.map((record, i) => (
                <SignerRow
                  key={record.id}
                  record={record}
                  state={states[i]}
                  isSelected={selectedIndex === i}
                  onSelect={() => { setSelectedIndex(i); signMut.reset() }}
                />
              ))}
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }}>
              <span className="mt-0.5"><LockIcon colour="#94A3B8" size={12} /></span>
              <p className="text-[12px] italic leading-relaxed text-slate-500">
                The document is locked for authoring while signatures are being collected. Cancelling the chain returns it to In Authoring and voids the signatures recorded so far.
              </p>
            </div>
          </div>
        </div>

        {/* Right panel — absolute overlay */}
        {selected && selectedState && (
          <div
            className="absolute top-0 right-0 bottom-0 flex flex-col border-l border-slate-200 bg-white"
            style={{ width: 480, zIndex: 10, boxShadow: '-16px 0 40px rgba(15,23,42,0.12)', minHeight: 0 }}
          >
            <div className="flex h-12 flex-none items-center gap-2 border-b border-slate-200 px-4">
              <span style={{ color: '#2563EB' }}><LockIcon size={14} /></span>
              <h3 className="whitespace-nowrap text-sm font-bold">{panelTitle}</h3>
              <span className="ml-1 whitespace-nowrap font-mono text-[10px] tracking-wider text-slate-500">STEP {selected.step} OF {totalCount}</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setSelectedIndex(null)}
                aria-label="Close panel"
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
              >✕</button>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="flex items-center gap-2.5">
                <Avatar initials={initialsOf(selected.signerName)} size={32} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="truncate text-sm font-bold">{selected.signerName}</p>
                  <p className="text-xs text-slate-500">{selected.signerRole}</p>
                </div>
                <div className="flex-1" />
                <StatePill state={selectedState} />
              </div>

              {selectedState === 'signed' && <SignedPanel record={selected} />}
              {(selectedState === 'awaiting' || selectedState === 'queued') && (
                <PendingPanel record={selected} previous={records[selectedIndex! - 1]} state={selectedState} />
              )}
              {selectedState === 'you' && (
                <YouPanel
                  record={selected}
                  email={me?.email}
                  credential={credential}
                  onCredential={setCredential}
                  error={signMut.isError ? signErrorText(signMut.error) : null}
                />
              )}
            </div>

            {selectedState === 'you' && (
              <div className="flex flex-none flex-col border-t border-slate-200" style={{ backgroundColor: '#F8FAFC' }}>
                <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(null)}
                    disabled={signMut.isPending}
                    className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  >Cancel</button>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={handleSign}
                    disabled={!credential.trim() || signMut.isPending}
                    className="whitespace-nowrap rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    data-sign-submit
                  >{signMut.isPending ? 'Signing…' : 'Sign document'}</button>
                </div>
                <p className="pb-2.5 text-center font-mono text-[10px] font-medium tracking-wider leading-relaxed text-slate-500">
                  By signing you confirm the meaning above under penalty of applicable regulations.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
