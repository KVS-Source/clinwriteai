// The auto-complete rule of a checklist template item, as the editor builds it (CW-030). A rule is one of
// the three old events or a tagged check the autocheck engine runs (apps/api/.../checklist/auto-complete-tag.ts
// holds the server's copy of these rules and refuses anything else).

export const AUTO_EVENTS = ['submit_for_review', 'crm_complete', 'document_signed'] as const

export type AutoRuleKind =
  | '' | typeof AUTO_EVENTS[number]
  | 'content-min-words' | 'content-no-placeholders' | 'references-complete'
  | 'signal:tlf-validated' | 'signal:crm-resolved' | 'signal:esig-captured' | 'ai-pass'

export interface AutoRuleState { kind: AutoRuleKind; words: string; section: string; meaning: string; profile: string }

export const EMPTY_RULE: AutoRuleState = { kind: '', words: '200', section: '', meaning: '', profile: '' }

/** The tagged checks, in the order the editor lists them. */
export const AUTO_CHECKS: ReadonlyArray<Exclude<AutoRuleKind, '' | typeof AUTO_EVENTS[number]>> = [
  'content-min-words', 'content-no-placeholders', 'references-complete',
  'signal:tlf-validated', 'signal:crm-resolved', 'signal:esig-captured', 'ai-pass',
]

/** Which extra boxes a rule shows. */
export const RULE_FIELDS: Record<AutoRuleKind, ReadonlyArray<'words' | 'section' | 'meaning' | 'profile'>> = {
  '': [], submit_for_review: [], crm_complete: [], document_signed: [],
  'content-min-words': ['words', 'section'],
  'content-no-placeholders': ['section'],
  'references-complete': ['section'],
  'signal:tlf-validated': [], 'signal:crm-resolved': [],
  'signal:esig-captured': ['meaning'],
  'ai-pass': ['profile'],
}

/** Stored tag → the editor's fields. A tag the editor doesn't know is kept as no rule (it can't be edited here). */
export function parseRule(tag: string | null | undefined): AutoRuleState {
  if (!tag) return EMPTY_RULE
  if ((AUTO_EVENTS as readonly string[]).includes(tag)) return { ...EMPTY_RULE, kind: tag as AutoRuleKind }
  const [name = '', ...args] = tag.split(':')
  const n = name.toLowerCase()
  switch (n) {
    case 'content-min-words':       return { ...EMPTY_RULE, kind: n, words: args[0] ?? '', section: args[1] ?? '' }
    case 'content-no-placeholders':
    case 'references-complete':     return { ...EMPTY_RULE, kind: n, section: args[0] ?? '' }
    case 'signal': {
      const s = (args[0] ?? '').toLowerCase()
      if (s === 'tlf-validated' || s === 'crm-resolved') return { ...EMPTY_RULE, kind: `signal:${s}` }
      if (s === 'esig-captured') return { ...EMPTY_RULE, kind: 'signal:esig-captured', meaning: args.slice(1).join(':') }
      return EMPTY_RULE
    }
    case 'ai-pass':                 return { ...EMPTY_RULE, kind: 'ai-pass', profile: args[0] ?? '' }
    default:                        return EMPTY_RULE
  }
}

/** The editor's fields → the tag to send, or null for "tick by hand". */
export function buildRule(r: AutoRuleState): string | null {
  const section = r.section.trim()
  switch (r.kind) {
    case '':                        return null
    case 'content-min-words':       return `content-min-words:${r.words.trim()}${section ? `:${section}` : ''}`
    case 'content-no-placeholders':
    case 'references-complete':     return section ? `${r.kind}:${section}` : r.kind
    case 'signal:esig-captured':    return r.meaning.trim() ? `signal:esig-captured:${r.meaning.trim()}` : 'signal:esig-captured'
    case 'ai-pass':                 return `ai-pass:${r.profile.trim().toLowerCase()}`
    default:                        return r.kind
  }
}

/** Whether the fields make a complete rule (the Save button waits for it). */
export function ruleComplete(r: AutoRuleState): boolean {
  if (r.kind === 'content-min-words') return /^\d+$/.test(r.words.trim()) && Number(r.words) >= 1
  if (r.kind === 'ai-pass') return /^[a-z0-9][a-z0-9-]{0,39}$/i.test(r.profile.trim())
  return true
}
