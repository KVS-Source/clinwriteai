import { create } from 'zustand'

export type CongressAbstractType = 'oral' | 'poster' | 'e-poster'
export type CongressExportFormat = 'pdf' | 'docx' | 'pptx'

interface CongressStore {
  selectedCongress: string
  abstractType: CongressAbstractType
  exportFormat: CongressExportFormat
  isExporting: boolean
  lastExportId: string | null
  setSelectedCongress: (congress: string) => void
  setAbstractType: (type: CongressAbstractType) => void
  setExportFormat: (format: CongressExportFormat) => void
  setExporting: (pending: boolean) => void
  setLastExportId: (id: string | null) => void
}

export const useCongressStore = create<CongressStore>(set => ({
  selectedCongress: 'ASCO',
  abstractType: 'oral',
  exportFormat: 'pdf',
  isExporting: false,
  lastExportId: null,
  setSelectedCongress: (selectedCongress) => set({ selectedCongress }),
  setAbstractType:     (abstractType)     => set({ abstractType }),
  setExportFormat:     (exportFormat)     => set({ exportFormat }),
  setExporting:        (isExporting)      => set({ isExporting }),
  setLastExportId:     (lastExportId)     => set({ lastExportId }),
}))
