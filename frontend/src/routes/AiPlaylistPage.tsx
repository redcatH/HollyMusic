/**
 * AI 协助建歌单 - 入口页
 * 按视口宽度分发 PC / 移动两套 UI（逻辑共用 useAiPlaylist）。
 * 路由 /playlists/ai-create → new 模式；/playlists/:id/ai-add → add 模式。
 * ponytail: 用 matchMedia 监听断点，无第三方依赖。
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAiPlaylist } from '@@/hooks/useAiPlaylist'
import { AiPlaylistDesktop } from '@@/components/playlist-assist/AiPlaylistDesktop'
import { AiPlaylistMobile } from '@@/components/playlist-assist/AiPlaylistMobile'

const MOBILE_QUERY = '(max-width: 767px)'

export function AiPlaylistPage() {
  const { id: idStr } = useParams<{ id: string }>()
  const playlistId = idStr ? parseInt(idStr, 10) : undefined
  const ai = useAiPlaylist({ mode: idStr ? 'add' : 'new', playlistId })

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  return isMobile ? <AiPlaylistMobile ai={ai} /> : <AiPlaylistDesktop ai={ai} />
}
