import { useEffect, useState } from 'react'

const FAILED_COVER = '/icons/404.png'

/** 远程封面统一走同源代理：平台图片域名常被浏览器广告拦截/跟踪防护屏蔽（ERR_BLOCKED_BY_CLIENT）。 */
function toProxySrc(src: string): string {
  if (!src || src.startsWith('/')) return src || FAILED_COVER
  return `/api/image-proxy?url=${encodeURIComponent(src)}`
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
