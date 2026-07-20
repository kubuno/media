// Session keep-awake during playback: the core shell counts media playback
// as user activity (no idle lock/logout while something is playing).
//
// The core already probes <audio>/<video> elements in the DOM; this file covers
// our OFF-DOM players (`new Audio()` of the music/radio player and the DJ
// decks) via the `kubuno:media-activity` event contract (no cross-import
// between core and module).

type IsPlaying = () => boolean

const sources = new Set<IsPlaying>()
let timer: ReturnType<typeof setInterval> | null = null

// Cadence: well below the smallest possible inactivity window (1 min).
const PING_EVERY_MS = 25_000

function tick() {
  let playing = false
  for (const isPlaying of sources) {
    try { if (isPlaying()) { playing = true; break } } catch { /* faulty source: ignored */ }
  }
  if (playing) window.dispatchEvent(new Event('kubuno:media-activity'))
}

/**
 * Registers a playback source (called once per player store). The callback is
 * polled periodically; as long as it returns true, the session is kept awake.
 */
export function registerMediaActivitySource(isPlaying: IsPlaying): void {
  sources.add(isPlaying)
  if (timer == null && typeof window !== 'undefined') {
    timer = setInterval(tick, PING_EVERY_MS)
  }
}
