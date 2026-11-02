// Per-section confidence badge for the SectionNavigator sidebar.
//
// Visual budget is tight — the sidebar row is 36px tall and already
// carries status dot + title + presence avatar. The badge is a small
// chip (16-20px) that shows the per-section confidence number OR an
// empty placeholder when the section was never AI-evaluated.
//
// Hover reveals the flag codes in the title attribute for now (full
// drill-down lives in the AI Drafting Report panel — AI-3).

interface Props {
  confidence: number | null
  flags:      string[]
}

const FLAG_LABEL: Record<string, string> = {
  'completeness:too_short': 'Too short',
  'ai:self_critique':       'Needs revision',
  'ai:template_mismatch':   'Off-template',
  'ai:coherence_issue':     'Coherence',
  'ai:unsupported_claim':   'Unsupported claim',
}

function friendlyFlag(code: string): string {
  return FLAG_LABEL[code] ?? code
}

export function AiSectionConfidenceBadge({ confidence, flags }: Props) {
  // Never evaluated — render nothing (the section may just not be an
  // AI-drafted doc; a solid dot would misleadingly imply "flagged").
  if (confidence === null) return null

  const tone =
    confidence >= 85 ? { bg: '#F0FDF4', fg: '#15803D' } :
    confidence >= 60 ? { bg: '#FFFBEB', fg: '#B45309' } :
                       { bg: '#FFF1F2', fg: '#BE123C' }

  const title = flags.length === 0
    ? `AI confidence ${confidence}% — no issues flagged`
    : `AI confidence ${confidence}% — flags: ${flags.map(friendlyFlag).join(', ')}`

  return (
    <span
      className="flex h-4 flex-none items-center justify-center rounded px-1.5 font-mono text-[9px] font-bold"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
      title={title}
      data-ai-confidence={confidence}
      data-ai-flags={flags.length > 0 ? flags.join(',') : undefined}
    >
      {confidence}
    </span>
  )
}
