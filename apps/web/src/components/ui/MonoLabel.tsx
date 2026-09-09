import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

export function MonoLabel({ children, className = '' }: Props) {
  return (
    <span className={`font-mono text-[10px] font-medium uppercase tracking-widest ${className}`}>
      {children}
    </span>
  )
}
