import { describe, it, expect } from 'vitest'
import {
  canSign,
  nextAwaitingStep,
  chainCompleteAfterSign,
  chainStateAfterSign,
  initialStatuses,
  recordsToRelease,
  signingGroup,
  sortForChain,
  type SignatureRecordLite,
  type SignatureChainLite,
} from './chain-progress.js'

function mkRecord(step: number, status: SignatureRecordLite['status'], signerId = `user-${step}`): SignatureRecordLite {
  return { id: `rec-${step}`, step, status, signerId }
}

const inProgress: SignatureChainLite = { chainType: 'sequential', status: 'in_progress' }

describe('canSign', () => {
  it('allows the designated awaiting signer', () => {
    expect(canSign(mkRecord(1, 'awaiting', 'alice'), inProgress, 'alice')).toEqual({ ok: true })
  })

  it('rejects the wrong signer with wrong_signer', () => {
    const r = canSign(mkRecord(1, 'awaiting', 'alice'), inProgress, 'bob')
    expect(r).toEqual({ ok: false, reason: 'wrong_signer' })
  })

  it('rejects already-signed records', () => {
    const r = canSign(mkRecord(1, 'signed', 'alice'), inProgress, 'alice')
    expect(r).toEqual({ ok: false, reason: 'already_signed' })
  })

  it('rejects records not yet in awaiting state (sequential)', () => {
    const r = canSign(mkRecord(2, 'queued', 'alice'), inProgress, 'alice')
    expect(r).toEqual({ ok: false, reason: 'not_awaiting' })
  })

  it('rejects when the chain itself is complete or cancelled', () => {
    expect(canSign(mkRecord(1, 'awaiting', 'alice'), { chainType: 'sequential', status: 'complete' }, 'alice'))
      .toEqual({ ok: false, reason: 'chain_closed' })
    expect(canSign(mkRecord(1, 'awaiting', 'alice'), { chainType: 'sequential', status: 'cancelled' }, 'alice'))
      .toEqual({ ok: false, reason: 'chain_closed' })
  })
})

describe('nextAwaitingStep', () => {
  it('returns the step+1 record for a sequential chain', () => {
    const records = [mkRecord(1, 'signed'), mkRecord(2, 'queued'), mkRecord(3, 'queued')]
    const next = nextAwaitingStep(records, 'sequential', 1)
    expect(next?.step).toBe(2)
  })

  it('returns null when the signed step was the last', () => {
    const records = [mkRecord(1, 'signed'), mkRecord(2, 'signed')]
    expect(nextAwaitingStep(records, 'sequential', 2)).toBeNull()
  })

  it('returns null for a parallel chain (all awaiting at once)', () => {
    const records = [mkRecord(1, 'signed'), mkRecord(2, 'awaiting')]
    expect(nextAwaitingStep(records, 'parallel', 1)).toBeNull()
  })
})

describe('chainCompleteAfterSign', () => {
  it('is true only when every record is signed', () => {
    expect(chainCompleteAfterSign([mkRecord(1, 'signed'), mkRecord(2, 'signed')])).toBe(true)
    expect(chainCompleteAfterSign([mkRecord(1, 'signed'), mkRecord(2, 'awaiting')])).toBe(false)
    expect(chainCompleteAfterSign([mkRecord(1, 'signed'), mkRecord(2, 'queued')])).toBe(false)
  })
})

describe('chainStateAfterSign', () => {
  it('flips document to signed when all records are signed', () => {
    const r = chainStateAfterSign([mkRecord(1, 'signed'), mkRecord(2, 'signed'), mkRecord(3, 'signed')])
    expect(r).toEqual({ chainStatus: 'complete', flipDocumentToSigned: true })
  })

  it('leaves document in pending_signature when the chain still has work', () => {
    const r = chainStateAfterSign([mkRecord(1, 'signed'), mkRecord(2, 'awaiting')])
    expect(r).toEqual({ chainStatus: 'in_progress', flipDocumentToSigned: false })
  })
})

describe('grouped chains: Authors, then Reviewers, then Approvers, then Informed', () => {
  const rec = (step: number, meaning: string, status: SignatureRecordLite['status']): SignatureRecordLite =>
    ({ id: `rec-${step}`, step, status, signerId: `user-${step}`, meaning })

  it('orders the groups Authors, Reviewers, Approvers, Informed', () => {
    expect(['acknowledged', 'approved', 'reviewed', 'authored'].map(signingGroup)).toEqual([3, 2, 1, 0])
    expect(signingGroup('something-else')).toBe(4)               // unknown goes last
  })

  it('stores the signers group by group, keeping the submitted order inside a group', () => {
    const signers = [
      { id: 'i1', meaning: 'acknowledged' }, { id: 'a1', meaning: 'approved' }, { id: 'r1', meaning: 'authored' },
      { id: 'c1', meaning: 'reviewed' }, { id: 'r2', meaning: 'authored' }, { id: 'a2', meaning: 'approved' },
    ]
    expect(sortForChain(signers, 'grouped').map(s => s.id)).toEqual(['r1', 'r2', 'c1', 'a1', 'a2', 'i1'])
    expect(sortForChain(signers, 'sequential').map(s => s.id)).toEqual(signers.map(s => s.id))   // others keep the submitted order
    expect(sortForChain(signers, 'parallel').map(s => s.id)).toEqual(signers.map(s => s.id))
  })

  it('starts with the whole first group awaiting', () => {
    const signers = [{ meaning: 'authored' }, { meaning: 'authored' }, { meaning: 'reviewed' }, { meaning: 'approved' }]
    expect(initialStatuses('grouped', signers)).toEqual(['awaiting', 'awaiting', 'queued', 'queued'])
    expect(initialStatuses('sequential', signers)).toEqual(['awaiting', 'queued', 'queued', 'queued'])
    expect(initialStatuses('parallel', signers)).toEqual(['awaiting', 'awaiting', 'awaiting', 'awaiting'])
  })

  it('starts at the first group that exists when there are no Authors', () => {
    expect(initialStatuses('grouped', [{ meaning: 'approved' }, { meaning: 'approved' }, { meaning: 'acknowledged' }]))
      .toEqual(['awaiting', 'awaiting', 'queued'])
  })

  it('releases nobody while anyone in the signed person\'s group is still to sign', () => {
    const records = [rec(1, 'authored', 'signed'), rec(2, 'authored', 'awaiting'), rec(3, 'reviewed', 'queued')]
    expect(recordsToRelease(records, 'grouped', 'rec-1')).toEqual([])
  })

  it('releases the whole next group once the group is complete', () => {
    const records = [rec(1, 'authored', 'signed'), rec(2, 'authored', 'signed'),
      rec(3, 'reviewed', 'queued'), rec(4, 'reviewed', 'queued'), rec(5, 'approved', 'queued')]
    expect(recordsToRelease(records, 'grouped', 'rec-2').map(r => r.id)).toEqual(['rec-3', 'rec-4'])
  })

  it('skips a group nobody is in', () => {
    const records = [rec(1, 'authored', 'signed'), rec(2, 'approved', 'queued'), rec(3, 'acknowledged', 'queued')]
    expect(recordsToRelease(records, 'grouped', 'rec-1').map(r => r.id)).toEqual(['rec-2'])
  })

  it('releases nothing after the last group, and nothing in a parallel chain', () => {
    expect(recordsToRelease([rec(1, 'acknowledged', 'signed')], 'grouped', 'rec-1')).toEqual([])
    expect(recordsToRelease([rec(1, 'authored', 'signed'), rec(2, 'reviewed', 'awaiting')], 'parallel', 'rec-1')).toEqual([])
  })

  it('still releases the next step in a sequential chain', () => {
    const records = [rec(1, 'authored', 'signed'), rec(2, 'reviewed', 'queued')]
    expect(recordsToRelease(records, 'sequential', 'rec-1').map(r => r.id)).toEqual(['rec-2'])
  })
})
