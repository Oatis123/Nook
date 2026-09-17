import { useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import ForceGraph2D, { type NodeObject } from 'react-force-graph-2d'
import { useResolvedTheme } from '@/lib/theme'
import { useElementSize } from '@/lib/useElementSize'
import { useCreateNote } from '@/features/notes/hooks'
import { colorForKey } from '@/features/graph/colors'
import type { GraphData, GraphNode } from '@/lib/types'

export type ColorBy = 'folder' | 'tag'

function nodeRadius(linkCount: number): number {
  return 3 + Math.sqrt(Math.max(linkCount, 0)) * 2
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function GraphCanvas({
  data,
  colorBy,
  height,
}: {
  data: GraphData
  colorBy: ColorBy
  height: number
}) {
  const navigate = useNavigate()
  const createNote = useCreateNote()
  const theme = useResolvedTheme()
  const hoverNodeIdRef = useRef<string | null>(null)
  // react-force-graph auto-detects its canvas width from the nearest ancestor with a
  // definite width — inside a narrow flex/aside column (the local graph panel) that
  // detection picked up a distant wider ancestor instead, rendering an oversized canvas
  // that overflowed the panel. Measuring this wrapper explicitly and passing width down
  // fixes it regardless of the surrounding layout.
  const [containerRef, containerSize] = useElementSize<HTMLDivElement>()

  const colors = useMemo(
    () => ({
      muted: readCssVar('--text-muted', theme === 'dark' ? '#9c998f' : '#6b6860'),
      accent: readCssVar('--accent', theme === 'dark' ? '#d9805a' : '#c2663f'),
      border: readCssVar('--border', theme === 'dark' ? '#363430' : '#e5e2d9'),
    }),
    [theme],
  )

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of data.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set())
      if (!map.has(edge.target)) map.set(edge.target, new Set())
      map.get(edge.source)!.add(edge.target)
      map.get(edge.target)!.add(edge.source)
    }
    return map
  }, [data])

  // react-force-graph mutates graphData objects in place (attaching x/y, replacing
  // source/target ids with node refs) — cloning keeps that out of the TanStack Query
  // cache the original `data` came from.
  const graphData = useMemo(
    () => ({
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.edges.map((e) => ({ ...e })),
    }),
    [data],
  )

  const nodeColorFor = useCallback(
    (node: GraphNode): string => {
      if (node.dangling) return colors.muted
      const key =
        colorBy === 'folder' ? (node.folder_id ?? '__root__') : (node.tags[0] ?? '__none__')
      return colorForKey(key)
    },
    [colorBy, colors.muted],
  )

  const nodeCanvasObject = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as unknown as GraphNode & { x: number; y: number }
      const hoverId = hoverNodeIdRef.current
      const isHover = hoverId === n.id
      const isNeighbor = hoverId !== null && (adjacency.get(hoverId)?.has(n.id) ?? false)
      const dimmed = hoverId !== null && !isHover && !isNeighbor
      const radius = nodeRadius(n.link_count)

      ctx.globalAlpha = dimmed ? 0.25 : 1
      ctx.beginPath()
      ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = nodeColorFor(n)
      ctx.fill()

      if (n.dangling) {
        ctx.setLineDash([2, 2])
        ctx.strokeStyle = colors.muted
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (isHover) {
        ctx.lineWidth = 2 / globalScale
        ctx.strokeStyle = colors.accent
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    },
    [adjacency, colors, nodeColorFor],
  )

  const nodePointerAreaPaint = useCallback(
    (node: NodeObject, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as unknown as GraphNode & { x: number; y: number }
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(n.x, n.y, nodeRadius(n.link_count), 0, 2 * Math.PI)
      ctx.fill()
    },
    [],
  )

  const linkColor = useCallback(
    (link: { source: unknown; target: unknown }) => {
      const hoverId = hoverNodeIdRef.current
      if (!hoverId) return colors.border
      // linkSource/linkTarget resolve to node objects once the simulation starts, but
      // stay plain ids before the first tick — this handles both.
      const s = typeof link.source === 'object' ? (link.source as { id: string }).id : link.source
      const t = typeof link.target === 'object' ? (link.target as { id: string }).id : link.target
      return s === hoverId || t === hoverId ? colors.accent : colors.border
    },
    [colors],
  )

  function handleNodeHover(node: NodeObject | null) {
    hoverNodeIdRef.current = node ? String(node.id) : null
  }

  function handleNodeClick(node: NodeObject) {
    const n = node as unknown as GraphNode
    if (n.dangling) {
      createNote.mutate(
        { title: n.title, folder_id: null },
        { onSuccess: (created) => navigate(`/notes/${created.id}`) },
      )
      return
    }
    navigate(`/notes/${n.id}`)
  }

  return (
    <div ref={containerRef} style={{ height }}>
      {containerSize.width > 0 && (
        <ForceGraph2D
          graphData={graphData}
          width={containerSize.width}
          height={height}
          nodeLabel={(node) => (node as unknown as GraphNode).title}
          nodeVal={(node) => Math.max((node as unknown as GraphNode).link_count, 1)}
          nodeCanvasObject={nodeCanvasObject}
          nodePointerAreaPaint={nodePointerAreaPaint}
          linkColor={linkColor}
          linkWidth={1}
          onNodeHover={handleNodeHover}
          onNodeClick={handleNodeClick}
          autoPauseRedraw={false}
          cooldownTicks={100}
          backgroundColor="rgba(0,0,0,0)"
        />
      )}
    </div>
  )
}
