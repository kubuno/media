import { useEffect, useRef, useState } from 'react'

// ── Self-effacing title-bar label ────────────────────────────────────────────
//
// FloatingWindow lets its title wrap so a long dialog heading pushes the band
// down instead of being clipped. That is right for a dialog, wrong for a media
// player: its band carries up to six action buttons, so at the minimum window
// width the leftover space is a few dozen pixels — enough to break
// "Parle-moi (feat. Zaho)" onto four lines and turn the accent band into a
// block three times its height.
//
// This label measures the room it is actually given and gives way instead:
// the icon goes first (it buys ~25px for the text), then the text itself.
// Nothing is lost — every one of these windows already shows the track or file
// name in its body.

/** Below this the text is too short to be read: drop it entirely. */
const MIN_TEXT_W = 64
/** Below this the icon is stealing room the text needs more than it does. */
const MIN_ICON_W = 140

export function WindowTitle({ text, icon }: { text: string; icon?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // null = not measured yet (SSR / first paint): render everything, the
  // observer corrects on the very next frame.
  const [avail, setAvail] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // The host cell is `flex-1 min-w-0`, so its width is pure leftover space
    // and never depends on what we render inside it — no measure/render loop.
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number') setAvail(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const showText = avail === null || avail >= MIN_TEXT_W
  const showIcon = !!icon && (avail === null || avail >= MIN_ICON_W)

  return (
    <div ref={ref} className="flex items-center gap-2.5 min-w-0 overflow-hidden">
      {showIcon && <span className="flex-shrink-0 flex items-center">{icon}</span>}
      {showText && <span className="truncate" title={text}>{text}</span>}
    </div>
  )
}
