import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { checkSelection, createSession, nextQuestion, recordAttempt, questionsToReview,
  saveSession, readSession, saveResult, readResults, revisionOf, getPersistenceFailed, firstAttempts,
  nextHistory, isDue, isWeak, recordHistory, readHistory, historyKey, pruneHistory,
  readAnswerFirst, saveAnswerFirst } from '../src/study.ts'

const mc = { name: 'Pick both', answers: [{ body: 'A', right: true }, { body: 'B', right: true }, { body: 'C', right: false }] }
const essay = { name: 'Explain', answer: 'Model', keyPoints: ['Key'] }
const sources = [{ datasetId: 'course_L01', questions: [mc, essay] }]
beforeEach(() => {
  const values = new Map()
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
})

test('strict marking reports omissions separately from incorrect selections', () => {
  assert.deepEqual(checkSelection(mc, [0]), { ok: false, missed: 1, incorrect: 0, correct: 1 })
  assert.equal(checkSelection(mc, [0, 1, 2]).ok, false)
  assert.equal(checkSelection(mc, [0, 1]).ok, true)
})

test('refresh restores exact shuffled order, selections, draft and reveal state', () => {
  let session = createSession(sources, 'Course')
  session = { ...session, selected: session.round[0].question.answers ? [0] : [], draft: 'My draft', revealed: true }
  assert.equal(saveSession(session), true)
  const restored = readSession()
  assert.deepEqual({ ...restored, savedAt: 0 }, { ...session, savedAt: 0 })
})

test('attempts cannot be scored twice and unmarked questions cannot advance', () => {
  const session = createSession(sources, 'Course', { shuffled: false })
  assert.equal(nextQuestion(session), session)
  const checked = recordAttempt({ ...session, selected: [0] }, 'wrong')
  assert.equal(recordAttempt(checked, 'correct'), checked)
  const next = nextQuestion(checked)
  assert.equal(next.index, 1)
  assert.equal(next.revealed, false)
  assert.deepEqual(next.selected, [])
  let complete = nextQuestion(recordAttempt({ ...next, draft: 'Essay' }, 'partial'))
  assert.equal(complete.finished, false) // both missed questions come back as second tries
  while (!complete.finished) complete = nextQuestion(recordAttempt(complete, 'correct'))
  assert.equal(complete.attempts.length, 4)
  assert.equal(questionsToReview(complete).length, 2)
})

test('a missed question returns later in the round once and does not change the score', () => {
  const bank = [{ datasetId: 'large', questions: Array.from({ length: 8 }, (_, i) => ({ ...mc, name: `Q${i}` })) }]
  let session = recordAttempt(createSession(bank, 'Retry', { shuffled: false }), 'wrong')
  assert.equal(session.round.length, 9)
  assert.equal(session.round[5].question.name, 'Q0')
  assert.equal(session.round[5].retry, true)
  while (session.index < 4) session = recordAttempt(nextQuestion(session), 'correct')
  session = nextQuestion(session)
  assert.equal(session.round[session.index].retry, true)
  session = recordAttempt(session, 'wrong')
  assert.equal(session.round.length, 9) // a second try is not repeated again
  saveSession(session)
  assert.equal(readSession().round[5].retry, true)
  while (!session.finished) session = nextQuestion(session.attempts.length > session.index ? session : recordAttempt(session, 'correct'))
  saveResult(session)
  assert.deepEqual([readResults()[0].total, readResults()[0].answered, readResults()[0].correct], [8, 8, 7])
  assert.deepEqual(firstAttempts(session).map((a) => a.item.question.name), bank[0].questions.map((q) => q.name))
})

test('history moves questions through boxes only when they are due', () => {
  const now = new Date(2026, 9, 24, 12).getTime()
  const day = 24 * 60 * 60 * 1000
  const midnight = new Date(2026, 9, 24).getTime()
  let h = nextHistory(undefined, 'correct', now)
  assert.deepEqual(h, { box: 1, due: midnight + day, last: 'correct' })
  assert.deepEqual(nextHistory(h, 'correct', now), h) // answering early does not promote
  h = nextHistory(h, 'correct', midnight + day + 1)
  assert.deepEqual([h.box, h.due], [2, midnight + 4 * day])
  assert.deepEqual(nextHistory(h, 'partial', now), { box: 1, due: midnight + day, last: 'partial' })
  assert.equal(isDue(h, midnight + 4 * day), true)
  assert.equal(isWeak(nextHistory(h, 'wrong', now)), true)
})

test('history survives reordering, is pruned for removed questions and drives quick practice order', () => {
  const qs = Array.from({ length: 12 }, (_, i) => ({ ...mc, name: `Q${i}` }))
  const item = (q) => ({ key: 'x', datasetId: 'L1', question: q })
  recordHistory(item(qs[11]), 'wrong')
  recordHistory(item(qs[10]), 'correct')
  const history = readHistory()
  assert.equal(historyKey(item(qs[11])), historyKey({ ...item(qs[11]), key: 'L1:0' }))
  const quick = createSession([{ datasetId: 'L1', questions: qs }], 'Quick', { limit: 10, shuffled: false, history })
  assert.equal(quick.round[0].question.name, 'Q11') // missed first
  assert.equal(quick.round.some((entry) => entry.question.name === 'Q10'), false) // known last, cut off
  pruneHistory([{ datasetId: 'L1', questions: qs.slice(0, 11) }])
  assert.deepEqual(Object.keys(readHistory()), [historyKey(item(qs[10]))])
})

test('quick practice caps the round and lecture order does not change answers', () => {
  const bank = [{ datasetId: 'large', questions: Array.from({ length: 20 }, (_, i) => ({ ...mc, name: `Q${i}` })) }]
  const quick = createSession(bank, 'Quick', { limit: 10, shuffled: false })
  assert.equal(quick.round.length, 10)
  assert.equal(quick.mode, 'quick')
  assert.equal(quick.round[0].question.name, 'Q0')
  assert.deepEqual(quick.round[0].question.answers, mc.answers)
  assert.equal(bank[0].questions.length, 20)
})

test('corrupt storage is ignored and dataset changes invalidate the revision', () => {
  localStorage.setItem('drill.session.v1', '{broken')
  assert.equal(readSession(), null)
  const session = createSession(sources, 'Course')
  saveSession({ ...session, index: 999 })
  assert.equal(readSession(), null)
  saveSession({ ...session, selected: [999] })
  assert.equal(readSession(), null)
  const malformed = createSession(sources, 'Course', { shuffled: false })
  malformed.round[1] = { ...malformed.round[1], question: { ...essay, keyPoints: 42 } }
  saveSession(malformed)
  assert.equal(readSession(), null)
  assert.notEqual(revisionOf(sources), revisionOf([{ ...sources[0], questions: [essay] }]))
})

test('saving the same result twice is idempotent and retains early-session coverage', () => {
  const session = recordAttempt(createSession(sources, 'Course', { shuffled: false }), 'correct')
  saveResult(session)
  saveResult(session)
  const results = readResults()
  assert.equal(results.length, 1)
  assert.equal(results[0].answered, 1)
  assert.equal(results[0].total, 2)
})

test('blocked browser storage does not crash studying', () => {
  globalThis.localStorage = { getItem() { throw new Error('Blocked') }, setItem() { throw new Error('Blocked') }, removeItem() { throw new Error('Blocked') } }
  assert.equal(readSession(), null)
  assert.deepEqual(readResults(), [])
  assert.equal(saveSession(createSession(sources, 'Course')), false)
  assert.equal(getPersistenceFailed(), true)
})

test('mixed sessions retain source attribution and resume with the same revision', () => {
  const bank = [...sources, { datasetId: 'course_L02', questions: [essay] }]
  const mixed = createSession(bank, 'Mixed', { shuffled: false })
  assert.equal(mixed.mode, 'mixed')
  assert.deepEqual(mixed.datasetIds, ['course_L01', 'course_L02'])
  assert.deepEqual(mixed.round.map((item) => item.key), ['course_L01:0', 'course_L01:1', 'course_L02:0'])
  saveSession(mixed)
  assert.equal(readSession().revision, revisionOf(bank))
})

test('review rounds include partial answers, exclude correct answers and keep the source bank intact', () => {
  let session = createSession(sources, 'Course', { shuffled: false })
  session = nextQuestion(recordAttempt(session, 'correct'))
  session = recordAttempt(session, 'partial')
  const review = createSession(sources, 'Review', { review: questionsToReview(session), shuffled: false })
  assert.equal(review.mode, 'review')
  assert.equal(review.round.length, 1)
  assert.equal(review.round[0].key, 'course_L01:1')
  assert.equal(review.revision, revisionOf(sources))
  assert.equal(sources[0].questions.length, 2)
})

test('answer-first preference is remembered and blocked storage reads as off', () => {
  assert.equal(readAnswerFirst(), false)
  saveAnswerFirst(true)
  assert.equal(readAnswerFirst(), true)
  saveAnswerFirst(false)
  assert.equal(readAnswerFirst(), false)
  globalThis.localStorage = { getItem() { throw new Error('Blocked') }, setItem() { throw new Error('Blocked') }, removeItem() { throw new Error('Blocked') } }
  assert.equal(readAnswerFirst(), false)
  assert.equal(saveAnswerFirst(true), false)
})
