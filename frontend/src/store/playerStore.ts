import { create } from 'zustand'
import { registerMediaActivitySource } from './mediaActivity'

export interface PlayerTrack {
  id:            string
  title:         string
  artistName?:   string
  albumTitle?:   string
  coverUrl?:     string
  durationSecs:  number
  streamUrl?:    string
  /** Live internet radio: no seek/duration, shows a LIVE badge. */
  isRadio?:      boolean
}

export type RepeatMode = 'none' | 'all' | 'one'

interface PlayerState {
  currentTrack:  PlayerTrack | null
  queue:         PlayerTrack[]
  queueIndex:    number
  isPlaying:     boolean
  position:      number
  duration:      number
  volume:        number
  isVisible:     boolean
  isMinimized:   boolean
  shuffle:       boolean
  repeatMode:    RepeatMode
  playbackRate:  number
  /** Crossfade duration in seconds (0 = off). */
  crossfadeSecs: number
  /** Auto-mix: crossfade automatically near the end of a track. */
  autoCrossfade: boolean

  playTrack:       (track: PlayerTrack, queue?: PlayerTrack[], index?: number) => void
  togglePlay:      () => void
  seek:            (secs: number) => void
  setVolume:       (v: number) => void
  setPlaybackRate: (r: number) => void
  setCrossfade:    (secs: number) => void
  setAutoCrossfade:(v: boolean) => void
  next:            () => void
  prev:            () => void
  toggleShuffle:   () => void
  cycleRepeat:     () => void
  minimize:        () => void
  restore:         () => void
  close:           () => void

  addToQueue:      (track: PlayerTrack) => void
  insertNext:      (track: PlayerTrack) => void
  addTracksToQueue:(tracks: PlayerTrack[]) => void
  removeFromQueue: (index: number) => void
  moveInQueue:     (from: number, to: number) => void
  clearQueue:      () => void

  _setPosition: (p: number) => void
  _setDuration: (d: number) => void
  _onEnded:     () => void
}

// ── Dual audio elements (A primary, B for crossfade) ──────────────────────────
// Two elements let one track fade out while the next fades in. `audio` keeps its
// historical name (== element A) for backward-compatible imports.

export const audio  = new Audio()
export const audioB = new Audio()
audio.preload  = 'auto'
audioB.preload = 'auto'

/** Currently audible element. Swaps to the other one after each crossfade. */
let activeEl: HTMLAudioElement = audio
const inactiveEl = (): HTMLAudioElement => (activeEl === audio ? audioB : audio)

// ── Crossfade controller (module-level, isolated from React) ──────────────────

const xf = {
  active:   false,
  outgoing: null as HTMLAudioElement | null,
  incoming: null as HTMLAudioElement | null,
  // Target the crossfade resolves to (works for auto-advance AND manual switches).
  track:    null as PlayerTrack | null,
  queue:    null as PlayerTrack[] | null,
  index:    -1,
  raf: 0,
}
function stopXfRamp() { if (xf.raf) cancelAnimationFrame(xf.raf); xf.raf = 0 }
/** Abort an in-flight crossfade (e.g. user picked another track / seeked). */
function cancelCrossfade() {
  if (!xf.active) return
  stopXfRamp()
  if (xf.incoming) { try { xf.incoming.pause() } catch { /* ignore */ } xf.incoming.src = ''; xf.incoming.volume = 0 }
  xf.active = false; xf.outgoing = null; xf.incoming = null; xf.track = null; xf.queue = null; xf.index = -1
}

// ── Session persistence ───────────────────────────────────────────────────────

const SESSION_KEY = 'kubuno:player'

type Snapshot = {
  track:        PlayerTrack
  queue:        PlayerTrack[]
  queueIndex:   number
  position:     number
  volume:       number
  isVisible:    boolean
  isMinimized:  boolean
  shuffle:      boolean
  repeatMode:   RepeatMode
  /** Was playback active when the snapshot was taken? Drives auto-resume. */
  wasPlaying?:   boolean
  playbackRate?: number
  crossfadeSecs?: number
  autoCrossfade?: boolean
}

function loadSnapshot(): Snapshot | null {
  try {
    const s = sessionStorage.getItem(SESSION_KEY)
    return s ? (JSON.parse(s) as Snapshot) : null
  } catch { return null }
}

function saveSnapshot(snap: Snapshot) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(snap)) } catch {}
}

// Restore audio element src before store creation so it starts buffering early.
const _snap = loadSnapshot()
if (_snap?.track) {
  audio.src          = _snap.track.streamUrl ?? `/api/v1/media/audio/${_snap.track.id}/stream`
  audio.volume       = _snap.volume ?? 1
  audio.playbackRate = _snap.playbackRate ?? 1
  // Kick off loading immediately so metadata/duration are ready for the seek.
  audio.load()
}

/** If autoplay is blocked (no user gesture after reload), resume on the first
 *  user interaction anywhere on the page — a one-shot, self-removing listener. */
function armResumeOnGesture() {
  const resume = () => {
    activeEl.play().catch(() => {})
    window.removeEventListener('pointerdown', resume)
    window.removeEventListener('keydown', resume)
  }
  window.addEventListener('pointerdown', resume, { once: true })
  window.addEventListener('keydown', resume, { once: true })
}

// Assigned once the store is created; lets actions persist after state changes.
let _persist: () => void = () => {}
let _lastPosSave = 0

// ── Store ─────────────────────────────────────────────────────────────────────

export const usePlayerStore = create<PlayerState>((set, get) => {
  // ── Crossfade helpers (need get/set; defined inside the closure) ──
  const computeNextIndex = (): number => {
    const { queue, queueIndex, shuffle, repeatMode } = get()
    if (queue.length === 0) return -1
    if (shuffle) {
      if (queue.length === 1) return repeatMode === 'all' ? 0 : -1
      let i: number
      do { i = Math.floor(Math.random() * queue.length) } while (i === queueIndex)
      return i
    }
    const n = queueIndex + 1
    if (n < queue.length) return n
    return repeatMode === 'all' ? 0 : -1
  }

  const finalizeCrossfade = () => {
    if (!xf.active) return
    stopXfRamp()
    const out = xf.outgoing!, inc = xf.incoming!
    const { track, queue, index } = xf
    const st  = get()
    activeEl = inc
    inc.volume = st.volume
    try { out.pause() } catch { /* ignore */ }
    out.src = ''
    out.volume = st.volume
    xf.active = false; xf.outgoing = null; xf.incoming = null; xf.track = null; xf.queue = null; xf.index = -1
    set({
      currentTrack: track ?? st.currentTrack,
      queue:        queue ?? st.queue,
      queueIndex:   index,
      isPlaying:    true,
      position:     inc.currentTime,
      duration:     track?.durationSecs ?? (isFinite(inc.duration) ? inc.duration : 0),
    })
    _persist()
  }

  /** Generic crossfade to an explicit track — used for BOTH automatic
   *  end-of-track transitions and manual switches (next/prev/track click).
   *  Time-based ramp (performance.now) so it works mid-track, not just near the end.
   *  Chains cleanly when called mid-fade (rapid browsing): the audible incoming
   *  becomes the new outgoing AT ITS CURRENT VOLUME (no jump), the old outgoing is
   *  freed for the new track. */
  const crossfadeTo = (track: PlayerTrack, queue: PlayerTrack[], index: number, fadeSecs: number) => {
    const st = get()
    let out: HTMLAudioElement
    let inc: HTMLAudioElement
    let outStartVol: number
    if (xf.active && xf.incoming && xf.outgoing) {
      stopXfRamp()
      try { xf.outgoing.pause() } catch { /* ignore */ }
      xf.outgoing.src = ''
      activeEl    = xf.incoming          // the now-dominant audio becomes active
      out         = xf.incoming
      inc         = xf.outgoing          // reuse the freed element for the new track
      outStartVol = out.volume           // continue from current volume → no blip
      if (xf.track) set({ currentTrack: xf.track, queue: xf.queue ?? st.queue, queueIndex: xf.index })
    } else {
      out         = activeEl
      inc         = inactiveEl()
      outStartVol = st.volume
    }
    inc.src          = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
    inc.playbackRate = st.playbackRate
    inc.volume       = 0
    try { inc.currentTime = 0 } catch { /* ignore */ }
    inc.play().catch(() => {})
    xf.active = true; xf.outgoing = out; xf.incoming = inc; xf.track = track; xf.queue = queue; xf.index = index
    set({ isVisible: true })
    const t0 = performance.now()
    const ramp = () => {
      if (!xf.active) return
      const vol = get().volume
      const p = Math.max(0, Math.min(1, (performance.now() - t0) / (fadeSecs * 1000)))
      // Equal-power crossfade → constant perceived loudness through the blend.
      out.volume = Math.cos(p * Math.PI / 2) * outStartVol
      inc.volume = Math.sin(p * Math.PI / 2) * vol
      // Finish on time, or early if the outgoing track reaches its natural end.
      if (p >= 1 || (isFinite(out.duration) && out.currentTime >= out.duration - 0.05)) {
        finalizeCrossfade()
        return
      }
      xf.raf = requestAnimationFrame(ramp)
    }
    xf.raf = requestAnimationFrame(ramp)
  }

  // Auto end-of-track transition (queue unchanged).
  const beginCrossfade = (nextIndex: number, fadeSecs: number) => {
    const q = get().queue
    if (!q[nextIndex]) return
    crossfadeTo(q[nextIndex], q, nextIndex, fadeSecs)
  }

  // Abrupt load (no fade) — used when nothing is playing, crossfade is off, or the
  // previous track already ended (auto-advance) so there's no audio to blend.
  const loadAndPlay = (track: PlayerTrack, queue: PlayerTrack[], index: number) => {
    cancelCrossfade()
    const el = activeEl
    el.src          = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
    el.volume       = get().volume
    el.playbackRate = get().playbackRate
    el.play().catch(() => {})
    set({
      currentTrack: track,
      queue,
      queueIndex: index,
      isPlaying: true,
      position: 0,
      duration: track.durationSecs,
      isVisible: true,
      isMinimized: get().isMinimized,
    })
    _persist()
  }

  const maybeStartCrossfade = (el: HTMLAudioElement) => {
    if (xf.active) return
    const st = get()
    if (st.crossfadeSecs <= 0 || !st.autoCrossfade) return
    if (!st.currentTrack || st.currentTrack.isRadio) return
    if (st.repeatMode === 'one') return
    const dur = el.duration
    if (!isFinite(dur) || dur <= 0) return
    const remaining = dur - el.currentTime
    if (remaining > st.crossfadeSecs || remaining <= 0.08) return
    const nextIndex = computeNextIndex()
    if (nextIndex < 0) return
    beginCrossfade(nextIndex, Math.min(st.crossfadeSecs, dur / 2))
  }

  // ── Wire events on BOTH elements; UI only follows the active one ──
  const onEnded = (el: HTMLAudioElement) => {
    if (xf.active && el === xf.outgoing) { finalizeCrossfade(); return }
    if (el !== activeEl) return
    get()._onEnded()
  }
  const wire = (el: HTMLAudioElement) => {
    el.addEventListener('timeupdate', () => {
      if (el !== activeEl) return
      get()._setPosition(el.currentTime)
      maybeStartCrossfade(el)
    })
    el.addEventListener('durationchange', () => {
      if (el === activeEl && isFinite(el.duration)) get()._setDuration(el.duration)
    })
    el.addEventListener('ended', () => onEnded(el))
    el.addEventListener('error', () => { if (el === activeEl) set({ isPlaying: false }) })
    el.addEventListener('play',  () => { if (el === activeEl) { set({ isPlaying: true  }); _persist() } })
    el.addEventListener('pause', () => { if (el === activeEl && !xf.active) { set({ isPlaying: false }); _persist() } })
  }
  wire(audio)
  wire(audioB)

  // Persist the full playback state. Called on every meaningful change (not just
  // `beforeunload`, which is unreliable on mobile / forced reloads) so the saved
  // position stays fresh and F5 resumes accurately.
  const persist = () => {
    const st = get()
    if (st.currentTrack) {
      saveSnapshot({
        track:         st.currentTrack,
        queue:         st.queue,
        queueIndex:    st.queueIndex,
        position:      st.position,
        volume:        st.volume,
        isVisible:     st.isVisible,
        isMinimized:   st.isMinimized,
        shuffle:       st.shuffle,
        repeatMode:    st.repeatMode,
        wasPlaying:    st.isPlaying,
        playbackRate:  st.playbackRate,
        crossfadeSecs: st.crossfadeSecs,
        autoCrossfade: st.autoCrossfade,
      })
    } else {
      try { sessionStorage.removeItem(SESSION_KEY) } catch {}
    }
  }
  window.addEventListener('beforeunload', persist)
  // Also persist whenever the tab is hidden (covers mobile / tab-close where
  // `beforeunload` may not fire).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist() })
  _persist = persist

  // Restore playback after the store is fully initialised (next tick).
  if (_snap?.track) {
    const savedPos   = _snap.position ?? 0
    const wasRadio   = _snap.track.isRadio === true
    const wasPlaying = _snap.wasPlaying !== false   // default to resuming for legacy snapshots
    setTimeout(() => {
      const restorePos = () => {
        if (savedPos > 0 && !wasRadio) {
          try { audio.currentTime = savedPos } catch { /* not yet seekable */ }
        }
      }
      if (audio.readyState >= 1) restorePos()
      else audio.addEventListener('loadedmetadata', restorePos, { once: true })

      if (!wasPlaying) return
      const tryPlay = () => { audio.play().catch(() => armResumeOnGesture()) }
      if (audio.readyState >= 3) tryPlay()
      else audio.addEventListener('canplay', tryPlay, { once: true })
    }, 0)
  }

  return {
    currentTrack: _snap?.track      ?? null,
    queue:        _snap?.queue      ?? [],
    queueIndex:   _snap?.queueIndex ?? 0,
    isPlaying:    false,
    position:     _snap?.position   ?? 0,
    duration:     _snap?.track?.durationSecs ?? 0,
    volume:       _snap?.volume     ?? 1,
    isVisible:    !!_snap?.track,
    isMinimized:  _snap?.isMinimized ?? false,
    shuffle:      _snap?.shuffle    ?? false,
    repeatMode:   _snap?.repeatMode ?? 'none',
    playbackRate: _snap?.playbackRate ?? 1,
    crossfadeSecs: _snap?.crossfadeSecs ?? 6,
    autoCrossfade: _snap?.autoCrossfade ?? true,

    playTrack(track, queue = [track], index = 0) {
      const st = get()
      // Smooth (crossfade) whenever a different audio is already playing — works
      // for music↔music, music↔radio and radio↔radio (volume blend between the
      // two elements; no seeking involved, so live radio is fine). Falls back to
      // an instant load only when nothing is playing or crossfade is disabled.
      const canFade =
        st.crossfadeSecs > 0 && !!st.currentTrack && st.isPlaying &&
        st.currentTrack.id !== track.id &&
        activeEl.currentTime < (isFinite(activeEl.duration) ? activeEl.duration - 0.3 : Number.POSITIVE_INFINITY)
      if (canFade) {
        crossfadeTo(track, queue, index, Math.min(st.crossfadeSecs, 1.8))
        return
      }
      loadAndPlay(track, queue, index)
    },

    setPlaybackRate(r) {
      const rate = Math.max(0.25, Math.min(4, r))
      audio.playbackRate = rate
      audioB.playbackRate = rate
      set({ playbackRate: rate })
      _persist()
    },

    setCrossfade(secs) {
      set({ crossfadeSecs: Math.max(0, Math.min(12, secs)) })
      _persist()
    },

    setAutoCrossfade(v) {
      set({ autoCrossfade: v })
      _persist()
    },

    togglePlay() {
      if (get().isPlaying) {
        activeEl.pause()
        if (xf.active && xf.incoming) { try { xf.incoming.pause() } catch { /* ignore */ } }
      } else {
        activeEl.play().catch(() => {})
        if (xf.active && xf.incoming) { xf.incoming.play().catch(() => {}) }
      }
    },

    seek(secs) {
      cancelCrossfade()
      activeEl.currentTime = secs
      set({ position: secs })
    },

    setVolume(v) {
      if (!xf.active) activeEl.volume = v
      set({ volume: v })
    },

    next() {
      // No cancelCrossfade here: playTrack finalizes any in-flight fade then
      // starts a fresh one, keeping rapid skips smooth.
      const { queue, queueIndex, shuffle } = get()
      if (queue.length === 0) return
      let nextIndex: number
      if (shuffle) {
        do { nextIndex = Math.floor(Math.random() * queue.length) }
        while (queue.length > 1 && nextIndex === queueIndex)
      } else {
        nextIndex = queueIndex + 1
        if (nextIndex >= queue.length) return
      }
      get().playTrack(queue[nextIndex], queue, nextIndex)
    },

    prev() {
      const { queue, queueIndex, position } = get()
      if (position > 3 && !xf.active) {
        activeEl.currentTime = 0
        set({ position: 0 })
      } else {
        const prevIndex = queueIndex - 1
        if (prevIndex >= 0) {
          get().playTrack(queue[prevIndex], queue, prevIndex)
        } else {
          activeEl.currentTime = 0
          set({ position: 0 })
        }
      }
    },

    toggleShuffle() { set(s => ({ shuffle: !s.shuffle })) },
    cycleRepeat()   { set(s => ({ repeatMode: s.repeatMode === 'none' ? 'all' : s.repeatMode === 'all' ? 'one' : 'none' })) },

    addToQueue(track) {
      set(s => ({ queue: [...s.queue, track] }))
    },
    insertNext(track) {
      set(s => {
        const q = [...s.queue]
        q.splice(s.queueIndex + 1, 0, track)
        return { queue: q }
      })
    },
    addTracksToQueue(tracks) {
      set(s => ({ queue: [...s.queue, ...tracks] }))
    },
    removeFromQueue(index) {
      set(s => {
        if (index === s.queueIndex) return s
        const q = s.queue.filter((_, i) => i !== index)
        return { queue: q, queueIndex: index < s.queueIndex ? s.queueIndex - 1 : s.queueIndex }
      })
    },
    moveInQueue(from, to) {
      if (from === to) return
      set(s => {
        const q = [...s.queue]
        const [item] = q.splice(from, 1)
        q.splice(to, 0, item)
        let idx = s.queueIndex
        if (from === idx) idx = to
        else if (from < idx && to >= idx) idx--
        else if (from > idx && to <= idx) idx++
        return { queue: q, queueIndex: idx }
      })
    },
    clearQueue() {
      const { queue, queueIndex } = get()
      const current = queue[queueIndex]
      if (!current) return
      set({ queue: [current], queueIndex: 0 })
    },

    minimize() { set({ isMinimized: true }) },
    restore()  { set({ isMinimized: false }) },
    close() {
      cancelCrossfade()
      audio.pause();  audio.src  = ''
      audioB.pause(); audioB.src = ''
      activeEl = audio
      try { sessionStorage.removeItem(SESSION_KEY) } catch {}
      set({ isVisible: false, isMinimized: false, isPlaying: false, currentTrack: null, position: 0 })
    },

    _setPosition: (p) => {
      set({ position: p })
      // Throttle persistence to ~once every 5s so the saved position stays fresh
      // (cheap: sessionStorage write) without thrashing on every timeupdate.
      const now = performance.now()
      if (now - _lastPosSave > 5000) { _lastPosSave = now; _persist() }
    },
    _setDuration: (d) => set({ duration: d }),
    _onEnded() {
      const { queue, queueIndex, repeatMode, shuffle } = get()
      if (repeatMode === 'one') {
        activeEl.currentTime = 0
        activeEl.play().catch(() => {})
        return
      }
      if (shuffle) {
        const nextIndex = queue.length > 1
          ? (() => { let i; do { i = Math.floor(Math.random() * queue.length) } while (i === queueIndex); return i })()
          : 0
        get().playTrack(queue[nextIndex], queue, nextIndex)
        return
      }
      const nextIndex = queueIndex + 1
      if (nextIndex < queue.length) {
        get().playTrack(queue[nextIndex], queue, nextIndex)
      } else if (repeatMode === 'all' && queue.length > 0) {
        get().playTrack(queue[0], queue, 0)
      } else {
        set({ isPlaying: false, position: 0 })
      }
    },
  }
})

// Session keep-awake during playback (music/radio): our audio elements live
// off-DOM, so we register with the media-activity ping.
registerMediaActivitySource(() => usePlayerStore.getState().isPlaying)
