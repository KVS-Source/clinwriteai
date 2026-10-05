// Cutover toggles — the pure read-env side, separated from the handler
// registry so the UI badge + main-chunk bootstrap can inspect state without
// pulling the whole MSW handler tree into the main bundle.
//
// Keeping this file dependency-free (no handler imports) lets Vite tree-shake
// handlers out of the prod bundle entirely when every group is turned off.

export type ToggleName =
  | 'AUTH' | 'PROJECTS'
  | 'MODULE_A' | 'MODULE_B' | 'MODULE_C' | 'MODULE_D' | 'MODULE_E'

export const ALL_TOGGLES: ToggleName[] = [
  'AUTH', 'PROJECTS',
  'MODULE_A', 'MODULE_B', 'MODULE_C', 'MODULE_D', 'MODULE_E',
]

export function flag(name: ToggleName): 'on' | 'off' | 'force' {
  const raw = (import.meta.env[`VITE_MOCK_${name}`] as string | undefined)?.toLowerCase()
  if (raw === 'off') return 'off'
  if (raw === 'force') return 'force'
  return 'on'
}

export function activeMockGroups(): ToggleName[] {
  return ALL_TOGGLES.filter(name => flag(name) !== 'off')
}

export function anyMocksEnabled(): boolean {
  return activeMockGroups().length > 0
}
