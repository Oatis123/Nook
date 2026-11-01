import { EmptyState } from '@/design/components/EmptyState'

export function PlaceholderPage({ title }: { title: string }) {
  return <EmptyState title={title} />
}
