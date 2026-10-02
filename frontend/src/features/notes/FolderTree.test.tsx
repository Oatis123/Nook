import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as notesApi from '@/features/notes/api'
import { FolderTree } from '@/features/notes/FolderTree'
import type { Folder, NoteSummary } from '@/lib/types'

vi.mock('@/features/notes/api', async (importOriginal) => ({
  ...(await importOriginal<typeof notesApi>()),
  listFolders: vi.fn(),
  listNotes: vi.fn(),
  updateNote: vi.fn(),
  getNote: vi.fn(),
}))

const folder = { id: 'f1', name: 'Projects', parent_id: null } as Folder
const rootNote = { id: 'n-root', title: 'Root note', folder_id: null, version: 1 } as NoteSummary
const nestedNote = {
  id: 'n-nested',
  title: 'Nested note',
  folder_id: 'f1',
  version: 1,
} as NoteSummary

// jsdom has no DragEvent, so drag events would be plain Events without coordinates.
beforeAll(() => {
  class DragEventWithCoords extends MouseEvent {}
  Object.defineProperty(window, 'DragEvent', { value: DragEventWithCoords, configurable: true })
})

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>
}

function renderTree() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/notes']}>
        <Routes>
          <Route
            path="/notes/:noteId?"
            element={
              <>
                <FolderTree />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A native drag of `row` from `from` that passes over and is released on `target` at `to`. */
function drag(row: HTMLElement, target: HTMLElement, from: [number, number], to: [number, number]) {
  const store = new Map<string, string>()
  const dataTransfer = {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  }
  const at = ([clientX, clientY]: [number, number]) => ({ clientX, clientY, dataTransfer })
  fireEvent.dragStart(row, at(from))
  fireEvent.dragOver(target, at(to))
  fireEvent.drop(target, at(to))
  fireEvent.dragEnd(row, at(to))
}

const rowOf = (title: string) => screen.getByText(title).closest('[draggable]') as HTMLElement

describe('FolderTree', () => {
  beforeEach(() => {
    vi.mocked(notesApi.listFolders).mockResolvedValue([folder])
    vi.mocked(notesApi.listNotes).mockResolvedValue([rootNote, nestedNote])
    vi.mocked(notesApi.updateNote).mockReset()
  })

  it('opens a note when the click wobbles into a tiny drag', async () => {
    renderTree()
    const row = rowOf(await screen.findByText('Root note').then((el) => el.textContent!))

    drag(row, row, [10, 10], [16, 12])

    expect(screen.getByTestId('location')).toHaveTextContent('/notes/n-root')
    expect(notesApi.updateNote).not.toHaveBeenCalled()
  })

  it('keeps a nested note in its folder when its wobbly click lands on the tree', async () => {
    renderTree()
    fireEvent.click(await screen.findByText('Projects'))
    const row = rowOf('Nested note')
    const tree = screen.getByText('Notes').closest('div.flex-col') as HTMLElement

    drag(row, tree, [40, 60], [44, 63])

    expect(screen.getByTestId('location')).toHaveTextContent('/notes/n-nested')
    expect(notesApi.updateNote).not.toHaveBeenCalled()
  })

  it('still moves a note that is really dragged onto a folder', async () => {
    renderTree()
    const row = rowOf(await screen.findByText('Root note').then((el) => el.textContent!))
    const folderRow = rowOf('Projects')

    drag(row, folderRow, [10, 120], [10, 40])

    await waitFor(() =>
      expect(notesApi.updateNote).toHaveBeenCalledWith('n-root', {
        version: 1,
        folder_id: 'f1',
        move_to_root: false,
      }),
    )
    expect(screen.getByTestId('location')).toHaveTextContent('/notes')
  })
})
