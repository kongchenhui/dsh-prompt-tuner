/**
 * @vitest-environment jsdom
 */
/**
 * The settings navigation glyph.
 *
 * The shell resolves `settings.section.icon` by matching ids against the
 * `settings.section` ledger and falls back to a generic gear otherwise, so two
 * things can silently regress without an error: an id that no longer matches
 * the section (gear comes back), and a mark that paints its own colour instead
 * of `currentColor` (it stops following the row's hover and selected paint).
 * Both are asserted here against the registrations `apply()` actually makes,
 * using a fake registry rather than the harness's.
 */
import { cleanup, render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { apply } from '../src/client/index.tsx'

/** One `slots.register` call, as the fake registry recorded it. */
interface Registration {
  readonly options: Record<string, unknown>
  readonly component: (props: never) => ReactElement | null
}

/** Slot name to the registrations made for it. */
type Ledger = Map<string, Registration[]>

/**
 * Build the slice of the client context `apply()` touches.
 *
 * `effect` runs its callback the way cordis does — immediately, keeping the
 * returned disposer — so the dictionaries and the store teardown are exercised
 * rather than skipped. `inject` is ownership-gated in the harness: the callback
 * runs only once the declared host exists, which is why a contribution missing
 * from the ledger would be a real defect and not a fixture artifact. Each
 * host's disposer is kept so a test can tear the plugin down.
 * @returns the fake context, the ledger it fills, and per-host disposers.
 */
function createFakeContext(): {
  readonly ctx: Record<string, unknown>
  readonly ledger: Ledger
  readonly injecting: Map<string, () => void>
} {
  const ledger: Ledger = new Map()
  const injecting = new Map<string, () => void>()

  const ctx = {
    slots: {
      inject(host: string, callback: () => () => void): () => void {
        const dispose = callback()
        injecting.set(host, dispose)
        return dispose
      },
      register(options: Record<string, unknown>, component: never): () => void {
        const name = String(options.name)
        const entry: Registration = { options, component }
        const list = ledger.get(name) ?? []
        list.push(entry)
        ledger.set(name, list)
        return () => {
          ledger.set(
            name,
            (ledger.get(name) ?? []).filter((candidate) => candidate !== entry),
          )
        }
      },
    },
    locale: {
      register: () => () => undefined,
      bind: () => (key: string) => key,
    },
    effect(callback: () => () => void): () => void {
      return callback()
    },
  }

  return { ctx, ledger, injecting }
}

/** The one registration recorded for a slot, failing loudly if it is absent. */
function soleRegistration(ledger: Ledger, name: string): Registration {
  const list = ledger.get(name) ?? []
  expect(list, `no ${name} registration`).toHaveLength(1)
  const [entry] = list
  if (entry === undefined) throw new Error(`no ${name} registration`)
  return entry
}

/** Render one contribution with the props the harness passes. */
function mount(entry: Registration, props: Record<string, unknown>): RenderResult {
  const Component = entry.component as unknown as (props: Record<string, unknown>) => ReactElement | null
  return render(<Component {...props} />)
}

afterEach(() => {
  cleanup()
})

describe('settings navigation glyph', () => {
  it('registers an icon whose id matches the settings section', () => {
    const { ctx, ledger } = createFakeContext()
    apply(ctx as never)

    const section = soleRegistration(ledger, 'settings.section')
    const icon = soleRegistration(ledger, 'settings.section.icon')

    // The shell pairs an icon with a section by id. Any drift here does not
    // fail loudly at runtime — it just brings the fallback gear back.
    expect(icon.options.id).toBe(section.options.id)
    expect(icon.options.id).toBe('prompt-tuner')
    // An icon contribution's label is never displayed; adding one would mean
    // the shell had been asked for text it does not render.
    expect(icon.options.label).toBeUndefined()
  })

  it('sizes the mark to the edge the shell requests', () => {
    const { ctx, ledger } = createFakeContext()
    apply(ctx as never)
    const icon = soleRegistration(ledger, 'settings.section.icon')

    for (const size of [16, 20]) {
      const view = mount(icon, { size, active: false })
      const svg = view.container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute('width')).toBe(String(size))
      expect(svg?.getAttribute('height')).toBe(String(size))
      // The row wraps the glyph in its own `aria-hidden` span; a second
      // accessible name on the mark itself would double it for screen readers.
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      view.unmount()
    }
  })

  it('inherits the row colour instead of hard-coding one', () => {
    const { ctx, ledger } = createFakeContext()
    apply(ctx as never)
    const icon = soleRegistration(ledger, 'settings.section.icon')

    const view = mount(icon, { size: 16, active: true })
    const markup = view.container.innerHTML
    expect(markup).toContain('currentColor')
    // Selected and idle rows differ only in inherited colour; a literal paint
    // would freeze the mark at one state.
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/iu)
  })

  it('withdraws the mark when the plugin is torn down', () => {
    const { ctx, ledger, injecting } = createFakeContext()
    apply(ctx as never)
    expect(ledger.get('settings.section.icon')).toHaveLength(1)

    // Disposing the contribution is what restores the shell's own glyph, so a
    // registration that outlived its host would leave a dead mark in the row.
    injecting.get('settings.section.icon')?.()
    expect(ledger.get('settings.section.icon')).toHaveLength(0)
  })
})
