import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const publicRoot = new URL('../public/', import.meta.url)
const manifestPath = new URL('datasets.json', publicRoot)
const entries = JSON.parse(await readFile(manifestPath, 'utf8'))
for (const entry of entries) {
  const questions = JSON.parse(await readFile(new URL(entry.dataset, publicRoot), 'utf8'))
  const multipleChoice = questions.filter((q) => q.answers !== undefined).length
  entry.questionCount = questions.length
  entry.multipleChoiceCount = multipleChoice
  entry.essayCount = questions.length - multipleChoice
  entry.group ??= /^.+_L\d+$/i.test(entry.id) ? 'current' : 'archive'
}
const output = JSON.stringify(entries, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (await readFile(manifestPath, 'utf8') !== output) {
    console.error('Lecture information is out of date. Run npm run metadata after editing questions.')
    process.exitCode = 1
  }
} else {
  await writeFile(manifestPath, output)
  console.log(`Updated counts for ${entries.length} sets in ${fileURLToPath(manifestPath)}`)
}
