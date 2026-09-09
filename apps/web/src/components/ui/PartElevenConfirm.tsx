// 21 CFR Part 11 inline confirmation — expands in place, never a modal (Module D design rule 4).
// Setting confirmingTransmission = true in the gatewayStore is a separate concern of the caller
// via onConfirm; this component is presentational and controls only its own local expand state.
import { useState } from 'react'

interface Props {
  onConfirm:      () => void
  meaning:        string
  signatoryName?: string
  signatoryRole?: string
  triggerLabel?:  string
}

export function PartElevenConfirm({ onConfirm, meaning, signatoryName, signatoryRole, triggerLabel }: Props) {
  const [open, setOpen]   = useState(false)
  const [checked, setChk] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-part-eleven-trigger
        className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
        style={{ backgroundColor: '#B0200D' }}
      >{triggerLabel ?? 'Transmit to gateway'}</button>
    )
  }

  return (
    <div
      className="rounded-md border p-3"
      style={{ backgroundColor: '#FFF5F5', borderColor: '#FFC5C5' }}
      data-part-eleven-confirm
      data-part-eleven-expanded
    >
      <p className="font-mono text-[10px] uppercase" style={{ color: '#B0200D', letterSpacing: '0.08em' }}>21 CFR Part 11 · inline confirmation</p>
      {signatoryName && (
        <p className="mt-1 text-[12px] font-semibold text-slate-800">
          Signatory: {signatoryName}
          {signatoryRole && <span className="ml-1 font-normal text-slate-500">· {signatoryRole}</span>}
        </p>
      )}
      <p className="mt-1 text-[13px] text-slate-800">Meaning: <em>&quot;{meaning}&quot;</em></p>
      <label className="mt-2 flex items-start gap-2 text-[12px] text-slate-700">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChk(e.target.checked)}
          data-part-eleven-checkbox
        />
        <span>I confirm this decision is accurate and I am signing this record under 21 CFR Part 11.</span>
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => { onConfirm(); setOpen(false); setChk(false) }}
          disabled={!checked}
          data-part-eleven-sign
          className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
          style={{ backgroundColor: checked ? '#B0200D' : '#CBD5E1', cursor: checked ? 'pointer' : 'not-allowed' }}
        >Confirm &amp; sign</button>
        <button
          type="button"
          onClick={() => { setOpen(false); setChk(false) }}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700"
        >Cancel</button>
      </div>
    </div>
  )
}
