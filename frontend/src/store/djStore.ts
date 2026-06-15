import { create } from 'zustand'
import type { PlayerTrack } from './playerStore'

// ── Hot cue palette ───────────────────────────────────────────────────────────

export const HOT_CUE_COLORS = [
  '#ff2244', '#ff8800', '#ffee00', '#00ff88',
  '#00ccff', '#4477ff', '#cc44ff', '#ff44cc',
] as const

// ── Per-deck audio engine ─────────────────────────────────────────────────────

const EQ_FREQ = { low: 200, mid: 1000, high: 8000 } as const

export class DJDeckEngine {
  readonly audio: HTMLAudioElement
  analyser:       AnalyserNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private eqLow:  BiquadFilterNode | null = null
  private eqMid:  BiquadFilterNode | null = null
  private eqHigh: BiquadFilterNode | null = null
  private gainNode: GainNode | null = null
  private outputGainNode: GainNode | null = null
  private connected = false

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.crossOrigin = 'anonymous'
  }

  init(ctx: AudioContext, destination: AudioNode) {
    if (this.connected) return
    try {
      this.source = ctx.createMediaElementSource(this.audio)
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.8

      this.eqLow = ctx.createBiquadFilter()
      this.eqLow.type = 'lowshelf'
      this.eqLow.frequency.value = EQ_FREQ.low
      this.eqLow.gain.value = 0

      this.eqMid = ctx.createBiquadFilter()
      this.eqMid.type = 'peaking'
      this.eqMid.frequency.value = EQ_FREQ.mid
      this.eqMid.Q.value = 1.0
      this.eqMid.gain.value = 0

      this.eqHigh = ctx.createBiquadFilter()
      this.eqHigh.type = 'highshelf'
      this.eqHigh.frequency.value = EQ_FREQ.high
      this.eqHigh.gain.value = 0

      this.gainNode = ctx.createGain()
      this.gainNode.gain.value = 1

      this.outputGainNode = ctx.createGain()
      this.outputGainNode.gain.value = 1

      this.source.connect(this.analyser)
      this.analyser.connect(this.eqLow)
      this.eqLow.connect(this.eqMid)
      this.eqMid.connect(this.eqHigh)
      this.eqHigh.connect(this.gainNode)
      this.gainNode.connect(this.outputGainNode)
      this.outputGainNode.connect(destination)

      this.connected = true
    } catch (e) {
      console.warn('DJDeckEngine init failed:', e)
    }
  }

  setEq(band: 'low' | 'mid' | 'high', db: number) {
    const node = band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh
    if (node) node.gain.value = Math.max(-12, Math.min(6, db))
  }

  setGain(v: number) {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(2, v))
  }

  setCrossfadeVolume(v: number) {
    if (this.outputGainNode) this.outputGainNode.gain.value = Math.max(0, Math.min(1, v))
  }
}

// ── Singleton engines + shared AudioContext ───────────────────────────────────

export const djEngineA = new DJDeckEngine()
export const djEngineB = new DJDeckEngine()

let _djCtx:    AudioContext | null = null
let _djMaster: GainNode     | null = null

function initDJContext() {
  if (_djCtx) {
    if (_djCtx.state === 'suspended') _djCtx.resume()
    return
  }
  _djCtx = new AudioContext()
  _djMaster = _djCtx.createGain()
  _djMaster.gain.value = 0.8
  _djMaster.connect(_djCtx.destination)
  djEngineA.init(_djCtx, _djMaster)
  djEngineB.init(_djCtx, _djMaster)
  _djCtx.resume()
}

// Equal-power crossfader: cf -1 = full A, 0 = equal, +1 = full B
function applyCrossfader(cf: number) {
  const pos   = (cf + 1) / 2
  djEngineA.setCrossfadeVolume(Math.cos(pos * (Math.PI / 2)))
  djEngineB.setCrossfadeVolume(Math.cos((1 - pos) * (Math.PI / 2)))
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HotCue {
  position: number
  color:    string
}

export interface DeckState {
  track:      PlayerTrack | null
  isPlaying:  boolean
  isLoading:  boolean
  position:   number
  duration:   number
  pitch:      number          // semitones -8..+8
  eqLow:      number          // dB -12..+6
  eqMid:      number
  eqHigh:     number
  gain:       number          // 0..2
  volume:     number          // 0..1
  isLooping:  boolean
  loopIn:     number | null
  loopOut:    number | null
  hotCues:    (HotCue | null)[]   // 8 slots
  cuePoint:   number
  queue:      PlayerTrack[]
  queueIndex: number          // -1 = no active queue
}

const DEFAULT_DECK: DeckState = {
  track: null, isPlaying: false, isLoading: false,
  position: 0, duration: 0, pitch: 0,
  eqLow: 0, eqMid: 0, eqHigh: 0, gain: 1, volume: 1,
  isLooping: false, loopIn: null, loopOut: null,
  hotCues: Array(8).fill(null), cuePoint: 0,
  queue: [], queueIndex: -1,
}

interface DJStoreState {
  deckA:        DeckState
  deckB:        DeckState
  crossfader:   number
  masterVolume: number

  loadTrack:    (deck: 'A' | 'B', track: PlayerTrack) => void
  loadQueue:    (deck: 'A' | 'B', tracks: PlayerTrack[], startIndex?: number) => void
  nextTrack:    (deck: 'A' | 'B') => void
  prevTrack:    (deck: 'A' | 'B') => void
  togglePlay:   (deck: 'A' | 'B') => void
  seek:         (deck: 'A' | 'B', secs: number) => void
  setPitch:     (deck: 'A' | 'B', st: number) => void
  setEq:        (deck: 'A' | 'B', band: 'low' | 'mid' | 'high', db: number) => void
  setGain:      (deck: 'A' | 'B', v: number) => void
  setVolume:    (deck: 'A' | 'B', v: number) => void
  pressCue:     (deck: 'A' | 'B') => void
  pressHotCue:  (deck: 'A' | 'B', i: number) => void
  deleteHotCue: (deck: 'A' | 'B', i: number) => void
  setLoopIn:    (deck: 'A' | 'B') => void
  setLoopOut:   (deck: 'A' | 'B') => void
  toggleLoop:   (deck: 'A' | 'B') => void
  halveLoop:    (deck: 'A' | 'B') => void
  doubleLoop:   (deck: 'A' | 'B') => void
  setCrossfader:  (v: number) => void
  setMasterVol:   (v: number) => void

  _tick:        (deck: 'A' | 'B', pos: number) => void
  _setDuration: (deck: 'A' | 'B', dur: number) => void
  _setPlaying:  (deck: 'A' | 'B', v: boolean) => void
  _setLoading:  (deck: 'A' | 'B', v: boolean) => void
}

// ── Helper ────────────────────────────────────────────────────────────────────

type DeckKey = 'deckA' | 'deckB'

function dk(deck: 'A' | 'B'): DeckKey { return deck === 'A' ? 'deckA' : 'deckB' }
function engine(deck: 'A' | 'B') { return deck === 'A' ? djEngineA : djEngineB }

// ── Session persistence ───────────────────────────────────────────────────────

const DJ_SESSION_KEY = 'kubuno:dj'

type DJSnapshot = {
  deckA: { track: PlayerTrack | null; queue: PlayerTrack[]; queueIndex: number; position: number; pitch: number; eqLow: number; eqMid: number; eqHigh: number; gain: number; volume: number }
  deckB: { track: PlayerTrack | null; queue: PlayerTrack[]; queueIndex: number; position: number; pitch: number; eqLow: number; eqMid: number; eqHigh: number; gain: number; volume: number }
  crossfader: number
  masterVolume: number
}

function loadDJSnapshot(): DJSnapshot | null {
  try {
    const s = sessionStorage.getItem(DJ_SESSION_KEY)
    return s ? (JSON.parse(s) as DJSnapshot) : null
  } catch { return null }
}

const _djSnap = loadDJSnapshot()

// Pre-load audio src for each deck so buffering starts early
for (const deck of ['A', 'B'] as const) {
  const snap = _djSnap?.[deck === 'A' ? 'deckA' : 'deckB']
  if (snap?.track) {
    const eng = engine(deck)
    eng.audio.src = snap.track.streamUrl ?? `/api/v1/media/audio/${snap.track.id}/stream`
    eng.audio.load()
    const savedPos = snap.position ?? 0
    if (savedPos > 0) {
      eng.audio.addEventListener('canplay', function seek() {
        eng.audio.currentTime = savedPos
        eng.audio.removeEventListener('canplay', seek)
      }, { once: true })
    }
  }
}

function restoredDeck(snap: DJSnapshot['deckA']): DeckState {
  return {
    ...DEFAULT_DECK,
    track:      snap.track,
    position:   snap.position   ?? 0,
    duration:   snap.track?.durationSecs ?? 0,
    pitch:      snap.pitch      ?? 0,
    eqLow:      snap.eqLow      ?? 0,
    eqMid:      snap.eqMid      ?? 0,
    eqHigh:     snap.eqHigh     ?? 0,
    gain:       snap.gain       ?? 1,
    volume:     snap.volume     ?? 1,
    queue:      snap.queue      ?? [],
    queueIndex: snap.queueIndex ?? -1,
    isLoading:  !!snap.track,
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useDJStore = create<DJStoreState>((set, get) => {
  // Wire audio element events for both decks
  for (const deck of ['A', 'B'] as const) {
    const eng = engine(deck)
    eng.audio.addEventListener('timeupdate', () => {
      get()._tick(deck, eng.audio.currentTime)
    })
    eng.audio.addEventListener('durationchange', () => {
      if (isFinite(eng.audio.duration)) get()._setDuration(deck, eng.audio.duration)
    })
    eng.audio.addEventListener('ended', () => {
      const st = get()[dk(deck)]
      if (st.queue.length > 0 && st.queueIndex < st.queue.length - 1) {
        get().nextTrack(deck)
      } else {
        get()._setPlaying(deck, false)
      }
    })
    eng.audio.addEventListener('canplay', () => get()._setLoading(deck, false))
  }

  // Save state before page unload
  window.addEventListener('beforeunload', () => {
    const st = get()
    const snapDeck = (d: DeckState) => ({
      track:      d.track,
      queue:      d.queue,
      queueIndex: d.queueIndex,
      position:   d.position,
      pitch:      d.pitch,
      eqLow:      d.eqLow,
      eqMid:      d.eqMid,
      eqHigh:     d.eqHigh,
      gain:       d.gain,
      volume:     d.volume,
    })
    try {
      sessionStorage.setItem(DJ_SESSION_KEY, JSON.stringify({
        deckA:       snapDeck(st.deckA),
        deckB:       snapDeck(st.deckB),
        crossfader:  st.crossfader,
        masterVolume: st.masterVolume,
      }))
    } catch {}
  })

  const snapA = _djSnap?.deckA
  const snapB = _djSnap?.deckB

  return {
    deckA: snapA ? restoredDeck(snapA) : { ...DEFAULT_DECK },
    deckB: snapB ? restoredDeck(snapB) : { ...DEFAULT_DECK },
    crossfader:   _djSnap?.crossfader   ?? 0,
    masterVolume: _djSnap?.masterVolume ?? 0.8,

    loadTrack(deck, track) {
      initDJContext()
      const eng = engine(deck)
      eng.audio.pause()
      eng.audio.src = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
      eng.audio.load()
      const k = dk(deck)
      set(s => ({
        [k]: {
          ...s[k],
          track, isPlaying: false, isLoading: true,
          position: 0, duration: track.durationSecs,
          cuePoint: 0, hotCues: Array(8).fill(null),
          isLooping: false, loopIn: null, loopOut: null,
          queue: [], queueIndex: -1,
        }
      }))
    },

    loadQueue(deck, tracks, startIndex = 0) {
      if (tracks.length === 0) return
      initDJContext()
      const idx   = Math.max(0, Math.min(startIndex, tracks.length - 1))
      const track = tracks[idx]
      const eng   = engine(deck)
      eng.audio.pause()
      eng.audio.src = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
      eng.audio.load()
      const k = dk(deck)
      set(s => ({
        [k]: {
          ...s[k],
          track, isPlaying: false, isLoading: true,
          position: 0, duration: track.durationSecs,
          cuePoint: 0, hotCues: Array(8).fill(null),
          isLooping: false, loopIn: null, loopOut: null,
          queue: tracks, queueIndex: idx,
        }
      }))
    },

    nextTrack(deck) {
      const k  = dk(deck)
      const st = get()[k]
      if (st.queueIndex >= st.queue.length - 1) return
      const idx   = st.queueIndex + 1
      const track = st.queue[idx]
      const eng   = engine(deck)
      eng.audio.pause()
      eng.audio.src = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
      eng.audio.load()
      eng.audio.play().catch(() => {})
      set(s => ({
        [k]: {
          ...s[k],
          track, isPlaying: true, isLoading: true,
          position: 0, duration: track.durationSecs,
          queueIndex: idx,
          cuePoint: 0, isLooping: false, loopIn: null, loopOut: null,
        }
      }))
    },

    prevTrack(deck) {
      const k  = dk(deck)
      const st = get()[k]
      // If past 3s into the track, restart it; otherwise go to previous
      if (st.position > 3) {
        engine(deck).audio.currentTime = 0
        set(s => ({ [k]: { ...s[k], position: 0 } }))
        return
      }
      if (st.queueIndex <= 0) return
      const idx   = st.queueIndex - 1
      const track = st.queue[idx]
      const eng   = engine(deck)
      eng.audio.pause()
      eng.audio.src = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
      eng.audio.load()
      if (st.isPlaying) eng.audio.play().catch(() => {})
      set(s => ({
        [k]: {
          ...s[k],
          track, isLoading: true,
          position: 0, duration: track.durationSecs,
          queueIndex: idx,
          cuePoint: 0, isLooping: false, loopIn: null, loopOut: null,
        }
      }))
    },

    togglePlay(deck) {
      initDJContext()
      const eng = engine(deck)
      const k   = dk(deck)
      const st  = get()[k]
      if (!st.track) return
      if (st.isPlaying) {
        eng.audio.pause()
        set(s => ({ [k]: { ...s[k], isPlaying: false } }))
      } else {
        eng.audio.play().catch(() => {})
        set(s => ({ [k]: { ...s[k], isPlaying: true } }))
      }
    },

    seek(deck, secs) {
      engine(deck).audio.currentTime = Math.max(0, secs)
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], position: Math.max(0, secs) } }))
    },

    setPitch(deck, st) {
      engine(deck).audio.playbackRate = Math.max(0.5, Math.min(2, Math.pow(2, st / 12)))
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], pitch: st } }))
    },

    setEq(deck, band, db) {
      engine(deck).setEq(band, db)
      const field = `eq${band[0].toUpperCase()}${band.slice(1)}` as 'eqLow' | 'eqMid' | 'eqHigh'
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], [field]: db } }))
    },

    setGain(deck, v) {
      engine(deck).setGain(v)
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], gain: v } }))
    },

    setVolume(deck, v) {
      engine(deck).audio.volume = v
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], volume: v } }))
    },

    pressCue(deck) {
      const k  = dk(deck)
      const st = get()[k]
      const eng = engine(deck)
      if (!st.isPlaying) {
        set(s => ({ [k]: { ...s[k], cuePoint: st.position } }))
      } else {
        eng.audio.currentTime = st.cuePoint
        eng.audio.pause()
        set(s => ({ [k]: { ...s[k], isPlaying: false, position: st.cuePoint } }))
      }
    },

    pressHotCue(deck, i) {
      const k   = dk(deck)
      const st  = get()[k]
      const cue = st.hotCues[i]
      if (cue) {
        engine(deck).audio.currentTime = cue.position
        set(s => ({ [k]: { ...s[k], position: cue.position } }))
      } else {
        const cues = [...st.hotCues]
        cues[i] = { position: st.position, color: HOT_CUE_COLORS[i] }
        set(s => ({ [k]: { ...s[k], hotCues: cues } }))
      }
    },

    deleteHotCue(deck, i) {
      const cues = [...get()[dk(deck)].hotCues]
      cues[i] = null
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], hotCues: cues } }))
    },

    setLoopIn(deck) {
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], loopIn: s[dk(deck)].position } }))
    },

    setLoopOut(deck) {
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], loopOut: s[dk(deck)].position, isLooping: true } }))
    },

    toggleLoop(deck) {
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], isLooping: !s[dk(deck)].isLooping } }))
    },

    halveLoop(deck) {
      const st = get()[dk(deck)]
      if (st.loopIn === null || st.loopOut === null) return
      const len = st.loopOut - st.loopIn
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], loopOut: st.loopIn! + len / 2 } }))
    },

    doubleLoop(deck) {
      const st = get()[dk(deck)]
      if (st.loopIn === null || st.loopOut === null) return
      const len = st.loopOut - st.loopIn
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], loopOut: st.loopIn! + len * 2 } }))
    },

    setCrossfader(v) { applyCrossfader(v); set({ crossfader: v }) },
    setMasterVol(v)  { if (_djMaster) _djMaster.gain.value = Math.max(0, Math.min(1, v)); set({ masterVolume: v }) },

    _tick(deck, pos) {
      const k  = dk(deck)
      const st = get()[k]
      if (st.isLooping && st.loopIn !== null && st.loopOut !== null && pos >= st.loopOut) {
        engine(deck).audio.currentTime = st.loopIn
        return
      }
      set(s => ({ [k]: { ...s[k], position: pos } }))
    },

    _setDuration: (deck, dur) => set(s => ({ [dk(deck)]: { ...s[dk(deck)], duration: dur } })),
    _setPlaying:  (deck, v)   => set(s => ({ [dk(deck)]: { ...s[dk(deck)], isPlaying: v } })),
    _setLoading:  (deck, v)   => set(s => ({ [dk(deck)]: { ...s[dk(deck)], isLoading: v } })),
  }
})
