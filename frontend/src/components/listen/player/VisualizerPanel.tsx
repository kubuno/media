import { useEffect, useRef, useState } from 'react'
import { audioEngine } from '../../../store/audioEngine'

type Theme = 'bars' | 'waveform' | 'circular' | 'mirror'

const THEMES: { id: Theme; label: string }[] = [
  { id: 'bars',     label: 'Barres'     },
  { id: 'waveform', label: 'Onde'       },
  { id: 'circular', label: 'Circulaire' },
  { id: 'mirror',   label: 'Miroir'     },
]

// Unified blue → violet → fuchsia palette, matching the player's progress bar.
const C = { blue: '#3b82f6', violet: '#8b5cf6', fuchsia: '#ec4899' }

/** Vertical gradient (top → bottom) reused across themes. */
function vgrad(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0,   C.fuchsia)
  g.addColorStop(0.5, C.violet)
  g.addColorStop(1,   C.blue)
  return g
}

function drawBars(ctx: CanvasRenderingContext2D, data: Uint8Array, w: number, h: number) {
  const barCount = 48
  const step = Math.floor(data.length / barCount)
  const slot = w / barCount
  const bw   = Math.max(2, slot * 0.6)
  ctx.shadowColor = C.violet
  ctx.shadowBlur  = 10
  for (let i = 0; i < barCount; i++) {
    const val  = data[i * step] / 255
    const barH = Math.max(bw, val * h * 0.92)
    const x    = i * slot + (slot - bw) / 2
    const y    = h - barH
    ctx.fillStyle = vgrad(ctx, 0, y, 0, h)
    ctx.beginPath()
    ctx.roundRect(x, y, bw, barH, bw / 2)
    ctx.fill()
    // Soft reflection under the baseline.
    ctx.globalAlpha = 0.12
    ctx.beginPath()
    ctx.roundRect(x, h, bw, Math.min(barH * 0.4, h * 0.18), bw / 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.shadowBlur = 0
}

function drawWaveform(ctx: CanvasRenderingContext2D, data: Uint8Array, w: number, h: number) {
  ctx.lineWidth   = 2.5
  ctx.lineJoin    = 'round'
  ctx.strokeStyle = vgrad(ctx, 0, 0, w, 0)
  ctx.shadowColor = C.violet
  ctx.shadowBlur  = 12
  ctx.beginPath()
  const sliceW = w / data.length
  let x = 0
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128 - 1
    const y = v * h * 0.4 + h / 2
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    x += sliceW
  }
  ctx.stroke()
  // Faint filled area under the curve.
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath()
  ctx.shadowBlur = 0
  ctx.globalAlpha = 0.10
  ctx.fillStyle = vgrad(ctx, 0, 0, 0, h)
  ctx.fill()
  ctx.globalAlpha = 1
}

function drawCircular(ctx: CanvasRenderingContext2D, data: Uint8Array, w: number, h: number) {
  const cx = w / 2, cy = h / 2
  const r  = Math.min(w, h) * 0.26
  const count = 96
  const step  = Math.floor(data.length / count)
  ctx.lineWidth   = Math.max(2, (Math.PI * 2 * r) / count * 0.5)
  ctx.lineCap     = 'round'
  ctx.shadowColor = C.fuchsia
  ctx.shadowBlur  = 8
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const val   = data[i * step] / 255
    const outer = r + val * r * 1.1
    const t = i / count
    ctx.strokeStyle = t < 0.5 ? C.violet : C.fuchsia
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1
  ctx.shadowBlur = 0
  ctx.stroke()
}

function drawMirror(ctx: CanvasRenderingContext2D, data: Uint8Array, w: number, h: number) {
  const barCount = 40
  const step = Math.floor(data.length / barCount)
  const slot = w / barCount
  const bw   = Math.max(2, slot * 0.55)
  const mid  = h / 2
  ctx.shadowColor = C.violet
  ctx.shadowBlur  = 8
  for (let i = 0; i < barCount; i++) {
    const val  = data[i * step] / 255
    const barH = Math.max(bw / 2, val * mid * 0.92)
    const x    = i * slot + (slot - bw) / 2
    const g = ctx.createLinearGradient(0, mid - barH, 0, mid + barH)
    g.addColorStop(0,   C.fuchsia)
    g.addColorStop(0.5, C.violet)
    g.addColorStop(1,   C.fuchsia)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.roundRect(x, mid - barH, bw, barH * 2, bw / 2)
    ctx.fill()
  }
  ctx.shadowBlur = 0
}

export function VisualizerPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef   = useRef<number>(0)
  const [theme, setTheme] = useState<Theme>('bars')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const analyser = audioEngine.getAnalyser()
    const data: Uint8Array<ArrayBuffer> = analyser
      ? (new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>)
      : (new Uint8Array(1024).fill(128) as Uint8Array<ArrayBuffer>)

    const draw = (t: DOMHighResTimeStamp) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      // Keep the backing store crisp on HiDPI screens.
      const bw = Math.round(w * dpr), bh = Math.round(h * dpr)
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Paint our own dark background so the canvas is never transparent/white,
      // independent of any CSS behind it.
      const bg = ctx.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#1e1b4b')
      bg.addColorStop(1, '#0b1020')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      if (analyser) {
        if (theme === 'waveform') analyser.getByteTimeDomainData(data)
        else analyser.getByteFrequencyData(data)
      } else {
        for (let i = 0; i < data.length; i++) data[i] = 128 + 24 * Math.sin(t / 600 + i / 12)
      }

      switch (theme) {
        case 'bars':     drawBars(ctx, data, w, h); break
        case 'waveform': drawWaveform(ctx, data, w, h); break
        case 'circular': drawCircular(ctx, data, w, h); break
        case 'mirror':   drawMirror(ctx, data, w, h); break
      }
      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, [theme])

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{ width: 280, background: 'radial-gradient(120% 80% at 50% 0%, #1e1b4b 0%, #0b1020 70%)' }}
    >
      {/* Mode selector — segmented pills */}
      <div className="grid grid-cols-2 gap-1 p-2">
        {THEMES.map(t => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
              theme === t.id
                ? 'bg-white/15 text-white shadow-sm ring-1 ring-white/15'
                : 'text-white/45 hover:text-white/80 hover:bg-white/5'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Canvas — fills the container (explicit w/h so it never falls back to the
          intrinsic 300×150) and paints its own background each frame. */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  )
}
