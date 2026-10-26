// Module E atomised-content edit history panel.
//
// Thin wrapper around the shared EditHistoryPanel for a card + channel
// pairing. Opens from an edit-history affordance on the atomised-content
// surface (added by the Module E UI when it chooses to adopt it).

import { ideationPublishingApi } from '../modules/ideation-publishing/api/ideationPublishing'
import { EditHistoryPanel, type EditOrigin } from './EditHistoryPanel'

interface Props {
  cardId:  string
  channel: string
  /** Short label e.g. "Primary PFS Efficacy Result — LinkedIn". */
  label?: string
}

export function AtomisedHistoryPanel({ cardId, channel, label }: Props) {
  return (
    <EditHistoryPanel
      subject="channel adaptation"
      header={label ?? `${channel} adaptation`}
      queryKey={['atomised-history', cardId, channel]}
      invalidationKeys={[['atomised', cardId]]}
      loader={({ mine, origin }) =>
        ideationPublishingApi.getAtomisedHistory(cardId, channel, {
          mine,
          origin: origin as EditOrigin | undefined,
        })
      }
      revert={(editHistoryId) => ideationPublishingApi.revertAtomisedEdit(editHistoryId)}
    />
  )
}
