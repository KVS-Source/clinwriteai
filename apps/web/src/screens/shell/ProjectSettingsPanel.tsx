// Non-modal, resizable right-side panel wrapper around ProjectSettings.
//
// Replaces the previous full-page navigation to /projects/:id/settings so
// writers can tweak a project's team / status / metadata without losing the
// Project Dashboard (or the Projects list) behind them. Reuses the shared
// SlidePanel component — it already handles the resize handle, width
// persistence per storageKey, Escape-to-close, and non-modal background
// interaction, so this file is just plumbing.
//
// Entry points: the "Project Settings" button on the Project Dashboard
// header, and the gear-icon button on each row of the Projects list.

import { SlidePanel } from '../../components/ui'
import { ProjectSettings } from './ProjectSettings'

interface Props {
  open:           boolean
  onClose:        () => void
  projectId:      string | null
  projectName?:   string
}

export function ProjectSettingsPanel({ open, onClose, projectId, projectName }: Props) {
  // Guard: the panel caller flips `open=true` then supplies the project id
  // on the same render; render nothing until both are present so the
  // underlying query doesn't fire with an undefined id.
  if (!projectId) return null

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      eyebrow="Project Settings"
      title={projectName ?? 'Project Settings'}
      storageKey="project-settings-panel-width"
      defaultWidth={560}
      minWidth={420}
      maxWidth={900}
      expandable
      belowTopBar
    >
      <ProjectSettings projectId={projectId} renderMode="panel" />
    </SlidePanel>
  )
}
