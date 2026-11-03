// Module B peer-review response history panel.
//
// Thin wrapper around the shared EditHistoryPanel for a specific
// ReviewerComment. Opens from an edit-history clock icon on the response
// editor (PeerReviewResponse screen).

import { useTranslation } from 'react-i18next'
import { publicationsApi } from '../api/publications'
import { EditHistoryPanel, type EditOrigin } from './EditHistoryPanel'

interface Props {
  roundId:   string
  commentId: string
  /** Short label e.g. "Reviewer 1 · Comment 3". */
  label?: string
}

export function PeerReviewHistoryPanel({ roundId, commentId, label }: Props) {
  const { t } = useTranslation()
  return (
    <EditHistoryPanel
      subject={t('page.peer_review_history_panel.subject')}
      header={label ?? t('page.peer_review_history_panel.header_default')}
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
