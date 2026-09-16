import type { LucideIcon } from 'lucide-react'
import { EmptyState } from '@/design/components/EmptyState'

export function PlaceholderPage({ icon, title }: { icon: LucideIcon; title: string }) {
  return <EmptyState icon={icon} title={title} />
}
