import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store'

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

interface CheckboxProps {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

function Checkbox({ id, checked, onChange, label }: CheckboxProps) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5">
      <div className="relative mt-0.5 flex-none">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          className="flex h-4 w-4 items-center justify-center rounded"
          style={{
            backgroundColor: checked ? '#2563EB' : '#FFFFFF',
            border: checked ? '1.5px solid #2563EB' : '1.5px solid #CBD5E1',
            transition: 'background-color 0.15s ease, border-color 0.15s ease',
          }}
        >
          {checked && <CheckIcon />}
        </div>
      </div>
      <span className="text-[13px] leading-snug text-slate-900">{label}</span>
    </label>
  )
}

export function TCGate() {
  const navigate = useNavigate()
  const acceptTC = useAuthStore(s => s.acceptTC)

  const [box1, setBox1] = useState(false)
  const [box2, setBox2] = useState(false)

  const bothChecked = box1 && box2

  const handleContinue = () => {
    if (!bothChecked) return
    acceptTC()
    navigate('/projects')
  }

  return (
    // Full viewport dark overlay
    <div
      className="flex min-h-screen items-center justify-center px-4"
      data-screen="tc-gate"
      style={{ backgroundColor: 'rgba(15,23,42,0.6)' }}
    >
      {/* Modal card */}
      <div
        className="w-full max-w-[560px] rounded-xl bg-white p-10"
        style={{ boxShadow: '0 24px 60px rgba(15,23,42,0.28)' }}
      >

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Terms of Service &amp; Data Processing Agreement
          </h1>
          <p className="mt-1.5 font-mono text-[11px] text-slate-500">
            Review and accept before accessing the platform
          </p>
        </div>

        {/* Divider */}
        <div className="my-6 border-t border-slate-200" />

        {/* Scrollable terms */}
        <div
          className="rounded-lg border border-slate-200 bg-slate-50 p-5"
          style={{ height: '240px', overflowY: 'auto' }}
        >
          <div className="flex flex-col gap-5 text-[13px] leading-relaxed text-slate-600">

            <div>
              <p className="mb-1.5 text-sm font-bold text-slate-900">
                1. Platform Use &amp; GxP Compliance
              </p>
              <p>
                This platform is validated for use in GxP-regulated environments.
                All authoring, review, and approval activities are subject to 21 CFR Part 11
                electronic records and signature requirements. Users are responsible for
                maintaining the integrity of records created within this platform.
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-bold text-slate-900">
                2. Data Processing &amp; Confidentiality
              </p>
              <p>
                All clinical study data, documents, and personally identifiable
                information processed within this platform are subject to your organisation&rsquo;s
                data processing agreement. Unauthorised disclosure of clinical data constitutes
                a breach of applicable data protection regulations including GDPR (EU) 2016/679.
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-bold text-slate-900">
                3. Audit Trail &amp; Electronic Signatures
              </p>
              <p>
                Your actions within this platform are logged in a tamper-evident audit
                trail. Electronic signatures applied through this platform carry legal weight
                equivalent to handwritten signatures under 21 CFR Part 11. You are solely
                responsible for all actions performed under your credentials.
              </p>
            </div>

          </div>
        </div>

        {/* Checkboxes */}
        <div className="mt-5 flex flex-col gap-3">
          <Checkbox
            id="tc-box1"
            checked={box1}
            onChange={setBox1}
            label="I have read and accept the Terms of Service and Data Processing Agreement"
          />
          <Checkbox
            id="tc-box2"
            checked={box2}
            onChange={setBox2}
            label="I understand that my actions are logged in a tamper-evident audit trail and that electronic signatures carry legal weight under 21 CFR Part 11"
          />
        </div>

        {/* Continue button */}
        <button
          type="button"
          disabled={!bothChecked}
          onClick={handleContinue}
          className="mt-6 h-11 w-full rounded-lg text-sm font-semibold transition-colors"
          style={{
            backgroundColor: bothChecked ? '#2563EB' : '#E2E8F0',
            color:           bothChecked ? '#FFFFFF' : '#94A3B8',
            cursor:          bothChecked ? 'pointer' : 'not-allowed',
          }}
          onMouseEnter={e => { if (bothChecked) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1D4ED8' }}
          onMouseLeave={e => { if (bothChecked) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2563EB' }}
        >
          Continue to platform
        </button>

      </div>
    </div>
  )
}
