/**
 * Model picker: a trigger showing the current selection, and a searchable
 * grouped panel whose first row follows the session.
 *
 * The listbox is keyboard-navigable (arrows move, Enter commits, Escape
 * closes) and closes on an outside pointer press. Rows are flattened once so
 * the keyboard index and the rendered order cannot disagree.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { CatalogModel, CatalogProvider, ModelChoice, Translate } from '../types.ts'
import { classNames } from '../class-names.ts'
import css from './ModelPicker.module.css'

/** One rendered line: the follow entry, a provider heading, or a model. */
type Row =
  | { readonly kind: 'follow'; readonly key: string }
  | { readonly kind: 'group'; readonly key: string; readonly name: string }
  | {
      readonly kind: 'model'
      readonly key: string
      readonly provider: string
      readonly model: CatalogModel
    }

/** Props of {@link ModelPicker}. */
export interface ModelPickerProps {
  readonly t: Translate
  readonly value: ModelChoice
  readonly catalog: readonly CatalogProvider[]
  readonly onChange: (next: ModelChoice) => void
}

/**
 * Flatten the catalog into rows.
 * @param groups - provider groups.
 * @param query - search text; empty keeps the follow row.
 * @returns the rows to render, in display order.
 */
export function buildRows(groups: readonly CatalogProvider[], query: string): Row[] {
  const needle = query.trim().toLowerCase()
  const rows: Row[] = []
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

/**
 * Indices a keyboard user can land on: everything but a provider heading.
 * @param rows - flattened rows.
 * @returns row indices, in order.
 */
export function selectableIndices(rows: readonly Row[]): number[] {
  const indices: number[] = []
  rows.forEach((row, index) => {
    if (row.kind !== 'group') indices.push(index)
  })
  return indices
}

/**
 * Render the picker.
 * @param props - current value, catalog, and change callback.
 */
export function ModelPicker({ t, value, catalog, onChange }: ModelPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const follow = value.provider === ''
  const group = catalog.find((item) => item.id === value.provider)
  const picked = group?.models.find((item) => item.id === value.model)
  const rows = buildRows(catalog, query)
  const selectable = selectableIndices(rows)

  const commit = (next: ModelChoice): void => {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  const pick = (row: Row | undefined): void => {
    if (row === undefined) return
    if (row.kind === 'follow') commit({ provider: '', model: '' })
    else if (row.kind === 'model') commit({ provider: row.provider, model: row.model.id })
  }

  const step = (direction: 1 | -1): void => {
    if (selectable.length === 0) return
    const at = selectable.indexOf(active)
    const base = at < 0 ? 0 : (at + direction + selectable.length) % selectable.length
    const next = selectable[base]
    if (next === undefined) return
    setActive(next)
    panelRef.current?.querySelector(`[data-row="${String(next)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  useEffect(() => {
    if (!open) return undefined
    panelRef.current?.querySelector('input')?.focus()
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const toggle = (): void => {
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

  return (
    <div className={css.picker} ref={rootRef}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('modelAria', { model: label })}
        onClick={toggle}
      >
        <span className={css.label}>{label}</span>
        {sub === '' ? null : <span className={css.sub}>{sub}</span>}
        <span className={classNames(css.chevron, open ? css.chevronOpen : undefined)}>▾</span>
      </button>
      {open ? (
        <div className={css.panel} ref={panelRef} role="listbox" aria-label={t('modelLabel')}>
          <input
            className={css.search}
            type="text"
            spellCheck={false}
            placeholder={t('modelSearch')}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
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
            }}
          />
          {rows.length === 0 ? (
            <p className={css.empty}>{t('modelEmpty')}</p>
          ) : (
            <div className={css.rows}>
              {rows.map((row, index) => {
                if (row.kind === 'group') {
                  return (
                    <div key={row.key} className={css.group}>
                      {row.name}
                    </div>
                  )
                }
                const selected =
                  row.kind === 'follow' ? follow : row.provider === value.provider && row.model.id === value.model
                const rowClass = classNames(
                  css.row,
                  selected ? css.rowSelected : undefined,
                  active === index ? css.rowActive : undefined,
                )
                return (
                  <button
                    key={row.key}
                    type="button"
                    data-row={index}
                    role="option"
                    aria-selected={selected}
                    className={rowClass}
                    onMouseEnter={() => {
                      setActive(index)
                    }}
                    onClick={() => {
                      pick(row)
                    }}
                  >
                    {row.kind === 'follow' ? t('modelFollow') : row.model.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
