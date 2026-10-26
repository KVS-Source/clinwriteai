// Module D HA response draft history panel.
//
// Thin wrapper around the shared EditHistoryPanel for a HaLoqQuestion's
// draft chain. Opens from the clock icon on the HA response drafting
// screen. Each HA draft is a new version row (append pattern); revert
// creates a new version with the restored text.

import { regulatoryWritingApi } from '../modules/regulatory-writing/api/regulatoryWriting'
import { EditHistoryPanel, type EditOrigin } from './EditHistoryPanel'

interface Props {
  questionId: string
  /** Short label e.g. "Q2.1 · CMC validation protocol". */
  label?: string
}

export function HAResponseHistoryPanel({ questionId, label }: Props) {
  return (
    <EditHistoryPanel
      subject="response draft"
      header={label ?? 'HA question'}
      queryKey={['ha-response-history', questionId]}
      invalidationKeys={[['ha-correspondence'], ['ha-question', questionId]]}
      loader={({ mine, origin }) =>
        regulatoryWritingApi.getHAResponseHistory(questionId, {
          mine,
          origin: origin as EditOrigin | undefined,
        })
      }
      revert={(editHistoryId) => regulatoryWritingApi.revertHAResponseEdit(editHistoryId)}
    />
  )
}
