// /projects/:projectId — now a lightweight redirect to the Projects list
// with the overview panel auto-opened for the project in the URL.
//
// The full ProjectDashboard page (ProjectDashboard.tsx) was retired once
// its content moved into ProjectOverviewPanel + the row-level
// DocumentCountChips. Deep-links kept working by landing users on the
// list with the same project pre-selected — same visible outcome, less
// screen chrome to navigate. Component kept on disk for a quick revert
// if we discover something the panel can't carry; just swap the
// index route back in router/index.tsx.

import { Navigate, useParams } from 'react-router-dom'

export function ProjectDashboardRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return <Navigate to="/projects" replace />
  return <Navigate to={`/projects?open=${encodeURIComponent(projectId)}`} replace />
}
