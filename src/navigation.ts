export interface StudyRoute { course: string | null; datasetId: string | null; practice: boolean }

export function parseRoute(hash: string): StudyRoute {
  try {
    const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
    if (parts[0] !== 'course' || !parts[1]) return { course: null, datasetId: null, practice: false }
    return { course: parts[1], datasetId: parts[2] === 'lecture' && parts[3] ? parts[3] : null,
      practice: parts.includes('practice') }
  } catch { return { course: null, datasetId: null, practice: false } }
}

export function routeHash(course: string | null, datasetId?: string | null, practice = false): string {
  if (!course) return '#/'
  return `#/course/${encodeURIComponent(course)}${datasetId ? `/lecture/${encodeURIComponent(datasetId)}` : ''}${practice ? '/practice' : ''}`
}

export function subscribeRoute(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}
export function getRouteHash() { return window.location.hash }
export function navigate(course: string | null, datasetId?: string | null, practice = false) {
  window.location.hash = routeHash(course, datasetId, practice)
}
