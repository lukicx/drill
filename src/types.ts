// Same JSON shape as fi-muni-drill, so its datasets work unchanged.

export interface Answer {
  body: string // may contain HTML, e.g. <TT>
  right: boolean
  comment?: string // explanation shown after checking
}

export interface Question {
  name: string // question text, may contain HTML
  answers: Answer[]
}

// One entry in public/datasets.json
export interface DatasetInfo {
  name: string
  id: string
  dataset: string // path relative to public/, e.g. "datasets/questions_PV157.json"
}
