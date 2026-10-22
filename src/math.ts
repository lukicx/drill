import katex from 'katex'

// Question text is HTML that may contain LaTeX: \( … \) for inline math and \[ … \] for display math.
// (Dollar signs are not used as delimiters, because answers also contain prices like "$5".)
export const MATH_PATTERN = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

// Formulas sit inside HTML, so "<" may have been written as &lt;; KaTeX needs the plain character.
function decodeEntities(tex: string): string {
  return tex.replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
}

const cache = new Map<string, string>()

export function renderMath(html: string): string {
  if (!html.includes('\\(') && !html.includes('\\[')) return html
  const known = cache.get(html)
  if (known !== undefined) return known
  const rendered = html.replace(MATH_PATTERN, (match, display?: string, inline?: string) => {
    try {
      return katex.renderToString(decodeEntities(display ?? inline ?? ''), {
        displayMode: display !== undefined,
        throwOnError: false,
      })
    } catch {
      return match
    }
  })
  cache.set(html, rendered)
  return rendered
}

/** Props for dangerouslySetInnerHTML with formulas rendered. */
export function asHtml(html: string): { __html: string } {
  return { __html: renderMath(html) }
}
