import { useEffect, useState } from 'react'
import cityCyberTall from '@/assets/scenes/city-cyber-tall.png'
import cityCyberWide from '@/assets/scenes/city-cyber-wide.png'
import cityDarkTall from '@/assets/scenes/city-dark-tall.png'
import cityDarkWide from '@/assets/scenes/city-dark-wide.png'
import cityLightTall from '@/assets/scenes/city-light-tall.png'
import cityLightWide from '@/assets/scenes/city-light-wide.png'
import lakeCyberTall from '@/assets/scenes/lake-cyber-tall.png'
import lakeCyberWide from '@/assets/scenes/lake-cyber-wide.png'
import lakeDarkTall from '@/assets/scenes/lake-dark-tall.png'
import lakeDarkWide from '@/assets/scenes/lake-dark-wide.png'
import lakeLightTall from '@/assets/scenes/lake-light-tall.png'
import lakeLightWide from '@/assets/scenes/lake-light-wide.png'
import landscapeCyberTall from '@/assets/scenes/landscape-cyber-tall.png'
import landscapeCyberWide from '@/assets/scenes/landscape-cyber-wide.png'
import landscapeDarkTall from '@/assets/scenes/landscape-dark-tall.png'
import landscapeDarkWide from '@/assets/scenes/landscape-dark-wide.png'
import landscapeLightTall from '@/assets/scenes/landscape-light-tall.png'
import landscapeLightWide from '@/assets/scenes/landscape-light-wide.png'
import taigaCyberTall from '@/assets/scenes/taiga-cyber-tall.png'
import taigaCyberWide from '@/assets/scenes/taiga-cyber-wide.png'
import taigaDarkTall from '@/assets/scenes/taiga-dark-tall.png'
import taigaDarkWide from '@/assets/scenes/taiga-dark-wide.png'
import taigaLightTall from '@/assets/scenes/taiga-light-tall.png'
import taigaLightWide from '@/assets/scenes/taiga-light-wide.png'
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

/** A pre-rendered oatis scene in two compositions: the 9:16 one for the narrow gutters
 * of an ordinary desktop, and the 16:9 one for an ultrawide monitor, where the same
 * crop would zoom in so far that the moon and the skyline fall off. */
export interface NoteScene {
  tall: string
  wide: string
}

const SCENES: Record<DayPhase, Record<ResolvedTheme, NoteScene>> = {
  morning: {
    light: { tall: taigaLightTall, wide: taigaLightWide },
    dark: { tall: taigaDarkTall, wide: taigaDarkWide },
    cyber: { tall: taigaCyberTall, wide: taigaCyberWide },
  },
  day: {
    light: { tall: lakeLightTall, wide: lakeLightWide },
    dark: { tall: lakeDarkTall, wide: lakeDarkWide },
    cyber: { tall: lakeCyberTall, wide: lakeCyberWide },
  },
  evening: {
    light: { tall: cityLightTall, wide: cityLightWide },
    dark: { tall: cityDarkTall, wide: cityDarkWide },
    cyber: { tall: cityCyberTall, wide: cityCyberWide },
  },
  night: {
    light: { tall: landscapeLightTall, wide: landscapeLightWide },
    dark: { tall: landscapeDarkTall, wide: landscapeDarkWide },
    cyber: { tall: landscapeCyberTall, wide: landscapeCyberWide },
  },
}

export function sceneFor(phase: DayPhase, theme: ResolvedTheme): NoteScene {
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
