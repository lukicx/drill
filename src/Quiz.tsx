import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { checkSelection, clearSession, createSession, getPersistenceFailed, nextQuestion,
  questionsToReview, recordAttempt, saveResult, saveSession, subscribePersistence } from './study'
import type { StudySession, StudySource } from './study'

const MARKS: Record<string, string> = { correct: '✓ correct', wrong: '✗ wrong', missed: '← missed' }
interface Props { initial: StudySession; sources: StudySource[]; onExit: () => void; onSessionChange: (session: StudySession) => void }

export default function Quiz({ initial, sources, onExit, onSessionChange }: Props) {
  const [session, setSession] = useState(initial)
  const persistenceFailed = useSyncExternalStore(subscribePersistence, getPersistenceFailed)
  const heading = useRef<HTMLHeadingElement>(null)
  const question = session.round[session.index].question
  const answers = question.answers ?? []
  const isEssay = question.answers === undefined
  const checked = session.revealed
  const correct = session.attempts.filter((attempt) => attempt.assessment === 'correct').length
  const feedback = checkSelection(question, session.selected)

  useEffect(() => {
    onSessionChange(session)
    if (session.finished) { saveResult(session); clearSession() }
    else saveSession(session)
  }, [session, onSessionChange])
  useEffect(() => { heading.current?.focus() }, [session.id, session.index, session.finished])

  function toggle(i: number) {
    setSession((s) => ({ ...s, selected: s.selected.includes(i) ? s.selected.filter((v) => v !== i) : [...s.selected, i] }))
  }
  function check() {
    if (!session.selected.length) return
    setSession((s) => recordAttempt(s, checkSelection(question, s.selected).ok ? 'correct' : 'wrong'))
  }
  function markEssay(knewIt: boolean) {
    setSession((s) => nextQuestion(recordAttempt(s, knewIt ? 'correct' : 'wrong')))
  }
  const storageNotice = persistenceFailed && <p className="error" role="alert">Progress could not be saved in this browser. Keep this tab open to continue studying.</p>

  if (session.finished) {
    const answered = session.attempts.length
    const percent = answered ? Math.round(correct / answered * 100) : 0
    const wrong = questionsToReview(session)
    return <main>
      <h1 ref={heading} tabIndex={-1}>{session.title}</h1>
      {storageNotice}
      <p className="score">{correct} / {answered} correct ({percent} %)</p>
      <p>{answered} of {session.round.length} answered{answered < session.round.length ? ' · Session ended early' : ' · Session complete'}</p>
      <div className="actions">
        {wrong.length > 0 && <button type="button" onClick={() => setSession(createSession(sources, session.title, { review: wrong, shuffled: session.shuffled }))}>Repeat wrong ({wrong.length})</button>}
        <button type="button" onClick={() => setSession(createSession(sources, session.title, { shuffled: session.shuffled, limit: session.mode === 'quick' ? 10 : undefined }))}>Start again</button>
        <button type="button" onClick={onExit}>Back to lectures</button>
      </div>
    </main>
  }
  return <main>
    <header className="quiz-header">
      <span>{session.title} · {session.index + 1} / {session.round.length} · {correct} correct</span>
      <div className="actions">
        <button type="button" className="link" onClick={() => { saveSession(session); onExit() }}>Pause</button>
        <button type="button" className="link" onClick={() => setSession((s) => ({ ...s, finished: true }))}>End</button>
      </div>
    </header>
    {storageNotice}
    <h2 ref={heading} tabIndex={-1} className="question" dangerouslySetInnerHTML={{ __html: question.name }} />
    {isEssay ? <>
      <p className="hint">Essay question. Write or think through your answer, then compare.</p>
      <label className="hint" htmlFor="essay-answer">Your answer (optional)</label>
      <textarea id="essay-answer" className="essay-input" rows={6} value={session.draft}
        onChange={(event) => setSession((s) => ({ ...s, draft: event.target.value }))} placeholder="Write your answer here…" />
      {checked && <section className="model-answer">
        <h3>Model answer</h3><div dangerouslySetInnerHTML={{ __html: question.answer ?? '' }} />
        {question.keyPoints && question.keyPoints.length > 0 && <><h3>Key points</h3><ul>{question.keyPoints.map((point, i) => <li key={i} dangerouslySetInnerHTML={{ __html: point }} />)}</ul></>}
        {question.source && <p className="comment">{question.source}</p>}
      </section>}
    </> : <p className="hint">One or more answers can be correct.</p>}
    <ul className="answers">
      {answers.map((answer, i) => {
        const selected = session.selected.includes(i)
        const state = checked ? answer.right ? selected ? 'correct' : 'missed' : selected ? 'wrong' : '' : ''
        return <li key={`${session.index}:${i}`} className={state}>
          <label><input type="checkbox" checked={selected} disabled={checked} onChange={() => toggle(i)} />
            <span dangerouslySetInnerHTML={{ __html: answer.body }} />{state && <span className="mark">{MARKS[state]}</span>}
          </label>
          {checked && answer.comment && <p className="comment" dangerouslySetInnerHTML={{ __html: answer.comment }} />}
        </li>
      })}
    </ul>
    <div className="actions">
      {isEssay ? checked ? <>
        <button type="button" onClick={() => markEssay(true)}>✓ I knew it</button>
        <button type="button" onClick={() => markEssay(false)}>✗ I didn't</button>
      </> : <button type="button" onClick={() => setSession((s) => ({ ...s, revealed: true }))}>Show model answer</button>
        : <button type="button" disabled={!checked && session.selected.length === 0} onClick={checked ? () => setSession((s) => nextQuestion(s)) : check}>
          {!checked ? 'Check answer' : session.index + 1 < session.round.length ? 'Next question' : 'See results'}
        </button>}
      {checked && !isEssay && <span role="status" className={feedback.ok ? 'verdict ok' : 'verdict bad'}>{feedback.ok ? 'Correct' : 'Wrong'}</span>}
    </div>
  </main>
}
