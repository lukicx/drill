// Same JSON shape as fi-muni-drill, so its datasets work unchanged.
// A question is either multiple-choice (has `answers`) or essay (has `answer`).

export interface Answer {
  body: string // may contain HTML, e.g. <TT>
  right: boolean
  comment?: string // explanation shown after checking
}

export interface Question {
  name: string // question text, may contain HTML
  answers?: Answer[] // multiple-choice question
  answer?: string // essay question: model answer, may contain HTML
  keyPoints?: string[] // essay question: what a full answer should cover
  source?: string // essay question: where it is in the slides, e.g. "Lecture 2, slides 5–9"
}

// One entry in public/datasets.json
export interface DatasetInfo {
  name: string
  id: string
  dataset: string // path relative to public/, e.g. "datasets/questions_PV157.json"
  course?: string // groups sets on the main page; defaults to the part of name before " - "
  questionCount?: number
  multipleChoiceCount?: number
  essayCount?: number
  group?: 'current' | 'archive'
}
