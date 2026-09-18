// Listen logo (designer artwork, raster). Served by the host from
// `/media-listen-logo.png`; rendered as a square image so it weighs the same
// as its neighbours in the waffle menu. Signature matches the icon slots
// (size + className + title).
interface ListenLogoProps {
  size?:      number
  className?: string
  title?:     string
}

export function ListenLogo({ size = 24, className, title = 'Listen' }: ListenLogoProps) {
  return (
    <img
      src="/media-listen-logo.png"
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}

export default ListenLogo
