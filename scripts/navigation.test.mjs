import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute, routeHash, searchHash } from '../src/navigation.ts'

test('course, lecture and practice URLs work under a static hosting base path', () => {
  for (const [course, datasetId, practice] of [['PV157', null, false], ['practice', null, false], ['PA015', 'practice', false], ['PA015', 'PA015_L01', false], ['PA015', 'PA015_L01', true], ['Course / special', 'id #1', true]]) {
    assert.deepEqual(parseRoute(routeHash(course, datasetId, practice)), { course, datasetId, practice })
  }
})
test('empty and invalid routes return safely to the home view', () => {
  for (const hash of ['', '#/', '#/unknown', '#/course/%notvalid']) {
    assert.deepEqual(parseRoute(hash), { course: null, datasetId: null, practice: false })
  }
})
test('search URLs keep the query and the optional course', () => {
  for (const [query, course] of [['', null], ['šifrování AES', null], ['a&b=c #1', 'PV017']]) {
    assert.deepEqual(parseRoute(searchHash(query, course)).search, { query, course })
  }
})
