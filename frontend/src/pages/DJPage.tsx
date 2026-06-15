import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft, Play, Pause, SkipBack, SkipForward,
  Search, Loader2, Music, Disc3, Mic2, ListMusic,
} from 'lucide-react'
import { useDJStore, djEngineA, djEngineB } from '../store/djStore'
import { mediaApi, formatDuration } from '../api'

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

// ── CSS injected once ─────────────────────────────────────────────────────────

const DJ_CSS = `
  @keyframes djSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
  .dj-vert-fader { writing-mode: vertical-lr; direction: rtl; }
  .dj-row-hover:hover { background: rgba(255,255,255,0.04) !important; }
`

// ── Knob ─────────────────────────────────────────────────────────────────────

function Knob({ value, min, max, onChange, label, size = 44, color = '#00d4ff', unit = '' }: {
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

  return (
    <div className="flex flex-col items-center gap-0.5 select-none" style={{ minWidth: size }}>
      <div
        ref={knobRef}
        className="relative cursor-pointer"
        style={{ width: size, height: size, transform: `rotate(${rotation}deg)` }}
        onMouseDown={onMouseDown}
        onDoubleClick={() => onChange((min + max) / 2)}
        title="Double-clic: reset"
      >
        <div className="absolute inset-0 rounded-full" style={{ border: `2px solid ${rgba(color, 0.2)}` }} />
        <div className="absolute inset-1 rounded-full" style={{
          background: 'radial-gradient(circle at 38% 30%, #252535, #0e0e1c)',
          boxShadow: 'inset 0 1px 5px rgba(0,0,0,0.9)',
        }} />
        <div className="absolute" style={{
          top: 3, left: '50%', marginLeft: -1,
          width: 2, height: size * 0.26,
          background: color, borderRadius: 1,
          boxShadow: `0 0 5px ${rgba(color, 0.8)}`,
        }} />
      </div>
      <p style={{ color: '#3a3a54', fontSize: 9, textAlign: 'center' }}>{label}</p>
      <p style={{ color, fontSize: 9, fontFamily: 'monospace', textAlign: 'center' }}>{display}{unit}</p>
    </div>
  )
}

// ── Vertical fader ────────────────────────────────────────────────────────────

function VertFader({ value, onChange, height = 130, color = '#00d4ff' }: {
  value: number; onChange: (v: number) => void; height?: number; color?: string
}) {
  return (
    <input
      type="range" min={0} max={1} step={0.01}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="dj-vert-fader"
      style={{ width: 6, height, cursor: 'ns-resize', accentColor: color } as React.CSSProperties}
    />
  )
}

// ── VU meter ──────────────────────────────────────────────────────────────────

function VUMeter({ analyser, color }: { analyser: AnalyserNode | null; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    const BARS = 18

    function draw() {
      rafRef.current = requestAnimationFrame(draw)
      ctx.fillStyle = '#080810'
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
        const c   = i < 2 ? '#ff3344' : i < 5 ? '#ffaa00' : color
        ctx.fillStyle = rgba(c, lit ? 0.95 : 0.07)
        ctx.fillRect(0, i * (bH + 1), W, bH)
      }
    }

    draw()
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [analyser, color])

  return <canvas ref={canvasRef} width={8} height={130} style={{ borderRadius: 2 }} />
}

// ── Waveform (frequency spectrum, real-time) ──────────────────────────────────

function DJWaveform({ analyser, position, duration, color, onSeek }: {
  analyser: AnalyserNode | null
  position: number; duration: number; color: string
  onSeek: (s: number) => void
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

    function draw() {
      rafRef.current = requestAnimationFrame(draw)
      const W = canvas!.width, H = canvas!.height, mid = H / 2

      ctx.fillStyle = '#09090f'
      ctx.fillRect(0, 0, W, H)

      // Subtle center line
      ctx.strokeStyle = rgba('#ffffff', 0.05)
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()

      if (analyser) {
        const buf = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(buf)
        const N  = Math.min(buf.length / 2, W)
        const bW = W / N

        for (let i = 0; i < N; i++) {
          const v  = buf[Math.floor(i * buf.length / N)] / 255
          const bH = v * mid * 0.88
          const a  = 0.25 + v * 0.75
          ctx.fillStyle = rgba(color, a)
          ctx.fillRect(i * bW, mid - bH, bW - 0.5, bH)
          ctx.fillStyle = rgba(color, a * 0.35)
          ctx.fillRect(i * bW, mid, bW - 0.5, bH * 0.65)
        }
      } else {
        ctx.strokeStyle = rgba(color, 0.18)
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()
      }

      // Track progress marker
      const dur = durRef.current
      if (dur > 0) {
        const px = ((dragPosRef.current ?? posRef.current) / dur) * W
        ctx.strokeStyle = rgba('#ffffff', 0.55)
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 5])
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
        ctx.setLineDash([])
      }

      // Center playhead
      ctx.strokeStyle = rgba('#ffffff', 0.9)
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke()
    }

    draw()
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [analyser, color])

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded cursor-pointer"
      height={70}
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

function JogWheel({ isPlaying, position, duration, color, size = 158 }: {
  isPlaying: boolean; position: number; duration: number; color: string; size?: number
}) {
  const prog  = duration > 0 ? position / duration : 0
  const r     = size / 2 - 9
  const circ  = 2 * Math.PI * r

  return (
    <div className="relative flex-shrink-0 mx-auto select-none" style={{ width: size, height: size }}>
      {/* SVG progress arc */}
      <svg className="absolute inset-0" width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a1a28" strokeWidth={6} />
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${prog * circ} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          opacity={0.75}
        />
      </svg>

      {/* Outer spinning ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          border: `2px solid ${rgba(color, 0.45)}`,
          animation: isPlaying ? 'djSpin 1.8s linear infinite' : 'none',
          boxShadow: isPlaying ? `0 0 18px ${rgba(color, 0.28)}` : 'none',
          transition: 'box-shadow 0.3s',
        }}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="absolute" style={{
            width: 2, height: i % 3 === 0 ? 9 : 5,
            top: 2, left: '50%', marginLeft: -1,
            transformOrigin: `0 ${size / 2 - 4}px`,
            transform: `rotate(${i * 30}deg)`,
            background: i % 3 === 0 ? color : rgba('#ffffff', 0.25),
            borderRadius: 1,
          }} />
        ))}
      </div>

      {/* Inner disk */}
      <div className="absolute rounded-full" style={{
        inset: 16,
        background: 'radial-gradient(circle at 38% 32%, #1e1e30, #0b0b16)',
        boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.95)',
      }}>
        {/* Groove rings */}
        {[0.82, 0.68, 0.54].map((f, i) => (
          <div key={i} className="absolute rounded-full" style={{
            inset: `${(1 - f) * 50}%`,
            border: `1px solid ${rgba('#ffffff', 0.04)}`,
          }} />
        ))}

        {/* Center label */}
        <div className="absolute rounded-full flex flex-col items-center justify-center" style={{
          inset: '28%',
          background: 'radial-gradient(circle at 38% 35%, #16162a, #060610)',
          boxShadow: `0 0 14px ${rgba(color, 0.2)}`,
        }}>
          <p style={{ color, fontSize: 11, fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>
            {fmt(position)}
          </p>
          <p style={{ color: '#3a3a54', fontSize: 8, fontFamily: 'monospace' }}>
            {fmtR(position, duration)}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Hot cue buttons ───────────────────────────────────────────────────────────

function HotCues({ hotCues, onPress, onDelete }: {
  hotCues: ({ position: number; color: string } | null)[]
  onPress:  (i: number) => void
  onDelete: (i: number) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {hotCues.map((cue, i) => (
        <button
          key={i}
          onClick={() => onPress(i)}
          onContextMenu={e => { e.preventDefault(); onDelete(i) }}
          title={cue ? `Point ${i+1} — ${fmt(cue.position)}\nClic droit: effacer` : `Définir point ${i+1}`}
          className="h-8 rounded font-bold transition-all active:scale-95"
          style={{
            fontSize: 11,
            background: cue ? rgba(cue.color, 0.22) : '#141420',
            border: `1px solid ${cue ? cue.color : '#22223a'}`,
            color: cue ? cue.color : '#2e2e48',
            boxShadow: cue ? `0 0 7px ${rgba(cue.color, 0.3)}` : 'none',
          }}
        >
          {i + 1}
        </button>
      ))}
    </div>
  )
}

// ── BPM display ───────────────────────────────────────────────────────────────

function BpmDisplay({ pitch, color }: { pitch: number; color: string }) {
  const pct = (Math.pow(2, pitch / 12) * 100 - 100).toFixed(1)
  const sign = parseFloat(pct) >= 0 ? '+' : ''
  return (
    <div className="flex flex-col items-end">
      <p style={{ color, fontSize: 10, fontFamily: 'monospace', fontWeight: 700 }}>
        {pitch >= 0 ? '+' : ''}{pitch.toFixed(1)} st
      </p>
      <p style={{ color: '#3a3a54', fontSize: 9, fontFamily: 'monospace' }}>
        {sign}{pct}%
      </p>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ position, duration, onSeek, color }: {
  position: number; duration: number; onSeek: (s: number) => void; color: string
}) {
  const barRef    = useRef<HTMLDivElement>(null)
  const dragging  = useRef(false)
  const [dragPos, setDragPos] = useState<number | null>(null)

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

  return (
    <div
      ref={barRef}
      className="relative h-1.5 rounded-full cursor-pointer"
      style={{ background: '#1a1a28' }}
      onMouseDown={e => {
        dragging.current = true
        const t = timeAt(e.clientX)
        setDragPos(t)
        onSeek(t)
        e.stopPropagation()
      }}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-none"
        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 4px ${rgba(color, 0.5)}` }}
      />
    </div>
  )
}

// ── Single Deck panel ─────────────────────────────────────────────────────────

function DJDeck({ deck, color }: { deck: 'A' | 'B'; color: string }) {
  const eng = deck === 'A' ? djEngineA : djEngineB
  const st  = useDJStore(s => s[deck === 'A' ? 'deckA' : 'deckB'])
  const { togglePlay, seek, setPitch, pressCue, pressHotCue, deleteHotCue,
          setLoopIn, setLoopOut, toggleLoop, halveLoop, doubleLoop,
          nextTrack, prevTrack } = useDJStore()
  const hasQueue = st.queue.length > 0

  return (
    <div className="flex flex-col gap-2 p-3 h-full" style={{ background: '#0a0a12' }}>
      {/* Label + loading */}
      <div className="flex items-center justify-between">
        <span style={{ color, fontSize: 10, fontWeight: 700, letterSpacing: 3 }}>DECK {deck}</span>
        {st.isLoading && <Loader2 className="w-3 h-3 animate-spin" style={{ color }} />}
      </div>

      {/* Waveform */}
      <DJWaveform
        analyser={eng.analyser}
        position={st.position}
        duration={st.duration}
        color={color}
        onSeek={s => seek(deck, s)}
      />

      {/* Progress bar */}
      <ProgressBar position={st.position} duration={st.duration} onSeek={s => seek(deck, s)} color={color} />

      {/* Track info */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-10 h-10 rounded flex-shrink-0 overflow-hidden" style={{ background: '#141422' }}>
          {st.track?.coverUrl
            ? <img src={st.track.coverUrl} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center">
                <Music className="w-4 h-4" style={{ color: '#2e2e48' }} />
              </div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-xs font-semibold" style={{ color: st.track ? '#d8d8ee' : '#2e2e48' }}>
            {st.track?.title ?? 'Aucune piste chargée'}
          </p>
          <div className="flex items-center gap-2">
            <p className="truncate" style={{ color: '#3a3a54', fontSize: 10 }}>
              {st.track?.artistName ?? ' '}
            </p>
            {hasQueue && (
              <span style={{ color: '#2a2a44', fontSize: 9, flexShrink: 0 }}>
                {st.queueIndex + 1}/{st.queue.length}
              </span>
            )}
          </div>
        </div>
        <BpmDisplay pitch={st.pitch} color={color} />
      </div>

      {/* Jog wheel + pitch */}
      <div className="flex items-center justify-center gap-4 my-1">
        <JogWheel
          isPlaying={st.isPlaying}
          position={st.position}
          duration={st.duration}
          color={color}
        />

        {/* Pitch fader */}
        <div className="flex flex-col items-center gap-1">
          <span style={{ color: '#2e2e48', fontSize: 9, letterSpacing: 1 }}>PITCH</span>
          <div style={{ height: 130, display: 'flex', alignItems: 'center', position: 'relative' }}>
            {/* Zero mark */}
            <div className="absolute inset-x-0" style={{ top: '50%', height: 1, background: '#22223a', margin: '0 -4px' }} />
            <input
              type="range" min={-8} max={8} step={0.1}
              value={st.pitch}
              onChange={e => setPitch(deck, parseFloat(e.target.value))}
              className="dj-vert-fader"
              style={{ width: 6, height: 130, cursor: 'ns-resize', accentColor: color } as React.CSSProperties}
            />
          </div>
          <button
            onClick={() => setPitch(deck, 0)}
            style={{ color: '#2e2e48', fontSize: 8, background: '#141420', border: '1px solid #1e1e30', padding: '1px 6px', borderRadius: 3 }}
          >
            RESET
          </button>
        </div>
      </div>

      {/* Hot cues */}
      <HotCues
        hotCues={st.hotCues}
        onPress={i => pressHotCue(deck, i)}
        onDelete={i => deleteHotCue(deck, i)}
      />

      {/* Loop controls */}
      <div className="grid grid-cols-5 gap-1">
        {[
          { label: 'IN',   fn: () => setLoopIn(deck) },
          { label: 'OUT',  fn: () => setLoopOut(deck) },
          { label: '/2',   fn: () => halveLoop(deck) },
          { label: '×2',   fn: () => doubleLoop(deck) },
          { label: 'LOOP', fn: () => toggleLoop(deck), active: st.isLooping },
        ].map(b => (
          <button
            key={b.label}
            onClick={b.fn}
            className="h-7 rounded font-bold transition-all active:scale-95"
            style={{
              fontSize: 9, letterSpacing: 0.5,
              background: b.active ? rgba(color, 0.28) : '#101018',
              border: `1px solid ${b.active ? color : '#1e1e30'}`,
              color: b.active ? color : '#3a3a54',
              boxShadow: b.active ? `0 0 6px ${rgba(color, 0.3)}` : 'none',
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
          className="p-2 rounded transition-all hover:bg-white/5 disabled:opacity-20"
          style={{ color: hasQueue ? color : '#3a3a54' }}
          title="Piste précédente"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={() => pressCue(deck)}
          className="flex-1 h-10 rounded font-bold tracking-widest transition-all active:scale-95"
          style={{
            fontSize: 10,
            background: '#0e0e1c',
            border: `1px solid ${rgba(color, 0.5)}`,
            color,
          }}
          title="Définir/aller au point CUE"
        >
          CUE
        </button>

        <button
          onClick={() => togglePlay(deck)}
          className="w-16 h-10 rounded flex items-center justify-center transition-all active:scale-95"
          style={{
            background: st.isPlaying ? rgba(color, 0.22) : rgba(color, 0.12),
            border: `1.5px solid ${color}`,
            boxShadow: st.isPlaying ? `0 0 16px ${rgba(color, 0.38)}` : 'none',
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
          className="p-2 rounded transition-all hover:bg-white/5 disabled:opacity-20"
          style={{ color: hasQueue ? color : '#3a3a54' }}
          title="Piste suivante"
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ── Mixer (center) ────────────────────────────────────────────────────────────

const COL_A = '#00d4ff'
const COL_B = '#ff6b35'

function DJMixer() {
  const { deckA, deckB, crossfader, masterVolume,
          setEq, setGain, setVolume, setCrossfader, setMasterVol } = useDJStore()

  return (
    <div className="flex flex-col gap-4 p-4" style={{ background: '#060610', minWidth: 256 }}>
      <p className="text-center font-bold tracking-widest" style={{ color: '#2e2e48', fontSize: 10 }}>
        MIXER
      </p>

      {/* EQ ─────────────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-center mb-3" style={{ color: '#22223a', fontSize: 9, letterSpacing: 2 }}>EQ</p>
        <div className="grid grid-cols-2 gap-3">
          {/* Deck A EQ */}
          <div className="flex flex-col items-center gap-2">
            <span style={{ color: COL_A, fontSize: 9, fontWeight: 700 }}>A</span>
            <Knob value={deckA.eqHigh} min={-12} max={6} onChange={v => setEq('A', 'high', v)} label="HIGH" color={COL_A} size={40} unit="dB" />
            <Knob value={deckA.eqMid}  min={-12} max={6} onChange={v => setEq('A', 'mid',  v)} label="MID"  color={COL_A} size={40} unit="dB" />
            <Knob value={deckA.eqLow}  min={-12} max={6} onChange={v => setEq('A', 'low',  v)} label="LOW"  color={COL_A} size={40} unit="dB" />
          </div>
          {/* Deck B EQ */}
          <div className="flex flex-col items-center gap-2">
            <span style={{ color: COL_B, fontSize: 9, fontWeight: 700 }}>B</span>
            <Knob value={deckB.eqHigh} min={-12} max={6} onChange={v => setEq('B', 'high', v)} label="HIGH" color={COL_B} size={40} unit="dB" />
            <Knob value={deckB.eqMid}  min={-12} max={6} onChange={v => setEq('B', 'mid',  v)} label="MID"  color={COL_B} size={40} unit="dB" />
            <Knob value={deckB.eqLow}  min={-12} max={6} onChange={v => setEq('B', 'low',  v)} label="LOW"  color={COL_B} size={40} unit="dB" />
          </div>
        </div>
      </div>

      {/* Gain ────────────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-center mb-2" style={{ color: '#22223a', fontSize: 9, letterSpacing: 2 }}>GAIN</p>
        <div className="flex justify-center gap-6">
          <Knob value={deckA.gain} min={0} max={2} onChange={v => setGain('A', v)} label="A" color={COL_A} size={38} />
          <Knob value={deckB.gain} min={0} max={2} onChange={v => setGain('B', v)} label="B" color={COL_B} size={38} />
        </div>
      </div>

      {/* Channel faders + VU ─────────────────────────────────────────────────── */}
      <div>
        <p className="text-center mb-2" style={{ color: '#22223a', fontSize: 9, letterSpacing: 2 }}>VOLUME</p>
        <div className="flex justify-center gap-4 items-end">
          <div className="flex gap-2 items-end">
            <VUMeter analyser={djEngineA.analyser} color={COL_A} />
            <VertFader value={deckA.volume} onChange={v => setVolume('A', v)} color={COL_A} height={130} />
          </div>
          <div className="flex gap-2 items-end">
            <VertFader value={deckB.volume} onChange={v => setVolume('B', v)} color={COL_B} height={130} />
            <VUMeter analyser={djEngineB.analyser} color={COL_B} />
          </div>
        </div>
      </div>

      {/* Crossfader ──────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span style={{ color: COL_A, fontSize: 9, fontWeight: 700 }}>A</span>
          <span style={{ color: '#22223a', fontSize: 8, letterSpacing: 2 }}>CROSSFADER</span>
          <span style={{ color: COL_B, fontSize: 9, fontWeight: 700 }}>B</span>
        </div>
        <input
          type="range" min={-1} max={1} step={0.01}
          value={crossfader}
          onChange={e => setCrossfader(parseFloat(e.target.value))}
          className="w-full"
          style={{ accentColor: '#7744ee' }}
        />
        <div className="flex justify-center mt-1">
          <button
            onClick={() => setCrossfader(0)}
            style={{ color: '#2e2e48', fontSize: 8, background: '#0e0e1c', border: '1px solid #1a1a2c', padding: '1px 8px', borderRadius: 3 }}
          >
            CENTER
          </button>
        </div>
      </div>

      {/* Master ──────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-1 pt-2 mt-auto" style={{ borderTop: '1px solid #12121e' }}>
        <Knob
          value={masterVolume} min={0} max={1}
          onChange={setMasterVol}
          label="MASTER" color="#7744ee" size={48}
        />
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
  const enabled = isOpen
  const isQueueContext = !!(albumId || playlistId)

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
    if (tab === 'recent')  return recent.map(t  => ({ id: t.id, title: t.title, duration_secs: t.duration_secs }))
    if (tab === 'liked')   return liked.map(t   => ({ id: t.id, title: t.title, duration_secs: t.duration_secs }))
    if (albumId && albumDet)       return albumDet.tracks.map(t => ({ id: t.id, title: t.title, duration_secs: t.duration_secs }))
    if (playlistId && playlistDet) return playlistDet.tracks.map(t => ({ id: t.id, title: t.title, duration_secs: t.duration_secs, artist_name: t.artist_name }))
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
    return { id: t.id, title: t.title, durationSecs: t.duration_secs, artistName: t.artist_name ?? undefined }
  }

  function sendToDeck(deck: 'A' | 'B', t: DJTrack) {
    if (isQueueContext && djTracks.length > 1) {
      const idx = djTracks.findIndex(x => x.id === t.id)
      loadQueueToStore(deck, djTracks.map(toPlayerTrack), idx >= 0 ? idx : 0)
    } else {
      loadTrackToStore(deck, toPlayerTrack(t))
    }
  }

  function sendAllToDeck(deck: 'A' | 'B') {
    if (djTracks.length === 0) return
    loadQueueToStore(deck, djTracks.map(toPlayerTrack), 0)
  }

  const LoadBtn = ({ deck, t }: { deck: 'A' | 'B'; t: DJTrack }) => (
    <button
      onClick={() => sendToDeck(deck, t)}
      className="px-2 py-0.5 rounded transition-all active:scale-95"
      style={{
        background: rgba(deck === 'A' ? COL_A : COL_B, 0.12),
        color:  deck === 'A' ? COL_A : COL_B,
        border: `1px solid ${rgba(deck === 'A' ? COL_A : COL_B, 0.35)}`,
        fontSize: 9,
      }}
    >
      → {deck}
    </button>
  )

  return (
    <div style={{
      height: isOpen ? 260 : 36,
      background: '#07070e',
      borderTop: '1px solid #141420',
      transition: 'height 0.2s ease',
      overflow: 'hidden',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 flex-shrink-0" style={{ height: 36 }}>
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 hover:opacity-80 flex-shrink-0"
          style={{ color: '#3a3a54', fontSize: 10, fontWeight: 700, letterSpacing: 2 }}
        >
          <span>{isOpen ? '▼' : '▲'}</span>
          <span>BIBLIOTHÈQUE</span>
        </button>

        {isOpen && (
          <>
            {/* Back navigation */}
            {hasBack ? (
              <button
                onClick={goBack}
                className="flex items-center gap-1 hover:opacity-80 flex-shrink-0"
                style={{ color: '#6060a0', fontSize: 10 }}
              >
                ← {backLabel}
              </button>
            ) : (
              /* Tab buttons */
              <div className="flex gap-1 flex-shrink-0">
                {DJ_TABS.map(([id, lbl]) => (
                  <button
                    key={id}
                    onClick={() => switchTab(id)}
                    className="px-2.5 py-0.5 rounded transition-colors"
                    style={{
                      fontSize: 10,
                      background: tab === id ? '#141428' : 'transparent',
                      border: `1px solid ${tab === id ? '#2a2a40' : 'transparent'}`,
                      color: tab === id ? '#b0b0cc' : '#3a3a54',
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}

            {/* Search (artists / albums list) */}
            {showSearch && (
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: '#3a3a54' }} />
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={tab === 'artists' ? 'Rechercher un artiste…' : 'Rechercher un album…'}
                  className="w-full rounded outline-none pl-6 pr-2 py-0.5"
                  style={{ background: '#101020', color: '#c0c0d8', border: '1px solid #1e1e30', fontSize: 10 }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Content */}
      {isOpen && (
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#3a3a54' }} />
            </div>
          )}

          {/* Artists list */}
          {!isLoading && showArtistList && (
            <div className="grid gap-0.5 p-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))' }}>
              {artists.length === 0
                ? <p className="col-span-full px-4 py-6 text-center" style={{ color: '#2e2e48', fontSize: 10 }}>Aucun artiste</p>
                : artists.map(a => (
                  <button key={a.id} onClick={() => { setArtistId(a.id); setArtistName(a.name) }}
                    className="dj-row-hover flex items-center gap-2 px-3 py-1.5 rounded text-left">
                    <Mic2 className="w-4 h-4 flex-shrink-0" style={{ color: '#3a3a54' }} />
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: '#b0b0cc', fontSize: 10, fontWeight: 500 }}>{a.name}</p>
                      {a.album_count > 0 && <p style={{ color: '#3a3a54', fontSize: 9 }}>{a.album_count} album{a.album_count > 1 ? 's' : ''}</p>}
                    </div>
                  </button>
                ))
              }
            </div>
          )}

          {/* Artist's albums */}
          {!isLoading && showArtistAlbum && (
            <div className="grid gap-0.5 p-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))' }}>
              {!artistDet
                ? <div className="col-span-full flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" style={{ color: '#3a3a54' }} /></div>
                : artistDet.albums.length === 0
                ? <p className="col-span-full px-4 py-6 text-center" style={{ color: '#2e2e48', fontSize: 10 }}>Aucun album</p>
                : artistDet.albums.map(a => (
                  <button key={a.id} onClick={() => { setAlbumId(a.id); setAlbumName(a.title) }}
                    className="dj-row-hover flex items-center gap-2 px-3 py-1.5 rounded text-left">
                    <Disc3 className="w-4 h-4 flex-shrink-0" style={{ color: '#3a3a54' }} />
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: '#b0b0cc', fontSize: 10, fontWeight: 500 }}>{a.title}</p>
                      <p style={{ color: '#3a3a54', fontSize: 9 }}>{a.track_count} titres{a.release_year ? ` · ${a.release_year}` : ''}</p>
                    </div>
                  </button>
                ))
              }
            </div>
          )}

          {/* Albums list */}
          {!isLoading && showAlbumList && (
            <div className="grid gap-0.5 p-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))' }}>
              {albums.length === 0
                ? <p className="col-span-full px-4 py-6 text-center" style={{ color: '#2e2e48', fontSize: 10 }}>Aucun album</p>
                : albums.map(a => (
                  <button key={a.id} onClick={() => { setAlbumId(a.id); setAlbumName(a.title) }}
                    className="dj-row-hover flex items-center gap-2 px-3 py-1.5 rounded text-left">
                    <Disc3 className="w-4 h-4 flex-shrink-0" style={{ color: '#3a3a54' }} />
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: '#b0b0cc', fontSize: 10, fontWeight: 500 }}>{a.title}</p>
                      <p style={{ color: '#3a3a54', fontSize: 9 }}>{a.track_count} titres</p>
                    </div>
                  </button>
                ))
              }
            </div>
          )}

          {/* Playlists list */}
          {!isLoading && showPlaylist && (
            <div className="divide-y" style={{ borderColor: '#0e0e18' }}>
              {playlists.length === 0
                ? <p className="px-4 py-6 text-center" style={{ color: '#2e2e48', fontSize: 10 }}>Aucune playlist</p>
                : playlists.map(p => (
                  <button key={p.id} onClick={() => { setPlaylistId(p.id); setPlaylistName(p.name) }}
                    className="dj-row-hover w-full flex items-center gap-3 px-4 py-2 text-left">
                    <ListMusic className="w-4 h-4 flex-shrink-0" style={{ color: '#3a3a54' }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate" style={{ color: '#b0b0cc', fontSize: 10, fontWeight: 500 }}>{p.name}</p>
                      <p style={{ color: '#3a3a54', fontSize: 9 }}>{p.track_count} titres · {formatDuration(p.duration_secs)}</p>
                    </div>
                  </button>
                ))
              }
            </div>
          )}

          {/* Track table */}
          {!isLoading && showTrackList && (
            <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 10 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#07070e', zIndex: 1 }}>
                <tr style={{ borderBottom: '1px solid #141420', color: '#3a3a54' }}>
                  <th className="px-4 py-1 text-left font-medium">
                    Titre
                    {isQueueContext && djTracks.length > 0 && (
                      <span className="ml-2 inline-flex gap-1">
                        <button onClick={() => sendAllToDeck('A')} className="px-1.5 py-0 rounded" style={{ background: rgba(COL_A, 0.15), color: COL_A, border: `1px solid ${rgba(COL_A,0.4)}`, fontSize: 9 }}>Tout → A</button>
                        <button onClick={() => sendAllToDeck('B')} className="px-1.5 py-0 rounded" style={{ background: rgba(COL_B, 0.15), color: COL_B, border: `1px solid ${rgba(COL_B,0.4)}`, fontSize: 9 }}>Tout → B</button>
                      </span>
                    )}
                  </th>
                  <th className="px-4 py-1 text-left font-medium hidden sm:table-cell">Durée</th>
                  <th className="px-4 py-1 font-medium" style={{ width: 56 }}>A</th>
                  <th className="px-4 py-1 font-medium" style={{ width: 56 }}>B</th>
                </tr>
              </thead>
              <tbody>
                {djTracks.length === 0
                  ? <tr><td colSpan={4} className="px-4 py-8 text-center" style={{ color: '#2e2e48' }}>Aucun titre</td></tr>
                  : djTracks.map(t => (
                    <tr key={t.id} className="dj-row-hover" style={{ borderBottom: '1px solid #0e0e18' }}>
                      <td className="px-4 py-1.5">
                        <p className="truncate" style={{ color: '#b0b0cc', maxWidth: 260 }}>{t.title}</p>
                        {t.artist_name && <p className="truncate" style={{ color: '#3a3a54', fontSize: 9, maxWidth: 260 }}>{t.artist_name}</p>}
                      </td>
                      <td className="px-4 py-1.5 hidden sm:table-cell" style={{ color: '#3a3a54' }}>
                        {formatDuration(t.duration_secs)}
                      </td>
                      <td className="px-3 py-1.5"><LoadBtn deck="A" t={t} /></td>
                      <td className="px-3 py-1.5"><LoadBtn deck="B" t={t} /></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── DJ Page ───────────────────────────────────────────────────────────────────

export default function DJPage() {
  const navigate    = useNavigate()
  const masterVol   = useDJStore(s => s.masterVolume)
  const setMasterVol = useDJStore(s => s.setMasterVol)
  const [browser, setBrowser] = useState(true)

  return (
    <div className="flex flex-col h-full overflow-hidden select-none" style={{ background: '#07070d', color: '#c0c0d8' }}>
      <style>{DJ_CSS}</style>

      {/* Header ────────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-4 flex-shrink-0"
        style={{ height: 44, background: '#050509', borderBottom: '1px solid #141420' }}
      >
        <button
          onClick={() => navigate('/media/listen')}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          style={{ color: '#3a3a54', fontSize: 11 }}
        >
          <ChevronLeft className="w-4 h-4" />
          Bibliothèque
        </button>

        <div className="flex items-center gap-2.5 mx-auto">
          <div className="w-2 h-2 rounded-full" style={{ background: '#7744ee', boxShadow: '0 0 10px #7744ee' }} />
          <span style={{ color: '#7744ee', fontSize: 12, fontWeight: 700, letterSpacing: 4 }}>KUBUNO DJ</span>
          <div className="w-2 h-2 rounded-full" style={{ background: '#7744ee', boxShadow: '0 0 10px #7744ee' }} />
        </div>

        <div className="flex items-center gap-2">
          <span style={{ color: '#2e2e48', fontSize: 9, letterSpacing: 2 }}>MASTER</span>
          <input
            type="range" min={0} max={1} step={0.01}
            value={masterVol}
            onChange={e => setMasterVol(parseFloat(e.target.value))}
            className="w-24"
            style={{ accentColor: '#7744ee' }}
          />
          <span style={{ color: '#7744ee', fontSize: 10, fontFamily: 'monospace', minWidth: 28, textAlign: 'right' }}>
            {Math.round(masterVol * 100)}
          </span>
        </div>
      </div>

      {/* 3-column main area ────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0" style={{ gap: 1 }}>
        {/* Deck A */}
        <div className="flex-1 min-w-0 overflow-y-auto" style={{ borderRight: '1px solid #141420' }}>
          <DJDeck deck="A" color={COL_A} />
        </div>

        {/* Mixer */}
        <div className="flex-shrink-0 overflow-y-auto" style={{ borderRight: '1px solid #141420' }}>
          <DJMixer />
        </div>

        {/* Deck B */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <DJDeck deck="B" color={COL_B} />
        </div>
      </div>

      {/* Browser panel */}
      <DJBrowser isOpen={browser} onToggle={() => setBrowser(o => !o)} />
    </div>
  )
}
