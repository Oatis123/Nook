import { useEffect, useState } from 'react'
import cityCyber from '@/assets/scenes/city-cyber-tall.png'
import cityDark from '@/assets/scenes/city-dark-tall.png'
import cityLight from '@/assets/scenes/city-light-tall.png'
import lakeCyber from '@/assets/scenes/lake-cyber-tall.png'
import lakeDark from '@/assets/scenes/lake-dark-tall.png'
import lakeLight from '@/assets/scenes/lake-light-tall.png'
import landscapeCyber from '@/assets/scenes/landscape-cyber-tall.png'
import landscapeDark from '@/assets/scenes/landscape-dark-tall.png'
import landscapeLight from '@/assets/scenes/landscape-light-tall.png'
import taigaCyber from '@/assets/scenes/taiga-cyber-tall.png'
import taigaDark from '@/assets/scenes/taiga-dark-tall.png'
import taigaLight from '@/assets/scenes/taiga-light-tall.png'
import { type ResolvedTheme } from '@/lib/theme'

/** The four parts of the day that change the note page's side scenery. The boundaries
 * are hours a person would name the phase by: night ends at 5, evening at 22. */
export type DayPhase = 'morning' | 'day' | 'evening' | 'night'

export function dayPhaseAt(date: Date): DayPhase {
  const hour = date.getHours()
  if (hour < 5 || hour >= 22) return 'night'
  if (hour < 11) return 'morning'
  if (hour < 17) return 'day'
  return 'evening'
}

/** One pre-rendered oatis scene per phase, in each of the app's three themes. The scenes
 * are 9:16 pixel art; the gutters crop them, never scale them smoothly. */
const SCENES: Record<DayPhase, Record<ResolvedTheme, string>> = {
  morning: { light: taigaLight, dark: taigaDark, cyber: taigaCyber },
  day: { light: lakeLight, dark: lakeDark, cyber: lakeCyber },
  evening: { light: cityLight, dark: cityDark, cyber: cityCyber },
  night: { light: landscapeLight, dark: landscapeDark, cyber: landscapeCyber },
}

export function sceneFor(phase: DayPhase, theme: ResolvedTheme): string {
  return SCENES[phase][theme]
}

/** Re-reads the clock every minute (a phase boundary crossed while the tab is open
 * should not wait for a reload) and again whenever the tab becomes visible, since
 * background tabs throttle timers. */
export function useDayPhase(): DayPhase {
  const [phase, setPhase] = useState(() => dayPhaseAt(new Date()))

  useEffect(() => {
    const update = () => setPhase(dayPhaseAt(new Date()))
    const timer = window.setInterval(update, 60_000)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [])

  return phase
}
