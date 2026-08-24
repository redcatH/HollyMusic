import { useEffect, useState } from 'react'

const FAILED_COVER = '/icons/404.png'

/** 实测仅 gtimg.cn 域名族会被浏览器广告拦截/跟踪防护屏蔽（ERR_BLOCKED_BY_CLIENT），
 *  qpic/126.net/kuwo/kugou/migu 各域直连均正常——只对被拦域走同源代理。 */
const PROXY_HOSTS = ['gtimg.cn']

function toProxySrc(src: string): string {
  if (!src || src.startsWith('/')) return src || FAILED_COVER
  try {
    const host = new URL(src).hostname
    if (PROXY_HOSTS.some(s => host === s || host.endsWith(`.${s}`))) {
      return `/api/image-proxy?url=${encodeURIComponent(src)}`
    }
  } catch {
    // 非法 URL 原样返回，由 onError 占位兜底
  }
  return src
}

interface RemoteCoverImageProps {
  src: string
  alt: string
  className?: string
}

/** 远程封面请求失败时，统一展示本地失败占位图。 */
export function RemoteCoverImage({ src, alt, className }: RemoteCoverImageProps) {
  const [imageSrc, setImageSrc] = useState(() => toProxySrc(src))

  useEffect(() => {
    setImageSrc(toProxySrc(src))
  }, [src])

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (imageSrc !== FAILED_COVER) setImageSrc(FAILED_COVER)
      }}
    />
  )
}
