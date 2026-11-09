import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIndex, highlight, searchIndex } from '../src/questionSearch.ts'

const item = (key, question) => ({ key, datasetId: 'X', question })
const index = buildIndex([
  item('a', { name: 'Co je <b>šifrování</b>?', answers: [{ body: 'Převod na šifrový text', right: true }] }),
  item('b', { name: 'Explain hashing', answer: 'A hash is not &lt;reversible&gt; encryption (šifrování).' }),
  item('c', { name: 'Unrelated', answers: [{ body: 'Nothing', right: true, comment: 'L1, slide 2' }] }),
])
const keys = (query) => searchIndex(index, query).map((hit) => hit.item.key)

test('search ignores case, accents and HTML tags', () => {
  assert.deepEqual(keys('SIFROVANI'), ['a', 'b'])
  assert.deepEqual(keys('<reversible>'), ['b'])
  assert.deepEqual(keys('b>'), [])
})
test('every word must match; matches in the question text come first', () => {
  assert.deepEqual(keys('hash sifrovani'), ['b'])
  assert.deepEqual(keys('text šifr'), ['a'])
  assert.deepEqual(keys('slide 2'), ['c'])
  assert.deepEqual(keys('   '), [])
})

test('highlight marks matches in text only, keeping accents, tags and formulas', () => {
  assert.equal(highlight('Co je <b>šifrování</b>?', 'SIFROVANI'), 'Co je <b><mark>šifrování</mark></b>?')
  assert.equal(highlight('Klíč \\(k_{sifr}\\) a klíč', 'klic'), '<mark>Klíč</mark> \\(k_{sifr}\\) a <mark>klíč</mark>')
  assert.equal(highlight('\\[\\text{sifr}\\] sifr', 'sifr'), '\\[\\text{sifr}\\] <mark>sifr</mark>')
  assert.equal(highlight('a &lt;b&gt; lt', 'lt'), 'a &lt;b&gt; <mark>lt</mark>')
  assert.equal(highlight('text', '  '), 'text')
})
