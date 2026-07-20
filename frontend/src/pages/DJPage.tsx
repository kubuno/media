import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft, Play, Pause, SkipBack, SkipForward,
  Search, Loader2, Music, Disc3, Mic2, ListMusic,
  Circle, Sliders, X, GripVertical, Shuffle, Repeat, Repeat1,
} from 'lucide-react'
import { useChromelessHeader, HeaderActions } from '@kubuno/sdk'
import { MenuDropdown, RangeSlider, type MenuItem, type MenuDropdownPos } from '@ui'
import { useDJStore, djEngine, djMasterAnalyser, djTrackPeaks, djStemReady, EQ_PRESETS, EQ_FREQS, WAVE_STYLES, BEAT_FX_TYPES, BEAT_DIVISIONS, HOT_CUE_COLORS, SAMPLE_NAMES, TRANSITION_STYLES, MIDI_TARGETS,
         STEM_MODES, DECK_COUNTS,
         type CrossfaderCurve, type DeckState, type PadMode, type ColorFx, type HotCue, type WaveStyle,
         type DeckId, type DeckCount, type StemMode, type XfAssign } from '../store/djStore'
import { mediaApi, formatDuration, posterUrl } from '../api'

// ── Palette ─────────────────────────────────────────────────────────────────
// Hardware look: matte charcoal chassis (Pioneer-style) with neon deck accents.
// Colour rules from the user: NO cyan, NO violet, NO pink — blue + orange lead,
// amber for master/branding, green/yellow/red/white for the extra decks.

const COL_A  = '#2f7dff'   // electric blue — deck A
const COL_B  = '#ff7a1a'   // orange        — deck B
const ACCENT = '#ffb02e'   // amber         — master / branding / crossfader

const DECK_FIELD = { A: 'deckA', B: 'deckB', C: 'deckC', D: 'deckD', E: 'deckE', F: 'deckF' } as const
const DECK_COLOR: Record<DeckId, string> = {
  A: '#2f7dff', B: '#ff7a1a', C: '#3ddc84', D: '#ffd02e', E: '#ff5252', F: '#e8e9ee',
}

const UI = {
  text:    '#f1f2f4',
  soft:    '#c7c9ce',
  muted:   '#8d9099',   // graphite grey
  dim:     '#5d6069',
  border:  '#34373e',
  border2: '#4a4e57',
  well:    '#08090b',   // dark "screen" background
  card:    '#222429',
  card2:   '#2c2f36',
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  const s = Math.floor(Math.max(0, secs))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function fmtR(pos: number, dur: number): string {
  return `-${fmt(Math.max(0, dur - pos))}`
}

function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

// Harmonic mixing (Camelot wheel) compatibility.
function camelotOf(keyName: string | null | undefined): string | null {
  if (!keyName) return null
  const m = keyName.match(/(\d+)([AB])/)
  return m ? m[1] + m[2] : null
}
function harmonicCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = camelotOf(a), cb = camelotOf(b)
  if (!ca || !cb) return false
  if (ca === cb) return true
  const na = parseInt(ca), la = ca.slice(-1), nb = parseInt(cb), lb = cb.slice(-1)
  if (la === lb && (Math.abs(na - nb) === 1 || Math.abs(na - nb) === 11)) return true  // ±1 on the wheel
  if (na === nb && la !== lb) return true                                              // relative major/minor
  return false
}

// ── CSS injected once ─────────────────────────────────────────────────────────

const DJ_CSS = `
  @keyframes djSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
  @keyframes djRecPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
  @keyframes djGlow { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }
  .dj-row-hover:hover { background: rgba(255,255,255,0.06) !important; }
  .dj-fx-btn { transition: all .12s ease }
  .dj-fx-btn:hover { filter: brightness(1.25) }
  .dj-lib-scroll::-webkit-scrollbar { width: 10px }
  .dj-lib-scroll::-webkit-scrollbar-thumb { background: ${UI.border}; border-radius: 5px }
  .dj-lib-scroll::-webkit-scrollbar-track { background: transparent }
`

// Per-deck panel background: charcoal chassis with a faint colour halo on top.
function deckBg(color: string): string {
  return `radial-gradient(130% 80% at 50% 0%, ${rgba(color, 0.10)} 0%, rgba(0,0,0,0) 60%),`
       + ` linear-gradient(180deg, #26282e 0%, #1c1e23 55%, #141519 100%)`
}

// ── Knob ─────────────────────────────────────────────────────────────────────

function Knob({ value, min, max, onChange, label, size = 44, color = COL_A, unit = '' }: {
  value: number; min: number; max: number; onChange: (v: number) => void
  label: string; size?: number; color?: string; unit?: string
}) {
  const knobRef  = useRef<HTMLDivElement>(null)
  const startVal = useRef(value)
  const dragging = useRef(false)
  const rotation = -135 + ((value - min) / (max - min)) * 270

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = true
    startVal.current = value
    e.preventDefault()

    const rect = knobRef.current!.getBoundingClientRect()
    const cx   = rect.left + rect.width  / 2
    const cy   = rect.top  + rect.height / 2
    let lastAngle  = Math.atan2(e.clientY - cy, e.clientX - cx)
    let accumulated = 0

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx)
      let delta   = angle - lastAngle
      if (delta >  Math.PI) delta -= 2 * Math.PI
      if (delta < -Math.PI) delta += 2 * Math.PI
      lastAngle    = angle
      accumulated += delta
      // 270° total arc = 3π/2 radians
      const newVal = Math.max(min, Math.min(max,
        startVal.current + (accumulated / (Math.PI * 1.5)) * (max - min)))
      onChange(Math.round(newVal * 100) / 100)
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const display = value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
  // Value arc (270°, from -135° to +135°) drawn under the cap.
  const frac = (value - min) / (max - min)

  return (
    <div className="flex flex-col items-center gap-0.5 select-none" style={{ minWidth: size }}>
      <div
        ref={knobRef}
        className="relative cursor-pointer"
        style={{ width: size, height: size }}
        onMouseDown={onMouseDown}
        onDoubleClick={() => onChange((min + max) / 2)}
        title="Double-clic : réinitialiser"
      >
        {/* Colored value arc around the cap */}
        <div className="absolute inset-0 rounded-full" style={{
          background: `conic-gradient(from 225deg, ${color} 0deg, ${color} ${frac * 270}deg, rgba(255,255,255,0.10) ${frac * 270}deg, rgba(255,255,255,0.10) 270deg, transparent 270deg)`,
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
          filter: `drop-shadow(0 0 3px ${rgba(color, 0.5)})`,
        }} />
        {/* Hardware-style cap: metal ring + rubber face */}
        <div className="absolute rounded-full" style={{
          inset: 3,
          background: 'conic-gradient(from 210deg, #4a4e57, #23252b 25%, #3b3e46 50%, #1c1e23 75%, #4a4e57)',
          boxShadow: '0 2px 5px rgba(0,0,0,0.6)',
        }} />
        <div className="absolute rounded-full" style={{
          inset: 5,
          background: 'radial-gradient(circle at 36% 28%, #34373e, #17181c 72%)',
          boxShadow: 'inset 0 1px 3px rgba(255,255,255,0.10), inset 0 -2px 5px rgba(0,0,0,0.7)',
        }} />
        {/* Position marker */}
        <div className="absolute inset-0" style={{ transform: `rotate(${rotation}deg)` }}>
          <div className="absolute" style={{
            top: 6, left: '50%', marginLeft: -1,
            width: 2, height: size * 0.24,
            background: '#f4f5f7', borderRadius: 1,
            boxShadow: `0 0 5px ${rgba(color, 0.8)}`,
          }} />
        </div>
      </div>
      <p style={{ color: UI.muted, fontSize: 9, textAlign: 'center', letterSpacing: 0.8, fontWeight: 600 }}>{label}</p>
      <p style={{ color, fontSize: 9, fontFamily: 'monospace', textAlign: 'center' }}>{display}{unit}</p>
    </div>
  )
}

// ── Vertical fader ────────────────────────────────────────────────────────────

function VertFader({ value, onChange, height = 96, color = COL_A, min = 0, max = 1, step = 0.01, center = false }: {
  value: number; onChange: (v: number) => void; height?: number | string; color?: string
  min?: number; max?: number; step?: number
  /** Bipolaire (TEMPO) : le niveau se dessine depuis le centre, pas depuis le bas. */
  center?: boolean
}) {
  // Hardware-style fader: dark groove + colored level + ribbed cap.
  const trackRef = useRef<HTMLDivElement>(null)

  const valueFromY = useCallback((clientY: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
    const snapped = Math.round((min + f * (max - min)) / step) * step
    return Math.max(min, Math.min(max, Math.round(snapped * 1000) / 1000))
  }, [min, max, step])

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    onChange(valueFromY(e.clientY))
    const move = (ev: PointerEvent) => onChange(valueFromY(ev.clientY))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const frac = (value - min) / (max - min)           // 0 (bas) → 1 (haut)
  const fillFrom = center ? 0.5 : 0
  const fillLo = Math.min(fillFrom, frac), fillHi = Math.max(fillFrom, frac)

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      role="slider" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100}
      aria-label="Fader" aria-orientation="vertical"
      className="relative select-none cursor-pointer"
      style={{ height, width: 26, touchAction: 'none' }}
    >
      {/* Rainure */}
      <div className="absolute rounded-full" style={{
        left: '50%', marginLeft: -3, top: 2, bottom: 2, width: 6,
        background: '#0a0b0d',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.06)',
      }} />
      {/* Niveau (sous le capuchon) */}
      <div className="absolute rounded-full" style={{
        left: '50%', marginLeft: -2, width: 4,
        bottom: `${fillLo * 100}%`,
        height: `${(fillHi - fillLo) * 100}%`,
        background: `linear-gradient(180deg, ${color}, ${rgba(color, 0.55)})`,
        boxShadow: `0 0 6px ${rgba(color, 0.45)}`,
      }} />
      {/* Graduations */}
      {[0.25, 0.5, 0.75].map(f => (
        <div key={f} className="absolute" style={{
          left: 0, right: 0, top: `${(1 - f) * 100}%`, height: 1,
          background: f === 0.5 && center ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)',
        }} />
      ))}
      {/* Ribbed cap */}
      <div className="absolute rounded-[3px]" style={{
        left: '50%', marginLeft: -13, width: 26, height: 15,
        top: `calc(${(1 - frac) * 100}% - 7px)`,
        background: 'linear-gradient(180deg, #3c3f47 0%, #23252b 45%, #17181c 55%, #2c2f36 100%)',
        border: '1px solid #0c0d10',
        boxShadow: `0 2px 5px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.14)`,
      }}>
        <div className="absolute" style={{
          left: 3, right: 3, top: '50%', marginTop: -1, height: 2,
          background: color, borderRadius: 1, boxShadow: `0 0 5px ${rgba(color, 0.8)}`,
        }} />
      </div>
    </div>
  )
}

// Hardware-style horizontal crossfader (groove + ribbed cap, no fill).
function HorizFader({ value, onChange, color = ACCENT, min = -1, max = 1, step = 0.01, width, height = 26, label = 'Fader' }: {
  value: number; onChange: (v: number) => void; color?: string; min?: number; max?: number; step?: number
  width?: number | string; height?: number; label?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const valueFromX = useCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const snapped = Math.round((min + f * (max - min)) / step) * step
    return Math.max(min, Math.min(max, Math.round(snapped * 1000) / 1000))
  }, [min, max, step])

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    onChange(valueFromX(e.clientX))
    const move = (ev: PointerEvent) => onChange(valueFromX(ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const frac = (value - min) / (max - min)
  const capW = Math.max(11, Math.round(height * 0.58))
  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      role="slider" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
      aria-label={label}
      className={width == null ? 'relative select-none cursor-pointer w-full shrink-0' : 'relative select-none cursor-pointer shrink-0'}
      style={{ height, width, touchAction: 'none' }}
    >
      <div className="absolute rounded-full" style={{
        top: '50%', marginTop: -3, left: 2, right: 2, height: 6,
        background: '#0a0b0d',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.06)',
      }} />
      {/* Tick marks (center emphasized) */}
      {[0.25, 0.5, 0.75].map(f => (
        <div key={f} className="absolute" style={{
          top: 2, bottom: 2, left: `${f * 100}%`, width: 1,
          background: f === 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)',
        }} />
      ))}
      {/* Ribbed cap (vertical ridges) */}
      <div className="absolute rounded-[3px]" style={{
        top: '50%', marginTop: -height / 2, width: capW, height,
        left: `calc(${frac * 100}% - ${capW / 2}px)`,
        background: 'linear-gradient(90deg, #3c3f47 0%, #23252b 45%, #17181c 55%, #2c2f36 100%)',
        border: '1px solid #0c0d10',
        boxShadow: `0 2px 5px rgba(0,0,0,0.65), inset 1px 0 0 rgba(255,255,255,0.14)`,
      }}>
        <div className="absolute" style={{
          top: 3, bottom: 3, left: '50%', marginLeft: -1, width: 2,
          background: color, borderRadius: 1, boxShadow: `0 0 5px ${rgba(color, 0.8)}`,
        }} />
      </div>
    </div>
  )
}

// ── VU meter ──────────────────────────────────────────────────────────────────

const VU_W = 10   // CSS width of the meter

function VUMeter({ analyser, color, height = 96, fill = false }: { analyser: AnalyserNode | null; color: string; height?: number; fill?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number | null>(null)
  // Match the canvas backing store to its rendered size (× DPR) so the bars stay
  // crisp instead of being blurrily upscaled when the meter stretches to fill.
  const [hPx, setHPx] = useState(Math.round(height * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)))
  useEffect(() => {
    const el = canvasRef.current
    if (!fill || !el || typeof ResizeObserver === 'undefined') {
      setHPx(Math.round(height * (window.devicePixelRatio || 1)))
      return
    }
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      setHPx(Math.max(16, Math.round(el.clientHeight * dpr)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    const BARS = Math.max(10, Math.round(H / 22))

    function draw() {
      rafRef.current = requestAnimationFrame(draw)
      ctx.fillStyle = UI.well
      ctx.fillRect(0, 0, W, H)

      let level = 0
      if (analyser) {
        const buf = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(buf)
        level = buf.reduce((a, b) => a + b, 0) / buf.length / 255
      }

      const bH = H / BARS - 1
      for (let i = 0; i < BARS; i++) {
        const t   = (BARS - 1 - i) / BARS
        const lit = level > t
        const c   = i < 2 ? '#ff3344' : i < 4 ? '#ffaa00' : color
        ctx.fillStyle = rgba(c, lit ? 0.95 : 0.14)
        ctx.fillRect(0, i * (bH + 1), W, bH)
      }
    }

    draw()
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [analyser, color, hPx])

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return (
    <canvas
      ref={canvasRef}
      width={Math.round(VU_W * dpr)}
      height={hPx}
      style={{ borderRadius: 2, width: VU_W, height: fill ? '100%' : height }}
    />
  )
}

// ── Master level meter + clip indicator ───────────────────────────────────────

function MasterMeter() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const clipRef   = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height, SEGS = 22
    const buf = new Uint8Array(1024)
    let raf = 0, clipUntil = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const an = djMasterAnalyser()
      ctx.clearRect(0, 0, W, H)
      let peak = 0
      if (an) { an.getByteTimeDomainData(buf); for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128) / 128; if (v > peak) peak = v } }
      for (let i = 0; i < SEGS; i++) {
        const t = i / SEGS
        const c = i >= SEGS - 2 ? '#ff3344' : i >= SEGS - 5 ? '#ffaa00' : COL_A
        ctx.fillStyle = peak > t ? c : rgba(c, 0.12)
        ctx.fillRect(i * (W / SEGS), 0, W / SEGS - 1, H)
      }
      if (peak >= 0.99) clipUntil = performance.now() + 500
      if (clipRef.current) clipRef.current.style.opacity = performance.now() < clipUntil ? '1' : '0.25'
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="flex items-center gap-1.5" title="Niveau master / saturation">
      <canvas ref={canvasRef} width={96} height={8} style={{ borderRadius: 2 }} />
      <div ref={clipRef} style={{ width: 7, height: 7, borderRadius: 99, background: '#ff3344', opacity: 0.25, transition: 'opacity .1s' }} />
    </div>
  )
}

// ── Waveform (frequency spectrum, real-time) ──────────────────────────────────

function DJWaveform({ analyser, position, duration, color, onSeek, height = 84, style = 'blob' }: {
  analyser: AnalyserNode | null
  position: number; duration: number; color: string
  onSeek: (s: number) => void; height?: number; style?: WaveStyle
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef<number | null>(null)
  const posRef     = useRef(position)
  const durRef     = useRef(duration)
  const dragging   = useRef(false)
  const [dragPos,  setDragPos] = useState<number | null>(null)
  const dragPosRef = useRef<number | null>(null)

  useEffect(() => { posRef.current = position }, [position])
  useEffect(() => { durRef.current = duration  }, [duration])
  useEffect(() => { dragPosRef.current = dragPos }, [dragPos])

  const timeAt = useCallback((clientX: number): number => {
    const canvas = canvasRef.current
    if (!canvas || !durRef.current) return 0
    const rect = canvas.getBoundingClientRect()
    return Math.max(0, Math.min(durRef.current, ((clientX - rect.left) / rect.width) * durRef.current))
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return
      const t = timeAt(e.clientX)
      setDragPos(t)
      onSeek(t)
    }
    const up = () => { dragging.current = false; setDragPos(null) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup',   up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [timeAt, onSeek])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    // Lighter shade of `color` for gradients (mix toward white).
    const lighten = (hex: string, amt: number) => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
      const m = (c: number) => Math.round(c + (255 - c) * amt)
      return `rgb(${m(r)},${m(g)},${m(b)})`
    }

    // Smoothed envelope + animation phase for the ribbon/wire styles.
    const ENVN = 96
    const env = new Float32Array(ENVN)
    let phase = 0

    function draw() {
      rafRef.current = requestAnimationFrame(draw)
      const W = canvas!.width, H = canvas!.height, mid = H / 2

      ctx.fillStyle = UI.well
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = rgba('#ffffff', 0.05)
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()

      const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
      const time = analyser ? new Uint8Array(analyser.fftSize) : null
      if (analyser && freq && time) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(time) }

      if (analyser && freq && time) {
        const grad = ctx.createLinearGradient(0, H, 0, 0)
        grad.addColorStop(0, rgba(color, 0.55)); grad.addColorStop(1, lighten(color, 0.4))

        if (style === 'bars' || style === 'mirror' || style === 'dots') {
          const N  = Math.min(160, W >> 1)
          const bW = W / N
          for (let i = 0; i < N; i++) {
            const v  = freq[Math.floor(i * freq.length / N / 2)] / 255
            const bH = Math.max(1, v * (style === 'mirror' ? mid : H) * 0.92)
            if (style === 'dots') {
              const cells = Math.max(3, Math.floor(H / 6))
              const lit = Math.round(v * cells)
              for (let c = 0; c < lit; c++) {
                const cl = c < 2 ? '#ff4444' : c < 4 ? '#ffb020' : color
                ctx.fillStyle = rgba(cl, 0.4 + 0.6 * (c / cells))
                ctx.fillRect(i * bW + 0.5, H - (c + 1) * (H / cells) + 1, bW - 1.5, H / cells - 1.5)
              }
            } else if (style === 'mirror') {
              ctx.fillStyle = grad
              ctx.fillRect(i * bW, mid - bH, bW - 0.6, bH)
              ctx.fillStyle = rgba(color, 0.35)
              ctx.fillRect(i * bW, mid, bW - 0.6, bH)
            } else { // bars (bottom-anchored gradient)
              ctx.fillStyle = grad
              ctx.fillRect(i * bW, H - bH, bW - 0.6, bH)
            }
          }
        } else if (style === 'blob') {
          // Smooth filled area mirrored around the centre.
          const N = 64
          const pts: number[] = []
          for (let i = 0; i <= N; i++) pts.push(freq[Math.floor(i * freq.length / N / 2)] / 255)
          const x = (i: number) => (i / N) * W
          const drawHalf = (dir: number) => {
            ctx.beginPath(); ctx.moveTo(0, mid)
            for (let i = 0; i < N; i++) {
              const y1 = mid - dir * pts[i] * mid * 0.92
              const y2 = mid - dir * pts[i + 1] * mid * 0.92
              ctx.quadraticCurveTo(x(i), y1, (x(i) + x(i + 1)) / 2, (y1 + y2) / 2)
            }
            ctx.lineTo(W, mid); ctx.closePath()
          }
          ctx.fillStyle = grad; drawHalf(1); ctx.fill()
          ctx.fillStyle = rgba(color, 0.4); drawHalf(-1); ctx.fill()
        } else if (style === 'spikes') {
          // Symmetric glowing spikes with a bright core (the "lit spectrum" look).
          const N = Math.min(150, W >> 2)
          const bW = W / N
          ctx.shadowColor = color; ctx.shadowBlur = 12
          for (let i = 0; i < N; i++) {
            const v  = Math.pow(freq[Math.floor(i * freq.length / N / 2)] / 255, 1.4)
            const bH = Math.max(1, v * mid * 0.96)
            const g = ctx.createLinearGradient(0, mid - bH, 0, mid + bH)
            g.addColorStop(0, rgba(color, 0.35)); g.addColorStop(0.5, lighten(color, 0.85)); g.addColorStop(1, rgba(color, 0.35))
            ctx.fillStyle = g
            ctx.fillRect(i * bW + bW * 0.28, mid - bH, Math.max(1, bW * 0.44), bH * 2)
          }
          ctx.shadowBlur = 0
        } else if (style === 'ribbon' || style === 'wire') {
          // Flowing/nested frequency lines forming a glowing ribbon.
          // Idle ripple so the shape stays visible even when the signal is quiet.
          for (let i = 0; i < ENVN; i++) {
            const v = freq[Math.floor(i * freq.length / ENVN / 2)] / 255
            const idle = 0.12 * (0.5 + 0.5 * Math.sin(i * 0.35 + phase))
            env[i] = env[i] * 0.6 + Math.max(v, idle) * 0.4
          }
          const x = (i: number) => (i / (ENVN - 1)) * W
          const LAYERS = 20
          const lc = lighten(color, 0.35)
          ctx.lineWidth = 1.4
          ;(ctx as CanvasRenderingContext2D).globalCompositeOperation = 'lighter'
          for (let k = 0; k < LAYERS; k++) {
            const t = k / (LAYERS - 1)              // 0..1
            const dir = t * 2 - 1                   // -1..+1 (nested above/below)
            ctx.beginPath()
            for (let i = 0; i < ENVN; i++) {
              const flow = style === 'ribbon' ? Math.sin(i * 0.5 + phase + k * 0.4) * 0.35 + 1 : 1
              const amp = env[i] * mid * 0.95 * dir * flow
              const y = mid - amp
              i === 0 ? ctx.moveTo(0, y) : ctx.quadraticCurveTo(x(i - 0.5), mid - env[i - 1] * mid * 0.95 * dir * flow, x(i), y)
            }
            const edge = Math.abs(dir)
            ctx.strokeStyle = rgba(lc, 0.16 + 0.30 * (1 - edge))
            ctx.stroke()
          }
          // Bright core line
          ctx.strokeStyle = rgba(lighten(color, 0.8), 1)
          ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.lineWidth = 2
          ctx.beginPath()
          for (let i = 0; i < ENVN; i++) {
            const y = mid - env[i] * mid * 0.5
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(x(i), y)
          }
          ctx.stroke()
          ctx.shadowBlur = 0
          ;(ctx as CanvasRenderingContext2D).globalCompositeOperation = 'source-over'
          phase += 0.06
        } else { // line / dualline (oscilloscope, time domain)
          const N = W
          ctx.lineWidth = 2; ctx.strokeStyle = color
          ctx.shadowColor = color; ctx.shadowBlur = 8
          ctx.beginPath()
          for (let i = 0; i < N; i++) {
            const v = (time[Math.floor(i * time.length / N)] - 128) / 128
            const y = mid - v * mid * 0.9
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i, y)
          }
          ctx.stroke()
          if (style === 'dualline') {
            ctx.strokeStyle = rgba(lighten(color, 0.3), 0.7)
            ctx.beginPath()
            for (let i = 0; i < N; i++) {
              const v = (time[Math.floor(i * time.length / N)] - 128) / 128
              const y = mid + v * mid * 0.9
              i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i, y)
            }
            ctx.stroke()
          }
          ctx.shadowBlur = 0
        }
      } else {
        ctx.strokeStyle = rgba(color, 0.22)
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()
      }

      // Track progress marker
      const dur = durRef.current
      if (dur > 0) {
        const px = ((dragPosRef.current ?? posRef.current) / dur) * W
        ctx.strokeStyle = rgba('#ffffff', 0.6)
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 5])
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
        ctx.setLineDash([])
      }

      // Center playhead
      ctx.strokeStyle = rgba('#ffffff', 0.92)
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke()
    }

    draw()
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [analyser, color, style])

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg cursor-pointer block"
      width={760}
      height={height}
      style={{ height: '100%', border: `1px solid ${rgba(color, 0.18)}` }}
      onMouseDown={e => {
        dragging.current = true
        const t = timeAt(e.clientX)
        setDragPos(t)
        onSeek(t)
        e.stopPropagation()
      }}
      title="Cliquer/glisser pour déplacer la tête de lecture"
    />
  )
}

// ── Jog wheel ─────────────────────────────────────────────────────────────────

// Vinyl-style platter: turns at 33⅓ rpm → ~1.8 s of audio per revolution.
const SECS_PER_REV = 1.8

function JogWheel({ isPlaying, position, duration, color, size = 122,
                    onScratchStart, onScratch, onScratchEnd }: {
  isPlaying: boolean; position: number; duration: number; color: string; size?: number
  onScratchStart?: () => void
  onScratch?: (totalDeltaSecs: number) => void
  onScratchEnd?: () => void
}) {
  const prog  = duration > 0 ? position / duration : 0
  const r     = size / 2 - 8
  const circ  = 2 * Math.PI * r

  const wheelRef = useRef<HTMLDivElement>(null)
  const scratching = useRef(false)
  const accAngle   = useRef(0)            // accumulated radians since grab
  const [grab, setGrab] = useState(false)
  const [manualRot, setManualRot] = useState(0)   // platter rotation while grabbed (deg)

  function onMouseDown(e: React.MouseEvent) {
    const rect = wheelRef.current!.getBoundingClientRect()
    const cx = rect.left + rect.width  / 2
    const cy = rect.top  + rect.height / 2
    scratching.current = true
    accAngle.current = 0
    setGrab(true)
    setManualRot(0)
    onScratchStart?.()
    let lastAngle = Math.atan2(e.clientY - cy, e.clientX - cx)
    e.preventDefault()
    e.stopPropagation()

    const onMove = (ev: MouseEvent) => {
      if (!scratching.current) return
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx)
      let d = a - lastAngle
      if (d >  Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      lastAngle = a
      accAngle.current += d
      setManualRot(accAngle.current * 180 / Math.PI)
      onScratch?.((accAngle.current / (2 * Math.PI)) * SECS_PER_REV)
    }
    const onUp = () => {
      scratching.current = false
      setGrab(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onScratchEnd?.()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // While grabbed: platter follows the hand. Otherwise it spins with playback.
  const ringStyle: React.CSSProperties = grab
    ? { transform: `rotate(${manualRot}deg)`, animation: 'none' }
    : { animation: isPlaying ? 'djSpin 1.8s linear infinite' : 'none' }

  return (
    <div
      ref={wheelRef}
      className="relative flex-shrink-0 mx-auto select-none"
      style={{ width: size, height: size, cursor: grab ? 'grabbing' : 'grab' }}
      onMouseDown={onMouseDown}
      title="Saisir et tourner pour scratcher"
    >
      {/* SVG progress arc */}
      <svg className="absolute inset-0 pointer-events-none" width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={rgba('#ffffff', 0.08)} strokeWidth={5} />
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={`${prog * circ} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          opacity={0.85}
        />
      </svg>

      {/* Outer neon halo (deck color) */}
      <div className="absolute inset-0 rounded-full pointer-events-none" style={{
        boxShadow: (isPlaying || grab)
          ? `0 0 22px ${rgba(color, 0.55)}, 0 0 44px ${rgba(color, 0.18)}`
          : `0 0 10px ${rgba(color, 0.22)}`,
        border: `2px solid ${rgba(color, grab ? 0.95 : isPlaying ? 0.8 : 0.45)}`,
        transition: 'box-shadow 0.3s, border-color 0.15s',
      }} />

      {/* Vinyl platter — spins during playback, follows the hand while scratching */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: 4,
          background:
            // Reflet glossy discret en travers du disque (fondu progressif)
            'conic-gradient(from 130deg, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.05) 25deg, rgba(255,255,255,0) 55deg, rgba(255,255,255,0) 170deg, rgba(255,255,255,0.04) 200deg, rgba(255,255,255,0) 235deg),'
            // Sillons du vinyle
          + ' repeating-radial-gradient(circle at 50% 50%, #0c0d10 0px, #17181c 1.5px, #0c0d10 3px),'
          + ' radial-gradient(circle at 50% 50%, #17181c, #0a0b0d)',
          boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.8)',
          ...ringStyle,
        }}
      >
        {/* Rotation marker on the platter edge */}
        <div className="absolute" style={{
          top: 3, left: '50%', marginLeft: -1.5, width: 3, height: 9,
          background: color, borderRadius: 2, boxShadow: `0 0 6px ${rgba(color, 0.9)}`,
        }} />
      </div>

      {/* Center label — outside the rotating platter so the time stays readable */}
      <div className="absolute rounded-full flex flex-col items-center justify-center pointer-events-none" style={{
        inset: '29%',
        background: `radial-gradient(circle at 38% 30%, #26282e, #131418 75%)`,
        border: `2px solid ${rgba(color, 0.55)}`,
        boxShadow: `0 0 16px ${rgba(color, 0.30)}, inset 0 1px 0 rgba(255,255,255,0.08)`,
      }}>
        <p style={{ color, fontSize: 11, fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>
          {fmt(position)}
        </p>
        <p style={{ color: UI.dim, fontSize: 8, fontFamily: 'monospace' }}>
          {fmtR(position, duration)}
        </p>
      </div>
    </div>
  )
}

// ── Performance pads (multi-mode, XDJ-style) ───────────────────────────────────

const PAD_MODES: [PadMode, string][] = [
  ['hotcue',   'HOT CUE'],
  ['beatloop', 'BEAT LOOP'],
  ['sliploop', 'SLIP LOOP'],
  ['beatjump', 'BEAT JUMP'],
]

// Fixed multi-colour pad palette (controller look) — no cyan/violet/pink.
const PAD_PALETTE = ['#2f7dff', '#ff7a1a', '#3ddc84', '#ffd02e', '#ff5252', '#8fd14f', '#ff9f43', '#e8e9ee']

// Labels shown on the 8 pads for each mode.
const PAD_LABELS: Record<PadMode, string[]> = {
  hotcue:   ['1', '2', '3', '4', '5', '6', '7', '8'],
  beatloop: ['¼', '½', '1', '2', '4', '8', '16', '32'],
  sliploop: ['¼', '½', '1', '2', '4', '8', '16', '32'],
  beatjump: ['-16', '-8', '-4', '-1', '+1', '+4', '+8', '+16'],
}

function PadGrid({ deck, color, st, onMode, onTrigger, onRelease, onDelete }: {
  deck: DeckId; color: string; st: DeckState
  onMode: (m: PadMode) => void
  onTrigger: (i: number) => void
  onRelease: (i: number) => void
  onDelete: (i: number) => void
}) {
  const mode = st.padMode
  const labels = PAD_LABELS[mode]
  const loopMode = mode === 'beatloop' || mode === 'sliploop'
  const { setHotCueColor, setHotCueLabel } = useDJStore()
  const [cueCtx, setCueCtx] = useState<{ pos: MenuDropdownPos; i: number } | null>(null)

  const cueMenu = (i: number): MenuItem[] => {
    const cue = st.hotCues[i]
    return [
      { type: 'label', text: cue?.label || `Point ${i + 1} — ${cue ? fmt(cue.position) : ''}` },
      { type: 'custom', render: () => (
        <input autoFocus defaultValue={cue?.label ?? ''} placeholder="Nom du point…"
          onChange={e => setHotCueLabel(deck, i, e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') setCueCtx(null) }}
          className="w-full rounded outline-none"
          style={{ background: '#16181d', color: '#e6e6f0', border: '1px solid #454545', fontSize: 12, padding: '3px 6px', margin: '2px 0' }} />
      ) },
      { type: 'submenu', label: 'Couleur', items: HOT_CUE_COLORS.map((c, ci) => ({
        type: 'action', label: `Couleur ${ci + 1}`, icon: <span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' }} />,
        onClick: () => setHotCueColor(deck, i, c),
      })) },
      { type: 'separator' },
      { type: 'action', label: 'Effacer le point', danger: true, onClick: () => onDelete(i) },
    ]
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Mode selector */}
      <div className="grid grid-cols-4 gap-1">
        {PAD_MODES.map(([m, lbl]) => (
          <button key={m} onClick={() => onMode(m)}
            style={{
              fontSize: 8, padding: '2px 0', borderRadius: 3, fontWeight: 700, letterSpacing: 0.3,
              background: mode === m ? rgba(color, 0.22) : UI.card,
              border: `1px solid ${mode === m ? color : UI.border}`,
              color: mode === m ? color : UI.muted,
            }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* 8 pads — full controller-style colors (blue/orange/green/yellow/red) */}
      <div className="grid grid-cols-4 gap-1">
        {labels.map((lbl, i) => {
          const cue = mode === 'hotcue' ? st.hotCues[i] : null
          const lit = mode !== 'hotcue' || !!cue        // unset hot cue = unlit pad
          const padColor = cue?.color ?? PAD_PALETTE[i]
          return (
            <button
              key={i}
              onMouseDown={() => onTrigger(i)}
              onMouseUp={() => loopMode && onRelease(i)}
              onContextMenu={e => { e.preventDefault(); if (mode === 'hotcue' && cue) setCueCtx({ pos: { top: e.clientY, left: e.clientX, minWidth: 180 }, i }) }}
              title={mode === 'hotcue'
                ? (cue ? `${cue.label || `Point ${i+1}`} — ${fmt(cue.position)}\nClic droit : options` : `Définir point ${i+1}`)
                : labels[i]}
              className="h-8 rounded-md font-extrabold transition-all active:scale-95 active:brightness-125 truncate px-1"
              style={lit ? {
                fontSize: cue?.label ? 8.5 : 10,
                background: `linear-gradient(180deg, ${padColor}, ${rgba(padColor, 0.72)})`,
                border: `1px solid ${rgba('#000000', 0.45)}`,
                color: '#0b0c0f',
                boxShadow: `0 0 9px ${rgba(padColor, 0.45)}, inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.25)`,
                textShadow: '0 1px 0 rgba(255,255,255,0.25)',
              } : {
                fontSize: 10,
                background: 'linear-gradient(180deg, #24262c, #17181c)',
                border: `1px solid ${UI.border}`,
                color: rgba(PAD_PALETTE[i], 0.8),
                boxShadow: `inset 0 0 6px rgba(0,0,0,0.5), inset 0 -1px 0 ${rgba(PAD_PALETTE[i], 0.35)}`,
              }}
            >
              {mode === 'hotcue' && cue?.label ? cue.label : lbl}
            </button>
          )
        })}
      </div>
      {cueCtx && <MenuDropdown theme="dark" pos={cueCtx.pos} onClose={() => setCueCtx(null)} items={cueMenu(cueCtx.i)} />}
    </div>
  )
}

// ── Deck info display (CDJ-style) ──────────────────────────────────────────────

// "M:SS" + separate centiseconds string.
function fmtMs(secs: number): { main: string; cs: string } {
  const s = Math.max(0, secs)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s - Math.floor(s)) * 100)
  return { main: `${m}:${sec.toString().padStart(2, '0')}`, cs: cs.toString().padStart(2, '0') }
}

// Big numeric readout (elapsed time / BPM) with a small fractional part.
function BigReadout({ main, frac, color, label }: { main: string; frac?: string; color: string; label?: string }) {
  return (
    <div className="flex flex-col items-end leading-none">
      {label && <span style={{ color: UI.muted, fontSize: 8, letterSpacing: 1 }}>{label}</span>}
      <div className="flex items-baseline" style={{ fontFamily: 'monospace', fontWeight: 800 }}>
        <span style={{ color, fontSize: 26, lineHeight: '26px', textShadow: `0 0 14px ${rgba(color, 0.4)}` }}>{main}</span>
        {frac !== undefined && <span style={{ color, fontSize: 13, opacity: 0.75 }}>.{frac}</span>}
      </div>
    </div>
  )
}

function DeckMeta({ st, color }: { st: DeckState; color: string }) {
  const elapsed   = fmtMs(st.position)
  const remaining = fmtMs(Math.max(0, st.duration - st.position))
  const tempo     = st.pitch
  const tempoStr  = `${tempo >= 0 ? '+' : ''}${tempo.toFixed(2)}`
  const curBpm    = st.bpm != null ? st.bpm * (1 + tempo / 100) : null

  // Pro readouts that fill the empty middle of the display.
  const beatSec = st.bpm && st.bpm > 0 ? 60 / st.bpm : 0
  const semis   = 12 * Math.log2(1 + st.pitch / 100)
  const gainDb  = st.gain > 0.001 ? 20 * Math.log10(st.gain) : -60
  const loopBeats = st.isLooping && st.loopIn != null && st.loopOut != null && beatSec
    ? (st.loopOut - st.loopIn) / beatSec : null
  const totalBeats = beatSec ? st.position / beatSec : 0
  const bar  = Math.floor(totalBeats / 4) + 1
  const beat = (Math.floor(totalBeats) % 4 + 4) % 4

  const stats: { label: string; value: React.ReactNode; accent?: boolean }[] = [
    { label: 'ORIG',  value: st.bpm != null ? st.bpm.toFixed(1) : '—', accent: true },
    { label: '½TON',  value: st.track ? `${semis >= 0 ? '+' : ''}${semis.toFixed(1)}` : '—' },
    { label: 'GAIN',  value: `${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)}` },
    { label: 'LOOP',  value: loopBeats != null ? `${loopBeats >= 1 ? Math.round(loopBeats) : loopBeats.toFixed(2)}t` : '—', accent: !!loopBeats },
    { label: 'MES.',  value: (
      <span className="flex items-center gap-1">
        <span>{st.track ? `${bar}` : '—'}</span>
        <span className="flex gap-0.5">
          {[0, 1, 2, 3].map(i => (
            <span key={i} style={{ width: 3, height: 3, borderRadius: 99, background: i === beat && st.isPlaying ? color : rgba('#ffffff', 0.18) }} />
          ))}
        </span>
      </span>
    ) },
  ]

  return (
    <div className="flex items-stretch gap-2 px-0.5">
      {/* Time */}
      <div className="flex flex-col justify-between flex-shrink-0">
        <BigReadout main={elapsed.main} frac={elapsed.cs} color={UI.text} />
        <span style={{ color: UI.muted, fontSize: 9, fontFamily: 'monospace' }}>
          -{remaining.main}<span style={{ opacity: 0.6 }}>.{remaining.cs}</span> · REMAIN
        </span>
      </div>

      {/* Pro readouts — neat equal tiles with dividers, fill the middle band */}
      <div className="flex-1 flex self-stretch rounded-md overflow-hidden" style={{
        background: rgba('#000000', 0.25), border: `1px solid ${rgba('#ffffff', 0.06)}`,
      }}>
        {stats.map((s, i) => (
          <div key={s.label} className="flex-1 flex flex-col items-center justify-center gap-0.5 px-1"
            style={{ borderLeft: i > 0 ? `1px solid ${rgba('#ffffff', 0.07)}` : 'none' }}>
            <span style={{ color: UI.dim, fontSize: 7, letterSpacing: 0.5 }}>{s.label}</span>
            <span className="truncate" style={{ color: s.accent ? color : UI.soft, fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Tempo */}
      <div className="flex flex-col items-center justify-center px-2.5 rounded-md flex-shrink-0" style={{ background: rgba('#000000', 0.25), border: `1px solid ${rgba('#ffffff', 0.06)}` }}>
        <span style={{ color: UI.muted, fontSize: 8, letterSpacing: 1 }}>
          TEMPO <span style={{ color, border: `1px solid ${rgba(color, 0.5)}`, borderRadius: 2, padding: '0 3px' }}>
            {st.tempoRange === 100 ? 'WIDE' : `±${st.tempoRange}`}
          </span>
        </span>
        <span style={{ color: UI.text, fontSize: 17, fontFamily: 'monospace', fontWeight: 800 }}>{tempoStr}<span style={{ fontSize: 10 }}> %</span></span>
      </div>

      {/* BPM + MT */}
      <div className="flex flex-col items-end justify-center flex-shrink-0">
        <BigReadout
          main={curBpm != null ? Math.floor(curBpm).toString() : '---'}
          frac={curBpm != null ? Math.floor((curBpm % 1) * 10).toString() : undefined}
          color={color} label="BPM"
        />
        <span style={{
          color, fontSize: 8, fontWeight: 700, letterSpacing: 1,
          border: `1px solid ${rgba(color, 0.5)}`, borderRadius: 2, padding: '0 4px', marginTop: 2,
        }}>MT</span>
      </div>
    </div>
  )
}

// ── Deck queue panel (playlist management) ─────────────────────────────────────

function QueuePanel({ deck, color, st, onClose }: { deck: DeckId; color: string; st: DeckState; onClose: () => void }) {
  const { playQueueIndex, removeQueueItem, moveQueueItem, moveQueueAcross, clearQueue } = useDJStore()
  const upcoming = st.queue.length - 1 - st.queueIndex
  const dragIdx = useRef<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  // Drop carried via dataTransfer "deck:index" so it works across the two decks.
  const handleDrop = (toIdx: number) => (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    const data = e.dataTransfer.getData('text/plain')
    const m = data.match(/^([AB]):(\d+)$/)
    if (m) {
      const fromDeck = m[1] as 'A' | 'B'; const fromIdx = parseInt(m[2])
      if (fromDeck === deck) { if (fromIdx !== toIdx) moveQueueItem(deck, fromIdx, toIdx) }
      else moveQueueAcross(fromDeck, fromIdx, deck, toIdx)
    }
    dragIdx.current = null; setOverIdx(null)
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col" style={{ background: 'rgba(10,10,24,0.94)', backdropFilter: 'blur(2px)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 flex-shrink-0" style={{ height: 38, borderBottom: `1px solid ${UI.border}` }}>
        <ListMusic className="w-4 h-4" style={{ color }} />
        <span style={{ color: UI.text, fontSize: 12, fontWeight: 700 }}>File — Deck {deck}</span>
        <span style={{ color: UI.muted, fontSize: 10 }}>
          {st.queue.length === 0 ? 'vide' : `${st.queueIndex + 1}/${st.queue.length} · ${upcoming} à venir`}
        </span>
        <div className="flex-1" />
        {st.queue.length > 0 && (
          <button onClick={() => clearQueue(deck)} style={{ color: UI.muted, fontSize: 9, border: `1px solid ${UI.border}`, borderRadius: 4, padding: '2px 8px' }}>Vider</button>
        )}
        <button onClick={onClose} style={{ color: UI.muted }}><X className="w-4 h-4" /></button>
      </div>

      {/* List (drop anywhere = append to the end of this deck's queue) */}
      <div className="dj-lib-scroll" style={{ flex: 1, overflowY: 'auto' }}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop(st.queue.length)}>
        {st.queue.length === 0
          ? <p className="text-center py-8" style={{ color: UI.dim, fontSize: 11 }}>Aucune piste en file.<br />Charge un album/une playlist, ou glisse une piste depuis l'autre deck.</p>
          : st.queue.map((t, i) => {
            const current = i === st.queueIndex
            const isOver = overIdx === i
            return (
              <div key={`${t.id}-${i}`} className="flex items-center gap-2 px-2 py-1.5 group"
                draggable
                onDragStart={e => { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `${deck}:${i}`) }}
                onDragOver={e => { e.preventDefault(); if (overIdx !== i) setOverIdx(i) }}
                onDragLeave={() => setOverIdx(o => (o === i ? null : o))}
                onDrop={handleDrop(i)}
                onDragEnd={() => { dragIdx.current = null; setOverIdx(null) }}
                style={{
                  background: current ? rgba(color, 0.16) : 'transparent',
                  borderTop: isOver ? `2px solid ${color}` : '2px solid transparent',
                }}>
                <GripVertical className="w-3.5 h-3.5 flex-shrink-0 cursor-grab" style={{ color: UI.dim }} />
                <span style={{ color: current ? color : UI.dim, fontSize: 9, fontFamily: 'monospace', width: 16, flexShrink: 0, textAlign: 'right' }}>
                  {current ? '▶' : i + 1}
                </span>
                <button onClick={() => playQueueIndex(deck, i)} className="flex-1 min-w-0 text-left">
                  <p className="truncate" style={{ color: current ? UI.text : UI.soft, fontSize: 11, fontWeight: current ? 600 : 400 }}>{t.title}</p>
                  <p className="truncate" style={{ color: UI.dim, fontSize: 9 }}>{t.artistName ?? '—'} · {fmt(t.durationSecs)}</p>
                </button>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => moveQueueItem(deck, i, i - 1)} disabled={i === 0} title="Monter"
                    style={{ color: UI.muted, fontSize: 11, padding: '0 3px', opacity: i === 0 ? 0.25 : 1 }}>↑</button>
                  <button onClick={() => moveQueueItem(deck, i, i + 1)} disabled={i === st.queue.length - 1} title="Descendre"
                    style={{ color: UI.muted, fontSize: 11, padding: '0 3px', opacity: i === st.queue.length - 1 ? 0.25 : 1 }}>↓</button>
                  <button onClick={() => removeQueueItem(deck, i)} title="Retirer"
                    style={{ color: UI.muted, fontSize: 11, padding: '0 3px' }}>✕</button>
                </div>
              </div>
            )
          })
        }
      </div>
    </div>
  )
}

// ── Track overview bar (full track + hot-cue markers, CDJ-style) ───────────────

const CUE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function OverviewBar({ position, duration, hotCues, onSeek, color, bpm, beatOffset, trackId }: {
  position: number; duration: number
  hotCues: (HotCue | null)[]
  onSeek: (s: number) => void; color: string
  bpm?: number | null; beatOffset?: number; trackId?: string
}) {
  const barRef    = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragging  = useRef(false)
  const [dragPos, setDragPos] = useState<number | null>(null)

  // Draw the decoded waveform (peaks) once analysed; played part brighter.
  const playedFrac = duration > 0 ? Math.min(1, (dragPos ?? position) / duration) : 0
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height, mid = H / 2
    ctx.clearRect(0, 0, W, H)
    const peaks = djTrackPeaks(trackId)
    if (!peaks) return
    let max = 0; for (let i = 0; i < peaks.peak.length; i++) if (peaks.peak[i] > max) max = peaks.peak[i]
    if (max <= 0) max = 1
    const N = peaks.peak.length
    const playX = playedFrac * W
    for (let x = 0; x < W; x++) {
      const bk = Math.min(N - 1, Math.floor(x / W * N))
      const h  = Math.max(1, (peaks.peak[bk] / max) * mid * 0.95)
      const lowR = peaks.peak[bk] > 0 ? Math.min(1, peaks.low[bk] / peaks.peak[bk]) : 0.5
      const played = x <= playX
      // Base coloured bar (played = bright, else dim).
      ctx.fillStyle = rgba(color, played ? 0.95 : 0.4)
      ctx.fillRect(x, mid - h, 1, h * 2)
      // High-frequency content → a whiter core.
      if (played && lowR < 0.5) { ctx.fillStyle = rgba('#ffffff', (0.5 - lowR) * 0.5); ctx.fillRect(x, mid - h * 0.5, 1, h) }
    }
  }, [trackId, color, playedFrac])

  const timeAt = useCallback((clientX: number): number => {
    const bar = barRef.current
    if (!bar || !duration) return 0
    const rect = bar.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }, [duration])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return
      const t = timeAt(e.clientX)
      setDragPos(t)
      onSeek(t)
    }
    const up = () => { dragging.current = false; setDragPos(null) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup',   up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [timeAt, onSeek])

  const displayPos = dragPos ?? position
  const pct = duration > 0 ? (displayPos / duration) * 100 : 0
  // Minute ticks over the track length.
  const ticks = duration > 0 ? Array.from({ length: Math.floor(duration / 60) }, (_, i) => (i + 1) * 60) : []
  // Beatgrid bar lines (every 4 beats) from the detected BPM + offset.
  const bars: number[] = []
  if (bpm && bpm > 0 && duration > 0) {
    const barLen = (60 / bpm) * 4
    for (let t = beatOffset ?? 0; t < duration && bars.length < 400; t += barLen) bars.push(t)
  }

  return (
    <div
      ref={barRef}
      className="relative cursor-pointer overflow-hidden"
      style={{ height: 30, background: rgba('#000000', 0.4), borderRadius: 4, border: `1px solid ${rgba('#ffffff', 0.05)}` }}
      onMouseDown={e => {
        dragging.current = true
        const t = timeAt(e.clientX)
        setDragPos(t)
        onSeek(t)
        e.stopPropagation()
      }}
    >
      {/* decoded waveform */}
      <canvas ref={canvasRef} width={1200} height={30} className="absolute inset-0 w-full h-full" />
      {/* faint played overlay (when no waveform yet) */}
      {!djTrackPeaks(trackId) && <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: rgba(color, 0.22), borderRadius: 4 }} />}
      {/* beatgrid (bar lines) */}
      {bars.map((t, i) => (
        <div key={`b${i}`} className="absolute" style={{ left: `${(t / duration) * 100}%`, top: 0, bottom: '50%', width: 1, background: rgba(color, 0.35) }} />
      ))}
      {/* minute ticks */}
      {ticks.map(t => (
        <div key={t} className="absolute inset-y-0" style={{ left: `${(t / duration) * 100}%`, width: 1, background: rgba('#ffffff', 0.10) }} />
      ))}
      {/* hot-cue markers with letters */}
      {hotCues.map((cue, i) => cue && (
        <div key={i} className="absolute top-0 bottom-0" style={{ left: `${(cue.position / duration) * 100}%` }}>
          <div style={{ width: 2, height: '100%', background: cue.color, boxShadow: `0 0 5px ${rgba(cue.color, 0.7)}` }} />
          <span style={{
            position: 'absolute', top: -1, left: 1, fontSize: 7, fontWeight: 800,
            color: '#0a0a12', background: cue.color, borderRadius: 1, padding: '0 1px', lineHeight: '8px',
          }}>{CUE_LETTERS[i]}</span>
        </div>
      ))}
      {/* playhead */}
      <div className="absolute inset-y-0" style={{ left: `${pct}%`, width: 1.5, background: '#fff', boxShadow: '0 0 6px rgba(255,255,255,0.8)' }} />
    </div>
  )
}

// Per-deck "Séparer (HQ)" button: runs offline neural-grade STFT separation on
// the whole track, then STEM Voix/Instru play the cached high-quality stems.
function StemHqButton({ deck, color }: { deck: DeckId; color: string }) {
  const trackId    = useDJStore(s => s[DECK_FIELD[deck]].track?.id)
  const separating = useDJStore(s => s.separating)
  const sepProgress = useDJStore(s => s.sepProgress)
  useDJStore(s => s.stemTick)   // re-render when stems become ready
  const separateStem = useDJStore(s => s.separateStem)
  const busy = separating === deck
  const ready = djStemReady(trackId)
  const otherBusy = separating !== null && !busy
  return (
    <button
      onClick={() => separateStem(deck)}
      disabled={!trackId || busy || otherBusy}
      className="active:scale-95"
      style={{ padding: '2px 8px', fontSize: 9, fontWeight: 700, letterSpacing: 0.3, borderRadius: 3,
               background: ready ? rgba('#34d399', 0.22) : busy ? rgba(color, 0.22) : UI.card,
               border: `1px solid ${ready ? '#34d399' : busy ? color : UI.border}`,
               color: ready ? '#9af3d3' : busy ? color : (trackId && !otherBusy ? UI.soft : UI.dim),
               opacity: otherBusy && !ready ? 0.5 : 1 }}
      title="Séparation HQ hors-ligne (traite toute la piste, puis Voix/Instru jouent les stems en haute qualité)"
    >
      {busy ? `HQ ${Math.round(sepProgress * 100)}%` : ready ? 'HQ ✓' : 'SÉPARER HQ'}
    </button>
  )
}

// Global toggle: CDJ zoomed waveform vs. live analyser.
function ZoomToggle({ color }: { color: string }) {
  const zoomWave = useDJStore(s => s.zoomWave)
  const toggleZoomWave = useDJStore(s => s.toggleZoomWave)
  return (
    <button onClick={toggleZoomWave}
      className="active:scale-95"
      style={{ padding: '2px 8px', fontSize: 9, fontWeight: 700, letterSpacing: 0.3, borderRadius: 3,
               background: zoomWave ? rgba(color, 0.22) : UI.card,
               border: `1px solid ${zoomWave ? color : UI.border}`,
               color: zoomWave ? color : UI.muted }}
      title="Forme d’onde zoomée façon CDJ (défilante, alignée sur les temps)"
    >ZOOM CDJ</button>
  )
}

// ── CDJ zoomed waveform ─────────────────────────────────────────────────────
// A large coloured waveform zoomed around the playhead, scrolling beat-aligned
// (like a Pioneer CDJ / Rekordbox). Reads the decoded peaks + the live engine
// position so it stays smooth between React updates.
function CDJWaveform({ eng, duration, trackId, color, bpm, beatOffset, onSeek, height, windowSecs = 8 }: {
  eng: ReturnType<typeof djEngine>; duration: number; trackId?: string; color: string
  bpm?: number | null; beatOffset?: number; onSeek: (s: number) => void; height: number; windowSecs?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const posRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    const draw = () => {
      const W = canvas.width, H = canvas.height, mid = H / 2
      const pos = eng.audio.currentTime || 0
      posRef.current = pos
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = rgba('#000000', 0.55); ctx.fillRect(0, 0, W, H)
      const peaks = djTrackPeaks(trackId)
      const centerX = W / 2
      const pxPerSec = W / windowSecs
      // Beatgrid first (under the waveform).
      if (bpm && bpm > 0 && duration > 0) {
        const beat = 60 / bpm
        const off  = beatOffset ?? 0
        const tStart = pos - windowSecs / 2, tEnd = pos + windowSecs / 2
        let k = Math.ceil((tStart - off) / beat)
        for (let t = off + k * beat; t < tEnd; t += beat, k++) {
          if (t < 0) continue
          const x = centerX + (t - pos) * pxPerSec
          const isBar = ((k % 4) + 4) % 4 === 0
          ctx.fillStyle = rgba(isBar ? color : '#ffffff', isBar ? 0.5 : 0.12)
          ctx.fillRect(x, 0, isBar ? 1.5 : 1, H)
        }
      }
      if (peaks && duration > 0) {
        let max = 0; for (let i = 0; i < peaks.peak.length; i++) if (peaks.peak[i] > max) max = peaks.peak[i]
        if (max <= 0) max = 1
        const N = peaks.peak.length
        for (let x = 0; x < W; x++) {
          const t = pos + (x - centerX) / pxPerSec
          if (t < 0 || t > duration) continue
          const bk = Math.min(N - 1, Math.max(0, Math.floor((t / duration) * N)))
          const h  = Math.max(1, (peaks.peak[bk] / max) * mid * 0.96)
          const lowR = peaks.peak[bk] > 0 ? Math.min(1, peaks.low[bk] / peaks.peak[bk]) : 0.5
          const played = t <= pos
          // Low frequencies tinted with the deck colour, highs whiter.
          ctx.fillStyle = rgba(color, played ? 0.95 : 0.45)
          ctx.fillRect(x, mid - h, 1, h * 2)
          if (lowR < 0.5) { ctx.fillStyle = rgba('#ffffff', (0.5 - lowR) * (played ? 0.7 : 0.3)); ctx.fillRect(x, mid - h * 0.45, 1, h * 0.9) }
        }
      } else {
        ctx.fillStyle = rgba('#ffffff', 0.06); ctx.font = '11px monospace'; ctx.textAlign = 'center'
        ctx.fillText('ANALYSE pour la forme d’onde zoomée', W / 2, mid)
      }
      // Centre playhead.
      ctx.fillStyle = '#ffffff'; ctx.fillRect(centerX - 0.75, 0, 1.5, H)
      ctx.fillStyle = rgba(color, 0.9)
      ctx.beginPath(); ctx.moveTo(centerX - 5, 0); ctx.lineTo(centerX + 5, 0); ctx.lineTo(centerX, 6); ctx.closePath(); ctx.fill()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [eng, trackId, color, bpm, beatOffset, duration, windowSecs])

  const seekFromX = (clientX: number, target: HTMLCanvasElement) => {
    const rect = target.getBoundingClientRect()
    const x = clientX - rect.left
    const pxPerSec = rect.width / windowSecs
    const t = posRef.current + (x - rect.width / 2) / pxPerSec
    onSeek(Math.max(0, Math.min(duration, t)))
  }

  return (
    <canvas
      ref={canvasRef} width={1100} height={Math.max(40, Math.round(height))}
      className="w-full h-full cursor-ew-resize"
      style={{ borderRadius: 6, border: `1px solid ${rgba(color, 0.25)}`, display: 'block' }}
      onMouseDown={e => seekFromX(e.clientX, e.currentTarget)}
    />
  )
}

// ── Single Deck panel ─────────────────────────────────────────────────────────

function DJDeck({ deck, color, compact = false }: { deck: DeckId; color: string; compact?: boolean }) {
  const eng = djEngine(deck)
  const st  = useDJStore(s => s[DECK_FIELD[deck]])
  // "Other" deck = the partner for sync/double (B↔A; C+ reference deck A).
  const otherDeck: DeckId = deck === 'A' ? 'B' : 'A'
  const other = useDJStore(s => s[DECK_FIELD[otherDeck]])
  const waveStyle = useDJStore(s => s.waveStyle)
  const zoomWave  = useDJStore(s => s.zoomWave)
  const analyzing = useDJStore(s => s.analyzing)
  const setStem = useDJStore(s => s.setStem)
  const { togglePlay, seek, setPitch, pressCue, deleteHotCue,
          setLoopIn, setLoopOut, toggleLoop, halveLoop, doubleLoop,
          setPadMode, triggerPad, releasePad,
          setTempoRange, tapBpm, quickLoop, loadTrack, setWaveStyle,
          setKeylock, toggleSlip, toggleVinyl, nudge, nudgeEnd, brake, syncDeck, censor,
          moveLoop, instantDouble, toggleCue, analyzeTrack, toggleShuffle, cycleRepeat,
          scratchStart, scratchMove, scratchEnd,
          nextTrack, prevTrack } = useDJStore()
  const hasQueue = st.queue.length > 0

  // Rich right-click menu for the deck.
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const deckMenu = (): MenuItem[] => {
    const items: MenuItem[] = [
      { type: 'label', text: st.track ? st.track.title : `Deck ${deck}` },
      { type: 'action', label: st.isPlaying ? 'Pause' : 'Lecture', icon: st.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />, disabled: !st.track, onClick: () => togglePlay(deck) },
      { type: 'action', label: 'Aller au point CUE', disabled: !st.track, onClick: () => pressCue(deck) },
      { type: 'separator' },
      { type: 'action', label: `Copier vers Deck ${otherDeck} (double)`, disabled: !st.track, onClick: () => st.track && loadTrack(otherDeck, st.track) },
      { type: 'action', label: `Caler le tempo sur Deck ${otherDeck} (SYNC)`, disabled: !(st.bpm && other.bpm), onClick: () => {
        if (!st.bpm || !other.bpm) return
        const otherEff = other.bpm * (1 + other.pitch / 100)
        const pct = Math.max(-st.tempoRange, Math.min(st.tempoRange, (otherEff / st.bpm - 1) * 100))
        setPitch(deck, Math.round(pct * 100) / 100)
      } },
      { type: 'action', label: 'Réinitialiser le tempo', onClick: () => setPitch(deck, 0) },
      { type: 'separator' },
      { type: 'action', label: 'Boucle 4 temps', disabled: !st.track, onClick: () => quickLoop(deck, 4 * (st.bpm ? 60 / st.bpm : 0.5)) },
      { type: 'action', label: 'Boucle 8 temps', disabled: !st.track, onClick: () => quickLoop(deck, 8 * (st.bpm ? 60 / st.bpm : 0.5)) },
      { type: 'action', label: st.isLooping ? 'Désactiver la boucle' : 'Activer la boucle', disabled: !st.track, onClick: () => toggleLoop(deck) },
      { type: 'separator' },
      { type: 'submenu', label: 'Mode des pads', items: PAD_MODES.map(([m, lbl]) => ({
        type: 'action', label: lbl, checked: st.padMode === m, onClick: () => setPadMode(deck, m),
      })) },
      { type: 'submenu', label: 'Plage de tempo', items: ([6, 10, 16, 100] as const).map(r => ({
        type: 'action', label: r === 100 ? 'WIDE' : `± ${r} %`, checked: st.tempoRange === r, onClick: () => setTempoRange(deck, r),
      })) },
      { type: 'submenu', label: "Style d'onde", items: WAVE_STYLES.map(w => ({
        type: 'action', label: w.label, checked: waveStyle === w.id, onClick: () => setWaveStyle(w.id),
      })) },
      { type: 'submenu', label: 'Isolation (stem)', items: STEM_MODES.map(m => ({
        type: 'action', label: m.label, checked: st.stem === m.id, onClick: () => setStem(deck, m.id),
      })) },
      { type: 'action', label: 'Taper le BPM', onClick: () => tapBpm(deck) },
    ]
    return items
  }

  // Jog wheel grows to fill the deck's centre, whatever the screen height.
  const jogWrapRef = useRef<HTMLDivElement>(null)
  const [jogSize, setJogSize] = useState(160)
  useEffect(() => {
    const el = jogWrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setJogSize(Math.max(130, Math.min(340, el.clientHeight - 8)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pitchH = Math.round(jogSize * 0.74)

  // Waveform grows to share the deck's free vertical space with the jog wheel.
  const waveWrapRef = useRef<HTMLDivElement>(null)
  const [waveH, setWaveH] = useState(96)
  useEffect(() => {
    const el = waveWrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setWaveH(Math.max(56, Math.min(420, el.clientHeight)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="flex flex-col gap-1.5 p-2.5 h-full relative overflow-hidden" style={{ background: deckBg(color) }}>
      {/* Top accent line — flashes red near the end of the track */}
      {(() => {
        const endingSoon = st.isPlaying && st.duration > 0 && st.duration - st.position <= 20
        const c = endingSoon ? '#ff3b4e' : color
        return (
          <div className="absolute top-0 inset-x-0" style={{
            height: 2,
            background: `linear-gradient(90deg, transparent, ${c}, transparent)`,
            opacity: st.isPlaying ? 1 : 0.4,
            boxShadow: st.isPlaying ? `0 0 10px ${c}` : 'none',
            transition: 'opacity .3s',
            animation: endingSoon ? 'djRecPulse 0.8s ease-in-out infinite' : 'none',
          }} />
        )
      })()}

      {/* Display panel: track + time / tempo / BPM (CDJ-style) */}
      <div
        className="rounded-lg px-2 py-1.5 flex flex-col gap-1.5"
        style={{ background: rgba('#000000', 0.30), border: `1px solid ${rgba('#ffffff', 0.06)}` }}
        onContextMenu={e => { e.preventDefault(); setCtx({ top: e.clientY, left: e.clientX, minWidth: 230 }) }}
      >
        <div className="flex gap-2.5">
          {/* Large album art */}
          <div className="rounded-lg flex-shrink-0 overflow-hidden" style={{
            width: compact ? 78 : 120, height: compact ? 78 : 120,
            background: UI.well, border: `1px solid ${rgba(color, 0.3)}`,
            boxShadow: st.track?.coverUrl ? `0 0 18px ${rgba(color, 0.3)}` : 'none',
          }}>
            {st.track?.coverUrl
              ? <img src={st.track.coverUrl} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center">
                  <Music className="w-12 h-12" style={{ color: UI.dim }} />
                </div>
            }
          </div>

          {/* Right column: header row + big title + big readouts */}
          <div className="flex-1 min-w-0 flex flex-col justify-between gap-1">
            {/* Top row: DECK badge + action buttons */}
            <div className="flex items-center gap-2 min-w-0">
              <span style={{
                color, fontSize: 10, fontWeight: 800, letterSpacing: 1,
                textShadow: `0 0 12px ${rgba(color, 0.6)}`, flexShrink: 0,
              }}>DECK {deck}</span>
              {st.isLoading && <Loader2 className="w-3 h-3 animate-spin" style={{ color }} />}
              <div className="flex-1" />
              {/* Offline analysis: BPM + KEY + beatgrid */}
              <button
                onClick={() => analyzeTrack(deck)}
                disabled={!st.track || analyzing === deck}
                className="flex items-center justify-center rounded flex-shrink-0 active:scale-95"
                style={{ padding: '3px 6px', background: analyzing === deck ? rgba(color, 0.2) : UI.card, border: `1px solid ${analyzing === deck ? color : UI.border}`, color: st.track ? color : UI.dim, fontSize: 8, fontWeight: 700, letterSpacing: 0.5 }}
                title="Analyser : BPM précis + tonalité + grille rythmique"
              >
                {analyzing === deck ? '…' : 'ANALYSE'}
              </button>
              {/* TAP BPM */}
              <button
                onClick={() => tapBpm(deck)}
                className="flex flex-col items-center justify-center rounded flex-shrink-0 active:scale-95"
                style={{ padding: '1px 7px', background: UI.card, border: `1px solid ${UI.border}`, color: UI.soft, lineHeight: 1 }}
                title="Taper en rythme pour définir le BPM"
              >
                <span style={{ fontSize: 10, fontWeight: 800, fontFamily: 'monospace', color }}>{st.bpm ? st.bpm.toFixed(0) : '—'}</span>
                <span style={{ fontSize: 6.5, letterSpacing: 0.5, color: UI.muted }}>TAP</span>
              </button>
              {/* Queue button */}
              <button
                onClick={() => setQueueOpen(o => !o)}
                className="flex items-center gap-1 rounded flex-shrink-0 transition-all active:scale-95"
                style={{
                  padding: '2px 7px',
                  background: queueOpen ? rgba(color, 0.2) : (hasQueue ? rgba(color, 0.1) : UI.card),
                  border: `1px solid ${hasQueue ? rgba(color, 0.45) : UI.border}`,
                  color: hasQueue ? color : UI.muted,
                }}
                title="File d'attente du deck"
              >
                <ListMusic className="w-3.5 h-3.5" />
                <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'monospace' }}>
                  {hasQueue ? `${st.queueIndex + 1}/${st.queue.length}` : 'FILE'}
                </span>
              </button>
              {/* Shuffle */}
              <button
                onClick={() => toggleShuffle(deck)}
                className="rounded flex-shrink-0 flex items-center justify-center active:scale-95"
                style={{ padding: '2px 6px', background: st.shuffle ? rgba(color, 0.2) : UI.card, border: `1px solid ${st.shuffle ? color : UI.border}`, color: st.shuffle ? color : UI.muted }}
                title="Lecture aléatoire"
              >
                <Shuffle className="w-3.5 h-3.5" />
              </button>
              {/* Repeat off / all / one */}
              <button
                onClick={() => cycleRepeat(deck)}
                className="rounded flex-shrink-0 flex items-center justify-center self-stretch active:scale-95"
                style={{ padding: '0 6px', background: st.repeatMode !== 'off' ? rgba(color, 0.2) : UI.card, border: `1px solid ${st.repeatMode !== 'off' ? color : UI.border}`, color: st.repeatMode !== 'off' ? color : UI.muted }}
                title={st.repeatMode === 'off' ? 'Répétition : désactivée' : st.repeatMode === 'all' ? 'Répéter toute la file' : 'Répéter la piste'}
              >
                {st.repeatMode === 'one' ? <Repeat1 className="w-3.5 h-3.5" /> : <Repeat className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Big track title */}
            <div className="min-w-0">
              <p className="truncate font-extrabold leading-tight" style={{ color: st.track ? UI.text : UI.dim, fontSize: compact ? 15 : 22 }}>
                {st.track?.title ?? 'Aucune piste chargée'}
              </p>
              <div className="flex items-center gap-2 truncate" style={{ fontSize: 10, color: UI.muted }}>
                <span className="truncate">{st.track?.artistName ?? '—'}</span>
                {st.track && <span style={{ color: UI.dim }}>· {fmt(st.duration)}</span>}
                {st.bpm != null && <span style={{ color }}>· {st.bpm.toFixed(1)} BPM</span>}
                {st.keyName && <span style={{ color, fontWeight: 700 }}>· {st.keyName}</span>}
              </div>
            </div>

            {/* Big time / tempo / BPM */}
            <DeckMeta st={st} color={color} />
          </div>
        </div>
      </div>

      {/* Waveform (grows) — live analyser or CDJ zoomed view */}
      <div ref={waveWrapRef} className="flex-1 min-h-0" style={{ minHeight: 56 }}>
        {zoomWave
          ? <CDJWaveform eng={eng} duration={st.duration} trackId={st.track?.id} color={color} bpm={st.bpm} beatOffset={st.beatOffset} onSeek={s => seek(deck, s)} height={waveH} />
          : <DJWaveform
              analyser={eng.analyser}
              position={st.position}
              duration={st.duration}
              color={color}
              onSeek={s => seek(deck, s)}
              height={waveH}
              style={waveStyle}
            />
        }
      </div>

      {/* STEM isolation (voix / instru) + zoom toggle */}
      <div className="flex items-center gap-1.5">
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: UI.muted }}>STEM</span>
        <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${UI.border}` }}>
          {STEM_MODES.map(m => {
            const active = st.stem === m.id
            return (
              <button key={m.id} onClick={() => setStem(deck, m.id)}
                className="active:scale-95"
                style={{ padding: '2px 8px', fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
                         background: active ? rgba(color, 0.22) : 'transparent',
                         color: active ? color : UI.muted,
                         borderLeft: m.id !== 'full' ? `1px solid ${UI.border}` : 'none' }}
                title={m.id === 'instrumental' ? 'Annule la voix centrale (karaoké)' : m.id === 'acapella' ? 'Isole la voix (approx.)' : 'Mix complet'}
              >{m.label}</button>
            )
          })}
        </div>
        <StemHqButton deck={deck} color={color} />
        <div className="flex-1" />
        <ZoomToggle color={color} />
      </div>

      {/* Track overview + hot-cue markers */}
      <OverviewBar position={st.position} duration={st.duration} hotCues={st.hotCues} onSeek={s => seek(deck, s)} color={color} bpm={st.bpm} beatOffset={st.beatOffset} trackId={st.track?.id} />

      {/* Jog wheel + pitch (grows to fill the deck's centre) */}
      <div ref={jogWrapRef} className="flex items-center justify-center gap-4 flex-1 min-h-0">
        <JogWheel
          isPlaying={st.isPlaying} position={st.position} duration={st.duration}
          color={color} size={jogSize}
          onScratchStart={() => { if (st.vinyl) scratchStart(deck) }}
          onScratch={d => { st.vinyl ? scratchMove(deck, d) : nudge(deck, d >= 0 ? 1 : -1) }}
          onScratchEnd={() => { st.vinyl ? scratchEnd(deck) : nudgeEnd(deck) }}
        />

        {/* Tempo fader + range + TAP */}
        <div className="flex flex-col items-center gap-1">
          <span style={{ color: UI.muted, fontSize: 9, letterSpacing: 1 }}>TEMPO</span>
          <div style={{ height: pitchH, display: 'flex', alignItems: 'center', position: 'relative' }}>
            <div className="absolute inset-x-0" style={{ top: '50%', height: 1, background: UI.border, margin: '0 -4px' }} />
            <VertFader
              min={-st.tempoRange} max={st.tempoRange} step={0.05}
              center
              value={st.pitch}
              onChange={(v: number) => setPitch(deck, v)}
              color={color}
              height={pitchH}
            />
          </div>
          <button
            onClick={() => setPitch(deck, 0)}
            style={{ color: UI.muted, fontSize: 8, background: UI.card, border: `1px solid ${UI.border}`, padding: '1px 6px', borderRadius: 3 }}
          >
            RESET
          </button>
          {/* Temporary pitch bend (hold) */}
          <div className="flex gap-0.5 mt-0.5">
            {([['−', -1], ['+', 1]] as const).map(([lbl, dir]) => (
              <button key={lbl}
                onMouseDown={() => nudge(deck, dir)}
                onMouseUp={() => nudgeEnd(deck)}
                onMouseLeave={() => nudgeEnd(deck)}
                title={dir < 0 ? 'Ralentir (maintenir)' : 'Accélérer (maintenir)'}
                style={{ color, fontSize: 11, fontWeight: 800, lineHeight: '14px', width: 18, background: UI.card, border: `1px solid ${rgba(color, 0.4)}`, borderRadius: 3 }}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-0.5 mt-0.5">
            {([6, 10, 16, 100] as const).map(r => (
              <button key={r} onClick={() => setTempoRange(deck, r)}
                style={{
                  fontSize: 7.5, padding: '0 4px', borderRadius: 2, lineHeight: '12px',
                  background: st.tempoRange === r ? rgba(color, 0.22) : UI.card,
                  border: `1px solid ${st.tempoRange === r ? color : UI.border}`,
                  color: st.tempoRange === r ? color : UI.muted,
                }}>
                {r === 100 ? 'WIDE' : `±${r}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pro controls: SYNC / MT / Slip / Vinyl / Brake / Censor / Double / Cue */}
      <div className="grid grid-cols-8 gap-1">
        {(() => {
          const proBtn = (label: string, active: boolean, handlers: React.HTMLAttributes<HTMLButtonElement>, title: string) => (
            <button
              {...handlers}
              title={title}
              className="h-7 rounded font-bold transition-all active:scale-95"
              style={{
                fontSize: 8.5, letterSpacing: 0.3,
                background: active ? rgba(color, 0.28) : UI.card,
                border: `1px solid ${active ? color : UI.border}`,
                color: active ? color : UI.muted,
                boxShadow: active ? `0 0 6px ${rgba(color, 0.35)}` : 'none',
              }}
            >{label}</button>
          )
          return <>
            {proBtn('SYNC', false, { onClick: () => syncDeck(deck) }, 'Caler le tempo sur l’autre deck')}
            {proBtn('MT', st.keylock, { onClick: () => setKeylock(deck, !st.keylock) }, 'Master Tempo (keylock)')}
            {proBtn('SLIP', st.slip, { onClick: () => toggleSlip(deck) }, 'Mode Slip')}
            {proBtn('VINYL', st.vinyl, { onClick: () => toggleVinyl(deck) }, 'Jog : scratch (allumé) ou pitch-bend')}
            {proBtn('BRAKE', false, { onMouseDown: () => brake(deck) }, 'Arrêt façon platine (spindown)')}
            {proBtn('CENSOR', false, { onMouseDown: () => censor(deck, true), onMouseUp: () => censor(deck, false), onMouseLeave: () => censor(deck, false) }, 'Censurer (maintenir = coupe le son)')}
            {proBtn('DBL', false, { onClick: () => instantDouble(deck) }, `Doublon instantané vers Deck ${otherDeck}`)}
            {proBtn('CUE🎧', st.cue, { onClick: () => toggleCue(deck) }, 'Pré-écoute casque (PFL)')}
          </>
        })()}
      </div>

      {/* Performance pads */}
      <PadGrid deck={deck} color={color} st={st}
               onMode={m => setPadMode(deck, m)}
               onTrigger={i => triggerPad(deck, i)}
               onRelease={i => releasePad(deck, i)}
               onDelete={i => deleteHotCue(deck, i)} />

      {/* Loop controls */}
      <div className="grid grid-cols-7 gap-1">
        {[
          { label: '◄',    fn: () => moveLoop(deck, -1) },
          { label: 'IN',   fn: () => setLoopIn(deck) },
          { label: 'OUT',  fn: () => setLoopOut(deck) },
          { label: '/2',   fn: () => halveLoop(deck) },
          { label: '×2',   fn: () => doubleLoop(deck) },
          { label: 'LOOP', fn: () => toggleLoop(deck), active: st.isLooping },
          { label: '►',    fn: () => moveLoop(deck, 1) },
        ].map(b => (
          <button
            key={b.label}
            onClick={b.fn}
            className="h-7 rounded font-bold transition-all active:scale-95"
            style={{
              fontSize: 9, letterSpacing: 0.5,
              background: b.active ? rgba(color, 0.3) : UI.card,
              border: `1px solid ${b.active ? color : UI.border}`,
              color: b.active ? color : UI.muted,
              boxShadow: b.active ? `0 0 6px ${rgba(color, 0.35)}` : 'none',
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => prevTrack(deck)}
          disabled={!hasQueue || st.queueIndex <= 0}
          className="p-2 rounded transition-all hover:bg-white/10 disabled:opacity-25"
          style={{ color: hasQueue ? color : UI.dim }}
          title="Piste précédente"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={() => pressCue(deck)}
          className="flex-1 h-10 rounded font-bold tracking-widest transition-all active:scale-95"
          style={{ fontSize: 10, background: UI.card, border: `1px solid ${rgba(color, 0.55)}`, color }}
          title="Définir/aller au point CUE"
        >
          CUE
        </button>

        <button
          onClick={() => togglePlay(deck)}
          className="w-16 h-10 rounded flex items-center justify-center transition-all active:scale-95"
          style={{
            background: st.isPlaying ? rgba(color, 0.28) : rgba(color, 0.16),
            border: `1.5px solid ${color}`,
            boxShadow: st.isPlaying ? `0 0 16px ${rgba(color, 0.45)}` : 'none',
          }}
        >
          {st.isPlaying
            ? <Pause className="w-5 h-5" style={{ color }} />
            : <Play  className="w-5 h-5 ml-0.5" style={{ color }} />
          }
        </button>

        <button
          onClick={() => nextTrack(deck)}
          disabled={!hasQueue || st.queueIndex >= st.queue.length - 1}
          className="p-2 rounded transition-all hover:bg-white/10 disabled:opacity-25"
          style={{ color: hasQueue ? color : UI.dim }}
          title="Piste suivante"
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>

      {/* Embedded channel strip — only when decks C–F have no central mixer column */}
      {compact && <DeckChannelStrip deck={deck} color={color} />}

      {queueOpen && <QueuePanel deck={deck} color={color} st={st} onClose={() => setQueueOpen(false)} />}
      {ctx && <MenuDropdown theme="dark" pos={ctx} onClose={() => setCtx(null)} items={deckMenu()} />}
    </div>
  )
}

// Compact per-deck channel strip (TRIM · EQ · COLOR · volume · CUE · crossfader
// assignment) used in 4/6-deck layouts where the central mixer only drives A/B.
function DeckChannelStrip({ deck, color }: { deck: DeckId; color: string }) {
  const st = useDJStore(s => s[DECK_FIELD[deck]])
  const xf = useDJStore(s => s.xfAssign[deck])
  const { setEq, setGain, setVolume, setColor, toggleCue, setXfAssign } = useDJStore()
  const XF: { id: XfAssign; lbl: string }[] = [{ id: 'A', lbl: 'A' }, { id: 'thru', lbl: 'TH' }, { id: 'B', lbl: 'B' }]
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1" style={{ background: rgba('#000000', 0.28), border: `1px solid ${UI.border}` }}>
      <Knob value={st.gain}   min={0}   max={2} onChange={(v: number) => setGain(deck, v)}          label="TRIM" color={color} size={26} />
      <Knob value={st.eqHigh} min={-12} max={6} onChange={(v: number) => setEq(deck, 'high', v)}     label="HI"   color={color} size={26} unit="dB" />
      <Knob value={st.eqMid}  min={-12} max={6} onChange={(v: number) => setEq(deck, 'mid',  v)}     label="MID"  color={color} size={26} unit="dB" />
      <Knob value={st.eqLow}  min={-12} max={6} onChange={(v: number) => setEq(deck, 'low',  v)}     label="LOW"  color={color} size={26} unit="dB" />
      <Knob value={st.color}  min={-1}  max={1} onChange={(v: number) => setColor(deck, v)}          label="COL"  color={color} size={26} />
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <span style={{ fontSize: 7.5, letterSpacing: 0.5, color: UI.muted }}>VOL</span>
        <RangeSlider min={0} max={1} step={0.01} value={st.volume}
               onChange={(v: number) => setVolume(deck, v)}
               accent={color} trackColor="rgba(255,255,255,0.15)"
               style={{ width: '100%' }} aria-label="Volume" />
      </div>
      <button onClick={() => toggleCue(deck)}
        className="rounded active:scale-95" style={{ padding: '2px 6px', fontSize: 8.5, fontWeight: 700,
          background: st.cue ? rgba(color, 0.22) : UI.card, border: `1px solid ${st.cue ? color : UI.border}`, color: st.cue ? color : UI.muted }}
        title="Pré-écoute casque (PFL)">CUE</button>
      <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${UI.border}` }} title="Affectation au crossfader (A · Direct · B)">
        {XF.map(o => {
          const active = xf === o.id
          return (
            <button key={o.id} onClick={() => setXfAssign(deck, o.id)}
              style={{ padding: '2px 5px', fontSize: 8, fontWeight: 700,
                       background: active ? rgba(color, 0.22) : 'transparent', color: active ? color : UI.muted,
                       borderLeft: o.id !== 'A' ? `1px solid ${UI.border}` : 'none' }}>{o.lbl}</button>
          )
        })}
      </div>
    </div>
  )
}

// ── Compact deck (4 / 6-deck layouts) ─────────────────────────────────────────
// A condensed, waveform-first deck. Unlike the full DJDeck, every row has an
// intrinsic height and only the waveform flexes, so nothing ever overlaps when
// the panel is squeezed to half / a third of the screen. The big jog wheel is
// dropped (seeking via the waveform); pads + pro toggles live in a pop-up.
function DJDeckCompact({ deck, color }: { deck: DeckId; color: string }) {
  const eng = djEngine(deck)
  const st  = useDJStore(s => s[DECK_FIELD[deck]])
  const zoomWave  = useDJStore(s => s.zoomWave)
  const waveStyle = useDJStore(s => s.waveStyle)
  const analyzing = useDJStore(s => s.analyzing)
  const setStem   = useDJStore(s => s.setStem)
  const { togglePlay, pressCue, seek, syncDeck, setPitch, nudge, nudgeEnd, setTempoRange,
          setLoopIn, setLoopOut, toggleLoop, analyzeTrack, toggleShuffle, cycleRepeat, tapBpm,
          setPadMode, triggerPad, releasePad, deleteHotCue, loadTrack, setWaveStyle,
          setKeylock, toggleSlip, toggleVinyl, brake, censor, instantDouble, toggleCue,
          nextTrack, prevTrack } = useDJStore()
  const otherDeck: DeckId = deck === 'A' ? 'B' : 'A'
  const hasQueue = st.queue.length > 0
  const [perfOpen,  setPerfOpen]  = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [ctx, setCtx] = useState<MenuDropdownPos | null>(null)

  const mini = (active: boolean): React.CSSProperties => ({
    padding: '2px 6px', fontSize: 8, fontWeight: 700, letterSpacing: 0.3, borderRadius: 3,
    background: active ? rgba(color, 0.22) : UI.card, border: `1px solid ${active ? color : UI.border}`,
    color: active ? color : UI.muted, lineHeight: '14px',
  })
  const tBtn = (active: boolean): React.CSSProperties => ({
    height: 28, padding: '0 8px', fontSize: 9, fontWeight: 700, letterSpacing: 0.4, borderRadius: 4,
    background: active ? rgba(color, 0.26) : UI.card, border: `1px solid ${active ? color : UI.border}`,
    color: active ? color : UI.soft,
  })

  const menu = (): MenuItem[] => [
    { type: 'label', text: st.track ? st.track.title : `Deck ${deck}` },
    { type: 'action', label: st.isPlaying ? 'Pause' : 'Lecture', disabled: !st.track, onClick: () => togglePlay(deck) },
    { type: 'action', label: `Doublon vers Deck ${otherDeck}`, disabled: !st.track, onClick: () => st.track && loadTrack(otherDeck, st.track) },
    { type: 'separator' },
    { type: 'submenu', label: 'Plage de tempo', items: ([6, 10, 16, 100] as const).map(r => ({
      type: 'action', label: r === 100 ? 'WIDE' : `± ${r} %`, checked: st.tempoRange === r, onClick: () => setTempoRange(deck, r) })) },
    { type: 'submenu', label: "Style d'onde", items: WAVE_STYLES.map(w => ({
      type: 'action', label: w.label, checked: waveStyle === w.id, onClick: () => setWaveStyle(w.id) })) },
    { type: 'submenu', label: 'Isolation (stem)', items: STEM_MODES.map(m => ({
      type: 'action', label: m.label, checked: st.stem === m.id, onClick: () => setStem(deck, m.id) })) },
    { type: 'action', label: 'Taper le BPM', onClick: () => tapBpm(deck) },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden relative" style={{ background: deckBg(color), padding: 7, gap: 5 }}
         onContextMenu={e => { e.preventDefault(); setCtx({ top: e.clientY, left: e.clientX, minWidth: 210 }) }}>
      {/* Header: art + title/meta + time + quick buttons */}
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <div className="rounded-md flex-shrink-0 overflow-hidden" style={{ width: 44, height: 44, background: UI.well, border: `1px solid ${rgba(color, 0.3)}` }}>
          {st.track?.coverUrl
            ? <img src={st.track.coverUrl} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><Music className="w-5 h-5" style={{ color: UI.dim }} /></div>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span style={{ color, fontSize: 9, fontWeight: 800, letterSpacing: 1, textShadow: `0 0 10px ${rgba(color, 0.6)}` }}>DECK {deck}</span>
            {st.isLoading && <Loader2 className="w-3 h-3 animate-spin" style={{ color }} />}
          </div>
          <p className="truncate font-bold leading-tight" style={{ color: st.track ? UI.text : UI.dim, fontSize: 14 }}>{st.track?.title ?? 'Aucune piste'}</p>
          <div className="flex items-center gap-1.5 truncate" style={{ fontSize: 9, color: UI.muted }}>
            <span className="truncate">{st.track?.artistName ?? '—'}</span>
            {st.bpm != null && <span style={{ color }}>· {st.bpm.toFixed(1)} BPM</span>}
            {st.keyName && <span style={{ color, fontWeight: 700 }}>· {st.keyName}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 800, color: st.track ? UI.text : UI.dim, lineHeight: 1 }}>{fmt(st.position)}</div>
          <div style={{ fontFamily: 'monospace', fontSize: 8.5, color: UI.muted }}>{st.track ? fmtR(st.position, st.duration) : '—'}</div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => analyzeTrack(deck)} disabled={!st.track || analyzing === deck} style={mini(analyzing === deck)} title="Analyser : BPM + tonalité + grille">{analyzing === deck ? '…' : 'ANALYSE'}</button>
          <button onClick={() => setQueueOpen(o => !o)} style={mini(queueOpen || hasQueue)} title="File d'attente"><ListMusic className="w-3 h-3" /></button>
          <button onClick={() => toggleShuffle(deck)} style={mini(st.shuffle)} title="Aléatoire"><Shuffle className="w-3 h-3" /></button>
          <button onClick={() => cycleRepeat(deck)} style={mini(st.repeatMode !== 'off')} title="Répétition">{st.repeatMode === 'one' ? <Repeat1 className="w-3 h-3" /> : <Repeat className="w-3 h-3" />}</button>
        </div>
      </div>

      {/* STEM · ZOOM · TEMPO */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${UI.border}` }}>
          {STEM_MODES.map(m => { const active = st.stem === m.id; return (
            <button key={m.id} onClick={() => setStem(deck, m.id)} title={m.id === 'instrumental' ? 'Annule la voix (karaoké)' : m.id === 'acapella' ? 'Isole la voix' : 'Mix complet'}
              style={{ padding: '2px 7px', fontSize: 8.5, fontWeight: 700, background: active ? rgba(color, 0.22) : 'transparent', color: active ? color : UI.muted, borderLeft: m.id !== 'full' ? `1px solid ${UI.border}` : 'none' }}>{m.label}</button>
          )})}
        </div>
        <StemHqButton deck={deck} color={color} />
        <ZoomToggle color={color} />
        <div className="flex-1" />
        <span style={{ fontSize: 8, letterSpacing: 0.5, color: UI.muted }}>TEMPO</span>
        <button onMouseDown={() => nudge(deck, -1)} onMouseUp={() => nudgeEnd(deck)} onMouseLeave={() => nudgeEnd(deck)} style={mini(false)} title="Ralentir (maintenir)">−</button>
        <RangeSlider min={-st.tempoRange} max={st.tempoRange} step={0.05} value={st.pitch} onChange={(v: number) => setPitch(deck, v)} accent={color} trackColor="rgba(255,255,255,0.15)" style={{ width: 96 }} aria-label="Pitch" />
        <button onMouseDown={() => nudge(deck, 1)} onMouseUp={() => nudgeEnd(deck)} onMouseLeave={() => nudgeEnd(deck)} style={mini(false)} title="Accélérer (maintenir)">+</button>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color, width: 46, textAlign: 'right' }}>{st.pitch > 0 ? '+' : ''}{st.pitch.toFixed(1)}%</span>
      </div>

      {/* Waveform (the only flexing row) */}
      <div className="flex-1 min-h-0" style={{ minHeight: 42 }}>
        {zoomWave
          ? <CDJWaveform eng={eng} duration={st.duration} trackId={st.track?.id} color={color} bpm={st.bpm} beatOffset={st.beatOffset} onSeek={s => seek(deck, s)} height={120} />
          : <DJWaveform analyser={eng.analyser} position={st.position} duration={st.duration} color={color} onSeek={s => seek(deck, s)} height={120} style={waveStyle} />}
      </div>

      {/* Overview + cues */}
      <OverviewBar position={st.position} duration={st.duration} hotCues={st.hotCues} onSeek={s => seek(deck, s)} color={color} bpm={st.bpm} beatOffset={st.beatOffset} trackId={st.track?.id} />

      {/* Channel strip */}
      <DeckChannelStrip deck={deck} color={color} />

      {/* Transport + loop + pads pop-up */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={() => syncDeck(deck)} style={tBtn(false)} title="Caler le tempo sur l'autre deck">SYNC</button>
        <button onClick={() => prevTrack(deck)} disabled={!hasQueue || st.queueIndex <= 0} className="disabled:opacity-25" style={{ ...tBtn(false), padding: '0 6px' }}><SkipBack className="w-3.5 h-3.5" style={{ color }} /></button>
        <button onClick={() => pressCue(deck)} className="flex-1" style={{ ...tBtn(false), border: `1px solid ${rgba(color, 0.55)}`, color }} title="CUE">CUE</button>
        <button onClick={() => togglePlay(deck)} style={{ width: 56, height: 28, borderRadius: 4, background: st.isPlaying ? rgba(color, 0.28) : rgba(color, 0.16), border: `1.5px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {st.isPlaying ? <Pause className="w-4 h-4" style={{ color }} /> : <Play className="w-4 h-4 ml-0.5" style={{ color }} />}
        </button>
        <button onClick={() => nextTrack(deck)} disabled={!hasQueue || st.queueIndex >= st.queue.length - 1} className="disabled:opacity-25" style={{ ...tBtn(false), padding: '0 6px' }}><SkipForward className="w-3.5 h-3.5" style={{ color }} /></button>
        <span style={{ width: 4 }} />
        <button onClick={() => setLoopIn(deck)} style={tBtn(false)} title="Point d'entrée de boucle">IN</button>
        <button onClick={() => setLoopOut(deck)} style={tBtn(false)} title="Point de sortie de boucle">OUT</button>
        <button onClick={() => toggleLoop(deck)} style={tBtn(st.isLooping)} title="Activer/désactiver la boucle">LOOP</button>
        <button onClick={() => setPerfOpen(o => !o)} style={tBtn(perfOpen)} title="Pads & contrôles avancés">PADS ▾</button>
      </div>

      {/* Performance pop-up: pro toggles + pad grid */}
      {perfOpen && (
        <div className="absolute rounded-lg p-2 flex flex-col gap-1.5" style={{ left: 6, right: 6, bottom: 6, background: '#161a36', border: `1px solid ${rgba(color, 0.5)}`, boxShadow: '0 -10px 28px rgba(0,0,0,0.55)', zIndex: 30 }}>
          <div className="flex items-center justify-between">
            <span style={{ color, fontSize: 9, fontWeight: 800, letterSpacing: 1 }}>DECK {deck} · PADS</span>
            <button onClick={() => setPerfOpen(false)} style={mini(false)}>✕</button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {([
              ['MT', st.keylock, () => setKeylock(deck, !st.keylock)],
              ['SLIP', st.slip, () => toggleSlip(deck)],
              ['VINYL', st.vinyl, () => toggleVinyl(deck)],
              ['BRAKE', false, () => brake(deck)],
              ['DBL', false, () => instantDouble(deck)],
              ['CUE🎧', st.cue, () => toggleCue(deck)],
            ] as const).map(([lbl, active, fn]) => (
              <button key={lbl} onClick={fn} onMouseDown={lbl === 'BRAKE' ? fn : undefined}
                className="h-7 rounded font-bold active:scale-95" style={{ fontSize: 8.5, background: active ? rgba(color, 0.28) : UI.card, border: `1px solid ${active ? color : UI.border}`, color: active ? color : UI.muted }}>{lbl}</button>
            ))}
            <button onMouseDown={() => censor(deck, true)} onMouseUp={() => censor(deck, false)} onMouseLeave={() => censor(deck, false)}
              className="h-7 rounded font-bold active:scale-95" style={{ fontSize: 8.5, background: UI.card, border: `1px solid ${UI.border}`, color: UI.muted }}>CENSOR</button>
          </div>
          <PadGrid deck={deck} color={color} st={st}
                   onMode={m => setPadMode(deck, m)} onTrigger={i => triggerPad(deck, i)}
                   onRelease={i => releasePad(deck, i)} onDelete={i => deleteHotCue(deck, i)} />
        </div>
      )}

      {queueOpen && <QueuePanel deck={deck} color={color} st={st} onClose={() => setQueueOpen(false)} />}
      {ctx && <MenuDropdown theme="dark" pos={ctx} onClose={() => setCtx(null)} items={menu()} />}
    </div>
  )
}

// ── Graphic equaliser panel (overlay) ─────────────────────────────────────────

const eqFreqLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`)
const dbStr = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)

function EqSlider({ label, value, min, max, step = 1, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; fmt?: (v: number) => string
}) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: UI.soft, fontSize: 10, fontWeight: 700, letterSpacing: 1, width: 78, flexShrink: 0 }}>{label}</span>
      <RangeSlider min={min} max={max} step={step} value={value}
        onChange={onChange}
        accent={ACCENT} trackColor="rgba(255,255,255,0.15)"
        className="flex-1" aria-label={label} />
      <span style={{ color: ACCENT, fontSize: 10, fontFamily: 'monospace', width: 30, textAlign: 'right' }}>
        {fmt ? fmt(value) : dbStr(value)}
      </span>
    </div>
  )
}

function GraphicEqPanel({ onClose }: { onClose: () => void }) {
  const { eq, updateEq, setEqPreset, resetEq } = useDJStore()
  const setBand = (i: number, v: number) => { const bands = [...eq.bands]; bands[i] = v; updateEq({ bands }) }

  const chip = (active: boolean) => ({
    fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: '4px 10px', borderRadius: 999,
    background: active ? ACCENT : UI.card,
    border: `1px solid ${active ? ACCENT : UI.border}`,
    color: active ? '#0b0c0f' : UI.soft,
  } as React.CSSProperties)

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ background: rgba('#05060c', 0.62) }} onMouseDown={onClose}>
      <div
        onMouseDown={e => e.stopPropagation()}
        className="rounded-2xl p-4 flex flex-col gap-3"
        style={{
          width: 380, maxHeight: '94%', overflow: 'hidden',
          background: 'linear-gradient(180deg, #24262c 0%, #17181c 100%)',
          border: `1px solid ${rgba(ACCENT, 0.3)}`, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5" style={{ color: ACCENT }} />
          <span style={{ color: UI.text, fontSize: 18, fontWeight: 800 }}>Égaliseur</span>
          <div className="flex-1" />
          <button onClick={resetEq} style={chip(false)}>RESET</button>
          <button onClick={() => updateEq({ bypass: !eq.bypass })} style={chip(eq.bypass)}>BYP</button>
          <button onClick={onClose} className="ml-1" style={{ color: UI.muted }}><X className="w-4 h-4" /></button>
        </div>

        {/* Tone sliders */}
        <div className="flex flex-col gap-1.5">
          <EqSlider label="SURROUND"  value={eq.surround} min={-12} max={12} onChange={(v: number) => updateEq({ surround: v })} />
          <EqSlider label="DEEP BASS" value={eq.deepBass} min={-12} max={12} onChange={(v: number) => updateEq({ deepBass: v })} />
          <EqSlider label="BALANCE"   value={eq.balance}  min={-1}  max={1} step={0.05}
            onChange={(v: number) => updateEq({ balance: v })}
            fmt={v => Math.abs(v) < 0.03 ? '0' : `${v < 0 ? 'G' : 'D'}${Math.round(Math.abs(v) * 100)}`} />
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-5">
          {([['AMPLIFIER', 'amplifier'], ['COMPRESSOR', 'compressor']] as const).map(([lbl, key]) => (
            <button key={key} onClick={() => updateEq({ [key]: !eq[key] } as Partial<typeof eq>)} className="flex items-center gap-2">
              <span className="rounded flex items-center justify-center" style={{
                width: 18, height: 18,
                background: eq[key] ? ACCENT : UI.card,
                border: `1px solid ${eq[key] ? ACCENT : UI.border2}`,
              }}>
                {eq[key] && <span style={{ color: '#0b0c0f', fontSize: 12, fontWeight: 900, lineHeight: '12px' }}>✓</span>}
              </span>
              <span style={{ color: UI.soft, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>{lbl}</span>
            </button>
          ))}
        </div>

        {/* Pre-amp gain */}
        <EqSlider label="GAIN" value={eq.gain} min={-12} max={12} onChange={(v: number) => updateEq({ gain: v })} />

        {/* Band sliders + scale */}
        <div className="flex gap-2 pt-1">
          <div className="flex-1 flex items-end justify-between gap-1" style={{ height: 230 }}>
            {EQ_FREQS.map((f, i) => (
              <div key={f} className="flex flex-col items-center gap-1" style={{ flex: 1 }}>
                <span style={{ color: eq.bands[i] ? ACCENT : UI.muted, fontSize: 9, fontFamily: 'monospace' }}>{dbStr(eq.bands[i])}</span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                  <RangeSlider
                    orientation="vertical"
                    min={-12} max={12} step={1} value={eq.bands[i]}
                    onChange={(v: number) => setBand(i, v)}
                    accent={ACCENT}
                    trackColor="rgba(255,255,255,0.15)"
                    style={{ height: 170 } as React.CSSProperties}
                    aria-label={`EQ ${eqFreqLabel(f)}`}
                  />
                </div>
                <span style={{ color: UI.muted, fontSize: 8 }}>{eqFreqLabel(f)}</span>
              </div>
            ))}
          </div>
          {/* +12 / 0 / -12 scale */}
          <div className="flex flex-col justify-between items-end" style={{ height: 200, marginBottom: 16 }}>
            {['+12', '0', '−12'].map(s => <span key={s} style={{ color: UI.dim, fontSize: 8, fontFamily: 'monospace' }}>{s}</span>)}
          </div>
        </div>

        {/* Preset chips */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {EQ_PRESETS.map(p => (
            <button key={p.name} onClick={() => setEqPreset(p.name)} style={chip(!eq.bypass && eq.preset === p.name)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Mixer (center) ────────────────────────────────────────────────────────────

function DJMixer({ onOpenEq }: { onOpenEq: () => void }) {
  const { deckA, deckB, crossfader, masterVolume, crossfaderCurve, isRecording, eq,
          setEq, setGain, setVolume, setCrossfader, setMasterVol,
          setCrossfaderCurve, toggleRecording, setColor, setColorFx } = useDJStore()

  return (
    <div className="flex flex-col gap-2 p-3 h-full relative overflow-hidden" style={{
      minWidth: 248,
      background: 'radial-gradient(130% 55% at 50% 0%, ' + rgba(ACCENT, 0.10) + ' 0%, rgba(0,0,0,0) 60%),'
                + ' linear-gradient(180deg, #232529 0%, #1a1c20 60%, #121316 100%)',
    }}>
      <p className="text-center font-bold tracking-[0.3em]" style={{
        color: ACCENT, fontSize: 10, textShadow: `0 0 12px ${rgba(ACCENT, 0.6)}`,
      }}>
        MIXER
      </p>

      {/* Harmonic mixing indicator */}
      {(() => {
        const a = deckA.keyName, b = deckB.keyName
        const both = !!(camelotOf(a) && camelotOf(b))
        const ok = both && harmonicCompatible(a, b)
        const c = !both ? UI.muted : ok ? '#34d399' : '#ffaa44'
        return (
          <div className="flex items-center justify-center gap-2 rounded-md py-0.5" style={{ background: rgba('#000000', 0.22), border: `1px solid ${rgba(c, 0.4)}` }}
            title="Compatibilité harmonique (roue Camelot) entre A et B">
            <span style={{ color: COL_A, fontSize: 9, fontFamily: 'monospace', fontWeight: 700 }}>{camelotOf(a) ?? '—'}</span>
            <span style={{ color: c, fontSize: 9, fontWeight: 800 }}>{!both ? 'HARMONIE' : ok ? '✓ COMPATIBLE' : '≠'}</span>
            <span style={{ color: COL_B, fontSize: 9, fontFamily: 'monospace', fontWeight: 700 }}>{camelotOf(b) ?? '—'}</span>
          </div>
        )
      })()}

      {/* Open the graphic equaliser panel (kept off the mixer to save space) */}
      <button
        onClick={onOpenEq}
        className="dj-fx-btn flex items-center justify-center gap-2 rounded-lg h-7"
        style={{
          background: eq.bypass ? UI.card : rgba(ACCENT, 0.14),
          border: `1px solid ${eq.bypass ? UI.border : rgba(ACCENT, 0.5)}`,
          color: eq.bypass ? UI.muted : ACCENT,
        }}
        title="Ouvrir l'égaliseur graphique"
      >
        <Sliders className="w-3.5 h-3.5" />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>ÉGALISEUR</span>
        <span style={{ fontSize: 8, opacity: 0.8 }}>· {eq.bypass ? 'BYP' : eq.preset}</span>
      </button>

      {/* EQ ─────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col items-center gap-1">
          <span style={{ color: COL_A, fontSize: 9, fontWeight: 700 }}>A</span>
          <Knob value={deckA.eqHigh} min={-12} max={6} onChange={(v: number) => setEq('A', 'high', v)} label="HIGH" color={COL_A} size={34} unit="dB" />
          <Knob value={deckA.eqMid}  min={-12} max={6} onChange={(v: number) => setEq('A', 'mid',  v)} label="MID"  color={COL_A} size={34} unit="dB" />
          <Knob value={deckA.eqLow}  min={-12} max={6} onChange={(v: number) => setEq('A', 'low',  v)} label="LOW"  color={COL_A} size={34} unit="dB" />
          <Knob value={deckA.color}  min={-1}  max={1} onChange={(v: number) => setColor('A', v)}      label="COLOR" color={COL_A} size={34} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <span style={{ color: COL_B, fontSize: 9, fontWeight: 700 }}>B</span>
          <Knob value={deckB.eqHigh} min={-12} max={6} onChange={(v: number) => setEq('B', 'high', v)} label="HIGH" color={COL_B} size={34} unit="dB" />
          <Knob value={deckB.eqMid}  min={-12} max={6} onChange={(v: number) => setEq('B', 'mid',  v)} label="MID"  color={COL_B} size={34} unit="dB" />
          <Knob value={deckB.eqLow}  min={-12} max={6} onChange={(v: number) => setEq('B', 'low',  v)} label="LOW"  color={COL_B} size={34} unit="dB" />
          <Knob value={deckB.color}  min={-1}  max={1} onChange={(v: number) => setColor('B', v)}      label="COLOR" color={COL_B} size={34} />
        </div>
      </div>

      {/* SOUND COLOR FX — shared effect type for both COLOR knobs */}
      <div className="grid grid-cols-4 gap-1">
        {([['filter', 'FILTER'], ['noise', 'NOISE'], ['crush', 'CRUSH'], ['echo', 'DUB ECHO']] as [ColorFx, string][]).map(([fx, lbl]) => {
          const active = deckA.colorFx === fx
          return (
            <button key={fx} onClick={() => { setColorFx('A', fx); setColorFx('B', fx) }}
              style={{
                fontSize: 8, padding: '3px 2px', borderRadius: 4,
                background: active ? rgba(ACCENT, 0.2) : UI.card,
                border: `1px solid ${active ? ACCENT : UI.border}`,
                color: active ? ACCENT : UI.muted,
              }}>
              {lbl}
            </button>
          )
        })}
      </div>

      {/* Channel TRIM + faders + VU — same 2-col grid as the EQ so A/B align ───── */}
      <div className="grid grid-cols-2 gap-2 items-stretch flex-1 min-h-0">
        <div className="flex flex-col items-center gap-1.5 min-h-0">
          <Knob value={deckA.gain} min={0} max={2} onChange={(v: number) => setGain('A', v)} label="TRIM" color={COL_A} size={34} />
          <div className="flex gap-1.5 items-stretch flex-1 min-h-0">
            <VUMeter analyser={djEngine('A').analyser} color={COL_A} fill />
            <VertFader value={deckA.volume} onChange={(v: number) => setVolume('A', v)} color={COL_A} height="100%" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1.5 min-h-0">
          <Knob value={deckB.gain} min={0} max={2} onChange={(v: number) => setGain('B', v)} label="TRIM" color={COL_B} size={34} />
          <div className="flex gap-1.5 items-stretch flex-1 min-h-0">
            <VertFader value={deckB.volume} onChange={(v: number) => setVolume('B', v)} color={COL_B} height="100%" />
            <VUMeter analyser={djEngine('B').analyser} color={COL_B} fill />
          </div>
        </div>
      </div>

      {/* Crossfader ──────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span style={{ color: COL_A, fontSize: 9, fontWeight: 700 }}>A</span>
          <span style={{ color: UI.muted, fontSize: 8, letterSpacing: 2 }}>CROSSFADER</span>
          <span style={{ color: COL_B, fontSize: 9, fontWeight: 700 }}>B</span>
        </div>
        <HorizFader
          min={-1} max={1} step={0.01}
          value={crossfader}
          onChange={setCrossfader}
          color={ACCENT}
          label="Crossfader"
        />
        <div className="flex items-center justify-center gap-1 mt-1.5">
          <button
            onClick={() => setCrossfader(0)}
            style={{ color: UI.muted, fontSize: 8, background: UI.card, border: `1px solid ${UI.border}`, padding: '1px 8px', borderRadius: 3 }}
          >
            CENTRE
          </button>
          <span style={{ width: 1, height: 12, background: UI.border }} />
          {([['smooth', 'DOUCE'], ['linear', 'LIN.'], ['sharp', 'NETTE']] as [CrossfaderCurve, string][]).map(([c, lbl]) => (
            <button
              key={c}
              onClick={() => setCrossfaderCurve(c)}
              style={{
                fontSize: 8, padding: '1px 6px', borderRadius: 3,
                background: crossfaderCurve === c ? rgba(ACCENT, 0.22) : UI.card,
                border: `1px solid ${crossfaderCurve === c ? ACCENT : UI.border}`,
                color: crossfaderCurve === c ? ACCENT : UI.muted,
              }}
              title={`Courbe de transition : ${lbl}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Master + record ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-center gap-5 pt-2" style={{ borderTop: `1px solid ${UI.border}` }}>
        <Knob value={masterVolume} min={0} max={1} onChange={setMasterVol} label="MASTER" color={ACCENT} size={46} />
        <button
          onClick={toggleRecording}
          className="flex flex-col items-center gap-0.5"
          title={isRecording ? 'Arrêter et télécharger le mix' : 'Enregistrer le mix'}
        >
          <span
            className="flex items-center justify-center rounded-full transition-all"
            style={{
              width: 46, height: 46,
              background: isRecording ? rgba('#ff2244', 0.24) : UI.card,
              border: `2px solid ${isRecording ? '#ff2244' : UI.border2}`,
              boxShadow: isRecording ? '0 0 18px rgba(255,34,68,0.55)' : 'none',
              animation: isRecording ? 'djRecPulse 1.4s ease-in-out infinite' : 'none',
            }}
          >
            <Circle className="w-4 h-4" style={{
              color: isRecording ? '#ff2244' : UI.muted,
              fill:  isRecording ? '#ff2244' : 'transparent',
            }} />
          </span>
          <span style={{ color: isRecording ? '#ff4d5e' : UI.muted, fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>
            {isRecording ? 'REC' : 'ENREG.'}
          </span>
        </button>
      </div>
    </div>
  )
}

// ── Track browser (bottom panel) ──────────────────────────────────────────────

type BrowserTab = 'recent' | 'liked' | 'artists' | 'albums' | 'playlists'

interface DJTrack {
  id: string
  title: string
  duration_secs: number
  artist_name?: string | null
  cover_path?: string | null
}

const DJ_TABS: [BrowserTab, string][] = [
  ['recent',    'Récents'],
  ['liked',     'Favoris'],
  ['artists',   'Artistes'],
  ['albums',    'Albums'],
  ['playlists', 'Playlists'],
]

function DJBrowser({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  const [tab,          setTab]          = useState<BrowserTab>('recent')
  const [search,       setSearch]       = useState('')
  const [artistId,     setArtistId]     = useState<string | null>(null)
  const [artistName,   setArtistName]   = useState('')
  const [albumId,      setAlbumId]      = useState<string | null>(null)
  const [albumName,    setAlbumName]    = useState('')
  const [playlistId,   setPlaylistId]   = useState<string | null>(null)
  const [playlistName, setPlaylistName] = useState('')

  const loadTrackToStore = useDJStore(s => s.loadTrack)
  const loadQueueToStore = useDJStore(s => s.loadQueue)
  const autoDjQueue      = useDJStore(s => s.autoDjQueue)
  const deckCount        = useDJStore(s => s.deckCount)
  const activeDecks: DeckId[] = (['A', 'B', 'C', 'D', 'E', 'F'] as DeckId[]).slice(0, deckCount)
  const enabled = isOpen
  const isQueueContext = !!(albumId || playlistId)
  const [rowCtx, setRowCtx] = useState<{ pos: MenuDropdownPos; track: DJTrack } | null>(null)

  const switchTab = (t: BrowserTab) => {
    setTab(t); setSearch('')
    setArtistId(null); setArtistName('')
    setAlbumId(null);  setAlbumName('')
    setPlaylistId(null); setPlaylistName('')
  }

  const goBack = () => {
    if (albumId)       { setAlbumId(null); setAlbumName('') }
    else if (artistId) { setArtistId(null); setArtistName('') }
    else if (playlistId) { setPlaylistId(null); setPlaylistName('') }
  }

  const hasBack = !!(albumId || artistId || playlistId)
  const backLabel = albumName || artistName || playlistName || 'Retour'

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: recent    = [], isLoading: lRec } = useQuery({ queryKey: ['dj','recent'],           queryFn: mediaApi.getRecentlyPlayed, enabled: enabled && tab === 'recent' })
  const { data: liked     = [], isLoading: lLik } = useQuery({ queryKey: ['dj','liked'],            queryFn: mediaApi.getLikedTracks,    enabled: enabled && tab === 'liked'  })
  const { data: artists   = [], isLoading: lArt } = useQuery({ queryKey: ['dj','artists', search],  queryFn: () => mediaApi.getArtists({ q: search || undefined, limit: 80 }), enabled: enabled && tab === 'artists' && !artistId })
  const { data: artistDet }                        = useQuery({ queryKey: ['dj','artist', artistId], queryFn: () => mediaApi.getArtist(artistId!), enabled: enabled && !!artistId })
  const { data: albums    = [], isLoading: lAlb } = useQuery({ queryKey: ['dj','albums',  search],  queryFn: () => mediaApi.getAlbums({ q: search || undefined, limit: 80 }), enabled: enabled && tab === 'albums' && !albumId })
  const { data: albumDet }                         = useQuery({ queryKey: ['dj','album',  albumId],  queryFn: () => mediaApi.getAlbum(albumId!),   enabled: enabled && !!albumId })
  const { data: playlists = [], isLoading: lPla } = useQuery({ queryKey: ['dj','playlists'],         queryFn: mediaApi.getPlaylists,               enabled: enabled && tab === 'playlists' && !playlistId })
  const { data: playlistDet }                      = useQuery({ queryKey: ['dj','playlist', playlistId], queryFn: () => mediaApi.getPlaylist(playlistId!), enabled: enabled && !!playlistId })

  // ── Resolved track list ────────────────────────────────────────────────────
  const djTracks: DJTrack[] = (() => {
    if (tab === 'recent')  return recent.map(t  => ({ id: t.id, title: t.title, duration_secs: t.duration_secs, cover_path: t.cover_path }))
    if (tab === 'liked')   return liked.map(t   => ({ id: t.id, title: t.title, duration_secs: t.duration_secs, cover_path: t.cover_path }))
    if (albumId && albumDet)       return albumDet.tracks.map(t => ({ id: t.id, title: t.title, duration_secs: t.duration_secs, cover_path: t.cover_path ?? albumDet.album.cover_path }))
    if (playlistId && playlistDet) return playlistDet.tracks.map(t => ({ id: t.id, title: t.title, duration_secs: t.duration_secs, artist_name: t.artist_name, cover_path: t.cover_path }))
    return []
  })()

  const showTrackList   = tab === 'recent' || tab === 'liked' || !!albumId || !!playlistId
  const showArtistList  = tab === 'artists'   && !artistId
  const showArtistAlbum = tab === 'artists'   && !!artistId && !albumId
  const showAlbumList   = tab === 'albums'    && !albumId
  const showPlaylist    = tab === 'playlists' && !playlistId
  const showSearch      = (tab === 'artists' && !hasBack) || (tab === 'albums' && !albumId)

  const isLoading =
    (tab === 'recent'    && lRec) ||
    (tab === 'liked'     && lLik) ||
    (tab === 'artists'   && !artistId && lArt) ||
    (tab === 'albums'    && !albumId  && lAlb) ||
    (tab === 'playlists' && !playlistId && lPla)

  function toPlayerTrack(t: DJTrack) {
    return {
      id: t.id, title: t.title, durationSecs: t.duration_secs,
      artistName: t.artist_name ?? undefined,
      coverUrl: (t.cover_path ? posterUrl(t.cover_path) : null) ?? undefined,
    }
  }

  function sendToDeck(deck: DeckId, t: DJTrack) {
    if (isQueueContext && djTracks.length > 1) {
      const idx = djTracks.findIndex(x => x.id === t.id)
      loadQueueToStore(deck, djTracks.map(toPlayerTrack), idx >= 0 ? idx : 0)
    } else {
      loadTrackToStore(deck, toPlayerTrack(t))
    }
  }

  function sendAllToDeck(deck: DeckId) {
    if (djTracks.length === 0) return
    loadQueueToStore(deck, djTracks.map(toPlayerTrack), 0)
  }

  // Auto-DJ: order the whole list harmonically (Camelot key + close BPM) and load it.
  function autoDjToDeck(deck: DeckId) {
    if (djTracks.length === 0) return
    autoDjQueue(deck, djTracks.map(toPlayerTrack))
  }

  const LoadBtn = ({ deck, t }: { deck: DeckId; t: DJTrack }) => (
    <button
      onClick={() => sendToDeck(deck, t)}
      className="px-2 py-0.5 rounded transition-all active:scale-95"
      style={{
        background: rgba(DECK_COLOR[deck], 0.16),
        color:  DECK_COLOR[deck],
        border: `1px solid ${rgba(DECK_COLOR[deck], 0.45)}`,
        fontSize: 9,
      }}
    >
      → {deck}
    </button>
  )

  return (
    <div style={{ position: 'relative', height: 34, flexShrink: 0, zIndex: 20 }}>
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      height: isOpen ? 248 : 34,
      background: '#16181d',
      borderTop: `1px solid ${UI.border}`,
      boxShadow: isOpen ? '0 -14px 34px rgba(0,0,0,0.5)' : 'none',
      transition: 'height 0.2s ease',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 flex-shrink-0" style={{ height: 34 }}>
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 hover:opacity-80 flex-shrink-0"
          style={{ color: UI.soft, fontSize: 10, fontWeight: 700, letterSpacing: 2 }}
        >
          <span>{isOpen ? '▼' : '▲'}</span>
          <span>BIBLIOTHÈQUE</span>
        </button>

        {isOpen && (
          <>
            {hasBack ? (
              <button
                onClick={goBack}
                className="flex items-center gap-1 hover:opacity-80 flex-shrink-0"
                style={{ color: ACCENT, fontSize: 10 }}
              >
                ← {backLabel}
              </button>
            ) : (
              <div className="flex gap-1 flex-shrink-0">
                {DJ_TABS.map(([id, lbl]) => (
                  <button
                    key={id}
                    onClick={() => switchTab(id)}
                    className="px-2.5 py-0.5 rounded transition-colors"
                    style={{
                      fontSize: 10,
                      background: tab === id ? UI.card2 : 'transparent',
                      border: `1px solid ${tab === id ? UI.border2 : 'transparent'}`,
                      color: tab === id ? UI.text : UI.muted,
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}

            {showSearch && (
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: UI.muted }} />
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={tab === 'artists' ? 'Rechercher un artiste…' : 'Rechercher un album…'}
                  className="w-full rounded outline-none pl-6 pr-2 py-0.5"
                  style={{ background: UI.card, color: UI.text, border: `1px solid ${UI.border}`, fontSize: 10 }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Content */}
      {isOpen && (
        <div className="dj-lib-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: UI.muted }} />
            </div>
          )}

          {!isLoading && showArtistList && (
            <div className="grid gap-0.5 p-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))' }}>
              {artists.length === 0
                ? <p className="col-span-full px-4 py-6 text-center" style={{ color: UI.dim, fontSize: 10 }}>Aucun artiste</p>
                : artists.map(a => (
                  <button key={a.id} onClick={() => { setArtistId(a.id); setArtistName(a.name) }}
                    className="dj-row-hover flex items-center gap-2 px-3 py-1.5 rounded text-left">
                    <Mic2 className="w-4 h-4 flex-shrink-0" style={{ color: UI.muted }} />
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: UI.soft, fontSize: 10, fontWeight: 600 }}>{a.name}</p>
                      {a.album_count > 0 && <p style={{ color: UI.dim, fontSize: 9 }}>{a.album_count} album{a.album_count > 1 ? 's' : ''}</p>}
                    </div>
                  </button>
                ))
              }
            </div>
          )}

          {!isLoading && showArtistAlbum && (
            <div className="grid gap-0.5 p-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))' }}>
              {!artistDet
                ? <div className="col-span-full flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" style={{ color: UI.muted }} /></div>
                : artistDet.albums.length === 0
                ? <p className="col-span-full px-4 py-6 text-center" style={{ color: UI.dim, fontSize: 10 }}>Aucun album</p>
                : artistDet.albums.map(a => (
                  <button key={a.id} onClick={() => { setAlbumId(a.id); setAlbumName(a.title) }}
                    className="dj-row-hover flex items-center gap-2 px-3 py-1.5 rounded text-left">
                    <Disc3 className="w-4 h-4 flex-shrink-0" style={{ color: UI.muted }} />
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: UI.soft, fontSize: 10, fontWeight: 600 }}>{a.title}</p>
                      <p style={{ color: UI.dim, fontSize: 9 }}>{a.track_count} titres{a.release_year ? ` · ${a.release_year}` : ''}</p>
                    </div>
                  </button>
                ))
              }
            </div>
          )}

          {!isLoading && showAlbumList && (
            <div className="grid gap-0.5 p-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))' }}>
              {albums.length === 0
                ? <p className="col-span-full px-4 py-6 text-center" style={{ color: UI.dim, fontSize: 10 }}>Aucun album</p>
                : albums.map(a => (
                  <button key={a.id} onClick={() => { setAlbumId(a.id); setAlbumName(a.title) }}
                    className="dj-row-hover flex items-center gap-2 px-3 py-1.5 rounded text-left">
                    <Disc3 className="w-4 h-4 flex-shrink-0" style={{ color: UI.muted }} />
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: UI.soft, fontSize: 10, fontWeight: 600 }}>{a.title}</p>
                      <p style={{ color: UI.dim, fontSize: 9 }}>{a.track_count} titres</p>
                    </div>
                  </button>
                ))
              }
            </div>
          )}

          {!isLoading && showPlaylist && (
            <div className="divide-y" style={{ borderColor: UI.border }}>
              {playlists.length === 0
                ? <p className="px-4 py-6 text-center" style={{ color: UI.dim, fontSize: 10 }}>Aucune playlist</p>
                : playlists.map(p => (
                  <button key={p.id} onClick={() => { setPlaylistId(p.id); setPlaylistName(p.name) }}
                    className="dj-row-hover w-full flex items-center gap-3 px-4 py-2 text-left">
                    <ListMusic className="w-4 h-4 flex-shrink-0" style={{ color: UI.muted }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate" style={{ color: UI.soft, fontSize: 10, fontWeight: 600 }}>{p.name}</p>
                      <p style={{ color: UI.dim, fontSize: 9 }}>{p.track_count} titres · {formatDuration(p.duration_secs)}</p>
                    </div>
                  </button>
                ))
              }
            </div>
          )}

          {!isLoading && showTrackList && (
            <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 10 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#16181d', zIndex: 1 }}>
                <tr style={{ borderBottom: `1px solid ${UI.border}`, color: UI.muted }}>
                  <th className="px-4 py-1 text-left font-medium">
                    Titre
                    {djTracks.length > 0 && (
                      <span className="ml-2 inline-flex gap-1 flex-wrap items-center">
                        {isQueueContext && activeDecks.map(d => (
                          <button key={`all${d}`} onClick={() => sendAllToDeck(d)} className="px-1.5 py-0 rounded" style={{ background: rgba(DECK_COLOR[d], 0.18), color: DECK_COLOR[d], border: `1px solid ${rgba(DECK_COLOR[d],0.45)}`, fontSize: 9 }}>Tout → {d}</button>
                        ))}
                        {activeDecks.map(d => (
                          <button key={`auto${d}`} onClick={() => autoDjToDeck(d)} className="px-1.5 py-0 rounded" style={{ background: rgba(DECK_COLOR[d], 0.12), color: DECK_COLOR[d], border: `1px solid ${rgba(DECK_COLOR[d],0.45)}`, fontSize: 9 }} title={`File harmonique automatique (tonalité + BPM) → Deck ${d}`}>Auto-DJ → {d}</button>
                        ))}
                      </span>
                    )}
                  </th>
                  <th className="px-4 py-1 text-left font-medium hidden sm:table-cell">Durée</th>
                  {activeDecks.map(d => (
                    <th key={d} className="px-3 py-1 font-medium" style={{ width: 48, color: DECK_COLOR[d] }}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {djTracks.length === 0
                  ? <tr><td colSpan={2 + activeDecks.length} className="px-4 py-8 text-center" style={{ color: UI.dim }}>Aucun titre</td></tr>
                  : djTracks.map(t => (
                    <tr key={t.id} className="dj-row-hover" style={{ borderBottom: `1px solid ${rgba('#ffffff', 0.04)}` }}
                        onContextMenu={e => { e.preventDefault(); setRowCtx({ pos: { top: e.clientY, left: e.clientX, minWidth: 200 }, track: t }) }}>
                      <td className="px-4 py-1.5">
                        <p className="truncate" style={{ color: UI.soft, maxWidth: 260 }}>{t.title}</p>
                        {t.artist_name && <p className="truncate" style={{ color: UI.dim, fontSize: 9, maxWidth: 260 }}>{t.artist_name}</p>}
                      </td>
                      <td className="px-4 py-1.5 hidden sm:table-cell" style={{ color: UI.dim }}>
                        {formatDuration(t.duration_secs)}
                      </td>
                      {activeDecks.map(d => (
                        <td key={d} className="px-2 py-1.5"><LoadBtn deck={d} t={t} /></td>
                      ))}
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>

    {rowCtx && (
      <MenuDropdown
        theme="dark"
        pos={rowCtx.pos}
        onClose={() => setRowCtx(null)}
        items={[
          { type: 'label', text: rowCtx.track.title },
          ...activeDecks.map(d => ({
            type: 'action' as const, label: `Charger sur Deck ${d}`, onClick: () => sendToDeck(d, rowCtx.track),
          })),
          ...(isQueueContext && djTracks.length > 1 ? [
            { type: 'separator' as const },
            ...activeDecks.map(d => ({
              type: 'action' as const, label: `Toute la sélection → Deck ${d} (${djTracks.length})`, onClick: () => sendAllToDeck(d),
            })),
          ] : []),
          { type: 'separator' as const },
          ...activeDecks.map(d => ({
            type: 'action' as const, label: `Auto-DJ harmonique → Deck ${d}`, onClick: () => autoDjToDeck(d),
          })),
        ]}
      />
    )}
    </div>
  )
}

// ── BEAT FX bar (master effects rack) ──────────────────────────────────────────

// Compact dark dropdown for the DJ chrome, built on the core MenuDropdown.
function DJSelect({ value, options, onChange, placeholder = '', width = 110, title }: {
  value: string; options: { id: string; label: string }[]; onChange: (id: string) => void
  placeholder?: string; width?: number; title?: string
}) {
  const [menu, setMenu] = useState<MenuDropdownPos | null>(null)
  const current = options.find(o => o.id === value)?.label
  return (
    <>
      <button
        title={title}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ top: r.bottom + 4, left: r.left, minWidth: Math.max(width, r.width) }) }}
        className="rounded flex items-center justify-between gap-1 active:scale-95"
        style={{ background: UI.card, color: current ? UI.soft : UI.muted, border: `1px solid ${UI.border}`, fontSize: 8, padding: '3px 6px', minWidth: width, maxWidth: width + 60 }}>
        <span className="truncate">{current ?? placeholder}</span>
        <span style={{ fontSize: 7, opacity: 0.6 }}>▾</span>
      </button>
      {menu && (
        <MenuDropdown theme="dark" pos={menu} onClose={() => setMenu(null)}
          items={options.map(o => ({ type: 'action', label: o.label, checked: o.id === value, onClick: () => onChange(o.id) }))} />
      )}
    </>
  )
}

function HeadphoneControls() {
  const { headphoneId, cueMix, setHeadphoneDevice, setCueMix } = useDJStore()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    let on = true
    navigator.mediaDevices?.enumerateDevices?.()
      .then(ds => { if (on) setDevices(ds.filter(d => d.kind === 'audiooutput')) })
      .catch(() => {})
    return () => { on = false }
  }, [])
  // AudioContext.setSinkId (Chrome 110+) moves the whole console output device.
  const supported = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype
  return (
    <div className="flex items-center gap-1.5" title="Périphérique de sortie audio du mixage">
      <span style={{ fontSize: 11 }}>🔊</span>
      {supported ? (
        <DJSelect
          value={headphoneId}
          onChange={setHeadphoneDevice}
          placeholder="Sortie audio…"
          title="Périphérique de sortie audio"
          options={devices.map(d => ({ id: d.deviceId, label: d.label || `Sortie ${d.deviceId.slice(0, 6)}` }))}
        />
      ) : <span style={{ color: UI.dim, fontSize: 8 }}>sortie n/d</span>}
      <HorizFader min={0} max={1} step={0.01} value={cueMix} onChange={setCueMix} color="#34d399" width={56} height={18} label="CUE / MIX" />
    </div>
  )
}

function BeatFxBar() {
  const { beatFx, setBeatFx, quantize, faderStart, crossfaderReverse, masterLimiter, masterMono, autoMix, micOn, talkover,
          cueMix, sampleRecording, transitionStyle,
          setQuantize, setFaderStart, toggleCrossfaderReverse, toggleLimiter, toggleMono, setAutoMix,
          toggleMic, setTalkover, playSample, recordSample, setCueMix, setTransitionStyle, transitionNow } = useDJStore()
  const on = beatFx.on
  const [samplerOpen, setSamplerOpen] = useState(false)
  const divLabel = (d: number) => (d === 0.25 ? '¼' : d === 0.5 ? '½' : `${d}`)
  const chColor = beatFx.channel === 'A' ? COL_A : beatFx.channel === 'B' ? COL_B : ACCENT

  const chip = (active: boolean, accent = ACCENT): React.CSSProperties => ({
    fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: '3px 8px', borderRadius: 5,
    background: active ? rgba(accent, 0.22) : UI.card,
    border: `1px solid ${active ? accent : UI.border}`,
    color: active ? accent : UI.muted,
  })

  return (
    <div className="flex items-center gap-3 px-4 flex-shrink-0" style={{
      height: 46, borderTop: `1px solid ${UI.border}`,
      background: `linear-gradient(180deg, ${rgba(ACCENT, on ? 0.12 : 0.05)}, rgba(0,0,0,0.2))`,
    }}>
      <span style={{ color: ACCENT, fontSize: 10, fontWeight: 800, letterSpacing: 2, textShadow: `0 0 10px ${rgba(ACCENT, 0.6)}` }}>BEAT FX</span>

      {/* ON / OFF */}
      <button
        onClick={() => setBeatFx({ on: !on })}
        className="rounded-md transition-all active:scale-95"
        style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: '5px 14px',
          background: on ? ACCENT : UI.card,
          border: `1px solid ${on ? ACCENT : UI.border2}`,
          color: on ? '#0b0c0f' : UI.soft,
          boxShadow: on ? `0 0 16px ${rgba(ACCENT, 0.5)}` : 'none',
        }}
      >
        {on ? 'ON' : 'OFF'}
      </button>

      {/* Effect type */}
      <div className="flex gap-1">
        {BEAT_FX_TYPES.map(t => (
          <button key={t.id} onClick={() => setBeatFx({ type: t.id })} style={chip(beatFx.type === t.id)}>{t.label}</button>
        ))}
      </div>

      <span style={{ width: 1, height: 18, background: UI.border }} />

      {/* Beat division */}
      <span style={{ color: UI.muted, fontSize: 8, letterSpacing: 1 }}>BEAT</span>
      <div className="flex gap-1">
        {BEAT_DIVISIONS.map(d => (
          <button key={d} onClick={() => setBeatFx({ beat: d })} style={chip(beatFx.beat === d)}>{divLabel(d)}</button>
        ))}
      </div>

      <span style={{ width: 1, height: 18, background: UI.border }} />

      {/* Depth */}
      <span style={{ color: UI.muted, fontSize: 8, letterSpacing: 1 }}>DEPTH</span>
      <HorizFader
        min={0} max={1} step={0.01} value={beatFx.depth}
        onChange={(v: number) => setBeatFx({ depth: v })}
        color={ACCENT} width={120} height={20}
        label="Beat FX depth"
      />
      <span style={{ color: ACCENT, fontSize: 10, fontFamily: 'monospace', width: 30 }}>{Math.round(beatFx.depth * 100)}%</span>

      <div className="flex-1" />

      {/* Global pro toggles */}
      <div className="flex gap-1">
        <button onClick={() => setQuantize(!quantize)} style={chip(quantize)} title="Quantification (cale boucles/sauts sur le tempo)">QUANT</button>
        <button onClick={() => setFaderStart(!faderStart)} style={chip(faderStart)} title="Fader Start (le fader de voie lance/arrête le deck)">F.START</button>
        <button onClick={toggleCrossfaderReverse} style={chip(crossfaderReverse)} title="Crossfader inversé (hamster)">REV</button>
        <button onClick={toggleLimiter} style={chip(masterLimiter)} title="Limiteur master">LIM</button>
        <button onClick={toggleMono} style={chip(masterMono)} title="Sortie mono">MONO</button>
        <button onClick={() => setAutoMix(!autoMix)} style={chip(autoMix)} title="Auto-mix (transition automatique en fin de piste)">AUTO</button>
      </div>
      <span style={{ width: 1, height: 18, background: UI.border }} />

      {/* Transition style + manual transition trigger */}
      <span style={{ color: UI.muted, fontSize: 8, letterSpacing: 1 }}>TRANS</span>
      <DJSelect
        value={transitionStyle}
        onChange={v => setTransitionStyle(v as typeof transitionStyle)}
        width={70}
        title="Style de transition"
        options={TRANSITION_STYLES.map(t => ({ id: t.id, label: t.label }))}
      />
      <button onClick={transitionNow} style={chip(false)} title="Lancer la transition vers l'autre deck maintenant">▶ MIX</button>
      <span style={{ width: 1, height: 18, background: UI.border }} />

      {/* Mic / talkover / sampler */}
      <div className="flex gap-1 relative">
        <button onClick={toggleMic} style={chip(micOn, '#ff7a3d')} title="Activer/couper le micro">MIC</button>
        <button onClick={() => setTalkover(!talkover)} style={chip(talkover, '#ff7a3d')} title="Talkover (baisse la musique quand le micro est actif)">TALK</button>
        <button onClick={() => setSamplerOpen(o => !o)} style={chip(samplerOpen, '#34d399')} title="Sampler">SMP</button>
        {samplerOpen && (
          <div className="absolute" style={{ bottom: 'calc(100% + 8px)', right: 0, background: '#16181d', border: `1px solid ${UI.border2}`, borderRadius: 8, padding: 8, boxShadow: '0 -10px 30px rgba(0,0,0,0.5)', zIndex: 30 }}>
            <div className="grid grid-cols-4 gap-1" style={{ width: 300 }}>
              {SAMPLE_NAMES.map((n, i) => {
                const recording = sampleRecording === i
                return (
                  <button key={n}
                    onMouseDown={e => { if (e.button === 0) playSample(i) }}
                    onContextMenu={e => { e.preventDefault(); recordSample(i) }}
                    className="h-9 rounded font-bold active:scale-95"
                    style={{
                      fontSize: 8,
                      background: recording ? rgba('#ff2244', 0.25) : rgba('#34d399', 0.14),
                      border: `1px solid ${recording ? '#ff2244' : rgba('#34d399', 0.5)}`,
                      color: recording ? '#ff5c5c' : '#9af3d3',
                      animation: recording ? 'djRecPulse 1s ease-in-out infinite' : 'none',
                    }}>
                    {recording ? '● REC' : n}
                  </button>
                )
              })}
            </div>
            <p style={{ color: UI.dim, fontSize: 8, marginTop: 6, textAlign: 'center' }}>clic = jouer · clic droit = enregistrer 4 s du mix</p>
          </div>
        )}
      </div>
      <span style={{ width: 1, height: 18, background: UI.border }} />

      {/* Headphone (PFL) output + cue mix */}
      <HeadphoneControls />
      <span style={{ width: 1, height: 18, background: UI.border }} />

      {/* Channel select */}
      <span style={{ color: UI.muted, fontSize: 8, letterSpacing: 1 }}>CH</span>
      <div className="flex gap-1">
        {([['A', COL_A], ['B', COL_B], ['master', ACCENT]] as const).map(([ch, c]) => (
          <button key={ch} onClick={() => setBeatFx({ channel: ch })} style={chip(beatFx.channel === ch, c)}>
            {ch === 'master' ? 'MST' : ch}
          </button>
        ))}
      </div>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: chColor, boxShadow: on ? `0 0 8px ${chColor}` : 'none' }} />
    </div>
  )
}

// ── MIDI mapping panel (overlay) ───────────────────────────────────────────────

function MidiPanel({ onClose }: { onClose: () => void }) {
  const { midiEnabled, midiSupported, midiLearn, midiMap, toggleMidi, startMidiLearn, clearMidiTarget } = useDJStore()
  const keyOf = (target: string) => Object.keys(midiMap).find(k => midiMap[k] === target)

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ background: rgba('#05060c', 0.62) }} onMouseDown={onClose}>
      <div onMouseDown={e => e.stopPropagation()} className="rounded-2xl p-4 flex flex-col gap-3"
        style={{ width: 420, maxHeight: '92%', background: 'linear-gradient(180deg, #24262c 0%, #17181c 100%)', border: `1px solid ${rgba(ACCENT, 0.3)}`, boxShadow: '0 24px 70px rgba(0,0,0,0.6)' }}>
        <div className="flex items-center gap-2">
          <span style={{ color: UI.text, fontSize: 16, fontWeight: 800 }}>Contrôleur MIDI</span>
          <div className="flex-1" />
          <button onClick={toggleMidi} disabled={!midiSupported}
            style={{ fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 6, background: midiEnabled ? '#34d399' : UI.card, border: `1px solid ${midiEnabled ? '#34d399' : UI.border2}`, color: midiEnabled ? '#0b0c0f' : UI.soft }}>
            {midiEnabled ? 'ACTIVÉ' : 'ACTIVER'}
          </button>
          <button onClick={onClose} style={{ color: UI.muted }}><X className="w-4 h-4" /></button>
        </div>
        {!midiSupported && <p style={{ color: '#ffaa44', fontSize: 11 }}>Web MIDI non supporté par ce navigateur.</p>}
        <p style={{ color: UI.muted, fontSize: 10 }}>« Apprendre » puis bougez un contrôle de votre matériel pour l'associer.</p>

        <div className="dj-lib-scroll grid grid-cols-1 gap-1" style={{ overflowY: 'auto' }}>
          {MIDI_TARGETS.map(t => {
            const bound = keyOf(t.id)
            const learning = midiLearn === t.id
            return (
              <div key={t.id} className="flex items-center gap-2 rounded px-2 py-1" style={{ background: rgba('#000000', 0.22) }}>
                <span style={{ color: UI.soft, fontSize: 11, flex: 1 }}>{t.label}</span>
                <span style={{ color: bound ? ACCENT : UI.dim, fontSize: 9, fontFamily: 'monospace', minWidth: 70, textAlign: 'right' }}>{bound ?? 'non lié'}</span>
                <button onClick={() => startMidiLearn(t.id)} disabled={!midiEnabled}
                  style={{ fontSize: 8, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: learning ? rgba(ACCENT, 0.3) : UI.card, border: `1px solid ${learning ? ACCENT : UI.border}`, color: midiEnabled ? (learning ? ACCENT : UI.soft) : UI.dim }}>
                  {learning ? '…' : 'Apprendre'}
                </button>
                {bound && <button onClick={() => clearMidiTarget(t.id)} style={{ color: UI.muted, fontSize: 11, padding: '0 3px' }}>✕</button>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── DJ Page ───────────────────────────────────────────────────────────────────

export default function DJPage() {
  const navigate    = useNavigate()
  const masterVol   = useDJStore(s => s.masterVolume)
  const setMasterVol = useDJStore(s => s.setMasterVol)
  const panic        = useDJStore(s => s.panic)
  const exportSetlist = useDJStore(s => s.exportSetlist)
  const historyLen   = useDJStore(s => s.history.length)
  const configNames  = useDJStore(s => s.configNames)
  const saveConfig   = useDJStore(s => s.saveConfig)
  const loadConfig   = useDJStore(s => s.loadConfig)
  const deleteConfig = useDJStore(s => s.deleteConfig)
  const [cfgMenu, setCfgMenu] = useState<MenuDropdownPos | null>(null)
  const cfgNameRef = useRef('')
  const midiEnabled = useDJStore(s => s.midiEnabled)
  const deckCount    = useDJStore(s => s.deckCount)
  const setDeckCount = useDJStore(s => s.setDeckCount)
  const [midiOpen, setMidiOpen] = useState(false)
  const [browser, setBrowser] = useState(false)
  const [eqOpen, setEqOpen]   = useState(false)

  // Mobile: the pro side-by-side desktop layout (2 deck columns around a central
  // mixer) is unusable on a phone → reflow to a single vertically-scrollable
  // stack (deck A · mixer · deck B …). All mobile changes are gated on this so
  // the desktop render is byte-identical.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const on = () => setIsMobile(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // Own title bar → hide the global AppHeader so the console fills the shell.
  useChromelessHeader()

  // Pro keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const s = useDJStore.getState()
      switch (e.code) {
        case 'Space':    e.preventDefault(); s.togglePlay(e.shiftKey ? 'B' : 'A'); break
        case 'KeyC':     s.pressCue('A'); break
        case 'KeyM':     s.pressCue('B'); break
        case 'KeyS':     s.syncDeck('A'); break
        case 'KeyL':     s.syncDeck('B'); break
        case 'KeyV':     s.toggleVinyl(e.shiftKey ? 'B' : 'A'); break
        case 'BracketLeft':  s.setCrossfader(Math.max(-1, s.crossfader - 0.1)); break
        case 'BracketRight': s.setCrossfader(Math.min(1, s.crossfader + 0.1)); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden select-none" style={{
      color: UI.soft,
      background: 'radial-gradient(150% 100% at 50% -10%, rgba(255,176,46,0.06) 0%, rgba(0,0,0,0) 55%),'
                + ' linear-gradient(180deg, #1b1d21 0%, #0e0f12 100%)',
    }}>
      <style>{DJ_CSS}</style>

      {/* Header ────────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-4 flex-shrink-0 overflow-x-auto lg:overflow-visible"
        style={{
          height: 44,
          background: 'linear-gradient(180deg, #26282d 0%, #17181c 100%)',
          borderBottom: `1px solid ${rgba(ACCENT, 0.28)}`,
          boxShadow: `0 1px 16px rgba(0,0,0,0.5)`,
        }}
      >
        <button
          onClick={() => navigate('/media/listen')}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          style={{ color: UI.soft, fontSize: 11 }}
        >
          <ChevronLeft className="w-4 h-4" />
          Bibliothèque
        </button>

        <div className="flex items-center gap-2.5 mx-auto whitespace-nowrap flex-shrink-0">
          <div className="w-2 h-2 rounded-full" style={{ background: ACCENT, boxShadow: `0 0 12px ${ACCENT}`, animation: 'djGlow 2s ease-in-out infinite' }} />
          <span style={{
            fontSize: 13, fontWeight: 800, letterSpacing: 5,
            background: `linear-gradient(90deg, ${COL_A}, ${ACCENT}, ${COL_B})`,
            WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>KUBUNO DJ</span>
          <div className="w-2 h-2 rounded-full" style={{ background: ACCENT, boxShadow: `0 0 12px ${ACCENT}`, animation: 'djGlow 2s ease-in-out infinite' }} />
        </div>

        <div className="flex items-center gap-3">
          {/* Master level meter + clip */}
          <MasterMeter />

          {/* Deck count 2 / 4 / 6 — desktop only (mobile forces the stack to 2). */}
          <div className="hidden lg:flex rounded overflow-hidden" style={{ border: `1px solid ${UI.border}` }} title="Nombre de platines">
            {DECK_COUNTS.map(n => {
              const active = deckCount === n
              return (
                <button key={n} onClick={() => setDeckCount(n)}
                  className="active:scale-95"
                  style={{ padding: '4px 8px', fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                           background: active ? rgba(ACCENT, 0.25) : UI.card, color: active ? '#ffd9a0' : UI.muted,
                           borderLeft: n !== DECK_COUNTS[0] ? `1px solid ${UI.border}` : 'none' }}
                  title={`${n} platines`}>{n}</button>
              )
            })}
            <span style={{ alignSelf: 'center', padding: '0 6px 0 4px', fontSize: 8, letterSpacing: 1, color: UI.muted }}>PLAT.</span>
          </div>

          {/* MIDI */}
          <button
            onClick={() => setMidiOpen(true)}
            className="hidden lg:block rounded font-bold active:scale-95"
            style={{ fontSize: 9, letterSpacing: 1, padding: '4px 9px', background: midiEnabled ? rgba('#34d399', 0.18) : UI.card, border: `1px solid ${midiEnabled ? '#34d399' : UI.border}`, color: midiEnabled ? '#9af3d3' : UI.soft }}
            title="Contrôleur MIDI (mappage)"
          >
            MIDI
          </button>

          {/* Config save/load */}
          <button
            onClick={e => setCfgMenu({ top: e.clientY + 14, left: e.clientX - 120, minWidth: 200 })}
            className="hidden lg:flex rounded font-bold active:scale-95 items-center gap-1"
            style={{ fontSize: 9, letterSpacing: 1, padding: '4px 9px', background: UI.card, border: `1px solid ${UI.border}`, color: UI.soft }}
            title="Sauvegarder / charger une configuration complète"
          >
            <Sliders className="w-3 h-3" /> CONFIG
          </button>

          {/* Setlist export */}
          <button
            onClick={exportSetlist}
            disabled={historyLen === 0}
            className="hidden lg:flex rounded font-bold active:scale-95 items-center gap-1"
            style={{ fontSize: 9, letterSpacing: 1, padding: '4px 9px', background: UI.card, border: `1px solid ${UI.border}`, color: historyLen ? UI.soft : UI.dim }}
            title="Exporter la setlist (titres joués) en .txt"
          >
            <ListMusic className="w-3 h-3" /> SETLIST{historyLen ? ` (${historyLen})` : ''}
          </button>

          {/* PANIC — kill switch */}
          <button
            onClick={panic}
            className="rounded font-bold active:scale-95"
            style={{ fontSize: 9, letterSpacing: 1, padding: '4px 10px', background: rgba('#ff2244', 0.16), border: '1px solid rgba(255,34,68,0.6)', color: '#ff7676' }}
            title="Tout arrêter (decks, FX, micro)"
          >
            PANIC
          </button>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="hidden sm:inline" style={{ color: UI.muted, fontSize: 9, letterSpacing: 2 }}>MASTER</span>
            <RangeSlider
              min={0} max={1} step={0.01}
              value={masterVol}
              onChange={setMasterVol}
              accent={ACCENT} trackColor="rgba(255,255,255,0.15)"
              className="w-16 lg:w-24"
              aria-label="Master volume"
            />
            <span style={{ color: ACCENT, fontSize: 10, fontFamily: 'monospace', minWidth: 28, textAlign: 'right' }}>
              {Math.round(masterVol * 100)}
            </span>
          </div>

          {/* Global shell actions (language, notifications, settings, help, waffle,
              avatar) — re-hosted here since the global AppHeader is hidden. */}
          <HeaderActions compact dark />
        </div>
      </div>

      {/* Main area: decks on each side of the central mixer (2 / 4 / 6) ──────── */}
      {(() => {
        const compact = deckCount > 2
        // Left = A,C,E · Right = B,D,F (Serato/Rekordbox-style multi-deck layout).
        const left:  DeckId[] = (['A', 'C', 'E'] as DeckId[]).slice(0, deckCount / 2)
        const right: DeckId[] = (['B', 'D', 'F'] as DeckId[]).slice(0, deckCount / 2)

        // ── Mobile: scrollable vertical stack (deck A · mixer · deck B …).
        // The same subcomponents are reused, at full width and with an explicit
        // height (they are `h-full` + inner flex, so they adapt).
        if (isMobile) {
          const deckH = compact ? 250 : 380
          // Mixer inserted after the left half so it stays central.
          return (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col" style={{ gap: 1, background: UI.border }}>
              {left.map(d => (
                <div key={d} className="flex-shrink-0 overflow-hidden" style={{ height: deckH }}>
                  {compact ? <DJDeckCompact deck={d} color={DECK_COLOR[d]} /> : <DJDeck deck={d} color={DECK_COLOR[d]} />}
                </div>
              ))}
              <div className="flex-shrink-0 overflow-hidden" style={{ height: 640 }}>
                <DJMixer onOpenEq={() => setEqOpen(true)} />
              </div>
              {right.map(d => (
                <div key={d} className="flex-shrink-0 overflow-hidden" style={{ height: deckH }}>
                  {compact ? <DJDeckCompact deck={d} color={DECK_COLOR[d]} /> : <DJDeck deck={d} color={DECK_COLOR[d]} />}
                </div>
              ))}
              {/* tail spacer so the last deck isn't flush against the FX bar */}
              <div className="flex-shrink-0" style={{ height: 1 }} />
            </div>
          )
        }

        // ── Desktop: unchanged pro layout (columns around the mixer).
        const Column = ({ decks }: { decks: DeckId[] }) => (
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ gap: 1, background: UI.border }}>
            {decks.map(d => (
              <div key={d} className="flex-1 min-h-0 overflow-hidden">
                {compact
                  ? <DJDeckCompact deck={d} color={DECK_COLOR[d]} />
                  : <DJDeck deck={d} color={DECK_COLOR[d]} />}
              </div>
            ))}
          </div>
        )
        return (
          <div className="flex flex-1 min-h-0" style={{ gap: 1, background: UI.border }}>
            <Column decks={left} />
            <div className="flex-shrink-0 overflow-hidden">
              <DJMixer onOpenEq={() => setEqOpen(true)} />
            </div>
            <Column decks={right} />
          </div>
        )
      })()}

      {/* Master BEAT FX rack */}
      <BeatFxBar />

      {/* Browser panel */}
      <DJBrowser isOpen={browser} onToggle={() => setBrowser(o => !o)} />

      {/* Graphic equaliser overlay */}
      {eqOpen && <GraphicEqPanel onClose={() => setEqOpen(false)} />}

      {/* MIDI mapping overlay */}
      {midiOpen && <MidiPanel onClose={() => setMidiOpen(false)} />}

      {/* Config save/load menu */}
      {cfgMenu && (
        <MenuDropdown theme="dark" pos={cfgMenu} onClose={() => setCfgMenu(null)} items={[
          { type: 'label', text: 'Sauvegarder la config actuelle' },
          { type: 'custom', render: (close) => (
            <input autoFocus placeholder="Nom de la config…" defaultValue=""
              onChange={e => { cfgNameRef.current = e.target.value }}
              onKeyDown={e => { if (e.key === 'Enter' && cfgNameRef.current.trim()) { saveConfig(cfgNameRef.current.trim()); cfgNameRef.current = ''; close() } }}
              className="w-full rounded outline-none"
              style={{ background: '#16181d', color: '#e6e6f0', border: '1px solid #454545', fontSize: 12, padding: '3px 6px', margin: '2px 0' }} />
          ) },
          { type: 'separator' },
          { type: 'label', text: configNames.length ? 'Charger une config' : 'Aucune config enregistrée' },
          ...configNames.map(name => ({
            type: 'submenu' as const, label: name, items: [
              { type: 'action' as const, label: 'Charger', onClick: () => loadConfig(name) },
              { type: 'action' as const, label: 'Supprimer', danger: true, onClick: () => deleteConfig(name) },
            ],
          })),
        ]} />
      )}
    </div>
  )
}
