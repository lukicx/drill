// Checks question files before they go into the app.
// Usage: node scripts/validate-questions.mjs public/datasets/questions_PA015_L01.json [more files...]
// Hard errors = the app would reject the file or show it wrong; warnings = quality issues in generated sets.
import { readFileSync } from 'node:fs'
import katex from 'katex'
// Same delimiters as src/math.ts: \( … \) inline, \[ … \] display. Every formula must parse with KaTeX.
const MATH = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g
const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
function mathErrors(s) {
  const out = []
  for (const m of s.matchAll(MATH)) {
    const tex = m[1] ?? m[2]
    try { katex.renderToString(decode(tex), { displayMode: m[1] !== undefined, throwOnError: true }) }
    catch (e) { out.push(`bad LaTeX "${tex.slice(0, 40)}": ${String(e.message).split('\n')[0].slice(0, 80)}`) }
  }
  if (/\\[()[\]]/.test(s.replace(MATH, ''))) out.push('unbalanced math delimiter \\( \\) or \\[ \\]')
  return out
}
const ALLOWED = new Set(['tt', 'b', 'i', 'pre', 'br', 'sup', 'sub', 'strong', 'em', 'code'])
let failed = false
for (const f of process.argv.slice(2)) {
  const errors = [], warnings = []
  let data
  try { data = JSON.parse(readFileSync(f, 'utf8')) } catch (e) { console.log(`${f}: INVALID JSON ${e.message}`); failed = true; continue }
  if (!Array.isArray(data) || data.length === 0) errors.push('not a non-empty array')
  ;(Array.isArray(data) ? data : []).forEach((q, i) => {
    const L = `Q${i + 1}`
    if (typeof q?.name !== 'string' || !q.name.trim()) { errors.push(`${L}: missing text`); return }
    if (q.answers === undefined) {
      // essay question
      if (typeof q.answer !== 'string' || !q.answer.trim()) errors.push(`${L}: essay without model answer`)
      if (q.keyPoints !== undefined && (!Array.isArray(q.keyPoints) || q.keyPoints.some(p => typeof p !== 'string' || !p.trim()))) errors.push(`${L}: bad keyPoints`)
      if (!Array.isArray(q.keyPoints) || q.keyPoints.length < 3) warnings.push(`${L}: fewer than 3 key points`)
      if (typeof q.source !== 'string' || !/slide/i.test(q.source)) warnings.push(`${L}: no slide reference in source`)
      for (const s of [q.name, q.answer ?? '', ...(q.keyPoints ?? []), q.source ?? '']) {
        for (const m of s.replace(MATH, '').matchAll(/<\/?([a-zA-Z][\w-]*)/g)) if (!ALLOWED.has(m[1].toLowerCase())) errors.push(`${L}: unescaped "<${m[1]}" (write &lt;)`)
      for (const e of mathErrors(s)) errors.push(`${L}: ${e}`)
      }
      return
    }
    if (!Array.isArray(q.answers) || q.answers.length === 0) { errors.push(`${L}: no answers`); return }
    if (q.answers.some(a => typeof a?.body !== 'string' || !a.body.trim())) errors.push(`${L}: empty answer body`)
    if (q.answers.some(a => typeof a?.right !== 'boolean')) errors.push(`${L}: right must be boolean`)
    if (!q.answers.some(a => a.right === true)) errors.push(`${L}: no correct answer`)
    if (q.answers.length < 3 || q.answers.length > 6) warnings.push(`${L}: ${q.answers.length} answers (want 3-6)`)
    if (q.answers.every(a => a.right === true)) warnings.push(`${L}: every answer is right`)
    const bodies = q.answers.map(a => a.body.trim().toLowerCase())
    if (new Set(bodies).size !== bodies.length) errors.push(`${L}: duplicate answers`)
    if (!q.answers.some(a => typeof a.comment === 'string' && a.comment.trim())) warnings.push(`${L}: no comment/slide reference`)
    for (const s of [q.name, ...q.answers.flatMap(a => [a.body, a.comment ?? ''])]) {
      for (const m of s.replace(MATH, '').matchAll(/<\/?([a-zA-Z][\w-]*)/g)) if (!ALLOWED.has(m[1].toLowerCase())) errors.push(`${L}: unescaped "<${m[1]}" (write &lt;)`)
      for (const e of mathErrors(s)) errors.push(`${L}: ${e}`)
    }
  })
  const keys = (Array.isArray(data) ? data : []).map(q => q?.name?.trim())
  if (new Set(keys).size !== keys.length) warnings.push('duplicate question texts')
  const multi = (Array.isArray(data) ? data : []).filter(q => q.answers?.filter(a => a.right).length > 1).length
  const essays = (Array.isArray(data) ? data : []).filter(q => q.answers === undefined).length
  console.log(`${f}: ${data.length} questions, ${multi} multi-correct, ${essays} essay, ${errors.length} errors, ${warnings.length} warnings`)
  for (const e of errors) console.log('  ERROR', e)
  for (const w of warnings) console.log('  warn ', w)
  if (errors.length) failed = true
}
process.exit(failed ? 1 : 0)
