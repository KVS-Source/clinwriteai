// Signal autocheck strategies — tag format `signal:<name>[:arg]`.
//
// Three signals in v1 (see docs/roles-and-permissions.md §11.2):
//
//   signal:tlf-validated
//     The document's project has a current validated TlfPackage.
//
//   signal:esig-captured[:<meaning>]
//     At least one Part 11 SignatureRecord has been captured for this doc.
//     Optional argument scopes to a meaning (`Medical approval`, `Author
//     attestation`, etc.). Normalised to lowercase for comparison.
//
//   signal:crm-resolved
//     The document has one or more CrmMeeting rows and every meeting is
//     in status='complete'. If no meetings exist, the signal stays pending.
//
// Strategies are pure. The route layer pre-fetches the signal context
// and passes it in; strategies never read from Prisma.

import type { StrategyResult } from './content-strategies.js'

export interface SignalContext {
  /** true when a current TlfPackage exists for the doc's project. */
  tlfPackageValidated: boolean
  /** Lowercased signature-record meanings for signed rows on this doc. */
  signatureMeanings: string[]
  /** true when ≥1 CrmMeeting rows exist AND every one is status='complete'. */
  crmMeetingsComplete: boolean
  /** Count of CrmMeeting rows — used to distinguish "no meetings yet" from "all done". */
  crmMeetingCount: number
}

export function emptySignalContext(): SignalContext {
  return {
    tlfPackageValidated: false,
    signatureMeanings: [],
    crmMeetingsComplete: false,
    crmMeetingCount: 0,
  }
}

export function evaluateSignal(
  args: string[],
  signals: SignalContext,
): StrategyResult {
  const name = (args[0] ?? '').toLowerCase()
  if (!name) {
    return { kind: 'skipped', reason: 'signal: missing signal name' }
  }

  switch (name) {
    case 'tlf-validated':
      return signals.tlfPackageValidated
        ? { kind: 'completed', reason: 'signal:tlf-validated: current TlfPackage present' }
        : { kind: 'pending',   reason: 'signal:tlf-validated: no current TlfPackage on this project yet' }

    case 'esig-captured': {
      const requiredMeaning = args[1]?.toLowerCase()
      if (requiredMeaning) {
        return signals.signatureMeanings.includes(requiredMeaning)
          ? { kind: 'completed', reason: `signal:esig-captured: ${requiredMeaning} signature captured` }
          : { kind: 'pending',   reason: `signal:esig-captured: no "${requiredMeaning}" signature yet` }
      }
      return signals.signatureMeanings.length > 0
        ? { kind: 'completed', reason: `signal:esig-captured: ${signals.signatureMeanings.length} signatures captured` }
        : { kind: 'pending',   reason: 'signal:esig-captured: no signatures yet' }
    }

    case 'crm-resolved':
      if (signals.crmMeetingCount === 0) {
        return { kind: 'pending', reason: 'signal:crm-resolved: no CRM meetings scheduled yet' }
      }
      return signals.crmMeetingsComplete
        ? { kind: 'completed', reason: `signal:crm-resolved: all ${signals.crmMeetingCount} meeting(s) complete` }
        : { kind: 'pending',   reason: 'signal:crm-resolved: not all CRM meetings have status=complete' }

    default:
      return { kind: 'skipped', reason: `signal: unknown signal "${name}"` }
  }
}
