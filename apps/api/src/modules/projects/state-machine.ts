// Project lifecycle state machine.
//
// Statuses mirror the Prisma Project.status field (platform.prisma) and the
// prototype's data/study.json shape. Allowed transitions are intentionally
// permissive on the human workflow side (ongoing↔on-hold both ways) and
// strict on the terminal side (closed is a one-way street, reopen requires
// going through 're-open' explicitly).

export type ProjectStatus =
  | 'initiated'
  | 'ongoing'
  | 'on-hold'
  | 're-open'
  | 'closed'

export const PROJECT_STATUSES = ['initiated', 'ongoing', 'on-hold', 're-open', 'closed'] as const

const ALLOWED: Record<ProjectStatus, ReadonlyArray<ProjectStatus>> = {
  initiated: ['ongoing', 'on-hold', 'closed'],
  ongoing: ['on-hold', 'closed'],
  'on-hold': ['ongoing', 'closed'],
  closed: ['re-open'],       // only path out of closed
  're-open': ['ongoing', 'on-hold', 'closed'],
}

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return false
  return ALLOWED[from]?.includes(to) ?? false
}

export function nextStates(from: ProjectStatus): ReadonlyArray<ProjectStatus> {
  return ALLOWED[from] ?? []
}

export class InvalidTransitionError extends Error {
  constructor(from: ProjectStatus, to: ProjectStatus) {
    super(`Invalid project transition: ${from} → ${to}. Allowed next states: ${nextStates(from).join(', ') || '(terminal)'}`)
    this.name = 'InvalidTransitionError'
  }
}
