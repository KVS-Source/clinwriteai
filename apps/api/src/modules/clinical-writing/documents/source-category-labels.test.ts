// The API keeps its own copy of the source-category display names (it searches on them) and the web
// has the list it renders in dropdowns and the Category column. They must stay identical, or a search
// for what the Category column shows stops matching.

import { describe, expect, it } from 'vitest'
import { SOURCE_CATEGORY_LABEL, SOURCE_CATEGORIES } from './source-categories.js'
import { SOURCE_CATEGORIES as WEB_CATEGORIES } from '../../../../../web/src/utils/sourceCategories.js'

describe('source category labels', () => {
  it('match the web list exactly (same values, same order, same display names)', () => {
    expect(WEB_CATEGORIES.map(c => c.value)).toEqual([...SOURCE_CATEGORIES])
    expect(Object.fromEntries(WEB_CATEGORIES.map(c => [c.value, c.label]))).toEqual(SOURCE_CATEGORY_LABEL)
  })
})
