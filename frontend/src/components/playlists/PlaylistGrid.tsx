
import { Link } from 'react-router-dom'
import type { PlaylistSummary } from '@/lib/api/playlists'
import { ListMusic } from 'lucide-react'

export function PlaylistGrid({ playlists }: { playlists: PlaylistSummary[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {playlists.map(p => (
        <Link
          key={p.id}
          to={`/playlists/${p.id}`}
          className="group flex flex-col gap-2 rounded-lg p-2 hover:bg-accent/40"
        >
          <div className="flex aspect-square items-center justify-center rounded bg-gradient-to-br from-primary/30 to-primary/10">
            <ListMusic className="h-10 w-10 text-primary/70" />
          </div>
          <div className="truncate text-sm font-medium">{p.name}</div>
          <div className="text-xs text-muted-foreground">{p.songCount} 首</div>
        </Link>
      ))}
    </div>
  )
}
