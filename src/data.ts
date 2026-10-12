import type { DatasetInfo, Question } from './types'

// BASE_URL is "/" in dev and the repo path (e.g. "/drill/") on GitHub Pages.
const base = import.meta.env.BASE_URL

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(base + path)
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`)
  // The dev server answers a missing file with index.html, so name the file in the error.
  return res.json().catch(() => {
    throw new Error(`${path} is missing or is not valid JSON`)
  })
}

export async function loadDatasets(): Promise<DatasetInfo[]> {
  const data = await fetchJson('datasets.json')
  if (!Array.isArray(data)) throw new Error('datasets.json must be an array')
  return data as DatasetInfo[]
}

// Loads a question file and rejects it if any question is malformed,
// so mistakes in generated files show up immediately.
export async function loadQuestions(path: string): Promise<Question[]> {
  const data = await fetchJson(path)
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`${path} must be a non-empty array of questions`)
  }

  const problems: string[] = []
  data.forEach((q, i) => {
    const label = `Question ${i + 1}`
    if (typeof q?.name !== 'string' || q.name.trim() === '') {
      problems.push(`${label}: missing text`)
    } else if (q.answers === undefined) {
      // Essay question: needs a model answer; key points are optional.
      if (typeof q.answer !== 'string' || q.answer.trim() === '') {
        problems.push(`${label}: needs "answers" (multiple choice) or "answer" (essay)`)
      } else if (q.keyPoints !== undefined && (!Array.isArray(q.keyPoints) || q.keyPoints.some((p: unknown) => typeof p !== 'string'))) {
        problems.push(`${label}: keyPoints must be a list of strings`)
      }
    } else if (!Array.isArray(q.answers) || q.answers.length === 0) {
      problems.push(`${label}: has no answers`)
    } else if (q.answers.some((a: unknown) => typeof (a as { body?: unknown })?.body !== 'string')) {
      problems.push(`${label}: an answer is missing its text`)
    } else if (!q.answers.some((a: { right?: unknown }) => a.right === true)) {
      problems.push(`${label}: no correct answer`)
    }
  })

  if (problems.length > 0) {
    const more = problems.length > 10 ? `\n…and ${problems.length - 10} more` : ''
    throw new Error(`${path} has problems:\n${problems.slice(0, 10).join('\n')}${more}`)
  }
  return data as Question[]
}
