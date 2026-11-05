/**
 * Settings snapshot shared by both surfaces.
 *
 * The harness's store engine is not reachable from a third-party bundle (it is
 * a module-table row this package does not request), so this is the smallest
 * equivalent: one immutable snapshot, a listener set, and a single in-flight
 * load deduplicated across concurrent readers. The settings page is the only
 * reader and the only writer.
 */
import { request } from './api.ts'
import type { ConfigResponse, Settings } from './types.ts'

/** Immutable view every consumer reads. */
export interface SettingsSnapshot {
  readonly settings: Settings
  readonly defaults: Settings
  readonly settingsPath: string
}

/** Load state of the shared snapshot. */
export interface SettingsStore {
  /** Current snapshot, or `undefined` before the first successful load. */
  getSnapshot(): SettingsSnapshot | undefined
  /** Last load failure, cleared by the next success. */
  getError(): string | undefined
  /** Subscribe to snapshot and error changes. */
  subscribe(listener: () => void): () => void
  /** Load once, deduplicating concurrent callers. */
  ensure(): Promise<void>
  /** Persist a patch and fold the host's projection back into the snapshot. */
  save(patch: Partial<Settings>): Promise<Settings>
}

/**
 * Create the settings store.
 * @returns a fresh store; one per plugin mount, never a module-level singleton.
 */
export function createSettingsStore(): SettingsStore {
  let snapshot: SettingsSnapshot | undefined
  let error: string | undefined
  let inflight: Promise<void> | undefined
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  const ensure = (): Promise<void> => {
    if (inflight !== undefined) return inflight
    inflight = request<ConfigResponse>('/config')
      .then((body) => {
        snapshot = { settings: body.settings, defaults: body.defaults, settingsPath: body.settingsPath }
        error = undefined
      })
      .catch((failure: unknown) => {
        error = failure instanceof Error ? failure.message : String(failure)
      })
      .finally(() => {
        inflight = undefined
        emit()
      })
    return inflight
  }

  const save = async (patch: Partial<Settings>): Promise<Settings> => {
    const body = await request<ConfigResponse>('/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const next: SettingsSnapshot = {
      settings: body.settings,
      defaults: snapshot?.defaults ?? body.defaults,
      settingsPath: snapshot?.settingsPath ?? body.settingsPath,
    }
    snapshot = next
    error = undefined
    emit()
    return body.settings
  }

  return {
    getSnapshot: () => snapshot,
    getError: () => error,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    ensure,
    save,
  }
}
