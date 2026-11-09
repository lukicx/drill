import type { StudyQuestion } from './study'

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

// Lower case without accents, so "sifrovani" finds "šifrování".
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}
function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
}

export interface IndexedQuestion { item: StudyQuestion; name: string; all: string }
export interface SearchHit { item: StudyQuestion; inQuestion: boolean }

export function buildIndex(items: StudyQuestion[]): IndexedQuestion[] {
  return items.map((item) => {
    const q = item.question
    const parts = [q.name, q.answer ?? '', ...(q.keyPoints ?? []), ...(q.answers ?? []).flatMap((a) => [a.body, a.comment ?? ''])]
    return { item, name: normalize(plainText(q.name)), all: normalize(plainText(parts.join('\n'))) }
  })
}

// Every word must appear somewhere in the question, its options, explanations or model answer.
// Questions whose own text holds every word come first; otherwise lecture order is kept.
export function searchIndex(index: IndexedQuestion[], query: string): SearchHit[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return index.filter((entry) => words.every((word) => entry.all.includes(word)))
    .map((entry) => ({ item: entry.item, inQuestion: words.every((word) => entry.name.includes(word)) }))
    .sort((a, b) => Number(b.inQuestion) - Number(a.inQuestion))
}

// Formulas, tags and entities are copied as they are; only plain text gets marks.
const OPAQUE = /(\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|<[^>]*>|&[#\w]+;)/

// Wraps the query words in <mark>, ignoring case and accents like the search itself.
export function highlight(html: string, query: string): string {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (!words.length) return html
  return html.split(OPAQUE).map((part, i) => i % 2 ? part : markText(part, words)).join('')
}

function markText(text: string, words: string[]): string {
  // origin[k] = index in `text` of the character that became norm[k]
  let norm = ''
  const origin: number[] = []
  for (let i = 0; i < text.length; i++) {
    const n = normalize(text[i])
    for (let k = 0; k < n.length; k++) origin.push(i)
    norm += n
  }
  const hit: boolean[] = new Array(text.length).fill(false)
  for (const word of words) {
    for (let at = norm.indexOf(word); at !== -1; at = norm.indexOf(word, at + word.length)) {
      for (let k = at; k < at + word.length; k++) hit[origin[k]] = true
    }
  }
  let out = '', open = false
  for (let i = 0; i < text.length; i++) {
    if (hit[i] !== open) { out += hit[i] ? '<mark>' : '</mark>'; open = hit[i] }
    out += text[i]
  }
  return open ? `${out}</mark>` : out
}
