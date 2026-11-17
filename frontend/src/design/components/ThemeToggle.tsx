import { Monitor, Moon, Sparkles, Sun } from '@/design/icons'
import { type ThemePreference, transitionOriginFromEvent, useThemeStore } from '@/lib/theme'

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'cyber', label: 'Cyber (dark only)', icon: Sparkles },
  { value: 'system', label: 'System', icon: Monitor },
]

export function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference)
  const setPreference = useThemeStore((s) => s.setPreference)

  return (
    <div role="radiogroup" aria-label="Theme" className="ui-fluid-segments [--segment-count:4]">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={(e) => setPreference(value, transitionOriginFromEvent(e))}
          className="inline-flex h-9 w-9 items-center justify-center"
        >
          <Icon size={16} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  )
}
