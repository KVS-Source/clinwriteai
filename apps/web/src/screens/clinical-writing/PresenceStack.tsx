// Header presence stack ("N active") — shared by the Document Editor and the
// Reviewer View (FR-A-053 / AC-A-037). Built from the live presence snapshot
// (GET /documents/:id/presence, refreshed on Socket.io presence:changed and a
// 15s poll); each screen keeps its own session live via useDocumentPresence.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PlatformUser } from '@platform/types'
import { usePresenceSnapshot } from '../../hooks/usePresence'
import { platformApi } from '../../platform/api/platformApi'

// Deterministic colour for a user's presence avatar — hashed from userId
// so the same user always gets the same colour across sessions.
const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#DBEAFE', fg: '#1D4ED8' },  // blue
  { bg: '#F5F3FF', fg: '#7C3AED' },  // purple
  { bg: '#FEF3C7', fg: '#D97706' },  // amber
  { bg: '#D1FAE5', fg: '#065F46' },  // green
  { bg: '#FEE2E2', fg: '#B91C1C' },  // red
  { bg: '#E0E7FF', fg: '#3730A3' },  // indigo
  { bg: '#FCE7F3', fg: '#9D174D' },  // pink
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function avatarColor(userId: string) {
  return AVATAR_PALETTE[hashString(userId) % AVATAR_PALETTE.length]
}

function initialsFromName(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || fallback
}

export function PresenceStack({ documentId, currentUserId, currentUserName }: {
  documentId: string
  currentUserId?: string | null
  /** Fallback for the viewer's own avatar — non-admins can't read /admin/users. */
  currentUserName?: string | null
}) {
  const { data: presenceSnapshot } = usePresenceSnapshot(documentId, { pollMs: 15_000 })

  // Resolve user id → PlatformUser so avatars can show initials + full
  // name tooltip without the presence payload having to carry them.
  const { data: platformUsers = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
    staleTime: 60_000,
  })
  const usersById = useMemo(() => new Map(platformUsers.map(u => [u.id, u])), [platformUsers])

  const stack = useMemo(() => {
    if (!presenceSnapshot) return []
    // Flatten all section rooms + dedupe by userId (same user may appear
    // on two sections if they rapidly navigated). "active" wins over
    // "idle" when the same user is in multiple states.
    const bestByUser = new Map<string, { userId: string; userName?: string | null; status: 'active' | 'idle' | 'ended' }>()
    for (const section of presenceSnapshot.sections) {
      for (const user of section.users) {
        const existing = bestByUser.get(user.userId)
        if (!existing || (existing.status !== 'active' && user.status === 'active')) {
          bestByUser.set(user.userId, { userId: user.userId, userName: user.userName, status: user.status })
        }
      }
    }
    return Array.from(bestByUser.values())
      .filter(u => u.status !== 'ended')
      .map(u => {
        const name = u.userName ?? usersById.get(u.userId)?.name ?? (u.userId === currentUserId ? currentUserName : null)
        return {
          userId: u.userId,
          name: name ?? 'Unknown',
          initials: initialsFromName(name),
          isCurrentUser: currentUserId === u.userId,
          color: avatarColor(u.userId),
          status: u.status,
        }
      })
  }, [presenceSnapshot, usersById, currentUserId, currentUserName])

  return (
    <>
      <div className="flex flex-none items-center" data-presence-stack>
        {stack.slice(0, 5).map((p, i) => (
          <div
            key={p.userId}
            title={`${p.name}${p.isCurrentUser ? ' (you)' : ''} · ${p.status}`}
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
            style={{
              backgroundColor: p.color.bg,
              color: p.color.fg,
              boxShadow: p.isCurrentUser
                ? '0 0 0 2px #FFFFFF, 0 0 0 4px #2563EB'
                : '0 0 0 2px #FFFFFF',
              opacity: p.status === 'idle' ? 0.55 : 1,
              marginLeft: i === 0 ? 0 : -6,
              zIndex: 5 - i,
            }}
          >
            {p.initials}
          </div>
        ))}
        {stack.length > 5 && (
          <div
            title={`+${stack.length - 5} more`}
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-200 font-mono text-[10px] font-bold text-slate-600"
            style={{ boxShadow: '0 0 0 2px #FFFFFF', marginLeft: -6 }}
          >
            +{stack.length - 5}
          </div>
        )}
      </div>

      <span className="h-5 w-px" style={{ backgroundColor: '#E2E8F0' }} />
      <span className="flex-none text-xs text-slate-500">
        {stack.length === 0 ? 'Only you' : `${stack.length} active`}
      </span>
    </>
  )
}
