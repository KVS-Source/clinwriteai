// Fails when a translation key used in the code has no text in en.json (or ja.json), or when ja.json
// falls behind en.json.
//
// A missing key renders as the raw key ("page.master_library.title") on screen.
// This catches that before it ships. It reads quoted string literals that start
// with one of the top-level groups in en.json ("page.", "button.", ...); keys built
// at run time (template strings with ${...}) can't be checked and are skipped.
//
//   node scripts/check-i18n-keys.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const srcDir = join(root, 'src')
const locales = { en: JSON.parse(readFileSync(join(srcDir, 'i18n/en.json'), 'utf8')), ja: JSON.parse(readFileSync(join(srcDir, 'i18n/ja.json'), 'utf8')) }
const groups = Object.keys(locales.en).filter(k => k !== 'language')

const lookup = (obj, key) => key.split('.').reduce((o, part) => (o && typeof o === 'object' ? o[part] : undefined), obj) !== undefined
// i18next resolves a count key ("docs_count") from its plural forms ("docs_count_one", "docs_count_other").
const PLURALS = ['zero', 'one', 'two', 'few', 'many', 'other']
const has = (obj, key) => lookup(obj, key) || PLURALS.some(p => lookup(obj, `${key}_${p}`))

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'i18n' && name !== 'node_modules') yield* walk(p) }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) yield p
  }
}

const re = new RegExp(`(?<![\\w./-])['"\`]((?:${groups.join('|')})\\.[a-z0-9_]+(?:\\.[A-Za-z0-9_]+)+)['"\`]`, 'g')
const missing = { en: new Map(), ja: new Map() }
for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(re)) {
    const key = m[1]
    for (const lng of ['en', 'ja']) {
      if (!has(locales[lng], key)) (missing[lng].get(key) ?? missing[lng].set(key, new Set()).get(key)).add(relative(root, file))
    }
  }
}

let failed = false
for (const lng of ['en', 'ja']) {
  if (missing[lng].size === 0) continue
  failed = true
  console.error(`\n${missing[lng].size} key(s) used in code but missing from ${lng}.json:`)
  for (const [key, files] of [...missing[lng]].sort()) console.error(`  ${key}   (${[...files].join(', ')})`)
}

// ja.json must keep up with en.json: every key present, and nothing left in English by accident. A value
// may stay the same when it is only placeholders and punctuation, or is on the reviewed list in
// i18n-same-as-english.json (product names, acronyms, sample values, text that goes into documents).
const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]])
const jaValues = new Map(flatten(locales.ja))
const sameAllowed = new Set(JSON.parse(readFileSync(join(root, 'scripts/i18n-same-as-english.json'), 'utf8')))
const notInJa = []
const stillEnglish = []
for (const [key, value] of flatten(locales.en)) {
  if (!jaValues.has(key)) notInJa.push(key)
  else if (jaValues.get(key) === value && /[A-Za-z]{2}/.test(String(value).replace(/\{\{\w+\}\}/g, '')) && !sameAllowed.has(key)) stillEnglish.push(key)
}
// JSON.parse keeps the last of a repeated key, so a duplicate would silently hide a translation.
for (const lng of ['en', 'ja']) {
  const stack = [new Set()]
  for (const line of readFileSync(join(srcDir, `i18n/${lng}.json`), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*"([^"]+)":\s*(\{)?/)
    if (m) {
      if (stack[stack.length - 1].has(m[1])) {
        failed = true
        console.error(`\nDuplicate key "${m[1]}" in ${lng}.json`)
      }
      stack[stack.length - 1].add(m[1])
      if (m[2]) stack.push(new Set())
    }
    if (/^\s*\},?\s*$/.test(line)) stack.pop()
  }
}
if (notInJa.length) {
  failed = true
  console.error(`\n${notInJa.length} key(s) in en.json are missing from ja.json:`)
  for (const key of notInJa) console.error(`  ${key}`)
}
if (stillEnglish.length) {
  failed = true
  console.error(`\n${stillEnglish.length} value(s) in ja.json are still the English text. Translate them, or add the key to scripts/i18n-same-as-english.json if it should stay:`)
  for (const key of stillEnglish) console.error(`  ${key}`)
}
if (failed) process.exit(1)
console.log('i18n keys: every key used in code has text in en.json and ja.json.')
