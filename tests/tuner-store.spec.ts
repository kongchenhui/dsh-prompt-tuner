/**
 * Per-Session rewrite state: isolation, survival across a switch, and teardown.
 *
 * The harness remounts the composer control on every Session switch, so the
 * store is the only thing that can keep a phase alive. These tests drive it
 * without React: a fake `fetch` hands back one settleable request per start,
 * which is exactly the seam a Session switch moves around.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTunerStore, MAX_RETAINED_SESSIONS } from '../src/client/tuner-store.ts'

/** One intercepted request, settleable from the test. */
interface Call {
  readonly url: string
  readonly text: string
  readonly signal: AbortSignal | undefined
  succeed(text: string): void
  fail(error: unknown): void
}

/** Install a `fetch` that records calls and settles only when told to. */
function stubFetch(): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const raw = init?.body
    const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : '{}')
    const text =
      typeof parsed === 'object' && parsed !== null && 'text' in parsed && typeof parsed.text === 'string'
        ? parsed.text
        : ''
    const signal = init?.signal ?? undefined
    return new Promise((resolve, reject) => {
      calls.push({
        url,
        text,
        signal,
        succeed(rewritten: string) {
          resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, text: rewritten, route: { provider: 'p', model: 'm' } }),
          })
        },
        fail(error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      })
    })
  })
  return calls
}

/** A write-back target that discards what it is given. */
const noop = (): void => {
  // Nothing to record; the assertion is about the store's own state.
}

/** Let the pending microtask chain of a settled request run. */
const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

/** A write-back target that records what it received. */
function sink(): { calls: string[]; apply: (text: string) => void } {
  const calls: string[] = []
  return { calls, apply: (text: string) => calls.push(text) }
}

let clock = 0
beforeEach(() => {
  clock = 1000
  // Eviction order depends on `Date.now`, and several records are created in
  // the same millisecond here; a monotonic clock keeps the order meaningful.
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('start', () => {
  it('runs, writes the rewrite back, and settles on done', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const target = sink()

    store.attach('a', target.apply)
    store.start('a', 'draft')
    expect(store.getSnapshot('a').phase).toBe('running')
    expect(calls[0]?.text).toBe('draft')

    calls[0]?.succeed('rewritten')
    await flush()

    const after = store.getSnapshot('a')
    expect(after.phase).toBe('done')
    expect(after.original).toBe('draft')
    expect(after.enhanced).toBe('rewritten')
    expect(target.calls).toEqual(['rewritten'])
  })

  it('refuses a blank draft', () => {
    const calls = stubFetch()
    const store = createTunerStore()
    store.start('a', '   ')
    expect(store.getSnapshot('a').phase).toBe('idle')
    expect(calls).toHaveLength(0)
  })

  it('ignores a second start while one is live', () => {
    const calls = stubFetch()
    const store = createTunerStore()
    store.start('a', 'first')
    store.start('a', 'second')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.text).toBe('first')
  })

  it('treats an empty answer as a failure without writing back', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const target = sink()
    store.attach('a', target.apply)
    store.start('a', 'draft')
    calls[0]?.succeed('   ')
    await flush()
    expect(store.getSnapshot('a').phase).toBe('failed')
    expect(target.calls).toEqual([])
  })

  it('keeps the raw rejection so the message can be localized later', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const failure = new Error('HTTP 500')
    store.start('a', 'draft')
    calls[0]?.fail(failure)
    await flush()
    expect(store.getSnapshot('a').failure).toBe(failure)
  })

  it('reports a write-back that throws instead of leaving it unhandled', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    store.attach('a', () => {
      throw new Error('composer gone')
    })
    store.start('a', 'draft')
    calls[0]?.succeed('rewritten')
    await flush()
    const after = store.getSnapshot('a')
    expect(after.phase).toBe('failed')
    expect(after.enhanced).toBe('')
  })
})

describe('session isolation', () => {
  it('keeps two Sessions on their own drafts, results, and targets', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const a = sink()
    const b = sink()

    store.attach('a', a.apply)
    store.start('a', 'alpha')
    store.attach('b', b.apply)
    store.start('b', 'beta')
    calls[1]?.succeed('B rewritten')
    await flush()

    // b settled first and must not have touched a.
    expect(store.getSnapshot('a').phase).toBe('running')
    expect(store.getSnapshot('b').phase).toBe('done')
    expect(a.calls).toEqual([])

    calls[0]?.succeed('A rewritten')
    await flush()

    expect(a.calls).toEqual(['A rewritten'])
    expect(b.calls).toEqual(['B rewritten'])
    expect(store.getSnapshot('a').enhanced).toBe('A rewritten')
    expect(store.getSnapshot('b').enhanced).toBe('B rewritten')
  })

  it('cancels only the named Session', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const a = sink()
    const b = sink()

    store.attach('a', a.apply)
    store.start('a', 'alpha')
    store.attach('b', b.apply)
    store.start('b', 'beta')

    store.cancel('a')
    expect(store.getSnapshot('a').phase).toBe('idle')
    expect(store.getSnapshot('b').phase).toBe('running')
    expect(calls[0]?.signal?.aborted).toBe(true)
    expect(calls[1]?.signal?.aborted).toBe(false)

    calls[1]?.succeed('B rewritten')
    await flush()
    expect(store.getSnapshot('b').phase).toBe('done')
    expect(a.calls).toEqual([])
  })

  it('does not let a cancelled request overwrite the Session it belonged to', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const a = sink()

    store.attach('a', a.apply)
    store.start('a', 'alpha')
    store.cancel('a')
    // A late resolution after cancellation must be discarded.
    calls[0]?.succeed('late')
    await flush()

    expect(store.getSnapshot('a').phase).toBe('idle')
    expect(a.calls).toEqual([])
  })

  it('notifies only the Session whose state changed', () => {
    stubFetch()
    const store = createTunerStore()
    const seenA = vi.fn()
    const seenB = vi.fn()
    store.subscribe('a', seenA)
    store.subscribe('b', seenB)

    store.start('a', 'alpha')
    expect(seenA).toHaveBeenCalledTimes(1)
    expect(seenB).not.toHaveBeenCalled()
  })
})

describe('surviving a Session switch', () => {
  it('keeps the done state readable after every listener unsubscribes', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    store.start('a', 'draft')
    calls[0]?.succeed('rewritten')
    await flush()

    // Mount, unmount, mount: a switch is exactly this from the store's view.
    const unsubscribe = store.subscribe('a', noop)
    expect(store.getSnapshot('a').phase).toBe('done')
    unsubscribe()
    expect(store.getSnapshot('a').phase).toBe('done')
    expect(store.getSnapshot('a').original).toBe('draft')
  })

  it('writes through whatever composer is attached when the request resolves', async () => {
    // The harness tears a Session's input shell down on switch-away and mints
    // a fresh one on switch-back, so the composer that pressed the button is
    // gone by the time the result lands. The write must follow the mount the
    // Session has now, never the one that started the request.
    const calls = stubFetch()
    const store = createTunerStore()
    const started = sink()
    const mounted = sink()

    store.attach('a', started.apply)
    store.start('a', 'draft')
    store.attach('a', mounted.apply) // switch-back: a fresh shell registered itself

    calls[0]?.succeed('rewritten')
    await flush()

    expect(started.calls).toEqual([])
    expect(mounted.calls).toEqual(['rewritten'])
    expect(store.getSnapshot('a').phase).toBe('done')
  })

  it('skips the write when nothing is attached and still settles on done', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const target = sink()

    store.attach('a', target.apply)
    store.start('a', 'draft')
    // Unregister every copy of the target: the shell is gone, nothing is
    // mounted, so the resolution has no composer to write into.
    const first = store.attach('a', target.apply)
    const second = store.attach('a', target.apply)
    first()
    first()
    second()
    second()

    calls[0]?.succeed('rewritten')
    await flush()

    expect(target.calls).toEqual([])
    expect(store.getSnapshot('a').phase).toBe('done')
    expect(store.getSnapshot('a').enhanced).toBe('rewritten')
  })

  it('keeps the write target across a cancel and a later start on the same mount', async () => {
    // `cancel` must not clear the mounted control's registration: the very
    // next press on the same mount would otherwise write into nothing.
    const calls = stubFetch()
    const store = createTunerStore()
    const target = sink()

    store.attach('a', target.apply)
    store.start('a', 'first')
    store.cancel('a')

    store.start('a', 'second')
    calls[1]?.succeed('second rewritten')
    await flush()

    expect(target.calls).toEqual(['second rewritten'])
    expect(store.getSnapshot('a').phase).toBe('done')
  })

  it('keeps a write-back that landed while the Session was detached reappliable', async () => {
    const calls = stubFetch()
    const store = createTunerStore()

    store.start('a', 'draft')
    // Nothing is attached — the harness tore the input shell down and no
    // control is mounted — so the write is skipped and the rewrite stays
    // stored for the coming mount to re-apply.
    calls[0]?.succeed('rewritten')
    await flush()

    expect(store.getSnapshot('a').phase).toBe('done')
    expect(store.getSnapshot('a').enhanced).toBe('rewritten')
  })

  it('does not let a stale registration overwrite a newer one', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const stale = sink()
    const fresh = sink()

    store.attach('a', stale.apply)
    store.attach('a', fresh.apply)
    store.start('a', 'draft')

    calls[0]?.succeed('rewritten')
    await flush()
    expect(stale.calls).toEqual([])
    expect(fresh.calls).toEqual(['rewritten'])
  })

  it('lets an in-flight request finish and write while nothing is mounted', async () => {
    // Nothing registered means nothing to write into; the snapshot still
    // settles on done so a later mount can re-apply the stored rewrite.
    const calls = stubFetch()
    const store = createTunerStore()

    store.start('a', 'draft')

    expect(calls[0]?.signal?.aborted).toBe(false)
    calls[0]?.succeed('rewritten')
    await flush()

    expect(store.getSnapshot('a').phase).toBe('done')
    expect(store.getSnapshot('a').enhanced).toBe('rewritten')
  })
})

describe('observation bookkeeping', () => {
  it('records the seen flag without publishing', () => {
    stubFetch()
    const store = createTunerStore()
    const listener = vi.fn()
    store.subscribe('a', listener)
    store.note('a', { enhancedSeen: true })
    expect(store.observe('a').enhancedSeen).toBe(true)
    expect(listener).not.toHaveBeenCalled()
  })

  it('resets a Session and clears its bookkeeping', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    store.start('a', 'draft')
    calls[0]?.succeed('rewritten')
    await flush()
    store.note('a', { enhancedSeen: true })

    store.reset('a')
    expect(store.getSnapshot('a').phase).toBe('idle')
    expect(store.observe('a').enhancedSeen).toBe(false)
  })

  it('ignores bookkeeping for a Session it never saw', () => {
    stubFetch()
    const store = createTunerStore()
    expect(() => {
      store.note('ghost', { enhancedSeen: true })
    }).not.toThrow()
    expect(store.observe('ghost').enhancedSeen).toBe(false)
    expect(store.getSnapshot('ghost').phase).toBe('idle')
  })
})

describe('retention', () => {
  it('drops the oldest settled Session once the cap is exceeded', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const total = MAX_RETAINED_SESSIONS + 1

    for (let index = 0; index < total; index += 1) {
      store.start(`s${String(index)}`, 'draft')
      calls[index]?.succeed('rewritten')
      await flush()
    }

    // The first Session is evicted; the newest is retained.
    expect(store.getSnapshot('s0').phase).toBe('idle')
    expect(store.getSnapshot(`s${String(total - 1)}`).phase).toBe('done')
  })

  it('never evicts a Session that is still running', async () => {
    const calls = stubFetch()
    const store = createTunerStore()

    store.start('busy', 'draft')
    for (let index = 0; index < MAX_RETAINED_SESSIONS + 1; index += 1) {
      store.start(`s${String(index)}`, 'draft')
      calls[index + 1]?.succeed('rewritten')
      await flush()
    }

    expect(store.getSnapshot('busy').phase).toBe('running')
    expect(calls[0]?.signal?.aborted).toBe(false)
  })

  it('never evicts a Session that is still being viewed', async () => {
    const calls = stubFetch()
    const store = createTunerStore()

    store.subscribe('watched', noop)
    for (let index = 0; index < MAX_RETAINED_SESSIONS + 1; index += 1) {
      store.start(`s${String(index)}`, 'draft')
      calls[index]?.succeed('rewritten')
      await flush()
    }

    expect(store.getSnapshot('watched').phase).toBe('idle')
    // Being idle and unwatched would have made it a candidate; the listener
    // is what kept the record (and would have kept a settled phase with it).
    store.note('watched', { enhancedSeen: true })
    expect(store.observe('watched').enhancedSeen).toBe(true)
  })
})

describe('dispose', () => {
  it('aborts every live request and ignores late results', async () => {
    const calls = stubFetch()
    const store = createTunerStore()
    const a = sink()
    const b = sink()
    store.attach('a', a.apply)
    store.start('a', 'alpha')
    store.attach('b', b.apply)
    store.start('b', 'beta')

    store.dispose()
    expect(calls[0]?.signal?.aborted).toBe(true)
    expect(calls[1]?.signal?.aborted).toBe(true)

    calls[0]?.succeed('late a')
    calls[1]?.succeed('late b')
    await flush()

    expect(a.calls).toEqual([])
    expect(b.calls).toEqual([])
    expect(store.getSnapshot('a').phase).toBe('idle')
    expect(store.getSnapshot('b').phase).toBe('idle')
  })
})
