import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import type { IdeationContentCard, KOLContact } from '@platform/types'
import { ProvenanceChip } from '../../components/ui/ProvenanceChip'
import kolContactsFixture      from '../../data/kolContacts.json'
import ideationCardsFixture    from '../../data/ideationContentCards.json'

const KOL_CONTACTS = kolContactsFixture   as unknown as KOLContact[]
const CARDS        = ideationCardsFixture as unknown as IdeationContentCard[]

function formatUTC(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

function KOLLinkExpiredPage({ token }: { token: string }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-slate-100 p-6"
      data-kol-link-expired
      data-no-aurora-shell
    >
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full font-bold text-white"
          style={{ backgroundColor: '#BE123C' }}
          aria-hidden
        >⊘</div>
        <h1 className="mt-4 text-[20px] font-bold text-slate-900" style={{ margin: 0 }}>Link expired or invalid</h1>
        <p className="mt-3 text-[13px] text-slate-600">
          This one-time KOL review link is no longer valid.
          If you were expecting to review content, please contact your GenBioCa Medical Affairs representative.
        </p>
        <p className="mt-4 font-mono text-[10px] text-slate-400">Token: {token}</p>
      </div>
    </div>
  )
}

export function KOLReviewInterface() {
  const { token } = useParams()

  const kol = useMemo(() => KOL_CONTACTS.find(k => k.reviewLinkToken === token), [token])
  const cards = useMemo(() => (kol ? CARDS.filter(c => c.ideationProjectId === kol.ideationProjectId) : []), [kol])
  const decisionByCard = useMemo(() => {
    const map: Record<string, { decision: 'approved' | 'rejected' | 'pending'; comment: string | null }> = {}
    kol?.reviewDecisions.forEach(d => { map[d.cardId] = { decision: d.decision, comment: d.comment } })
    return map
  }, [kol])

  if (!kol) {
    return <KOLLinkExpiredPage token={token ?? ''} />
  }

  const isSignedOff = !!kol.signedOffAt

  return (
    <div
      className="min-h-screen bg-slate-50"
      data-screen="kol-review-interface"
      data-public-route
      data-no-aurora-shell
    >
      <div className="flex flex-col gap-6" style={{ maxWidth: 960, padding: '32px 24px 48px' }}>

        {/* Public header — no Aurora shell */}
        <header className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-6" data-public-header>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#0D9488' }}>KOL Review · Secure one-time link</p>
          <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>VELORA-301 Efficacy Communications</h1>
          <p className="text-[13px] text-slate-600">
            Invited by GenBioCa Sciences · Expires {formatUTC(kol.reviewLinkExpiry)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-white"
              style={{ backgroundColor: '#0D9488' }}
              aria-hidden
            >JH</div>
            <div>
              <p className="text-[14px] font-semibold text-slate-900">{kol.name}</p>
              <p className="text-[12px] text-slate-500">{kol.title}</p>
            </div>
          </div>
        </header>

        {/* Cards */}
        <div className="flex flex-col gap-4" data-card-review-list>
          {cards.map(card => {
            const d = decisionByCard[card.id]
            return (
              <article
                key={card.id}
                className="rounded-lg border border-slate-200 bg-white p-5"
                data-card-review={card.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{card.id} · {card.sourceSection}</p>
                    <p className="text-[16px] font-bold text-slate-900">{card.title}</p>
                  </div>
                  {d && (
                    <span
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                      data-kol-decision={d.decision}
                    >{d.decision === 'approved' ? '✓ Approved' : d.decision === 'rejected' ? '⊘ Rejected' : '○ Pending'}</span>
                  )}
                </div>

                {/* Provenance — always visible without interaction */}
                <div className="mt-3" data-provenance-slot>
                  <ProvenanceChip chain={card.provenanceChain} />
                </div>

                {/* Source passage — read-only */}
                <div
                  className="mt-3 rounded-md p-3 text-[13px] leading-relaxed text-slate-700"
                  style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
                  data-source-passage
                >
                  "{card.sourcePassage}"
                </div>

                {d?.comment && (
                  <div
                    className="mt-3 rounded-md p-3 text-[12px]"
                    style={{ backgroundColor: '#F0FDFA', color: '#0F766E', border: '1px solid #99F6E4' }}
                    data-kol-comment
                  >
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest">KOL comment</p>
                    <p className="mt-1">"{d.comment}"</p>
                  </div>
                )}
              </article>
            )
          })}
        </div>

        {/* Sign-off panel */}
        <section
          className="rounded-lg border p-5"
          style={{ backgroundColor: isSignedOff ? '#F0FDF4' : '#FFFBEB', borderColor: isSignedOff ? '#BBF7D0' : '#FDE68A' }}
          data-signoff-panel
          data-signed-off={isSignedOff || undefined}
        >
          <p className="text-[15px] font-bold text-slate-900">{kol.name} · {kol.title}</p>
          {isSignedOff ? (
            <>
              <p className="mt-1 text-[13px]" style={{ color: '#166534' }} data-signed-off-at>
                ✓ Signed off: {formatUTC(kol.signedOffAt!)}
              </p>
              <p className="mt-2 text-[12px] text-slate-700">
                This review is complete. Your decisions have been recorded. This link is now closed.
              </p>
              <p className="mt-2 font-mono text-[10px] text-slate-500" data-immutability-note>
                KOL review decisions are immutable once submitted.
              </p>
            </>
          ) : (
            <p className="mt-1 text-[13px] text-slate-700">Review in progress — decisions have not yet been signed off.</p>
          )}
        </section>

        <footer className="mt-4 text-center font-mono text-[10px] text-slate-400">
          GenBioCa Sciences · KOL review interface · Public secure link · No Aurora account required
        </footer>
      </div>
    </div>
  )
}
