import { useEffect, useState } from 'react'
import { loadDatasets, loadQuestions } from './data'
import Quiz from './Quiz'
import type { DatasetInfo, Question } from './types'

// "PA015 - L1 Agentic loop" -> "PA015" unless the entry says its course explicitly.
function courseOf(ds: DatasetInfo): string {
  return ds.course ?? ds.name.split(' - ')[0]
}

function App() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [course, setCourse] = useState<string | null>(null)
  const [active, setActive] = useState<{ title: string; questions: Question[] } | null>(null)
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
      setActive({ title: ds.name, questions: await loadQuestions(ds.dataset) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  if (active) {
    return <Quiz title={active.title} questions={active.questions} onExit={() => setActive(null)} />
  }

  // Main page: one button per course, in the order they first appear in datasets.json.
  if (course === null) {
    const courses = [...new Set(datasets.map(courseOf))]
    return (
      <main>
        <h1>Drill</h1>
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
