// Module B peer-review response history panel.
//
// Thin wrapper around the shared EditHistoryPanel for a specific
// ReviewerComment. Opens from an edit-history clock icon on the response
// editor (PeerReviewResponse screen).

import { publicationsApi } from '../api/publications'
import { EditHistoryPanel, type EditOrigin } from './EditHistoryPanel'

interface Props {
  roundId:   string
  commentId: string
  /** Short label e.g. "Reviewer 1 · Comment 3". */
  label?: string
}

export function PeerReviewHistoryPanel({ roundId, commentId, label }: Props) {
  return (
    <EditHistoryPanel
      subject="response"
      header={label ?? 'Peer review response'}
      queryKey={['peer-review-history', roundId, commentId]}
      invalidationKeys={[['review-comments', roundId]]}
      loader={({ mine, origin }) =>
        publicationsApi.getPeerReviewHistory(roundId, commentId, {
          mine,
          origin: origin as EditOrigin | undefined,
        })
      }
      revert={(editHistoryId) => publicationsApi.revertPeerReviewEdit(editHistoryId)}
    />
  )
}
