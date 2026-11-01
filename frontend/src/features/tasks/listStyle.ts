import {
  Baby,
  Bike,
  BookOpen,
  Briefcase,
  Camera,
  Car,
  Code,
  Coffee,
  Dumbbell,
  Flag,
  Folder,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Inbox,
  Lightbulb,
  type AppIcon,
  Music,
  Palette,
  PawPrint,
  Plane,
  Sparkles,
  ShoppingCart,
  Star,
  Target,
  Users,
  Utensils,
  Wallet,
  Wrench,
} from '@/design/icons'
import type { TaskListColor, TaskListIcon } from '@/lib/types'

export const LIST_ICON_COMPONENT: Record<TaskListIcon, AppIcon> = {
  inbox: Inbox,
  briefcase: Briefcase,
  home: Home,
  heart: Heart,
  star: Star,
  'book-open': BookOpen,
  'shopping-cart': ShoppingCart,
  dumbbell: Dumbbell,
  plane: Plane,
  'graduation-cap': GraduationCap,
  music: Music,
  code: Code,
  flag: Flag,
  target: Target,
  coffee: Coffee,
  folder: Folder,
  gift: Gift,
  wallet: Wallet,
  utensils: Utensils,
  car: Car,
  'gamepad-2': Gamepad2,
  palette: Palette,
  camera: Camera,
  wrench: Wrench,
  'paw-print': PawPrint,
  baby: Baby,
  bike: Bike,
  sparkles: Sparkles,
  users: Users,
  lightbulb: Lightbulb,
}

export const LIST_ICON_OPTIONS = Object.keys(LIST_ICON_COMPONENT) as TaskListIcon[]

/** The five category inks a list can have (oatis-style: bi, fn, type, prop, kw). Lists
 * created before the single theme may store palette-6..12, which design/skins/oatis.css
 * maps onto the same five in order. */
export const LIST_COLOR_OPTIONS: TaskListColor[] = [
  'palette-1',
  'palette-2',
  'palette-3',
  'palette-4',
  'palette-5',
]

/** The option a stored color shows as: palette-7 is the second ink, like palette-2. */
export function listColorOption(color: TaskListColor): TaskListColor {
  const n = Number(color.replace('palette-', ''))
  return `palette-${((n - 1) % LIST_COLOR_OPTIONS.length) + 1}` as TaskListColor
}

export function listColorVar(color: TaskListColor): string {
  return `var(--${color})`
}

/** The list's tint: a fill behind its calendar events. */
export function listTintVar(color: TaskListColor): string {
  return `var(--${color}-tint)`
}
