
import { usePlayerStore } from '@/lib/store/player-store'
import { ProgressBar } from './ProgressBar'
import { Volume2, VolumeX, ListMusic, Mic2 } from 'lucide-react'

export function VolumeControl() {
  const volume = usePlayerStore(s => s.volume)
  const isMuted = usePlayerStore(s => s.isMuted)
  const setVolume = usePlayerStore(s => s.setVolume)
  const toggleMute = usePlayerStore(s => s.toggleMute)
  const toggleQueue = usePlayerStore(s => s.toggleQueue)
  const toggleLyrics = usePlayerStore(s => s.toggleLyrics)

  const VolIcon = isMuted || volume === 0 ? VolumeX : Volume2

  return (
    <div className="hidden items-center justify-end gap-2 md:flex md:w-[30%]">
      <button onClick={toggleLyrics} className="text-muted-foreground hover:text-foreground" aria-label="歌词">
        <Mic2 className="h-4 w-4" />
      </button>
      <button onClick={toggleQueue} className="text-muted-foreground hover:text-foreground" aria-label="播放队列">
        <ListMusic className="h-4 w-4" />
      </button>
      <button onClick={toggleMute} className="text-muted-foreground hover:text-foreground" aria-label="静音">
        <VolIcon className="h-5 w-5" />
      </button>
      <div className="w-24">
        <ProgressBar value={isMuted ? 0 : volume * 100} onChange={pct => setVolume(pct / 100)} />
      </div>
    </div>
  )
}
