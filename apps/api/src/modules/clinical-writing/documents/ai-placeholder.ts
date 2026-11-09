// Placeholder text the AI layer used to write when no real AI was configured. It must never reach
// a document: the gateway now refuses instead, and this is the second line of defence on the way
// into a section (accept + save), in case such text arrives from an old chat message or a stale client.
//
// Matches the gateway stub ("[STUB_<model>] Would respond…") and the first-draft worker's two
// fallbacks. Skipped when the dev/CI stub is explicitly switched on (AI_ALLOW_STUB=1).

import { stubAllowed } from '../../platform/ai-gateway/service.js'

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[\s*STUB_[^\]]*\]/i,
  /\[\s*AI-drafted initial content[^\]]*(?:not set|stub)[^\]]*\]/i,
  /\[\s*Draft fell back to stub[^\]]*\]/i,
]

export function containsAiPlaceholder(text: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!text || stubAllowed(env)) return false
  return PLACEHOLDER_PATTERNS.some(re => re.test(text))
}

export const AI_PLACEHOLDER_REFUSAL = {
  error:   'ai_placeholder_content',
  message: 'This text is a placeholder from an AI that was not configured. It cannot be saved into a document.',
} as const
