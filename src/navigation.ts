// search: set on the search page; course limits the search to one course (null = all courses).
export interface StudyRoute {
  course: string | null; datasetId: string | null; practice: boolean
  search?: { query: string; course: string | null }
}

export function parseRoute(hash: string): StudyRoute {
  try {
    if (/^#\/?search(\?|$)/.test(hash)) {
      const params = new URLSearchParams(hash.split('?')[1] ?? '')
      return { course: null, datasetId: null, practice: false, search: { query: params.get('q') ?? '', course: params.get('course') || null } }
    }
    const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
    if (parts[0] !== 'course' || !parts[1]) return { course: null, datasetId: null, practice: false }
    return { course: parts[1], datasetId: parts[2] === 'lecture' && parts[3] ? parts[3] : null,
      practice: parts[2] === 'practice' || (parts[2] === 'lecture' && parts[4] === 'practice') }
  } catch { return { course: null, datasetId: null, practice: false } }
}

export function routeHash(course: string | null, datasetId?: string | null, practice = false): string {
  if (!course) return '#/'
  return `#/course/${encodeURIComponent(course)}${datasetId ? `/lecture/${encodeURIComponent(datasetId)}` : ''}${practice ? '/practice' : ''}`
}

export function searchHash(query: string, course: string | null = null): string {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (course) params.set('course', course)
  const text = params.toString()
  return `#/search${text ? `?${text}` : ''}`
}

export function subscribeRoute(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}
export function getRouteHash() { return window.location.hash }
export function navigate(course: string | null, datasetId?: string | null, practice = false) {
  window.location.hash = routeHash(course, datasetId, practice)
}
// Typing on the search page replaces the history entry, so Back leaves search instead of undoing letters.
export function goToSearch(query: string, course: string | null, replace: boolean) {
  const hash = searchHash(query, course)
  if (!replace) { window.location.hash = hash; return }
  history.replaceState(history.state, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
