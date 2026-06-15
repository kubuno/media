import { useRef, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Play, Pause, SkipBack, SkipForward,
  Minimize2, Maximize2, X, Music, Volume2, VolumeX,
  Activity, Sliders, Shuffle, Repeat, Repeat1, ListMusic,
} from 'lucide-react'
import { FloatingWindow } from '@ui'
import { usePlayerStore, audio as playerAudio } from '../../../store/playerStore'
import { useWindowZStore } from '@ui'
import { audioEngine } from '../../../store/audioEngine'
import { VisualizerPanel } from './VisualizerPanel'
import { EqualizerPanel } from './EqualizerPanel'
import { QueuePanel } from './QueuePanel'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  const s = Math.floor(secs)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

// ── Cover art ─────────────────────────────────────────────────────────────────

function CoverArt({ url, size = 48 }: { url?: string; size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {url
        ? <img src={url} alt="" className="w-full h-full object-cover" />
        : <Music size={size * 0.4} className="text-primary/60" />
      }
    </div>
  )
}

// ── Progress bar (click-and-drag) ─────────────────────────────────────────────

function ProgressBar({ position, duration, onSeek }: {
  position: number; duration: number; onSeek: (s: number) => void
}) {
  const barRef     = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const [dragPos,  setDragPos] = useState<number | null>(null)

  const timeAt = useCallback((clientX: number): number => {
    const bar = barRef.current
    if (!bar || !duration) return 0
    const rect  = bar.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }, [duration])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const t = timeAt(e.clientX)
      setDragPos(t)
      onSeek(t)
    }
    const onUp = () => {
      isDragging.current = false
      setDragPos(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [timeAt, onSeek])

  const displayPos = dragPos ?? position
  const pct = duration > 0 ? (displayPos / duration) * 100 : 0

  return (
    <div
      ref={barRef}
      className="relative h-1.5 rounded-full bg-surface-3 cursor-pointer group"
      onMouseDown={e => {
        isDragging.current = true
        const t = timeAt(e.clientX)
        setDragPos(t)
        onSeek(t)
        e.stopPropagation()
      }}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-none" style={{ width: `${pct}%` }} />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary shadow opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1/2"
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}

// ── Volume slider ─────────────────────────────────────────────────────────────

function VolumeControl({ volume, onChange }: { volume: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onChange(volume > 0 ? 0 : 0.8)}
        className="text-text-tertiary hover:text-text-primary transition-colors"
      >
        {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
      <input
        type="range" min={0} max={1} step={0.02} value={volume}
        onChange={e => onChange(Number(e.target.value))}
        className="w-20 h-1 rounded-full appearance-none bg-surface-3 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        onMouseDown={e => e.stopPropagation()}
      />
    </div>
  )
}

// ── Center player content ─────────────────────────────────────────────────────

function CenterContent() {
  const {
    currentTrack, isPlaying, position, duration, volume,
    togglePlay, seek, setVolume, next, prev, queue, queueIndex,
    shuffle, repeatMode, toggleShuffle, cycleRepeat,
  } = usePlayerStore()

  if (!currentTrack) return null

  const hasPrev = queueIndex > 0
  const hasNext = shuffle || queueIndex < queue.length - 1 || repeatMode !== 'none'

  return (
    <div className="flex flex-col items-center gap-4 px-6 py-6" style={{ width: 320 }}>
      {/* Cover art — large */}
      <CoverArt url={currentTrack.coverUrl} size={180} />

      {/* Track info */}
      <div className="text-center w-full">
        <p className="text-base font-semibold text-text-primary truncate">{currentTrack.title}</p>
        {currentTrack.artistName && (
          <p className="text-sm text-text-secondary mt-0.5 truncate">{currentTrack.artistName}</p>
        )}
        {currentTrack.albumTitle && (
          <p className="text-xs text-text-tertiary mt-0.5 truncate">{currentTrack.albumTitle}</p>
        )}
      </div>

      {/* Progress */}
      <div className="w-full">
        <ProgressBar position={position} duration={duration || currentTrack.durationSecs} onSeek={seek} />
        <div className="flex justify-between text-xs text-text-tertiary mt-1">
          <span>{fmt(position)}</span>
          <span>{fmt(duration || currentTrack.durationSecs)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={prev}
          disabled={!hasPrev && position <= 3}
          className="p-2 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 transition-colors"
        >
          <SkipBack size={20} />
        </button>
        <button
          onClick={togglePlay}
          className="w-12 h-12 rounded-full bg-primary hover:bg-primary-hover text-white flex items-center justify-center shadow-md transition-colors"
        >
          {isPlaying ? <Pause size={20} fill="white" /> : <Play size={20} fill="white" className="ml-0.5" />}
        </button>
        <button
          onClick={next}
          disabled={!hasNext}
          className="p-2 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 transition-colors"
        >
          <SkipForward size={20} />
        </button>
      </div>

      {/* Secondary controls — shuffle + repeat */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleShuffle}
          title="Lecture aléatoire"
          className={`p-1.5 rounded-lg transition-colors ${
            shuffle
              ? 'text-primary bg-primary/10'
              : 'text-text-tertiary hover:text-text-primary hover:bg-surface-2'
          }`}
        >
          <Shuffle size={16} />
        </button>
        <button
          onClick={cycleRepeat}
          title={repeatMode === 'none' ? 'Répéter' : repeatMode === 'all' ? 'Répéter la lecture' : 'Répéter le titre'}
          className={`p-1.5 rounded-lg transition-colors ${
            repeatMode !== 'none'
              ? 'text-primary bg-primary/10'
              : 'text-text-tertiary hover:text-text-primary hover:bg-surface-2'
          }`}
        >
          {repeatMode === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
        </button>
      </div>

      {/* Volume */}
      <VolumeControl volume={volume} onChange={setVolume} />
    </div>
  )
}

// ── Panel toggle button ───────────────────────────────────────────────────────

function PanelToggleBtn({
  active, onClick, icon, title,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; title: string
}) {
  return (
    <button
      onClick={onClick}
      onMouseDown={e => e.stopPropagation()}
      title={title}
      className={`p-1.5 rounded-lg transition-colors ${
        active
          ? 'text-primary bg-primary/10'
          : 'text-text-tertiary hover:text-text-primary hover:bg-surface-2'
      }`}
    >
      {icon}
    </button>
  )
}

// ── Full player with retractable panels ───────────────────────────────────────

const PANEL_LEFT_W  = 200
const PANEL_RIGHT_W = 280
const PANEL_QUEUE_W = 280
const CENTER_W      = 320

function FullPlayer({ onMinimize, onClose }: {
  onMinimize: () => void; onClose: () => void
}) {
  const { currentTrack } = usePlayerStore()
  const [showLeft,  setShowLeft]  = useState(false)
  const [showQueue, setShowQueue] = useState(false)
  const [showRight, setShowRight] = useState(false)

  const totalWidth = CENTER_W
    + (showLeft  ? PANEL_LEFT_W  : 0)
    + (showQueue ? PANEL_QUEUE_W : 0)
    + (showRight ? PANEL_RIGHT_W : 0)

  if (!currentTrack) return null

  const titleActions = (
    <>
      <PanelToggleBtn
        active={showLeft}
        onClick={() => setShowLeft(p => !p)}
        icon={<Activity size={15} />}
        title={showLeft ? 'Masquer le visualiseur' : 'Afficher le visualiseur'}
      />
      <PanelToggleBtn
        active={showQueue}
        onClick={() => setShowQueue(p => !p)}
        icon={<ListMusic size={15} />}
        title={showQueue ? 'Masquer la file de lecture' : 'Afficher la file de lecture'}
      />
      <PanelToggleBtn
        active={showRight}
        onClick={() => setShowRight(p => !p)}
        icon={<Sliders size={15} />}
        title={showRight ? "Masquer l'égaliseur" : "Afficher l'égaliseur"}
      />
      <button
        onClick={onMinimize}
        onMouseDown={e => e.stopPropagation()}
        className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
        title="Réduire"
      >
        <Minimize2 size={15} />
      </button>
    </>
  )

  return (
    <FloatingWindow
      title={currentTrack.title}
      icon={<Music size={15} />}
      onClose={onClose}
      defaultWidth={totalWidth}
      minWidth={CENTER_W}
      minHeight={120}
      titleActions={titleActions}
      className="transition-[width] duration-300"
    >
      {/* Four-column layout */}
      <div className="flex h-full overflow-hidden">
        {/* Left panel — visualizer */}
        <div
          className="overflow-hidden transition-[width,opacity] duration-300 flex-shrink-0"
          style={{
            width:   showLeft ? PANEL_LEFT_W : 0,
            opacity: showLeft ? 1 : 0,
          }}
        >
          {showLeft && <VisualizerPanel />}
        </div>

        {/* Center — player controls */}
        <div className="flex-shrink-0 overflow-y-auto">
          <CenterContent />
        </div>

        {/* Queue panel */}
        <div
          className="overflow-hidden transition-[width,opacity] duration-300 flex-shrink-0"
          style={{
            width:   showQueue ? PANEL_QUEUE_W : 0,
            opacity: showQueue ? 1 : 0,
          }}
        >
          {showQueue && <QueuePanel />}
        </div>

        {/* Right panel — parametric equalizer */}
        <div
          className="overflow-hidden transition-[width,opacity] duration-300 flex-shrink-0"
          style={{
            width:   showRight ? PANEL_RIGHT_W : 0,
            opacity: showRight ? 1 : 0,
          }}
        >
          {showRight && <EqualizerPanel />}
        </div>
      </div>
    </FloatingWindow>
  )
}

// ── Mini player (compact corner widget) ──────────────────────────────────────

function MiniPlayer() {
  const {
    currentTrack, isPlaying,
    togglePlay, next, prev, restore, close,
    queue, queueIndex,
  } = usePlayerStore()
  const [zIdx] = useState(() => useWindowZStore.getState().next())

  const pillRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const el = pillRef.current
    if (!el) return
    if (!el.style.left) {
      const r = el.getBoundingClientRect()
      el.style.right  = 'auto'
      el.style.bottom = 'auto'
      el.style.left   = `${r.left}px`
      el.style.top    = `${r.top}px`
    }
    const rect   = el.getBoundingClientRect()
    const initL  = rect.left
    const initT  = rect.top
    const startX = e.clientX
    const startY = e.clientY
    const w = el.offsetWidth
    const h = el.offsetHeight
    const onMove = (me: MouseEvent) => {
      el.style.left = `${Math.max(0, Math.min(window.innerWidth  - w, initL + (me.clientX - startX)))}px`
      el.style.top  = `${Math.max(0, Math.min(window.innerHeight - h, initT + (me.clientY - startY)))}px`
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    e.preventDefault()
  }, [])

  if (!currentTrack) return null

  const hasPrev = queueIndex > 0
  const hasNext = queueIndex < queue.length - 1

  return createPortal(
    <div
      ref={pillRef}
      className="fixed flex items-center gap-2 pr-2 pl-2 py-2 bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.18)] border border-border select-none cursor-grab active:cursor-grabbing"
      style={{ bottom: 16, right: 16, zIndex: zIdx, maxWidth: 360 }}
      onMouseDown={onMouseDown}
    >
      <CoverArt url={currentTrack.coverUrl} size={40} />
      <div className="flex-1 min-w-0 mr-1">
        <p className="text-sm font-medium text-text-primary truncate leading-tight">{currentTrack.title}</p>
        {currentTrack.artistName && (
          <p className="text-xs text-text-tertiary truncate leading-tight">{currentTrack.artistName}</p>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <button onClick={e => { e.stopPropagation(); prev() }} disabled={!hasPrev}
          className="p-1.5 rounded-full text-text-tertiary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 transition-colors">
          <SkipBack size={14} />
        </button>
        <button onClick={e => { e.stopPropagation(); togglePlay() }}
          className="w-8 h-8 rounded-full bg-primary hover:bg-primary-hover text-white flex items-center justify-center transition-colors">
          {isPlaying ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" className="ml-px" />}
        </button>
        <button onClick={e => { e.stopPropagation(); next() }} disabled={!hasNext}
          className="p-1.5 rounded-full text-text-tertiary hover:text-text-primary hover:bg-surface-2 disabled:opacity-30 transition-colors">
          <SkipForward size={14} />
        </button>
        <button onClick={e => { e.stopPropagation(); restore() }}
          className="p-1.5 rounded-full text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title="Agrandir">
          <Maximize2 size={14} />
        </button>
        <button onClick={e => { e.stopPropagation(); close() }}
          className="p-1.5 rounded-full text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors" title="Fermer">
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body,
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

// Connect the engine once at module load time
audioEngine.connect(playerAudio)

export default function MusicPlayer() {
  const { isVisible, isMinimized, minimize, close, currentTrack } = usePlayerStore()

  useEffect(() => {
    audioEngine.resumeIfNeeded()
  }, [isVisible])

  if (!isVisible || !currentTrack) return null
  if (isMinimized) return <MiniPlayer />

  return <FullPlayer onMinimize={minimize} onClose={close} />
}
