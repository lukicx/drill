import type { Question } from './types'

export interface StudySource { datasetId: string; questions: Question[] }
export interface StudyQuestion { key: string; datasetId: string; question: Question }
export type Assessment = 'correct' | 'partial' | 'wrong'
export type StudyMode = 'full' | 'quick' | 'mixed' | 'review'
export interface Attempt { item: StudyQuestion; assessment: Assessment; selected: number[]; draft: string }
export interface StudySession {
  version: 1
  id: string
  title: string
  datasetIds: string[]
  revision: string
  mode: StudyMode
  shuffled: boolean
  round: StudyQuestion[]
  index: number
  selected: number[]
  revealed: boolean
  draft: string
  attempts: Attempt[]
  finished: boolean
  savedAt: number
}
export interface StudyResult {
  sessionId: string; datasetIds: string[]; mode: StudyMode; total: number
  correct: number; partial: number; answered: number; completedAt: number
}

const SESSION_KEY = 'drill.session.v1'
const RESULTS_KEY = 'drill.results.v1'

export function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// Avoid resuming old answers after a dataset changes.
export function revisionOf(sources: StudySource[]): string {
  const text = JSON.stringify(sources)
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}

export function createSession(sources: StudySource[], title: string, options: {
  shuffled?: boolean; limit?: number; review?: StudyQuestion[]
} = {}): StudySession {
  const shuffled = options.shuffled ?? true
  const bank = options.review ?? sources.flatMap(({ datasetId, questions }) =>
    questions.map((question, index) => ({ key: `${datasetId}:${index}`, datasetId, question })))
  const ordered = shuffled ? shuffle(bank) : [...bank]
  const round = ordered.slice(0, options.limit ?? ordered.length).map((item) => ({
    ...item, question: shuffled && item.question.answers
      ? { ...item.question, answers: shuffle(item.question.answers) } : item.question,
  }))
  if (!round.length) throw new Error('Choose at least one question to practice.')
  return {
    version: 1, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title, datasetIds: sources.map((source) => source.datasetId), revision: revisionOf(sources),
    mode: options.review ? 'review' : options.limit ? 'quick' : sources.length > 1 ? 'mixed' : 'full',
    shuffled, round, index: 0, selected: [], revealed: false, draft: '',
    attempts: [], finished: false, savedAt: Date.now(),
  }
}

export function checkSelection(question: Question, selected: number[]) {
  const answers = question.answers ?? []
  const missed = answers.filter((answer, i) => answer.right && !selected.includes(i)).length
  const incorrect = answers.filter((answer, i) => !answer.right && selected.includes(i)).length
  const correct = answers.filter((answer, i) => answer.right && selected.includes(i)).length
  return { ok: missed === 0 && incorrect === 0, missed, incorrect, correct }
}

export function recordAttempt(session: StudySession, assessment: Assessment): StudySession {
  if (session.finished || session.attempts.length > session.index) return session
  return { ...session, revealed: true, attempts: [...session.attempts, {
    item: session.round[session.index], assessment, selected: [...session.selected], draft: session.draft,
  }] }
}

export function nextQuestion(session: StudySession): StudySession {
  if (session.attempts.length <= session.index) return session
  if (session.index + 1 === session.round.length) return { ...session, finished: true }
  return { ...session, index: session.index + 1, selected: [], revealed: false, draft: '' }
}

export function questionsToReview(session: StudySession): StudyQuestion[] {
  return session.attempts.filter((attempt) => attempt.assessment !== 'correct').map((attempt) => attempt.item)
}

function isQuestion(value: unknown): value is Question {
  if (!value || typeof value !== 'object') return false
  const q = value as Question
  return typeof q.name === 'string'
    && (q.keyPoints === undefined || (Array.isArray(q.keyPoints) && q.keyPoints.every((point) => typeof point === 'string')))
    && (q.source === undefined || typeof q.source === 'string') && (Array.isArray(q.answers)
    ? q.answers.length > 0 && q.answers.every((a) => a && typeof a.body === 'string' && typeof a.right === 'boolean'
      && (a.comment === undefined || typeof a.comment === 'string')) && q.answers.some((a) => a.right)
    : typeof q.answer === 'string')
}

function isItem(value: unknown): value is StudyQuestion {
  if (!value || typeof value !== 'object') return false
  const item = value as StudyQuestion
  return typeof item.key === 'string' && typeof item.datasetId === 'string' && isQuestion(item.question)
}

function isSelection(value: unknown, question: Question): value is number[] {
  return Array.isArray(value) && value.every((i) => Number.isInteger(i) && i >= 0 && i < (question.answers?.length ?? 0))
    && new Set(value).size === value.length
}

export function readSession(): StudySession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as StudySession | null
    if (!s || s.version !== 1 || s.finished !== false || typeof s.id !== 'string'
      || typeof s.title !== 'string' || typeof s.revision !== 'string'
      || !Array.isArray(s.datasetIds) || !s.datasetIds.length || !s.datasetIds.every((id) => typeof id === 'string')
      || !['full', 'quick', 'mixed', 'review'].includes(s.mode) || typeof s.shuffled !== 'boolean'
      || !Array.isArray(s.round) || !s.round.length || !s.round.every(isItem)
      || !Number.isInteger(s.index) || s.index < 0 || s.index >= s.round.length
      || typeof s.draft !== 'string' || typeof s.revealed !== 'boolean' || !Number.isFinite(s.savedAt)
      || !isSelection(s.selected, s.round[s.index].question)
      || !Array.isArray(s.attempts) || s.attempts.length < s.index || s.attempts.length > s.index + 1
      || (s.attempts.length === s.index + 1 && !s.revealed)
      || !s.attempts.every((attempt, index) => isItem(attempt.item)
        && attempt.item.key === s.round[index].key && ['correct', 'partial', 'wrong'].includes(attempt.assessment)
        && typeof attempt.draft === 'string' && isSelection(attempt.selected, attempt.item.question))) return null
    return s
  } catch { return null }
}

let persistenceFailed = false
const listeners = new Set<() => void>()
export function subscribePersistence(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function getPersistenceFailed() { return persistenceFailed }

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    if (persistenceFailed) { persistenceFailed = false; listeners.forEach((listener) => listener()) }
    return true
  } catch {
    if (!persistenceFailed) { persistenceFailed = true; listeners.forEach((listener) => listener()) }
    return false
  }
}

export function saveSession(session: StudySession) { return write(SESSION_KEY, { ...session, savedAt: Date.now() }) }
export function clearSession() { return write(SESSION_KEY, null) }

export function readResults(): StudyResult[] {
  try {
    const value = JSON.parse(localStorage.getItem(RESULTS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((r) => r && typeof r.sessionId === 'string'
      && Array.isArray(r.datasetIds) && r.datasetIds.every((id: unknown) => typeof id === 'string')
      && ['full', 'quick', 'mixed', 'review'].includes(r.mode)
      && [r.total, r.correct, r.partial, r.answered, r.completedAt].every(Number.isFinite)
      && r.total > 0 && r.answered >= 0 && r.answered <= r.total
      && r.correct >= 0 && r.partial >= 0 && r.correct + r.partial <= r.answered) : []
  } catch { return [] }
}

export function saveResult(session: StudySession) {
  if (!session.attempts.length) return true
  const results = readResults().filter((result) => result.sessionId !== session.id)
  const result: StudyResult = {
    sessionId: session.id, datasetIds: session.datasetIds, mode: session.mode, total: session.round.length,
    answered: session.attempts.length, correct: session.attempts.filter((a) => a.assessment === 'correct').length,
    partial: session.attempts.filter((a) => a.assessment === 'partial').length, completedAt: Date.now(),
  }
  return write(RESULTS_KEY, [result, ...results].slice(0, 100))
}
