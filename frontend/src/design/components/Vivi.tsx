import { useEffect, useRef } from 'react'
import '@/design/oatis/vivi-cloud.js'
import type { ViviState } from '@/design/oatis/vivi-cloud'
import { useResolvedTheme } from '@/lib/theme'

/** Vivi, the oatis-style mascot: a small cloud of pixel static whose motion shows a state
 * — asleep in empty states, glitching when something's broken. One per screen, on a
 * plain background, scaled by whole numbers (`size` grid pixels drawn at `scale`×). */
export function Vivi({
  state,
  size = 48,
  scale = 2,
  className,
}: {
  state: ViviState
  size?: number
  scale?: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const theme = useResolvedTheme()

  useEffect(() => {
    const canvas = ref.current
    const api = window.ViviCloud
    // No 2D canvas (jsdom in tests): nothing to draw, and nothing that should fail.
    if (!canvas || !api || !canvas.getContext('2d')) return
    const vivi = api.create(canvas, { size, state, theme, transparent: true })
    return () => vivi.destroy()
  }, [state, size, theme])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={className}
      style={{ width: size * scale, height: size * scale, imageRendering: 'pixelated' }}
    />
  )
}
