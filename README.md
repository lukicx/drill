# Drill

A small multiple-choice quiz app for studying MUNI courses. It reuses the question
format of [fi-muni-drill](https://github.com/fimudrill/fi-muni-drill), so its datasets
work unchanged.

Built with Vite + React + TypeScript. No backend: everything is static files.

## Study flow

- Choose a course and lecture to see its question count, format and last attempt.
- Start the full lecture or a quick session of up to 10 questions. Choose shuffled
  order or the original lecture order (including answer choices).
- On a course page, **All lectures** mixes every current lecture in one round and **Quick mix**
  takes 10 questions across them (due, missed and new first). Tick **Mix** on two or more
  lectures to practice just those together.
- **Midterm practice** (courses with multiple choice): choose a lecture range (L1–Ln) and
  20, 30 or all questions. It is a test round: random multiple-choice questions, no feedback
  or second tries until the end, **Skip** leaves a question blank (counts as wrong), and a
  clock shows the time used (pauses excluded). Results show the time; the course page shows
  the last test. The answers still count for spaced repetition.
- Progress is saved automatically in this browser: question and answer order,
  selections, essay draft, model-answer visibility and recorded attempts.
  **Pause** returns to lecture selection; **Continue session** restores the round.
- There is one paused session per browser. Starting another replaces it.
  Data stays on the current device and is not synced to other browsers.
- Multiple-choice scoring requires exactly the correct selections. The **Answer first**
  switch in the quiz header (remembered per device, off by default) hides the options
  until you have recalled an answer and press **Show options**.
- Essays are self-assessed as **Knew it**, **Partly**, or **Need practice**. After the model
  answer is shown, tick the key points your answer covered; the app suggests a mark (all
  points = Knew it, at least half = Partly, else Need practice) and you can still pick another.
  Results list each key point as covered or not.
- A missed or partly recalled question comes back once, four questions later in the
  same round ("Second try"). The score counts first tries only.
- Results show answered/total coverage, including early exits, and expandable
  explanations for missed or partly recalled questions. Review these questions
  or practice the remaining ones.
- Every answer is remembered per question (simple spaced repetition, Leitner boxes):
  a correct answer moves the question up a box and it is due again after 1, 3, 7, 14
  or 30 days; a missed or partly recalled one goes back to box 1, due tomorrow.
  Answering before a question is due does not move it up. The course page offers
  **Due today** and **Missed questions** across all lectures, lecture cards show
  known / missed / new / due counts, and quick practice picks due, missed and new
  questions first. History is keyed by each question's stable `id`, so editing the text keeps it.
- Course and lecture URLs use hash routes so direct links and browser navigation
  work on GitHub Pages. Older practice sets are grouped separately.

Saved sessions are checked against the current question files before resuming.
If a dataset has changed, start a new round with its updated answers.

## Offline use

After one visit with a connection, the app and all question sets work offline, including
on a phone (use the browser's **Add to Home Screen** / **Install** to get an app icon).
`public/sw.js` saves the app and every set listed in `datasets.json`; when online it
loads pages and question files from the network first, so corrections appear after a
deploy. Each build stamps the worker so deployed changes refresh the saved copy.
The worker is only registered in production builds, not in `npm run dev`.

## Checks

Requires Node.js 22. Run `npm test`, `npm run lint`, and `npm run build`.
Tests cover persistence, strict scoring, partial assessment, review rounds, second tries,
spaced-repetition history, quick/mixed practice, content revisions, corrupt storage and
static-host routes.

Live: https://lukicx.github.io/drill/

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173/drill/ (the `/drill/` path matches GitHub Pages).

## Deploy

Every push to `main` is built and published to GitHub Pages by
`.github/workflows/deploy.yml`.

## Add a course or lecture set

1. Put the question file in `public/datasets/`, e.g. `questions_PA103_L01.json`.
2. Add an entry to `public/datasets.json`:

```json
{ "name": "PA103 - Lecture 1", "id": "PA103_L01", "dataset": "datasets/questions_PA103_L01.json" }
```

`id` must be unique. Keep `dataset` without a leading `/`, so it also works on GitHub Pages.
The main page groups sets by course, taken from the part of `name` before ` - ` (or an explicit `"course"` field).

3. Run `npm run metadata` after adding or changing questions. It refreshes
   `questionCount`, `multipleChoiceCount`, and `essayCount` in the manifest.
   Entries named like `COURSE_L01` default to `"group": "current"`; others default
   to `"archive"`. Set `group` explicitly when needed. The build checks these
   counts so lecture cards cannot silently show old information.

## Question format

```json
[
  {
    "name": "Which of these are hash functions?",
    "answers": [
      { "body": "SHA-256", "right": true, "comment": "Slide 12" },
      { "body": "MD5", "right": true },
      { "body": "AES", "right": false, "comment": "AES is a block cipher (slide 14)" }
    ]
  }
]
```

- One or more answers can be right. The answer counts only if exactly the right ones are ticked.
- `comment` is optional and shown after checking. Use it for the slide reference or a short explanation.
- `right` must be the boolean `true`/`false`, not the string `"true"`.
- Text may contain HTML (`<TT>`, `<B>`, `<PRE>`, `<BR>`). A literal `<` followed by a letter
  (e.g. `List<T>`) must be written as `&lt;`, or it disappears.
- Use `<PRE>` for code or tables.

### Essay questions

For courses with a written essay exam, a question has a model `answer` instead of `answers`.
You write or think through your answer, reveal the model answer, and mark yourself
("Knew it" / "Partly" / "Need practice"). Fully recalled answers count towards
the score; partly recalled and missed answers are included in the review round.

```json
{
  "name": "Explain the agent loop and why tests matter in it.",
  "answer": "The model proposes the next step, a tool executes it, and the output ...",
  "keyPoints": ["model proposes an action", "tools execute it", "output is fed back"],
  "source": "Lecture 1, slides 5–9"
}
```

`keyPoints` and `source` are optional. Multiple-choice and essay questions can be mixed in one file.

Every question also has a stable `"id"` (first field), which keys its progress history. Do not
write ids by hand: `node scripts/add-question-ids.mjs public/datasets/questions_X.json` adds the
missing ones. Keep an existing `id` when you edit a question; give a question a new id only when it
asks something different, so its old history no longer applies.

Check new files before adding them: `node scripts/validate-questions.mjs public/datasets/questions_X.json`

A file with a broken question (no text, no answers, or no right answer) refuses to load and
lists the problems, so mistakes in new files show up immediately.
