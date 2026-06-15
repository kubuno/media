import { useEffect, useRef, useState } from 'react'
import { audioEngine } from '../../../store/audioEngine'

type Theme = 'bars' | 'waveform' | 'circular' | 'mirror'

const THEMES: { id: Theme; label: string }[] = [
  { id: 'bars',     label: 'Barres'    },
  { id: 'waveform', label: 'Onde'      },
  { id: 'circular', label: 'Circulaire'},
  { id: 'mirror',   label: 'Miroir'    },
]

const THEME_COLORS: Record<Theme, { bg: string; fill: string; stroke: string }> = {
  bars:     { bg: '#0f0f1a', fill: '#1a73e8',  stroke: '#1a73e8' },
  waveform: { bg: '#0a1a0a', fill: '#1e8e3e',  stroke: '#34d058' },
  circular: { bg: '#1a0a1a', fill: '#9c27b0',  stroke: '#ce93d8' },
  mirror:   { bg: '#1a0f00', fill: '#f9ab00',  stroke: '#fcd34d' },
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  w: number,
  h: number,
  colors: typeof THEME_COLORS['bars'],
) {
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, w, h)

  const barCount = 64
  const step  = Math.floor(data.length / barCount)
  const barW  = w / barCount
  const gap   = Math.max(1, barW * 0.15)

  for (let i = 0; i < barCount; i++) {
    const val    = data[i * step] / 255
    const barH   = val * h * 0.9
    const x      = i * barW + gap / 2
    const bw     = barW - gap

    const grad = ctx.createLinearGradient(0, h - barH, 0, h)
    grad.addColorStop(0, colors.stroke)
    grad.addColorStop(1, colors.fill + '88')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.roundRect(x, h - barH, bw, barH, [3, 3, 0, 0])
    ctx.fill()
  }
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  w: number,
  h: number,
  colors: typeof THEME_COLORS['waveform'],
  _time: DOMHighResTimeStamp,
) {
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = colors.stroke
  ctx.lineWidth   = 2
  ctx.shadowColor = colors.stroke
  ctx.shadowBlur  = 8
  ctx.beginPath()

  const sliceW = w / data.length
  let x = 0
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128 - 1
    const y = (v * h * 0.4) + h / 2
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
    x += sliceW
  }
  ctx.stroke()
  ctx.shadowBlur = 0
}

function drawCircular(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  w: number,
  h: number,
  colors: typeof THEME_COLORS['circular'],
  _time: DOMHighResTimeStamp,
) {
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, w, h)

  const cx    = w / 2
  const cy    = h / 2
  const r     = Math.min(w, h) * 0.3
  const count = 128
  const step  = Math.floor(data.length / count)

  ctx.strokeStyle = colors.stroke
  ctx.lineWidth   = 2
  ctx.shadowColor = colors.stroke
  ctx.shadowBlur  = 6

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const val   = data[i * step] / 255
    const inner = r
    const outer = r + val * r * 0.7

    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
    ctx.stroke()
  }

  // Center circle
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2)
  ctx.strokeStyle = colors.fill + '66'
  ctx.lineWidth   = 1
  ctx.stroke()
  ctx.shadowBlur  = 0
}

function drawMirror(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  w: number,
  h: number,
  colors: typeof THEME_COLORS['mirror'],
) {
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, w, h)

  const barCount = 48
  const step     = Math.floor(data.length / barCount)
  const barW     = w / barCount
  const gap      = Math.max(1, barW * 0.1)
  const mid      = h / 2

  for (let i = 0; i < barCount; i++) {
    const val  = data[i * step] / 255
    const barH = val * mid * 0.9
    const x    = i * barW + gap / 2
    const bw   = barW - gap

    const grad = ctx.createLinearGradient(0, mid - barH, 0, mid + barH)
    grad.addColorStop(0,   colors.stroke)
    grad.addColorStop(0.5, colors.fill)
    grad.addColorStop(1,   colors.stroke)
    ctx.fillStyle = grad

    ctx.beginPath()
    ctx.roundRect(x, mid - barH, bw, barH, [3, 3, 0, 0])
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(x, mid, bw, barH, [0, 0, 3, 3])
    ctx.fill()
  }
}

export function VisualizerPanel() {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const animRef     = useRef<number>(0)
  const [theme, setTheme] = useState<Theme>('bars')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const analyser = audioEngine.getAnalyser()
    let data: Uint8Array<ArrayBuffer>

    if (analyser) {
      data = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>
    } else {
      data = new Uint8Array(1024).fill(128) as Uint8Array<ArrayBuffer>
    }

    const colors = THEME_COLORS[theme]

    const draw = (t: DOMHighResTimeStamp) => {
      const w = canvas.width
      const h = canvas.height

      if (analyser) {
        if (theme === 'waveform') {
          analyser.getByteTimeDomainData(data)
        } else {
          analyser.getByteFrequencyData(data)
        }
      } else {
        // Idle animation: gentle sine
        for (let i = 0; i < data.length; i++) {
          data[i] = 128 + 10 * Math.sin(t / 500 + i / 10)
        }
      }

      switch (theme) {
        case 'bars':     drawBars(ctx, data, w, h, colors); break
        case 'waveform': drawWaveform(ctx, data, w, h, colors, t); break
        case 'circular': drawCircular(ctx, data, w, h, colors, t); break
        case 'mirror':   drawMirror(ctx, data, w, h, colors); break
      }

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, [theme])

  // Resize canvas to match CSS size
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.clientWidth
      canvas.height = canvas.clientHeight
    })
    ro.observe(canvas)
    canvas.width  = canvas.clientWidth
    canvas.height = canvas.clientHeight
    return () => ro.disconnect()
  }, [])

  return (
    <div className="flex flex-col h-full border-r border-border/50 bg-[#0f0f1a] select-none"
         style={{ width: 200 }}>
      {/* Theme selector */}
      <div className="flex flex-wrap gap-1 p-2 border-b border-white/10">
        {THEMES.map(t => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              theme === t.id
                ? 'bg-primary text-white'
                : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/90'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  )
}
