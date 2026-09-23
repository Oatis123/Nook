import type { AppIcon } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'

export function PlaceholderPage({ icon, title }: { icon: AppIcon; title: string }) {
  return <EmptyState icon={icon} title={title} />
}
