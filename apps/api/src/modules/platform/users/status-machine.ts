// User status transitions — pure, default-forbidden.
//
//   invited      -- accept      --> active
//   invited      -- deprovision --> deprovisioned   (invitation withdrawn)
//   active       -- suspend     --> suspended
//   active       -- deprovision --> deprovisioned
//   suspended    -- reactivate  --> active
//   suspended    -- deprovision --> deprovisioned
//   deprovisioned: terminal (Part 11 §11.100(a): ids are never reused)
//
// Anything not listed is rejected. Note `reactivate` is NOT valid from
// 'invited': an invitee becomes active only by accepting the invitation.

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deprovisioned'
export type UserEvent = 'accept' | 'suspend' | 'reactivate' | 'deprovision'

const TRANSITIONS: Record<UserStatus, Partial<Record<UserEvent, UserStatus>>> = {
  invited: { accept: 'active', deprovision: 'deprovisioned' },
  active: { suspend: 'suspended', deprovision: 'deprovisioned' },
  suspended: { reactivate: 'active', deprovision: 'deprovisioned' },
  deprovisioned: {},
}

export type TransitionResult =
  | { ok: true; from: UserStatus; to: UserStatus }
  | { ok: false; from: UserStatus; event: UserEvent }

export function isUserStatus(value: string): value is UserStatus {
  return value in TRANSITIONS
}

export function transition(from: UserStatus, event: UserEvent): TransitionResult {
  const to = TRANSITIONS[from][event]
  if (!to) return { ok: false, from, event }
  return { ok: true, from, to }
}

// Event needed to move a user to `target`, or null when no single event does.
// Lets the generic PATCH { status } route through the same table.
export function eventForTarget(from: UserStatus, target: UserStatus): UserEvent | null {
  if (from === target) return null
  for (const [event, to] of Object.entries(TRANSITIONS[from]) as Array<[UserEvent, UserStatus]>) {
    // 'accept' is reserved for the invitation flow; it can't be requested directly.
    if (to === target && event !== 'accept') return event
  }
  return null
}
