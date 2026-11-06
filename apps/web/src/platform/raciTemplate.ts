// The role-based RACI template and how a person maps onto it, shared by the RACI Matrix screen and
// the onboarding wizard's "Your role" step. The template ships with the web bundle; the API only
// stores per-project overrides (GET /projects/:id/raci, one row per `${module}:${taskId}` activity).

import type { PlatformUser, ProjectRaciAssignment, RACIRole, RaciMatrix } from '@platform/types'
import raciTemplate from '../data/raciMatrix.json'
import { PLATFORM_DEMO_USERS } from './store/platformStore'
import { rolesOf } from '../config/roles'

export type RaciModuleKey = 'A' | 'B' | 'C' | 'D' | 'E'

export const DEFAULT_RACI_TEMPLATE = raciTemplate as RaciMatrix

export const raciActivityKey = (module: RaciModuleKey, taskId: string) => `${module}:${taskId}`

// The API's user-role enum (clinical-writer, reviewer, …) has no RACI roles
// (clinical-lead, qc-checker, e-signatory, …). Until it does, the demo persona
// roster — which shares user ids with the API seed — supplies them.
const DEMO_ROLE_BY_ID = new Map(PLATFORM_DEMO_USERS.map(u => [u.id, u.role]))
export const raciRoleOf = (u: PlatformUser): string => DEMO_ROLE_BY_ID.get(u.id) ?? u.role

export interface MyRaciRow { taskId: string; task: string; mark: RACIRole }

// This person's rows for a module. A task customised on the project (it has an override) counts the
// people saved on it, by user id, and the template no longer applies to it. Any other task uses the
// template's mark for a role they hold. Someone with several marks gets the strongest (A > R > C > I).
const MARK_STRENGTH: RACIRole[] = ['A', 'R', 'C', 'I']
export function myRaciRows(user: PlatformUser, module: RaciModuleKey, overrides: ProjectRaciAssignment[]): MyRaciRow[] {
  const byActivity = new Map(overrides.map(o => [o.activity, o]))
  const columns = new Set([raciRoleOf(user), ...rolesOf(user)])
  const rows: MyRaciRow[] = []
  for (const task of DEFAULT_RACI_TEMPLATE.modules[module]?.tasks ?? []) {
    const o = byActivity.get(raciActivityKey(module, task.id))
    const assignments = task.assignments as Record<string, RACIRole | undefined>
    const marks: RACIRole[] = o
      ? [
          ...(o.accountableId === user.id ? ['A' as const] : []),
          ...(o.responsibleId === user.id ? ['R' as const] : []),
          ...(o.consultedIds.includes(user.id) ? ['C' as const] : []),
          ...(o.informedIds.includes(user.id) ? ['I' as const] : []),
        ]
      : [...columns].map(c => assignments[c]).filter((m): m is RACIRole => !!m)
    const mark = MARK_STRENGTH.find(m => marks.includes(m))
    if (mark) rows.push({ taskId: task.id, task: task.label, mark })
  }
  return rows
}
