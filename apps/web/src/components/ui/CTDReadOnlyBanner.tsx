// Full-width read-only banner shown on every Module 5 CTD node (Module D DD-D-001).
// Steel blue #005F8E — blocking styling that is deliberately not red.

export function CTDReadOnlyBanner() {
  return (
    <div
      className="flex items-center gap-2 rounded-md px-3 py-2 text-[12px]"
      style={{ backgroundColor: '#EFF6FF', color: '#005F8E', border: '1px solid #93C5FD' }}
      data-ctd-read-only-banner
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-none" aria-hidden>
        <path d="M4 6V4.5a3 3 0 116 0V6" stroke="#005F8E" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <rect x="3" y="6" width="8" height="6" rx="1" stroke="#005F8E" strokeWidth="1.4" fill="none" />
      </svg>
      <span className="font-semibold">Read-only · Module A</span>
      <span>·</span>
      <span>Module 5 CSRs are imported from Module A. Any change requires a new CSR version in Module A (DD-D-001).</span>
    </div>
  )
}
