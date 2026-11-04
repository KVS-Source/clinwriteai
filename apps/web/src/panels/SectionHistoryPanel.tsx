// Clinical-section edit history panel (sPM-section-history).
//
// Thin wrapper around the generic EditHistoryPanel for Module A's
// SectionContent edits. Opens from the clock icon next to each section
// header; shows every save on the *active* section — manual edits, AI
// accepts, previous reverts, section restores — and lets authored users
// Revert to any point.

import { useTranslation } from 'react-i18next'
import { useCanEditDocument } from '../hooks/useCanEditDocument'
import { documentsApi } from '../api'
import { EditHistoryPanel, type EditOrigin } from './EditHistoryPanel'

interface Props {
  documentId: string
  sectionId: string | null
  sectionLabel?: string
}

export function SectionHistoryPanel({ documentId, sectionId, sectionLabel }: Props) {
  const { t } = useTranslation()
  const canEditDocument = useCanEditDocument(documentId)
  if (!sectionId) {
    return (
      <EditHistoryPanel
        emptyPrecondition={t('page.section_history_panel.select_section_first')}
        loader={() => Promise.resolve({ entries: [] })}
        revert={() => Promise.resolve()}
        queryKey={['section-history', documentId, 'none']}
        subject="section"
      />
    )
  }

  return (
    <EditHistoryPanel
      subject="section"
      header={sectionLabel ?? t('page.section_history_panel.current_section')}
      queryKey={['section-history', documentId, sectionId]}
      invalidationKeys={[['document', documentId]]}
      loader={({ mine, origin }) =>
        documentsApi.getSectionHistory(documentId, sectionId, {
          mine,
          origin: origin as EditOrigin | undefined,
        })
      }
      readOnly={canEditDocument === false}
      revert={(editHistoryId) => documentsApi.revertSectionEdit(editHistoryId)}
      fetchDiff={(editHistoryId) => documentsApi.getSectionEditDiff(editHistoryId)}
    />
  )
}
