// Which of a two-role user's roles a notification belongs to (role switcher — auth/active-role.ts).
//
// A user holding Project manager + Contributor works as one at a time. Their feed lists every
// notification, but one meant for the other role is opened only after switching: the Notification
// Centre shows a warning with a "Switch to …" action instead of the notification (the web decides from
// `forRole`). Worked out from the kind when the feed is read, so older notifications get it too.
//
//   Project manager — being added as a project's PM, project calendar overdue alerts, a newer
//                     checklist template affecting a project document.
//   Contributor     — document work on a RACI letter: signature requests, @mentions, a document sent
//                     back to its author, nudges, adopting a newer checklist template. A PM alone can't
//                     do that work (signatures/access.ts).
//   Anything else (invitations, AI quota…) belongs to no particular role.
//
// Only for users holding more than one role, and only a role they hold; otherwise null.

export const PM_NOTIFICATION_KINDS: ReadonlySet<string> = new Set([
  'project_manager_added',
  'calendar_entry_overdue',
  'checklist_template_update_project',   // a newer checklist template affects a project document
])

export const CONTRIBUTOR_NOTIFICATION_KINDS: ReadonlySet<string> = new Set([
  'signature_requested',
  'comment.mention',
  'document.returned_to_authoring',
  'document_nudge',
  'checklist_template_update',           // the Author may adopt a newer checklist template
])

export function notificationRole(kind: string, heldRoles: readonly string[]): string | null {
  if (heldRoles.length < 2) return null
  const role = PM_NOTIFICATION_KINDS.has(kind) ? 'pm' : CONTRIBUTOR_NOTIFICATION_KINDS.has(kind) ? 'contributor' : null
  return role && heldRoles.includes(role) ? role : null
}
