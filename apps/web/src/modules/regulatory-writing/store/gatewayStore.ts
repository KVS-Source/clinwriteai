import { create } from 'zustand'
import type { GatewaySubmissionRecord, PartElevenSignature } from '@platform/types'

interface GatewayStore {
  records:                 GatewaySubmissionRecord[]
  activeRecordId:          string | null
  confirmingTransmission:  boolean
  signatureDraft:          Partial<PartElevenSignature> | null
  setRecords:                (r: GatewaySubmissionRecord[]) => void
  setActiveRecordId:         (id: string | null) => void
  setConfirmingTransmission: (v: boolean) => void
  setSignatureDraft:         (d: Partial<PartElevenSignature> | null) => void
  markTransmitted:           (id: string, at: string, signature: PartElevenSignature) => void
  recordACK:                 (id: string, ack: 'ack1' | 'ack2' | 'ack3', at: string) => void
}

export const useGatewayStore = create<GatewayStore>(set => ({
  records:                [],
  activeRecordId:         null,
  confirmingTransmission: false,
  signatureDraft:         null,
  setRecords:                (records)                => set({ records }),
  setActiveRecordId:         (activeRecordId)         => set({ activeRecordId }),
  setConfirmingTransmission: (confirmingTransmission) => set({ confirmingTransmission }),
  setSignatureDraft:         (signatureDraft)         => set({ signatureDraft }),
  markTransmitted: (id, at, signature) => set(s => ({
    records: s.records.map(r => r.id === id ? {
      ...r, transmittedAt: at, status: 'pending', partEleven: signature,
    } : r),
    confirmingTransmission: false,
  })),
  recordACK: (id, ack, at) => set(s => ({
    records: s.records.map(r => r.id === id ? { ...r, [`${ack}At`]: at, status: ack } : r),
  })),
}))
