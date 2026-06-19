import { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Play, Pause, SkipBack, SkipForward,
  Minimize2, Maximize2, X, Music, Volume2, VolumeX,
  Activity, Sliders, Shuffle, Repeat, Repeat1, ListMusic,
  Heart, Gauge, Moon, Mic2, Blend,
} from 'lucide-react'
import { FloatingWindow } from '@ui'
import { usePlayerStore, audio as playerAudio, audioB as playerAudioB } from '../../../store/playerStore'
import { useWindowZStore } from '@ui'
import { audioEngine } from '../../../store/audioEngine'
import { mediaApi } from '../../../api'
import { VisualizerPanel } from './VisualizerPanel'
import { EqualizerPanel } from './EqualizerPanel'
import { QueuePanel, QUEUE_DRAG_TYPE } from './QueuePanel'
import type { PlayerTrack } from '../../../store/playerStore'

// ── Drag-a-track-onto-the-player drop zone ────────────────────────────────────
// Dragging a track from any browse view onto the player adds it to the queue
// (or starts it if nothing is playing). Works on the full window AND the mini
// pill, so the user never has to open the queue panel first.

function useTrackDrop() {
  const [over, setOver] = useState(false)
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(QUEUE_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setOver(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    // Ignore leaves that bubble up from children still inside the zone.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setOver(false)
  }
  const onDrop = (e: React.DragEvent) => {
    const json = e.dataTransfer.getData(QUEUE_DRAG_TYPE)
    setOver(false)
    if (!json) return
    e.preventDefault()
    e.stopPropagation()
    try {
      const track = JSON.parse(json) as PlayerTrack
      const st = usePlayerStore.getState()
      if (!st.currentTrack) st.playTrack(track)
      else st.addToQueue(track)
    } catch { /* ignore malformed payload */ }
  }
  return { over, onDragOver, onDragLeave, onDrop }
}

// ── Sleep timer (module-level so it survives minimise/restore) ─────────────────

const sleep = { at: null as number | null, timer: undefined as ReturnType<typeof setTimeout> | undefined, listeners: new Set<() => void>() }
function setSleep(minutes: number | null) {
  if (sleep.timer) clearTimeout(sleep.timer)
  if (minutes && minutes > 0) {
    sleep.at = Date.now() + minutes * 60_000
    sleep.timer = setTimeout(() => { playerAudio.pause(); setSleep(null) }, minutes * 60_000)
  } else {
    sleep.at = null; sleep.timer = undefined
  }
  sleep.listeners.forEach(l => l())
}
function useSleep() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force(x => x + 1)
    sleep.listeners.add(l)
    const iv = setInterval(l, 1000)
    return () => { sleep.listeners.delete(l); clearInterval(iv) }
  }, [])
  return { at: sleep.at, set: setSleep }
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]
const CROSSFADES = [0, 3, 6, 9, 12]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  const s = Math.floor(secs)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

// ── Cover art ─────────────────────────────────────────────────────────────────

function CoverArt({ url, size = 48 }: { url?: string; size?: number }) {
  const large = size >= 120
  return (
    <div
      className={`relative flex-shrink-0 overflow-hidden flex items-center justify-center ring-1 ring-black/5
                  ${large ? 'rounded-3xl shadow-2xl shadow-black/25' : 'rounded-lg shadow-sm'}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/35 via-primary/15 to-fuchsia-400/10">
          <div className="absolute inset-0 opacity-60"
               style={{ background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,.45), transparent 55%)' }} />
          <Music size={size * 0.32} className="relative text-primary/70" strokeWidth={1.6} />
        </div>
      )}
      {large && <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10" />}
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

  // Smooth, synchronised motion while playing; snap instantly while dragging.
  const motion = isDragging.current ? 'none' : '0.12s linear'

  return (
    <div
      ref={barRef}
      className="relative h-1.5 hover:h-2 rounded-full bg-black/10 dark:bg-white/10 cursor-pointer group transition-[height] duration-150"
      onMouseDown={e => {
        isDragging.current = true
        const t = timeAt(e.clientX)
        setDragPos(t)
        onSeek(t)
        e.stopPropagation()
      }}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-fuchsia-500"
        style={{ width: `${pct}%`, transition: `width ${motion}` }}
      />
      {/* Thumb: fixed-size circle promoted to its own GPU layer (translateZ) so it
          stays perfectly round during playback instead of repainting as an oval. */}
      <div
        className="absolute top-1/2 rounded-full bg-white ring-2 ring-primary shadow-md shadow-primary/40 opacity-0 group-hover:opacity-100"
        style={{
          left: `${pct}%`,
          width: 14,
          height: 14,
          boxSizing: 'border-box',
          transform: 'translate(-50%, -50%) translateZ(0)',
          transition: `left ${motion}, opacity 0.15s`,
          willChange: 'left',
        }}
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

// ── Like / speed / sleep controls ─────────────────────────────────────────────

function LikeButton({ trackId }: { trackId: string }) {
  const qc = useQueryClient()
  const { data: liked = false } = useQuery({
    queryKey: ['media', 'like', trackId],
    queryFn:  () => mediaApi.getTrackLikeStatus(trackId),
  })
  return (
    <button
      onClick={async () => { await mediaApi.toggleLike(trackId); qc.invalidateQueries({ queryKey: ['media', 'like', trackId] }); qc.invalidateQueries({ queryKey: ['media', 'tracks'] }) }}
      title={liked ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={`p-1.5 rounded-lg transition-colors ${liked ? 'text-danger' : 'text-text-tertiary hover:text-danger'}`}
    >
      <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
    </button>
  )
}

function SpeedControl() {
  const rate = usePlayerStore(s => s.playbackRate)
  const setRate = usePlayerStore(s => s.setPlaybackRate)
  const cycle = () => {
    const i = SPEEDS.indexOf(rate)
    setRate(SPEEDS[(i + 1) % SPEEDS.length] ?? 1)
  }
  return (
    <button
      onClick={cycle}
      title="Vitesse de lecture"
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
        rate !== 1 ? 'text-primary bg-primary/10' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-2'
      }`}
    >
      <Gauge size={14} /> {rate}×
    </button>
  )
}

function CrossfadeControl() {
  const secs = usePlayerStore(s => s.crossfadeSecs)
  const setCrossfade = usePlayerStore(s => s.setCrossfade)
  const cycle = () => {
    const i = CROSSFADES.indexOf(secs)
    setCrossfade(CROSSFADES[(i + 1) % CROSSFADES.length] ?? 0)
  }
  return (
    <button
      onClick={cycle}
      title="Fondu enchaîné entre les morceaux"
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
        secs > 0 ? 'text-primary bg-primary/10' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-2'
      }`}
    >
      <Blend size={14} /> {secs > 0 ? `${secs}s` : 'Off'}
    </button>
  )
}

function SleepControl() {
  const { at, set } = useSleep()
  const [open, setOpen] = useState(false)
  const remaining = at ? Math.max(0, Math.ceil((at - Date.now()) / 60_000)) : null
  const options = [15, 30, 45, 60, 90]
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Minuteur de sommeil"
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
          at ? 'text-primary bg-primary/10' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-2'
        }`}
      >
        <Moon size={14} /> {remaining !== null ? `${remaining} min` : ''}
      </button>
      {open && (
        <div
          className="absolute bottom-full mb-1 left-0 z-10 bg-white border border-border rounded-lg shadow-lg py-1 min-w-[140px]"
          onMouseLeave={() => setOpen(false)}
        >
          {options.map(m => (
            <button key={m} onClick={() => { set(m); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-surface-2">
              {m} minutes
            </button>
          ))}
          {at && (
            <button onClick={() => { set(null); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-surface-2 border-t border-border">
              Désactiver
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Lyrics panel ──────────────────────────────────────────────────────────────

/** Parse LRC time-tagged lyrics into a sorted [{time, text}] list, or null. */
function parseLrc(text: string): { time: number; text: string }[] | null {
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g
  const out: { time: number; text: string }[] = []
  for (const line of text.split('\n')) {
    re.lastIndex = 0
    const stamps: number[] = []
    let m: RegExpExecArray | null
    let last = 0
    while ((m = re.exec(line))) {
      stamps.push(+m[1] * 60 + +m[2] + (m[3] ? Number(`0.${m[3]}`) : 0))
      last = re.lastIndex
    }
    if (!stamps.length) continue
    const content = line.slice(last).trim()
    for (const t of stamps) out.push({ time: t, text: content })
  }
  if (!out.length) return null
  out.sort((a, b) => a.time - b.time)
  return out
}

function LyricsPanel() {
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const position     = usePlayerStore(s => s.position)
  const { data, isLoading } = useQuery({
    queryKey: ['media', 'lyrics', currentTrack?.id],
    queryFn:  () => mediaApi.getTrackLyrics(currentTrack!.id),
    enabled:  !!currentTrack && !currentTrack.isRadio,
    staleTime: 5 * 60_000,
  })
  const synced = useMemo(() => (data?.synced && data.lyrics ? parseLrc(data.lyrics) : null), [data])
  const activeIdx = useMemo(() => {
    if (!synced) return -1
    let i = -1
    for (let k = 0; k < synced.length; k++) { if (synced[k].time <= position + 0.15) i = k; else break }
    return i
  }, [synced, position])
  const activeRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [activeIdx])

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{ background: 'radial-gradient(120% 80% at 50% 0%, #1e1b4b 0%, #0b1020 70%)', color: '#fff' }}
    >
      <h3 className="text-sm font-semibold text-white px-3 py-2.5 border-b border-white/10 flex items-center gap-2 shrink-0">
        <Mic2 size={15} className="text-white/60" /> Paroles
      </h3>
      <div className="flex-1 overflow-y-auto px-4 pb-2">
        {currentTrack?.isRadio ? (
          <p className="text-sm text-white/45">Indisponible pour la radio.</p>
        ) : isLoading ? (
          <p className="text-sm text-white/45 animate-pulse">Recherche des paroles…</p>
        ) : !data?.lyrics ? (
          <p className="text-sm text-white/45">Aucune parole trouvée pour ce titre.</p>
        ) : synced ? (
          <div className="space-y-2 py-2">
            {synced.map((l, i) => (
              <p
                key={i}
                ref={i === activeIdx ? activeRef : undefined}
                className={`text-sm leading-snug transition-all duration-300 ${
                  i === activeIdx
                    ? 'text-white font-semibold scale-[1.03] origin-left'
                    : i < activeIdx ? 'text-white/35' : 'text-white/55'
                }`}
              >
                {l.text || '♪'}
              </p>
            ))}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-white/70 leading-relaxed">{data.lyrics}</pre>
        )}
      </div>
      {/* Discreet source credit */}
      {data?.source && data?.lyrics && (
        <div className="shrink-0 px-4 py-1.5 border-t border-white/10 text-[11px] text-white/40 flex items-center gap-1">
          {synced && <span className="text-violet-300">●</span>}
          Source : {data.source}
        </div>
      )}
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
    <div className="flex flex-col items-center gap-5 px-7 pt-8 pb-7 mx-auto" style={{ width: CENTER_W }}>
      {/* Cover art — large, with a gentle breathing scale while playing */}
      <div className={`transition-all duration-700 ease-out ${isPlaying ? 'scale-100' : 'scale-[0.94]'}`}>
        <CoverArt url={currentTrack.coverUrl} size={196} />
      </div>

      {/* Track info */}
      <div className="text-center w-full px-1">
        <p className="text-xl font-bold text-text-primary leading-snug line-clamp-2">{currentTrack.title}</p>
        {currentTrack.artistName && (
          <p className="text-sm font-medium text-text-secondary mt-1 truncate">{currentTrack.artistName}</p>
        )}
        {currentTrack.albumTitle && (
          <p className="text-xs text-text-tertiary mt-0.5 truncate">{currentTrack.albumTitle}</p>
        )}
      </div>

      {/* Progress (or LIVE badge for internet radio) */}
      {currentTrack.isRadio ? (
        <div className="w-full flex items-center justify-center gap-2 py-1">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-danger/10 text-danger text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
            LIVE
          </span>
        </div>
      ) : (
        <div className="w-full">
          <ProgressBar position={position} duration={duration || currentTrack.durationSecs} onSeek={seek} />
          <div className="flex justify-between text-xs text-text-tertiary mt-1">
            <span>{fmt(position)}</span>
            <span>{fmt(duration || currentTrack.durationSecs)}</span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-5">
        <button
          onClick={prev}
          disabled={!hasPrev && position <= 3}
          className="p-2 rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 hover:scale-110 active:scale-95 disabled:opacity-30 transition-all"
        >
          <SkipBack size={22} fill="currentColor" />
        </button>
        <button
          onClick={togglePlay}
          className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-fuchsia-600 text-white flex items-center justify-center
                     shadow-xl shadow-primary/40 hover:shadow-2xl hover:shadow-primary/50 hover:scale-105 active:scale-95 transition-all"
        >
          {isPlaying ? <Pause size={26} fill="white" /> : <Play size={26} fill="white" className="ml-1" />}
        </button>
        <button
          onClick={next}
          disabled={!hasNext}
          className="p-2 rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 hover:scale-110 active:scale-95 disabled:opacity-30 transition-all"
        >
          <SkipForward size={22} fill="currentColor" />
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
        {!currentTrack.isRadio && <LikeButton trackId={currentTrack.id} />}
      </div>

      {/* Volume */}
      <VolumeControl volume={volume} onChange={setVolume} />

      {/* Speed + crossfade + sleep timer */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {!currentTrack.isRadio && <SpeedControl />}
        {!currentTrack.isRadio && <CrossfadeControl />}
        <SleepControl />
      </div>
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

const PANEL_LEFT_W  = 280
const PANEL_RIGHT_W = 280
const PANEL_QUEUE_W = 280
const PANEL_LYRICS_W = 280
const CENTER_W      = 320

function FullPlayer({ onMinimize, onClose }: {
  onMinimize: () => void; onClose: () => void
}) {
  const { currentTrack } = usePlayerStore()
  const [showLeft,   setShowLeft]   = useState(false)
  const [showQueue,  setShowQueue]  = useState(false)
  const [showRight,  setShowRight]  = useState(false)
  const [showLyrics, setShowLyrics] = useState(false)
  const drop = useTrackDrop()

  const totalWidth = CENTER_W
    + (showLeft   ? PANEL_LEFT_W   : 0)
    + (showQueue  ? PANEL_QUEUE_W  : 0)
    + (showRight  ? PANEL_RIGHT_W  : 0)
    + (showLyrics ? PANEL_LYRICS_W : 0)

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
        active={showLyrics}
        onClick={() => setShowLyrics(p => !p)}
        icon={<Mic2 size={15} />}
        title={showLyrics ? 'Masquer les paroles' : 'Afficher les paroles'}
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
      defaultHeight={660}
      minWidth={CENTER_W}
      minHeight={360}
      titleActions={titleActions}
      className="transition-[width] duration-300"
    >
      {/* Four-column layout (also a drop zone: drag a track here to enqueue it) */}
      <div
        className="relative flex h-full overflow-hidden"
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={drop.onDrop}
      >
        {drop.over && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg">
            <span className="px-3 py-1.5 rounded-full bg-primary text-white text-sm font-medium shadow">Déposer pour ajouter à la file</span>
          </div>
        )}
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

        {/* Center — player controls (fills remaining space, content centered).
            overflow-x-hidden: overflow-y:auto otherwise forces overflow-x:auto
            (CSS spec) → a stray horizontal scrollbar at the bottom. */}
        <div className="flex-1 min-w-0 relative overflow-y-auto overflow-x-hidden">
          {/* Immersive blurred-cover backdrop filling the whole center area */}
          <div className="absolute inset-0 -z-10 pointer-events-none">
            {currentTrack?.coverUrl
              ? <img src={currentTrack.coverUrl} alt="" className="w-full h-full object-cover blur-3xl scale-150 opacity-40" />
              : <div className="w-full h-full bg-gradient-to-br from-primary/20 via-fuchsia-400/10 to-transparent" />}
            <div className="absolute inset-0 bg-gradient-to-b from-surface-0/55 via-surface-0/85 to-surface-0" />
          </div>
          <CenterContent />
        </div>

        {/* Lyrics panel */}
        <div
          className="overflow-hidden transition-[width,opacity] duration-300 flex-shrink-0 border-l border-white/10"
          style={{
            width:   showLyrics ? PANEL_LYRICS_W : 0,
            opacity: showLyrics ? 1 : 0,
          }}
        >
          {showLyrics && <LyricsPanel />}
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
  const drop = useTrackDrop()

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
      className={`fixed flex items-center gap-2 pr-2 pl-2 py-2 bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.18)] border select-none cursor-grab active:cursor-grabbing ${drop.over ? 'border-primary ring-2 ring-primary/40' : 'border-border'}`}
      style={{ bottom: 16, right: 16, zIndex: zIdx, maxWidth: 360 }}
      onMouseDown={onMouseDown}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
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

// Connect the engine once at module load time (both crossfade elements so the
// equalizer/visualizer stay applied to whichever track is currently audible).
audioEngine.connect(playerAudio)
audioEngine.connectSecondary(playerAudioB)

export default function MusicPlayer() {
  const { isVisible, isMinimized, minimize, close, currentTrack } = usePlayerStore()

  useEffect(() => {
    audioEngine.resumeIfNeeded()
  }, [isVisible])

  // Global keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    if (!isVisible) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const st = usePlayerStore.getState()
      if (!st.currentTrack) return
      switch (e.code) {
        case 'Space':      e.preventDefault(); st.togglePlay(); break
        case 'ArrowRight': if (!st.currentTrack.isRadio) { e.preventDefault(); st.seek(Math.min(st.duration || st.position + 10, st.position + 10)) } break
        case 'ArrowLeft':  if (!st.currentTrack.isRadio) { e.preventDefault(); st.seek(Math.max(0, st.position - 10)) } break
        case 'ArrowUp':    e.preventDefault(); st.setVolume(Math.min(1, st.volume + 0.05)); break
        case 'ArrowDown':  e.preventDefault(); st.setVolume(Math.max(0, st.volume - 0.05)); break
        case 'KeyM':       st.setVolume(st.volume > 0 ? 0 : 0.8); break
        case 'KeyN':       st.next(); break
        case 'KeyP':       st.prev(); break
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isVisible])

  if (!isVisible || !currentTrack) return null
  if (isMinimized) return <MiniPlayer />

  return <FullPlayer onMinimize={minimize} onClose={close} />
}
