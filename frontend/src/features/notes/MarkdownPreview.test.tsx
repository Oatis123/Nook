import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as attachmentsApi from '@/features/attachments/api'
import * as notesApi from '@/features/notes/api'
import { MarkdownPreview } from '@/features/notes/MarkdownPreview'

vi.mock('@/features/notes/api', async (importOriginal) => ({
  ...(await importOriginal<typeof notesApi>()),
  listNotes: vi.fn(),
  listFolders: vi.fn(),
}))

vi.mock('@/features/attachments/api', async (importOriginal) => ({
  ...(await importOriginal<typeof attachmentsApi>()),
  listAttachments: vi.fn(),
}))

const MATAN_README = `---
tags:
  - Математика
  - Лекция
  - Университет
course: Математический анализ 1
---

# Математический анализ 1

Курс по дисциплине "Математический анализ" для студентов технических специальностей НГТУ.

## Содержание (только теория)

### 1. Вводный модуль
- [[01 - Правила введения ответов]]
- [[02 - Информация ФЭН (Лебедева Е.А.)]]

## Закрытые темы (недоступны для аккаунта)

- Дифференциальное исчисление функций многих переменных -> Предел, непрерывность и частные производные ФМП`

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

function renderPreview(content: string, noteFolderId: string | null = 'f-matan') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MarkdownPreview content={content} noteFolderId={noteFolderId} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MarkdownPreview', () => {
  beforeEach(() => {
    vi.mocked(notesApi.listNotes).mockResolvedValue([
      {
        id: 'n1',
        folder_id: 'f-matan',
        title: '01 - Правила введения ответов',
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        deleted_at: null,
        is_ideas: false,
      },
    ])
    vi.mocked(notesApi.listFolders).mockResolvedValue([
      { id: 'f-uni', name: 'University', parent_id: null, position: 0 },
      { id: 'f-math', name: 'Math', parent_id: 'f-uni', position: 0 },
      { id: 'f-matan', name: 'Matan', parent_id: 'f-math', position: 0 },
    ])
    vi.mocked(attachmentsApi.listAttachments).mockResolvedValue([])
  })

  it('renders the Matan README note without falling into the error state', async () => {
    renderPreview(MATAN_README)

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Математический анализ 1' })).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
    expect(screen.getByText('01 - Правила введения ответов')).toBeInTheDocument()
    expect(screen.getByText('02 - Информация ФЭН (Лебедева Е.А.)')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't render this note.")).not.toBeInTheDocument()
  })
})
