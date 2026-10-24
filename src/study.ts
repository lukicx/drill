import type { Question } from './types'

export interface StudySource { datasetId: string; questions: Question[] }
// `retry` marks a missed question asked again later in the same round; it does not count for the score.
export interface StudyQuestion { key: string; datasetId: string; question: Question; retry?: boolean }
export type Assessment = 'correct' | 'partial' | 'wrong'
// 'exam' = midterm practice: no feedback until the end, no second tries, clock running.
export type StudyMode = 'full' | 'quick' | 'mixed' | 'review' | 'exam'
const MODES: StudyMode[] = ['full', 'quick', 'mixed', 'review', 'exam']
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
  elapsed?: number // exam mode: milliseconds spent answering, pauses excluded
}
export interface StudyResult {
  sessionId: string; datasetIds: string[]; mode: StudyMode; total: number
  correct: number; partial: number; answered: number; completedAt: number; elapsed?: number
}

const SESSION_KEY = 'drill.session.v1'
const RESULTS_KEY = 'drill.results.v1'
const HISTORY_KEY = 'drill.history.v1'
const ANSWER_FIRST_KEY = 'drill.answerFirst'
const DAY = 24 * 60 * 60 * 1000
const BOX_DAYS = [1, 3, 7, 14, 30] // days until a question is due again, for boxes 1-5
const RETRY_GAP = 4 // a missed question comes back after this many other questions

export function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function hashText(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}

// Avoid resuming old answers after a dataset changes.
export function revisionOf(sources: StudySource[]): string { return hashText(JSON.stringify(sources)) }

export function bankOf(sources: StudySource[]): StudyQuestion[] {
  return sources.flatMap(({ datasetId, questions }) =>
    questions.map((question, index) => ({ key: `${datasetId}:${index}`, datasetId, question })))
}

// Per-question history (Leitner boxes). Keyed by question text, so it survives reordering a set;
// an edited question starts fresh.
export interface QuestionHistory { box: number; due: number; last: Assessment }
export type History = Record<string, QuestionHistory>

export function historyKey(item: { datasetId: string; question: Question }) {
  return `${item.datasetId}:${hashText(item.question.name)}`
}

export function readHistory(): History {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value as Record<string, QuestionHistory>).filter(([, h]) => h
      && Number.isInteger(h.box) && h.box >= 1 && h.box <= BOX_DAYS.length && Number.isFinite(h.due)
      && ['correct', 'partial', 'wrong'].includes(h.last)))
  } catch { return {} }
}

// Correct answers move a question up one box, but only once it is due (answering early does not
// count as spaced recall). Anything else sends it back to box 1, due tomorrow.
export function nextHistory(prev: QuestionHistory | undefined, assessment: Assessment, now = Date.now()): QuestionHistory {
  const today = new Date(now).setHours(0, 0, 0, 0)
  if (assessment !== 'correct') return { box: 1, due: today + DAY, last: assessment }
  if (prev && prev.due > now) return { ...prev, last: 'correct' }
  const box = Math.min((prev?.box ?? 0) + 1, BOX_DAYS.length)
  return { box, due: today + BOX_DAYS[box - 1] * DAY, last: 'correct' }
}

export function recordHistory(item: StudyQuestion, assessment: Assessment) {
  const history = readHistory()
  history[historyKey(item)] = nextHistory(history[historyKey(item)], assessment)
  return write(HISTORY_KEY, history)
}

// Drops entries of questions that were removed or edited in the loaded sets.
export function pruneHistory(sources: StudySource[]) {
  const history = readHistory()
  const current = new Set(bankOf(sources).map(historyKey))
  const loaded = sources.map((source) => `${source.datasetId}:`)
  const stale = Object.keys(history).filter((key) => loaded.some((prefix) => key.startsWith(prefix)) && !current.has(key))
  if (!stale.length) return true
  stale.forEach((key) => delete history[key])
  return write(HISTORY_KEY, history)
}

export const isDue = (h: QuestionHistory | undefined, now = Date.now()) => !!h && h.due <= now
export const isWeak = (h: QuestionHistory | undefined) => !!h && h.last !== 'correct'

// Quick practice order: due first, then missed, then never seen, then the rest.
function priorityOf(h: QuestionHistory | undefined, now: number) {
  return isDue(h, now) ? 0 : isWeak(h) ? 1 : !h ? 2 : 3
}

export function createSession(sources: StudySource[], title: string, options: {
  shuffled?: boolean; limit?: number; review?: StudyQuestion[]; history?: History; exam?: boolean
} = {}): StudySession {
  const shuffled = options.shuffled ?? true
  const bank = options.review ?? bankOf(sources)
  let ordered = shuffled ? shuffle(bank) : [...bank]
  if (options.limit && options.history) {
    const history = options.history, now = Date.now()
    ordered = ordered.map((item) => ({ item, p: priorityOf(history[historyKey(item)], now) }))
      .sort((a, b) => a.p - b.p).map(({ item }) => item)
  }
  const round = ordered.slice(0, options.limit ?? ordered.length).map((item) => ({
    ...item, question: shuffled && item.question.answers
      ? { ...item.question, answers: shuffle(item.question.answers) } : item.question,
  }))
  if (!round.length) throw new Error('Choose at least one question to practice.')
  return {
    version: 1, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title, datasetIds: sources.map((source) => source.datasetId), revision: revisionOf(sources),
    mode: options.exam ? 'exam' : options.review ? 'review' : options.limit ? 'quick' : sources.length > 1 ? 'mixed' : 'full',
    shuffled, round, index: 0, selected: [], revealed: false, draft: '',
    attempts: [], finished: false, savedAt: Date.now(), ...(options.exam ? { elapsed: 0 } : {}),
  }
}

export function checkSelection(question: Question, selected: number[]) {
  const answers = question.answers ?? []
  const missed = answers.filter((answer, i) => answer.right && !selected.includes(i)).length
  const incorrect = answers.filter((answer, i) => !answer.right && selected.includes(i)).length
  const correct = answers.filter((answer, i) => answer.right && selected.includes(i)).length
  return { ok: missed === 0 && incorrect === 0, missed, incorrect, correct }
}

// A missed question (first try only) is put back into the round a few questions later.
export function recordAttempt(session: StudySession, assessment: Assessment): StudySession {
  if (session.finished || session.attempts.length > session.index) return session
  const item = session.round[session.index]
  let round = session.round
  if (assessment !== 'correct' && !item.retry && session.mode !== 'exam') {
    const question = session.shuffled && item.question.answers
      ? { ...item.question, answers: shuffle(item.question.answers) } : item.question
    const at = Math.min(session.index + 1 + RETRY_GAP, round.length)
    round = [...round.slice(0, at), { ...item, question, retry: true }, ...round.slice(at)]
  }
  return { ...session, round, revealed: true, attempts: [...session.attempts, {
    item, assessment, selected: [...session.selected], draft: session.draft,
  }] }
}

// "4:05" for the exam clock; "1:02:05" past an hour.
export function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// Essay mark suggested from ticked key points: all = correct, at least half = partial, else wrong.
export function suggestedAssessment(ticked: number, total: number): Assessment | null {
  if (total <= 0) return null
  return ticked >= total ? 'correct' : ticked * 2 >= total ? 'partial' : 'wrong'
}

// Score and review lists count only the first try of each question.
export function firstAttempts(session: StudySession): Attempt[] {
  return session.attempts.filter((attempt) => !attempt.item.retry)
}

export function questionCount(session: StudySession) {
  return session.round.filter((item) => !item.retry).length
}

export function nextQuestion(session: StudySession): StudySession {
  if (session.attempts.length <= session.index) return session
  if (session.index + 1 === session.round.length) return { ...session, finished: true }
  return { ...session, index: session.index + 1, selected: [], revealed: false, draft: '' }
}

export function questionsToReview(session: StudySession): StudyQuestion[] {
  return firstAttempts(session).filter((attempt) => attempt.assessment !== 'correct').map((attempt) => attempt.item)
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
    && (item.retry === undefined || typeof item.retry === 'boolean')
}

// For essays, `selected` holds the indexes of the key points the learner ticked as covered.
function isSelection(value: unknown, question: Question): value is number[] {
  const size = question.answers?.length ?? question.keyPoints?.length ?? 0
  return Array.isArray(value) && value.every((i) => Number.isInteger(i) && i >= 0 && i < size)
    && new Set(value).size === value.length
}

export function readSession(): StudySession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as StudySession | null
    if (!s || s.version !== 1 || s.finished !== false || typeof s.id !== 'string'
      || typeof s.title !== 'string' || typeof s.revision !== 'string'
      || !Array.isArray(s.datasetIds) || !s.datasetIds.length || !s.datasetIds.every((id) => typeof id === 'string')
      || !MODES.includes(s.mode) || typeof s.shuffled !== 'boolean'
      || (s.elapsed !== undefined && !(Number.isFinite(s.elapsed) && s.elapsed >= 0))
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

// Backup of all progress as one JSON file, so it can be restored or moved to another device.
const BACKUP_KEYS = [SESSION_KEY, RESULTS_KEY, HISTORY_KEY, ANSWER_FIRST_KEY]
export interface ProgressBackup { app: 'drill'; version: 1; exportedAt: number; data: Record<string, unknown> }

export function exportProgress(): ProgressBackup {
  const data: Record<string, unknown> = {}
  for (const key of BACKUP_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) data[key] = JSON.parse(raw)
    } catch { /* unreadable entry: leave it out */ }
  }
  return { app: 'drill', version: 1, exportedAt: Date.now(), data }
}

// Replaces the saved values found in the backup; keys missing from it stay as they are.
// Contents are checked later by the readers, which drop invalid entries.
export function importProgress(value: unknown): boolean {
  const backup = value as ProgressBackup | null
  if (!backup || typeof backup !== 'object' || backup.app !== 'drill' || backup.version !== 1
    || !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) return false
  return BACKUP_KEYS.filter((key) => key in backup.data && backup.data[key] !== null)
    .every((key) => write(key, backup.data[key]))
}

// "Answer first": hide multiple-choice options until the learner has recalled an answer. Per device.
export function readAnswerFirst() {
  try { return localStorage.getItem(ANSWER_FIRST_KEY) === 'true' } catch { return false }
}
export function saveAnswerFirst(on: boolean) { return write(ANSWER_FIRST_KEY, on || null) }

export function saveSession(session: StudySession) { return write(SESSION_KEY, { ...session, savedAt: Date.now() }) }
export function clearSession() { return write(SESSION_KEY, null) }

export function readResults(): StudyResult[] {
  try {
    const value = JSON.parse(localStorage.getItem(RESULTS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((r) => r && typeof r.sessionId === 'string'
      && Array.isArray(r.datasetIds) && r.datasetIds.every((id: unknown) => typeof id === 'string')
      && MODES.includes(r.mode)
      && [r.total, r.correct, r.partial, r.answered, r.completedAt].every(Number.isFinite)
      && r.total > 0 && r.answered >= 0 && r.answered <= r.total
      && r.correct >= 0 && r.partial >= 0 && r.correct + r.partial <= r.answered) : []
  } catch { return [] }
}

export function saveResult(session: StudySession) {
  const attempts = firstAttempts(session)
  if (!attempts.length) return true
  const results = readResults().filter((result) => result.sessionId !== session.id)
  const result: StudyResult = {
    sessionId: session.id, datasetIds: session.datasetIds, mode: session.mode, total: questionCount(session),
    answered: attempts.length, correct: attempts.filter((a) => a.assessment === 'correct').length,
    partial: attempts.filter((a) => a.assessment === 'partial').length, completedAt: Date.now(),
    ...(session.elapsed !== undefined ? { elapsed: session.elapsed } : {}),
  }
  return write(RESULTS_KEY, [result, ...results].slice(0, 100))
}
