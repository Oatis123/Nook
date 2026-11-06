import { useResolvedTheme } from '@/lib/theme'
import { type NoteScene, sceneFor, useDayPhase } from '@/features/notes/dayPhase'

/** One side of the page's scenery. Both compositions are mounted; a container query on
 * the gutter shows the one that fits its width (see .note-gutter in
 * design/skins/oatis.css), so resizing from a laptop to an ultrawide swaps composition
 * without reloading anything. */
function Gutter({ side, scene }: { side: 'left' | 'right'; scene: NoteScene }) {
  return (
    <div className="note-gutter" data-side={side}>
      <div
        className="note-scene note-scene--tall"
        style={{ backgroundImage: `url(${scene.tall})` }}
      />
      <div
        className="note-scene note-scene--wide"
        style={{ backgroundImage: `url(${scene.wide})` }}
      />
    </div>
  )
}

/** The note page's side scenery: one oatis scene, mirrored across the working column,
 * picked by the local time of day and drawn in the active theme. Purely decorative —
 * the column between the two copies stays plain, so text never sits on a pattern. */
export function NoteBackdrop() {
  const phase = useDayPhase()
  const theme = useResolvedTheme()
  const scene = sceneFor(phase, theme)

  return (
    <div aria-hidden className="note-backdrop" data-phase={phase}>
      <Gutter side="left" scene={scene} />
      <Gutter side="right" scene={scene} />
    </div>
  )
}
