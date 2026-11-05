/**
 * @vitest-environment jsdom
 */
/**
 * Composer control across a Session switch.
 *
 * The harness remounts this slot whenever the selected Session changes, so the
 * tests unmount and mount it again with a different `sessionId` — that is the
 * whole mechanism under test. Everything else (the request, the drafts, the
 * failure) has to come back from the store, not from the unmounted component.
 *
 * One harness detail the fixture reproduces on purpose: `inputActions` is
 * **stable per Session**, owned by the Session scope rather than the mounted
 * control. A write-back that lands after a switch therefore still targets the
 * right composer, and the fixture would hide a regression if it minted a fresh
 * action object per mount.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TunerButton } from '../src/client/components/TunerButton.tsx'
import { createTunerStore } from '../src/client/tuner-store.ts'

const t = (key: string): string => key

/** One settleable request per start, keyed by the draft it carried. */
interface Pending {
  readonly text: string
  succeed(text: string): void
  fail(error: unknown): void
}

/** Install a `fetch` that holds every request until the test settles it. */
function stubFetch(): Pending[] {
  const pending: Pending[] = []
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    const raw = init?.body
    const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : '{}')
    const text =
      typeof parsed === 'object' && parsed !== null && 'text' in parsed && typeof parsed.text === 'string'
        ? parsed.text
        : ''
    return new Promise((resolve, reject) => {
      pending.push({
        text,
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
  return pending
}

/** Let a settled request's microtask chain run inside React's act(). */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 0))
  })

/** The button currently on screen. */
const button = (): HTMLElement => screen.getByRole('button')

/**
 * One Session's durable composer: stable actions plus the live draft.
 *
 * `attached` mirrors the harness: an input shell outlives the control only
 * while the Session stays selected. A detached Session has had its shell torn
 * down, so a write-back into it is silently dropped — which is exactly the
 * case the control has to recover from on remount.
 */
interface Composer {
  draft: string
  attached: boolean
  readonly inputActions: { setDraft(text: string): void }
}

/** The draft each Session's composer holds, surviving every remount. */
const composers = new Map<string, Composer>()

/** A mounted control and the operations a switch needs. */
interface Mounted {
  readonly view: RenderResult
  unmount(): void
  /** Re-read the composer, the way a subscribed `useInput` would. */
  sync(draft?: string): void
}

/** Create (once) or read one Session's composer. */
function composerFor(sessionId: string, initial: string): Composer {
  const existing = composers.get(sessionId)
  if (existing !== undefined) return existing
  const record: Composer = {
    draft: initial,
    attached: false,
    inputActions: {
      setDraft(text: string) {
        if (!record.attached) return
        record.draft = text
      },
    },
  }
  composers.set(sessionId, record)
  return record
}

/** Edit one Session's composer while no control is mounted for it. */
function editComposer(sessionId: string, text: string): void {
  const composer = composers.get(sessionId)
  if (composer === undefined) throw new Error(`no composer for ${sessionId}`)
  composer.draft = text
}

/**
 * Render the control for one Session.
 * @param store - the store under test.
 * @param sessionId - the Session this mount belongs to.
 * @param initial - the draft that Session's composer starts with.
 */
function mount(store: ReturnType<typeof createTunerStore>, sessionId: string, initial: string): Mounted {
  const composer = composerFor(sessionId, initial)
  const useInput = <T,>(selector: (state: { draft: string; phase: string }) => T): T =>
    selector({ draft: composer.draft, phase: 'idle' })
  const props = { useInput, inputActions: composer.inputActions, sessionId, store, t }
  composer.attached = true
  const view = render(<TunerButton {...props} />)
  return {
    view,
    unmount() {
      composer.attached = false
      view.unmount()
    },
    sync(draft) {
      if (draft !== undefined) composer.draft = draft
      view.rerender(
        <TunerButton {...props} useInput={(selector) => selector({ draft: composer.draft, phase: 'idle' })} />,
      )
    },
  }
}

beforeEach(() => {
  composers.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('a rewrite that completes while mounted', () => {
  it('writes the rewrite back and offers a restore', async () => {
    const pending = stubFetch()
    const store = createTunerStore()
    const mounted = mount(store, 'a', 'my draft')

    fireEvent.click(button())
    expect(button().dataset.state).toBe('running')
    expect(pending[0]?.text).toBe('my draft')

    pending[0]?.succeed('better draft')
    await settle()

    expect(button().dataset.state).toBe('done')
    expect(composers.get('a')?.draft).toBe('better draft')
    mounted.sync()
    expect(button().dataset.state).toBe('done')
  })

  it('restores the original and returns to idle', async () => {
    const pending = stubFetch()
    const store = createTunerStore()
    const mounted = mount(store, 'a', 'my draft')

    fireEvent.click(button())
    pending[0]?.succeed('better draft')
    await settle()
    mounted.sync()

    fireEvent.click(button())
    expect(composers.get('a')?.draft).toBe('my draft')
    expect(button().dataset.state).toBe('idle')
  })
})

describe('a Session switch', () => {
  it('brings the done state and its restore back with the Session', async () => {
    const pending = stubFetch()
    const store = createTunerStore()
    const first = mount(store, 'a', 'my draft')

    fireEvent.click(button())
    pending[0]?.succeed('better draft')
    await settle()
    first.sync()
    expect(button().dataset.state).toBe('done')

    // Switch to b: the harness remounts the slot, so a's control unmounts.
    first.unmount()
    const second = mount(store, 'b', 'other draft')
    expect(button().dataset.state).toBe('idle')

    // Switch back to a: the state must be there, not reset.
    second.unmount()
    mount(store, 'a', 'better draft')
    expect(button().dataset.state).toBe('done')

    fireEvent.click(button())
    expect(composers.get('a')?.draft).toBe('my draft')
  })

  it('keeps a running rewrite alive and finishable after the switch', async () => {
    const pending = stubFetch()
    const store = createTunerStore()
    const first = mount(store, 'a', 'my draft')

    fireEvent.click(button())
    expect(button().dataset.state).toBe('running')
    first.unmount()

    // The request must not have been aborted by the unmount.
    expect(pending).toHaveLength(1)
    const second = mount(store, 'b', 'other draft')
    expect(button().dataset.state).toBe('idle')

    // It lands while b is on screen: a's draft is written, b's is untouched.
    pending[0]?.succeed('better draft')
    await settle()
    expect(composers.get('b')?.draft).toBe('other draft')

    second.unmount()
    mount(store, 'a', 'better draft')
    expect(button().dataset.state).toBe('done')
    expect(composers.get('a')?.draft).toBe('better draft')
  })

  it('keeps two Sessions on their own state and targets', async () => {
    const pending = stubFetch()
    const store = createTunerStore()

    const a = mount(store, 'a', 'alpha')
    fireEvent.click(button())
    a.unmount()

    mount(store, 'b', 'beta')
    fireEvent.click(button())

    pending[0]?.succeed('alpha rewritten')
    await settle()

    // b is still running; a's result must not have reached b's composer.
    expect(button().dataset.state).toBe('running')
    expect(composers.get('b')?.draft).toBe('beta')

    pending[1]?.succeed('beta rewritten')
    await settle()
    expect(button().dataset.state).toBe('done')
    expect(composers.get('b')?.draft).toBe('beta rewritten')
  })

  it('cancels only the Session that asked to be cancelled', async () => {
    const pending = stubFetch()
    const store = createTunerStore()

    const a = mount(store, 'a', 'alpha')
    fireEvent.click(button())
    a.unmount()

    const b = mount(store, 'b', 'beta')
    fireEvent.click(button())
    // b's own press while running is the cancel gesture.
    fireEvent.click(button())
    expect(button().dataset.state).toBe('idle')

    b.unmount()
    mount(store, 'a', 'alpha')
    expect(button().dataset.state).toBe('running')

    pending[0]?.succeed('alpha rewritten')
    await settle()
    expect(button().dataset.state).toBe('done')
    expect(composers.get('a')?.draft).toBe('alpha rewritten')
  })
})

describe('a rewrite that landed while detached', () => {
  it('applies the stored rewrite when the Session comes back', async () => {
    const pending = stubFetch()
    const store = createTunerStore()
    const first = mount(store, 'a', 'my draft')

    fireEvent.click(button())
    first.unmount()

    // It resolves with no control mounted: the composer still holds the
    // pre-rewrite draft, so the rewrite has to be applied on remount.
    pending[0]?.succeed('better draft')
    await settle()
    expect(composers.get('a')?.draft).toBe('my draft')

    mount(store, 'a', 'my draft')
    expect(composers.get('a')?.draft).toBe('better draft')
    expect(button().dataset.state).toBe('done')
  })

  it('never overwrites text typed while the Session was away', async () => {
    const pending = stubFetch()
    const store = createTunerStore()
    const first = mount(store, 'a', 'my draft')

    fireEvent.click(button())
    first.unmount()
    pending[0]?.succeed('better draft')
    await settle()

    // The user typed something else in the meantime; that edit wins and the
    // restore offer retires rather than replacing it.
    editComposer('a', 'typed while away')
    mount(store, 'a', 'typed while away')
    expect(composers.get('a')?.draft).toBe('typed while away')
    expect(button().dataset.state).toBe('idle')
  })
})

describe('a failure', () => {
  it('survives the switch and keeps its message', async () => {
    const pending = stubFetch()
    const store = createTunerStore()
    const first = mount(store, 'a', 'my draft')

    fireEvent.click(button())
    pending[0]?.fail(new Error('HTTP 500'))
    await settle()
    expect(button().dataset.state).toBe('failed')

    first.unmount()
    const second = mount(store, 'b', 'other draft')
    expect(button().dataset.state).toBe('idle')
    second.unmount()

    mount(store, 'a', 'my draft')
    expect(button().dataset.state).toBe('failed')
    // The bubble follows the pointer only: focusing the button (a click leaves
    // it focused) must not park a tooltip on screen.
    fireEvent.focus(button())
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(button())
    expect(screen.getByRole('tooltip').textContent).toContain('HTTP 500')
  })

  it('clears once the draft is edited', async () => {
    const pending = stubFetch()
    const store = createTunerStore()
    const mounted = mount(store, 'a', 'my draft')

    fireEvent.click(button())
    pending[0]?.fail(new Error('HTTP 500'))
    await settle()
    expect(button().dataset.state).toBe('failed')

    mounted.sync('edited by hand')
    expect(button().dataset.state).toBe('idle')
  })
})

describe('a draft edited after a rewrite', () => {
  it('retires the restore offer instead of overwriting the new text', async () => {
    const pending = stubFetch()
    const store = createTunerStore()
    const mounted = mount(store, 'a', 'my draft')

    fireEvent.click(button())
    pending[0]?.succeed('better draft')
    await settle()
    // The write-back must be observed before a manual edit can retire it.
    mounted.sync()
    expect(button().dataset.state).toBe('done')

    mounted.sync('typed by hand')
    expect(button().dataset.state).toBe('idle')
  })
})

describe('a slot without what it needs', () => {
  it('renders nothing without a Session', () => {
    const store = createTunerStore()
    const composer = composerFor('a', 'draft')
    const { container } = render(
      <TunerButton
        useInput={(selector) => selector({ draft: 'draft', phase: 'idle' })}
        inputActions={composer.inputActions}
        store={store}
        t={t}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing without input actions', () => {
    const store = createTunerStore()
    const { container } = render(<TunerButton sessionId="a" store={store} t={t} />)
    expect(container.firstChild).toBeNull()
  })
})
