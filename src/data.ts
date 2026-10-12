import type { DatasetInfo, Question } from './types'

// BASE_URL is "/" in dev and the repo path (e.g. "/drill/") on GitHub Pages.
const base = import.meta.env.BASE_URL

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(base + path)
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`)
  return res.json()
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
    } else if (!Array.isArray(q.answers) || q.answers.length < 2) {
      problems.push(`${label}: needs at least 2 answers`)
    } else if (q.answers.some((a: unknown) => typeof (a as { body?: unknown })?.body !== 'string')) {
      problems.push(`${label}: an answer is missing its text`)
    } else if (!q.answers.some((a: { right?: unknown }) => a.right === true)) {
      problems.push(`${label}: no correct answer`)
    }
  })

  if (problems.length > 0) {
    throw new Error(`${path} has problems:\n${problems.slice(0, 10).join('\n')}`)
  }
  return data as Question[]
}
