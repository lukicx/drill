// Gives every question a stable "id", so progress history survives later edits of the question text.
// The id is the same hash the app used for the question text before ids existed, so existing
// history keeps matching. Questions that already have an id are left alone.
// Usage: node scripts/add-question-ids.mjs public/datasets/questions_PV017_L01.json [more files...]
// Edits the files as text, so each file keeps its own formatting.
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

// Must match hashText in src/study.ts.
function hashText(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}

let failed = false
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8')
  const data = JSON.parse(text)
  const ids = data.map((q) => q.id ?? hashText(q.name))
  if (new Set(ids).size !== ids.length) { console.log(`${file}: duplicate ids or question texts, fix by hand`); failed = true; continue }
  const missing = data.filter((q) => q.id === undefined).length
  if (!missing) { console.log(`${file}: all ${data.length} questions have ids`); continue }

  // Each question object starts with "  {" and its "name" line, or an existing "id" line.
  let index = 0
  const out = text.replace(/^( {2}\{\r?\n)( {4})("id"|"name")/gm, (match, open, indent, key) => {
    const q = data[index++]
    if (key === '"id"' || q === undefined) return match
    return `${open}${indent}"id": ${JSON.stringify(hashText(q.name))},\n${indent}${key}`
  })
  const parsed = JSON.parse(out)
  const expected = data.map((q, i) => ({ id: ids[i], ...q }))
  if (index !== data.length || !isDeepStrictEqual(parsed, expected)) {
    console.log(`${file}: unexpected layout, no changes written`); failed = true; continue
  }
  writeFileSync(file, out)
  console.log(`${file}: added ${missing} ids`)
}
process.exit(failed ? 1 : 0)
