/**
 * Settings projection and the atomic write.
 *
 * The store is what a hand-edited or version-skewed document passes through,
 * so the projection is the boundary that keeps a bad document from reaching a
 * render site.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSettingsStore, DEFAULTS, MAX_OUTPUT_TOKENS, normalize } from '../src/host/settings.ts'

describe('normalize', () => {
  it('projects a non-object onto defaults', () => {
    for (const raw of [null, undefined, 42, 'text', []]) {
      expect(normalize(raw)).toEqual(DEFAULTS)
    }
  })

  it('keeps a complete model pair and rejects a half-filled one', () => {
    expect(normalize({ model: { provider: 'p', model: 'm' } }).model).toEqual({ provider: 'p', model: 'm' })
    expect(normalize({ model: { provider: 'p', model: '' } }).model).toEqual({ provider: '', model: '' })
    expect(normalize({ model: { provider: '', model: 'm' } }).model).toEqual({ provider: '', model: '' })
  })

  it('trims the model pair', () => {
    expect(normalize({ model: { provider: '  p  ', model: ' m ' } }).model).toEqual({ provider: 'p', model: 'm' })
  })

  it('clamps maxOutputTokens to the ceiling', () => {
    expect(normalize({ maxOutputTokens: 99999 }).maxOutputTokens).toBe(MAX_OUTPUT_TOKENS)
    expect(normalize({ maxOutputTokens: 7 }).maxOutputTokens).toBe(7)
  })

  it('rejects a non-integer or non-positive token budget', () => {
    for (const value of [0, -1, 1.5, 'many', null]) {
      expect(normalize({ maxOutputTokens: value }).maxOutputTokens).toBe(DEFAULTS.maxOutputTokens)
    }
  })

  it('falls back to the default prompt when the stored one is blank', () => {
    expect(normalize({ prompt: '   ' }).prompt).toBe(DEFAULTS.prompt)
    expect(normalize({ prompt: 'custom' }).prompt).toBe('custom')
  })
})

describe('settings store', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'prompt-tuner-'))
    process.env.DSH_HOME = home
  })

  afterEach(() => {
    delete process.env.DSH_HOME
  })

  it('reads defaults when the document is absent', async () => {
    const store = createSettingsStore()
    expect(await store.read()).toEqual(DEFAULTS)
  })

  it('writes the document and reads it back', async () => {
    const store = createSettingsStore()
    await store.write({ prompt: 'x', maxOutputTokens: 64 })
    const text = await readFile(store.file, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect((await store.read()).prompt).toBe('x')
    expect((await store.read()).maxOutputTokens).toBe(64)
  })

  it('keeps omitted fields on a partial write', async () => {
    const store = createSettingsStore()
    await store.write({ prompt: 'first', maxOutputTokens: 64 })
    await store.write({ maxOutputTokens: 128 })
    const value = await store.read()
    expect(value.prompt).toBe('first')
    expect(value.maxOutputTokens).toBe(128)
  })

  it('falls back to defaults when the document is unparseable', async () => {
    const warnings: string[] = []
    const store = createSettingsStore({ warn: (message) => warnings.push(message) })
    await writeFile(store.file, '{ not json', 'utf8').catch(async () => {
      await store.write({})
      await writeFile(store.file, '{ not json', 'utf8')
    })
    expect(await store.read()).toEqual(DEFAULTS)
    expect(warnings.length).toBe(1)
  })

  it('honours DSH_HOME for the document path', () => {
    expect(createSettingsStore().file).toBe(join(home, 'prompt-tuner', 'settings.json'))
  })
})
