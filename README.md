# Drill

A small multiple-choice quiz app for studying MUNI courses. It reuses the question
format of [fi-muni-drill](https://github.com/fimudrill/fi-muni-drill), so its datasets
work unchanged.

Built with Vite + React + TypeScript. No backend: everything is static files.

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
("I knew it" / "I didn't"), which counts towards the score and "Repeat wrong".

```json
{
  "name": "Explain the agent loop and why tests matter in it.",
  "answer": "The model proposes the next step, a tool executes it, and the output ...",
  "keyPoints": ["model proposes an action", "tools execute it", "output is fed back"],
  "source": "Lecture 1, slides 5–9"
}
```

`keyPoints` and `source` are optional. Multiple-choice and essay questions can be mixed in one file.

Check new files before adding them: `node scripts/validate-questions.mjs public/datasets/questions_X.json`

A file with a broken question (no text, no answers, or no right answer) refuses to load and
lists the problems, so mistakes in new files show up immediately.
