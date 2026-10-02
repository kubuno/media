import type { ImgHTMLAttributes } from 'react'
import { useSignedUrl } from '@kubuno/sdk'

/** `<img>` whose `src` gets a signed ticket when it points to a private API
 *  route (e.g. local album covers). External URLs (TMDB…) pass through
 *  unchanged. Renders nothing until the ticket is available. */
export function SignedImg({ src, alt = '', ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string | null | undefined }) {
  const signed = useSignedUrl(src)
  if (!signed) return null
  return <img src={signed} alt={alt} {...rest} />
}
