import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { loadDatasets, loadQuestions } from './data'
import Quiz from './Quiz'
import type { DatasetInfo } from './types'
import { bankOf, clearSession, createSession, exportProgress, formatDuration, historyKey, importProgress, isDue, isWeak,
  pruneHistory, readHistory, readResults, readSession, revisionOf } from './study'
import type { History, StudySession, StudySource } from './study'
import { getRouteHash, navigate, parseRoute, routeHash, subscribeRoute } from './navigation'

const COURSE_DESCRIPTIONS: Record<string, string> = {
  PA015: 'Agentic AI, language models and tools',
  PV017: 'Information security management',
  PV157: 'Authentication, cryptography and access control',
}
function courseOf(ds: DatasetInfo): string { return ds.course ?? ds.name.split(' - ')[0] }
function lectureTitle(ds: DatasetInfo): string { return ds.name.replace(`${courseOf(ds)} - `, '') }
function lectureLabel(ds: DatasetInfo): string { return lectureTitle(ds).split(' ')[0] } // "L3"
function formatOf(ds: DatasetInfo): string {
  const parts: string[] = []
  if (ds.multipleChoiceCount) parts.push(`${ds.multipleChoiceCount} multiple choice`)
  if (ds.essayCount) parts.push(`${ds.essayCount} ${ds.essayCount === 1 ? 'essay' : 'essays'}`)
  return parts.join(' · ') || 'Practice questions'
}
function historyOf(history: History, ds: DatasetInfo) {
  return Object.entries(history).filter(([key]) => key.startsWith(`${ds.id}:`)).map(([, h]) => h)
}
function masteryOf(history: History, ds: DatasetInfo): string | null {
  const entries = historyOf(history, ds)
  if (!entries.length) return null
  const known = entries.filter((h) => h.last === 'correct').length
  const fresh = Math.max((ds.questionCount ?? 0) - entries.length, 0)
  const due = entries.filter((h) => isDue(h)).length
  return [`${known} of ${ds.questionCount ?? entries.length} known`, entries.length - known && `${entries.length - known} missed`,
    fresh && `${fresh} new`, due && `${due} due today`].filter(Boolean).join(' · ')
}

export default function App() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [active, setActive] = useState<{ session: StudySession; sources: StudySource[] } | null>(null)
  const [, refreshSaved] = useState(0)
  const results = readResults()
  const history = readHistory()
  const [error, setError] = useState<string | null>(null)
  // Shown under the backup buttons, which sit at the bottom of the page.
  const [backupMessage, setBackupMessage] = useState<{ text: string; failed: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [shuffled, setShuffled] = useState(true)
  // Midterm practice: lectures L1 up to this many (null = all) and the number of questions.
  const [examUpTo, setExamUpTo] = useState<number | null>(null)
  const [examSize, setExamSize] = useState('30')
  const [selectedLectures, setSelectedLectures] = useState<string[]>([])
  const pageHeading = useRef<HTMLHeadingElement>(null)
  const hash = useSyncExternalStore(subscribeRoute, getRouteHash)
  const route = parseRoute(hash)
  const course = route.course
  const current = datasets.find((ds) => ds.id === route.datasetId && courseOf(ds) === course)
  const courses = [...new Set(datasets.map(courseOf))]
  const onSessionChange = useCallback((session: StudySession) => {
    setActive((current) => current ? { ...current, session } : null)
  }, [])

  useEffect(() => {
    loadDatasets().then(setDatasets)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setReady(true))
  }, [])
  useEffect(() => { pageHeading.current?.focus() }, [hash])

  // filter: 'due' = questions due for spaced review, 'weak' = questions missed or partly recalled last time.
  // examSize: midterm practice with that many random multiple-choice questions.
  async function start(entries: DatasetInfo[], quick = false, filter?: 'due' | 'weak', examSize?: number) {
    setError(null)
    setLoading(true)
    try {
      const sources = await Promise.all(entries.map(async (ds) => ({ datasetId: ds.id, questions: await loadQuestions(ds.dataset) })))
      pruneHistory(sources)
      const fresh = readHistory()
      const ds = entries[0]
      const review = examSize ? bankOf(sources).filter((item) => item.question.answers)
        : filter && bankOf(sources).filter((item) => (filter === 'due' ? isDue : isWeak)(fresh[historyKey(item)]))
      if (review && !review.length) { refreshSaved((n) => n + 1); throw new Error('Nothing to review right now.') }
      const range = entries.length === 1 ? lectureLabel(ds) : `${lectureLabel(ds)}–${lectureLabel(entries[entries.length - 1])}`
      const title = examSize ? `${courseOf(ds)} - Midterm practice (${range})`
        : filter ? `${courseOf(ds)} - ${filter === 'due' ? 'Due today' : 'Missed questions'}`
        : entries.length === 1 ? ds.name : `${courseOf(ds)} - Mixed practice (${entries.length} lectures)`
      const session = examSize
        ? createSession(sources, title, { review: review || undefined, limit: examSize, exam: true })
        : createSession(sources, title, { shuffled, limit: quick ? 10 : undefined, review: review || undefined, history: fresh })
      setActive({ session, sources })
      navigate(courseOf(ds), entries.length === 1 ? ds.id : null, true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  async function resume() {
    const stored = readSession()
    if (!stored) { refreshSaved((n) => n + 1); return }
    setLoading(true)
    setError(null)
    try {
      const sources = await Promise.all(stored.datasetIds.map(async (id) => {
        const ds = datasets.find((entry) => entry.id === id)
        if (!ds) throw new Error('This lecture is no longer available. Start a new session.')
        return { datasetId: id, questions: await loadQuestions(ds.dataset) }
      }))
      if (revisionOf(sources) !== stored.revision) {
        clearSession(); refreshSaved((n) => n + 1)
        throw new Error('These questions have been updated. Please start a new session with the latest answers.')
      }
      const ds = datasets.find((entry) => entry.id === stored.datasetIds[0])!
      setActive({ session: stored, sources })
      navigate(courseOf(ds), stored.datasetIds.length === 1 ? ds.id : null, true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  function downloadProgress() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportProgress())], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `drill-progress-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function uploadProgress(input: HTMLInputElement) {
    const file = input.files?.[0]
    input.value = '' // lets the same file be picked again
    if (!file) return
    setBackupMessage(null)
    let backup: unknown
    try { backup = JSON.parse(await file.text()) } catch { backup = null }
    if (!backup || (backup as { app?: unknown }).app !== 'drill') {
      setBackupMessage({ text: 'This file is not a Drill progress backup.', failed: true }); return
    }
    if (!window.confirm('Replace the progress saved in this browser with the backup?')) return
    setBackupMessage(importProgress(backup) ? { text: 'Progress imported.', failed: false }
      : { text: 'The backup could not be imported. Storage may be full or blocked.', failed: true })
    refreshSaved((n) => n + 1)
  }

  function exit() {
    refreshSaved((n) => n + 1)
    setActive(null)
    navigate(course, route.datasetId)
  }

  const activeDataset = active && datasets.find((ds) => ds.id === active.session.datasetIds[0])
  if (route.practice && active && activeDataset && courseOf(activeDataset) === course
    && (active.session.datasetIds.length > 1 ? route.datasetId === null : route.datasetId === activeDataset.id)) return <Quiz initial={active.session} sources={active.sources} onExit={exit} onSessionChange={onSessionChange}
    sourceTitles={Object.fromEntries(datasets.map((ds) => [ds.id, lectureTitle(ds)]))} />

  // Reading here keeps the paused banner current after browser Back unmounts the quiz.
  const paused = readSession()
  const resumeCard = paused && <section className="resume-card" aria-label="Paused session">
    <div><p className="eyebrow">Ready when you are</p><h2>{paused.title}</h2>
      <p className="muted">Question {paused.index + 1} of {paused.round.length} · {paused.attempts.length} answered</p></div>
    <button type="button" className="primary" disabled={loading || !ready} onClick={resume}>{loading ? 'Loading…' : 'Continue session'}</button>
  </section>

  function lastResult(ds: DatasetInfo) {
    if (paused?.datasetIds.length === 1 && paused.datasetIds[0] === ds.id) {
      return `Paused ${paused.mode === 'quick' ? 'quick practice' : 'session'} · ${paused.attempts.length}/${paused.round.length} answered`
    }
    const result = results.find((r) => r.datasetIds.length === 1 && r.datasetIds[0] === ds.id && r.mode !== 'review' && r.mode !== 'exam')
    if (!result) return 'Not practiced yet'
    const percent = Math.round(result.correct / result.answered * 100)
    return `${result.mode === 'quick' ? 'Last quick practice' : 'Last lecture attempt'}: ${percent}% · ${result.answered}/${result.total} answered`
  }

  function lectureList(items: DatasetInfo[], selectable = false) {
    return <ul className="datasets">{items.map((ds) => <li key={ds.id} className={selectable ? 'lecture-row' : ''}>
      <a className="dataset-card" href={routeHash(courseOf(ds), ds.id)}>
        <div className="card-top"><strong>{lectureTitle(ds)}</strong><span aria-hidden="true">→</span></div>
        <span className="muted">{ds.questionCount ?? '—'} questions · {formatOf(ds)}</span>
        <span className="card-progress">{lastResult(ds)}</span>
        {masteryOf(history, ds) && <span className="card-progress">{masteryOf(history, ds)}</span>}
      </a>
      {selectable && <label className="mix-toggle"><input type="checkbox" aria-label={`Include ${lectureTitle(ds)} in mixed practice`}
        checked={selectedLectures.includes(ds.id)} onChange={() => setSelectedLectures((ids) => ids.includes(ds.id) ? ids.filter((id) => id !== ds.id) : [...ids, ds.id])} /><span>Mix</span></label>}
    </li>)}</ul>
  }

  function orderControl(id: string) {
    return <div className="order-control"><label htmlFor={id}>Question order</label><select id={id} value={shuffled ? 'shuffle' : 'lecture'} onChange={(event) => setShuffled(event.target.value === 'shuffle')}>
      <option value="shuffle">Shuffled</option><option value="lecture">Lecture order</option>
    </select></div>
  }

  if (!course) return <main>
    <p className="eyebrow">Your study space</p><h1 ref={pageHeading} tabIndex={-1}>Drill</h1>
    <p className="intro">Practice lecture questions and review what you missed.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {resumeCard}
    <h2 className="section-title">Choose a course</h2>
    {!ready && <p role="status">Loading courses…</p>}
    <ul className="datasets">{courses.map((c) => <li key={c}><a className="dataset-card" href={routeHash(c)}>
      <div className="card-top"><strong>{c}</strong><span className="badge">{datasets.filter((ds) => courseOf(ds) === c).length} sets</span></div>
      <span className="muted">{COURSE_DESCRIPTIONS[c] ?? 'Lecture practice'}</span>
    </a></li>)}</ul>
    <section className="backup" aria-label="Progress backup">
      <p className="local-note">Progress is saved in this browser on this device. Export it now and then as a backup, or to move it to another device.</p>
      <div className="actions">
        <button type="button" onClick={downloadProgress}>Export progress</button>
        <label className="button">Import progress<input type="file" accept="application/json,.json" className="visually-hidden"
          onChange={(event) => uploadProgress(event.currentTarget)} /></label>
      </div>
      {backupMessage && <p className={backupMessage.failed ? 'error' : 'hint'} role={backupMessage.failed ? 'alert' : 'status'}>{backupMessage.text}</p>}
    </section>
  </main>

  const items = datasets.filter((ds) => courseOf(ds) === course)
  const currentLectures = items.filter((ds) => ds.group !== 'archive')
  const selected = currentLectures.filter((ds) => selectedLectures.includes(ds.id))
  const courseHistory = currentLectures.flatMap((ds) => historyOf(history, ds))
  const dueCount = courseHistory.filter((h) => isDue(h)).length
  const weakCount = courseHistory.filter(isWeak).length
  const mcLectures = currentLectures.filter((ds) => ds.multipleChoiceCount && /^L\d/.test(lectureLabel(ds)))
  const examRange = mcLectures.slice(0, Math.min(examUpTo ?? mcLectures.length, mcLectures.length))
  const examPool = examRange.reduce((sum, ds) => sum + (ds.multipleChoiceCount ?? 0), 0)
  const examCount = examSize === 'all' ? examPool : Math.min(Number(examSize), examPool)
  const lastExam = results.find((r) => r.mode === 'exam' && r.datasetIds.every((id) => mcLectures.some((ds) => ds.id === id)))
  return <main>
    <nav className="breadcrumbs" aria-label="Breadcrumb"><a href="#/">All courses</a><span aria-hidden="true">/</span>
      {route.datasetId ? <><a href={routeHash(course)}>{course}</a><span aria-hidden="true">/</span><span>Lecture</span></> : <span>{course}</span>}
    </nav>
    {error && <p className="error" role="alert">{error}</p>}
    {!ready ? <p role="status">Loading lectures…</p> : !courses.includes(course) || (route.datasetId && !current) ? <>
      <h1 ref={pageHeading} tabIndex={-1}>Lecture unavailable</h1><p>Choose an available course or lecture to continue.</p><a href="#/">All courses</a>
    </> : current ? <>
      <p className="eyebrow">{course}</p><h1 ref={pageHeading} tabIndex={-1}>{lectureTitle(current)}</h1>
      <p className="intro">{current.questionCount} questions · {formatOf(current)}</p>
      <p className="card-progress">{lastResult(current)}</p>
      {masteryOf(history, current) && <p className="card-progress">{masteryOf(history, current)}</p>}
      {current.group === 'archive' && <p className="notice">Older practice material. Its scope may differ from the current lectures.</p>}
      {resumeCard}
      <section className="practice-panel"><h2>Practice this lecture</h2>
        <p className="muted">Check each answer as you go. Pause whenever you need a break.</p>
        {orderControl('lecture-order')}
        <p className="hint">{shuffled ? 'Questions and answer choices are shuffled.' : 'Questions and answer choices stay in their original order.'} Quick practice picks due, missed and new questions first.</p>
        {paused && <p className="hint">Starting a new session replaces your paused session.</p>}
        <div className="actions"><button type="button" className="primary" disabled={loading} onClick={() => start([current])}>{loading ? 'Loading questions…' : 'Start full lecture'}</button>
          <button type="button" disabled={loading} onClick={() => start([current], true)}>Quick practice ({Math.min(current.questionCount ?? 10, 10)} questions)</button></div>
      </section>
    </> : <>
      <h1 ref={pageHeading} tabIndex={-1}>{course}</h1><p className="intro">{COURSE_DESCRIPTIONS[course] ?? 'Choose a lecture to practice.'}</p>
      {resumeCard}
      {(dueCount > 0 || weakCount > 0) && <section className="practice-panel"><h2>Review across lectures</h2>
        <p className="muted">Due questions come back after 1, 3, 7, 14 and 30 days as you keep answering them correctly. Missed questions are the ones you got wrong or only partly recalled last time.</p>
        {paused && <p className="hint">Starting a new session replaces your paused session.</p>}
        <div className="actions">
          <button type="button" className="primary" disabled={loading || !dueCount} onClick={() => start(currentLectures, false, 'due')}>Due today ({dueCount})</button>
          <button type="button" disabled={loading || !weakCount} onClick={() => start(currentLectures, false, 'weak')}>Missed questions ({weakCount})</button>
        </div>
      </section>}
      {currentLectures.length > 0 && <><h2 className="section-title">Current lectures</h2>
        {currentLectures.length > 1 && <p className="hint">Open a lecture, mix all of them below, or tick Mix on two or more lectures to practice just those together.</p>}
        {lectureList(currentLectures, currentLectures.length > 1)}</>}
      {currentLectures.length > 1 && <section className="practice-panel"><h2>Mix lectures</h2>
        <p className="muted">Mixing topics makes you work out which idea applies, as in the exam. Quick mix picks due, missed and new questions first.</p>
        {orderControl('mixed-order')}
        {paused && <p className="hint">Starting a new session replaces your paused session.</p>}
        <div className="actions">
          <button type="button" className="primary" disabled={loading} onClick={() => start(currentLectures)}>{loading ? 'Loading questions…' : `All lectures (${currentLectures.reduce((sum, ds) => sum + (ds.questionCount ?? 0), 0)} questions)`}</button>
          <button type="button" disabled={loading} onClick={() => start(currentLectures, true)}>Quick mix (10 questions)</button>
          <button type="button" disabled={loading || selected.length < 2} onClick={() => start(selected)}>Practice selected ({selected.length} lectures · {selected.reduce((sum, ds) => sum + (ds.questionCount ?? 0), 0)} questions)</button>
        </div>
      </section>}
      {mcLectures.length > 0 && <section className="practice-panel"><h2>Midterm practice</h2>
        <p className="muted">Test conditions: multiple choice only, random questions, no feedback until the end, clock running. The answers still count for spaced repetition.</p>
        {lastExam && <p className="card-progress">Last test: {Math.round(lastExam.correct / lastExam.answered * 100)}% · {lastExam.answered}/{lastExam.total} answered{lastExam.elapsed !== undefined ? ` · ${formatDuration(lastExam.elapsed)}` : ''}</p>}
        <div className="order-control">
          <label htmlFor="exam-range">Lectures</label>
          <select id="exam-range" value={examRange.length} onChange={(event) => setExamUpTo(Number(event.target.value))}>
            {mcLectures.map((ds, i) => <option key={ds.id} value={i + 1}>{i ? `${lectureLabel(mcLectures[0])}–${lectureLabel(ds)}` : lectureLabel(ds)}</option>)}
          </select>
          <label htmlFor="exam-size">Questions</label>
          <select id="exam-size" value={examSize} onChange={(event) => setExamSize(event.target.value)}>
            <option value="20">20</option><option value="30">30</option><option value="all">All ({examPool})</option>
          </select>
        </div>
        {paused && <p className="hint">Starting a new session replaces your paused session.</p>}
        <div className="actions"><button type="button" className="primary" disabled={loading || !examCount}
          onClick={() => start(examRange, false, undefined, examCount)}>{loading ? 'Loading questions…' : `Start test (${examCount} questions)`}</button></div>
      </section>}
      {items.some((ds) => ds.group === 'archive') && <section className="archive"><h2 className="section-title">Older practice sets</h2>
        <p className="hint">Additional revision material from earlier question banks.</p>{lectureList(items.filter((ds) => ds.group === 'archive'))}</section>}
    </>}
  </main>
}
