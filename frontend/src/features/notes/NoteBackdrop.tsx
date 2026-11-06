import { useResolvedTheme } from '@/lib/theme'
import { sceneFor, useDayPhase } from '@/features/notes/dayPhase'

/** The note page's side scenery: one oatis scene, mirrored across the working column,
 * picked by the local time of day and drawn in the active theme. Purely decorative —
 * the column between the two copies stays plain, so text never sits on a pattern. */
export function NoteBackdrop() {
  const phase = useDayPhase()
  const theme = useResolvedTheme()
  const image = `url(${sceneFor(phase, theme)})`

  return (
    <div aria-hidden className="note-backdrop" data-phase={phase}>
      <div data-side="left" className="note-scene" style={{ backgroundImage: image }} />
      <div data-side="right" className="note-scene" style={{ backgroundImage: image }} />
    </div>
  )
}
