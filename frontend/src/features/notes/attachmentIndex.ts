import type { Attachment } from '@/lib/types'

export interface AttachmentIndex {
  resolve(filename: string): { id: string; mime: string } | null
}

/** Mirrors the backend's embed resolution in note_links.py: match `![[filename]]` by exact
 * filename, only when it's unambiguous (exactly one attachment with that name). */
export function buildAttachmentIndex(attachments: Attachment[]): AttachmentIndex {
  const byFilename = new Map<string, Attachment[]>()
  for (const attachment of attachments) {
    const list = byFilename.get(attachment.filename) ?? []
    list.push(attachment)
    byFilename.set(attachment.filename, list)
  }

  return {
    resolve(filename: string) {
      const matches = byFilename.get(filename)
      if (matches?.length === 1) return { id: matches[0].id, mime: matches[0].mime }
      return null
    },
  }
}
