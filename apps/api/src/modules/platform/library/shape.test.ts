import { describe, expect, it } from 'vitest'
import {
  BEST_PRACTICE_NAME, parseTags, parseVersionLabel, sectionToBestPractice, sectionToItem,
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
      'Module D · Regulatory Writing',
      'Source: doc-9',
      'Master Library · v2.0 · 2026-10-16 by Dr James Hartley',
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
