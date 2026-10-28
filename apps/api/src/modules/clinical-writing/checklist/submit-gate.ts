// Submit-for-Review gate decision — pure function.
//
// Per docs/roles-and-permissions.md §11.3:
//   - Any mandatory item (frameworkMandatory=true) still 'pending'  → BLOCK
//     Hard refusal; no override.
//   - Any optional item still 'pending'                              → WARN
//     Submit proceeds only if the R supplies a reason.
//   - Nothing pending (or everything waived/completed)                → CLEAN
//
// 'waived' and 'complete' are terminal — they never block. Items for
// future stages are irrelevant to a submit at the current stage, but
// this v1 evaluates ALL non-terminal items regardless of stage so the
// R can't dodge a mandatory item by labelling it "later stage" after
// the fact. Stage-aware filtering is a Chunk 3 refinement.

export type ChecklistItemStatus = 'pending' | 'complete' | 'waived'

export interface ChecklistItemForGate {
  id: string
  text: string
  framework: string
  frameworkMandatory: boolean
  status: ChecklistItemStatus
  stage: string
}

export type SubmitGateDecision =
  | { kind: 'clean' }
  | { kind: 'warn'; pendingOptional: ChecklistItemForGate[] }
  | { kind: 'block'; pendingMandatory: ChecklistItemForGate[]; pendingOptional: ChecklistItemForGate[] }

export function evaluateSubmitGate(items: ChecklistItemForGate[]): SubmitGateDecision {
  const pendingMandatory: ChecklistItemForGate[] = []
  const pendingOptional:  ChecklistItemForGate[] = []

  for (const i of items) {
    if (i.status !== 'pending') continue
    if (i.frameworkMandatory) pendingMandatory.push(i)
    else pendingOptional.push(i)
  }

  if (pendingMandatory.length > 0) {
    return { kind: 'block', pendingMandatory, pendingOptional }
  }
  if (pendingOptional.length > 0) {
    return { kind: 'warn', pendingOptional }
  }
  return { kind: 'clean' }
}
