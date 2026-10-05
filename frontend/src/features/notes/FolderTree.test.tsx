import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authApi from '@/features/auth/api'
import * as notesApi from '@/features/notes/api'
import { FolderTree } from '@/features/notes/FolderTree'
import type { Folder, NoteSummary, User } from '@/lib/types'

vi.mock('@/features/auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof authApi>()),
  getMe: vi.fn(),
  updateMe: vi.fn(),
}))

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
// Moved into a folder (say by an agent): it's still pinned at the top.
const ideasNote = {
  id: 'n-ideas',
  title: 'Идеи',
  folder_id: 'f1',
  version: 3,
  is_ideas: true,
} as NoteSummary
const user = { username: 'alice', ideas_note_hidden: false } as User

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

/** A press on `row`'s button that the browser turns into a native drag, passing over and
 * released on `target` at `to` — what a click made while the pointer is still moving does. */
function drag(row: HTMLElement, target: HTMLElement, from: [number, number], to: [number, number]) {
  const store = new Map<string, string>()
  const dataTransfer = {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  }
  const at = ([clientX, clientY]: [number, number]) => ({ clientX, clientY, dataTransfer })
  fireEvent.pointerDown(row.querySelector('button')!, { clientX: from[0], clientY: from[1] })
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
    vi.mocked(authApi.getMe).mockResolvedValue(user)
    vi.mocked(authApi.updateMe).mockReset()
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

  it('opens a note when a click made on the move is released on the same row', async () => {
    renderTree()
    const row = rowOf(await screen.findByText('Root note').then((el) => el.textContent!))

    // Well past the slop, but the pointer never left the row it pressed.
    drag(row, row, [10, 10], [60, 14])

    expect(screen.getByTestId('location')).toHaveTextContent('/notes/n-root')
    expect(notesApi.updateNote).not.toHaveBeenCalled()
  })

  it('toggles a folder when its click turns into a drag', async () => {
    renderTree()
    const folderRow = rowOf(await screen.findByText('Projects').then((el) => el.textContent!))

    drag(folderRow, folderRow, [10, 40], [50, 42])

    expect(screen.getByText('Nested note')).toBeInTheDocument()
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

  it('pins the Ideas note above the folders, with Hide instead of Delete', async () => {
    vi.mocked(notesApi.listNotes).mockResolvedValue([rootNote, nestedNote, ideasNote])
    vi.mocked(authApi.updateMe).mockResolvedValue({ ...user, ideas_note_hidden: true })
    renderTree()

    const ideas = await screen.findByText('Идеи')
    expect(ideas.compareDocumentPosition(screen.getByText('Projects'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(ideas.closest('[draggable]')).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for Идеи' }), { key: 'Enter' })
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Move to…' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide' }))

    await waitFor(() => expect(screen.queryByText('Идеи')).toBeNull())
    expect(vi.mocked(authApi.updateMe).mock.calls[0][0]).toEqual({ ideas_note_hidden: true })
  })

  it('leaves out a hidden Ideas note', async () => {
    vi.mocked(notesApi.listNotes).mockResolvedValue([rootNote, ideasNote])
    vi.mocked(authApi.getMe).mockResolvedValue({ ...user, ideas_note_hidden: true })
    renderTree()

    fireEvent.click(await screen.findByText('Projects'))
    await waitFor(() => expect(screen.queryByText('Идеи')).toBeNull())
    expect(screen.getByText('Root note')).toBeInTheDocument()
  })
})
