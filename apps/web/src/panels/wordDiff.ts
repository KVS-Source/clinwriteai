// Word-level diff for audit entries: turns a section's before/after text into
// the few places that actually changed, each with a little surrounding text so
// a reader can see where the change sits.
//
// Common leading/trailing words are trimmed first (most edits are small), then
// an LCS over the remaining middle finds inserts/deletes. Very large middles
// fall back to "everything in the middle was replaced" to keep the UI fast.

export type DiffOp = { type: 'eq' | 'del' | 'ins'; words: string[] }

export interface DiffHunk {
  before: string[]            // context words leading into the change
  ops: DiffOp[]               // del / ins (and short eq runs between nearby changes)
  after: string[]             // context words following the change
  atStart: boolean            // the change touches the very start of the text
  atEnd: boolean              // … or the very end
}

export interface WordDiff {
  added: number
  removed: number
  hunks: DiffHunk[]
  ops: DiffOp[]               // the whole text as eq / del / ins runs (for highlighted full before/after)
}

const MAX_LCS_CELLS = 4_000_000

const words = (s: string) => s.match(/\S+/g) ?? []

function diffOps(a: string[], b: string[]): DiffOp[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }

  const ops: DiffOp[] = []
  const push = (type: DiffOp['type'], w: string[]) => {
    if (w.length === 0) return
    const last = ops[ops.length - 1]
    if (last && last.type === type) last.words.push(...w)
    else ops.push({ type, words: [...w] })
  }

  push('eq', a.slice(0, start))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)

  if (midA.length * midB.length > MAX_LCS_CELLS) {
    push('del', midA)
    push('ins', midB)
  } else {
    // LCS table, then walk it forwards.
    const n = midA.length, m = midB.length
    const dp = new Int32Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] = midA[i] === midB[j]
          ? dp[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1])
      }
    }
    let i = 0, j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { push('eq', [midA[i]!]); i++; j++ }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) { push('del', [midA[i]!]); i++ }
      else { push('ins', [midB[j]!]); j++ }
    }
    push('del', midA.slice(i))
    push('ins', midB.slice(j))
  }

  push('eq', a.slice(endA))
  return ops
}

/** The changed places between two texts, with `context` words around each. */
export function wordDiff(beforeText: string, afterText: string, context = 6): WordDiff {
  const ops = diffOps(words(beforeText), words(afterText))
  let added = 0, removed = 0
  for (const op of ops) {
    if (op.type === 'ins') added += op.words.length
    if (op.type === 'del') removed += op.words.length
  }

  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  ops.forEach((op, idx) => {
    const isFirst = idx === 0, isLast = idx === ops.length - 1
    if (op.type !== 'eq') {
      if (!current) {
        const prev = ops[idx - 1]
        current = { before: prev?.type === 'eq' ? prev.words.slice(-context) : [], ops: [], after: [], atStart: isFirst, atEnd: false }
        hunks.push(current)
      }
      current.ops.push(op)
      if (isLast) current.atEnd = true
      return
    }
    if (!current) return
    // A short unchanged run between two changes stays inside one hunk.
    if (!isLast && op.words.length <= context * 2) { current.ops.push(op); return }
    current.after = op.words.slice(0, context)
    current = null
  })
  return { added, removed, hunks, ops }
}
