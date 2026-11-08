import { useResolvedTheme } from '@/lib/theme'
import { type NoteScene, sceneFor, useDayPhase } from '@/features/notes/dayPhase'

function NoteGutter({ side, scene }: { side: 'left' | 'right'; scene: NoteScene }) {
  return (
    <div className={`note-gutter note-gutter--${side}`}>
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

/** The scene is mirrored across the plain reading column. */
export function NoteBackdrop() {
  const phase = useDayPhase()
  const theme = useResolvedTheme()
  const scene = sceneFor(phase, theme)

  return (
    <div aria-hidden className="note-backdrop" data-phase={phase}>
      <NoteGutter side="left" scene={scene} />
      <NoteGutter side="right" scene={scene} />
    </div>
  )
}
