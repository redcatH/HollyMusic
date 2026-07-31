export function LoadingSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md px-2 py-2">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-2 w-1/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
