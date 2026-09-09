import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChecklistItem, ChecklistItemStatus } from '@platform/types'
import { documentsApi } from '../api'

interface Props {
  documentId: string
}

const LOGGED_IN_USER = 'Marcus Webb'

// --- Icons ---

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <polyline points="2,6.4 4.6,9 10,3.2" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function InProgressArc() {
  return (
    <svg width="12" height="12" viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="6" fill="none" stroke="#2563EB" strokeWidth="2" strokeDasharray="28 10" transform="rotate(-90 9 9)"/>
    </svg>
  )
}

function WarnGlyph() {
  return <span className="text-[11px] font-extrabold leading-none" style={{ color: '#B45309' }}>⚠</span>
}

// --- State icon ---

function StatusIcon({ status }: { status: ChecklistItemStatus }) {
  if (status === 'complete') {
    return (
      <div
        className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded"
        style={{ backgroundColor: '#2563EB' }}
      >
        <CheckIcon />
      </div>
    )
  }
  if (status === 'in-progress') {
    return (
      <div
        className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded"
        style={{ backgroundColor: '#FFFFFF', border: '2px solid #2563EB' }}
      >
        <InProgressArc />
      </div>
    )
  }
  if (status === 'waived') {
    return (
      <div
        className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded"
        style={{ backgroundColor: '#FFFBEB', border: '1px solid #D97706' }}
      >
        <WarnGlyph />
      </div>
    )
  }
  // pending
  return (
    <div
      className="h-[18px] w-[18px] flex-none rounded"
      style={{ backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1' }}
    />
  )
}

// --- Item row ---

interface ItemRowProps {
  item:          ChecklistItem
  waivingId:     string | null
  waiverText:    string
  waiverError:   string | null
  onComplete:    (id: string) => void
  onWaiveBegin:  (id: string) => void
  onWaiveText:   (text: string) => void
  onWaiveCancel: () => void
  onWaiveConfirm:() => void
  isWaiving:     boolean
  isMutating:    boolean
  showReason:    string | null
  onShowReason:  (id: string | null) => void
}

function ItemRow(p: ItemRowProps) {
  const { item }        = p
  const isComplete      = item.status === 'complete'
  const isWaived        = item.status === 'waived'
  const isCurrWaiving   = p.waivingId === item.id
  const isMandatory     = item.frameworkMandatory
  const secondaryColour =
    isComplete   ? '#15803D' :
    item.status === 'in-progress' ? '#2563EB' :
    isWaived     ? '#B45309' :
    '#B45309'  // pending → amber

  const secondaryText =
    isComplete   ? (item.completedBy ? `Completed · ${item.completedBy}` : 'Complete') :
    item.status === 'in-progress' ? 'In progress' :
    isWaived     ? `Waived · ${item.waivedBy ?? '—'}${item.waivedAt ? ' · ' + new Date(item.waivedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}` :
    'Pending'

  return (
    <div className="flex items-start gap-2.5 border-b px-4 py-2.5 transition-colors hover:bg-slate-50" style={{ borderColor: '#F1F5F9' }}>
      <StatusIcon status={item.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[13px] font-semibold text-slate-900">{item.text}</p>

        {isWaived ? (
          <div>
            <span
              className="inline-block rounded border px-1.5 py-px text-[11px] font-semibold"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#D97706' }}
            >
              {item.framework}{isMandatory ? ' · Mandatory' : ''}
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">
            {item.framework}{isMandatory ? ' · Mandatory' : ''}
            {item.isUserAdded && ' · Custom'}
          </p>
        )}

        <p className="text-[11px]" style={{ color: secondaryColour }}>{secondaryText}</p>

        {/* Waive reason toggle */}
        {isWaived && item.waiverReason && (
          <>
            <button
              type="button"
              onClick={() => p.onShowReason(p.showReason === item.id ? null : item.id)}
              className="text-left text-[11px] font-semibold text-blue-600 hover:text-blue-700"
            >
              {p.showReason === item.id ? 'Hide waiver reason' : 'View waiver reason →'}
            </button>
            {p.showReason === item.id && (
              <p className="mt-1 rounded border px-2 py-1.5 text-[11px] text-slate-700"
                 style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
                {item.waiverReason}
              </p>
            )}
          </>
        )}

        {/* Actions row — hidden for complete + waived */}
        {!isComplete && !isWaived && !isCurrWaiving && (
          <div className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={() => p.onComplete(item.id)}
              disabled={p.isMutating}
              className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
            >
              Mark complete
            </button>
            <button
              type="button"
              onClick={() => p.onWaiveBegin(item.id)}
              disabled={p.isMutating}
              className="text-[11px] font-semibold hover:text-amber-700 disabled:opacity-50"
              style={{ color: '#B45309' }}
            >
              Waive
            </button>
          </div>
        )}

        {/* Inline waive form */}
        {isCurrWaiving && (
          <div className="mt-2 flex flex-col gap-1.5 rounded border p-2" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }}>
            {isMandatory && (
              <p className="text-[11px] font-semibold" style={{ color: '#B45309' }}>
                Waiving a Framework Mandatory item — reason required.
              </p>
            )}
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-700">Waiver reason (required)</span>
              <input
                type="text"
                value={p.waiverText}
                onChange={e => p.onWaiveText(e.target.value)}
                placeholder="Why is this item being waived?"
                className="mt-1 h-8 w-full rounded border px-2 text-[12px] outline-none focus:border-blue-600 focus:shadow-focus"
                style={{ borderColor: '#E2E8F0' }}
                autoFocus
              />
            </label>
            {p.waiverError && (
              <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }}>{p.waiverError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={p.onWaiveCancel}
                className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={p.onWaiveConfirm}
                disabled={p.isMutating}
                className="rounded px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: '#B45309' }}
              >
                Confirm waive
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// --- Panel ---

export function ChecklistPanel({ documentId }: Props) {
  const qc = useQueryClient()

  const { data: items = [] } = useQuery({
    queryKey: ['checklist', documentId],
    queryFn:  () => documentsApi.getChecklist(documentId),
    enabled:  !!documentId,
  })

  const [waivingId,   setWaivingId]   = useState<string | null>(null)
  const [waiverText,  setWaiverText]  = useState('')
  const [waiverError, setWaiverError] = useState<string | null>(null)
  const [showReason,  setShowReason]  = useState<string | null>(null)
  const [addingItem,  setAddingItem]  = useState(false)
  const [newItemText, setNewItemText] = useState('')
  const [newItemFwk,  setNewItemFwk]  = useState('Custom')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['checklist', documentId] })

  const completeMut = useMutation({
    mutationFn: (id: string) => documentsApi.completeItem(documentId, id, { completedBy: LOGGED_IN_USER }),
    onSuccess:  invalidate,
  })

  const waiveMut = useMutation({
    mutationFn: (args: { id: string; reason: string }) =>
      documentsApi.waiveItem(documentId, args.id, { waivedBy: LOGGED_IN_USER, reason: args.reason }),
    onSuccess: () => {
      setWaivingId(null); setWaiverText(''); setWaiverError(null)
      invalidate()
    },
  })

  const addMut = useMutation({
    mutationFn: (args: { text: string; framework: string }) =>
      documentsApi.addChecklistItem(documentId, args),
    onSuccess: () => {
      setAddingItem(false); setNewItemText(''); setNewItemFwk('Custom')
      invalidate()
    },
  })

  const isMutating = completeMut.isPending || waiveMut.isPending || addMut.isPending

  // --- Derived groupings ---

  const mandatoryActive = items.filter(i => i.frameworkMandatory && i.status !== 'waived')
  const waived          = items.filter(i => i.status === 'waived')
  const custom          = items.filter(i => i.isUserAdded && i.status !== 'waived')

  const completeCount = items.filter(i => i.status === 'complete').length
  const pct = items.length > 0 ? Math.round((completeCount / items.length) * 100) : 0

  // --- Handlers ---

  const beginWaive = (id: string) => {
    setWaivingId(id)
    setWaiverText('')
    setWaiverError(null)
  }
  const cancelWaive = () => {
    setWaivingId(null); setWaiverText(''); setWaiverError(null)
  }
  const confirmWaive = () => {
    if (!waivingId) return
    if (!waiverText.trim()) {
      setWaiverError('Waiver reason is required')
      return
    }
    waiveMut.mutate({ id: waivingId, reason: waiverText.trim() })
  }

  const submitAdd = () => {
    if (!newItemText.trim()) return
    addMut.mutate({ text: newItemText.trim(), framework: newItemFwk || 'Custom' })
  }

  const rowProps = useMemo(() => ({
    waivingId,
    waiverText,
    waiverError,
    isMutating,
    showReason,
    onComplete:    (id: string) => completeMut.mutate(id),
    onWaiveBegin:  beginWaive,
    onWaiveText:   (t: string) => { setWaiverText(t); if (waiverError) setWaiverError(null) },
    onWaiveCancel: cancelWaive,
    onWaiveConfirm:confirmWaive,
    onShowReason:  setShowReason,
    isWaiving:     waivingId !== null,
  }), [waivingId, waiverText, waiverError, isMutating, showReason, completeMut, confirmWaive])

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Progress header */}
      <div className="flex-none border-b border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold text-slate-900">
            {completeCount} of {items.length} items complete
          </p>
          <p className="text-xs font-bold" style={{ color: '#2563EB' }}>{pct}%</p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
          <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: '#2563EB' }} />
        </div>
      </div>

      {/* Scroll list */}
      <div className="flex-1 overflow-y-auto">

        {mandatoryActive.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1.5">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
                Framework mandatory
              </p>
            </div>
            {mandatoryActive.map(item => <ItemRow key={item.id} item={item} {...rowProps} />)}
          </>
        )}

        {waived.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1.5">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#D97706' }}>
                Framework mandatory — waived
              </p>
            </div>
            {waived.map(item => <ItemRow key={item.id} item={item} {...rowProps} />)}
          </>
        )}

        {custom.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1.5">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
                Custom
              </p>
            </div>
            {custom.map(item => <ItemRow key={item.id} item={item} {...rowProps} />)}
          </>
        )}

        {/* Add item form */}
        <div className="m-4">
          {!addingItem ? (
            <button
              type="button"
              onClick={() => setAddingItem(true)}
              className="w-full rounded-md border border-dashed px-3 py-2.5 text-center text-[13px] text-slate-700 transition-colors hover:bg-slate-50"
              style={{ borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' }}
            >
              ＋ Add checklist item
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
              <input
                type="text"
                value={newItemText}
                onChange={e => setNewItemText(e.target.value)}
                placeholder="Item description"
                className="h-8 rounded border px-2 text-[12px] outline-none focus:border-blue-600 focus:shadow-focus"
                style={{ borderColor: '#E2E8F0' }}
                autoFocus
              />
              <input
                type="text"
                value={newItemFwk}
                onChange={e => setNewItemFwk(e.target.value)}
                placeholder="Framework (e.g. Custom)"
                className="h-8 rounded border px-2 text-[12px] outline-none focus:border-blue-600 focus:shadow-focus"
                style={{ borderColor: '#E2E8F0' }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setAddingItem(false); setNewItemText(''); setNewItemFwk('Custom') }}
                  className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitAdd}
                  disabled={isMutating || !newItemText.trim()}
                  className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Add item
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
