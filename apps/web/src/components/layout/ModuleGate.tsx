import { Outlet } from 'react-router-dom'
import { isModuleSlugEnabled, type ModuleSlug } from '../../config/modules'
import { ModuleDisabledScreen } from './ModuleDisabledScreen'

interface Props { slug: ModuleSlug }

// Route-level guard. Mount this as the `element` of a module's route
// subtree; when the module is in the frozen set, the ModuleDisabledScreen
// shows in place of nested routes. Keeps route definitions mounted so
// bookmarks don't 404 — they just land on a friendly explainer.
export function ModuleGate({ slug }: Props) {
  if (!isModuleSlugEnabled(slug)) {
    return <ModuleDisabledScreen slug={slug} />
  }
  return <Outlet />
}
