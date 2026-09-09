// eCTD node status dot — symbol + colour from CTD_STATUS_META (Module D).
import type { CTDModuleStatus } from '@platform/types'
import { CTD_STATUS_META } from '@platform/types'

interface Props {
  status: CTDModuleStatus
  label?: boolean
}

export function ECTDStatusDot({ status, label }: Props) {
  const meta = CTD_STATUS_META[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      data-ectd-status={status}
    >
      <span className="font-mono text-[12px] leading-none">{meta.symbol}</span>
      {label && <span>{meta.label}</span>}
    </span>
  )
}
