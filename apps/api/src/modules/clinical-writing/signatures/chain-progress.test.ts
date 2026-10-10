import { describe, it, expect } from 'vitest'
import {
  canSign,
  nextAwaitingStep,
  chainCompleteAfterSign,
  chainStateAfterSign,
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
