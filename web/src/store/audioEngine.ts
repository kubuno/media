// Singleton Web Audio API engine — connected to the playerStore audio element

const EQ_FREQUENCIES = [32, 64, 130, 270, 560, 1000, 2000, 4000, 8000, 16000] as const
export type EqBands = typeof EQ_FREQUENCIES

export const EQ_PRESETS: Record<string, number[]> = {
  flat:     [0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
  dance:    [3,  5,  3,  0, -1,  0,  2,  4,  4,  3],
  club:     [0,  0,  5,  4,  3,  3,  2,  0,  0,  0],
  acoustic: [4,  2,  3,  2,  0,  1,  3,  4,  4,  4],
  drums:    [5,  4,  2,  0, -2, -2,  0,  4,  4,  5],
  bass:     [6,  5,  4,  2,  0,  0, -1, -2, -2, -3],
  treble:   [-3,-2, -1,  0,  0,  0,  1,  2,  4,  6],
  vocal:    [-2,-3, -1,  1,  3,  3,  2,  0, -1, -2],
  pro:      [0,  1,  2,  1,  0, -1,  0,  1,  2,  1],
  rock:     [4,  3,  2,  0, -1, -1,  1,  3,  4,  4],
}

export interface EqState {
  bands:       number[]          // 10 gain values in dB
  masterGain:  number            // 0–2 (1 = unity)
  surround:    number            // 0–1
  deepBass:    number            // 0–1
  balance:     number            // -1 to 1 (0 = center)
  amplifier:   boolean
  compressor:  boolean
  bypass:      boolean
  preset:      string
}

export const DEFAULT_EQ: EqState = {
  bands:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  masterGain: 1,
  surround:   0,
  deepBass:   0,
  balance:    0,
  amplifier:  false,
  compressor: false,
  bypass:     false,
  preset:     'flat',
}

class AudioEngine {
  private ctx:         AudioContext | null = null
  private source:      MediaElementAudioSourceNode | null = null
  private sourceB:     MediaElementAudioSourceNode | null = null
  private analyser:    AnalyserNode | null = null
  private filters:     BiquadFilterNode[] = []
  private gainNode:    GainNode | null = null
  private compNode:    DynamicsCompressorNode | null = null
  private panNode:     StereoPannerNode | null = null
  private connected    = false
  private connectedB   = false

  private eq: EqState = { ...DEFAULT_EQ }

  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  getEq(): EqState {
    return { ...this.eq }
  }

  connect(audioEl: HTMLAudioElement) {
    if (this.connected) return
    try {
      this.ctx      = new AudioContext()
      this.source   = this.ctx.createMediaElementSource(audioEl)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.8

      // Create 10-band EQ
      this.filters = EQ_FREQUENCIES.map((freq, i) => {
        const f = this.ctx!.createBiquadFilter()
        f.type      = i === 0 ? 'lowshelf' : i === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking'
        f.frequency.value = freq
        f.Q.value         = 1.0
        f.gain.value      = 0
        return f
      })

      this.gainNode = this.ctx.createGain()
      this.gainNode.gain.value = 1

      this.compNode = this.ctx.createDynamicsCompressor()
      this.compNode.threshold.value = -24
      this.compNode.knee.value      = 30
      this.compNode.ratio.value     = 12
      this.compNode.attack.value    = 0.003
      this.compNode.release.value   = 0.25

      this.panNode = this.ctx.createStereoPanner()
      this.panNode.pan.value = 0

      // Chain: source → analyser → filters → gain → panner → destination
      this.source.connect(this.analyser)
      let prev: AudioNode = this.analyser
      for (const f of this.filters) {
        prev.connect(f)
        prev = f
      }
      prev.connect(this.gainNode)
      this.gainNode.connect(this.panNode)
      this.panNode.connect(this.ctx.destination)

      this.connected = true
      // Resume context on user interaction (required by browsers)
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {})
      }
    } catch (e) {
      console.warn('AudioEngine: failed to init Web Audio', e)
    }
  }

  /** Route a second audio element through the same graph (analyser → EQ → output)
   *  so crossfade playback keeps the equalizer and visualizer applied. */
  connectSecondary(audioEl: HTMLAudioElement) {
    if (this.connectedB || !this.ctx || !this.analyser) return
    try {
      this.sourceB = this.ctx.createMediaElementSource(audioEl)
      this.sourceB.connect(this.analyser)
      this.connectedB = true
    } catch (e) {
      console.warn('AudioEngine: failed to connect secondary element', e)
    }
  }

  resumeIfNeeded() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
  }

  setBand(index: number, gainDb: number) {
    this.eq = { ...this.eq, bands: this.eq.bands.map((v, i) => i === index ? gainDb : v) }
    if (!this.filters[index]) return
    if (this.eq.bypass) {
      this.filters[index].gain.value = 0
    } else {
      this.filters[index].gain.value = gainDb
    }
  }

  applyPreset(name: string) {
    const gains = EQ_PRESETS[name]
    if (!gains) return
    this.eq = { ...this.eq, preset: name, bands: [...gains] }
    this.filters.forEach((f, i) => {
      f.gain.value = this.eq.bypass ? 0 : gains[i]
    })
  }

  setMasterGain(v: number) {
    this.eq = { ...this.eq, masterGain: v }
    if (this.gainNode && !this.eq.bypass) {
      this.gainNode.gain.value = v * (this.eq.amplifier ? 1.5 : 1)
    }
  }

  setSurround(v: number) {
    this.eq = { ...this.eq, surround: v }
    // Surround implemented as a subtle wide-band presence boost
    if (this.filters[5]) {
      this.filters[5].gain.value = this.eq.bypass ? 0 : (this.eq.bands[5] + v * 3)
    }
  }

  setDeepBass(v: number) {
    this.eq = { ...this.eq, deepBass: v }
    if (this.filters[0]) {
      this.filters[0].gain.value = this.eq.bypass ? 0 : (this.eq.bands[0] + v * 6)
    }
  }

  setBalance(v: number) {
    this.eq = { ...this.eq, balance: v }
    if (this.panNode) {
      this.panNode.pan.value = v
    }
  }

  toggleAmplifier(on: boolean) {
    this.eq = { ...this.eq, amplifier: on }
    if (this.gainNode) {
      this.gainNode.gain.value = this.eq.bypass ? 1 : (this.eq.masterGain * (on ? 1.5 : 1))
    }
  }

  toggleCompressor(on: boolean) {
    this.eq = { ...this.eq, compressor: on }
    if (!this.gainNode || !this.compNode || !this.panNode || !this.ctx) return
    // Reconnect chain
    try {
      this.gainNode.disconnect()
      if (on) {
        this.gainNode.connect(this.compNode)
        this.compNode.connect(this.panNode)
      } else {
        this.gainNode.connect(this.panNode)
      }
    } catch (_) {}
  }

  setBypass(on: boolean) {
    this.eq = { ...this.eq, bypass: on }
    const bands = on ? this.filters.map(() => 0) : this.eq.bands
    this.filters.forEach((f, i) => { f.gain.value = bands[i] })
    if (this.gainNode) {
      this.gainNode.gain.value = on ? 1 : this.eq.masterGain * (this.eq.amplifier ? 1.5 : 1)
    }
    if (this.panNode) {
      this.panNode.pan.value = on ? 0 : this.eq.balance
    }
  }

  reset() {
    this.eq = { ...DEFAULT_EQ }
    this.filters.forEach(f => { f.gain.value = 0 })
    if (this.gainNode) this.gainNode.gain.value = 1
    if (this.panNode)  this.panNode.pan.value  = 0
  }
}

export const audioEngine = new AudioEngine()
