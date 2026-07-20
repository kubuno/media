import { useRef, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Film, Download, Play, Pause,
  Volume2, VolumeX, Volume1,
  Maximize2, Minimize2, Maximize, X,
  Repeat, SkipBack, SkipForward, PictureInPicture2,
} from 'lucide-react'
import { FloatingWindow, RangeSlider } from '@ui'
import { filesApi, formatSize, type FileItem } from '@kubuno/drive'
import { useWindowZStore } from '@ui'

// ── Utils ─────────────────────────────────────────────────────────────────────

function fmtTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return '0:00'
  const s = Math.floor(secs)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`
  return `${m}:${r.toString().padStart(2, '0')}`
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

// ── Mini player pill ──────────────────────────────────────────────────────────

interface MiniProps {
  file:      FileItem
  isPlaying: boolean
  onToggle:  () => void
  onRestore: () => void
  onClose:   () => void
}

function MiniPlayer({ file, isPlaying, onToggle, onRestore, onClose }: MiniProps) {
  const { t } = useTranslation('media')
  const [zIdx]   = useState(() => useWindowZStore.getState().next())
  const pillRef  = useRef<HTMLDivElement>(null)
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

  return createPortal(
    <div
      ref={pillRef}
      className="fixed flex items-center gap-2 px-3 py-2 bg-gray-900/95 backdrop-blur
                 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.5)] border border-white/10
                 select-none cursor-grab active:cursor-grabbing"
      style={{ bottom: 16, right: 16, zIndex: zIdx, maxWidth: 340 }}
      onMouseDown={onMouseDown}
    >
      <Film size={16} className="text-blue-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate leading-tight">{file.name}</p>
        <p className="text-xs text-white/50 truncate">{formatSize(file.size_bytes)}</p>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onToggle() }}
        className="w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 text-white
                   flex items-center justify-center transition-colors flex-shrink-0"
      >
        {isPlaying ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" className="ml-px" />}
      </button>
      <button
        onClick={e => { e.stopPropagation(); onRestore() }}
        className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        title={t('media_player_expand')}
      ><Maximize2 size={14} /></button>
      <button
        onClick={e => { e.stopPropagation(); onClose() }}
        className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        title={t('media_player_close')}
      ><X size={14} /></button>
    </div>,
    document.body,
  )
}

// ── Progress bar (seekable, hover tooltip) ────────────────────────────────────

interface ProgressProps {
  current:  number
  duration: number
  onSeek:   (s: number) => void
}

function ProgressBar({ current, duration, onSeek }: ProgressProps) {
  const barRef  = useRef<HTMLDivElement>(null)
  const seeking = useRef(false)
  const [dragPos, setDragPos] = useState<number | null>(null)
  const [hovX, setHovX] = useState<number | null>(null)
  const [hovT, setHovT] = useState(0)

  const timeAt = useCallback((clientX: number) => {
    const bar = barRef.current
    if (!bar || !duration) return 0
    const rect = bar.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }, [duration])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!seeking.current) return
      const t = timeAt(e.clientX)
      setDragPos(t)
      onSeek(t)
    }
    const up = () => { seeking.current = false; setDragPos(null) }
    window.addEventListener('mouseup',   up)
    window.addEventListener('mousemove', move)
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('mousemove', move) }
  }, [timeAt, onSeek])

  const displayPos = dragPos ?? current
  const pct = duration > 0 ? Math.min(100, (displayPos / duration) * 100) : 0

  return (
    <div
      ref={barRef}
      className="relative h-1.5 rounded-full bg-white/25 cursor-pointer group"
      onMouseDown={e => {
        seeking.current = true
        const t = timeAt(e.clientX)
        setDragPos(t)
        onSeek(t)
        e.stopPropagation()
      }}
      onMouseMove={e => {
        const bar = barRef.current
        if (!bar) return
        setHovX(e.clientX - bar.getBoundingClientRect().left)
        setHovT(timeAt(e.clientX))
      }}
      onMouseLeave={() => setHovX(null)}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-blue-400 transition-none" style={{ width: `${pct}%` }} />
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow
                   opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{ left: `${pct}%` }}
      />
      {hovX !== null && (
        <div
          className="absolute bottom-5 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/80 text-white
                     text-[11px] whitespace-nowrap pointer-events-none"
          style={{ left: hovX }}
        >
          {fmtTime(hovT)}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  file:        FileItem
  onClose:     () => void
  srcOverride?: string
  initialPosition?: number
  onInitialPositionConsumed?: () => void
  onTimeUpdate?: (t: number) => void
}

export default function FilesVideoFloatingPlayer({ file, onClose, srcOverride, initialPosition, onInitialPositionConsumed, onTimeUpdate }: Props) {
  const { t } = useTranslation('media')
  const videoRef     = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimer    = useRef<number | undefined>(undefined)
  // Sync ref so handleClose can check fullscreen without stale closure
  const isFullRef    = useRef(false)

  // Playback state
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [currentTime,  setCurrentTime]  = useState(0)
  const [duration,     setDuration]     = useState(0)
  const [volume,       setVolume]       = useState(1)
  const [isMuted,      setIsMuted]      = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isLooping,    setIsLooping]    = useState(false)

  // UI state
  const [isMinimized,   setIsMinimized]   = useState(false)
  const [showControls,  setShowControls]  = useState(true)
  const [isFullscreen,  setIsFullscreen]  = useState(false)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)

  // ── Wire video events ──────────────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const onPlay  = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onTime  = () => {
      setCurrentTime(v.currentTime)
      onTimeUpdate?.(v.currentTime)
    }
    const onDur   = () => { if (isFinite(v.duration)) setDuration(v.duration) }
    const onVol   = () => { setVolume(v.volume); setIsMuted(v.muted) }
    const onEnded = () => { if (!v.loop) setIsPlaying(false) }
    const onFs    = () => {
      const fs = !!document.fullscreenElement
      isFullRef.current = fs
      setIsFullscreen(fs)
    }

    v.addEventListener('play',           onPlay)
    v.addEventListener('pause',          onPause)
    v.addEventListener('timeupdate',     onTime)
    v.addEventListener('durationchange', onDur)
    v.addEventListener('volumechange',   onVol)
    v.addEventListener('ended',          onEnded)
    document.addEventListener('fullscreenchange', onFs)

    // Restore position on first load
    if (initialPosition && initialPosition > 0) {
      const seekOnReady = () => {
        v.currentTime = initialPosition
        onInitialPositionConsumed?.()
        v.removeEventListener('canplay', seekOnReady)
      }
      if (v.readyState >= 3) {
        v.currentTime = initialPosition
        onInitialPositionConsumed?.()
      } else {
        v.addEventListener('canplay', seekOnReady)
      }
    }

    return () => {
      v.removeEventListener('play',           onPlay)
      v.removeEventListener('pause',          onPause)
      v.removeEventListener('timeupdate',     onTime)
      v.removeEventListener('durationchange', onDur)
      v.removeEventListener('volumechange',   onVol)
      v.removeEventListener('ended',          onEnded)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [])

  useEffect(() => () => clearTimeout(hideTimer.current), [])

  // ── Auto-hide controls (3 s after last mouse movement while playing) ────────

  const revealControls = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false)
        setShowSpeedMenu(false)
      }
    }, 3000)
  }, [])

  // ── Playback actions ───────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [])

  const seek = useCallback((secs: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, secs))
    setCurrentTime(v.currentTime)
  }, [])

  const changeVolume = useCallback((val: number) => {
    const v = videoRef.current
    if (!v) return
    v.volume = Math.max(0, Math.min(1, val))
    if (v.muted) v.muted = false
  }, [])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
  }, [])

  const changeRate = useCallback((r: number) => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = r
    setPlaybackRate(r)
    setShowSpeedMenu(false)
  }, [])

  const toggleLoop = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.loop = !v.loop
    setIsLooping(v.loop)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    if (!document.fullscreenElement) await el.requestFullscreen().catch(() => {})
    else                              await document.exitFullscreen().catch(() => {})
  }, [])

  const togglePiP = useCallback(async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else                                   await v.requestPictureInPicture()
    } catch { /* PiP non supporté */ }
  }, [])

  // Guard: when Escape exits fullscreen, don't also close the player
  const handleClose = useCallback(() => {
    if (isFullRef.current) return
    onClose()
  }, [onClose])

  // ── Keyboard shortcuts (when container is focused) ─────────────────────────

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return
    switch (e.key) {
      case ' ':
      case 'k': e.preventDefault(); revealControls(); togglePlay(); break
      case 'ArrowLeft':  e.preventDefault(); revealControls(); seek(currentTime - 10); break
      case 'ArrowRight': e.preventDefault(); revealControls(); seek(currentTime + 10); break
      case 'ArrowUp':    e.preventDefault(); changeVolume(volume + 0.1); break
      case 'ArrowDown':  e.preventDefault(); changeVolume(volume - 0.1); break
      case 'm': case 'M': e.preventDefault(); toggleMute(); break
      case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break
      case 'l': case 'L': e.preventDefault(); toggleLoop(); break
    }
  }, [revealControls, togglePlay, seek, currentTime, changeVolume, volume, toggleMute, toggleFullscreen, toggleLoop])

  // ── Derived ────────────────────────────────────────────────────────────────

  const volIcon = (isMuted || volume === 0)
    ? <VolumeX size={15} />
    : volume < 0.5
    ? <Volume1 size={15} />
    : <Volume2 size={15} />

  // ── Render ─────────────────────────────────────────────────────────────────
  //
  // The FloatingWindow is always mounted (even in mini mode) so the video element
  // stays in the DOM and keeps playing. In mini mode the window is invisible and
  // non-interactive; only the draggable pill is shown.

  return (
    <>
      <FloatingWindow
        title={file.name}
        icon={<Film size={15} className="text-blue-500" />}
        onClose={handleClose}
        defaultWidth={720}
        defaultHeight={480}
        minWidth={400}
        minHeight={300}
        resizable
        className={isMinimized ? 'opacity-0 pointer-events-none' : ''}
        titleActions={
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
            title={t('media_player_minimize')}
          >
            <Minimize2 size={15} />
          </button>
        }
      >
        {/* Outer container: handles keyboard shortcuts, auto-hide, fullscreen */}
        <div
          ref={containerRef}
          className="flex flex-col h-full bg-black select-none focus:outline-none"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseMove={revealControls}
          onClick={() => containerRef.current?.focus()}
          style={{ cursor: showControls ? 'default' : 'none' }}
        >
          {/* Video area: click = play/pause, dblclick = fullscreen */}
          <div
            className="flex-1 relative flex items-center justify-center overflow-hidden"
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
          >
            <video
              ref={videoRef}
              src={srcOverride ?? filesApi.downloadUrl(file.id)}
              autoPlay
              className="max-w-full max-h-full pointer-events-none"
            />

            {/* Controls overlay — auto-hides after 3 s of inactivity */}
            <div
              className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40
                          to-transparent px-3 pt-8 pb-3 transition-opacity duration-300
                          ${showControls ? 'opacity-100' : 'opacity-0'}`}
              onClick={e => e.stopPropagation()}
              onMouseMove={e => e.stopPropagation()}
            >
              {/* ── Progress bar ── */}
              <ProgressBar current={currentTime} duration={duration} onSeek={seek} />

              {/* ── Controls row ── */}
              <div className="flex items-center gap-1 mt-2.5">
                {/* Play / Pause */}
                <button
                  onClick={togglePlay}
                  className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 text-white
                             flex items-center justify-center transition-colors flex-shrink-0"
                  title={isPlaying ? t('media_player_pause') : t('media_player_play')}
                >
                  {isPlaying
                    ? <Pause size={15} fill="white" />
                    : <Play  size={15} fill="white" className="ml-0.5" />
                  }
                </button>

                {/* Skip −10 s */}
                <button
                  onClick={() => seek(currentTime - 10)}
                  className="p-1.5 text-white/75 hover:text-white transition-colors flex-shrink-0"
                  title={t('media_player_rewind_10')}
                ><SkipBack size={14} /></button>

                {/* Skip +10 s */}
                <button
                  onClick={() => seek(currentTime + 10)}
                  className="p-1.5 text-white/75 hover:text-white transition-colors flex-shrink-0"
                  title={t('media_player_forward_10')}
                ><SkipForward size={14} /></button>

                {/* Time display */}
                <span className="text-white/70 text-xs tabular-nums flex-shrink-0 ml-1 mr-1">
                  {fmtTime(currentTime)} / {fmtTime(duration)}
                </span>

                <div className="flex-1" />

                {/* Volume mute button */}
                <button
                  onClick={toggleMute}
                  className="p-1.5 text-white/75 hover:text-white transition-colors flex-shrink-0"
                  title={t('media_player_mute')}
                >{volIcon}</button>

                {/* Volume slider */}
                <RangeSlider
                  min={0} max={1} step={0.02}
                  value={isMuted ? 0 : volume}
                  onChange={changeVolume}
                  accent="#ffffff" trackColor="rgba(255,255,255,0.25)"
                  className="flex-shrink-0" style={{ width: 72 }}
                  aria-label={t('media_player_volume')}
                />

                {/* Loop */}
                <button
                  onClick={toggleLoop}
                  className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                    isLooping ? 'text-blue-400' : 'text-white/55 hover:text-white'
                  }`}
                  title={t('media_player_loop')}
                ><Repeat size={14} /></button>

                {/* Picture-in-Picture */}
                {'pictureInPictureEnabled' in document && (
                  <button
                    onClick={togglePiP}
                    className="p-1.5 text-white/55 hover:text-white transition-colors flex-shrink-0"
                    title={t('media_player_pip')}
                  ><PictureInPicture2 size={14} /></button>
                )}

                {/* Playback speed */}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); setShowSpeedMenu(v => !v) }}
                    className="px-1.5 py-1 text-[11px] font-medium text-white/65 hover:text-white
                               hover:bg-white/10 rounded transition-colors tabular-nums"
                    title={t('media_player_speed')}
                  >
                    {playbackRate === 1 ? '1×' : `${playbackRate}×`}
                  </button>
                  {showSpeedMenu && (
                    <div className="absolute bottom-8 right-0 bg-gray-900 border border-white/10 rounded-xl
                                    overflow-hidden shadow-xl z-10 py-1 min-w-[108px]">
                      {SPEEDS.map(s => (
                        <button
                          key={s}
                          onClick={e => { e.stopPropagation(); changeRate(s) }}
                          className={`block w-full px-4 py-1.5 text-xs text-left transition-colors ${
                            playbackRate === s
                              ? 'bg-blue-500/25 text-blue-300'
                              : 'text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {s === 1 ? t('media_player_speed_normal') : `${s}×`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Download */}
                <a
                  href={srcOverride ?? filesApi.downloadUrl(file.id)}
                  download={file.name}
                  className="p-1.5 text-white/55 hover:text-white transition-colors flex-shrink-0"
                  title={t('media_player_download')}
                  onClick={e => e.stopPropagation()}
                ><Download size={14} /></a>

                {/* Fullscreen */}
                <button
                  onClick={toggleFullscreen}
                  className="p-1.5 text-white/55 hover:text-white transition-colors flex-shrink-0"
                  title={isFullscreen ? t('media_player_fullscreen_exit') : t('media_player_fullscreen')}
                >
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </FloatingWindow>

      {/* Mini player pill — shown while window is hidden */}
      {isMinimized && (
        <MiniPlayer
          file={file}
          isPlaying={isPlaying}
          onToggle={togglePlay}
          onRestore={() => setIsMinimized(false)}
          onClose={handleClose}
        />
      )}
    </>
  )
}
