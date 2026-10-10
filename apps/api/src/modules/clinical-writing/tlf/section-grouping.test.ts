import { describe, it, expect } from 'vitest'
import { groupSectionsByItem, type SectionLinkLite } from './section-grouping.js'

function link(tlfItemId: string, sectionRef: string): SectionLinkLite {
  return { tlfItemId, sectionRef }
}

describe('groupSectionsByItem', () => {
  it('groups refs by TLF item id', () => {
    const grouped = groupSectionsByItem([
      link('tbl-1', '§11.1'),
      link('tbl-1', '§11.4'),
      link('fig-2', '§11.4'),
    ])
    expect(grouped.get('tbl-1')).toEqual(['§11.1', '§11.4'])
    expect(grouped.get('fig-2')).toEqual(['§11.4'])
  })

  it('de-duplicates identical refs within an item', () => {
    const grouped = groupSectionsByItem([
      link('tbl-1', '§11.1'),
      link('tbl-1', '§11.1'),           // duplicate — should not double
      link('tbl-1', '§11.4'),
    ])
    expect(grouped.get('tbl-1')).toEqual(['§11.1', '§11.4'])
  })

  it('preserves insertion order within an item', () => {
    const grouped = groupSectionsByItem([
      link('tbl-1', '§14.2'),
      link('tbl-1', '§11.1'),
      link('tbl-1', '§12.3'),
    ])
    expect(grouped.get('tbl-1')).toEqual(['§14.2', '§11.1', '§12.3'])
  })

  it('returns an empty Map for an empty input', () => {
    const grouped = groupSectionsByItem([])
    expect(grouped.size).toBe(0)
  })

  it('isolates items — refs on item A do not leak to item B', () => {
    const grouped = groupSectionsByItem([
      link('tbl-1', '§11.1'),
      link('fig-2', '§11.1'),
      link('list-3', '§11.1'),
    ])
    expect(grouped.get('tbl-1')).toEqual(['§11.1'])
    expect(grouped.get('fig-2')).toEqual(['§11.1'])
    expect(grouped.get('list-3')).toEqual(['§11.1'])
  })
})
