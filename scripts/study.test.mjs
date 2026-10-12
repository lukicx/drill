import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { checkSelection, createSession, nextQuestion, recordAttempt, questionsToReview,
  saveSession, readSession, saveResult, readResults, revisionOf, getPersistenceFailed } from '../src/study.ts'

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
  const complete = nextQuestion(recordAttempt({ ...next, draft: 'Essay' }, 'partial'))
  assert.equal(complete.finished, true)
  assert.equal(questionsToReview(complete).length, 2)
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
