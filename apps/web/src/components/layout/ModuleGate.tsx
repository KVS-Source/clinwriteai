import { Outlet } from 'react-router-dom'
import { MODULE_SLUG_TO_KEY, isModuleSlugEnabled, type ModuleSlug } from '../../config/modules'
import { isAdminRole } from '../../config/roles'
import { usePlatformStore } from '../../platform/store/platformStore'
import { ModuleDisabledScreen } from './ModuleDisabledScreen'
import { ModuleNoAccessScreen } from './ModuleNoAccessScreen'

interface Props { slug: ModuleSlug }

// Route-level guard. Mount this as the `element` of a module's route
// subtree; when the module is in the frozen set, the ModuleDisabledScreen
// shows in place of nested routes. Keeps route definitions mounted so
// bookmarks don't 404 — they just land on a friendly explainer.
//
// Second check, per user: a module the signed-in user was not given (their profile's module list)
// shows the no-access screen, the same rule the sidebar uses for its "NO ACCESS" label. Admins are
// not held to it, as in the sidebar.
export function ModuleGate({ slug }: Props) {
  const currentUser = usePlatformStore(s => s.currentUser)
  if (!isModuleSlugEnabled(slug)) {
    return <ModuleDisabledScreen slug={slug} />
  }
  if (!isAdminRole(currentUser.role) && !currentUser.modules.includes(MODULE_SLUG_TO_KEY[slug])) {
    return <ModuleNoAccessScreen slug={slug} />
  }
  return <Outlet />
}
