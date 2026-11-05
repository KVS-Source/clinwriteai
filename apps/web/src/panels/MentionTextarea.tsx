import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MentionablePerson } from '../api/documents'

// A textarea that offers the people of the project when you type "@": filter as you type,
// pick with the mouse or Up / Down + Enter (Tab also picks), Esc closes the list. Choosing
// someone writes "@Name " into the text and tells the parent who was picked.

interface Props {
  value: string
  onChange: (text: string) => void
  people: MentionablePerson[]
  onMention: (person: MentionablePerson) => void
  maxLength?: number
  rows?: number
  placeholder?: string
  autoFocus?: boolean
  className?: string
  style?: React.CSSProperties
  id?: string
  'data-composer-text'?: boolean
}

const MAX_SHOWN = 8
// "@" at the start or after whitespace, then the letters typed so far, right before the caret.
const TRIGGER = /(^|\s)@([^\s@]{0,40})$/

// The "@Name" in the text that a picked person stands for: the whole name, not a longer word.
export const mentionPattern = (name: string) =>
  new RegExp(`(^|\\s)@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u')

// The text cut into plain pieces and the pieces shown in blue: each "@Name" of a person who can
// be mentioned, plus the "@word" being typed right now (`active`).
function highlightSegments(text: string, names: string[], active: { start: number; end: number } | null): { text: string; mention: boolean }[] {
  const ranges: { start: number; end: number }[] = []
  if (names.length > 0 && text.includes('@')) {
    const alt = [...names].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const re = new RegExp(`(^|\\s)(@(?:${alt}))(?![\\p{L}\\p{N}])`, 'gu')
    for (const m of text.matchAll(re)) {
      const start = m.index! + m[1]!.length
      ranges.push({ start, end: start + m[2]!.length })
    }
  }
  if (active && active.end > active.start && !ranges.some(r => r.start <= active.start && r.end >= active.end)) ranges.push(active)
  ranges.sort((a, b) => a.start - b.start)
  const out: { text: string; mention: boolean }[] = []
  let last = 0
  for (const r of ranges) {
    if (r.start < last) continue
    if (r.start > last) out.push({ text: text.slice(last, r.start), mention: false })
    out.push({ text: text.slice(r.start, r.end), mention: true })
    last = r.end
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false })
  return out.length > 0 ? out : [{ text, mention: false }]
}

export function MentionTextarea({ value, onChange, people, onMention, maxLength, rows = 3, placeholder, autoFocus, className, style, id, ...rest }: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null)
  const [highlight, setHighlight] = useState(0)

  // Someone already mentioned in this comment is not offered again.
  const available = useMemo(() => people.filter(p => !mentionPattern(p.name).test(value)), [people, value])
  const matches = useMemo(() => {
    if (!trigger) return []
    const q = trigger.query.toLowerCase()
    return available.filter(p => p.name.toLowerCase().includes(q)).slice(0, MAX_SHOWN)
  }, [available, trigger])
  const open = trigger !== null && available.length > 0
  const segments = useMemo(
    () => highlightSegments(value, people.map(p => p.name), trigger ? { start: trigger.start, end: trigger.start + 1 + trigger.query.length } : null),
    [value, people, trigger],
  )
  const backdropRef = useRef<HTMLDivElement>(null)

  function detect(text: string, caret: number) {
    const before = text.slice(0, caret)
    const m = TRIGGER.exec(before)
    if (!m) { setTrigger(null); return }
    setTrigger({ start: caret - m[2]!.length - 1, query: m[2]! })
    setHighlight(0)
  }

  function pick(person: MentionablePerson) {
    if (!trigger || !ref.current) return
    const caret = ref.current.selectionStart
    const insert = `@${person.name} `
    const next = `${value.slice(0, trigger.start)}${insert}${value.slice(caret)}`
    if (maxLength && next.length > maxLength) return
    onChange(next)
    onMention(person)
    setTrigger(null)
    const pos = trigger.start + insert.length
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos) })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTrigger(null); return }
    if (matches.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % matches.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + matches.length) % matches.length) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[highlight]!) }
  }

  return (
    <div className="relative rounded bg-white">
      {/* Behind the textarea, which keeps only the caret and selection: the visible text, with each @Name in bright blue (same weight as the rest, so the caret stays aligned). */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        className={`${className ?? ''} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words !border-transparent text-slate-900`}
        style={{ ...style, scrollbarGutter: 'stable' }}
        data-mention-backdrop
      >
        {segments.map((seg, i) => seg.mention
          ? <mark key={i} style={{ color: '#2563EB', backgroundColor: 'transparent' }} data-mention-mark>{seg.text}</mark>
          : <span key={i}>{seg.text}</span>)}
        {'\u200b'}
      </div>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`${className ?? ''} relative block bg-transparent !text-transparent`}
        style={{ ...style, caretColor: '#0F172A', scrollbarGutter: 'stable' }}
        onScroll={e => { if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop }}
        onChange={e => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart) }}
        onKeyDown={onKeyDown}
        onClick={e => detect(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setTrigger(null)}
        aria-autocomplete="list"
        aria-expanded={open}
        data-composer-text={rest['data-composer-text'] || undefined}
      />
      {open && (
        <ul
          role="listbox"
          aria-label={t('page.comment_composer.mention_list_aria')}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          data-mention-list
        >
          {matches.length === 0 && <li className="px-3 py-2 text-[12px] text-slate-500">{t('page.comment_composer.mention_none')}</li>}
          {matches.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === highlight}
              // mousedown, not click: the textarea must not lose focus before the pick lands
              onMouseDown={e => { e.preventDefault(); pick(p) }}
              onMouseEnter={() => setHighlight(i)}
              data-mention-option={p.id}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] ${i === highlight ? 'bg-blue-50' : ''}`}
            >
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-200 font-mono text-[9px] font-bold text-slate-700">{p.initials ?? p.name.slice(0, 2).toUpperCase()}</span>
              <span className="font-semibold text-slate-900">{p.name}</span>
              {p.projectRole && <span className="truncate text-[11px] text-slate-500">{p.projectRole}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
