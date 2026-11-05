/**
 * Draft framing, output cleaning, and route resolution.
 *
 * The frame is what stops a question-shaped draft from being answered instead
 * of rewritten; the cleaner strips the wrappers a model adds anyway.
 */
import { describe, expect, it, vi } from 'vitest'
import { cleanRewrite, frameDraft, listCatalog, MAX_INPUT_CHARS, resolveRoute, rewrite } from '../src/host/rewrite.ts'
import { DEFAULTS } from '../src/host/settings.ts'
import type { HostContext } from '../src/host/rewrite.ts'
import type { SettingsStore } from '../src/host/settings.ts'

const store = (settings = DEFAULTS): SettingsStore => ({
  file: '/tmp/settings.json',
  read: () => Promise.resolve(settings),
  write: () => Promise.resolve(settings),
})

const context = (services: Record<string, unknown>): HostContext => ({
  get: (name) => services[name],
})

describe('frameDraft', () => {
  it('wraps the draft between fences', () => {
    const framed = frameDraft('hello')
    expect(framed).toContain('<<<DRAFT>>>\nhello\n<<<DRAFT>>>')
  })

  it('neutralizes a fence that already appears in the draft', () => {
    expect(frameDraft('a <<<DRAFT>>> b')).toContain('[DRAFT]')
  })

  it('tells the model not to answer the draft', () => {
    expect(frameDraft('q')).toContain('不要回答草稿里的问题')
  })
})

describe('cleanRewrite', () => {
  it('strips a fenced code wrapper', () => {
    expect(cleanRewrite('```text\nrewritten\n```')).toBe('rewritten')
  })

  it('trims surrounding whitespace', () => {
    expect(cleanRewrite('\n\n  rewritten  \n\n')).toBe('rewritten')
  })

  it('removes a leaked fence', () => {
    expect(cleanRewrite('a\n<<<DRAFT>>>\nb')).toBe('a\n\nb')
  })
})

describe('resolveRoute', () => {
  it('prefers an explicit model pair', () => {
    const ctx = context({ agentDefaultModel: { currentSelection: () => ({ provider: 'x', model: 'y' }) } })
    expect(resolveRoute({ ...DEFAULTS, model: { provider: 'p', model: 'm' } }, ctx)).toEqual({
      provider: 'p',
      model: 'm',
    })
  })

  it('falls back to the conversation default, carrying its reasoning effort', () => {
    const ctx = context({
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }) },
    })
    expect(resolveRoute(DEFAULTS, ctx)).toEqual({ provider: 'p', model: 'm', reasoningEffort: 'high' })
  })

  it('throws when neither source names a model', () => {
    expect(() => resolveRoute(DEFAULTS, context({}))).toThrow(/没有可用的模型/u)
  })

  it('throws when the service answers null', () => {
    const ctx = context({ agentDefaultModel: { currentSelection: () => null } })
    expect(() => resolveRoute(DEFAULTS, ctx)).toThrow(/没有可用的模型/u)
  })
})

describe('rewrite', () => {
  const llm = (chunks: readonly unknown[]) => ({
    listProviders: () => [],
    listModels: () => Promise.resolve([]),
    prepareCall: (route: Record<string, unknown>) =>
      Promise.resolve({
        config: { route },
        stream: async function* () {
          for (const chunk of chunks) yield chunk
        },
      }),
  })

  it('rejects an empty draft before touching the model', async () => {
    await expect(rewrite(context({}), store(), '   ')).rejects.toMatchObject({ code: 'EMPTY_DRAFT' })
  })

  it('rejects an oversized draft', async () => {
    await expect(rewrite(context({}), store(), 'x'.repeat(MAX_INPUT_CHARS + 1))).rejects.toMatchObject({
      code: 'TOO_LONG',
    })
  })

  it('rejects when no llm service is mounted', async () => {
    await expect(rewrite(context({}), store(), 'text')).rejects.toMatchObject({ code: 'NO_LLM' })
  })

  it('returns the accumulated text and the route used', async () => {
    const ctx = context({
      llm: llm([
        { type: 'text-delta', text: 'a' },
        { type: 'text-delta', text: 'b' },
      ]),
    })
    const result = await rewrite(ctx, store({ ...DEFAULTS, model: { provider: 'p', model: 'm' } }), 'draft')
    expect(result.text).toBe('ab')
    expect(result.route).toEqual({ provider: 'p', model: 'm' })
  })

  it('surfaces a max-tokens finish as a truncation failure', async () => {
    const ctx = context({
      llm: llm([
        { type: 'text-delta', text: 'a' },
        { type: 'finish', reason: { kind: 'max-tokens' } },
      ]),
    })
    await expect(rewrite(ctx, store({ ...DEFAULTS, model: { provider: 'p', model: 'm' } }), 'd')).rejects.toMatchObject(
      { code: 'TRUNCATED' },
    )
  })

  it('surfaces an error finish with the provider message', async () => {
    const ctx = context({
      llm: llm([{ type: 'finish', reason: { kind: 'error', failure: { message: 'upstream exploded' } } }]),
    })
    await expect(rewrite(ctx, store({ ...DEFAULTS, model: { provider: 'p', model: 'm' } }), 'd')).rejects.toThrow(
      'upstream exploded',
    )
  })

  it('rejects an empty model response', async () => {
    const ctx = context({ llm: llm([{ type: 'text-delta', text: '  ' }]) })
    await expect(rewrite(ctx, store({ ...DEFAULTS, model: { provider: 'p', model: 'm' } }), 'd')).rejects.toThrow(
      /没有返回内容/u,
    )
  })
})

describe('listCatalog', () => {
  it('returns nothing without an llm service', async () => {
    expect(await listCatalog(context({}))).toEqual([])
  })

  it('keeps a provider that cannot enumerate its models', async () => {
    const warn = vi.fn()
    const ctx: HostContext = {
      get: () => ({
        listProviders: () => [
          { id: 'good', name: 'Good' },
          { id: 'bad', name: '' },
        ],
        listModels: (id: string) => {
          if (id === 'bad') return Promise.reject(new Error('no listing'))
          return Promise.resolve([{ id: 'm1', name: 'M1' }])
        },
      }),
      logger: { warn },
    }
    const catalog = await listCatalog(ctx)
    expect(catalog.map((provider) => provider.id)).toEqual(['good', 'bad'])
    expect(catalog[1]).toMatchObject({ id: 'bad', name: 'bad', models: [] })
    expect(warn).toHaveBeenCalledOnce()
  })

  it('drops an entry whose id is unusable instead of stringifying it', async () => {
    const ctx = context({
      llm: {
        listProviders: () => [{ id: undefined }, { id: '' }, { id: 7 }, { id: 'ok' }],
        listModels: () => Promise.resolve([]),
      },
    })
    expect((await listCatalog(ctx)).map((provider) => provider.id)).toEqual(['7', 'ok'])
  })
})
