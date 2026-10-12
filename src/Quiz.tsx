import { useState } from 'react'
import type { Question } from './types'

// Fisher–Yates shuffle; returns a new array.
function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Shuffle question order and the answers inside each multiple-choice question.
function prepare(questions: Question[]): Question[] {
  return shuffle(questions).map((q) => (q.answers ? { ...q, answers: shuffle(q.answers) } : q))
}

const MARKS: Record<string, string> = {
  correct: '✓ correct',
  wrong: '✗ wrong',
  missed: '← missed',
}

interface Props {
  title: string
  questions: Question[]
  onExit: () => void
}

export default function Quiz({ title, questions, onExit }: Props) {
  const [round, setRound] = useState(() => prepare(questions))
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [checked, setChecked] = useState(false) // MC: answer checked; essay: model answer shown
  const [answered, setAnswered] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [wrong, setWrong] = useState<Question[]>([])
  const [finished, setFinished] = useState(false)

  const question = round[index]
  const answers = question.answers ?? []
  const isEssay = question.answers === undefined
  // Correct only if the selected set is exactly the set of right answers.
  const isCorrect = answers.every((a, i) => a.right === selected.has(i))

  function startRound(qs: Question[]) {
    setRound(prepare(qs))
    setIndex(0)
    setSelected(new Set())
    setChecked(false)
    setAnswered(0)
    setCorrect(0)
    setWrong([])
    setFinished(false)
  }

  function record(ok: boolean) {
    setAnswered((n) => n + 1)
    if (ok) setCorrect((c) => c + 1)
    else setWrong((w) => [...w, question])
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function check() {
    if (selected.size === 0) return
    record(isCorrect)
    setChecked(true)
  }

  // Essay questions are self-marked after reading the model answer.
  function markEssay(knewIt: boolean) {
    record(knewIt)
    next()
  }

  function next() {
    if (index + 1 >= round.length) {
      setFinished(true)
      return
    }
    setIndex(index + 1)
    setSelected(new Set())
    setChecked(false)
  }

  if (finished) {
    const percent = answered > 0 ? Math.round((correct / answered) * 100) : 0
    return (
      <main>
        <h1>{title}</h1>
        <p className="score">
          {correct} / {answered} correct ({percent} %)
        </p>
        <div className="actions">
          {wrong.length > 0 && (
            <button type="button" onClick={() => startRound(wrong)}>
              Repeat wrong ({wrong.length})
            </button>
          )}
          <button type="button" onClick={() => startRound(questions)}>
            Start again
          </button>
          <button type="button" onClick={onExit}>
            Back to courses
          </button>
        </div>
      </main>
    )
  }

  return (
    <main>
      <header className="quiz-header">
        <span>
          {title} · {index + 1} / {round.length} · {correct} correct
        </span>
        <button type="button" className="link" onClick={() => setFinished(true)}>
          End
        </button>
      </header>

      {/* Question text comes from our own JSON files and may contain HTML like <TT>. */}
      <h2 className="question" dangerouslySetInnerHTML={{ __html: question.name }} />

      {isEssay ? (
        <>
          <p className="hint">Essay question. Write or think through your answer, then compare.</p>
          <textarea
            key={index}
            className="essay-input"
            rows={6}
            placeholder="Your answer (optional, not saved)"
          />
          {checked && (
            <section className="model-answer">
              <h3>Model answer</h3>
              <div dangerouslySetInnerHTML={{ __html: question.answer ?? '' }} />
              {question.keyPoints && question.keyPoints.length > 0 && (
                <>
                  <h3>Key points</h3>
                  <ul>
                    {question.keyPoints.map((p, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: p }} />
                    ))}
                  </ul>
                </>
              )}
              {question.source && <p className="comment">{question.source}</p>}
            </section>
          )}
        </>
      ) : (
        <p className="hint">One or more answers can be correct.</p>
      )}

      <ul className="answers" key={index}>
        {answers.map((a, i) => {
          let state = ''
          if (checked) {
            if (a.right && selected.has(i)) state = 'correct'
            else if (a.right) state = 'missed'
            else if (selected.has(i)) state = 'wrong'
          }
          return (
            <li key={i} className={state}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  disabled={checked}
                  onChange={() => toggle(i)}
                />
                <span dangerouslySetInnerHTML={{ __html: a.body }} />
                {/* Text marker so the result doesn't rely on colour alone. */}
                {state && <span className="mark">{MARKS[state]}</span>}
              </label>
              {checked && a.comment && (
                <p className="comment" dangerouslySetInnerHTML={{ __html: a.comment }} />
              )}
            </li>
          )
        })}
      </ul>

      <div className="actions">
        {isEssay ? (
          checked ? (
            <>
              <button type="button" onClick={() => markEssay(true)}>
                ✓ I knew it
              </button>
              <button type="button" onClick={() => markEssay(false)}>
                ✗ I didn't
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setChecked(true)}>
              Show model answer
            </button>
          )
        ) : (
          // One button that stays in place, so keyboard focus isn't lost between Check and Next.
          <button type="button" onClick={checked ? next : check}>
            {!checked ? 'Check' : index + 1 < round.length ? 'Next' : 'See results'}
          </button>
        )}
        {checked && !isEssay && (
          <span className={isCorrect ? 'verdict ok' : 'verdict bad'}>
            {isCorrect ? 'Correct' : 'Wrong'}
          </span>
        )}
      </div>
    </main>
  )
}
