/**
 * Browser half of the composer prompt tuner.
 *
 * Registers two surfaces — a composer control that rewrites the draft, and a
 * settings page holding one prompt and the model that applies it — over the
 * host routes this package mounts. This module only assembles: the control,
 * the picker, and the page are separate components, and the shared settings
 * snapshot lives in its own store.
 *
 * No harness client package is imported: platform modules (`react`) resolve
 * through the loader's injected `require`, everything else is bundled inline.
 */
import { createElement, useEffect, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { createSettingsStore } from './settings-store.ts'
import type { SettingsStore } from './settings-store.ts'
import { dictionaries } from './locales.ts'
import { TunerButton } from './components/TunerButton.tsx'
import { SettingsPage } from './components/SettingsPage.tsx'
import type { ComposerSlotProps, SettingsSlotProps } from './types.ts'

/** Namespace owning this plugin's copy. */
const NS = 'prompt-tuner'

/** Slot registration id, shared by both surfaces. */
const ID = 'prompt-tuner'

/** Services this plugin needs before it can register its surfaces. */
export const inject = ['slots', 'locale'] as const

/** The locale service surface this plugin uses. */
interface LocaleService {
  register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
  bind(namespace: string): (key: string, params?: Record<string, string>) => string
}

/** The slot registry surface this plugin uses. */
interface SlotService {
  inject(host: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** The context slice this plugin's apply receives. */
interface ClientContext {
  readonly slots: SlotService
  readonly locale: LocaleService
  effect(callback: () => () => void, label?: string): () => void
}

/**
 * Read the shared settings snapshot through React's external-store contract.
 * @param store - the plugin's settings store.
 * @returns the current snapshot, or `undefined` before the first load.
 */
function useSettingsSnapshot(store: SettingsStore) {
  const subscribe = (listener: () => void) => store.subscribe(listener)
  const snapshot = useSyncExternalStore(
    subscribe,
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  )
  useEffect(() => {
    void store.ensure()
  }, [store])
  return snapshot
}

/**
 * Bind the settings page to its store once per mount, so the page body stays a
 * plain component receiving everything through props.
 * @param store - the plugin's settings store.
 * @returns the slot-ready page component.
 */
function settingsSurface(store: SettingsStore) {
  return function SettingsSurface(props: SettingsSlotProps): ReactElement {
    const snapshot = useSettingsSnapshot(store)
    return createElement(SettingsPage, { t: props.t, store, snapshot })
  }
}

/**
 * The composer control as a slot component. The slot passes a loose prop bag;
 * this narrows it at the boundary so {@link TunerButton} can stay typed.
 * @param props - whatever the slot passes.
 */
function composerSurface(props: ComposerSlotProps): ReactElement | null {
  return createElement(TunerButton, props)
}

/**
 * Mount both surfaces.
 * @param ctx - client plugin context.
 */
export function apply(ctx: ClientContext): void {
  const store = createSettingsStore()
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'prompt-tuner: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register({ name: 'conversation.input.right', id: ID, order: 1, locale: NS }, composerSurface),
  )

  const Surface = settingsSurface(store)
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: ID, order: 32, locale: NS, label: () => t('sectionLabel') },
      Surface,
    ),
  )
}
