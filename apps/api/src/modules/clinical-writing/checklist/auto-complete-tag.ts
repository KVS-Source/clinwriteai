// What a template item may carry in `autoCompleteOn` (CW-030). The engine reads these tags
// (autocheck/engine.ts); the template editor used to accept only the three old triggers, so a
// tagged strategy could never be set from the screen. Anything else is refused here, because an
// unknown tag is silently skipped by the engine and the item would just never auto-complete.
//
//   submit_for_review | crm_complete | document_signed       old triggers (fire on that event)
//   content-min-words:<n>[:<section>]                          at least n words (whole document or one section)
//   content-no-placeholders[:<section>]                        no [TBD] / [TBD: ...] / [PLACEHOLDER] / [REF]
//   references-complete[:<section>]                            no unresolved citations; sections with text cite a source
//   signal:tlf-validated | signal:crm-resolved                 project / meeting signals
//   signal:esig-captured[:<meaning>]                           a signature (of that meaning) is recorded
//   ai-pass:<profile>                                          the named AI review found no critical issues

export const LEGACY_AUTO_TRIGGERS = ['submit_for_review', 'crm_complete', 'document_signed'] as const

/** Strategies the editor offers, in the order it lists them. `args` says what follows the name. */
export const AUTO_COMPLETE_STRATEGIES = [
  { value: 'content-min-words',       args: 'words+section?' },
  { value: 'content-no-placeholders', args: 'section?' },
  { value: 'references-complete',     args: 'section?' },
  { value: 'signal:tlf-validated',    args: '' },
  { value: 'signal:crm-resolved',     args: '' },
  { value: 'signal:esig-captured',    args: 'meaning?' },
  { value: 'ai-pass',                 args: 'profile' },
] as const

const SECTION = /^[^:\s]{1,20}$/                 // as the section's number is stored, e.g. "§11.4"
const PROFILE = /^[a-z0-9][a-z0-9-]{0,39}$/
const MEANING = /^[A-Za-z0-9 _-]{1,60}$/
const MAX_WORDS = 100_000

/** null when the tag is valid, otherwise the reason it isn't. The caller stores the returned-normalised form. */
export function autoCompleteTagError(raw: string): string | null {
  const tag = raw.trim()
  if ((LEGACY_AUTO_TRIGGERS as readonly string[]).includes(tag)) return null
  const [name = '', ...args] = tag.split(':')
  const section = (a: string | undefined) => a === undefined || SECTION.test(a)

  switch (name.toLowerCase()) {
    case 'content-min-words': {
      const n = Number(args[0])
      if (!/^\d+$/.test(args[0] ?? '') || n < 1 || n > MAX_WORDS) return `content-min-words needs a word count from 1 to ${MAX_WORDS}, for example content-min-words:200.`
      if (args.length > 2 || !section(args[1])) return 'content-min-words takes at most one section after the word count, for example content-min-words:200:§11.4.'
      return null
    }
    case 'content-no-placeholders':
    case 'references-complete':
      return args.length <= 1 && section(args[0]) ? null : `${name} takes at most one section, for example ${name}:§11.4.`
    case 'signal': {
      const signal = (args[0] ?? '').toLowerCase()
      if (signal === 'tlf-validated' || signal === 'crm-resolved') return args.length === 1 ? null : `signal:${signal} takes no further part.`
      if (signal === 'esig-captured') return args.length <= 2 && (args[1] === undefined || MEANING.test(args[1])) ? null : 'signal:esig-captured takes at most one signature meaning.'
      return 'Unknown signal. Use signal:tlf-validated, signal:crm-resolved or signal:esig-captured.'
    }
    case 'ai-pass':
      return args.length === 1 && PROFILE.test(args[0] ?? '') ? null : 'ai-pass needs a profile name in lower case, for example ai-pass:consistency.'
    default:
      return 'Unknown auto-complete rule. Use submit_for_review, crm_complete, document_signed, content-min-words, content-no-placeholders, references-complete, signal:<name> or ai-pass:<profile>.'
  }
}

/** The stored form: trimmed, with the strategy name in lower case (arguments keep their case). */
export function normaliseAutoCompleteTag(raw: string): string {
  const tag = raw.trim()
  if ((LEGACY_AUTO_TRIGGERS as readonly string[]).includes(tag)) return tag
  const [name = '', ...args] = tag.split(':')
  return [name.toLowerCase(), ...(name.toLowerCase() === 'signal' && args[0] ? [args[0].toLowerCase(), ...args.slice(1)] : args)].join(':')
}
