/**
 * @vitest-environment jsdom
 */
/**
 * Model picker: row flattening, keyboard navigation, and commit semantics.
 *
 * The picker is the one place a user chooses a route, so the flattening that
 * keyboard indices point into is tested directly rather than through render.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRows, ModelPicker, selectableIndices } from '../src/client/components/ModelPicker.tsx'
import type { CatalogProvider } from '../src/client/types.ts'

const catalog: readonly CatalogProvider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    models: [
      { id: 'v4-flash', name: 'V4 Flash' },
      { id: 'v4-pro', name: 'V4 Pro' },
    ],
  },
  { id: 'empty', name: 'Empty Provider', models: [] },
]

const t = (key: string): string => key

afterEach(cleanup)

describe('buildRows', () => {
  it('puts the follow row first and one heading per provider', () => {
    const rows = buildRows(catalog, '')
    expect(rows[0]).toEqual({ kind: 'follow', key: '__follow' })
    expect(rows.map((row) => row.kind)).toEqual(['follow', 'group', 'model', 'model', 'group'])
  })

  it('drops the follow row while searching', () => {
    const rows = buildRows(catalog, 'pro')
    expect(rows.some((row) => row.kind === 'follow')).toBe(false)
    expect(rows.filter((row) => row.kind === 'model')).toHaveLength(1)
  })

  it('matches on both the display name and the id, case-insensitively', () => {
    expect(buildRows(catalog, 'FLASH').filter((row) => row.kind === 'model')).toHaveLength(1)
    expect(buildRows(catalog, 'v4-pro').filter((row) => row.kind === 'model')).toHaveLength(1)
  })

  it('keeps an empty provider as a heading when not searching', () => {
    const headings = buildRows(catalog, '').filter((row) => row.kind === 'group')
    expect(headings.map((row) => row.name)).toEqual(['DeepSeek', 'Empty Provider'])
  })
})

describe('selectableIndices', () => {
  it('skips provider headings so arrows never land on one', () => {
    const rows = buildRows(catalog, '')
    const indices = selectableIndices(rows)
    for (const index of indices) expect(rows[index]?.kind).not.toBe('group')
    expect(indices).toHaveLength(3)
  })
})

describe('ModelPicker', () => {
  it('shows the follow label when no pair is set', () => {
    render(<ModelPicker t={t} value={{ provider: '', model: '' }} catalog={catalog} onChange={vi.fn()} />)
    expect(screen.getByText('modelFollow')).toBeTruthy()
  })

  it('shows the resolved model name when a pair is set', () => {
    render(<ModelPicker t={t} value={{ provider: 'deepseek', model: 'v4-pro' }} catalog={catalog} onChange={vi.fn()} />)
    expect(screen.getByText('V4 Pro')).toBeTruthy()
  })

  it('commits a model choice and closes', () => {
    const onChange = vi.fn()
    render(<ModelPicker t={t} value={{ provider: '', model: '' }} catalog={catalog} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'modelAria' }))
    fireEvent.click(screen.getByText('V4 Flash'))
    expect(onChange).toHaveBeenCalledWith({ provider: 'deepseek', model: 'v4-flash' })
  })

  it('commits the follow entry as an empty pair', () => {
    const onChange = vi.fn()
    render(
      <ModelPicker t={t} value={{ provider: 'deepseek', model: 'v4-pro' }} catalog={catalog} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'modelAria' }))
    fireEvent.click(screen.getAllByText('modelFollow')[0]!)
    expect(onChange).toHaveBeenCalledWith({ provider: '', model: '' })
  })

  it('renders the empty state when nothing matches', () => {
    render(<ModelPicker t={t} value={{ provider: '', model: '' }} catalog={catalog} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'modelAria' }))
    fireEvent.change(screen.getByPlaceholderText('modelSearch'), { target: { value: 'zzz' } })
    expect(screen.getByText('modelEmpty')).toBeTruthy()
  })
})
