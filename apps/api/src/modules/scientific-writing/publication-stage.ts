// Publication lifecycle stage machine.
//
// Linear forward stage advancement is the common path (planning → authoring
// → review → submission → published), but the stage model also permits
// bounces back one step for revision rounds (e.g. a journal R&R moves the
// doc from `submission` back to `authoring`). `published` is terminal — a
// retraction creates a *new* publication rather than mutating the published
// one.

export type PublicationStage =
  | 'planning'
  | 'authoring'
  | 'review'
  | 'submission'
  | 'published'

export const PUBLICATION_STAGES = [
  'planning', 'authoring', 'review', 'submission', 'published',
] as const

const ALLOWED: Record<PublicationStage, ReadonlyArray<PublicationStage>> = {
  planning: ['authoring'],
  authoring: ['review'],
  review: ['submission', 'authoring'],         // reviewer bounce
  submission: ['published', 'authoring'],      // journal R&R bounce
  published: [],                               // terminal
}

export function canAdvancePublication(from: PublicationStage, to: PublicationStage): boolean {
  if (from === to) return false
  return ALLOWED[from]?.includes(to) ?? false
}

export function nextPublicationStage(from: PublicationStage): PublicationStage | null {
  // Default advancement = the first entry in ALLOWED (the forward direction).
  return ALLOWED[from]?.[0] ?? null
}

export class InvalidPublicationStageError extends Error {
  constructor(from: PublicationStage, to: PublicationStage) {
    super(
      `Invalid publication stage transition: ${from} → ${to}. ` +
      `Allowed next: ${ALLOWED[from]?.join(', ') || '(terminal)'}`,
    )
    this.name = 'InvalidPublicationStageError'
  }
}
