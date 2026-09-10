// Per-channel atomisation spinner (Module E DD-E-004).
// Never a single shared spinner — each channel resolves independently.
import type { ChannelFormat } from '@platform/types'
import { CHANNEL_META } from '@platform/types'

interface Props {
  channels:   ChannelFormat[]
  completing: ChannelFormat[]
}

export function AtomisationSpinner({ channels, completing }: Props) {
  return (
    <ul className="flex flex-wrap gap-2" data-atomisation-spinner>
      {channels.map(ch => {
        const isDone      = !completing.includes(ch)
        const label       = CHANNEL_META[ch]?.label ?? ch
        return (
          <li
            key={ch}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
            style={{
              backgroundColor: isDone ? '#F0FDFA' : '#F1F5F9',
              color:           isDone ? '#0F766E' : '#64748B',
              border:          `1px solid ${isDone ? '#99F6E4' : '#E2E8F0'}`,
              fontSize:        11,
              fontWeight:      600,
            }}
            data-channel-spinner={ch}
            data-channel-completing={!isDone || undefined}
            data-channel-done={isDone || undefined}
          >
            {isDone ? (
              <span aria-label="Done" className="font-mono">✓</span>
            ) : (
              <span
                aria-label="Generating"
                className="inline-block h-2.5 w-2.5 flex-none animate-spin rounded-full border-2 border-slate-300"
                style={{ borderTopColor: '#0D9488' }}
              />
            )}
            {label}
          </li>
        )
      })}
    </ul>
  )
}
