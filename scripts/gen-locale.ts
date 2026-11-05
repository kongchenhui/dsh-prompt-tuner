/**
 * Generate `locale/<tag>.json` from the one dictionary module.
 *
 * The harness reads these files for marketplace metadata while the bundle
 * carries the strings itself, so the two would drift if either were edited by
 * hand. The dictionaries are the source of truth; these files are output.
 *
 * Run with `npm run gen:locale`; `npm run verify:locale` fails when a
 * committed file no longer matches.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dictionaries } from '../src/client/locales.ts'

const ROOT = import.meta.dirname.replace(/\/scripts$/u, '')
const CHECK = process.argv.includes('--check')

const failures: string[] = []
for (const [tag, dictionary] of Object.entries(dictionaries)) {
  const file = join(ROOT, 'locale', `${tag}.json`)
  // Only the marketplace-facing metadata is published; the UI copy rides the bundle.
  const expected = `${JSON.stringify(
    { meta: { title: dictionary['meta.title'], description: dictionary['meta.description'] } },
    null,
    2,
  )}\n`
  if (CHECK) {
    const actual = await readFile(file, 'utf8').catch(() => '')
    if (actual !== expected) failures.push(file)
    continue
  }
  await writeFile(file, expected, 'utf8')
}

if (failures.length > 0) {
  console.error(`locale files are stale (run \`npm run gen:locale\`):\n  ${failures.join('\n  ')}`)
  process.exitCode = 1
} else if (CHECK) {
  console.log('locale files match the dictionaries')
}
