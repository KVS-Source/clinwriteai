// Should this /ai-suggest call use the compact carry prompt?
//
// Opt-in per deploy via `FEATURE_CARRY_PROMPT`, a comma-separated list
// of hyphenated doc types ('protocol,protocol-amendment'). The route
// consults this on every call so a safe rollout can start with one doc
// type and expand without a redeploy.
//
// Empty / missing env var ⇒ carry mode is off everywhere (current prod
// behaviour). This makes the step-B wiring a no-op until an operator
// flips the flag.
//
// Both inputs are hyphenated — the route hyphenates the Prisma doc.type
// before passing it in, matching the convention the brief + prompt
// library use.

export function parseCarryPromptAllowlist(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set()
  return new Set(
    raw.split(',')
       .map(s => s.trim().toLowerCase())
       .filter(s => s.length > 0),
  )
}

export function carryPromptEnabledFor(docType: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allow = parseCarryPromptAllowlist(env.FEATURE_CARRY_PROMPT)
  return allow.has(docType.toLowerCase())
}
