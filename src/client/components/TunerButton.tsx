/**
 * Composer control: rewrite the draft, then offer the original back.
 *
 * State machine, per Session (held by the store, not by this component):
 * - `idle` → press starts a rewrite
 * - `running` → press cancels (a spinner that cannot be stopped is a trap)
 * - `done` → press restores the original draft
 * - `failed` → press retries; editing the draft clears the failure
 *
 * The harness remounts a session-scoped slot on every Session switch, so
 * nothing here may own state that must survive one: the phase, the drafts, the
 * failure, and the request itself all live in {@link TunerStore}, keyed by
 * `sessionId`. This component is a view — it subscribes to its own Session and
 * forwards presses. Only `hover` is local, because it is genuinely about this
 * mounted element rather than about the Session.
 */ import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { conciseError } from '../errors.ts'
import { IconSpinner, IconSparkle, IconUndo } from '../icons/index.tsx'
import type { ComposerSlotProps } from '../types.ts'
import type { TunerSnapshot, TunerStore } from '../tuner-store.ts'
import { classNames } from '../class-names.ts'
import css from './TunerButton.module.css'

/** Props of {@link TunerButton}. */
export interface TunerButtonProps extends ComposerSlotProps {
  readonly store: TunerStore
}

/**
 * Render the composer control, or nothing when the slot withheld its data.
 * @param props - standard slot props plus the plugin's Session store.
 */
export function TunerButton(props: TunerButtonProps): ReactElement | null {
  const { useInput, inputActions, sessionId, store, t } = props
  // A slot mounted without these cannot show a draft or write one back, and
  // without a Session there is no partition to read; the hooks below must
  // still run unconditionally, so the split happens here.
  if (useInput === undefined || inputActions === undefined || sessionId === undefined) return null
  return <TunerControl useInput={useInput} inputActions={inputActions} sessionId={sessionId} store={store} t={t} />
}

/**
 * The control proper.
 * @param props - the slot props with its required members narrowed.
 */
function TunerControl({
  useInput,
  inputActions,
  sessionId,
  store,
  t,
}: TunerButtonProps & {
  readonly useInput: NonNullable<ComposerSlotProps['useInput']>
  readonly inputActions: NonNullable<ComposerSlotProps['inputActions']>
  readonly sessionId: string
}): ReactElement {
  const draft = useInput((state) => state.draft)
  const phase = useInput((state) => state.phase)
  const [hover, setHover] = useState(false)

  const subscribe = useCallback((listener: () => void) => store.subscribe(sessionId, listener), [sessionId, store])
  const snapshot = useSyncExternalStore<TunerSnapshot>(
    subscribe,
    () => store.getSnapshot(sessionId),
    () => store.getSnapshot(sessionId),
  )
  const local = snapshot.phase

  // Register this mount's composer as the Session's write-back target. The
  // harness binds `inputActions` to a per-Session input shell that is torn
  // down and replaced across a switch, so the registration must follow the
  // mount: a rewrite resolving after a switch-back has to write through the
  // control that is mounted now, never the one that pressed the button.
  useEffect(() => {
    const detach = store.attach(sessionId, (text) => {
      inputActions.setDraft(text)
    })
    return detach
  }, [inputActions, sessionId, store])

  // A hand-edited draft after a rewrite ends the restore offer. The published
  // draft can trail our own setDraft, so cancel only once the rewritten text
  // has actually been observed in the composer.
  //
  // The other half: a rewrite that settled before this mount registered its
  // composer — it resolved while the Session was away, or into the previous
  // shell — never reached the composer, which still shows the pre-rewrite
  // text. While the composer holds exactly the text the rewrite started from,
  // apply the stored rewrite once; re-applying the same text is idempotent
  // (the harness's editor no-ops on identical drafts). Anything else there is
  // a real edit, which wins.
  useEffect(() => {
    if (local !== 'done') {
      store.note(sessionId, { enhancedSeen: false })
      return
    }
    if (draft === snapshot.enhanced) {
      store.note(sessionId, { enhancedSeen: true })
      return
    }
    if (!store.observe(sessionId).enhancedSeen && draft === snapshot.original) {
      inputActions.setDraft(snapshot.enhanced)
      return
    }
    // The composer holds neither text, so the user edited it: the restore
    // offer describes a draft that no longer exists, and offering to overwrite
    // their work would be a trap.
    store.reset(sessionId)
  }, [draft, inputActions, local, sessionId, snapshot.enhanced, snapshot.original, store])

  // Editing the draft while a rewrite is running cancels it. The request was
  // built on the pre-edit text, so its result is obsolete the moment the user
  // types — dropping it silently would also clobber nothing yet, but the
  // tokens are still being spent on an answer nobody can use. Aborting is the
  // explicit gesture (the same one a press performs), just automated.
  useEffect(() => {
    if (local !== 'running') return
    if (draft !== snapshot.original) store.cancel(sessionId)
  }, [draft, local, sessionId, snapshot.original, store])

  // Editing the draft retires a failure: the red icon describes the last
  // attempt, not the text now in the composer.
  useEffect(() => {
    if (local !== 'failed') {
      store.note(sessionId, { failureBaseline: undefined })
      return
    }
    const baseline = store.observe(sessionId).failureBaseline
    if (baseline === undefined) {
      store.note(sessionId, { failureBaseline: draft })
      return
    }
    if (draft === baseline) return
    store.note(sessionId, { failureBaseline: undefined })
    store.reset(sessionId)
  }, [draft, local, sessionId, store])

  const busy = local === 'running'
  const editing = phase === 'submitting' || phase === 'adjudicating'
  const ready = typeof draft === 'string' && draft.trim() !== ''

  const run = useCallback(() => {
    if (editing) return
    if (local === 'running') {
      store.cancel(sessionId)
      return
    }
    if (local === 'done') {
      inputActions.setDraft(snapshot.original)
      store.reset(sessionId)
      return
    }
    const source = draft
    if (typeof source !== 'string' || source.trim() === '') return
    // The write-back target is resolved at resolution time from whatever this
    // Session has mounted, so a rewrite that lands after a switch still
    // updates the Session that started it.
    store.start(sessionId, source)
  }, [draft, editing, inputActions, local, sessionId, snapshot.original, store])

  const failed = local === 'failed'
  const message = failed && snapshot.failure !== undefined ? conciseError(snapshot.failure, t) : ''
  const hint = message !== '' ? message : busy ? t('running') : local === 'done' ? t('restore') : t('enhance')

  const className = classNames(
    css.icon,
    local === 'done' ? css.iconDone : undefined,
    failed ? css.iconFailed : undefined,
  )

  return (
    <span className={css.anchor}>
      <button
        type="button"
        className={className}
        // Clickable while running, so the press cancels. `disabled` stays for
        // genuinely inert states only: a disabled button receives no pointer
        // events, which would hide its hover hint too.
        disabled={editing || (!ready && local !== 'done' && !busy)}
        aria-label={hint}
        aria-busy={busy}
        data-state={local}
        onClick={run}
        onMouseEnter={() => {
          setHover(true)
        }}
        onMouseLeave={() => {
          setHover(false)
        }}
      >
        {busy ? <IconSpinner className={css.spin} /> : local === 'done' ? <IconUndo /> : <IconSparkle />}
      </button>
      {hover ? (
        <span className={classNames(css.tip, failed ? css.tipError : undefined)} role="tooltip">
          {hint}
        </span>
      ) : null}
    </span>
  )
}
