import { create } from 'zustand'

export interface PlayerTrack {
  id:            string
  title:         string
  artistName?:   string
  albumTitle?:   string
  coverUrl?:     string
  durationSecs:  number
  streamUrl?:    string
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

  playTrack:       (track: PlayerTrack, queue?: PlayerTrack[], index?: number) => void
  togglePlay:      () => void
  seek:            (secs: number) => void
  setVolume:       (v: number) => void
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

// ── Singleton audio element ───────────────────────────────────────────────────

export const audio = new Audio()
audio.preload = 'auto'

// ── Session persistence ───────────────────────────────────────────────────────

const SESSION_KEY = 'kubuno:player'

type Snapshot = {
  track:       PlayerTrack
  queue:       PlayerTrack[]
  queueIndex:  number
  position:    number
  volume:      number
  isVisible:   boolean
  isMinimized: boolean
  shuffle:     boolean
  repeatMode:  RepeatMode
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

// Restore audio element src before store creation so it starts buffering early
const _snap = loadSnapshot()
if (_snap?.track) {
  audio.src    = _snap.track.streamUrl ?? `/api/v1/media/audio/${_snap.track.id}/stream`
  audio.volume = _snap.volume ?? 1
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const usePlayerStore = create<PlayerState>((set, get) => {
  // Wire audio events
  audio.addEventListener('timeupdate',     () => get()._setPosition(audio.currentTime))
  audio.addEventListener('durationchange', () => {
    if (isFinite(audio.duration)) get()._setDuration(audio.duration)
  })
  audio.addEventListener('ended', () => get()._onEnded())
  audio.addEventListener('error', () => set({ isPlaying: false }))
  // Keep isPlaying in sync with actual audio state
  audio.addEventListener('play',  () => set({ isPlaying: true  }))
  audio.addEventListener('pause', () => set({ isPlaying: false }))

  // Save state just before the page is unloaded (F5 / tab close)
  window.addEventListener('beforeunload', () => {
    const st = get()
    if (st.currentTrack) {
      saveSnapshot({
        track:       st.currentTrack,
        queue:       st.queue,
        queueIndex:  st.queueIndex,
        position:    st.position,
        volume:      st.volume,
        isVisible:   st.isVisible,
        isMinimized: st.isMinimized,
        shuffle:     st.shuffle,
        repeatMode:  st.repeatMode,
      })
    } else {
      try { sessionStorage.removeItem(SESSION_KEY) } catch {}
    }
  })

  // Restore playback after the store is fully initialised (next tick)
  if (_snap?.track) {
    const savedPos = _snap.position ?? 0
    setTimeout(() => {
      const seekAndPlay = () => {
        if (savedPos > 0) audio.currentTime = savedPos
        audio.play().catch(() => {})
      }
      if (audio.readyState >= 3) {
        seekAndPlay()
      } else {
        audio.addEventListener('canplay', seekAndPlay, { once: true })
      }
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

    playTrack(track, queue = [track], index = 0) {
      const src = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
      audio.src = src
      audio.volume = get().volume
      audio.play().catch(() => {})
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
    },

    togglePlay() {
      if (get().isPlaying) {
        audio.pause()
      } else {
        audio.play().catch(() => {})
      }
    },

    seek(secs) {
      audio.currentTime = secs
      set({ position: secs })
    },

    setVolume(v) {
      audio.volume = v
      set({ volume: v })
    },

    next() {
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
      if (position > 3) {
        audio.currentTime = 0
        set({ position: 0 })
      } else {
        const prevIndex = queueIndex - 1
        if (prevIndex >= 0) {
          get().playTrack(queue[prevIndex], queue, prevIndex)
        } else {
          audio.currentTime = 0
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
      audio.pause()
      audio.src = ''
      try { sessionStorage.removeItem(SESSION_KEY) } catch {}
      set({ isVisible: false, isMinimized: false, isPlaying: false, currentTrack: null, position: 0 })
    },

    _setPosition: (p) => set({ position: p }),
    _setDuration: (d) => set({ duration: d }),
    _onEnded() {
      const { queue, queueIndex, repeatMode, shuffle } = get()
      if (repeatMode === 'one') {
        audio.currentTime = 0
        audio.play().catch(() => {})
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
