import * as chrono from 'chrono-node'
import { format } from 'date-fns'
import type { TaskPriority } from '@/lib/types'

export interface ParsedQuickAdd {
  title: string
  dueDate: string | null
  dueTime: string | null
  priority: TaskPriority | null
  listName: string | null
}

const PRIORITY_RE = /(?:^|\s)!(low|medium|high)\b/i
const LIST_RE = /(?:^|\s)#(\S+)/

function removeMatch(text: string, match: RegExpExecArray): string {
  return (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim()
}

/** `Call mom tomorrow 18:00 !high #Personal` → date/time (chrono-node, English), priority
 * (`!low`/`!medium`/`!high`), list (`#ListName`, no spaces — same convention Todoist/TickTick
 * use for quick add). Recurrence ("every monday 9am") is deferred to Stage 9 alongside the
 * rest of the recurring-task machinery it depends on (see DECISIONS.md). */
export function parseQuickAdd(raw: string): ParsedQuickAdd {
  let text = raw

  let priority: TaskPriority | null = null
  const priorityMatch = PRIORITY_RE.exec(text)
  if (priorityMatch) {
    priority = priorityMatch[1].toLowerCase() as TaskPriority
    text = removeMatch(text, priorityMatch)
  }

  let listName: string | null = null
  const listMatch = LIST_RE.exec(text)
  if (listMatch) {
    listName = listMatch[1]
    text = removeMatch(text, listMatch)
  }

  let dueDate: string | null = null
  let dueTime: string | null = null
  const [result] = chrono.parse(text, new Date(), { forwardDate: true })
  if (result) {
    const dt = result.start.date()
    dueDate = format(dt, 'yyyy-MM-dd')
    if (result.start.isCertain('hour')) {
      dueTime = format(dt, 'HH:mm:ss')
    }
    text = (text.slice(0, result.index) + text.slice(result.index + result.text.length)).trim()
  }

  const title = text.replace(/\s+/g, ' ').trim()
  return { title, dueDate, dueTime, priority, listName }
}
