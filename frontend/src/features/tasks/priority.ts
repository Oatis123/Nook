import type { TaskPriority } from '@/lib/types'

/** Muted color marker per priority (spec §7.3) — CSS custom properties defined once in
 * design/tokens.css so light/dark values stay in sync with the rest of the palette. */
export const PRIORITY_COLOR_VAR: Record<Exclude<TaskPriority, 'none'>, string> = {
  low: 'var(--priority-low)',
  medium: 'var(--priority-medium)',
  high: 'var(--priority-high)',
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const PRIORITY_ORDER: TaskPriority[] = ['high', 'medium', 'low', 'none']
