import { useEffect, useState } from 'react'
import { loadDatasets, loadQuestions } from './data'
import Quiz from './Quiz'
import type { DatasetInfo } from './types'
import { clearSession, createSession, readSession, revisionOf } from './study'
import type { StudySession, StudySource } from './study'

// "PA015 - L1 Agentic loop" -> "PA015" unless the entry says its course explicitly.
function courseOf(ds: DatasetInfo): string {
  return ds.course ?? ds.name.split(' - ')[0]
}

function App() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [course, setCourse] = useState<string | null>(null)
  const [active, setActive] = useState<{ session: StudySession; sources: StudySource[] } | null>(null)
  const [saved, setSaved] = useState(readSession)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadDatasets()
      .then(setDatasets)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  async function start(ds: DatasetInfo) {
    setError(null)
    setLoading(true)
    try {
      const sources = [{ datasetId: ds.id, questions: await loadQuestions(ds.dataset) }]
      setActive({ session: createSession(sources, ds.name), sources })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function resume() {
    if (!saved) return
    setLoading(true)
    setError(null)
    try {
      const sources = await Promise.all(saved.datasetIds.map(async (id) => {
        const ds = datasets.find((entry) => entry.id === id)
        if (!ds) throw new Error('This lecture is no longer available. Start a new session.')
        return { datasetId: id, questions: await loadQuestions(ds.dataset) }
      }))
      if (revisionOf(sources) !== saved.revision) {
        clearSession()
        setSaved(null)
        throw new Error('These questions have been updated. Please start a new session with the latest answers.')
      }
      const ds = datasets.find((entry) => entry.id === saved.datasetIds[0])
      if (ds) setCourse(courseOf(ds))
      setActive({ session: saved, sources })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  const resumeButton = saved && <p><button type="button" disabled={loading || datasets.length === 0} onClick={resume}>
    Continue {saved.title} · question {saved.index + 1}/{saved.round.length}
  </button></p>

  if (active) {
    return <Quiz initial={active.session} sources={active.sources} onExit={() => { setActive(null); setSaved(readSession()) }} />
  }

  // Main page: one button per course, in the order they first appear in datasets.json.
  if (course === null) {
    const courses = [...new Set(datasets.map(courseOf))]
    return (
      <main>
        <h1>Drill</h1>
        {resumeButton}
        {error && <p className="error">{error}</p>}
        <ul className="datasets">
          {courses.map((c) => (
            <li key={c}>
              <button type="button" onClick={() => setCourse(c)}>
                {c}
                <span className="count">{datasets.filter((ds) => courseOf(ds) === c).length} sets</span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    )
  }

  // Course page: its question sets.
  return (
    <main>
      <header className="quiz-header">
        <button type="button" className="link" onClick={() => setCourse(null)}>
          ← All courses
        </button>
      </header>
      <h1>{course}</h1>
      {resumeButton}
      {error && <p className="error">{error}</p>}
      <ul className="datasets">
        {datasets
          .filter((ds) => courseOf(ds) === course)
          .map((ds) => (
            <li key={ds.id}>
              <button type="button" disabled={loading} onClick={() => start(ds)}>
                {ds.name.replace(`${course} - `, '')}
              </button>
            </li>
          ))}
      </ul>
    </main>
  )
}

export default App
