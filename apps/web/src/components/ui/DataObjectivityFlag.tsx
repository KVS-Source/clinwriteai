// Data objectivity flag for CTD Module 2 editor (Module D).
// Purple dashed underline over a piece of text that trips the objectivity check (superlatives,
// unsupported comparators). Hovering shows the suggested rewrite. Advisory only — never blocking.
import { useState, type ReactNode } from 'react'

interface Props {
  text:        string
  suggestion:  string
  children?:   ReactNode
}

export function DataObjectivityFlag({ text, suggestion, children }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className="relative inline-block cursor-help"
      style={{ textDecoration: 'underline dashed', textDecorationColor: '#7C3AED', textUnderlineOffset: '3px' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      data-data-objectivity-flag
      data-flagged-text={text}
    >
      {children ?? text}
      {open && (
        <span
          className="absolute left-0 top-full z-40 mt-1 w-max max-w-[320px] rounded-md p-2 text-[11px]"
          style={{ backgroundColor: '#F5F3FF', color: '#5B21B6', border: '1px solid #DDD6FE', boxShadow: '0 4px 12px rgba(15,23,42,0.08)' }}
          role="tooltip"
        >
          <span className="font-mono text-[10px] uppercase" style={{ letterSpacing: '0.08em', color: '#7C3AED' }}>
            Data objectivity · advisory
          </span>
          <br />
          <span>{suggestion}</span>
        </span>
      )}
    </span>
  )
}
