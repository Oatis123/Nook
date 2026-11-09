import { useEffect, useState } from 'react'
import cityCyberTall from '@/assets/scenes/city-cyber-tall.png'
import cityCyberUltrawide from '@/assets/scenes/city-cyber-ultrawide.png'
import cityCyberWide from '@/assets/scenes/city-cyber-wide.png'
import cityDarkTall from '@/assets/scenes/city-dark-tall.png'
import cityDarkUltrawide from '@/assets/scenes/city-dark-ultrawide.png'
import cityDarkWide from '@/assets/scenes/city-dark-wide.png'
import cityLightTall from '@/assets/scenes/city-light-tall.png'
import cityLightUltrawide from '@/assets/scenes/city-light-ultrawide.png'
import cityLightWide from '@/assets/scenes/city-light-wide.png'
import lakeCyberTall from '@/assets/scenes/lake-cyber-tall.png'
import lakeCyberUltrawide from '@/assets/scenes/lake-cyber-ultrawide.png'
import lakeCyberWide from '@/assets/scenes/lake-cyber-wide.png'
import lakeDarkTall from '@/assets/scenes/lake-dark-tall.png'
import lakeDarkUltrawide from '@/assets/scenes/lake-dark-ultrawide.png'
import lakeDarkWide from '@/assets/scenes/lake-dark-wide.png'
import lakeLightTall from '@/assets/scenes/lake-light-tall.png'
import lakeLightUltrawide from '@/assets/scenes/lake-light-ultrawide.png'
import lakeLightWide from '@/assets/scenes/lake-light-wide.png'
import landscapeCyberTall from '@/assets/scenes/landscape-cyber-tall.png'
import landscapeCyberUltrawide from '@/assets/scenes/landscape-cyber-ultrawide.png'
import landscapeCyberWide from '@/assets/scenes/landscape-cyber-wide.png'
import landscapeDarkTall from '@/assets/scenes/landscape-dark-tall.png'
import landscapeDarkUltrawide from '@/assets/scenes/landscape-dark-ultrawide.png'
import landscapeDarkWide from '@/assets/scenes/landscape-dark-wide.png'
import landscapeLightTall from '@/assets/scenes/landscape-light-tall.png'
import landscapeLightUltrawide from '@/assets/scenes/landscape-light-ultrawide.png'
import landscapeLightWide from '@/assets/scenes/landscape-light-wide.png'
import taigaCyberTall from '@/assets/scenes/taiga-cyber-tall.png'
import taigaCyberUltrawide from '@/assets/scenes/taiga-cyber-ultrawide.png'
import taigaCyberWide from '@/assets/scenes/taiga-cyber-wide.png'
import taigaDarkTall from '@/assets/scenes/taiga-dark-tall.png'
import taigaDarkUltrawide from '@/assets/scenes/taiga-dark-ultrawide.png'
import taigaDarkWide from '@/assets/scenes/taiga-dark-wide.png'
import taigaLightTall from '@/assets/scenes/taiga-light-tall.png'
import taigaLightUltrawide from '@/assets/scenes/taiga-light-ultrawide.png'
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

/** Portrait, landscape and 3:1 compositions, selected by the combined aspect ratio of the gutters. */
export interface NoteScene {
  tall: string
  wide: string
  ultrawide: string
}

const SCENES: Record<DayPhase, Record<ResolvedTheme, NoteScene>> = {
  morning: {
    light: { tall: taigaLightTall, wide: taigaLightWide, ultrawide: taigaLightUltrawide },
    dark: { tall: taigaDarkTall, wide: taigaDarkWide, ultrawide: taigaDarkUltrawide },
    cyber: { tall: taigaCyberTall, wide: taigaCyberWide, ultrawide: taigaCyberUltrawide },
  },
  day: {
    light: { tall: lakeLightTall, wide: lakeLightWide, ultrawide: lakeLightUltrawide },
    dark: { tall: lakeDarkTall, wide: lakeDarkWide, ultrawide: lakeDarkUltrawide },
    cyber: { tall: lakeCyberTall, wide: lakeCyberWide, ultrawide: lakeCyberUltrawide },
  },
  evening: {
    light: { tall: cityLightTall, wide: cityLightWide, ultrawide: cityLightUltrawide },
    dark: { tall: cityDarkTall, wide: cityDarkWide, ultrawide: cityDarkUltrawide },
    cyber: { tall: cityCyberTall, wide: cityCyberWide, ultrawide: cityCyberUltrawide },
  },
  night: {
    light: {
      tall: landscapeLightTall,
      wide: landscapeLightWide,
      ultrawide: landscapeLightUltrawide,
    },
    dark: { tall: landscapeDarkTall, wide: landscapeDarkWide, ultrawide: landscapeDarkUltrawide },
    cyber: {
      tall: landscapeCyberTall,
      wide: landscapeCyberWide,
      ultrawide: landscapeCyberUltrawide,
    },
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
