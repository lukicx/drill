import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { asHtml } from './math'
import { checkSelection, clearSession, createSession, firstAttempts, getPersistenceFailed, nextQuestion,
  questionCount, questionsToReview, readHistory, recordAttempt, recordHistory, saveResult, saveSession,
  subscribePersistence } from './study'
import type { Assessment, StudySession, StudySource } from './study'

const MARKS: Record<string, string> = { correct: '✓ correct', wrong: '✗ wrong', missed: '← missed' }
interface Props { initial: StudySession; sources: StudySource[]; onExit: () => void; onSessionChange: (session: StudySession) => void; sourceTitles: Record<string, string> }

export default function Quiz({ initial, sources, onExit, onSessionChange, sourceTitles }: Props) {
  const [session, setSession] = useState(initial)
  const persistenceFailed = useSyncExternalStore(subscribePersistence, getPersistenceFailed)
  const heading = useRef<HTMLHeadingElement>(null)
  const item = session.round[session.index]
  const question = item.question
  const answers = question.answers ?? []
  const isEssay = question.answers === undefined
  const checked = session.revealed
  const first = firstAttempts(session)
  const correct = first.filter((attempt) => attempt.assessment === 'correct').length
  const total = questionCount(session)
  const feedback = checkSelection(question, session.selected)

  useEffect(() => {
    onSessionChange(session)
    if (session.finished) { if (saveResult(session)) clearSession() }
    else saveSession(session)
  }, [session, onSessionChange])
  useEffect(() => { heading.current?.focus() }, [session.id, session.index, session.finished])

  function toggle(i: number) {
    setSession((s) => ({ ...s, selected: s.selected.includes(i) ? s.selected.filter((v) => v !== i) : [...s.selected, i] }))
  }
  // A second try in the same round is practice only; it does not change the spaced-repetition history.
  function check() {
    if (!session.selected.length || session.attempts.length > session.index) return
    const assessment: Assessment = checkSelection(question, session.selected).ok ? 'correct' : 'wrong'
    if (!item.retry) recordHistory(item, assessment)
    setSession((s) => recordAttempt(s, assessment))
  }
  function markEssay(assessment: Assessment) {
    if (!session.revealed || session.finished || session.attempts.length > session.index) return
    if (!item.retry) recordHistory(item, assessment)
    setSession((s) => nextQuestion(recordAttempt(s, assessment)))
  }
  const storageNotice = persistenceFailed && <p className="error" role="alert">Progress could not be saved in this browser. Keep this tab open to continue studying.</p>

  if (session.finished) {
    const answered = first.length
    const percent = answered ? Math.round(correct / answered * 100) : 0
    const wrong = questionsToReview(session)
    const partial = first.filter((attempt) => attempt.assessment === 'partial').length
    const unanswered = session.round.slice(session.attempts.length).filter((entry) => !entry.retry)
    const remaining = unanswered.length
    return <main>
      <p className="eyebrow">{remaining ? 'Session ended early' : 'Session complete'}</p>
      <h1 ref={heading} tabIndex={-1}>{session.title}</h1>
      {storageNotice}
      <p className="score">{answered ? `${percent}% fully correct` : 'No answers recorded yet'}</p>
      <p className="muted">{answered} of {total} answered{remaining ? ` · ${remaining} remaining` : ''}</p>
      <dl className="result-stats"><div><dt>Correct</dt><dd>{correct}</dd></div>
        <div><dt>Partly recalled</dt><dd>{partial}</dd></div><div><dt>Need practice</dt><dd>{answered - correct - partial}</dd></div></dl>
      {session.round.some((entry) => !entry.question.answers) && <p className="hint">Essay results are self-assessed. Partly recalled answers stay in your review round.</p>}
      {first.length < session.attempts.length && <p className="hint">The score counts first tries only; second tries of missed questions are practice.</p>}
      <div className="actions">
        {wrong.length > 0 && <button type="button" className="primary" onClick={() => setSession(createSession(sources, session.title, { review: wrong, shuffled: session.shuffled }))}>Review missed questions ({wrong.length})</button>}
        {remaining > 0 && <button type="button" onClick={() => setSession(createSession(sources, session.title, { review: unanswered, shuffled: session.shuffled }))}>Practice remaining ({remaining})</button>}
        <button type="button" onClick={() => setSession(createSession(sources, session.title, { shuffled: session.shuffled, limit: session.mode === 'quick' ? 10 : undefined, history: readHistory() }))}>Start again</button>
        <button type="button" onClick={onExit}>Back to lectures</button>
      </div>
      {wrong.length > 0 && <section className="results-review"><h2 className="section-title">What to review</h2>
        <p className="hint">Open a question to compare your answer and explanation.</p>
        {first.filter((attempt) => attempt.assessment !== 'correct').map((attempt) => <details className="review-item" key={attempt.item.key}>
          <summary><span dangerouslySetInnerHTML={asHtml(attempt.item.question.name)} /><span className="badge">{attempt.assessment === 'partial' ? 'Partly recalled' : 'Need practice'}</span></summary>
          <div className="review-content">
            {session.datasetIds.length > 1 && <p className="hint">{sourceTitles[attempt.item.datasetId]}</p>}
            {attempt.item.question.answers ? <ul className="review-answers">{attempt.item.question.answers.map((answer, i) => <li key={i}>
              <span className={answer.right ? 'ok-text' : attempt.selected.includes(i) ? 'bad-text' : 'muted'}>{answer.right ? attempt.selected.includes(i) ? '✓ Your correct selection' : '✓ Correct answer you missed' : attempt.selected.includes(i) ? '✗ Your incorrect selection' : 'Not selected'}: </span>
              <span dangerouslySetInnerHTML={asHtml(answer.body)} />
              {answer.comment && <p className="hint" dangerouslySetInnerHTML={asHtml(answer.comment)} />}
            </li>)}</ul> : <>
              {attempt.draft && <><h3>Your answer</h3><p className="saved-draft">{attempt.draft}</p></>}
              {attempt.item.question.keyPoints?.length ? <><h3>Key points</h3><ul>{attempt.item.question.keyPoints.map((point, i) => <li key={i} dangerouslySetInnerHTML={asHtml(point)} />)}</ul></> : null}
              <h3>Model answer</h3><div dangerouslySetInnerHTML={asHtml(attempt.item.question.answer ?? '')} />
              {attempt.item.question.source && <p className="hint">{attempt.item.question.source}</p>}
            </>}
          </div>
        </details>)}
      </section>}
    </main>
  }
  return <main>
    <header className="quiz-header">
      <div><span>{session.title}</span><p className="session-progress">Question {session.index + 1} of {session.round.length} · {first.length} of {total} answered · {correct} correct</p></div>
      <div className="actions">
        <button type="button" className="link" onClick={() => { saveSession(session); onExit() }}>Pause</button>
        <button type="button" className="link" onClick={() => setSession((s) => ({ ...s, finished: true }))}>End session</button>
      </div>
    </header>
    {storageNotice}
    <progress className="progress-bar" max={session.round.length} value={session.attempts.length} aria-label="Questions answered" />
    {session.datasetIds.length > 1 && <p className="eyebrow">{sourceTitles[item.datasetId]}</p>}
    {item.retry && <p className="eyebrow">Second try – you missed this one earlier</p>}
    <h2 ref={heading} tabIndex={-1} className="question" dangerouslySetInnerHTML={asHtml(question.name)} />
    {isEssay ? <>
      <p className="hint">Essay question. Write or think through your answer, then compare.</p>
      <label className="hint" htmlFor="essay-answer">Your answer (optional)</label>
      <textarea id="essay-answer" className="essay-input" rows={6} value={session.draft}
        onChange={(event) => setSession((s) => ({ ...s, draft: event.target.value }))} placeholder="Write your answer here…" />
      {checked && <section className="model-answer">
        {question.keyPoints && question.keyPoints.length > 0 && <><h3>Key points</h3><ul>{question.keyPoints.map((point, i) => <li key={i} dangerouslySetInnerHTML={asHtml(point)} />)}</ul></>}
        <details open><summary>Full model answer</summary><div className="model-answer-body" dangerouslySetInnerHTML={asHtml(question.answer ?? '')} /></details>
        {question.source && <p className="comment">{question.source}</p>}
      </section>}
    </> : <p className="hint">One or more answers can be correct.</p>}
    <ul className="answers">
      {answers.map((answer, i) => {
        const selected = session.selected.includes(i)
        const state = checked ? answer.right ? selected ? 'correct' : 'missed' : selected ? 'wrong' : '' : ''
        return <li key={`${session.index}:${i}`} className={state}>
          <label><input type="checkbox" checked={selected} disabled={checked} onChange={() => toggle(i)} />
            <span dangerouslySetInnerHTML={asHtml(answer.body)} />{state && <span className="mark">{MARKS[state]}</span>}
          </label>
          {checked && answer.comment && <p className="comment" dangerouslySetInnerHTML={asHtml(answer.comment)} />}
        </li>
      })}
    </ul>
    <div className="actions action-bar">
      {isEssay ? <>
        <button type="button" className="primary" onClick={checked ? () => markEssay('correct') : () => setSession((s) => ({ ...s, revealed: true }))}>{checked ? '✓ Knew it' : 'Show model answer'}</button>
        {checked && <><button type="button" onClick={() => markEssay('partial')}>Partly</button>
          <button type="button" onClick={() => markEssay('wrong')}>Need practice</button></>}
      </>
        : <button type="button" className="primary" disabled={!checked && session.selected.length === 0} onClick={checked ? () => setSession((s) => nextQuestion(s)) : check}>
          {!checked ? 'Check answer' : session.index + 1 < session.round.length ? 'Next question' : 'See results'}
        </button>}
      {checked && !isEssay && <div role="status" className={feedback.ok ? 'verdict ok' : 'verdict bad'}>
        {feedback.ok ? 'Correct — all right answers selected.' : <>
          <span>{feedback.incorrect ? `You selected ${feedback.incorrect} incorrect ${feedback.incorrect === 1 ? 'answer' : 'answers'}. ` : ''}</span>
          <span>{feedback.missed ? `You missed ${feedback.missed} correct ${feedback.missed === 1 ? 'answer' : 'answers'}.` : ''}</span>
        </>}
      </div>}
    </div>
  </main>
}
