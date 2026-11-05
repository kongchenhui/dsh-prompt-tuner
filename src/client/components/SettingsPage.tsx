/**
 * Settings page: the one rewriting prompt, the model pair, and the file that
 * holds them.
 *
 * Edits live in a local override that is folded over the durable snapshot
 * during render, so the page never has to mirror store state into component
 * state through an effect — the only state here is the user's unsaved delta.
 * A model-catalog failure degrades to an empty picker rather than blocking the
 * page, because "follow the conversation" still works with no catalog at all.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { request } from '../api.ts'
import type {
  CatalogProvider,
  ConfigResponse,
  ModelsResponse,
  ModelChoice,
  Settings,
  SettingsSlotProps,
} from '../types.ts'
import type { SettingsSnapshot, SettingsStore } from '../settings-store.ts'
import { ModelPicker } from './ModelPicker.tsx'
import { classNames } from '../class-names.ts'
import css from './SettingsPage.module.css'

/** Props of {@link SettingsPage}. */
export interface SettingsPageProps extends SettingsSlotProps {
  readonly store: SettingsStore
  readonly snapshot: SettingsSnapshot | undefined
}

/** Progress line shown next to the buttons. */
type Status = '' | 'saving' | 'saved' | 'opened' | 'dirty' | `error:${string}`

/** One labelled control row. */
function Row({
  label,
  hint,
  className,
  children,
}: {
  readonly label: string
  readonly hint?: string | undefined
  readonly className?: string | undefined
  readonly children: ReactNode
}): ReactElement {
  return (
    <div className={classNames(css.row, className)}>
      <div className={css.rowLabel}>
        {label}
        {hint === undefined ? null : <span className={css.rowHint}>{hint}</span>}
      </div>
      <div className={css.rowControl}>{children}</div>
    </div>
  )
}

/**
 * Render the settings page.
 * @param props - translator, the shared store, and its current snapshot.
 */
export function SettingsPage({ t, store, snapshot }: SettingsPageProps): ReactElement {
  /** The unsaved delta only; durable values come from the snapshot during render. */
  const [override, setOverride] = useState<Partial<Settings>>({})
  const [status, setStatus] = useState<Status>('')
  const [catalog, setCatalog] = useState<readonly CatalogProvider[]>([])

  useEffect(() => {
    let live = true
    void request<ModelsResponse>('/models')
      .then((body) => {
        if (live) setCatalog(Array.isArray(body.providers) ? body.providers : [])
      })
      .catch(() => {
        if (live) setCatalog([])
      })
    return () => {
      live = false
    }
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    setStatus('dirty')
    setOverride((current) => ({ ...current, ...patch }))
  }, [])

  if (snapshot === undefined) {
    return (
      <div className={css.page}>
        <p className={css.muted}>
          {store.getError() === undefined ? t('loading') : `${t('loadFailed')}：${store.getError() ?? ''}`}
        </p>
      </div>
    )
  }

  const value: Settings = { ...snapshot.settings, ...override }
  const busy = status === 'saving'

  const save = async (): Promise<void> => {
    setStatus('saving')
    try {
      await store.save({
        prompt: value.prompt,
        model: value.model,
        maxOutputTokens: value.maxOutputTokens,
      })
      // The host projects what it stored (clamping tokens, dropping a
      // half-filled model pair), so hand control back to the snapshot.
      setOverride({})
      setStatus('saved')
    } catch (error) {
      setStatus(`error:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const restoreDefault = (): void => {
    update({ prompt: snapshot.defaults.prompt })
  }

  const statusText =
    status === 'saved'
      ? t('saved')
      : status === 'opened'
        ? t('fileOpened')
        : status === 'dirty'
          ? t('unsaved')
          : status.startsWith('error:')
            ? `${t('saveFailed')}：${status.slice(6)}`
            : ''

  const openFile = async (): Promise<void> => {
    try {
      await request<ConfigResponse>('/open', { method: 'POST' })
      setStatus('opened')
    } catch (error) {
      setStatus(`error:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div className={css.page}>
      <Row label={t('promptLabel')}>
        <textarea
          className={classNames(css.input, css.textarea)}
          rows={8}
          spellCheck={false}
          value={value.prompt}
          onChange={(event) => {
            update({ prompt: event.currentTarget.value })
          }}
        />
      </Row>
      <div className={css.grid}>
        <Row className={css.cell} label={t('modelLabel')} hint={t('modelHint')}>
          <ModelPicker
            t={t}
            value={value.model}
            catalog={catalog}
            onChange={(next: ModelChoice) => {
              update({ model: next })
            }}
          />
        </Row>
        <Row className={css.cell} label={t('tokensLabel')} hint={t('tokensHint')}>
          <input
            className={css.input}
            type="number"
            min={1}
            max={2048}
            step={1}
            value={value.maxOutputTokens}
            onChange={(event) => {
              update({ maxOutputTokens: Number(event.currentTarget.value) })
            }}
          />
        </Row>
      </div>
      <div className={css.actions}>
        <button
          type="button"
          className={classNames(css.button, css.buttonPrimary)}
          disabled={busy}
          onClick={() => {
            void save()
          }}
        >
          {busy ? t('saving') : t('save')}
        </button>
        <button type="button" className={css.button} onClick={restoreDefault}>
          {t('restoreDefault')}
        </button>
        {statusText === '' ? null : <span className={css.status}>{statusText}</span>}
      </div>
      <p className={css.file}>
        <span className={css.fileLabel}>{t('fileLabel')}</span>
        <button
          type="button"
          className={css.fileLink}
          title={t('fileOpenHint')}
          onClick={() => {
            void openFile()
          }}
        >
          {snapshot.settingsPath}
        </button>
      </p>
    </div>
  )
}
