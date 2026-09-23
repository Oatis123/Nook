import { useState } from 'react'
import { Network } from '@/design/icons'
import { clsx } from 'clsx'
import { EmptyState } from '@/design/components/EmptyState'
import { Switch } from '@/design/components/Switch'
import { useElementSize } from '@/lib/useElementSize'
import { useFolders, useTags } from '@/features/notes/hooks'
import { useGraph } from '@/features/graph/hooks'
import { GraphCanvas, type ColorBy } from '@/features/graph/GraphCanvas'

const selectClass =
  'h-8 rounded-md border border-border bg-surface-raised px-2 text-sm outline-none focus-visible:border-accent'

export default function GraphPage() {
  const [folderId, setFolderId] = useState('')
  const [tag, setTag] = useState('')
  const [hideOrphans, setHideOrphans] = useState(false)
  const [showDangling, setShowDangling] = useState(true)
  const [colorBy, setColorBy] = useState<ColorBy>('folder')
  const [containerRef, size] = useElementSize<HTMLDivElement>()

  const foldersQuery = useFolders()
  const tagsQuery = useTags()
  const graphQuery = useGraph({
    folderId: folderId || undefined,
    tag: tag || undefined,
    hideOrphans,
    showDangling,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-border px-6 py-3">
        <h1 className="font-serif text-lg text-text">Graph</h1>

        <select
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className={selectClass}
          aria-label="Filter by folder"
        >
          <option value="">All folders</option>
          {foldersQuery.data?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className={selectClass}
          aria-label="Filter by tag"
        >
          <option value="">All tags</option>
          {tagsQuery.data?.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          <Switch
            checked={hideOrphans}
            onCheckedChange={setHideOrphans}
            label="Hide orphan notes"
          />
          Hide orphans
        </label>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          <Switch
            checked={showDangling}
            onCheckedChange={setShowDangling}
            label="Show dangling links"
          />
          Show dangling
        </label>

        <div className="inline-flex rounded-md border border-border bg-bg p-0.5 text-sm">
          {(['folder', 'tag'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setColorBy(mode)}
              className={clsx(
                'rounded px-2.5 py-1 capitalize transition-colors duration-150',
                colorBy === mode
                  ? 'bg-surface-raised text-text shadow-sm'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1">
        {graphQuery.data &&
          (graphQuery.data.nodes.length === 0 ? (
            <EmptyState icon={Network} title="No notes to graph yet" />
          ) : (
            size.height > 0 && (
              <GraphCanvas data={graphQuery.data} colorBy={colorBy} height={size.height} />
            )
          ))}
      </div>
    </div>
  )
}
