import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
}

export function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Icon className="h-12 w-12 text-muted-foreground/40" />
      <div className="text-base font-medium text-muted-foreground">{title}</div>
      {description && <div className="text-sm text-muted-foreground/60">{description}</div>}
    </div>
  )
}
