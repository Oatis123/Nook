import * as Lucide from 'lucide-react'
import { clsx } from 'clsx'

export interface IconProps extends Pick<
  Lucide.LucideProps,
  'className' | 'style' | 'strokeWidth' | 'aria-label'
> {
  size?: number
}

export type AppIcon = ReturnType<typeof themedIcon>

function themedIcon(LineIcon: Lucide.LucideIcon) {
  function Icon({
    size = 24,
    strokeWidth = 1.75,
    className,
    style,
    'aria-label': label,
  }: IconProps) {
    return (
      <LineIcon
        size={size}
        strokeWidth={strokeWidth}
        className={clsx('ui-icon shrink-0', className)}
        style={style}
        aria-label={label}
        aria-hidden={!label}
        role={label ? 'img' : undefined}
      />
    )
  }
  Icon.displayName = LineIcon.displayName
  return Icon
}

export const AlertTriangle = themedIcon(Lucide.AlertTriangle)
export const ArrowLeft = themedIcon(Lucide.ArrowLeft)
export const Baby = themedIcon(Lucide.Baby)
export const Bike = themedIcon(Lucide.Bike)
export const BookOpen = themedIcon(Lucide.BookOpen)
export const Briefcase = themedIcon(Lucide.Briefcase)
export const Calendar = themedIcon(Lucide.Calendar)
export const CalendarClock = themedIcon(Lucide.CalendarClock)
export const CalendarRange = themedIcon(Lucide.CalendarRange)
export const Camera = themedIcon(Lucide.Camera)
export const Car = themedIcon(Lucide.Car)
export const Check = themedIcon(Lucide.Check)
export const ChevronLeft = themedIcon(Lucide.ChevronLeft)
export const ChevronRight = themedIcon(Lucide.ChevronRight)
export const ChevronsUpDown = themedIcon(Lucide.ChevronsUpDown)
export const Code = themedIcon(Lucide.Code)
export const Coffee = themedIcon(Lucide.Coffee)
export const Copy = themedIcon(Lucide.Copy)
export const Download = themedIcon(Lucide.Download)
export const Dumbbell = themedIcon(Lucide.Dumbbell)
export const Eye = themedIcon(Lucide.Eye)
export const EyeOff = themedIcon(Lucide.EyeOff)
export const File = themedIcon(Lucide.File)
export const FilePlus = themedIcon(Lucide.FilePlus)
export const FileText = themedIcon(Lucide.FileText)
export const Flag = themedIcon(Lucide.Flag)
export const Folder = themedIcon(Lucide.Folder)
export const FolderPlus = themedIcon(Lucide.FolderPlus)
export const Gamepad2 = themedIcon(Lucide.Gamepad2)
export const Gift = themedIcon(Lucide.Gift)
export const GraduationCap = themedIcon(Lucide.GraduationCap)
export const Hash = themedIcon(Lucide.Hash)
export const Heart = themedIcon(Lucide.Heart)
export const Home = themedIcon(Lucide.Home)
export const Inbox = themedIcon(Lucide.Inbox)
export const Lightbulb = themedIcon(Lucide.Lightbulb)
export const Link2 = themedIcon(Lucide.Link2)
export const ListTodo = themedIcon(Lucide.ListTodo)
export const Mail = themedIcon(Lucide.Mail)
export const Menu = themedIcon(Lucide.Menu)
export const Monitor = themedIcon(Lucide.Monitor)
export const Moon = themedIcon(Lucide.Moon)
export const MoreHorizontal = themedIcon(Lucide.MoreHorizontal)
export const Music = themedIcon(Lucide.Music)
export const Network = themedIcon(Lucide.Network)
export const Palette = themedIcon(Lucide.Palette)
export const PanelLeft = themedIcon(Lucide.PanelLeft)
export const PanelRight = themedIcon(Lucide.PanelRight)
export const Paperclip = themedIcon(Lucide.Paperclip)
export const Pencil = themedIcon(Lucide.Pencil)
export const PawPrint = themedIcon(Lucide.PawPrint)
export const Plane = themedIcon(Lucide.Plane)
export const Plus = themedIcon(Lucide.Plus)
export const Repeat = themedIcon(Lucide.Repeat)
export const Search = themedIcon(Lucide.Search)
export const Send = themedIcon(Lucide.Send)
export const Settings = themedIcon(Lucide.Settings)
export const Shield = themedIcon(Lucide.Shield)
export const ShoppingCart = themedIcon(Lucide.ShoppingCart)
export const SkipForward = themedIcon(Lucide.SkipForward)
export const Sparkles = themedIcon(Lucide.Sparkles)
export const Star = themedIcon(Lucide.Star)
export const Sun = themedIcon(Lucide.Sun)
export const Target = themedIcon(Lucide.Target)
export const Trash2 = themedIcon(Lucide.Trash2)
export const TriangleAlert = themedIcon(Lucide.TriangleAlert)
export const Upload = themedIcon(Lucide.Upload)
export const Users = themedIcon(Lucide.Users)
export const Utensils = themedIcon(Lucide.Utensils)
export const Wallet = themedIcon(Lucide.Wallet)
export const Wrench = themedIcon(Lucide.Wrench)
export const X = themedIcon(Lucide.X)
