// Gateway ACK timeline — receipt / format-validation / acceptance milestones with elapsed time (Module D).
import type { GatewaySubmissionRecord } from '@platform/types'

interface Props {
  record: GatewaySubmissionRecord
}

interface Milestone {
  key:     'transmit' | 'ack1' | 'ack2' | 'ack3'
  label:   string
  at:      string | null
  elapsed?: string
}

function formatElapsedMinutes(mins?: number): string {
  if (mins == null) return ''
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}
function formatElapsedHours(hours?: number): string {
  if (hours == null) return ''
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h}h ${m}m`
}

export function GatewayACKTimeline({ record }: Props) {
  const milestones: Milestone[] = [
    { key: 'transmit', label: 'Transmitted',                at: record.transmittedAt },
    { key: 'ack1',     label: 'ACK1 · Receipt',             at: record.ack1At, elapsed: formatElapsedMinutes(record.ack1ElapsedMinutes) },
    { key: 'ack2',     label: 'ACK2 · Format validation',   at: record.ack2At, elapsed: formatElapsedHours(record.ack2ElapsedHours) },
    { key: 'ack3',     label: 'ACK3 · Accepted for review', at: record.ack3At, elapsed: formatElapsedHours(record.ack3ElapsedHours) },
  ]

  return (
    <ol className="flex flex-col gap-2" data-gateway-ack-timeline={record.id}>
      {milestones.map(m => {
        const done  = !!m.at
        const dotBg = done ? '#15803D' : '#CBD5E1'
        return (
          <li key={m.key} className="flex items-start gap-2" data-ack-milestone={m.key} data-ack-done={done}>
            <span className="mt-1.5 inline-block h-2 w-2 flex-none rounded-full" style={{ backgroundColor: dotBg }} />
            <div className="flex-1">
              <p className="text-[13px] font-semibold" style={{ color: done ? '#0F172A' : '#94A3B8' }}>{m.label}</p>
              <p className="font-mono text-[11px]" style={{ color: done ? '#64748B' : '#CBD5E1' }}>
                {done ? new Date(m.at!).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Pending'}
                {done && m.elapsed && <> · <span className="text-slate-500">{m.elapsed}</span></>}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
