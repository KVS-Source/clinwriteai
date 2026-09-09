import type { AISuggestion } from '@platform/types'

const CANNED: AISuggestion = {
  text: 'The Kaplan–Meier analysis demonstrated robust separation of PFS curves between the Veloricept combination arm and control from Week 8, with the hazard ratio of 0.61 indicating a 39% reduction in the risk of progression or death.',
  sources: ['Table 14.2.1', 'SAP v2.0 §6.3', 'KM Analysis Dataset'],
  model: 'claude-sonnet',
  generatedAt: new Date().toISOString(),
}

export const simulateAI = (delayMs = 1200): Promise<AISuggestion> =>
  new Promise(resolve =>
    setTimeout(() => resolve({ ...CANNED, generatedAt: new Date().toISOString() }), delayMs),
  )
