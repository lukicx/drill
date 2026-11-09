import { useEffect, useMemo, useState } from 'react'
import { loadQuestions } from './data'
import { asHtml } from './math'
import { buildIndex, highlight, searchIndex } from './questionSearch'
import { bankOf, historyKey, isDue, isWeak } from './study'
import type { History, StudyQuestion } from './study'
import type { DatasetInfo, Question } from './types'

const PAGE = 30
// Question files stay loaded while the app is open, so each keystroke searches at once.
const files = new Map<string, Promise<Question[]>>()
function loadCached(path: string) {
  if (!files.has(path)) files.set(path, loadQuestions(path).catch((e: unknown) => { files.delete(path); throw e }))
  return files.get(path)!
}

function statusOf(h: History[string] | undefined) {
  return !h ? 'New' : isDue(h) ? 'Due today' : isWeak(h) ? 'Missed last time' : 'Known'
}

interface Props {
  sets: DatasetInfo[] // the sets in scope
  query: string
  course: string | null
  history: History
  busy: boolean
  titleOf: (datasetId: string) => string // set name, without the course when the search is limited to one
  onWiden: () => void
  onPractice: (items: StudyQuestion[]) => void
}

export default function Search({ sets, query, course, history, busy, titleOf, onWiden, onPractice }: Props) {
  // "id|path" per set; a change reloads the bank.
  const key = sets.map((ds) => `${ds.id}|${ds.dataset}`).join('\n')
  const [loaded, setLoaded] = useState<{ key: string; bank?: StudyQuestion[]; error?: string } | null>(null)
  const [shown, setShown] = useState({ query, count: PAGE })

  useEffect(() => {
    let live = true
    const entries = key ? key.split('\n').map((line) => line.split('|')) : []
    Promise.all(entries.map(async ([datasetId, path]) => ({ datasetId, questions: await loadCached(path) })))
      .then((sources) => { if (live) setLoaded({ key, bank: bankOf(sources) }) })
      .catch((e: unknown) => { if (live) setLoaded({ key, error: e instanceof Error ? e.message : String(e) }) })
    return () => { live = false }
  }, [key])

  const bank = loaded?.key === key ? loaded.bank : undefined
  const index = useMemo(() => bank && buildIndex(bank), [bank])
  const hits = useMemo(() => index ? searchIndex(index, query) : [], [index, query])
  const count = shown.query === query ? shown.count : PAGE

  return <>
    <p className="search-scope">{course
      ? <>Searching in <strong>{course}</strong> · <button type="button" className="link inline" onClick={onWiden}>Search all courses</button></>
      : 'Searching all courses'}</p>
    {!query.trim() ? <p className="hint">Type a word or phrase in the search box. It looks in questions, answer options,
      explanations and model answers. Capitals and accents do not matter, so “sifrovani” finds “šifrování”.</p>
    : loaded?.key === key && loaded.error ? <p className="error" role="alert">{loaded.error}</p>
    : !index ? <p role="status">Loading questions…</p>
    : <>
      <p role="status" className="result-count">{hits.length
        ? `${hits.length} ${hits.length === 1 ? 'question' : 'questions'} found`
        : `No questions match “${query.trim()}”.`}</p>
      {!hits.length && <p className="hint">Check the spelling, use fewer words, or try a related term.
        {course && <> <button type="button" className="link inline" onClick={onWiden}>Search all courses</button></>}</p>}
      {hits.length > 0 && <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={() => onPractice(hits.map((hit) => hit.item))}>
          {hits.length === 1 ? 'Practice this question' : `Practice these ${hits.length} questions`}</button></div>}
      <ul className="search-results">{hits.slice(0, count).map(({ item }) => {
        const q = item.question
        return <li key={item.key}><details className="review-item">
          <summary>
            <span className="result-meta">{titleOf(item.datasetId)} · {q.answers ? 'Multiple choice' : 'Open question'} · {statusOf(history[historyKey(item)])}</span>
            <span className="result-question" dangerouslySetInnerHTML={asHtml(highlight(q.name, query))} />
          </summary>
          <div className="review-content">
            {q.answers && <ul className="review-answers">{q.answers.map((answer, i) => <li key={i}>
              <span className={answer.right ? 'ok-text' : 'bad-text'}>{answer.right ? '✓ Correct' : '✗ Wrong'}: </span>
              <span dangerouslySetInnerHTML={asHtml(highlight(answer.body, query))} />
              {answer.comment && <p className="hint" dangerouslySetInnerHTML={asHtml(highlight(answer.comment, query))} />}
            </li>)}</ul>}
            {q.keyPoints?.length ? <><h3>Key points</h3><ul>{q.keyPoints.map((point, i) => <li key={i} dangerouslySetInnerHTML={asHtml(highlight(point, query))} />)}</ul></> : null}
            {q.answer && <><h3>Model answer</h3><div dangerouslySetInnerHTML={asHtml(highlight(q.answer, query))} /></>}
            {q.source && <p className="hint">{q.source}</p>}
            <div className="actions"><button type="button" disabled={busy} onClick={() => onPractice([item])}>Practice this question</button></div>
          </div>
        </details></li>
      })}</ul>
      {hits.length > count && <div className="actions">
        <button type="button" onClick={() => setShown({ query, count: count + PAGE })}>Show more ({hits.length - count} left)</button></div>}
    </>}
  </>
}
