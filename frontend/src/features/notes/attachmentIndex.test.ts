import { describe, expect, it } from 'vitest'
import { buildAttachmentIndex } from '@/features/notes/attachmentIndex'
import type { Attachment, Folder } from '@/lib/types'

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    id: 'id',
    folder_id: null,
    filename: 'file.png',
    mime: 'image/png',
    size: 100,
    created_at: '2026-01-01T00:00:00Z',
    used_by: [],
    ...overrides,
  }
}

function folder(overrides: Partial<Folder> & Pick<Folder, 'id' | 'name'>): Folder {
  return {
    parent_id: null,
    position: 0,
    ...overrides,
  }
}

describe('buildAttachmentIndex', () => {
  it('resolves a unique filename', () => {
    const index = buildAttachmentIndex([attachment({ id: 'a1', filename: 'diagram.png' })])
    expect(index.resolve('diagram.png')).toEqual({ id: 'a1', mime: 'image/png' })
  })

  it('returns null for an unknown filename', () => {
    const index = buildAttachmentIndex([attachment({ id: 'a1', filename: 'diagram.png' })])
    expect(index.resolve('missing.png')).toBeNull()
  })

  it('returns null when the filename is ambiguous without folder context', () => {
    const index = buildAttachmentIndex([
      attachment({ id: 'a1', filename: 'diagram.png' }),
      attachment({ id: 'a2', filename: 'diagram.png' }),
    ])
    expect(index.resolve('diagram.png')).toBeNull()
  })

  it('resolves relative paths, dot paths, URL encoding, and query/fragments', () => {
    const folders: Folder[] = [
      folder({ id: 'f-course', name: 'Математический анализ 1' }),
      folder({ id: 'f-notes', name: 'Лекции', parent_id: 'f-course' }),
      folder({ id: 'f-images', name: 'images', parent_id: 'f-course' }),
    ]
    const attachments: Attachment[] = [
      attachment({
        id: 'a-gif',
        filename: '8943ee10.gif',
        mime: 'image/gif',
        folder_id: 'f-images',
      }),
      attachment({
        id: 'a-space',
        filename: 'my graph.png',
        mime: 'image/png',
        folder_id: 'f-images',
      }),
      attachment({ id: 'a-local', filename: 'local.png', mime: 'image/png', folder_id: 'f-notes' }),
    ]
    const index = buildAttachmentIndex(attachments, folders)

    expect(index.resolve('../images/8943ee10.gif', 'f-notes')).toEqual({
      id: 'a-gif',
      mime: 'image/gif',
    })
    expect(index.resolve('./local.png', 'f-notes')).toEqual({
      id: 'a-local',
      mime: 'image/png',
    })
    expect(
      index.resolve(
        '%D0%9C%D0%B0%D1%82%D0%B5%D0%BC%D0%B0%D1%82%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D0%B9%20%D0%B0%D0%BD%D0%B0%D0%BB%D0%B8%D0%B7%201/images/my%20graph.png#center?w=200',
        'f-notes',
      ),
    ).toEqual({
      id: 'a-space',
      mime: 'image/png',
    })
    // Unambiguous suffix folder match
    expect(index.resolve('images/8943ee10.gif', null)).toEqual({
      id: 'a-gif',
      mime: 'image/gif',
    })
  })

  it('disambiguates coexisting same-named files across folders and handles fallback', () => {
    const folders: Folder[] = [
      folder({ id: 'f-a', name: 'folderA' }),
      folder({ id: 'f-b', name: 'folderB' }),
      folder({ id: 'f-a-img', name: 'images', parent_id: 'f-a' }),
      folder({ id: 'f-b-img', name: 'images', parent_id: 'f-b' }),
    ]
    const attachments: Attachment[] = [
      attachment({ id: 'a-a', filename: 'img.png', folder_id: 'f-a' }),
      attachment({ id: 'a-b', filename: 'img.png', folder_id: 'f-b' }),
      attachment({ id: 'a-a-sub', filename: 'sub.png', folder_id: 'f-a-img' }),
      attachment({ id: 'a-b-sub', filename: 'sub.png', folder_id: 'f-b-img' }),
      attachment({ id: 'a-unique', filename: 'unique.png', folder_id: null }),
    ]
    const index = buildAttachmentIndex(attachments, folders)

    // Relative path picks exact folder
    expect(index.resolve('../folderB/img.png', 'f-a')).toEqual({ id: 'a-b', mime: 'image/png' })
    expect(index.resolve('./img.png', 'f-a')).toEqual({ id: 'a-a', mime: 'image/png' })
    expect(index.resolve('images/sub.png', 'f-a')).toEqual({ id: 'a-a-sub', mime: 'image/png' })
    expect(index.resolve('images/sub.png', 'f-b')).toEqual({ id: 'a-b-sub', mime: 'image/png' })

    // Bare filename prefers note's own folder when present
    expect(index.resolve('img.png', 'f-a')).toEqual({ id: 'a-a', mime: 'image/png' })
    expect(index.resolve('img.png', 'f-b')).toEqual({ id: 'a-b', mime: 'image/png' })
    // Bare filename from root is ambiguous
    expect(index.resolve('img.png', null)).toBeNull()
    // Ambiguous suffix across folderA/images and folderB/images from root
    expect(index.resolve('images/sub.png', null)).toBeNull()
    // Unmatched folder path falls back when filename is globally unique
    expect(index.resolve('missing-folder/unique.png', 'f-a')).toEqual({
      id: 'a-unique',
      mime: 'image/png',
    })
  })
})
