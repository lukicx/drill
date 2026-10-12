import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { loadDatasets, loadQuestions } from './data'
import Quiz from './Quiz'
import type { DatasetInfo } from './types'
import { clearSession, createSession, readResults, readSession, revisionOf } from './study'
import type { StudySession, StudySource } from './study'
import { getRouteHash, navigate, parseRoute, routeHash, subscribeRoute } from './navigation'

const COURSE_DESCRIPTIONS: Record<string, string> = {
  PA015: 'Agentic AI, language models and tools',
  PV017: 'Information security management',
  PV157: 'Authentication, cryptography and access control',
}
function courseOf(ds: DatasetInfo): string { return ds.course ?? ds.name.split(' - ')[0] }
function lectureTitle(ds: DatasetInfo): string { return ds.name.replace(`${courseOf(ds)} - `, '') }
function formatOf(ds: DatasetInfo): string {
  const parts: string[] = []
  if (ds.multipleChoiceCount) parts.push(`${ds.multipleChoiceCount} multiple choice`)
  if (ds.essayCount) parts.push(`${ds.essayCount} ${ds.essayCount === 1 ? 'essay' : 'essays'}`)
  return parts.join(' · ') || 'Practice questions'
}

export default function App() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [active, setActive] = useState<{ session: StudySession; sources: StudySource[] } | null>(null)
  const [, refreshSaved] = useState(0)
  const results = readResults()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [shuffled, setShuffled] = useState(true)
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

  async function start(entries: DatasetInfo[], quick = false) {
    setError(null)
    setLoading(true)
    try {
      const sources = await Promise.all(entries.map(async (ds) => ({ datasetId: ds.id, questions: await loadQuestions(ds.dataset) })))
      const ds = entries[0]
      const title = entries.length === 1 ? ds.name : `${courseOf(ds)} - Mixed practice (${entries.length} lectures)`
      const session = createSession(sources, title, { shuffled, limit: quick ? 10 : undefined })
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
    const result = results.find((r) => r.datasetIds.length === 1 && r.datasetIds[0] === ds.id && r.mode !== 'review')
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
    <p className="local-note">Progress is saved in this browser on this device.</p>
  </main>

  const items = datasets.filter((ds) => courseOf(ds) === course)
  const currentLectures = items.filter((ds) => ds.group !== 'archive')
  const selected = currentLectures.filter((ds) => selectedLectures.includes(ds.id))
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
      {current.group === 'archive' && <p className="notice">Older practice material. Its scope may differ from the current lectures.</p>}
      {resumeCard}
      <section className="practice-panel"><h2>Practice this lecture</h2>
        <p className="muted">Check each answer as you go. Pause whenever you need a break.</p>
        {orderControl('lecture-order')}
        <p className="hint">{shuffled ? 'Questions and answer choices are shuffled.' : 'Questions and answer choices stay in their original order. Quick practice uses the first 10 questions.'}</p>
        {paused && <p className="hint">Starting a new session replaces your paused session.</p>}
        <div className="actions"><button type="button" className="primary" disabled={loading} onClick={() => start([current])}>{loading ? 'Loading questions…' : 'Start full lecture'}</button>
          <button type="button" disabled={loading} onClick={() => start([current], true)}>Quick practice ({Math.min(current.questionCount ?? 10, 10)} questions)</button></div>
      </section>
    </> : <>
      <h1 ref={pageHeading} tabIndex={-1}>{course}</h1><p className="intro">{COURSE_DESCRIPTIONS[course] ?? 'Choose a lecture to practice.'}</p>
      {resumeCard}
      {currentLectures.length > 0 && <><h2 className="section-title">Current lectures</h2>
        {currentLectures.length > 1 && <p className="hint">Open a lecture, or tick Mix on two or more lectures to practice them together.</p>}
        {lectureList(currentLectures, currentLectures.length > 1)}</>}
      {currentLectures.length > 1 && <section className="practice-panel"><h2>Mix selected lectures</h2>
        <p className="muted">{selected.length} selected · {selected.reduce((sum, ds) => sum + (ds.questionCount ?? 0), 0)} questions</p>
        {orderControl('mixed-order')}
        {paused && <p className="hint">Starting a new session replaces your paused session.</p>}
        <div className="actions"><button type="button" className="primary" disabled={loading || selected.length < 2} onClick={() => start(selected)}>{loading ? 'Loading questions…' : 'Practice selected lectures'}</button>
          <button type="button" disabled={loading} onClick={() => setSelectedLectures(currentLectures.map((ds) => ds.id))}>Select all lectures</button></div>
      </section>}
      {items.some((ds) => ds.group === 'archive') && <section className="archive"><h2 className="section-title">Older practice sets</h2>
        <p className="hint">Additional revision material from earlier question banks.</p>{lectureList(items.filter((ds) => ds.group === 'archive'))}</section>}
    </>}
  </main>
}
