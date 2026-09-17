import {
  BookOpen,
  Briefcase,
  Code,
  Coffee,
  Dumbbell,
  Flag,
  Folder,
  GraduationCap,
  Heart,
  Home,
  Inbox,
  type LucideIcon,
  Music,
  Plane,
  ShoppingCart,
  Star,
  Target,
} from 'lucide-react'
import type { TaskListColor, TaskListIcon } from '@/lib/types'

export const LIST_ICON_COMPONENT: Record<TaskListIcon, LucideIcon> = {
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
}

export const LIST_ICON_OPTIONS = Object.keys(LIST_ICON_COMPONENT) as TaskListIcon[]

export const LIST_COLOR_OPTIONS: TaskListColor[] = [
  'palette-1',
  'palette-2',
  'palette-3',
  'palette-4',
  'palette-5',
  'palette-6',
]

export function listColorVar(color: TaskListColor): string {
  return `var(--${color})`
}
