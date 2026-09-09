import { create } from 'zustand'
import type { RegulatoryAlert } from '@platform/types'

interface RegulatoryIntelligenceStore {
  alerts:            RegulatoryAlert[]
  activeAlertId:     string | null
  setAlerts:         (a: RegulatoryAlert[]) => void
  setActiveAlertId:  (id: string | null) => void
  acknowledgeAlert:  (id: string, userId: string) => void
}

export const useRegulatoryIntelligenceStore = create<RegulatoryIntelligenceStore>(set => ({
  alerts:           [],
  activeAlertId:    null,
  setAlerts:        (alerts)        => set({ alerts }),
  setActiveAlertId: (activeAlertId) => set({ activeAlertId }),
  acknowledgeAlert: (id, userId) => set(s => ({
    alerts: s.alerts.map(a => a.id === id && !a.acknowledgedByIds.includes(userId)
      ? { ...a, acknowledgedByIds: [...a.acknowledgedByIds, userId] }
      : a),
  })),
}))

export function unreadAlertCount(alerts: RegulatoryAlert[], userId: string): number {
  return alerts.filter(a => !a.acknowledgedByIds.includes(userId)).length
}
