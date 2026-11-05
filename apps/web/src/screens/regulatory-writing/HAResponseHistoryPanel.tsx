// Module D HA response draft history panel.
//
// Thin wrapper around the shared EditHistoryPanel for a HaLoqQuestion's
// draft chain. Opens from the clock icon on the HA response drafting
// screen. Each HA draft is a new version row (append pattern); revert
// creates a new version with the restored text.

import { useTranslation } from 'react-i18next'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import { EditHistoryPanel, type EditOrigin } from '../../panels/EditHistoryPanel'

interface Props {
  questionId: string
  /** Short label e.g. "Q2.1 · CMC validation protocol". */
  label?: string
}

export function HAResponseHistoryPanel({ questionId, label }: Props) {
  const { t } = useTranslation()
  return (
    <EditHistoryPanel
      subject={t('page.ha_response_history_panel.subject')}
      header={label ?? t('page.ha_response_history_panel.header_default')}
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
