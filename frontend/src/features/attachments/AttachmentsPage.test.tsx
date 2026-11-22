import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as attachmentsApi from '@/features/attachments/api'
import * as notesApi from '@/features/notes/api'
import AttachmentsPage from '@/features/attachments/AttachmentsPage'
import type { Attachment, Folder } from '@/lib/types'

vi.mock('@/features/attachments/api', async (importOriginal) => ({
  ...(await importOriginal<typeof attachmentsApi>()),
  listAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  updateAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  cleanupUnusedAttachments: vi.fn(),
}))

vi.mock('@/features/notes/api', async (importOriginal) => ({
  ...(await importOriginal<typeof notesApi>()),
  listFolders: vi.fn(),
}))

const folders: Folder[] = [
  { id: 'f-course', parent_id: null, name: 'Математический анализ 1', position: 0 },
  { id: 'f-images', parent_id: 'f-course', name: 'images', position: 0 },
]

const attachments: Attachment[] = [
  {
    id: 'a-root',
    folder_id: null,
    filename: 'root-doc.pdf',
    mime: 'application/pdf',
    size: 1024,
    created_at: '2026-01-01T00:00:00Z',
    used_by: [],
  },
  {
    id: 'a-img',
    folder_id: 'f-images',
    filename: 'graph.gif',
    mime: 'image/gif',
    size: 2048,
    created_at: '2026-01-02T00:00:00Z',
    used_by: ['02 - Графики'],
  },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AttachmentsPage />
    </QueryClientProvider>,
  )
}

describe('AttachmentsPage', () => {
  beforeEach(() => {
    vi.mocked(attachmentsApi.listAttachments).mockResolvedValue(attachments)
    vi.mocked(notesApi.listFolders).mockResolvedValue(folders)
    vi.mocked(attachmentsApi.uploadAttachment).mockReset()
    vi.mocked(attachmentsApi.updateAttachment).mockReset()
  })

  it('filters by folder, renders image thumbnails, and uploads into selected folder', async () => {
    vi.mocked(attachmentsApi.uploadAttachment).mockResolvedValue({
      id: 'a-new',
      folder_id: 'f-images',
      filename: 'plot.png',
      mime: 'image/png',
      size: 512,
      created_at: '2026-01-03T00:00:00Z',
      used_by: [],
    })

    renderPage()

    await screen.findByText('root-doc.pdf')
    expect(screen.getByText('graph.gif')).toBeInTheDocument()
    const thumb = screen.getByRole('img', { name: 'graph.gif' })
    expect(thumb).toHaveAttribute('src', '/api/v1/attachments/a-img/download')

    // Filter to `images` folder
    const nav = screen.getByRole('navigation', { name: 'Attachment folders' })
    const imagesBtn = Array.from(nav.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('images'),
    )!
    fireEvent.click(imagesBtn)

    expect(screen.queryByText('root-doc.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('graph.gif')).toBeInTheDocument()

    // Upload directly into `f-images`
    const fileInput = screen.getByLabelText('Upload attachment')
    const file = new File(['png'], 'plot.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(attachmentsApi.uploadAttachment).toHaveBeenCalledWith(file, 'f-images')
    })
  })

  it('moves an attachment to Root via PATCH /attachments/:id', async () => {
    const user = userEvent.setup()
    vi.mocked(attachmentsApi.updateAttachment).mockResolvedValue({
      ...attachments[1],
      folder_id: null,
    })

    renderPage()
    await screen.findByText('graph.gif')

    await user.click(screen.getByRole('button', { name: 'Actions for graph.gif' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }))

    const select = await screen.findByLabelText('Destination')
    await user.selectOptions(select, '')
    await user.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => {
      expect(attachmentsApi.updateAttachment).toHaveBeenCalledWith('a-img', { folder_id: null })
    })
  })

  it('uploads OS files dropped onto a folder row, Root button, and main dropzone', async () => {
    vi.mocked(attachmentsApi.uploadAttachment).mockResolvedValue({
      id: 'a-drop',
      folder_id: 'f-images',
      filename: 'dropped.png',
      mime: 'image/png',
      size: 128,
      created_at: '2026-01-04T00:00:00Z',
      used_by: [],
    })

    renderPage()
    await screen.findByText('root-doc.pdf')

    const nav = screen.getByRole('navigation', { name: 'Attachment folders' })
    const buttons = Array.from(nav.querySelectorAll('button'))
    const rootBtn = buttons.find((b) => b.textContent?.includes('Root'))!
    const imagesBtn = buttons.find((b) => b.textContent?.includes('images'))!
    const dropzone = screen.getByLabelText('Attachments dropzone')

    const file1 = new File(['1'], 'one.png', { type: 'image/png' })
    const file2 = new File(['2'], 'two.png', { type: 'image/png' })
    const file3 = new File(['3'], 'three.png', { type: 'image/png' })

    // 1. Drop onto `images` folder row
    fireEvent.dragOver(imagesBtn, {
      dataTransfer: { files: [file1], types: ['Files'], dropEffect: 'none' },
    })
    expect(imagesBtn.className).toContain('ring-accent')
    fireEvent.drop(imagesBtn, {
      dataTransfer: { files: [file1], types: ['Files'] },
    })
    await waitFor(() => {
      expect(attachmentsApi.uploadAttachment).toHaveBeenCalledWith(file1, 'f-images')
    })

    // 2. Drop onto Root button
    fireEvent.drop(rootBtn, {
      dataTransfer: { files: [file2], types: ['Files'] },
    })
    await waitFor(() => {
      expect(attachmentsApi.uploadAttachment).toHaveBeenCalledWith(file2, null)
    })

    // 3. Drop onto main dropzone when `All folders` is active -> uploads to Root (null)
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file3], types: ['Files'] },
    })
    await waitFor(() => {
      expect(attachmentsApi.uploadAttachment).toHaveBeenCalledWith(file3, null)
    })

    // 4. Filter to `images` and drop onto main dropzone -> uploads to `f-images`
    fireEvent.click(imagesBtn)
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file3], types: ['Files'] },
    })
    await waitFor(() => {
      expect(attachmentsApi.uploadAttachment).toHaveBeenLastCalledWith(file3, 'f-images')
    })
  })
})
