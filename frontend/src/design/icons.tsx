import {
  AlertTriangle as LucideAlertTriangle,
  ArrowLeft as LucideArrowLeft,
  Baby as LucideBaby,
  Bike as LucideBike,
  BookOpen as LucideBookOpen,
  Briefcase as LucideBriefcase,
  Calendar as LucideCalendar,
  CalendarClock as LucideCalendarClock,
  CalendarRange as LucideCalendarRange,
  Camera as LucideCamera,
  Car as LucideCar,
  Check as LucideCheck,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  ChevronsUpDown as LucideChevronsUpDown,
  Code as LucideCode,
  Coffee as LucideCoffee,
  Copy as LucideCopy,
  Download as LucideDownload,
  Dumbbell as LucideDumbbell,
  Ellipsis as LucideEllipsis,
  Eye as LucideEye,
  EyeOff as LucideEyeOff,
  File as LucideFile,
  FilePlus as LucideFilePlus,
  FileText as LucideFileText,
  Flag as LucideFlag,
  Folder as LucideFolder,
  FolderPlus as LucideFolderPlus,
  Gamepad2 as LucideGamepad2,
  Gift as LucideGift,
  GraduationCap as LucideGraduationCap,
  Hash as LucideHash,
  Heart as LucideHeart,
  House as LucideHouse,
  Inbox as LucideInbox,
  Lightbulb as LucideLightbulb,
  Link2 as LucideLink2,
  ListTodo as LucideListTodo,
  Mail as LucideMail,
  Menu as LucideMenu,
  Monitor as LucideMonitor,
  Moon as LucideMoon,
  Music as LucideMusic,
  Network as LucideNetwork,
  Palette as LucidePalette,
  PanelLeft as LucidePanelLeft,
  PanelRight as LucidePanelRight,
  Paperclip as LucidePaperclip,
  Pencil as LucidePencil,
  PawPrint as LucidePawPrint,
  Plane as LucidePlane,
  Plus as LucidePlus,
  Repeat as LucideRepeat,
  Search as LucideSearch,
  Send as LucideSend,
  Settings as LucideSettings,
  Shield as LucideShield,
  ShoppingCart as LucideShoppingCart,
  SkipForward as LucideSkipForward,
  Sparkles as LucideSparkles,
  Star as LucideStar,
  Sun as LucideSun,
  Target as LucideTarget,
  Trash2 as LucideTrash2,
  TriangleAlert as LucideTriangleAlert,
  Upload as LucideUpload,
  Users as LucideUsers,
  Utensils as LucideUtensils,
  Wallet as LucideWallet,
  Wrench as LucideWrench,
  X as LucideX,
} from 'lucide-react'

import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, JSX } from 'react'
import { clsx } from 'clsx'
import { OATIS_ICON_FOR, oatisIconPath } from '@/design/oatisIcons'

/* The app's icon set: the Oatis 9×9 pixel icons (design/oatisIcons.ts), with lucide
   standing in where the pixel set has no equivalent. Import icons from '@/design/icons'
   rather than 'lucide-react' so they render in the pixel set. The exports keep lucide's
   names so call sites read the same. */

export interface IconProps {
  size?: number
  /** Lucide stroke width, in its 24-unit viewBox. Ignored by the pixel icons. */
  strokeWidth?: number
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export type AppIcon = ((props: IconProps) => JSX.Element) & { displayName?: string }

/** Lucide fallbacks are drawn a little heavier so they sit next to the pixel icons. */
const LUCIDE_STROKE_SCALE = 1.25

function themedIcon(name: string, Lucide: LucideIcon): AppIcon {
  const oatisName = OATIS_ICON_FOR[name]

  function Icon({ size = 24, strokeWidth = 2, className, style, ...aria }: IconProps) {
    const a11y = aria['aria-label']
      ? { 'aria-label': aria['aria-label'], role: 'img' }
      : { 'aria-hidden': true as const }
    const classes = clsx('ui-icon shrink-0', className)

    if (oatisName) {
      // Pixel art only stays crisp at whole-number scales: 9, 18, 27px.
      const px = Math.max(1, Math.round(size / 9)) * 9
      return (
        <svg
          width={px}
          height={px}
          viewBox="0 0 9 9"
          fill="currentColor"
          shapeRendering="crispEdges"
          className={classes}
          style={style}
          {...a11y}
        >
          <path d={oatisIconPath(oatisName)} />
        </svg>
      )
    }
    return (
      <Lucide
        size={size}
        strokeWidth={strokeWidth * LUCIDE_STROKE_SCALE}
        className={classes}
        style={style}
        {...a11y}
      />
    )
  }
  Icon.displayName = name
  return Icon
}

export const AlertTriangle = themedIcon('AlertTriangle', LucideAlertTriangle)
export const ArrowLeft = themedIcon('ArrowLeft', LucideArrowLeft)
export const Baby = themedIcon('Baby', LucideBaby)
export const Bike = themedIcon('Bike', LucideBike)
export const BookOpen = themedIcon('BookOpen', LucideBookOpen)
export const Briefcase = themedIcon('Briefcase', LucideBriefcase)
export const Calendar = themedIcon('Calendar', LucideCalendar)
export const CalendarClock = themedIcon('CalendarClock', LucideCalendarClock)
export const CalendarRange = themedIcon('CalendarRange', LucideCalendarRange)
export const Camera = themedIcon('Camera', LucideCamera)
export const Car = themedIcon('Car', LucideCar)
export const Check = themedIcon('Check', LucideCheck)
export const ChevronLeft = themedIcon('ChevronLeft', LucideChevronLeft)
export const ChevronRight = themedIcon('ChevronRight', LucideChevronRight)
export const ChevronsUpDown = themedIcon('ChevronsUpDown', LucideChevronsUpDown)
export const Code = themedIcon('Code', LucideCode)
export const Coffee = themedIcon('Coffee', LucideCoffee)
export const Copy = themedIcon('Copy', LucideCopy)
export const Download = themedIcon('Download', LucideDownload)
export const Dumbbell = themedIcon('Dumbbell', LucideDumbbell)
export const Eye = themedIcon('Eye', LucideEye)
export const EyeOff = themedIcon('EyeOff', LucideEyeOff)
export const File = themedIcon('File', LucideFile)
export const FilePlus = themedIcon('FilePlus', LucideFilePlus)
export const FileText = themedIcon('FileText', LucideFileText)
export const Flag = themedIcon('Flag', LucideFlag)
export const Folder = themedIcon('Folder', LucideFolder)
export const FolderPlus = themedIcon('FolderPlus', LucideFolderPlus)
export const Gamepad2 = themedIcon('Gamepad2', LucideGamepad2)
export const Gift = themedIcon('Gift', LucideGift)
export const GraduationCap = themedIcon('GraduationCap', LucideGraduationCap)
export const Hash = themedIcon('Hash', LucideHash)
export const Heart = themedIcon('Heart', LucideHeart)
export const Home = themedIcon('Home', LucideHouse)
export const Inbox = themedIcon('Inbox', LucideInbox)
export const Lightbulb = themedIcon('Lightbulb', LucideLightbulb)
export const Link2 = themedIcon('Link2', LucideLink2)
export const ListTodo = themedIcon('ListTodo', LucideListTodo)
export const Mail = themedIcon('Mail', LucideMail)
export const Menu = themedIcon('Menu', LucideMenu)
export const Monitor = themedIcon('Monitor', LucideMonitor)
export const Moon = themedIcon('Moon', LucideMoon)
export const MoreHorizontal = themedIcon('MoreHorizontal', LucideEllipsis)
export const Music = themedIcon('Music', LucideMusic)
export const Network = themedIcon('Network', LucideNetwork)
export const Palette = themedIcon('Palette', LucidePalette)
export const PanelLeft = themedIcon('PanelLeft', LucidePanelLeft)
export const PanelRight = themedIcon('PanelRight', LucidePanelRight)
export const Paperclip = themedIcon('Paperclip', LucidePaperclip)
export const Pencil = themedIcon('Pencil', LucidePencil)
export const PawPrint = themedIcon('PawPrint', LucidePawPrint)
export const Plane = themedIcon('Plane', LucidePlane)
export const Plus = themedIcon('Plus', LucidePlus)
export const Repeat = themedIcon('Repeat', LucideRepeat)
export const Search = themedIcon('Search', LucideSearch)
export const Send = themedIcon('Send', LucideSend)
export const Settings = themedIcon('Settings', LucideSettings)
export const Shield = themedIcon('Shield', LucideShield)
export const ShoppingCart = themedIcon('ShoppingCart', LucideShoppingCart)
export const SkipForward = themedIcon('SkipForward', LucideSkipForward)
export const Sparkles = themedIcon('Sparkles', LucideSparkles)
export const Star = themedIcon('Star', LucideStar)
export const Sun = themedIcon('Sun', LucideSun)
export const Target = themedIcon('Target', LucideTarget)
export const Trash2 = themedIcon('Trash2', LucideTrash2)
export const TriangleAlert = themedIcon('TriangleAlert', LucideTriangleAlert)
export const Upload = themedIcon('Upload', LucideUpload)
export const Users = themedIcon('Users', LucideUsers)
export const Utensils = themedIcon('Utensils', LucideUtensils)
export const Wallet = themedIcon('Wallet', LucideWallet)
export const Wrench = themedIcon('Wrench', LucideWrench)
export const X = themedIcon('X', LucideX)
