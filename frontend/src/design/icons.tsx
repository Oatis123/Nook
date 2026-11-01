import type { CSSProperties, JSX } from 'react'
import { clsx } from 'clsx'
import { OATIS_ICON_FOR, oatisIconPath } from '@/design/oatisIcons'

/* The app's icon set: the Oatis 9×9 pixel icons (design/oatisIcons.ts) — the
   oatis-style set plus the few Nook needs that it lacks, drawn on the same grid. The
   exports keep lucide's names (the set it replaced), so call sites read the same. */

export interface IconProps {
  size?: number
  /** Kept for call sites written for stroked icons; pixel icons have no stroke. */
  strokeWidth?: number
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export type AppIcon = ((props: IconProps) => JSX.Element) & { displayName?: string }

function themedIcon(name: string): AppIcon {
  const pixelName = OATIS_ICON_FOR[name]
  if (!pixelName) throw new Error(`No pixel icon for ${name}`)

  function Icon({ size = 24, className, style, ...aria }: IconProps) {
    const a11y = aria['aria-label']
      ? { 'aria-label': aria['aria-label'], role: 'img' }
      : { 'aria-hidden': true as const }
    // Pixel art only stays crisp at whole-number scales: 9, 18, 27px.
    const px = Math.max(1, Math.round(size / 9)) * 9
    return (
      <svg
        width={px}
        height={px}
        viewBox="0 0 9 9"
        fill="currentColor"
        shapeRendering="crispEdges"
        className={clsx('ui-icon shrink-0', className)}
        style={style}
        {...a11y}
      >
        <path d={oatisIconPath(pixelName)} />
      </svg>
    )
  }
  Icon.displayName = name
  return Icon
}

export const AlertTriangle = themedIcon('AlertTriangle')
export const ArrowLeft = themedIcon('ArrowLeft')
export const Baby = themedIcon('Baby')
export const Bike = themedIcon('Bike')
export const BookOpen = themedIcon('BookOpen')
export const Briefcase = themedIcon('Briefcase')
export const Calendar = themedIcon('Calendar')
export const CalendarClock = themedIcon('CalendarClock')
export const CalendarRange = themedIcon('CalendarRange')
export const Camera = themedIcon('Camera')
export const Car = themedIcon('Car')
export const Check = themedIcon('Check')
export const ChevronLeft = themedIcon('ChevronLeft')
export const ChevronRight = themedIcon('ChevronRight')
export const ChevronsUpDown = themedIcon('ChevronsUpDown')
export const Code = themedIcon('Code')
export const Coffee = themedIcon('Coffee')
export const Copy = themedIcon('Copy')
export const Download = themedIcon('Download')
export const Dumbbell = themedIcon('Dumbbell')
export const Eye = themedIcon('Eye')
export const EyeOff = themedIcon('EyeOff')
export const File = themedIcon('File')
export const FilePlus = themedIcon('FilePlus')
export const FileText = themedIcon('FileText')
export const Flag = themedIcon('Flag')
export const Folder = themedIcon('Folder')
export const FolderPlus = themedIcon('FolderPlus')
export const Gamepad2 = themedIcon('Gamepad2')
export const Gift = themedIcon('Gift')
export const GraduationCap = themedIcon('GraduationCap')
export const Hash = themedIcon('Hash')
export const Heart = themedIcon('Heart')
export const Home = themedIcon('Home')
export const Inbox = themedIcon('Inbox')
export const Lightbulb = themedIcon('Lightbulb')
export const Link2 = themedIcon('Link2')
export const ListTodo = themedIcon('ListTodo')
export const Mail = themedIcon('Mail')
export const Menu = themedIcon('Menu')
export const Monitor = themedIcon('Monitor')
export const Moon = themedIcon('Moon')
export const MoreHorizontal = themedIcon('MoreHorizontal')
export const Music = themedIcon('Music')
export const Network = themedIcon('Network')
export const Palette = themedIcon('Palette')
export const PanelLeft = themedIcon('PanelLeft')
export const PanelRight = themedIcon('PanelRight')
export const Paperclip = themedIcon('Paperclip')
export const Pencil = themedIcon('Pencil')
export const PawPrint = themedIcon('PawPrint')
export const Plane = themedIcon('Plane')
export const Plus = themedIcon('Plus')
export const Repeat = themedIcon('Repeat')
export const Search = themedIcon('Search')
export const Send = themedIcon('Send')
export const Settings = themedIcon('Settings')
export const Shield = themedIcon('Shield')
export const ShoppingCart = themedIcon('ShoppingCart')
export const SkipForward = themedIcon('SkipForward')
export const Sparkles = themedIcon('Sparkles')
export const Star = themedIcon('Star')
export const Sun = themedIcon('Sun')
export const Target = themedIcon('Target')
export const Trash2 = themedIcon('Trash2')
export const TriangleAlert = themedIcon('TriangleAlert')
export const Upload = themedIcon('Upload')
export const Users = themedIcon('Users')
export const Utensils = themedIcon('Utensils')
export const Wallet = themedIcon('Wallet')
export const Wrench = themedIcon('Wrench')
export const X = themedIcon('X')
