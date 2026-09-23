import { clsx } from 'clsx'
import { Check } from '@/design/icons'
import {
  type ThemeSkin,
  transitionOriginFromEvent,
  useResolvedTheme,
  useThemeStore,
} from '@/lib/theme'

interface Palette {
  bg: string
  surface: string
  accent: string
  accentText: string
  text: string
  muted: string
}

/** Preview data only — mirrors design/tokens.css and design/skins/*.css but doesn't
 * read them live, since every card must render its own skin regardless of which one
 * is active. Rendering each card in its skin's fonts also warms those font files
 * before the user switches. */
const OPTIONS: {
  value: ThemeSkin
  label: string
  fonts: string
  display: string
  ui: string
  displayWeight: number
  radius: string
  buttonRadius: string
  light: Palette
  dark: Palette
}[] = [
  {
    value: 'anthropic',
    label: 'Anthropic',
    fonts: 'Literata · IBM Plex Sans',
    display: "'Literata', Georgia, serif",
    ui: "'IBM Plex Sans', system-ui, sans-serif",
    displayWeight: 400,
    radius: '8px',
    buttonRadius: '6px',
    light: {
      bg: '#faf9f5',
      surface: '#f3f1ea',
      accent: '#c2663f',
      accentText: '#ffffff',
      text: '#1f1e1b',
      muted: '#6b6860',
    },
    dark: {
      bg: '#1c1b19',
      surface: '#252421',
      accent: '#d9805a',
      accentText: '#1c1b19',
      text: '#eceae3',
      muted: '#9c998f',
    },
  },
  {
    value: 'telegram',
    label: 'Telegram',
    fonts: 'Roboto',
    display: "'Roboto', system-ui, sans-serif",
    ui: "'Roboto', system-ui, sans-serif",
    displayWeight: 500,
    radius: '14px',
    buttonRadius: '10px',
    light: {
      bg: '#ffffff',
      surface: '#f4f4f5',
      accent: '#3390ec',
      accentText: '#ffffff',
      text: '#0f0f0f',
      muted: '#707579',
    },
    dark: {
      bg: '#0e1621',
      surface: '#17212b',
      accent: '#5ea9eb',
      accentText: '#0e1621',
      text: '#f5f5f5',
      muted: '#7d8b99',
    },
  },
  {
    value: 'github',
    label: 'GitHub',
    fonts: 'Mona Sans · System UI',
    display: "'Mona Sans Variable', -apple-system, 'Segoe UI', sans-serif",
    ui: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
    displayWeight: 600,
    radius: '6px',
    buttonRadius: '6px',
    light: {
      bg: '#ffffff',
      surface: '#f6f8fa',
      accent: '#1f883d',
      accentText: '#ffffff',
      text: '#1f2328',
      muted: '#59636e',
    },
    dark: {
      bg: '#0d1117',
      surface: '#151b23',
      accent: '#238636',
      accentText: '#ffffff',
      text: '#f0f6fc',
      muted: '#9198a1',
    },
  },
  {
    value: 'material',
    label: 'Material 3',
    fonts: 'Google Sans Flex',
    display: "'Google Sans Flex Variable', 'Roboto', system-ui, sans-serif",
    ui: "'Google Sans Flex Variable', 'Roboto', system-ui, sans-serif",
    displayWeight: 500,
    radius: '20px',
    buttonRadius: '9999px',
    light: {
      bg: '#fef7ff',
      surface: '#f3edf7',
      accent: '#6750a4',
      accentText: '#ffffff',
      text: '#1d1b20',
      muted: '#49454f',
    },
    dark: {
      bg: '#141218',
      surface: '#211f26',
      accent: '#d0bcff',
      accentText: '#381e72',
      text: '#e6e0e9',
      muted: '#cac4d0',
    },
  },
]

export function ThemeSkinPicker() {
  const skin = useThemeStore((s) => s.skin)
  const setSkin = useThemeStore((s) => s.setSkin)
  const mode = useResolvedTheme()

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {OPTIONS.map((option) => {
        const palette = option[mode]
        const selected = skin === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={(e) => setSkin(option.value, transitionOriginFromEvent(e))}
            className={clsx(
              'group relative flex flex-col overflow-hidden rounded-lg border text-left',
              'transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5',
              selected
                ? 'border-accent shadow-[0_0_0_1px_var(--accent)]'
                : 'border-border hover:border-text-muted',
            )}
          >
            <span
              className="flex h-20 flex-col justify-between p-2.5"
              style={{ background: palette.bg, color: palette.text }}
              aria-hidden="true"
            >
              <span
                className="text-lg leading-none"
                style={{ fontFamily: option.display, fontWeight: option.displayWeight }}
              >
                Aa
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-5 flex-1"
                  style={{ background: palette.surface, borderRadius: option.radius }}
                />
                <span
                  className="flex h-5 items-center px-2 text-[10px] font-medium"
                  style={{
                    background: palette.accent,
                    color: palette.accentText,
                    borderRadius: option.buttonRadius,
                    fontFamily: option.ui,
                  }}
                >
                  OK
                </span>
              </span>
            </span>
            <span className="flex flex-col border-t border-border bg-surface-raised px-2.5 py-2">
              <span className="text-sm text-text">{option.label}</span>
              <span className="truncate text-xs text-text-muted">{option.fonts}</span>
            </span>
            <span
              className={clsx(
                'absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-text',
                'transition-[scale,opacity] duration-300 ease-spring',
                selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
              )}
              aria-hidden="true"
            >
              <Check size={12} strokeWidth={3} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
