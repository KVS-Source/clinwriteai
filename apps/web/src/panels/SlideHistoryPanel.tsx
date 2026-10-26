// Module B slide edit history panel.
//
// Thin wrapper around the shared EditHistoryPanel for a single Slide.
// Opens from the clock icon in the SlidedeckGenerator slide editor.
// History payloads serialise title + bodyText + speakerNotes together;
// the API returns the title in the display sugar so entries read as
// "By X · 2m ago" with the title line underneath.

import { platformApi } from '../platform/api/platformApi'
import { EditHistoryPanel, type EditOrigin } from './EditHistoryPanel'

interface Props {
  slideId: string
  /** Short label e.g. "Slide 3 · Primary efficacy". */
  label?: string
}

export function SlideHistoryPanel({ slideId, label }: Props) {
  return (
    <EditHistoryPanel
      subject="slide"
      header={label ?? 'Slide'}
      queryKey={['slide-history', slideId]}
      invalidationKeys={[['slide-deck'], ['slide', slideId]]}
      loader={({ mine, origin }) =>
        platformApi.getSlideHistory(slideId, {
          mine,
          origin: origin as EditOrigin | undefined,
        })
      }
      revert={(editHistoryId) => platformApi.revertSlideEdit(editHistoryId)}
    />
  )
}
