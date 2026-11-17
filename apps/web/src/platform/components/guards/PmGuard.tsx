// PmGuard - pages only a Project Manager uses (TA Tags). IT Admin is sent home, like any other role.
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePlatformStore } from '../../store'
import { holdsRole } from '../../../config/roles'

export function PmGuard({ children }: { children: ReactNode }) {
  const currentUser = usePlatformStore(s => s.currentUser)
  if (!holdsRole(currentUser, 'pm')) return <Navigate to="/home" replace />
  return <div data-guard="pm" data-guard-role={currentUser.role}>{children}</div>
}
