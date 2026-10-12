import { useEffect, useState } from 'react'
import { loadDatasets, loadQuestions } from './data'
import Quiz from './Quiz'
import type { DatasetInfo, Question } from './types'

function App() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
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

  return (
    <main>
      <h1>Drill</h1>
      {error && <p className="error">{error}</p>}
      <ul className="datasets">
        {datasets.map((ds) => (
          <li key={ds.id}>
            <button type="button" disabled={loading} onClick={() => start(ds)}>
              {ds.name}
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

export default App
