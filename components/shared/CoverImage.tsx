
import { useState } from 'react'
import { buildCoverUrl } from '@/lib/api/music'
import { Music2 } from 'lucide-react'

interface CoverImageProps {
  uid: string
  className?: string
}

export function CoverImage({ uid, className = '' }: CoverImageProps) {
  const [error, setError] = useState(false)

  if (error || !uid) {
    return (
      <div className={`flex items-center justify-center rounded bg-muted text-muted-foreground ${className}`}>
        <Music2 className="h-1/2 w-1/2" />
      </div>
    )
  }

  return (
    <img
      src={buildCoverUrl(uid)}
      onError={() => setError(true)}
      alt=""
      loading="lazy"
      className={`rounded object-cover ${className}`}
    />
  )
}
