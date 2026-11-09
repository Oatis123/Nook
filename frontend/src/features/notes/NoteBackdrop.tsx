import { useResolvedTheme } from '@/lib/theme'
import { type NoteScene, sceneFor, useDayPhase } from '@/features/notes/dayPhase'

function NoteGutter({ side, scene }: { side: 'left' | 'right'; scene: NoteScene }) {
  return (
    <div className={`note-gutter note-gutter--${side}`}>
      {Object.entries(scene).map(([variant, src]) => (
        <div
          key={variant}
          className={`note-scene note-scene--${variant}`}
          style={{ backgroundImage: `url(${src})` }}
        />
      ))}
    </div>
  )
}

/** Two adjacent halves of one scene with the reading column inserted between them. */
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
