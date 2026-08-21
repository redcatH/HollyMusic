import { useEffect, useState } from 'react'

const FAILED_COVER = '/icons/404.png'

interface RemoteCoverImageProps {
  src: string
  alt: string
  className?: string
}

/** 远程封面请求失败时，统一展示本地失败占位图。 */
export function RemoteCoverImage({ src, alt, className }: RemoteCoverImageProps) {
  const [imageSrc, setImageSrc] = useState(src || FAILED_COVER)

  useEffect(() => {
    setImageSrc(src || FAILED_COVER)
  }, [src])

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        if (imageSrc !== FAILED_COVER) setImageSrc(FAILED_COVER)
      }}
    />
  )
}
