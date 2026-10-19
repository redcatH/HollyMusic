import { useLocation, useNavigate } from 'react-router-dom'
import { EqualizerPanel } from '@/components/player/EqualizerPanel'
import { useAuthStore } from '@/hooks/useAuth'

export function EqualizerPage({ audio }: { audio: HTMLAudioElement | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const offline = useAuthStore(state => state.offlineUsername)
  const back = () => {
    if (location.state?.equalizerEntry) void navigate(-1)
    else void navigate(offline ? '/offline' : '/', { replace: true })
  }
  return <div className="page-shell mx-auto max-w-[1180px]">
    <EqualizerPanel audio={audio} onBack={back} />
  </div>
}
