/**
 * next/link → react-router-dom Link shim
 *
 * Vite alias 将 'next/link' 解析到本文件，
 * 使现有组件 `import Link from 'next/link'` 零修改可用。
 *
 * Next.js 的 <Link href="..."> 映射到 react-router 的 <Link to="...">，
 * 本 shim 自动将 href 转为 to，使现有组件无需修改。
 */

import { Link as RouterLink } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'

interface NextLinkProps extends Omit<LinkProps, 'to'> {
  /** Next.js 用 href，本 shim 转为 react-router 的 to */
  href: string
}

export function Link({ href, ...rest }: NextLinkProps) {
  return <RouterLink to={href} {...rest} />
}

export default Link
