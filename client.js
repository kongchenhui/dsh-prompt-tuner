/**
 * Browser half of the composer prompt tuner.
 *
 * Registers two surfaces: a control in the composer row that rewrites the
 * current draft through the host half's model call, and a settings page with
 * one editable prompt and a model picker. Both read and write one host route;
 * nothing here imports a harness client package.
 */
window.__ModuleLoader__.load({
  id: '@kongchenhui/dsh-prompt-tuner',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'prompt-tuner'
    /** Cell key shared by both registrations; also the section id. */
    const ID = 'prompt-tuner'
    const ROUTE_SEGMENT = '/dsh-prompt-tuner'

    /** Mount prefix, so the app works when served under a sub-path. */
    function routeBase() {
      try {
        const url = new URL(document.baseURI)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return ROUTE_SEGMENT
        return url.pathname.replace(/\/+$/u, '') + ROUTE_SEGMENT
      } catch {
        return ROUTE_SEGMENT
      }
    }

    async function request(path, init) {
      const response = await fetch(routeBase() + path, init)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (body === null || typeof body !== 'object') throw new Error('响应格式错误')
      if (body.ok !== true) throw new Error(typeof body.message === 'string' ? body.message : '请求失败')
      return body
    }

    /* -------------------------------------------------------- settings -- */

    /** One shared settings snapshot; the settings page is the only reader. */
    const settingsStore = {
      snapshot: undefined,
      error: undefined,
      inflight: undefined,
      listeners: new Set(),
      emit() {
        for (const listener of this.listeners) listener()
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
      getSnapshot() {
        return this.snapshot
      },
      ensure() {
        if (this.inflight !== undefined) return this.inflight
        this.inflight = request('/config')
          .then((body) => {
            this.snapshot = {
              settings: body.settings,
              defaults: body.defaults,
              settingsPath: body.settingsPath,
            }
            this.error = undefined
          })
          .catch((error) => {
            this.error = error instanceof Error ? error.message : String(error)
          })
          .finally(() => {
            this.inflight = undefined
            this.emit()
          })
        return this.inflight
      },
      async save(patch) {
        const body = await request('/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
        this.snapshot = { ...(this.snapshot ?? {}), settings: body.settings }
        this.error = undefined
        this.emit()
        return body.settings
      },
    }

    const subscribeSettings = (listener) => settingsStore.subscribe(listener)
    const snapshotSettings = () => settingsStore.getSnapshot()

    function useSettingsSnapshot() {
      const snapshot = useSyncExternalStore(subscribeSettings, snapshotSettings, snapshotSettings)
      useEffect(() => {
        settingsStore.ensure()
      }, [])
      return snapshot
    }

    /* ------------------------------------------------------------ icons -- */

    function IconSparkle() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M7.2 2.1l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M12.3 9.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z', fill: 'currentColor' }),
      )
    }

    function IconUndo() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M5.6 3.6L2.9 6.3l2.7 2.7',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M3 6.3h6.1a3.4 3.4 0 010 6.8H6.3',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    function IconSpinner() {
      return h(
        'svg',
        { className: 'dpt-spin', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 5.6, stroke: 'currentColor', strokeWidth: 1.4, opacity: 0.25 }),
        h('path', {
          d: 'M8 2.4a5.6 5.6 0 015.6 5.6',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    /** Longest error text kept for the tooltip; provider errors can be whole JSON bodies. */
    const ERROR_MAX_CHARS = 160

    /**
     * Collapse one failure into a single short line.
     *
     * Provider rejections arrive as raw JSON documents (`401 {"type":"error",…}`);
     * the tooltip is a one-line hint, not a log viewer, so a recognizable status
     * prefix is named in the user's language and the payload is flattened and
     * truncated. The full text always goes to the console.
     * @param error - whatever the request or the host threw.
     * @param t - namespace-bound translator.
     * @returns one trimmed line, at most {@link ERROR_MAX_CHARS} characters.
     */
    function conciseError(error, t) {
      const raw = error instanceof Error ? error.message : String(error)
      const text = raw.replace(/\s+/gu, ' ').trim()
      const status = /^(\d{3})\b/u.exec(text)?.[1]
      const named =
        status === '401' || status === '403'
          ? t('errorAuth')
          : status === '429'
            ? t('errorRateLimited')
            : status !== undefined && Number(status) >= 500
              ? t('errorUpstream')
              : undefined
      const body = named === undefined ? text : `${named} · ${text}`
      return body.length <= ERROR_MAX_CHARS ? body : `${body.slice(0, ERROR_MAX_CHARS - 1)}…`
    }

    /* --------------------------------------------------------- composer -- */

    /**
     * Composer control: rewrite the draft, then offer the original back.
     * @param props - slot standard props (`useInput`, `inputActions`, `t`).
     */
    function PromptTunerButton(props) {
      if (props.useInput === undefined || props.inputActions === undefined) return null
      return h(PromptTunerControl, props)
    }

    /**
     * The control itself, with Hooks called unconditionally.
     * @param props - slot standard props (`useInput`, `inputActions`, `t`).
     */
    function PromptTunerControl(props) {
      const { useInput, inputActions, t } = props
      const draft = useInput((state) => state.draft)
      const phase = useInput((state) => state.phase)
      const [phaseLocal, setPhaseLocal] = useState('idle')
      const [original, setOriginal] = useState('')
      const [enhanced, setEnhanced] = useState('')
      const [message, setMessage] = useState('')
      const [hover, setHover] = useState(false)
      const seenEnhanced = useRef(false)

      // A hand-edited draft after a rewrite ends the restore offer. The
      // published draft can trail our own `setDraft`, so cancel only once the
      // rewritten text has actually been observed in the composer.
      useEffect(() => {
        if (phaseLocal !== 'done') {
          seenEnhanced.current = false
          return
        }
        if (draft === enhanced) {
          seenEnhanced.current = true
          return
        }
        if (!seenEnhanced.current) return
        setPhaseLocal('idle')
      }, [draft, enhanced, phaseLocal])

      // Editing the draft retires a failure: the red icon describes the last
      // attempt, not the text now in the composer.
      const failedDraft = useRef('')
      useEffect(() => {
        if (phaseLocal !== 'failed') {
          failedDraft.current = ''
          return
        }
        if (failedDraft.current === '') {
          failedDraft.current = draft
          return
        }
        if (draft === failedDraft.current) return
        failedDraft.current = ''
        setPhaseLocal('idle')
        setMessage('')
      }, [draft, phaseLocal])

      const busy = phaseLocal === 'running'
      const editing = phase === 'submitting' || phase === 'adjudicating'
      const ready = typeof draft === 'string' && draft.trim() !== ''
      /** In-flight rewrite, so a second press can cancel it. */
      const inflight = useRef(undefined)

      // A cancelled request must not outlive the control.
      useEffect(
        () => () => {
          inflight.current?.abort()
          inflight.current = undefined
        },
        [],
      )

      const run = useCallback(async () => {
        if (editing) return
        // While running the same press cancels: the spinner reads as "working",
        // and work that cannot be stopped is a trap.
        if (phaseLocal === 'running') {
          inflight.current?.abort()
          inflight.current = undefined
          setPhaseLocal('idle')
          setMessage('')
          return
        }
        if (phaseLocal === 'done') {
          inputActions.setDraft(original)
          setPhaseLocal('idle')
          return
        }
        const source = draft
        if (typeof source !== 'string' || source.trim() === '') return
        setMessage('')
        setPhaseLocal('running')
        const controller = new AbortController()
        inflight.current = controller
        try {
          const body = await request('/rewrite', {
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
          setPhaseLocal('done')
        } catch (error) {
          // Cancelling is not a failure: the user withdrew the request.
          if (controller.signal.aborted) return
          setPhaseLocal('failed')
          setMessage(conciseError(error, t))
          console.error('[prompt-tuner] rewrite failed:', error)
        } finally {
          if (inflight.current === controller) inflight.current = undefined
        }
      }, [draft, editing, inputActions, original, phaseLocal, t])

      const hint =
        message !== ''
          ? message
          : busy
            ? t('running')
            : phaseLocal === 'done'
              ? t('restore')
              : t('enhance')
      const failed = phaseLocal === 'failed'
      // Hover-only in every state, running included: the spinner and the red
      // icon already carry the state, so nothing is pinned to the composer row.
      const showTip = hover

      return h(
        'span',
        { className: 'dpt-anchor' },
        h(
          'button',
          {
            type: 'button',
            className: `dpt-icon${phaseLocal === 'done' ? ' dpt-icon-done' : ''}${failed ? ' dpt-icon-failed' : ''}`,
            // Clickable while running, so the press cancels. `disabled` is kept
            // for genuinely inert states only: a disabled button receives no
            // pointer events, which would hide its hover hint too.
            disabled: editing || (!ready && phaseLocal !== 'done' && !busy),
            'aria-label': hint,
            'aria-busy': busy,
            'data-state': phaseLocal,
            onClick: run,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            onFocus: () => setHover(true),
            onBlur: () => setHover(false),
          },
          busy ? h(IconSpinner) : phaseLocal === 'done' ? h(IconUndo) : h(IconSparkle),
        ),
        showTip
          ? h('span', { className: `dpt-tip${failed ? ' dpt-tip-error' : ''}`, role: 'tooltip' }, hint)
          : null,
      )
    }

    /* ----------------------------------------------------- model picker -- */

    /** Flatten the catalog into rows: the follow entry, then one group per provider. */
    function buildRows(groups, query) {
      const needle = query.trim().toLowerCase()
      const rows = []
      if (needle === '') rows.push({ kind: 'follow', key: '__follow' })
      for (const group of groups) {
        const matched = group.models.filter(
          (model) => needle === '' || `${model.name} ${model.id}`.toLowerCase().includes(needle),
        )
        if (matched.length === 0 && needle !== '') continue
        rows.push({ kind: 'group', key: group.id, name: group.name })
        for (const model of matched) {
          rows.push({ kind: 'model', key: `${group.id}/${model.id}`, provider: group.id, model })
        }
      }
      return rows
    }

    /** Rows a keyboard user can land on: everything but a provider heading. */
    function selectable(rows) {
      return rows.map((row, index) => (row.kind === 'group' ? -1 : index)).filter((index) => index >= 0)
    }

    /**
     * Model picker shaped like the one in dsh-pet: a trigger showing the current
     * pair, and a searchable grouped panel whose first row follows the session.
     * @param props - value pair, catalog, and change callback.
     */
    function ModelPicker(props) {
      const { t, value, catalog, onChange } = props
      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [active, setActive] = useState(0)
      const rootRef = useRef(null)
      const panelRef = useRef(null)

      const groups = catalog ?? []
      const follow = value.provider === ''
      const group = groups.find((item) => item.id === value.provider)
      const picked = group?.models.find((item) => item.id === value.model)
      const rows = buildRows(groups, query)
      const slots = selectable(rows)

      const commit = (next) => {
        onChange(next)
        setOpen(false)
        setQuery('')
      }

      const pick = (row) => {
        if (row === undefined) return
        if (row.kind === 'follow') commit({ provider: '', model: '' })
        else if (row.kind === 'model') commit({ provider: row.provider, model: row.model.id })
      }

      const step = (direction) => {
        if (slots.length === 0) return
        const at = slots.indexOf(active)
        const next = slots[at < 0 ? 0 : (at + direction + slots.length) % slots.length]
        setActive(next)
        panelRef.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: 'nearest' })
      }

      useEffect(() => {
        if (!open) return undefined
        panelRef.current?.querySelector('input')?.focus()
        const onPointerDown = (event) => {
          const target = event.target
          if (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open])

      const toggle = () => {
        if (!open) {
          setQuery('')
          const at = rows.findIndex(
            (row) => row.kind === 'model' && row.provider === value.provider && row.model.id === value.model,
          )
          setActive(at >= 0 ? at : 0)
        }
        setOpen(!open)
      }

      const label = follow ? t('modelFollow') : (picked?.name ?? value.model)
      const sub = follow ? '' : (group?.name ?? value.provider)

      return h(
        'div',
        { className: 'dpt-mp', ref: rootRef },
        h(
          'button',
          {
            type: 'button',
            className: 'dpt-mp-trigger',
            'aria-haspopup': 'listbox',
            'aria-expanded': open,
            'aria-label': t('modelAria', { model: label }),
            onClick: toggle,
          },
          h('span', { className: 'dpt-mp-label' }, label),
          sub === '' ? null : h('span', { className: 'dpt-mp-sub' }, sub),
          h('span', { className: `dpt-mp-chevron${open ? ' is-open' : ''}` }, '▾'),
        ),
        open
          ? h(
              'div',
              { className: 'dpt-mp-panel', ref: panelRef, role: 'listbox', 'aria-label': t('modelLabel') },
              h('input', {
                className: 'dpt-mp-search',
                type: 'text',
                spellCheck: false,
                placeholder: t('modelSearch'),
                value: query,
                onChange: (event) => {
                  setQuery(event.currentTarget.value)
                  setActive(0)
                },
                onKeyDown: (event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    step(1)
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    step(-1)
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    pick(rows[active])
                  }
                },
              }),
              rows.length === 0
                ? h('p', { className: 'dpt-mp-empty' }, t('modelEmpty'))
                : h(
                    'div',
                    { className: 'dpt-mp-rows' },
                    rows.map((row, index) => {
                      if (row.kind === 'group') {
                        return h('div', { key: row.key, className: 'dpt-mp-group' }, row.name)
                      }
                      const selected =
                        row.kind === 'follow'
                          ? follow
                          : row.provider === value.provider && row.model.id === value.model
                      return h(
                        'button',
                        {
                          key: row.key,
                          type: 'button',
                          'data-row': index,
                          role: 'option',
                          'aria-selected': selected,
                          className: `dpt-mp-row${selected ? ' is-selected' : ''}${active === index ? ' is-active' : ''}`,
                          onMouseEnter: () => setActive(index),
                          onClick: () => pick(row),
                        },
                        row.kind === 'follow' ? t('modelFollow') : row.model.name,
                      )
                    }),
                  ),
            )
          : null,
      )
    }

    /* --------------------------------------------------------- settings -- */

    function Row(props) {
      return h(
        'div',
        { className: `dpt-row${props.className === undefined ? '' : ` ${props.className}`}` },
        h(
          'div',
          { className: 'dpt-row-label' },
          props.label,
          props.hint === undefined ? null : h('span', { className: 'dpt-row-hint' }, props.hint),
        ),
        h('div', { className: 'dpt-row-control' }, props.children),
      )
    }

    /**
     * Settings page: the one rewriting prompt, the model pair, and the file
     * that holds them.
     * @param props - settings section props (`t`, `close`).
     */
    function PromptTunerSettings(props) {
      const { t } = props
      const snapshot = useSettingsSnapshot()
      const [draft, setDraft] = useState(undefined)
      const [status, setStatus] = useState('')
      const [catalog, setCatalog] = useState(undefined)

      useEffect(() => {
        if (snapshot === undefined) return
        setDraft((current) => current ?? { ...snapshot.settings })
      }, [snapshot])

      useEffect(() => {
        let live = true
        request('/models')
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

      const update = useCallback((patch) => {
        setStatus('dirty')
        setDraft((current) => ({ ...(current ?? {}), ...patch }))
      }, [])

      const save = useCallback(async () => {
        if (draft === undefined) return
        setStatus('saving')
        try {
          await settingsStore.save({
            prompt: draft.prompt,
            model: draft.model,
            maxOutputTokens: draft.maxOutputTokens,
          })
          setStatus('saved')
        } catch (error) {
          setStatus(`error:${error instanceof Error ? error.message : String(error)}`)
        }
      }, [draft])

      const restoreDefault = useCallback(() => {
        if (snapshot === undefined) return
        setStatus('dirty')
        setDraft((current) => ({ ...(current ?? {}), prompt: snapshot.defaults.prompt }))
      }, [snapshot])

      if (snapshot === undefined) {
        return h(
          'div',
          { className: 'dpt-page' },
          h(
            'p',
            { className: 'dpt-muted' },
            settingsStore.error === undefined ? t('loading') : `${t('loadFailed')}：${settingsStore.error}`,
          ),
        )
      }

      const value = draft ?? snapshot.settings
      const busy = status === 'saving'
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

      return h(
        'div',
        { className: 'dpt-page' },
        h(
          Row,
          { label: t('promptLabel') },
          h('textarea', {
            className: 'dpt-input dpt-textarea',
            rows: 8,
            spellCheck: false,
            value: value.prompt ?? '',
            onChange: (event) => update({ prompt: event.currentTarget.value }),
          }),
        ),
        h(
          'div',
          { className: 'dpt-grid' },
          h(
            Row,
            { className: 'dpt-cell', label: t('modelLabel'), hint: t('modelHint') },
            h(ModelPicker, {
              t,
              value: value.model ?? { provider: '', model: '' },
              catalog,
              onChange: (next) => update({ model: next }),
            }),
          ),
          h(
            Row,
            { className: 'dpt-cell', label: t('tokensLabel'), hint: t('tokensHint') },
            h('input', {
              className: 'dpt-input',
              type: 'number',
              min: 1,
              max: 2048,
              step: 1,
              value: Number(value.maxOutputTokens ?? 1024),
              onChange: (event) => update({ maxOutputTokens: Number(event.currentTarget.value) }),
            }),
          ),
        ),
        h(
          'div',
          { className: 'dpt-actions' },
          h(
            'button',
            { type: 'button', className: 'dpt-button dpt-button-primary', disabled: busy, onClick: save },
            busy ? t('saving') : t('save'),
          ),
          h('button', { type: 'button', className: 'dpt-button', onClick: restoreDefault }, t('restoreDefault')),
          statusText === '' ? null : h('span', { className: 'dpt-status' }, statusText),
        ),
        h(
          'p',
          { className: 'dpt-file' },
          h('span', { className: 'dpt-file-label' }, t('fileLabel')),
          h(
            'button',
            {
              type: 'button',
              className: 'dpt-file-link',
              title: t('fileOpenHint'),
              onClick: async () => {
                try {
                  await request('/open', { method: 'POST' })
                  setStatus('opened')
                } catch (error) {
                  setStatus(`error:${error instanceof Error ? error.message : String(error)}`)
                }
              },
            },
            snapshot.settingsPath ?? '',
          ),
        ),
      )
    }

    /* ------------------------------------------------------------- css -- */

    const CSS = `
.dpt-anchor{position:relative;display:inline-flex;align-items:center}
.dpt-icon{display:grid;place-items:center;width:28px;height:28px;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color .12s,color .12s}
.dpt-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.dpt-icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dpt-icon:disabled{opacity:.45;cursor:default}
.dpt-icon-done{color:var(--dsw-alias-brand-primary)}
.dpt-icon-failed{color:var(--dsw-alias-state-error-primary)}
.dpt-icon-failed:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dpt-spin{animation:dpt-rotate .9s linear infinite}
@keyframes dpt-rotate{to{transform:rotate(360deg)}}
.dpt-tip{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:20;white-space:nowrap;pointer-events:none;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:3px 8px;font-size:12px;line-height:18px;box-shadow:var(--dsw-elevation-soft)}
.dpt-tip-error{white-space:normal;width:max-content;max-width:280px;text-align:left;color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dpt-page{display:flex;flex-direction:column;gap:12px;padding:4px 0 16px}
.dpt-muted{color:var(--dsw-alias-label-secondary);font-size:13px}
.dpt-row{display:flex;flex-direction:column;gap:6px}
.dpt-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.dpt-cell{min-width:0}
.dpt-row-label{display:flex;align-items:baseline;gap:8px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dpt-row-hint{font-weight:400;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dpt-row-control{display:flex;min-width:0;position:relative}
.dpt-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:20px;padding:6px 8px;outline:none}
.dpt-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dpt-textarea{resize:vertical;min-height:132px}
.dpt-actions{display:flex;align-items:center;gap:8px;padding-top:4px}
.dpt-button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;padding:5px 12px;cursor:pointer}
.dpt-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dpt-button:disabled{opacity:.5;cursor:default}
.dpt-button-primary{border-color:transparent;background:var(--dsw-alias-button-info-fill);color:#fff}
.dpt-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
.dpt-status{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dpt-file{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.dpt-file-label{margin-right:6px}
.dpt-file-link{font-family:var(--dsw-font-family);font-size:12px;line-height:18px;color:var(--dsw-alias-brand-primary);background:transparent;border:none;border-radius:4px;padding:1px 4px;cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:2px;word-break:break-all}
.dpt-file-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dpt-file-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dpt-mp{position:relative;width:100%}
.dpt-mp-trigger{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:20px;padding:5px 8px;cursor:pointer;text-align:left}
.dpt-mp-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dpt-mp-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dpt-mp-label{flex:none;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpt-mp-sub{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dpt-mp-chevron{margin-left:auto;color:var(--dsw-alias-label-secondary);transition:transform .12s}
.dpt-mp-chevron.is-open{transform:rotate(180deg)}
.dpt-mp-panel{position:absolute;top:calc(100% + 4px);left:0;z-index:30;width:100%;max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px;box-shadow:var(--dsw-elevation-soft)}
.dpt-mp-search{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:20px;padding:4px 8px;outline:none}
.dpt-mp-search:focus{border-color:var(--dsw-alias-brand-primary)}
.dpt-mp-empty{margin:4px 2px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dpt-mp-rows{display:flex;flex-direction:column;gap:1px}
.dpt-mp-group{padding:4px 8px;font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.dpt-mp-row{display:block;width:100%;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:20px;padding:4px 8px;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-mp-row.is-active{background:var(--dsw-alias-interactive-bg-hover)}
.dpt-mp-row.is-selected{color:var(--dsw-alias-brand-primary);font-weight:500}
`

    /* ---------------------------------------------------------- locals -- */

    const zh = {
      'meta.title': '提示词优化',
      'meta.description': '在输入框一键优化或纠错提示词，改写用的提示词与模型可自定义。',
      enhance: '增强提示词',
      running: '增强中…',
      restore: '恢复原文',
      errorAuth: '模型认证失败',
      errorRateLimited: '请求过于频繁',
      errorUpstream: '模型服务异常',
      sectionLabel: '提示词优化',
      loading: '正在读取设置…',
      loadFailed: '读取设置失败',
      promptLabel: '优化提示词',
      modelLabel: '模型',
      modelHint: '跟随会话时使用输入框当前选择的模型',
      modelFollow: '跟随当前会话',
      modelSearch: '搜索模型…',
      modelEmpty: '没有匹配的模型',
      modelAria: '当前模型：{model}，点击更换',
      tokensLabel: '最大输出 tokens',
      tokensHint: '上限 2048',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      unsaved: '有未保存的修改',
      saveFailed: '保存失败',
      restoreDefault: '恢复默认提示词',
      fileLabel: '配置文件',
      fileOpenHint: '点击用系统编辑器打开',
      fileOpened: '已在编辑器中打开',
    }

    const en = {
      'meta.title': 'Prompt Tuner',
      'meta.description': 'Rewrite or correct the composer draft in one click, with an editable prompt and model.',
      enhance: 'Enhance prompt',
      running: 'Enhancing…',
      restore: 'Restore original',
      errorAuth: 'Model authentication failed',
      errorRateLimited: 'Rate limited',
      errorUpstream: 'Model service error',
      sectionLabel: 'Prompt Tuner',
      loading: 'Loading settings…',
      loadFailed: 'Could not load settings',
      promptLabel: 'Tuning prompt',
      modelLabel: 'Model',
      modelHint: 'Following the conversation uses the model selected in the composer',
      modelFollow: 'Follow current conversation',
      modelSearch: 'Search models…',
      modelEmpty: 'No matching models',
      modelAria: 'Current model: {model}. Click to change.',
      tokensLabel: 'Max output tokens',
      tokensHint: 'Up to 2048',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      unsaved: 'Unsaved changes',
      saveFailed: 'Save failed',
      restoreDefault: 'Restore default prompt',
      fileLabel: 'Config file',
      fileOpenHint: 'Click to open in your editor',
      fileOpened: 'Opened in your editor',
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'prompt-tuner: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.pluginCss = ID
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'prompt-tuner: styles')

        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register({ name: 'conversation.input.right', id: ID, order: 1, locale: NS }, PromptTunerButton),
        )

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: ID, order: 32, locale: NS, label: () => t('sectionLabel') },
            PromptTunerSettings,
          ),
        )
      },
    }
  },
})
