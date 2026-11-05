/**
 * Composer control: rewrite the draft, then offer the original back.
 *
 * State machine, per mount:
 * - `idle` → press starts a rewrite
 * - `running` → press cancels (a spinner that cannot be stopped is a trap)
 * - `done` → press restores the original draft
 * - `failed` → press retries; editing the draft clears the failure
 *
 * Rewrites are bound to this control's lifetime: unmounting aborts the
 * in-flight request so a closed composer does not keep spending tokens.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { request } from '../api.ts'
import { conciseError } from '../errors.ts'
import { IconSpinner, IconSparkle, IconUndo } from '../icons/index.tsx'
import type { ComposerSlotProps, RewriteResponse } from '../types.ts'
import { classNames } from '../class-names.ts'
import css from './TunerButton.module.css'

/** How the control is currently presenting itself. */
type Phase = 'idle' | 'running' | 'done' | 'failed'

/** The request handle this control holds while a rewrite is live. */
interface Inflight {
  abort(): void
}

/**
 * Render the composer control, or nothing when the slot withheld its data.
 * @param props - standard slot props.
 */
export function TunerButton(props: ComposerSlotProps): ReactElement | null {
  const { useInput, inputActions } = props
  // A slot mounted without these cannot show a draft or write one back; the
  // hooks below must still run unconditionally, so the split happens here.
  if (useInput === undefined || inputActions === undefined) return null
  return <TunerControl useInput={useInput} inputActions={inputActions} t={props.t} />
}

/**
 * The control proper.
 * @param props - the slot props with its required members narrowed.
 */
function TunerControl({
  useInput,
  inputActions,
  t,
}: ComposerSlotProps & {
  readonly useInput: NonNullable<ComposerSlotProps['useInput']>
  readonly inputActions: NonNullable<ComposerSlotProps['inputActions']>
}): ReactElement {
  const draft = useInput((state) => state.draft)
  const phase = useInput((state) => state.phase)
  const [local, setLocal] = useState<Phase>('idle')
  const [original, setOriginal] = useState('')
  const [enhanced, setEnhanced] = useState('')
  const [message, setMessage] = useState('')
  const [hover, setHover] = useState(false)
  const seenEnhanced = useRef(false)
  const inflight = useRef<Inflight | undefined>(undefined)

  // A hand-edited draft after a rewrite ends the restore offer. The published
  // draft can trail our own setDraft, so cancel only once the rewritten text
  // has actually been observed in the composer.
  useEffect(() => {
    if (local !== 'done') {
      seenEnhanced.current = false
      return
    }
    if (draft === enhanced) {
      seenEnhanced.current = true
      return
    }
    if (!seenEnhanced.current) return
    setLocal('idle')
  }, [draft, enhanced, local])

  // Editing the draft retires a failure: the red icon describes the last
  // attempt, not the text now in the composer.
  const failedDraft = useRef('')
  useEffect(() => {
    if (local !== 'failed') {
      failedDraft.current = ''
      return
    }
    if (failedDraft.current === '') {
      failedDraft.current = draft
      return
    }
    if (draft === failedDraft.current) return
    failedDraft.current = ''
    setLocal('idle')
    setMessage('')
  }, [draft, local])

  // A cancelled request must not outlive the control.
  useEffect(
    () => () => {
      inflight.current?.abort()
      inflight.current = undefined
    },
    [],
  )

  const busy = local === 'running'
  const editing = phase === 'submitting' || phase === 'adjudicating'
  const ready = typeof draft === 'string' && draft.trim() !== ''

  const run = useCallback(async () => {
    if (editing) return
    if (local === 'running') {
      inflight.current?.abort()
      inflight.current = undefined
      setLocal('idle')
      setMessage('')
      return
    }
    if (local === 'done') {
      inputActions.setDraft(original)
      setLocal('idle')
      return
    }
    const source = draft
    if (typeof source !== 'string' || source.trim() === '') return
    setMessage('')
    setLocal('running')
    const controller = new AbortController()
    inflight.current = controller
    try {
      const body = await request<RewriteResponse>('/rewrite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: source }),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (typeof body.text !== 'string' || body.text.trim() === '') throw new Error('模型没有返回可用内容')
      inputActions.setDraft(body.text)
      setOriginal(source)
      setEnhanced(body.text)
      setLocal('done')
    } catch (error) {
      // Cancelling is not a failure: the user withdrew the request.
      if (controller.signal.aborted) return
      setLocal('failed')
      setMessage(conciseError(error, t))
      console.error('[prompt-tuner] rewrite failed:', error)
    } finally {
      if (inflight.current === controller) inflight.current = undefined
    }
  }, [draft, editing, inputActions, local, original, t])

  const hint = message !== '' ? message : busy ? t('running') : local === 'done' ? t('restore') : t('enhance')
  const failed = local === 'failed'

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
        onClick={() => {
          void run()
        }}
        onMouseEnter={() => {
          setHover(true)
        }}
        onMouseLeave={() => {
          setHover(false)
        }}
        onFocus={() => {
          setHover(true)
        }}
        onBlur={() => {
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
