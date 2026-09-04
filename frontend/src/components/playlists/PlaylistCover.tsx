import { useEffect, useState } from 'react'
import { ListMusic } from 'lucide-react'
import { buildCoverUrl } from '@/lib/api/music'

interface Props {
  coverArt: string | null
  coverSongUid: string | null
  className?: string
}

/** 自定义封面优先；未设置时使用歌单第一首歌的封面。 */
export function PlaylistCover({ coverArt, coverSongUid, className = '' }: Props) {
  const src = coverArt || (coverSongUid ? buildCoverUrl(coverSongUid) : null)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setHasError(false)
  }, [src])

  if (!src || hasError) {
    return (
      <div className={`flex items-center justify-center rounded bg-gradient-to-br from-primary/30 to-primary/10 ${className}`}>
        <ListMusic className="h-1/3 w-1/3 text-primary/70" />
      </div>
    )
  }

  return <img src={src} alt="" loading="lazy" onError={() => setHasError(true)} className={`rounded object-cover ${className}`} />
}
