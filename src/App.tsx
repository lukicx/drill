import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { loadDatasets, loadQuestions } from './data'
import Quiz from './Quiz'
import Search from './Search'
import type { DatasetInfo } from './types'
import { bankOf, clearSession, createSession, exportProgress, historyKey, importProgress, isDue, isWeak,
  pruneHistory, readHistory, readResults, readSession, revisionOf } from './study'
import type { History, StudyQuestion, StudySession, StudySource } from './study'
import { getRouteHash, goToSearch, navigate, parseRoute, routeHash, subscribeRoute } from './navigation'

const COURSE_DESCRIPTIONS: Record<string, string> = {
  PA015: 'Agentic AI, language models and tools',
  PV017: 'Information security management',
  PV157: 'Authentication, cryptography and access control',
  PA103: 'Object-oriented analysis and design, UML and patterns',
  PV179: 'System development in .NET',
  PA191: 'Advanced computer networking',
  PV021: 'Neural networks',
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
// One hue per course, in list order, for the course cards.
const COURSE_HUES = [221, 262, 330, 22, 158, 192, 290, 42]
const NOT_PRACTICED = 'Not practiced yet'

// Bar under a card: known (green) and missed (red) out of all questions; the rest is new.
function Meter({ known, missed, total }: { known: number; missed: number; total: number }) {
  if (!total) return null
  const width = (n: number) => `${Math.min(100, n / total * 100)}%`
  return <span className="meter" aria-hidden="true"><span className="meter-known" style={{ width: width(known) }} />
    <span className="meter-missed" style={{ width: width(missed) }} /></span>
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
  // back: the page to return to after the session (the search results it was started from).
  const [active, setActive] = useState<{ session: StudySession; sources: StudySource[]; back?: string } | null>(null)
  const [, refreshSaved] = useState(0)
  const results = readResults()
  const history = readHistory()
  const [error, setError] = useState<string | null>(null)
  // Shown under the backup buttons, which sit at the bottom of the page.
  const [backupMessage, setBackupMessage] = useState<{ text: string; failed: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [shuffled, setShuffled] = useState(true)
  const [selectedLectures, setSelectedLectures] = useState<string[]>([])
  const pageHeading = useRef<HTMLHeadingElement>(null)
  // A question shown as a bar in the page. Browser pop-ups (window.confirm) can be blocked, which
  // silently cancels the action. `hash`: the bar belongs to that page and disappears elsewhere.
  const [pending, setPending] = useState<{ text: string; confirm: string; cancel: string; run: () => void; hash: string } | null>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const hash = useSyncExternalStore(subscribeRoute, getRouteHash)
  const route = parseRoute(hash)
  const course = route.course
  const onSearchPage = !!route.search
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
  // On the search page the cursor stays in the search box while the address follows the typing.
  useEffect(() => { if (!onSearchPage) pageHeading.current?.focus() }, [hash, onSearchPage])
  useEffect(() => { if (pending) confirmButton.current?.focus() }, [pending])
  // "/" jumps to the search box, as on many sites.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]') || !searchInput.current) return
      event.preventDefault()
      searchInput.current.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Starting a session replaces the paused one, so ask first. Returns true when the question is shown;
  // `run` then starts the session if the learner agrees.
  function askToReplace(run: () => void) {
    const stored = readSession()
    if (!stored) return false
    setPending({ text: `Start a new session? Your paused session “${stored.title}” will be replaced.`,
      confirm: 'Replace and start', cancel: 'Keep paused session', run, hash })
    return true
  }

  // filter: 'due' = questions due for spaced review, 'weak' = questions missed or partly recalled last time.
  async function start(entries: DatasetInfo[], quick = false, filter?: 'due' | 'weak', replace = false) {
    if (!replace && askToReplace(() => start(entries, quick, filter, true))) return
    setError(null)
    setLoading(true)
    try {
      const sources = await Promise.all(entries.map(async (ds) => ({ datasetId: ds.id, questions: await loadQuestions(ds.dataset) })))
      pruneHistory(sources)
      const fresh = readHistory()
      const ds = entries[0]
      const review = filter && bankOf(sources).filter((item) => (filter === 'due' ? isDue : isWeak)(fresh[historyKey(item)]))
      if (review && !review.length) { refreshSaved((n) => n + 1); throw new Error('Nothing to review right now.') }
      const title = filter ? `${entries.length === 1 ? ds.name : courseOf(ds)} - ${filter === 'due' ? 'Due today' : 'Missed questions'}`
        : entries.length === 1 ? ds.name : `${courseOf(ds)} - Mixed practice (${entries.length} lectures)`
      const session = createSession(sources, title, { shuffled, limit: quick ? 10 : undefined, review: review || undefined, history: fresh })
      setActive({ session, sources })
      navigate(courseOf(ds), entries.length === 1 ? ds.id : null, true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  // Practice questions found by search; afterwards the app returns to the results.
  async function practiceFound(items: StudyQuestion[], replace = false) {
    if (!replace && askToReplace(() => practiceFound(items, true))) return
    setError(null)
    setLoading(true)
    try {
      const entries = [...new Set(items.map((item) => item.datasetId))].map((id) => datasets.find((ds) => ds.id === id)!)
      const sources = await Promise.all(entries.map(async (ds) => ({ datasetId: ds.id, questions: await loadQuestions(ds.dataset) })))
      const query = route.search?.query.trim() ?? ''
      const session = createSession(sources, `Search: “${query}”`, { review: items, shuffled })
      setActive({ session, sources, back: hash })
      navigate(courseOf(entries[0]), entries.length === 1 ? entries[0].id : null, true)
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
    setPending({ text: 'Replace the progress saved in this browser with the backup?', confirm: 'Replace progress',
      cancel: 'Cancel', hash, run: () => {
        setBackupMessage(importProgress(backup) ? { text: 'Progress imported.', failed: false }
          : { text: 'The backup could not be imported. Storage may be full or blocked.', failed: true })
        refreshSaved((n) => n + 1)
      } })
  }

  function exit() {
    refreshSaved((n) => n + 1)
    const back = active?.back
    setActive(null)
    if (back) window.location.hash = back
    else navigate(course, route.datasetId)
  }

  const activeDataset = active && datasets.find((ds) => ds.id === active.session.datasetIds[0])
  if (route.practice && active && activeDataset && courseOf(activeDataset) === course
    && (active.session.datasetIds.length > 1 ? route.datasetId === null : route.datasetId === activeDataset.id)) return <Quiz initial={active.session} sources={active.sources} onExit={exit} onSessionChange={onSessionChange}
    sourceTitles={Object.fromEntries(datasets.map((ds) => [ds.id, lectureTitle(ds)]))} exitLabel={active.back ? 'Back to search' : undefined} />

  // The search box sits at the top of every page except the quiz. It searches the open course, or all courses.
  const searchScope = route.search ? route.search.course : course
  const topbar = <header className="topbar">
    <a className="brand" href="#/"><span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>Drill</a>
    <form role="search" className="search-form" onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="search" className="visually-hidden">Search questions</label>
      <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input id="search" ref={searchInput} type="search" autoComplete="off" enterKeyHint="search"
        placeholder={searchScope ? `Search ${searchScope} questions` : 'Search all questions'}
        value={route.search?.query ?? ''} onChange={(event) => goToSearch(event.target.value, searchScope, onSearchPage)} />
      <kbd className="key-hint" aria-hidden="true">/</kbd>
    </form>
  </header>

  // Reading here keeps the paused banner current after browser Back unmounts the quiz.
  const paused = readSession()
  const confirmBar = pending?.hash === hash && <div className="confirm-bar" role="alertdialog" aria-labelledby="confirm-text"
    onKeyDown={(event) => { if (event.key === 'Escape') setPending(null) }}>
    <p id="confirm-text">{pending.text}</p>
    <div className="actions">
      <button type="button" className="primary" ref={confirmButton} onClick={() => { setPending(null); pending.run() }}>{pending.confirm}</button>
      <button type="button" onClick={() => setPending(null)}>{pending.cancel}</button>
    </div>
  </div>
  const resumeCard = paused && <section className="resume-card" aria-label="Paused session">
    <div><p className="eyebrow">Ready when you are</p><h2>{paused.title}</h2>
      <p className="muted">Question {paused.index + 1} of {paused.round.length} · {paused.attempts.length} answered</p></div>
    <button type="button" className="primary" disabled={loading || !ready} onClick={resume}>{loading ? 'Loading…' : 'Continue session'}</button>
  </section>

  // "Not practiced yet" only counts whole-lecture sessions, so it is hidden once mixes or reviews left a history.
  function statusLines(ds: DatasetInfo) {
    const last = lastResult(ds), mastery = masteryOf(history, ds)
    return [last === NOT_PRACTICED && mastery ? null : last, mastery].filter((line): line is string => !!line)
  }

  function lastResult(ds: DatasetInfo) {
    if (paused?.datasetIds.length === 1 && paused.datasetIds[0] === ds.id) {
      return `Paused ${paused.mode === 'quick' ? 'quick practice' : 'session'} · ${paused.attempts.length}/${paused.round.length} answered`
    }
    const result = results.find((r) => r.datasetIds.length === 1 && r.datasetIds[0] === ds.id && r.mode !== 'review')
    if (!result) return NOT_PRACTICED
    const percent = Math.round(result.correct / result.answered * 100)
    return `${result.mode === 'quick' ? 'Last quick practice' : 'Last lecture attempt'}: ${percent}% · ${result.answered}/${result.total} answered`
  }

  function lectureList(items: DatasetInfo[], selectable = false) {
    return <ul className="datasets">{items.map((ds) => <li key={ds.id} className={selectable ? 'lecture-row' : ''}>
      <a className="dataset-card" href={routeHash(courseOf(ds), ds.id)}>
        <div className="card-top"><strong>{lectureTitle(ds)}</strong><span aria-hidden="true">→</span></div>
        <span className="muted">{ds.questionCount ?? '—'} questions · {formatOf(ds)}</span>
        {statusLines(ds).map((line) => <span key={line} className="card-progress">{line}</span>)}
        {historyOf(history, ds).length > 0 && <Meter total={ds.questionCount ?? 0}
          known={historyOf(history, ds).filter((h) => h.last === 'correct').length} missed={historyOf(history, ds).filter(isWeak).length} />}
      </a>
      {selectable && <label className="mix-toggle"><input type="checkbox" aria-label={`Include ${lectureTitle(ds)} in mixed practice`}
        checked={selectedLectures.includes(ds.id)} onChange={() => setSelectedLectures((ids) => ids.includes(ds.id) ? ids.filter((id) => id !== ds.id) : [...ids, ds.id])} /><span>Mix</span></label>}
    </li>)}</ul>
  }

  // Due and missed questions of these lectures. Missed ones are asked hardest first (missed most often).
  function reviewPanel(entries: DatasetInfo[], heading: string) {
    const entryHistory = entries.flatMap((ds) => historyOf(history, ds))
    const dueCount = entryHistory.filter((h) => isDue(h)).length
    const weakCount = entryHistory.filter(isWeak).length
    if (!dueCount && !weakCount) return null
    return <section className="practice-panel"><h2>{heading}</h2>
      <p className="muted">Missed: wrong or only partly recalled last time, the most often missed first. Due: back after 1, 3, 7,
        14 and 30 days while you keep getting them right. In a round, a missed question returns 10 questions later until it is right.</p>
      <div className="actions">
        <button type="button" className={weakCount ? 'primary' : undefined} disabled={loading || !weakCount} onClick={() => start(entries, false, 'weak')}>Missed questions ({weakCount})</button>
        <button type="button" className={weakCount ? undefined : 'primary'} disabled={loading || !dueCount} onClick={() => start(entries, false, 'due')}>Due today ({dueCount})</button>
      </div>
    </section>
  }

  function orderControl(id: string) {
    return <div className="order-control"><label htmlFor={id}>Question order</label><select id={id} value={shuffled ? 'shuffle' : 'lecture'} onChange={(event) => setShuffled(event.target.value === 'shuffle')}>
      <option value="shuffle">Shuffled</option><option value="lecture">Lecture order</option>
    </select></div>
  }

  if (route.search) {
    const scoped = searchScope && courses.includes(searchScope) ? searchScope : null
    return <>{topbar}{confirmBar}<main>
      <nav className="breadcrumbs" aria-label="Breadcrumb"><a href="#/">All courses</a><span aria-hidden="true">/</span>
        {scoped && <><a href={routeHash(scoped)}>{scoped}</a><span aria-hidden="true">/</span></>}<span>Search</span></nav>
      <h1 ref={pageHeading} tabIndex={-1}>Search questions</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!ready ? <p role="status">Loading courses…</p> : <Search sets={scoped ? datasets.filter((ds) => courseOf(ds) === scoped) : datasets}
        query={route.search.query} course={scoped} history={history} busy={loading}
        titleOf={(id) => { const ds = datasets.find((entry) => entry.id === id); return !ds ? id : scoped ? lectureTitle(ds) : ds.name }}
        onWiden={() => goToSearch(route.search?.query ?? '', null, true)} onPractice={practiceFound} />}
    </main></>
  }

  // Course card status: what is waiting for review, so the main page shows where to go next.
  function courseStatus(c: string) {
    const entries = datasets.filter((ds) => courseOf(ds) === c && ds.group !== 'archive').flatMap((ds) => historyOf(history, ds))
    if (!entries.length) return 'Not practiced yet'
    const due = entries.filter((h) => isDue(h)).length, weak = entries.filter(isWeak).length
    return [`${entries.length} answered`, due && `${due} due today`, weak && `${weak} missed`].filter(Boolean).join(' · ')
  }

  if (!course) return <>{topbar}{confirmBar}<main>
    <h1 ref={pageHeading} tabIndex={-1}>Your courses</h1>
    <p className="intro">Practice lecture questions and review what you missed.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {resumeCard}
    {!ready && <p role="status">Loading courses…</p>}
    <ul className="datasets course-grid">{courses.map((c, i) => {
      const sets = datasets.filter((ds) => courseOf(ds) === c && ds.group !== 'archive')
      const entries = sets.flatMap((ds) => historyOf(history, ds))
      return <li key={c}><a className="dataset-card course-card" href={routeHash(c)} style={{ '--hue': COURSE_HUES[i % COURSE_HUES.length] } as CSSProperties}>
        <div className="card-top"><span className="course-code">{c}</span><span className="badge">{datasets.filter((ds) => courseOf(ds) === c).length} sets</span></div>
        <strong className="course-name">{COURSE_DESCRIPTIONS[c] ?? 'Lecture practice'}</strong>
        <span className="card-progress">{courseStatus(c)}</span>
        {entries.length > 0 && <Meter total={sets.reduce((sum, ds) => sum + (ds.questionCount ?? 0), 0)}
          known={entries.filter((h) => h.last === 'correct').length} missed={entries.filter(isWeak).length} />}
      </a></li>
    })}</ul>
    <section className="backup" aria-label="Progress backup">
      <p className="local-note">Progress is saved in this browser on this device. Export it now and then as a backup, or to move it to another device.</p>
      <div className="actions">
        <button type="button" onClick={downloadProgress}>Export progress</button>
        <label className="button">Import progress<input type="file" accept="application/json,.json" className="visually-hidden"
          onChange={(event) => uploadProgress(event.currentTarget)} /></label>
      </div>
      {backupMessage && <p className={backupMessage.failed ? 'error' : 'hint'} role={backupMessage.failed ? 'alert' : 'status'}>{backupMessage.text}</p>}
    </section>
  </main></>

  const items = datasets.filter((ds) => courseOf(ds) === course)
  const currentLectures = items.filter((ds) => ds.group !== 'archive')
  const selected = currentLectures.filter((ds) => selectedLectures.includes(ds.id))
  // Lectures are the L<n> sets; mock tests and question banks overlap them, so "All lectures" leaves them out.
  const lectures = currentLectures.filter((ds) => /^L\d/.test(lectureLabel(ds)))
  const banks = currentLectures.filter((ds) => !lectures.includes(ds))
  const questionsIn = (sets: DatasetInfo[]) => sets.reduce((sum, ds) => sum + (ds.questionCount ?? 0), 0)
  const courseReview = reviewPanel(currentLectures, 'Review across lectures')
  const lectureReview = current ? reviewPanel([current], 'Review this lecture') : null
  return <>{topbar}{confirmBar}<main>
    <nav className="breadcrumbs" aria-label="Breadcrumb"><a href="#/">All courses</a><span aria-hidden="true">/</span>
      {route.datasetId ? <><a href={routeHash(course)}>{course}</a><span aria-hidden="true">/</span><span>Lecture</span></> : <span>{course}</span>}
    </nav>
    {error && <p className="error" role="alert">{error}</p>}
    {!ready ? <p role="status">Loading lectures…</p> : !courses.includes(course) || (route.datasetId && !current) ? <>
      <h1 ref={pageHeading} tabIndex={-1}>Lecture unavailable</h1><p>Choose an available course or lecture to continue.</p><a href="#/">All courses</a>
    </> : current ? <>
      <p className="eyebrow">{course}</p><h1 ref={pageHeading} tabIndex={-1}>{lectureTitle(current)}</h1>
      <p className="intro">{current.questionCount} questions · {formatOf(current)}</p>
      {statusLines(current).map((line) => <p key={line} className="card-progress">{line}</p>)}
      {current.group === 'archive' && <p className="notice">Older practice material. Its scope may differ from the current lectures.</p>}
      {resumeCard}
      {lectureReview}
      <section className="practice-panel"><h2>Practice this lecture</h2>
        <p className="muted">Check each answer as you go. Pause whenever you need a break.</p>
        {orderControl('lecture-order')}
        <p className="hint">{shuffled ? 'Questions and answer choices are shuffled.' : 'Questions and answer choices stay in their original order.'} Quick practice picks due, missed and new questions first.</p>
        <div className="actions"><button type="button" className={lectureReview ? undefined : 'primary'} disabled={loading} onClick={() => start([current])}>{loading ? 'Loading questions…' : 'Start full lecture'}</button>
          <button type="button" disabled={loading} onClick={() => start([current], true)}>Quick practice ({Math.min(current.questionCount ?? 10, 10)} questions)</button></div>
      </section>
    </> : <>
      <h1 ref={pageHeading} tabIndex={-1}>{course}</h1><p className="intro">{COURSE_DESCRIPTIONS[course] ?? 'Choose a lecture to practice.'}</p>
      {resumeCard}
      {courseReview}
      {lectures.length > 1 && <section className="practice-panel"><h2>Mix lectures</h2>
        <p className="muted">Mixing topics makes you work out which idea applies, as in the exam. Quick mix picks due, missed and new questions first.</p>
        {orderControl('mixed-order')}
        <div className="actions">
          <button type="button" className={courseReview ? undefined : 'primary'} disabled={loading} onClick={() => start(lectures, true)}>Quick mix (10 questions)</button>
          <button type="button" disabled={loading} onClick={() => start(lectures)}>{loading ? 'Loading questions…' : `All lectures (${questionsIn(lectures)} questions)`}</button>
        </div>
      </section>}
      {lectures.length > 0 && <><h2 className="section-title">Lectures</h2>
        {currentLectures.length > 1 && <p className="hint">Open a lecture, or tick Mix on two or more sets to practice just those together.</p>}
        {lectureList(lectures, currentLectures.length > 1)}</>}
      {banks.length > 0 && <><h2 className="section-title">Mock tests and question banks</h2>
        <p className="hint">Exam-style sets. They overlap with the lectures, so “All lectures” does not include them.</p>
        {lectureList(banks, currentLectures.length > 1)}</>}
      {selected.length > 0 && <div className="actions action-bar">
        <button type="button" className="primary" disabled={loading || selected.length < 2} onClick={() => start(selected)}>
          {selected.length < 2 ? 'Tick one more set to mix' : `Practice selected (${selected.length} sets · ${questionsIn(selected)} questions)`}</button>
        <button type="button" className="link" onClick={() => setSelectedLectures([])}>Clear</button>
      </div>}
      {items.some((ds) => ds.group === 'archive') && <section className="archive"><h2 className="section-title">Older practice sets</h2>
        <p className="hint">Additional revision material from earlier question banks.</p>{lectureList(items.filter((ds) => ds.group === 'archive'))}</section>}
    </>}
  </main></>
}
