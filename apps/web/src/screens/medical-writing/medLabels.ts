// Shared Medical Writing labels and small helpers, so every screen names stages and tiers the same way and
// shows the signed-in user rather than a fixed demo persona.
//
// Stage names follow the API's content stage machine (apps/api/src/modules/medical-writing/content-stage.ts) —
// item.stage is what the API returns and advances, so the label has to describe that number.
// Tier names follow the PRD (FR-C-017): the API maps its A/B/C tiers to 1/2/3 for the UI.

import { usePlatformStore } from '../../platform/store'
import { isAdminRole } from '../../config/roles'

export const MED_STAGE_NAMES: Record<number, string> = {
  1: 'Briefing',
  2: 'Drafting',
  3: 'Internal review',
  4: 'MLR submission',
  5: 'MLR review',
  6: 'Approved',
}
export const MED_STAGE_COUNT = 6

/** "Stage 3 · Internal review" — or "Stage —" when unknown. */
export function stageLabel(stage: number | null | undefined): string {
  if (!stage || !MED_STAGE_NAMES[stage]) return 'Stage —'
  return `Stage ${stage} · ${MED_STAGE_NAMES[stage]}`
}

export const MED_TIER_NAMES: Record<number, string> = { 1: 'Expedited', 2: 'Standard', 3: 'Full' }

/** "Tier 2 — Standard review", or a pending note when the tier hasn't been calculated yet. */
export function tierLabel(tier: number | null | undefined): string {
  if (!tier || !MED_TIER_NAMES[tier]) return 'Tier not calculated yet'
  return `Tier ${tier} — ${MED_TIER_NAMES[tier]} review`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "12 Nov 2026" (UTC), or "—". */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "12 Nov 2026 11:02 UTC", or "—". */
export function fmtDayTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${fmtDay(iso)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

/** "11:02 UTC", or "—". */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

/** "v1.0" from "1.0" or "v1.0" (versions arrive with and without the prefix). */
export function ver(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'v—'
  return `v${String(v).replace(/^v/i, '')}`
}

/** Plain text from slide HTML (for summaries and read-only views). */
export function textOf(html: string | null | undefined): string {
  return (html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The signed-in user as Medical Writing needs them. The MLR Lead is not a role of its own yet: the API gates
 * the final MLR decision and the tier override on the admin role, so that is what "MLR Lead" means here too.
 */
export function useMedUser() {
  const u = usePlatformStore(s => s.currentUser)
  return { id: u.id, name: u.name, role: u.role, isMlrLead: isAdminRole(u.role) }
}

/** Compliance frameworks that apply to an item, from its compliance track (Stage 1). */
export function frameworksFor(track: string | null | undefined): string[] {
  const base = ['21 CFR Part 11', 'WCAG 2.1 AA']
  if (track === 'accme' || track === 'cme') return [...base, 'ACCME / EACCME']
  if (track === 'advisory') return base
  return [...base, 'IFPMA', 'EFPIA', 'ABPI', 'PhRMA']
}
