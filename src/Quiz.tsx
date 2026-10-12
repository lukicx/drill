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

// Shuffle question order and the answers inside each question.
function prepare(questions: Question[]): Question[] {
  return shuffle(questions).map((q) => ({ ...q, answers: shuffle(q.answers) }))
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
  const [checked, setChecked] = useState(false)
  const [correct, setCorrect] = useState(0)
  const [wrong, setWrong] = useState<Question[]>([])
  const [finished, setFinished] = useState(false)

  const question = round[index]
  const answered = index + (checked ? 1 : 0)
  // Correct only if the selected set is exactly the set of right answers.
  const isCorrect = question.answers.every((a, i) => a.right === selected.has(i))

  function startRound(qs: Question[]) {
    setRound(prepare(qs))
    setIndex(0)
    setSelected(new Set())
    setChecked(false)
    setCorrect(0)
    setWrong([])
    setFinished(false)
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
    if (isCorrect) setCorrect((c) => c + 1)
    else setWrong((w) => [...w, question])
    setChecked(true)
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
      <p className="hint">One or more answers can be correct.</p>

      <ul className="answers" key={index}>
        {question.answers.map((a, i) => {
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
              </label>
              {checked && a.comment && (
                <p className="comment" dangerouslySetInnerHTML={{ __html: a.comment }} />
              )}
            </li>
          )
        })}
      </ul>

      <div className="actions">
        {!checked ? (
          <button type="button" onClick={check} disabled={selected.size === 0}>
            Check
          </button>
        ) : (
          <>
            <span className={isCorrect ? 'verdict ok' : 'verdict bad'}>
              {isCorrect ? 'Correct' : 'Wrong'}
            </span>
            <button type="button" onClick={next}>
              {index + 1 < round.length ? 'Next' : 'See results'}
            </button>
          </>
        )}
      </div>
    </main>
  )
}
