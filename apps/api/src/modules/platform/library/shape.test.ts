import { describe, expect, it } from 'vitest'
import {
  BEST_PRACTICE_NAME, parseTags, parseVersionLabel, sectionToBestPractice, sectionToItem, sourceDocumentInfo,
  type LibraryContext, type SectionRow,
} from './shape.js'

function row(over: Partial<SectionRow> = {}): SectionRow {
  return {
    id: 'ls-1', tenantId: null, title: 'CTD 2.5 Clinical Overview', body: 'Approved text.', taTag: 'Oncology',
    framework: 'ICH E3', category: 'claim', version: 2, isCurrent: true, approvedBy: 'u1',
    approvedAt: new Date('2026-10-16T09:30:00Z'), retiredAt: null,
    tags: ['module:D', 'doctype:NDA', 'project:p1', 'source:doc-9', 'FDA + EMA'],
    updatedAt: new Date('2026-10-17T00:00:00Z'), ...over,
  }
}
const ctx = (status = 'ongoing'): LibraryContext => ({
  userNames: new Map([['u1', 'Dr James Hartley']]),
  projects: new Map([['p1', { name: 'VELORA-301 Efficacy Suite', status }]]),
})

describe('parseTags', () => {
  it('splits metadata tags from plain tags', () => {
    expect(parseTags(['module:d', 'doctype:NDA', 'doctype:CSR', 'project:p1', 'source:s1', 'type:document', 'FDA + EMA'])).toMatchObject({
      module: 'D', docTypes: ['NDA', 'CSR'], projectId: 'p1', sourceId: 's1', isDocument: true, plain: ['FDA + EMA'],
    })
  })
  it('treats unknown modules, empty values and unknown keys as plain / platform-wide', () => {
    const t = parseTags(['module:Z', 'doctype:', 'colour:blue'])
    expect(t.module).toBe('platform')
    expect(t.docTypes).toEqual([])
    expect(t.plain).toEqual(['module:Z', 'doctype:', 'colour:blue'])
  })
})

describe('parseVersionLabel', () => {
  it.each([['v2.0', 2], ['v2', 2], ['2', 2], ['V10.3', 10]])('%s → %s', (input, n) => expect(parseVersionLabel(input)).toBe(n))
  it('rejects non-versions', () => expect(parseVersionLabel('latest')).toBeNull())
})

describe('sectionToItem — source and authorship', () => {
  const full: LibraryContext = {
    ...ctx(),
    userNames: new Map([['u1', 'Dr James Hartley'], ['u2', 'Raj']]),
    documents: new Map([['doc-9', 'CSR Full']]),
    firstVersions: new Map([['|CTD 2.5 Clinical Overview', { createdAt: new Date('2026-09-01T08:00:00Z'), by: 'u2' }]]),
  }
  it('names the source document instead of showing its id, and keeps the id when it is unknown', () => {
    expect(sectionToItem(row({ tags: ['source:doc-9#sec-1', 'docversion:v1.0'] }), full).provenanceChain).toContain('Source: CSR Full (v1.0)')
    expect(sectionToItem(row({ tags: ['source:gone'] }), full).provenanceChain).toContain('Source: gone')
  })
  it('reports who made this version, who made the first one, and when', () => {
    const item = sectionToItem(row(), full)
    expect(item).toMatchObject({
      editedByName: 'Dr James Hartley', createdByName: 'Raj',
      createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
    })
  })
  it('falls back to this row when no earlier version is known', () => {
    expect(sectionToItem(row({ createdAt: new Date('2026-10-16T09:00:00Z') }), ctx())).toMatchObject({ createdByName: 'Dr James Hartley', createdAt: '2026-10-16T09:00:00.000Z' })
  })
})

describe('sourceDocumentInfo — the source document\'s people', () => {
  // The case from the "CSR Full (pm and author)" report: a PM creates the document, two
  // Authors, a Reviewer and an Approver; one Author did the editing; Sheetal pushed it.
  const names = new Map([['pm', 'Alex Thornton'], ['abh', 'Abhishek'], ['she', 'Sheetal'], ['raj', 'Raj'], ['sou', 'Sourabh'], ['old', 'Former Author']])
  const at = (h: number) => new Date(Date.UTC(2026, 10, 6, h))
  const build = (showTeam: boolean) => sourceDocumentInfo({
    createdBy: 'pm', createdAt: at(4),
    sections: [
      { lastEditedBy: 'she', lastEditedAt: at(6), humanSpanCount: 2 },
      { lastEditedBy: 'abh', lastEditedAt: at(5), humanSpanCount: 1 },
      { lastEditedBy: 'she', lastEditedAt: at(5), humanSpanCount: 3 },
      { lastEditedBy: null, lastEditedAt: null, humanSpanCount: 0 },
      // AI draft written at creation under the creator's name: not an edit by the PM.
      { lastEditedBy: 'pm', lastEditedAt: at(7), humanSpanCount: 0 },
    ],
    raci: [
      { userId: 'sou', letter: 'A', removedAt: null },
      { userId: 'raj', letter: 'C', removedAt: null },
      { userId: 'she', letter: 'R', removedAt: null },
      { userId: 'abh', letter: 'R', removedAt: null },
      { userId: 'abh', letter: 'R', removedAt: null },            // a section row for the same role
      { userId: 'old', letter: 'R', removedAt: at(5) },           // removed: not on the team any more
    ],
    signatures: [
      { signerId: 'sou', signerName: 'Sourabh', meaning: 'approved', step: 2, timestampUtc: at(7), versionAtSigning: 'v0.8' },
      { signerId: 'abh', signerName: 'Abhishek', meaning: 'authored', step: 1, timestampUtc: at(6), versionAtSigning: 'v0.8' },
      { signerId: 'raj', signerName: 'Raj', meaning: 'reviewed', step: 3, timestampUtc: null, versionAtSigning: null },
    ],
    userNames: names,
    showTeam,
  })
  const info = build(true)

  it('names the document\'s creator, not whoever pushed it to the library', () => {
    expect(info).toMatchObject({ createdByName: 'Alex Thornton', createdAt: '2026-11-06T04:00:00.000Z' })
  })
  it('lists everyone whose own writing is in the text, latest first, and not the creator of an AI-only section', () => {
    expect(info).toMatchObject({ lastEditedByName: 'Sheetal', lastEditedAt: '2026-11-06T06:00:00.000Z', editors: ['Sheetal', 'Abhishek'] })
  })
  it('lists every current role holder once, Authors first, removed people left out', () => {
    expect(info.team).toEqual([
      { letter: 'R', name: 'Abhishek' }, { letter: 'R', name: 'Sheetal' },
      { letter: 'A', name: 'Sourabh' }, { letter: 'C', name: 'Raj' },
    ])
  })
  it('lists only signatures actually given, in chain order', () => {
    expect(info.signatures).toEqual([
      { name: 'Abhishek', meaning: 'authored', signedAt: '2026-11-06T06:00:00.000Z', version: 'v0.8' },
      { name: 'Sourabh', meaning: 'approved', signedAt: '2026-11-06T07:00:00.000Z', version: 'v0.8' },
    ])
  })
  it('for someone outside the project: keeps the creator and the signatures, drops role holders and editors (bug 15)', () => {
    const hidden = build(false)
    expect(hidden).toMatchObject({ createdByName: 'Alex Thornton', teamHidden: true, team: [], editors: [], lastEditedByName: null, lastEditedAt: null })
    expect(hidden.signatures).toEqual(info.signatures)
    expect(info.teamHidden).toBe(false)
  })
  it('is attached to the library item pushed from that document', () => {
    const item = sectionToItem(row({ tags: ['type:document', 'source:doc-9'] }), { ...ctx(), sourceDocuments: new Map([['doc-9', info]]) })
    expect(item.sourceDocument).toBe(info)
    expect(sectionToItem(row({ tags: ['source:other'] }), { ...ctx(), sourceDocuments: new Map([['doc-9', info]]) }).sourceDocument).toBeUndefined()
  })
})

describe('sectionToItem', () => {
  it('maps a row to the MasterLibraryItem the page expects', () => {
    const item = sectionToItem(row(), ctx())
    expect(item).toMatchObject({
      id: 'ls-1', name: 'CTD 2.5 Clinical Overview', module: 'D', itemType: 'section', docType: 'NDA',
      ta: ['Oncology'], version: 'v2.0', pushedBy: 'u1', pushedByName: 'Dr James Hartley',
      projectId: 'p1', projectName: 'VELORA-301 Efficacy Suite', tags: ['FDA + EMA'], isArchived: false, body: 'Approved text.',
    })
    expect(item.pushedAt).toBe('2026-10-16T09:30:00.000Z')
    expect(item.provenanceChain).toEqual([
      'Project: VELORA-301 Efficacy Suite',
      'Module: D · Regulatory Writing',
      'Source: doc-9',
    ])
  })
  it('marks items from a closed project as archived', () => {
    expect(sectionToItem(row(), ctx('closed'))).toMatchObject({ isArchived: true, archivedReason: 'Source project is closed' })
  })
  it('marks retired rows as archived', () => {
    expect(sectionToItem(row({ retiredAt: new Date() }), ctx())).toMatchObject({ isArchived: true, archivedReason: 'Withdrawn from the library' })
  })
  it('falls back for untagged, unattributed rows', () => {
    const item = sectionToItem(row({ tags: [], approvedBy: 'ghost' }), ctx())
    expect(item).toMatchObject({ module: 'platform', docType: 'ICH E3', projectName: 'Platform library', pushedByName: 'Unknown user', projectId: '' })
  })
  it('reports whole documents and best practices as such', () => {
    expect(sectionToItem(row({ tags: ['type:document'] }), ctx()).itemType).toBe('document')
    expect(sectionToItem(row({ category: 'best_practice' }), ctx()).itemType).toBe('best-practice')
  })
})

describe('sectionToBestPractice', () => {
  const bp = (over: Partial<SectionRow> = {}) => row({
    category: 'best_practice', title: 'Module-D-CTD-Authoring-v1.2-2026-01', framework: 'ICH M4E(R2), ICH E3',
    tags: ['module:D', 'category:CTD Authoring', 'doctype:NDA', 'doctype:IND', 'effective:2026-01-01', 'valid-until:2026-12-31'], ...over,
  })
  it('maps tags and framework refs', () => {
    expect(sectionToBestPractice(bp(), new Date('2026-06-01T00:00:00Z'))).toMatchObject({
      module: 'D', category: 'CTD Authoring', name: 'Module-D-CTD-Authoring-v1.2-2026-01', guidance: 'Approved text.',
      applicableDocTypes: ['NDA', 'IND'], frameworkRefs: ['ICH M4E(R2)', 'ICH E3'],
      effectiveFrom: '2026-01-01', validUntil: '2026-12-31', reviewDue: false,
    })
  })
  it('flags review due inside 30 days of expiry and after it', () => {
    expect(sectionToBestPractice(bp(), new Date('2026-12-10T00:00:00Z'))).toMatchObject({ reviewDue: true, reviewDueNote: 'Valid until 2026-12-31 — review due' })
    expect(sectionToBestPractice(bp(), new Date('2027-02-01T00:00:00Z'))).toMatchObject({ reviewDue: true, reviewDueNote: 'Expired 2026-12-31 — review overdue' })
  })
})

describe('BEST_PRACTICE_NAME', () => {
  it.each(['Module-D-CTD-Authoring-v1.2-2026-01', 'Module-A-Checklists-v1.0-2026-09', 'Platform-Security-v2-2026'])('accepts %s', n => expect(BEST_PRACTICE_NAME.test(n)).toBe(true))
  it.each(['best-practice-1', 'Module-F-X-v1.0-2026-01', 'Module-D-X-1.0-2026-01'])('rejects %s', n => expect(BEST_PRACTICE_NAME.test(n)).toBe(false))
})
