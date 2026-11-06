/**
 * Per-Session state behind the composer control.
 *
 * The harness remounts a session-scoped slot whenever the selected Session
 * changes — component-local state cannot survive a switch, by construction.
 * State that must survive therefore lives here, keyed by `sessionId`, and the
 * control becomes a view over this store.
 *
 * Every field a rewrite touches is partitioned per Session: the phase, the
 * draft it started from, the rewritten text, the failure, and the in-flight
 * `AbortController`. A request is owned by the Session that started it, so
 * switching away neither cancels it nor lets its result reach another Session.
 *
 * The write-back target is the control the Session has mounted *now*, not the
 * one that pressed the button: the harness binds `inputActions` to a per-Session
 * input shell, tears that shell down on switch-away, and mints a fresh one on
 * switch-back, so a closure captured at press time would write into a disposed
 * editor and silently vanish. Controls register their composer through
 * {@link TunerStore.attach} while mounted; a rewrite resolves through whatever
 * is registered at that moment, or nothing — the control re-applies the stored
 * rewrite on remount when the result never reached the composer.
 *
 * Only an explicit cancel or plugin teardown aborts a request — cancelling the
 * tokens a user already asked for by merely looking elsewhere would be a
 * surprise.
 *
 * The harness store engine is not reachable from a third-party bundle, so this
 * is the smallest equivalent: immutable snapshots, one listener set per
 * Session, and no module-level mutable state beyond the Session map itself.
 */
import { request } from './api.ts'
import type { RewriteResponse } from './types.ts'

/** How a Session's control currently presents itself. */
export type TunerPhase = 'idle' | 'running' | 'done' | 'failed'

/** What a control renders; a new reference is published on every change. */
export interface TunerSnapshot {
  readonly phase: TunerPhase
  /** The draft a rewrite started from, and the target of "restore". */
  readonly original: string
  /** The rewritten text written back into this Session's composer. */
  readonly enhanced: string
  /**
   * The raw rejection, kept unformatted: the message is localized at render
   * time, so switching language re-reads the same failure.
   */
  readonly failure: unknown
}

/**
 * Bookkeeping a mounted control keeps while it watches the draft.
 *
 * These never trigger a re-render on their own — they only explain a later
 * draft change — so they sit outside {@link TunerSnapshot} and are mutated in
 * place.
 */
export interface TunerObserved {
  /** Whether the rewritten text has actually been observed in the composer. */
  readonly enhancedSeen: boolean
  /**
   * The draft first observed under a failure. `undefined` until recorded; a
   * separate flag keeps an empty draft from being mistaken for "unrecorded".
   */
  readonly failureBaseline: string | undefined
}

/** The session-partitioned store both surfaces share. */
export interface TunerStore {
  /** Subscribe to one Session's changes. */
  subscribe(sessionId: string, listener: () => void): () => void
  /** Current snapshot for one Session; reference-stable until it changes. */
  getSnapshot(sessionId: string): TunerSnapshot
  /** Current observation bookkeeping for one Session. */
  observe(sessionId: string): TunerObserved
  /** Update observation bookkeeping without publishing. */
  note(sessionId: string, patch: Partial<TunerObserved>): void
  /**
   * Register the mounted control's composer as this Session's write-back
   * target. `inputActions` belongs to the harness's per-Session input shell,
   * which is torn down and replaced across a switch, so the registration is
   * per mount, not per request. The returned detach clears the registration
   * only if it is still the one registered — a StrictMode double-mount or a
   * re-render must not unregister a newer control's composer.
   * @param sessionId - the Session this mount belongs to.
   * @param write - writes text into that Session's composer.
   * @returns the detach callback for unmount.
   */
  attach(sessionId: string, write: (text: string) => void): () => void
  /**
   * Start one rewrite for a Session. The result is written back through
   * whatever {@link attach} has registered when it resolves.
   * @param sessionId - the Session that owns the request.
   * @param draft - the text to rewrite; blank is refused.
   */
  start(sessionId: string, draft: string): void
  /** Abort one Session's in-flight request and return it to idle. */
  cancel(sessionId: string): void
  /** Return one Session to idle and drop its observation bookkeeping. */
  reset(sessionId: string): void
  /** Abort every in-flight request; the plugin is going away. */
  dispose(): void
}

/** Most Sessions whose state is retained; see {@link createTunerStore}. */
export const MAX_RETAINED_SESSIONS = 32

/** Shared idle snapshot: Sessions with no record all read this one reference. */
const IDLE: TunerSnapshot = Object.freeze({
  phase: 'idle',
  original: '',
  enhanced: '',
  failure: undefined,
})

/** Shared observation state for Sessions with no record. */
const UNOBSERVED: TunerObserved = Object.freeze({
  enhancedSeen: false,
  failureBaseline: undefined,
})

/** Everything retained for one Session. */
interface SessionRecord {
  /** Published value; replaced on every change so uSES sees a new reference. */
  snapshot: TunerSnapshot
  /** Mutable, unpublished bookkeeping. */
  observed: TunerObserved
  /** The request this Session owns, if any. */
  controller: AbortController | undefined
  /**
   * The mounted control's composer, registered through `attach`. Follows the
   * mount lifecycle rather than any single request's, so a rewrite resolving
   * after a switch writes through the control mounted now.
   */
  write: ((text: string) => void) | undefined
  readonly listeners: Set<() => void>
  /** Last time this record was read or written, for eviction order. */
  touchedAt: number
}

/**
 * Create the store. One per plugin mount, never a module-level singleton, so
 * two profiles loaded into one page cannot share Session state.
 * @returns a fresh store.
 */
export function createTunerStore(): TunerStore {
  const records = new Map<string, SessionRecord>()

  const now = (): number => Date.now()

  /** Publish a new snapshot and notify this Session's listeners only. */
  const publish = (record: SessionRecord, next: TunerSnapshot): void => {
    record.snapshot = next
    record.touchedAt = now()
    for (const listener of [...record.listeners]) listener()
  }

  /**
   * Drop the least recently touched records once the map is full.
   *
   * A Session mid-rewrite is never dropped (aborting work the user is waiting
   * for is not a cache decision), and neither is one still being viewed. What
   * this can lose is a stale `done`/`failed` state, so a long-running profile
   * does not grow one record per Session ever visited.
   */
  const evict = (): void => {
    if (records.size <= MAX_RETAINED_SESSIONS) return
    const candidates = [...records.entries()]
      .filter(([, record]) => record.snapshot.phase !== 'running' && record.listeners.size === 0)
      .sort(([, left], [, right]) => left.touchedAt - right.touchedAt)
    for (const [sessionId] of candidates) {
      if (records.size <= MAX_RETAINED_SESSIONS) break
      records.delete(sessionId)
    }
  }

  /** Read or create one Session's record. */
  const ensure = (sessionId: string): SessionRecord => {
    const existing = records.get(sessionId)
    if (existing !== undefined) return existing
    const record: SessionRecord = {
      snapshot: IDLE,
      observed: { ...UNOBSERVED },
      controller: undefined,
      write: undefined,
      listeners: new Set(),
      touchedAt: now(),
    }
    records.set(sessionId, record)
    evict()
    return record
  }

  /**
   * Abort whatever the record owns and settle it, without publishing.
   *
   * The write-back registration deliberately survives: it belongs to the
   * mounted control, not to any request, so a later `start` on the same mount
   * must still be able to write through it.
   */
  const drop = (record: SessionRecord): void => {
    record.controller?.abort()
    record.controller = undefined
    record.observed = { ...UNOBSERVED }
  }

  const start: TunerStore['start'] = (sessionId, draft) => {
    const record = ensure(sessionId)
    // The control maps a press while running to `cancel`; a second start can
    // only be a stale event, and replacing the live request would strand it.
    if (record.snapshot.phase === 'running') return
    if (draft.trim() === '') return

    const controller = new AbortController()
    record.controller = controller
    record.observed = { ...UNOBSERVED }
    publish(record, { phase: 'running', original: draft, enhanced: '', failure: undefined })

    request<RewriteResponse>('/rewrite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: draft }),
      signal: controller.signal,
    }).then(
      (body) => {
        // A cancel or a newer run already took this Session over: its
        // outcome is no longer the current one, and it must not be applied.
        if (controller.signal.aborted || record.controller !== controller) return
        const text = typeof body.text === 'string' ? body.text : ''
        if (text.trim() === '') {
          finish(record, controller, {
            phase: 'failed',
            original: draft,
            enhanced: '',
            failure: new Error('模型没有返回可用内容'),
          })
          return
        }
        // Write through the composer registered right now. The one that pressed
        // the button may be long gone: the harness tore its input shell down on
        // switch-away, so a write captured then would vanish into a disposed
        // editor. With nothing registered the write is simply skipped — the
        // control re-applies the stored rewrite once the Session remounts.
        if (record.write !== undefined) {
          try {
            record.write(text)
          } catch (error) {
            // The composer can still refuse (a shell dying between the check
            // and the call); reporting beats throwing into a promise.
            finish(record, controller, { phase: 'failed', original: draft, enhanced: '', failure: error })
            return
          }
        }
        finish(record, controller, { phase: 'done', original: draft, enhanced: text, failure: undefined })
      },
      (error: unknown) => {
        // Cancelling is not a failure: the user withdrew the request.
        if (controller.signal.aborted || record.controller !== controller) return
        finish(record, controller, { phase: 'failed', original: draft, enhanced: '', failure: error })
      },
    )
  }

  /** Publish a settled state and release the request, if it is still ours. */
  const finish = (record: SessionRecord, controller: AbortController, next: TunerSnapshot): void => {
    if (record.controller !== controller) return
    record.controller = undefined
    publish(record, next)
  }

  const cancel: TunerStore['cancel'] = (sessionId) => {
    const record = records.get(sessionId)
    if (record === undefined) return
    if (record.snapshot.phase !== 'running') return
    drop(record)
    publish(record, IDLE)
  }

  const reset: TunerStore['reset'] = (sessionId) => {
    const record = records.get(sessionId)
    if (record === undefined) return
    drop(record)
    if (record.snapshot.phase === 'idle') return
    publish(record, IDLE)
  }

  return {
    subscribe(sessionId, listener) {
      const record = ensure(sessionId)
      record.touchedAt = now()
      record.listeners.add(listener)
      return () => {
        record.listeners.delete(listener)
      }
    },
    getSnapshot(sessionId) {
      // Deliberately free of bookkeeping writes: React calls this during
      // render, and the only thing protecting a viewed Session from eviction
      // is its listener, which `subscribe` already registers.
      return records.get(sessionId)?.snapshot ?? IDLE
    },
    observe(sessionId) {
      return records.get(sessionId)?.observed ?? UNOBSERVED
    },
    note(sessionId, patch) {
      const record = records.get(sessionId)
      if (record === undefined) return
      record.observed = { ...record.observed, ...patch }
    },
    attach(sessionId, write) {
      const record = ensure(sessionId)
      record.touchedAt = now()
      record.write = write
      return () => {
        // Identity-guarded, like the harness's own `bindDraftPersistence`: a
        // re-render or StrictMode remount must not detach a newer control's
        // registration.
        if (record.write === write) record.write = undefined
      }
    },
    start,
    cancel,
    reset,
    dispose() {
      for (const record of records.values()) drop(record)
      records.clear()
    },
  }
}
