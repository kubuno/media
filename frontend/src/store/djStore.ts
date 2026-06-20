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
  // Transient scratch state (set while the jog wheel is grabbed).
  scratchBase = 0
  scratchWasPlaying = false
  scratchLastT = 0
  scratchLastDelta = 0
  scratchPitch = 0
  bpmTaps: number[] = []
  brakeTimer: ReturnType<typeof setInterval> | null = null
  // Slip mode: a "shadow" playhead that keeps advancing during loops/scratch.
  slipActive = false
  slipPos = 0
  slipLastT = 0
  private source: MediaElementAudioSourceNode | null = null
  private eqLow:  BiquadFilterNode | null = null
  private eqMid:  BiquadFilterNode | null = null
  private eqHigh: BiquadFilterNode | null = null
  private filterNode: BiquadFilterNode | null = null   // DJ filter (HPF/LPF morph)
  private gainNode: GainNode | null = null
  private outputGainNode: GainNode | null = null
  // FX sends (parallel, post-gain so they ride the crossfader)
  private echoSend:  GainNode | null = null
  private delay:     DelayNode | null = null
  private feedback:  GainNode | null = null
  private reverbSend: GainNode | null = null
  private convolver:  ConvolverNode | null = null
  // SOUND COLOR FX nodes
  private colorCrush: WaveShaperNode | null = null   // bitcrusher (in main chain)
  private colorNoiseGain: GainNode | null = null     // white-noise mix (post-gain)
  // STEM isolation. Primary path = STFT spectral separator (AudioWorklet).
  // Fallback (no AudioWorklet) = naive mid-side processing.
  private stemIn:     GainNode | null = null
  private stemOut:    GainNode | null = null
  private stemDirect: GainNode | null = null   // full mix (dry, zero-latency)
  private stemInstr:  GainNode | null = null   // fallback instrumental (mid-side)
  private stemAcap:   GainNode | null = null   // fallback acapella (mid-side)
  private stemSepGain: GainNode | null = null  // wet output of the spectral separator
  private sepNode:    AudioWorkletNode | null = null
  private stemMode:   StemMode = 'full'
  onStem = false   // true while playing a pre-separated (offline HQ) stem source
  private connected = false

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.crossOrigin = 'anonymous'
    // Vinyl behaviour: pitch follows playback speed (no time-stretch). Lets the
    // scratch/pitch bend sound like a turntable instead of a constant-pitch seek.
    this.audio.preservesPitch = false
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

      // DJ filter knob: a single biquad morphed between LPF / off / HPF.
      this.filterNode = ctx.createBiquadFilter()
      this.filterNode.type = 'allpass'
      this.filterNode.frequency.value = 20000
      this.filterNode.Q.value = 0.9

      this.gainNode = ctx.createGain()
      this.gainNode.gain.value = 1

      this.outputGainNode = ctx.createGain()
      this.outputGainNode.gain.value = 1

      // Echo / delay send (feedback loop).
      this.echoSend = ctx.createGain();  this.echoSend.gain.value = 0
      this.delay    = ctx.createDelay(2.0); this.delay.delayTime.value = 0.34
      this.feedback = ctx.createGain();  this.feedback.gain.value = 0.42

      // Reverb send (generated impulse response).
      this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0
      this.convolver  = ctx.createConvolver()
      this.convolver.buffer = makeImpulse(ctx, 2.6, 2.4)

      // SOUND COLOR FX: bitcrusher (linear/off by default) + white-noise mix.
      this.colorCrush = ctx.createWaveShaper()
      this.colorCrush.curve = makeCrushCurve(0)   // 0 = linear (bypass)
      this.colorNoiseGain = ctx.createGain(); this.colorNoiseGain.gain.value = 0
      const noiseSrc = ctx.createBufferSource()
      noiseSrc.buffer = makeNoise(ctx, 2)
      noiseSrc.loop = true
      noiseSrc.connect(this.colorNoiseGain)
      this.colorNoiseGain.connect(this.outputGainNode)
      try { noiseSrc.start() } catch { /* already started */ }

      // STEM isolation stage (mid-side). Built between the filter and the crusher.
      // Approximation (not AI stems): the centre of a stereo mix usually carries the
      // lead vocal. Instrumental = side signal (L−R) which cancels centred vocals;
      // acapella = mid signal (L+R) band-passed to the vocal range.
      this.stemIn  = ctx.createGain()
      this.stemOut = ctx.createGain()
      this.stemDirect = ctx.createGain(); this.stemDirect.gain.value = 1   // default = full mix (dry)
      this.stemInstr  = ctx.createGain(); this.stemInstr.gain.value = 0
      this.stemAcap   = ctx.createGain(); this.stemAcap.gain.value = 0
      this.stemSepGain = ctx.createGain(); this.stemSepGain.gain.value = 0  // separator wet (off until selected)
      this.stemSepGain.connect(this.stemOut)
      this.stemIn.connect(this.stemDirect); this.stemDirect.connect(this.stemOut)
      const splitter = ctx.createChannelSplitter(2)
      this.stemIn.connect(splitter)
      // Instrumental: side = L − R (mono) → cancels centred vocal.
      const sideL = ctx.createGain(); sideL.gain.value =  1
      const sideR = ctx.createGain(); sideR.gain.value = -1
      splitter.connect(sideL, 0); splitter.connect(sideR, 1)
      const sideSum = ctx.createGain()
      sideL.connect(sideSum); sideR.connect(sideSum)
      sideSum.connect(this.stemInstr); this.stemInstr.connect(this.stemOut)
      // Acapella: mid = L + R, band-passed to the vocal range, sides attenuated.
      const midL = ctx.createGain(); midL.gain.value = 0.5
      const midR = ctx.createGain(); midR.gain.value = 0.5
      splitter.connect(midL, 0); splitter.connect(midR, 1)
      const midSum = ctx.createGain()
      midL.connect(midSum); midR.connect(midSum)
      const vocalBand = ctx.createBiquadFilter(); vocalBand.type = 'bandpass'
      vocalBand.frequency.value = 1600; vocalBand.Q.value = 0.7
      // Subtract the side (instrumental) content to push the centred vocal forward.
      const acapSide = ctx.createGain(); acapSide.gain.value = -0.7
      sideSum.connect(acapSide); acapSide.connect(midSum)
      midSum.connect(vocalBand); vocalBand.connect(this.stemAcap); this.stemAcap.connect(this.stemOut)

      // Main chain: source → analyser → 3-band EQ → filter → stem → crush → gain → output → master
      this.source.connect(this.analyser)
      this.analyser.connect(this.eqLow)
      this.eqLow.connect(this.eqMid)
      this.eqMid.connect(this.eqHigh)
      this.eqHigh.connect(this.filterNode)
      this.filterNode.connect(this.stemIn)
      this.stemOut.connect(this.colorCrush)
      this.colorCrush.connect(this.gainNode)
      this.gainNode.connect(this.outputGainNode)
      // FX sends tapped post-gain, mixed back into the deck output.
      this.gainNode.connect(this.echoSend)
      this.echoSend.connect(this.delay)
      this.delay.connect(this.feedback)
      this.feedback.connect(this.delay)
      this.delay.connect(this.outputGainNode)
      this.gainNode.connect(this.reverbSend)
      this.reverbSend.connect(this.convolver)
      this.convolver.connect(this.outputGainNode)
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

  /** Output node, exposed so the master BEAT FX rack can tap this deck. */
  get fxOut(): AudioNode | null { return this.outputGainNode }

  /** Pre-fader tap (post-EQ, pre-crossfade) for the headphone CUE / PFL bus. */
  get cueTap(): AudioNode | null { return this.gainNode }

  /** DJ filter knob: v ∈ [-1,1]. 0 = bypass, <0 = low-pass (sweeps down),
   *  >0 = high-pass (sweeps up). */
  setFilter(v: number) {
    const f = this.filterNode
    if (!f) return
    if (Math.abs(v) < 0.03) { f.type = 'allpass'; f.frequency.value = 20000; return }
    if (v < 0) { f.type = 'lowpass';  f.frequency.value = 20000 * Math.pow(120 / 20000, -v) }
    else       { f.type = 'highpass'; f.frequency.value = 20    * Math.pow(8000 / 20,    v) }
  }

  /** Echo send amount 0..1. */
  setEcho(v: number) {
    if (this.echoSend) this.echoSend.gain.value = Math.max(0, Math.min(1, v)) * 0.9
  }

  /** Reverb send amount 0..1. */
  setReverb(v: number) {
    if (this.reverbSend) this.reverbSend.gain.value = Math.max(0, Math.min(1, v)) * 0.8
  }

  /** SOUND COLOR FX: a single bipolar knob v∈[-1,1] driving the selected effect.
   *  Effects not selected are forced back to neutral. */
  setColor(fx: ColorFx, v: number) {
    const amt = Math.abs(v)
    // Reset every colour effect to neutral, then apply the active one.
    if (this.filterNode) { this.filterNode.type = 'allpass'; this.filterNode.frequency.value = 20000 }
    if (this.echoSend) this.echoSend.gain.value = 0
    if (this.colorNoiseGain) this.colorNoiseGain.gain.value = 0
    if (this.colorCrush) this.colorCrush.curve = makeCrushCurve(0)

    if (amt < 0.03) return
    switch (fx) {
      case 'filter': this.setFilter(v); break                       // signed: LPF / HPF
      case 'echo':   if (this.echoSend) this.echoSend.gain.value = amt * 0.9; break
      case 'noise':  if (this.colorNoiseGain) this.colorNoiseGain.gain.value = amt * 0.25; break
      case 'crush':  if (this.colorCrush) this.colorCrush.curve = makeCrushCurve(amt); break
    }
  }

  /** Swap the <audio> source (e.g. to a pre-separated HQ stem) while preserving
   *  the playhead and play/pause state, so all transport keeps working. */
  setStemSource(url: string, isStem: boolean) {
    const t = this.audio.currentTime, playing = !this.audio.paused
    this.onStem = isStem
    this.audio.src = url
    this.audio.load()
    const onCan = () => {
      try { this.audio.currentTime = t } catch { /* not seekable yet */ }
      if (playing) this.audio.play().catch(() => {})
      this.audio.removeEventListener('canplay', onCan)
    }
    this.audio.addEventListener('canplay', onCan, { once: true })
  }

  /** Attach the STFT spectral separator worklet once its module is loaded. */
  enableSeparator(ctx: AudioContext) {
    if (this.sepNode || !this.stemIn || !this.stemSepGain) return
    try {
      const node = new AudioWorkletNode(ctx, 'kubuno-stem-separator', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      })
      this.stemIn.connect(node)
      node.connect(this.stemSepGain)
      this.sepNode = node
      this.setStem(this.stemMode)   // re-apply current selection through the worklet
    } catch (e) { console.warn('Stem separator worklet failed:', e) }
  }

  /** STEM isolation: 'full' (default), 'instrumental' (vocal cancel) or 'acapella'.
   *  Uses the spectral separator when available, else a mid-side fallback. */
  setStem(mode: StemMode) {
    this.stemMode = mode
    if (this.sepNode && this.stemSepGain && this.stemDirect && this.stemInstr && this.stemAcap) {
      // Spectral path: dry only for 'full', worklet wet for isolation.
      this.stemInstr.gain.value = 0
      this.stemAcap.gain.value  = 0
      this.stemDirect.gain.value  = mode === 'full' ? 1 : 0
      this.stemSepGain.gain.value = mode === 'full' ? 0 : 1
      const p = this.sepNode.parameters.get('mode')
      if (p) p.setValueAtTime(mode === 'acapella' ? 1 : mode === 'instrumental' ? 2 : 0, this.sepNode.context.currentTime)
      return
    }
    // Fallback: naive mid-side.
    if (!this.stemDirect || !this.stemInstr || !this.stemAcap) return
    if (this.stemSepGain) this.stemSepGain.gain.value = 0
    this.stemDirect.gain.value = mode === 'full'         ? 1 : 0
    this.stemInstr.gain.value  = mode === 'instrumental' ? 1 : 0
    this.stemAcap.gain.value   = mode === 'acapella'     ? 1.6 : 0
  }
}

export type StemMode = 'full' | 'acapella' | 'instrumental'
export const STEM_MODES: { id: StemMode; label: string }[] = [
  { id: 'full',         label: 'Complet' },
  { id: 'acapella',     label: 'Voix' },
  { id: 'instrumental', label: 'Instru' },
]

/** Bitcrusher transfer curve. amount 0 = linear (bypass), 1 = heavy quantisation. */
function makeCrushCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  // steps: many (smooth) when amount→0, few (crushed) when amount→1
  const steps = Math.max(2, Math.round(64 - amount * 60))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = amount < 0.001 ? x : Math.round(x * steps) / steps
  }
  return curve
}

/** Looping white-noise buffer. */
function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/** Synthesised reverb impulse response (exponentially-decaying noise). */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate
  const len  = Math.max(1, Math.floor(rate * seconds))
  const buf  = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

// ── Real-time vocal / instrumental separator (AudioWorklet) ────────────────────
// The processor itself lives in ./stemWorklet.js and is loaded as a same-origin
// asset (CSP `script-src 'self'` forbids blob: worklets). Best real-time,
// in-browser, no-ML approach: STFT (2048-pt, 75 % overlap, Hann/COLA) + a per-bin
// soft mask combining inter-channel coherence and panning balance (azimuth
// discrimination, à la ADRess), vocal-band weighted, temporally smoothed.
let _sepModulePromise: Promise<boolean> | null = null
/** Register the separator worklet once, from its same-origin built asset URL. */
function ensureSeparator(ctx: AudioContext): Promise<boolean> {
  if (_sepModulePromise) return _sepModulePromise
  _sepModulePromise = (async () => {
    if (!ctx.audioWorklet) return false
    try {
      const url = new URL('./stemWorklet.js', import.meta.url)
      await ctx.audioWorklet.addModule(url)
      return true
    } catch (e) { console.warn('Stem separator addModule failed:', e); return false }
  })()
  return _sepModulePromise
}

// ── Offline (HQ) vocal / instrumental separation ───────────────────────────────
// Runs on the whole decoded track in a Blob Web Worker (allowed by the CSP
// `worker-src 'self' blob:`). Offline lets us use a larger FFT (4096), 75 %
// overlap, a soft Wiener mask refined over time + frequency, and produce both
// stems at once — clearly cleaner than the live worklet. The stems are encoded
// to WAV and played back by swapping the deck's <audio> source, so the whole
// transport (jog / loops / cues / tempo) keeps working unchanged.
export interface StemUrls { vocal: string; instrumental: string }
const _stemCache: Record<string, StemUrls> = {}
export function djStemReady(id: string | undefined): boolean { return !!(id && _stemCache[id]) }

const STEM_OFFLINE_WORKER_SRC = `
function fft(re, im, inv) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), hl = len >> 1
    for (let i = 0; i < n; i += len) { let cwr = 1, cwi = 0
      for (let k = 0; k < hl; k++) { const ar = re[i+k+hl], ai = im[i+k+hl]; const vr = ar*cwr - ai*cwi, vi = ar*cwi + ai*cwr; const ur = re[i+k], ui = im[i+k]; re[i+k] = ur+vr; im[i+k] = ui+vi; re[i+k+hl] = ur-vr; im[i+k+hl] = ui-vi; const ncwr = cwr*wr - cwi*wi; cwi = cwr*wi + cwi*wr; cwr = ncwr } } }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}
function vocalWeight(f) { const lo = f < 90 ? 0 : f > 200 ? 1 : (f-90)/110; const hi = f < 7000 ? 1 : f > 11000 ? 0 : 1-(f-7000)/4000; return lo*hi }
self.onmessage = function (e) {
  const d = e.data, L = d.L, R = d.R || d.L, sr = d.sr, N = d.N || 4096, H = d.H || 1024
  const len = L.length, half = N >> 1
  const win = new Float32Array(N); for (let n = 0; n < N; n++) win[n] = 0.5 - 0.5*Math.cos(2*Math.PI*n/N)
  let ss = 0; for (let n = 0; n < N; n++) ss += win[n]*win[n]; const norm = 1/(ss/H)
  const vL = new Float32Array(len), vR = new Float32Array(len), iL = new Float32Array(len), iR = new Float32Array(len)
  const reL = new Float32Array(N), imL = new Float32Array(N), reR = new Float32Array(N), imR = new Float32Array(N)
  const aRe = new Float32Array(N), aIm = new Float32Array(N), bRe = new Float32Array(N), bIm = new Float32Array(N)
  const mask = new Float32Array(N), maskS = new Float32Array(N), maskPrev = new Float32Array(N)
  const eps = 1e-9
  const last = len - N
  let nextReport = 0
  for (let f = 0; f <= last; f += H) {
    for (let n = 0; n < N; n++) { const w = win[n]; reL[n] = L[f+n]*w; imL[n] = 0; reR[n] = R[f+n]*w; imR[n] = 0 }
    fft(reL, imL, false); fft(reR, imR, false)
    for (let k = 0; k < N; k++) {
      const lr = reL[k], li = imL[k], rr = reR[k], ri = imR[k]
      const Lm2 = lr*lr + li*li, Rm2 = rr*rr + ri*ri
      const cr = lr*rr + li*ri, ci = li*rr - lr*ri
      let coh = 2*Math.sqrt(cr*cr + ci*ci) / (Lm2 + Rm2 + eps); if (coh > 1) coh = 1
      const bal = 1 - Math.abs(Lm2 - Rm2) / (Lm2 + Rm2 + eps)
      let centre = coh*bal; centre = centre*centre*(3 - 2*centre)
      const kk = k <= half ? k : N - k
      let m = centre * vocalWeight(kk*sr/N)
      m = maskPrev[k]*0.6 + m*0.4; maskPrev[k] = m; mask[k] = m
    }
    maskS[0] = mask[0]; maskS[N-1] = mask[N-1]
    for (let k = 1; k < N-1; k++) maskS[k] = (mask[k-1] + 2*mask[k] + mask[k+1])*0.25
    for (let k = 0; k < N; k++) {
      let gv = maskS[k]; gv = gv*gv/(gv*gv + (1-gv)*(1-gv) + eps)   // Wiener sharpening
      let gi = 1 - 1.1*gv; if (gi < 0.02) gi = 0.02
      aRe[k] = reL[k]*gv; aIm[k] = imL[k]*gv; bRe[k] = reL[k]*gi; bIm[k] = imL[k]*gi
    }
    fft(aRe, aIm, true); fft(bRe, bIm, true)
    for (let n = 0; n < N; n++) { const w = win[n]*norm; vL[f+n] += aRe[n]*w; iL[f+n] += bRe[n]*w }
    for (let k = 0; k < N; k++) {
      let gv = maskS[k]; gv = gv*gv/(gv*gv + (1-gv)*(1-gv) + eps)
      let gi = 1 - 1.1*gv; if (gi < 0.02) gi = 0.02
      aRe[k] = reR[k]*gv; aIm[k] = imR[k]*gv; bRe[k] = reR[k]*gi; bIm[k] = imR[k]*gi
    }
    fft(aRe, aIm, true); fft(bRe, bIm, true)
    for (let n = 0; n < N; n++) { const w = win[n]*norm; vR[f+n] += aRe[n]*w; iR[f+n] += bRe[n]*w }
    if (f >= nextReport) { nextReport = f + H*48; self.postMessage({ progress: last > 0 ? f/last : 1 }) }
  }
  self.postMessage({ vL, vR, iL, iR }, [vL.buffer, vR.buffer, iL.buffer, iR.buffer])
}
`
let _stemWorkerUrl: string | null = null
function separateOffline(buf: AudioBuffer, onProgress: (p: number) => void): Promise<{ vocal: [Float32Array, Float32Array]; instrumental: [Float32Array, Float32Array] }> {
  return new Promise((resolve, reject) => {
    try {
      if (!_stemWorkerUrl) _stemWorkerUrl = URL.createObjectURL(new Blob([STEM_OFFLINE_WORKER_SRC], { type: 'application/javascript' }))
      const worker = new Worker(_stemWorkerUrl)
      const L = buf.getChannelData(0)
      const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L
      const Lc = new Float32Array(L), Rc = new Float32Array(R)   // copies (transferable, don't detach the AudioBuffer)
      worker.onmessage = (e) => {
        if (e.data.progress !== undefined) { onProgress(e.data.progress); return }
        worker.terminate()
        resolve({ vocal: [e.data.vL, e.data.vR], instrumental: [e.data.iL, e.data.iR] })
      }
      worker.onerror = (e) => { worker.terminate(); reject(e) }
      worker.postMessage({ L: Lc, R: Rc, sr: buf.sampleRate, N: 4096, H: 1024 }, [Lc.buffer, Rc.buffer])
    } catch (e) { reject(e) }
  })
}

/** Encode an interleaved stereo pair to a 16-bit WAV Blob URL. */
function encodeWavUrl(ch: [Float32Array, Float32Array], sampleRate: number): string {
  const [L, R] = ch
  const n = L.length, bytes = 44 + n * 4
  const ab = new ArrayBuffer(bytes), dv = new DataView(ab)
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); ws(8, 'WAVE'); ws(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 4, true)
  dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * 4, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    let l = L[i]; if (l > 1) l = 1; else if (l < -1) l = -1
    let r = R[i]; if (r > 1) r = 1; else if (r < -1) r = -1
    dv.setInt16(o, l * 32767, true); o += 2
    dv.setInt16(o, r * 32767, true); o += 2
  }
  return URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }))
}

// ── Singleton engines + shared AudioContext ───────────────────────────────────

// Up to six decks (A–F). Decks beyond the active count stay idle but wired.
export type DeckId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
export const ALL_DECKS: DeckId[] = ['A', 'B', 'C', 'D', 'E', 'F']
export const DECK_COUNTS = [2, 4, 6] as const
export type DeckCount = typeof DECK_COUNTS[number]

export const djEngineA = new DJDeckEngine()
export const djEngineB = new DJDeckEngine()
export const djEngineC = new DJDeckEngine()
export const djEngineD = new DJDeckEngine()
export const djEngineE = new DJDeckEngine()
export const djEngineF = new DJDeckEngine()
const _engines: Record<DeckId, DJDeckEngine> = {
  A: djEngineA, B: djEngineB, C: djEngineC, D: djEngineD, E: djEngineE, F: djEngineF,
}
export function djEngine(deck: DeckId): DJDeckEngine { return _engines[deck] }

let _djCtx:    AudioContext | null = null
let _djMaster: GainNode     | null = null
let _masterOut: AudioNode   | null = null   // final node before destination

// Master graphic equaliser — 10 bands (mockup frequencies).
export const EQ_FREQS = [32, 64, 130, 270, 560, 1000, 2000, 4000, 8000, 16000] as const
let _eqBands:    BiquadFilterNode[] = []
let _eqDeepBass: BiquadFilterNode | null = null   // DEEP BASS (extra low shelf)
let _eqSurround: BiquadFilterNode | null = null   // SURROUND (air / high shelf)
let _eqPreamp:   GainNode | null = null           // GAIN + AMPLIFIER
let _eqComp:     DynamicsCompressorNode | null = null
let _eqPanner:   StereoPannerNode | null = null   // BALANCE
let _limiter:    DynamicsCompressorNode | null = null
let _monoGain:   GainNode | null = null
let _musicBus:   GainNode | null = null   // decks → here → master (duckable for talkover)
let _micGain:    GainNode | null = null   // microphone → master
let _micStream:  MediaStream | null = null
let _masterAnalyser: AnalyserNode | null = null
export function djMasterAnalyser(): AnalyserNode | null { return _masterAnalyser }

// Headphone CUE (PFL) bus → separate output device.
let _cueDest:   MediaStreamAudioDestinationNode | null = null
let _cueAudio:  HTMLAudioElement | null = null
const _cueDeckGain: Record<DeckId, GainNode | null> = { A: null, B: null, C: null, D: null, E: null, F: null }
let _cueMasterGain: GainNode | null = null

// Sampler: recorded buffers per slot (override the synthesised one-shot).
const _sampleBuffers: (AudioBuffer | null)[] = Array(8).fill(null)
let _sampleDest:  MediaStreamAudioDestinationNode | null = null
let _sampleRec:   MediaRecorder | null = null

// ── Master BEAT FX rack ────────────────────────────────────────────────────────

export type BeatFxType = 'echo' | 'reverb' | 'flanger' | 'phaser' | 'filter' | 'roll'
export const BEAT_FX_TYPES: { id: BeatFxType; label: string }[] = [
  { id: 'echo',    label: 'ECHO' },
  { id: 'reverb',  label: 'REVERB' },
  { id: 'flanger', label: 'FLANGER' },
  { id: 'phaser',  label: 'PHASER' },
  { id: 'filter',  label: 'FILTER' },
  { id: 'roll',    label: 'ROLL' },
]

// Beat divisions selectable in the UI.
export const BEAT_DIVISIONS = [0.25, 0.5, 1, 2, 4] as const

export interface BeatFxState {
  on: boolean
  type: BeatFxType
  beat: number          // division (× one beat)
  depth: number         // 0..1 wet
  channel: 'A' | 'B' | 'master'
}

class BeatFxRack {
  private ctx: AudioContext
  private input: GainNode
  private wet: GainNode
  private effects: Record<BeatFxType, { in: AudioNode; out: AudioNode }>
  private echoDelay!: DelayNode
  private rollDelay!: DelayNode
  private flangerLfo!: OscillatorNode
  private phaserLfo!: OscillatorNode
  private type: BeatFxType = 'echo'
  private on = false
  private depth = 0.5
  private srcOut: AudioNode | null = null

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.wet = ctx.createGain(); this.wet.gain.value = 0
    this.wet.connect(destination)
    this.effects = {} as Record<BeatFxType, { in: AudioNode; out: AudioNode }>
    this.build()
    this.connectActive()
  }

  private build() {
    const ctx = this.ctx
    // ECHO — feedback delay
    { const din = ctx.createGain(); const d = ctx.createDelay(2); d.delayTime.value = 0.4
      const fb = ctx.createGain(); fb.gain.value = 0.45; const out = ctx.createGain()
      din.connect(d); d.connect(fb); fb.connect(d); d.connect(out); this.echoDelay = d
      this.effects.echo = { in: din, out } }
    // ROLL — short high-feedback stutter
    { const din = ctx.createGain(); const d = ctx.createDelay(2); d.delayTime.value = 0.2
      const fb = ctx.createGain(); fb.gain.value = 0.82; const out = ctx.createGain()
      din.connect(d); d.connect(fb); fb.connect(d); d.connect(out); this.rollDelay = d
      this.effects.roll = { in: din, out } }
    // REVERB — convolution
    { const din = ctx.createGain(); const c = ctx.createConvolver(); c.buffer = makeImpulse(ctx, 2.4, 2.2)
      const out = ctx.createGain(); din.connect(c); c.connect(out)
      this.effects.reverb = { in: din, out } }
    // FLANGER — modulated short delay
    { const din = ctx.createGain(); const d = ctx.createDelay(0.05); d.delayTime.value = 0.005
      const fb = ctx.createGain(); fb.gain.value = 0.5; const out = ctx.createGain()
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.4; const lg = ctx.createGain(); lg.gain.value = 0.003
      lfo.connect(lg); lg.connect(d.delayTime); try { lfo.start() } catch { /* started */ }
      din.connect(d); d.connect(fb); fb.connect(d); d.connect(out); din.connect(out)
      this.flangerLfo = lfo; this.effects.flanger = { in: din, out } }
    // PHASER — cascaded modulated all-pass
    { const din = ctx.createGain(); const out = ctx.createGain(); let node: AudioNode = din
      const aps: BiquadFilterNode[] = []
      for (let i = 0; i < 4; i++) { const ap = ctx.createBiquadFilter(); ap.type = 'allpass'; ap.frequency.value = 400 + i * 300; node.connect(ap); node = ap; aps.push(ap) }
      node.connect(out); din.connect(out)
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.5; const lg = ctx.createGain(); lg.gain.value = 300
      lfo.connect(lg); aps.forEach(ap => lg.connect(ap.frequency)); try { lfo.start() } catch { /* started */ }
      this.phaserLfo = lfo; this.effects.phaser = { in: din, out } }
    // FILTER — resonant low-pass send
    { const din = ctx.createGain(); const bq = ctx.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.value = 1100; bq.Q.value = 7
      const out = ctx.createGain(); din.connect(bq); bq.connect(out)
      this.effects.filter = { in: din, out } }
  }

  private connectActive() {
    for (const e of Object.values(this.effects)) {
      try { this.input.disconnect(e.in) } catch { /* not connected */ }
      try { e.out.disconnect(this.wet) } catch { /* not connected */ }
    }
    const e = this.effects[this.type]
    this.input.connect(e.in); e.out.connect(this.wet)
  }

  setSource(node: AudioNode | null) {
    if (this.srcOut) { try { this.srcOut.disconnect(this.input) } catch { /* */ } }
    this.srcOut = node
    if (node) node.connect(this.input)
  }
  setType(t: BeatFxType) { this.type = t; this.connectActive() }
  setDepth(d: number) { this.depth = Math.max(0, Math.min(1, d)); if (this.on) this.wet.gain.value = this.depth }
  setOn(on: boolean) { this.on = on; this.wet.gain.value = on ? this.depth : 0 }
  setBeatSeconds(s: number) {
    const t = Math.max(0.02, Math.min(2, s))
    this.echoDelay.delayTime.value = t
    this.rollDelay.delayTime.value = Math.max(0.02, t / 2)
    const rate = 1 / Math.max(0.1, t * 2)
    this.flangerLfo.frequency.value = rate
    this.phaserLfo.frequency.value = rate
  }
}

let _bfx: BeatFxRack | null = null

function initDJContext() {
  if (_djCtx) {
    if (_djCtx.state === 'suspended') _djCtx.resume()
    return
  }
  _djCtx = new AudioContext()
  _djMaster = _djCtx.createGain()
  _djMaster.gain.value = _djPrefs.masterVolume ?? 0.8

  // Build the 10-band graphic EQ + tone shaping on the master bus.
  _eqBands = EQ_FREQS.map((f, i) => {
    const b = _djCtx!.createBiquadFilter()
    b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking'
    b.frequency.value = f
    b.Q.value = 1.0
    b.gain.value = 0
    return b
  })
  _eqDeepBass = _djCtx.createBiquadFilter(); _eqDeepBass.type = 'lowshelf';  _eqDeepBass.frequency.value = 45;    _eqDeepBass.gain.value = 0
  _eqSurround = _djCtx.createBiquadFilter(); _eqSurround.type = 'highshelf'; _eqSurround.frequency.value = 11000; _eqSurround.gain.value = 0
  _eqPreamp   = _djCtx.createGain();         _eqPreamp.gain.value = 1
  _eqComp     = _djCtx.createDynamicsCompressor()
  _eqComp.threshold.value = 0; _eqComp.ratio.value = 1   // ratio 1 = transparent (off)
  _eqPanner   = _djCtx.createStereoPanner();  _eqPanner.pan.value = 0
  // Master limiter (brick-wall, bypassed by default) + mono fold node.
  _limiter = _djCtx.createDynamicsCompressor()
  _limiter.threshold.value = 0; _limiter.ratio.value = 1; _limiter.attack.value = 0.003; _limiter.release.value = 0.1
  _monoGain = _djCtx.createGain()
  _monoGain.channelCount = 2; _monoGain.channelCountMode = 'max'; _monoGain.channelInterpretation = 'speakers'

  let node: AudioNode = _djMaster
  for (const b of _eqBands) { node.connect(b); node = b }
  node.connect(_eqDeepBass); node = _eqDeepBass
  node.connect(_eqSurround); node = _eqSurround
  node.connect(_eqPreamp);   node = _eqPreamp
  node.connect(_eqComp);     node = _eqComp
  node.connect(_eqPanner);   node = _eqPanner
  node.connect(_limiter);    node = _limiter
  node.connect(_monoGain);   node = _monoGain
  node.connect(_djCtx.destination)
  _masterOut = node

  // Master analyser (level meter / clip detection) tapped at the output.
  _masterAnalyser = _djCtx.createAnalyser()
  _masterAnalyser.fftSize = 1024
  node.connect(_masterAnalyser)

  // Music bus → master (lets talkover duck the music without ducking the mic).
  _musicBus = _djCtx.createGain()
  _musicBus.connect(_djMaster)
  for (const d of ALL_DECKS) djEngine(d).init(_djCtx, _musicBus)

  // Load the STFT vocal/instrumental separator worklet, then attach it to every deck.
  ensureSeparator(_djCtx).then(ok => { if (ok && _djCtx) for (const d of ALL_DECKS) djEngine(d).enableSeparator(_djCtx) })

  // Headphone CUE bus: per-deck pre-fader taps + master, to a separate output.
  try {
    _cueDest = _djCtx.createMediaStreamDestination()
    for (const d of ALL_DECKS) {
      const g = _djCtx.createGain(); g.gain.value = 0
      engine(d).cueTap?.connect(g); g.connect(_cueDest)
      _cueDeckGain[d] = g
    }
    _cueMasterGain = _djCtx.createGain(); _cueMasterGain.gain.value = 0
    _masterOut.connect(_cueMasterGain); _cueMasterGain.connect(_cueDest)
    _cueAudio = new Audio(); _cueAudio.srcObject = _cueDest.stream; _cueAudio.play().catch(() => {})
  } catch (e) { console.warn('Cue bus init failed:', e) }

  // Master BEAT FX rack (parallel send, defaults to the master bus).
  _bfx = new BeatFxRack(_djCtx, _djCtx.destination)
  _bfx.setSource(_masterOut)

  _djCtx.resume()
}

const dbToGain = (db: number) => Math.pow(10, db / 20)

export interface EqSettings {
  bands: number[]; preset: string; bypass: boolean
  gain: number; amplifier: boolean; compressor: boolean
  deepBass: number; surround: number; balance: number
}

// Push the whole EQ settings object to the audio graph.
function applyEq(eq: EqSettings) {
  if (!_djCtx) return
  const byp = eq.bypass
  _eqBands.forEach((b, i) => { b.gain.value = byp ? 0 : (eq.bands[i] ?? 0) })
  if (_eqDeepBass) _eqDeepBass.gain.value = byp ? 0 : eq.deepBass
  if (_eqSurround) _eqSurround.gain.value = byp ? 0 : eq.surround
  if (_eqPreamp)   _eqPreamp.gain.value   = byp ? 1 : dbToGain(eq.gain + (eq.amplifier ? 6 : 0))
  if (_eqPanner)   _eqPanner.pan.value    = Math.max(-1, Math.min(1, eq.balance))
  if (_eqComp) {
    const on = eq.compressor && !byp
    _eqComp.threshold.value = on ? -24 : 0
    _eqComp.ratio.value     = on ? 4 : 1
    _eqComp.knee.value      = on ? 24 : 0
  }
}

// 20 master EQ presets (gains in dB for the 10 bands above).
export const EQ_PRESETS: { name: string; gains: number[] }[] = [
  { name: 'FLAT',      gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'PRO',       gains: [2, 1, 0, -1, -1, 0, 1, 1, 2, 2] },
  { name: 'DANCE',     gains: [6, 5, 2, 0, -1, -1, 2, 4, 5, 5] },
  { name: 'CLUB',      gains: [0, 2, 3, 3, 3, 2, 1, 0, 0, 0] },
  { name: 'ACOUSTIC',  gains: [4, 3, 2, 1, 1, 1, 2, 2, 1, 1] },
  { name: 'DRUMS',     gains: [5, 3, 1, 0, 1, 2, 3, 3, 2, 2] },
  { name: 'ROCK',      gains: [5, 3, -1, -2, 1, 3, 4, 5, 5, 5] },
  { name: 'BASS',      gains: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'TREBLE',    gains: [0, 0, 0, 0, 0, 2, 4, 5, 6, 7] },
  { name: 'VOCAL',     gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { name: 'POP',       gains: [-1, 1, 3, 4, 4, 2, 0, -1, -1, -1] },
  { name: 'JAZZ',      gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { name: 'CLASSIQUE', gains: [4, 3, 2, 0, 0, 0, -2, -2, 3, 4] },
  { name: 'HIP-HOP',   gains: [6, 5, 2, 3, -1, -1, 1, 1, 3, 3] },
  { name: 'ÉLECTRO',   gains: [5, 4, 1, 0, -2, 1, 2, 3, 5, 5] },
  { name: 'R&B',       gains: [4, 6, 5, 2, -1, -1, 1, 2, 3, 4] },
  { name: 'REGGAE',    gains: [2, 0, 0, -3, -1, 2, 3, 1, 1, 1] },
  { name: 'TECHNO',    gains: [6, 4, 1, -1, -2, 0, 2, 4, 5, 6] },
  { name: 'LOUDNESS',  gains: [6, 4, 2, 0, -1, 0, 2, 4, 5, 6] },
  { name: 'SMILEY',    gains: [6, 4, 1, -2, -3, -2, 1, 4, 6, 6] },
]

// Crossfader with selectable curve. cf -1 = full A, 0 = middle, +1 = full B.
export type CrossfaderCurve = 'smooth' | 'linear' | 'sharp'

export type TransitionStyle = 'fade' | 'cut' | 'echo' | 'filter'
export const TRANSITION_STYLES: { id: TransitionStyle; label: string }[] = [
  { id: 'fade',   label: 'Fondu' },
  { id: 'cut',    label: 'Coupe' },
  { id: 'echo',   label: 'Écho' },
  { id: 'filter', label: 'Filtre' },
]

// Deck waveform render styles.
export type WaveStyle = 'bars' | 'mirror' | 'blob' | 'line' | 'dualline' | 'dots' | 'ribbon' | 'spikes' | 'wire'
export const WAVE_STYLES: { id: WaveStyle; label: string }[] = [
  { id: 'mirror',   label: 'Barres miroir' },
  { id: 'bars',     label: 'Barres dégradées' },
  { id: 'blob',     label: 'Vague pleine' },
  { id: 'line',     label: 'Ligne (oscilloscope)' },
  { id: 'dualline', label: 'Double ligne' },
  { id: 'dots',     label: 'Matrice LED' },
  { id: 'ribbon',   label: 'Ruban de fréquences' },
  { id: 'wire',     label: 'Contours filaires' },
  { id: 'spikes',   label: 'Spectre lumineux' },
]
let _cfCurve: CrossfaderCurve = 'smooth'
let _cfReverse = false              // "hamster" mode (reverse the crossfader)
// Crossfader side assignment per deck. A→left, B→right, others default to THRU
// (always full, bypassing the crossfader) so 4/6-deck setups stay audible.
export type XfAssign = 'A' | 'B' | 'thru'
const _xfAssign: Record<DeckId, XfAssign> = { A: 'A', B: 'B', C: 'thru', D: 'thru', E: 'thru', F: 'thru' }
let _deckCount: DeckCount = 2
function applyCrossfader(cf: number) {
  const pos = (_cfReverse ? -cf + 1 : cf + 1) / 2   // 0..1 (A→B), optionally reversed
  let a: number, b: number
  if (_cfCurve === 'linear') {
    a = 1 - pos; b = pos
  } else if (_cfCurve === 'sharp') {
    // Both sides stay near full through the middle, then cut fast at the edges.
    a = Math.min(1, 2 * (1 - pos)); b = Math.min(1, 2 * pos)
  } else {
    a = Math.cos(pos * (Math.PI / 2)); b = Math.cos((1 - pos) * (Math.PI / 2))
  }
  for (const d of ALL_DECKS) {
    const assign = _xfAssign[d]
    const v = assign === 'A' ? a : assign === 'B' ? b : 1
    djEngine(d).setCrossfadeVolume(v)
  }
}

// Auto-mix / transition: start the next deck and cross over with the chosen style.
// ── Auto-DJ: harmonic + tempo-aware queue ordering ─────────────────────────────
// Parse the Camelot code (e.g. "8B") out of a stored "8B · C" key string.
function camelotCode(keyName: string | null | undefined): { n: number; l: 'A' | 'B' } | null {
  if (!keyName) return null
  const m = keyName.match(/(\d{1,2})\s*([AB])/i)
  return m ? { n: parseInt(m[1], 10), l: m[2].toUpperCase() as 'A' | 'B' } : null
}
// Lower = smoother harmonic transition on the Camelot wheel.
function harmonicPenalty(a: ReturnType<typeof camelotCode>, b: ReturnType<typeof camelotCode>): number {
  if (!a || !b) return 4                              // unknown key → moderate penalty
  if (a.n === b.n && a.l === b.l) return 0            // identical key
  if (a.n === b.n) return 1                           // relative major/minor
  const d = Math.min((a.n - b.n + 12) % 12, (b.n - a.n + 12) % 12)
  if (a.l === b.l && d === 1) return 1                // ±1 on the wheel (energy boost/drop)
  if (a.l === b.l && d === 2) return 3
  return 6
}
// Greedy nearest-neighbour ordering: each next track is the most compatible
// (harmonic key + closest BPM, octave-folded) with the previous one.
export function buildAutoDjQueue(tracks: PlayerTrack[]): PlayerTrack[] {
  if (tracks.length <= 2) return tracks.slice()
  const metas = tracks.map(t => { const m = trackMeta(t.id); return { t, cam: camelotCode(m?.keyName), bpm: m?.bpm ?? null } })
  const used = new Array(metas.length).fill(false)
  const order = [0]; used[0] = true
  for (let step = 1; step < metas.length; step++) {
    const cur = metas[order[order.length - 1]]
    let best = -1, bestScore = Infinity
    for (let i = 0; i < metas.length; i++) {
      if (used[i]) continue
      const cand = metas[i]
      const bpmPen = (cur.bpm && cand.bpm)
        ? Math.min(Math.abs(cur.bpm - cand.bpm), Math.abs(cur.bpm - cand.bpm * 2), Math.abs(cur.bpm - cand.bpm / 2)) / 2
        : 6
      const score = harmonicPenalty(cur.cam, cand.cam) * 3 + bpmPen
      if (score < bestScore) { bestScore = score; best = i }
    }
    order.push(best); used[best] = true
  }
  return order.map(i => metas[i].t)
}

let _autoMixRamp: ReturnType<typeof setInterval> | null = null
function startAutoMix(from: DeckId, to: DeckId, get: () => DJStoreState, set: (fn: (s: DJStoreState) => Partial<DJStoreState>) => void) {
  const eng = engine(to)
  eng.audio.play().catch(() => {})
  const ok = to === 'A' ? 'deckA' : 'deckB'
  set(s => ({ [ok]: { ...s[ok], isPlaying: true } } as Partial<DJStoreState>))
  const style  = get().transitionStyle
  const target = to === 'B' ? 1 : -1
  if (style === 'cut') { get().setCrossfader(target); return }
  if (style === 'echo')   get().setBeatFx({ on: true, type: 'echo', channel: from === 'A' ? 'A' : 'B' })
  if (style === 'filter') get().setColorFx(from, 'filter')
  const start = get().crossfader, steps = 50
  let i = 0
  _autoMixRamp = setInterval(() => {
    i++
    const p = i / steps
    get().setCrossfader(start + (target - start) * p)
    if (style === 'filter') get().setColor(from, -p)        // sweep a low-pass on the outgoing deck
    if (i >= steps) {
      if (_autoMixRamp) clearInterval(_autoMixRamp); _autoMixRamp = null
      if (style === 'echo')   get().setBeatFx({ on: false })
      if (style === 'filter') get().setColor(from, 0)
    }
  }, 100)
}

// ── Mix recording (MediaRecorder on the master bus) ────────────────────────────

let _recDest:   MediaStreamAudioDestinationNode | null = null
let _recorder:  MediaRecorder | null = null
let _recChunks: Blob[] = []

function startMixRecording(): boolean {
  if (!_djCtx || !_masterOut || _recorder) return false
  try {
    if (!_recDest) { _recDest = _djCtx.createMediaStreamDestination(); _masterOut.connect(_recDest) }
    _recChunks = []
    _recorder = new MediaRecorder(_recDest.stream, { mimeType: 'audio/webm' })
    _recorder.ondataavailable = e => { if (e.data.size > 0) _recChunks.push(e.data) }
    _recorder.start()
    return true
  } catch (e) { console.warn('Mix recording failed:', e); return false }
}

function stopMixRecording() {
  const rec = _recorder
  if (!rec) return
  rec.onstop = () => {
    const blob = new Blob(_recChunks, { type: 'audio/webm' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `kubuno-mix.webm`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
  rec.stop()
  _recorder = null
}

// ── Microphone + talkover ──────────────────────────────────────────────────────

async function enableMic(): Promise<boolean> {
  initDJContext()
  if (!_djCtx || !_djMaster) return false
  if (_micGain) return true
  try {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    const src = _djCtx.createMediaStreamSource(_micStream)
    _micGain = _djCtx.createGain(); _micGain.gain.value = 1
    src.connect(_micGain); _micGain.connect(_djMaster)
    return true
  } catch (e) { console.warn('Mic failed:', e); return false }
}
function disableMic() {
  if (_micStream) { _micStream.getTracks().forEach(t => t.stop()); _micStream = null }
  if (_micGain) { try { _micGain.disconnect() } catch { /* */ } _micGain = null }
}
function setTalkoverDuck(on: boolean) {
  if (_musicBus) _musicBus.gain.value = on ? 0.25 : 1
}

// ── Sampler (synthesised one-shots) ─────────────────────────────────────────────

export const SAMPLE_NAMES = ['KICK', 'SNARE', 'HAT', 'OPEN HAT', 'CLAP', 'TOM', 'RIM', 'COWBELL'] as const

function playSampleSound(i: number) {
  initDJContext()
  if (!_djCtx || !_djMaster) return
  const ctx = _djCtx, now = ctx.currentTime
  const out = ctx.createGain(); out.connect(_djMaster)
  // Recorded sample takes priority over the synthesised one-shot.
  const rec = _sampleBuffers[i]
  if (rec) {
    const s = ctx.createBufferSource(); s.buffer = rec; s.connect(out); s.start(now); return
  }
  const env = (g: GainNode, peak: number, dur: number) => {
    g.gain.setValueAtTime(peak, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur)
  }
  const noiseSrc = (dur: number) => {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
    const d = buf.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1
    const s = ctx.createBufferSource(); s.buffer = buf; return s
  }
  switch (i) {
    case 0: { const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, now); o.frequency.exponentialRampToValueAtTime(50, now + 0.12); const g = ctx.createGain(); env(g, 1, 0.28); o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.3); break }
    case 1: { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 180; const og = ctx.createGain(); env(og, 0.6, 0.18); o.connect(og); og.connect(out); o.start(now); o.stop(now + 0.2); const n = noiseSrc(0.2); const ng = ctx.createGain(); env(ng, 0.7, 0.18); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500; n.connect(hp); hp.connect(ng); ng.connect(out); n.start(now); break }
    case 2: case 3: { const dur = i === 2 ? 0.06 : 0.3; const n = noiseSrc(dur); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; const g = ctx.createGain(); env(g, 0.5, dur); n.connect(hp); hp.connect(g); g.connect(out); n.start(now); break }
    case 4: { const n = noiseSrc(0.2); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 1.5; const g = ctx.createGain(); env(g, 0.8, 0.16); n.connect(bp); bp.connect(g); g.connect(out); n.start(now); break }
    case 5: { const o = ctx.createOscillator(); o.frequency.setValueAtTime(220, now); o.frequency.exponentialRampToValueAtTime(90, now + 0.18); const g = ctx.createGain(); env(g, 0.9, 0.3); o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.32); break }
    case 6: { const n = noiseSrc(0.05); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000; const g = ctx.createGain(); env(g, 0.6, 0.05); n.connect(hp); hp.connect(g); g.connect(out); n.start(now); break }
    default: { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 540; const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 800; const g = ctx.createGain(); env(g, 0.4, 0.25); o.connect(g); o2.connect(g); g.connect(out); o.start(now); o2.start(now); o.stop(now + 0.27); o2.stop(now + 0.27) }
  }
}

// Record ~4 s of the master into a sampler slot, then store it as an AudioBuffer.
function recordSampleToSlot(i: number, onDone: () => void) {
  initDJContext()
  if (!_djCtx || !_masterOut || _sampleRec) { onDone(); return }
  try {
    if (!_sampleDest) { _sampleDest = _djCtx.createMediaStreamDestination(); _masterOut.connect(_sampleDest) }
    const chunks: Blob[] = []
    _sampleRec = new MediaRecorder(_sampleDest.stream, { mimeType: 'audio/webm' })
    _sampleRec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    _sampleRec.onstop = async () => {
      _sampleRec = null
      try {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const arr = await blob.arrayBuffer()
        _sampleBuffers[i] = await _djCtx!.decodeAudioData(arr)
      } catch (e) { console.warn('Sample decode failed:', e) }
      onDone()
    }
    _sampleRec.start()
    setTimeout(() => { if (_sampleRec && _sampleRec.state !== 'inactive') _sampleRec.stop() }, 4000)
  } catch (e) { console.warn('Sample record failed:', e); _sampleRec = null; onDone() }
}

// Real-time BPM estimate via energy-envelope autocorrelation over ~6 s.
function detectBpm(deck: DeckId, onResult: (bpm: number) => void) {
  const an = engine(deck).analyser
  if (!an) { onResult(0); return }
  const FPS = 60, SECS = 6, N = FPS * SECS
  const energy: number[] = []
  const buf = new Uint8Array(an.frequencyBinCount)
  const tick = () => {
    an.getByteFrequencyData(buf)
    let e = 0; const hi = Math.max(1, Math.floor(buf.length * 0.12))   // low band (kick)
    for (let k = 0; k < hi; k++) e += buf[k]
    energy.push(e)
    if (energy.length < N) { requestAnimationFrame(tick); return }
    const mean = energy.reduce((a, b) => a + b, 0) / energy.length
    const d = energy.map(v => v - mean)
    const minLag = Math.round(FPS * 60 / 180), maxLag = Math.round(FPS * 60 / 70)
    let best = -Infinity, bestLag = minLag
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0; for (let k = 0; k + lag < d.length; k++) s += d[k] * d[k + lag]
      if (s > best) { best = s; bestLag = lag }
    }
    let bpm = 60 * FPS / bestLag
    while (bpm < 70) bpm *= 2; while (bpm > 180) bpm /= 2
    onResult(Math.round(bpm * 10) / 10)
  }
  requestAnimationFrame(tick)
}

// ── Offline track analysis: accurate BPM + beat offset + musical key ────────────

// In-place iterative radix-2 FFT.
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2]
        const vr = ar * cwr - ai * cwi, vi = ar * cwi + ai * cwr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr
      }
    }
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
// Camelot codes per pitch-class (index 0 = C).
const CAMELOT_MAJ = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B']
const CAMELOT_MIN = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A']
const KRUMHANSL_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KRUMHANSL_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

export interface TrackPeaks { peak: Float32Array; low: Float32Array }
const _peakCache: Record<string, TrackPeaks> = {}
export function djTrackPeaks(id: string | undefined): TrackPeaks | undefined { return id ? _peakCache[id] : undefined }

function analyzeBuffer(buf: AudioBuffer): { bpm: number; offset: number; key: string | null; peaks: TrackPeaks } {
  const sr = buf.sampleRate
  const ch0 = buf.getChannelData(0)
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null
  // Analyse up to ~60 s for speed.
  const maxLen = Math.min(ch0.length, Math.floor(sr * 60))
  const mono = new Float32Array(maxLen)
  for (let i = 0; i < maxLen; i++) mono[i] = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i]

  // ── Onset envelope (energy difference) ──
  const hop = 512
  const frames = Math.floor(maxLen / hop)
  const env = new Float32Array(frames)
  let prev = 0
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let k = 0; k < hop; k++) { const s = mono[f * hop + k]; e += s * s }
    env[f] = Math.max(0, e - prev)
    prev = e
  }
  const envFps = sr / hop
  // Autocorrelation → BPM
  const mean = env.reduce((a, b) => a + b, 0) / env.length
  const d = new Float32Array(frames); for (let i = 0; i < frames; i++) d[i] = env[i] - mean
  const minLag = Math.round(envFps * 60 / 180), maxLag = Math.round(envFps * 60 / 70)
  let best = -Infinity, bestLag = minLag
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0; for (let i = 0; i + lag < frames; i++) s += d[i] * d[i + lag]
    if (s > best) { best = s; bestLag = lag }
  }
  let bpm = 60 * envFps / bestLag
  while (bpm < 70) bpm *= 2; while (bpm > 180) bpm /= 2
  bpm = Math.round(bpm * 10) / 10
  // Beat offset (phase): best alignment of a beat pulse train with the envelope.
  const beatFrames = (60 / bpm) * envFps
  let bestOff = 0, bestScore = -Infinity
  for (let off = 0; off < beatFrames; off += 1) {
    let s = 0
    for (let p = off; p < frames; p += beatFrames) s += env[Math.floor(p)] || 0
    if (s > bestScore) { bestScore = s; bestOff = off }
  }
  const offset = bestOff / envFps

  // ── Key via chromagram + Krumhansl correlation ──
  const N = 4096
  const re = new Float32Array(N), im = new Float32Array(N)
  const chroma = new Float32Array(12)
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))
  for (let pos = 0; pos + N < maxLen; pos += N) {
    for (let i = 0; i < N; i++) { re[i] = mono[pos + i] * win[i]; im[i] = 0 }
    fft(re, im)
    for (let bin = 2; bin < N / 2; bin++) {
      const freq = bin * sr / N
      if (freq < 55 || freq > 5000) continue
      const mag = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin])
      const midi = Math.round(69 + 12 * Math.log2(freq / 440))
      const pc = ((midi % 12) + 12) % 12
      chroma[pc] += mag
    }
  }
  // Correlate
  const corr = (prof: number[], rot: number) => {
    let s = 0; for (let i = 0; i < 12; i++) s += chroma[(i + rot) % 12] * prof[i]; return s
  }
  let bestKey: string | null = null, bestKeyScore = -Infinity
  const chromaSum = chroma.reduce((a, b) => a + b, 0)
  if (chromaSum > 0) {
    for (let t = 0; t < 12; t++) {
      const maj = corr(KRUMHANSL_MAJ, t), min = corr(KRUMHANSL_MIN, t)
      if (maj > bestKeyScore) { bestKeyScore = maj; bestKey = `${CAMELOT_MAJ[t]} · ${NOTE_NAMES[t]}` }
      if (min > bestKeyScore) { bestKeyScore = min; bestKey = `${CAMELOT_MIN[t]} · ${NOTE_NAMES[t]}m` }
    }
  }

  // ── Peak/low-band waveform over the WHOLE track (for the overview display) ──
  const BUCKETS = 1600
  const peak = new Float32Array(BUCKETS), low = new Float32Array(BUCKETS)
  const total = ch0.length
  const per = Math.max(1, Math.floor(total / BUCKETS))
  let lp = 0
  for (let bk = 0; bk < BUCKETS; bk++) {
    const s0 = bk * per, s1 = Math.min(total, s0 + per)
    let p = 0, lo = 0
    for (let i = s0; i < s1; i++) {
      const v = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i]
      const a = Math.abs(v); if (a > p) p = a
      lp += (v - lp) * 0.02   // one-pole low-pass for band ratio
      lo += Math.abs(lp)
    }
    peak[bk] = p
    low[bk] = s1 > s0 ? lo / (s1 - s0) : 0
  }
  return { bpm, offset, key: bestKey, peaks: { peak, low } }
}

// Headphone CUE controls.
function setCueDeck(deck: DeckId, on: boolean) { const g = _cueDeckGain[deck]; if (g) g.gain.value = on ? 1 : 0 }
function setCueMixGain(v: number) { if (_cueMasterGain) _cueMasterGain.gain.value = Math.max(0, Math.min(1, v)) }
async function setHeadphoneDevice(id: string) {
  // Move the WHOLE console output to the chosen device (AudioContext.setSinkId,
  // Chrome 110+) — the old code only moved the cue/PFL element, which is silent
  // unless a deck is cued, so the selector appeared to have no effect.
  const ctx = _djCtx as (AudioContext & { setSinkId?: (id: string | { type: 'none' }) => Promise<void> }) | null
  if (ctx?.setSinkId) {
    try { await ctx.setSinkId(id) } catch (e) { console.warn('AudioContext.setSinkId failed:', e) }
  }
  // Keep the cue/PFL element on the same device so monitoring follows the output.
  const a = _cueAudio as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
  if (a?.setSinkId) { try { await a.setSinkId(id); a.play().catch(() => {}) } catch { /* */ } }
}

// ── MIDI controller mapping (Web MIDI + learn) ─────────────────────────────────

export const MIDI_TARGETS: { id: string; label: string; kind: 'cc' | 'note' }[] = [
  { id: 'crossfader', label: 'Crossfader',  kind: 'cc' },
  { id: 'masterVol',  label: 'Volume master', kind: 'cc' },
  { id: 'volumeA', label: 'Volume A', kind: 'cc' }, { id: 'volumeB', label: 'Volume B', kind: 'cc' },
  { id: 'trimA',   label: 'Trim A',   kind: 'cc' }, { id: 'trimB',   label: 'Trim B',   kind: 'cc' },
  { id: 'tempoA',  label: 'Tempo A',  kind: 'cc' }, { id: 'tempoB',  label: 'Tempo B',  kind: 'cc' },
  { id: 'eqHighA', label: 'EQ Aigus A', kind: 'cc' }, { id: 'eqMidA', label: 'EQ Médiums A', kind: 'cc' }, { id: 'eqLowA', label: 'EQ Graves A', kind: 'cc' },
  { id: 'eqHighB', label: 'EQ Aigus B', kind: 'cc' }, { id: 'eqMidB', label: 'EQ Médiums B', kind: 'cc' }, { id: 'eqLowB', label: 'EQ Graves B', kind: 'cc' },
  { id: 'colorA',  label: 'Color A',  kind: 'cc' }, { id: 'colorB',  label: 'Color B',  kind: 'cc' },
  { id: 'playA',   label: 'Play A',   kind: 'note' }, { id: 'playB',  label: 'Play B',  kind: 'note' },
  { id: 'cueA',    label: 'Cue A',    kind: 'note' }, { id: 'cueB',   label: 'Cue B',   kind: 'note' },
  { id: 'syncA',   label: 'Sync A',   kind: 'note' }, { id: 'syncB',  label: 'Sync B',  kind: 'note' },
]

const DJ_MIDI_KEY = 'kubuno:dj:midi'
function loadMidiMap(): Record<string, string> { try { return JSON.parse(localStorage.getItem(DJ_MIDI_KEY) || '{}') } catch { return {} } }
function saveMidiMap(map: Record<string, string>) { try { localStorage.setItem(DJ_MIDI_KEY, JSON.stringify(map)) } catch { /* */ } }
const _midiMap0 = loadMidiMap()

let _midiAccess: MIDIAccess | null = null
function initMidi(handler: (key: string, value: number, isNote: boolean) => void): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) return Promise.resolve(false)
  return navigator.requestMIDIAccess().then((access) => {
    _midiAccess = access
    const attach = () => access.inputs.forEach((inp) => {
      inp.onmidimessage = (e: MIDIMessageEvent) => {
        if (!e.data) return
        const status = e.data[0], d1 = e.data[1], d2 = e.data[2]
        const type = status & 0xf0, ch = status & 0x0f
        if (type === 0xB0) handler(`cc-${ch}-${d1}`, d2 / 127, false)
        else if (type === 0x90 && d2 > 0) handler(`note-${ch}-${d1}`, 1, true)
      }
    })
    attach()
    access.onstatechange = attach
    return true
  }).catch(() => false)
}
function detachMidi() {
  if (_midiAccess) { _midiAccess.inputs.forEach((inp) => { inp.onmidimessage = null }); _midiAccess.onstatechange = null }
}
function applyMidiTarget(target: string, v: number, _isNote: boolean, get: () => DJStoreState) {
  const s = get()
  const eqVal = (x: number) => -12 + x * 18
  switch (target) {
    case 'crossfader': s.setCrossfader(v * 2 - 1); break
    case 'masterVol':  s.setMasterVol(v); break
    case 'volumeA': s.setVolume('A', v); break
    case 'volumeB': s.setVolume('B', v); break
    case 'trimA': s.setGain('A', v * 2); break
    case 'trimB': s.setGain('B', v * 2); break
    case 'tempoA': s.setPitch('A', (v * 2 - 1) * s.deckA.tempoRange); break
    case 'tempoB': s.setPitch('B', (v * 2 - 1) * s.deckB.tempoRange); break
    case 'eqHighA': s.setEq('A', 'high', eqVal(v)); break
    case 'eqMidA':  s.setEq('A', 'mid',  eqVal(v)); break
    case 'eqLowA':  s.setEq('A', 'low',  eqVal(v)); break
    case 'eqHighB': s.setEq('B', 'high', eqVal(v)); break
    case 'eqMidB':  s.setEq('B', 'mid',  eqVal(v)); break
    case 'eqLowB':  s.setEq('B', 'low',  eqVal(v)); break
    case 'colorA': s.setColor('A', v * 2 - 1); break
    case 'colorB': s.setColor('B', v * 2 - 1); break
    case 'playA': s.togglePlay('A'); break
    case 'playB': s.togglePlay('B'); break
    case 'cueA': s.pressCue('A'); break
    case 'cueB': s.pressCue('B'); break
    case 'syncA': s.syncDeck('A'); break
    case 'syncB': s.syncDeck('B'); break
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HotCue {
  position: number
  color:    string
  label?:   string
}

export type PadMode = 'hotcue' | 'beatloop' | 'beatjump' | 'sliploop'
export type ColorFx = 'filter' | 'noise' | 'crush' | 'echo'

export interface DeckState {
  track:      PlayerTrack | null
  isPlaying:  boolean
  isLoading:  boolean
  position:   number
  duration:   number
  pitch:      number          // tempo % (range = tempoRange)
  tempoRange: number          // ± range in % (6 | 10 | 16 | 100)
  bpm:        number | null   // tapped BPM (manual)
  eqLow:      number          // dB -12..+6
  eqMid:      number
  eqHigh:     number
  gain:       number          // 0..2 (TRIM)
  volume:     number          // 0..1
  filter:     number          // -1..1 (DJ filter knob)
  echo:       number          // 0..1 (echo send)
  reverb:     number          // 0..1 (reverb send)
  color:      number          // -1..1 (SOUND COLOR FX)
  colorFx:    ColorFx         // selected colour effect
  stem:       StemMode        // vocal / instrumental isolation
  padMode:    PadMode
  keylock:    boolean         // Master Tempo (preserve pitch when changing tempo)
  slip:       boolean         // Slip mode
  vinyl:      boolean         // jog = scratch (true) or pitch-bend (false)
  cue:        boolean         // headphone CUE / PFL on this deck
  keyName:    string | null   // detected musical key (Camelot · name)
  beatOffset: number          // first-beat offset in seconds (beatgrid phase)
  shuffle:    boolean         // random queue advance
  repeatMode: 'off' | 'all' | 'one'
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
  position: 0, duration: 0, pitch: 0, tempoRange: 10, bpm: null,
  eqLow: 0, eqMid: 0, eqHigh: 0, gain: 1, volume: 1,
  filter: 0, echo: 0, reverb: 0, color: 0, colorFx: 'filter',
  stem: 'full',
  padMode: 'hotcue',
  keylock: false, slip: false, vinyl: true, cue: false, keyName: null, beatOffset: 0,
  shuffle: false, repeatMode: 'off',
  isLooping: false, loopIn: null, loopOut: null,
  hotCues: Array(8).fill(null), cuePoint: 0,
  queue: [], queueIndex: -1,
}

interface DJStoreState {
  deckA:        DeckState
  deckB:        DeckState
  deckC:        DeckState
  deckD:        DeckState
  deckE:        DeckState
  deckF:        DeckState
  deckCount:    DeckCount
  xfAssign:     Record<DeckId, XfAssign>
  zoomWave:     boolean        // CDJ-style zoomed scrolling waveform
  separating:   DeckId | null  // deck currently being offline-separated
  sepProgress:  number         // 0..1 offline separation progress
  stemTick:     number         // bumped when a deck's HQ stems become ready
  crossfader:   number
  masterVolume: number
  crossfaderCurve: CrossfaderCurve
  isRecording:  boolean
  eq:           EqSettings
  waveStyle:    WaveStyle
  beatFx:       BeatFxState
  quantize:        boolean
  faderStart:      boolean
  crossfaderReverse: boolean
  masterLimiter:   boolean
  masterMono:      boolean
  autoMix:         boolean
  micOn:           boolean
  talkover:        boolean
  cueMix:          number
  headphoneId:     string
  bpmDetecting:    DeckId | null
  analyzing:       DeckId | null
  sampleRecording: number     // slot index being recorded, -1 = none
  history:         { title: string; artist: string; deck: DeckId; key: string | null; bpm: number | null }[]
  transitionStyle: TransitionStyle
  configNames:     string[]
  midiEnabled:     boolean
  midiSupported:   boolean
  midiLearn:       string | null
  midiMap:         Record<string, string>

  setDeckCount: (n: DeckCount) => void
  setXfAssign:  (deck: DeckId, assign: XfAssign) => void
  setStem:      (deck: DeckId, mode: StemMode) => void
  separateStem: (deck: DeckId) => void
  toggleZoomWave: () => void
  autoDjQueue:  (deck: DeckId, tracks: PlayerTrack[]) => void
  loadTrack:    (deck: DeckId, track: PlayerTrack) => void
  loadQueue:    (deck: DeckId, tracks: PlayerTrack[], startIndex?: number) => void
  importFromPlayer: (deck: DeckId, tracks: PlayerTrack[], startIndex: number, position: number, play: boolean) => void
  nextTrack:    (deck: DeckId) => void
  prevTrack:    (deck: DeckId) => void
  toggleShuffle:(deck: DeckId) => void
  cycleRepeat:  (deck: DeckId) => void
  playQueueIndex:  (deck: DeckId, idx: number) => void
  removeQueueItem: (deck: DeckId, idx: number) => void
  moveQueueItem:   (deck: DeckId, from: number, to: number) => void
  moveQueueAcross: (fromDeck: DeckId, fromIdx: number, toDeck: DeckId, toIdx: number) => void
  clearQueue:      (deck: DeckId) => void
  togglePlay:   (deck: DeckId) => void
  seek:         (deck: DeckId, secs: number) => void
  setPitch:     (deck: DeckId, st: number) => void
  setEq:        (deck: DeckId, band: 'low' | 'mid' | 'high', db: number) => void
  setGain:      (deck: DeckId, v: number) => void
  setVolume:    (deck: DeckId, v: number) => void
  setFilter:    (deck: DeckId, v: number) => void
  setEcho:      (deck: DeckId, v: number) => void
  setReverb:    (deck: DeckId, v: number) => void
  beatJump:     (deck: DeckId, secs: number) => void
  quickLoop:    (deck: DeckId, secs: number) => void
  scratchStart: (deck: DeckId) => void
  scratchMove:  (deck: DeckId, deltaSecs: number) => void
  scratchEnd:   (deck: DeckId) => void
  setColor:     (deck: DeckId, v: number) => void
  setColorFx:   (deck: DeckId, fx: ColorFx) => void
  setPadMode:   (deck: DeckId, mode: PadMode) => void
  triggerPad:   (deck: DeckId, i: number) => void
  releasePad:   (deck: DeckId, i: number) => void
  setTempoRange:(deck: DeckId, pct: number) => void
  tapBpm:       (deck: DeckId) => void
  setCrossfaderCurve: (c: CrossfaderCurve) => void
  updateEq:     (patch: Partial<EqSettings>) => void
  setEqPreset:  (name: string) => void
  resetEq:      () => void
  setWaveStyle: (s: WaveStyle) => void
  setBeatFx:    (patch: Partial<BeatFxState>) => void
  setKeylock:   (deck: DeckId, on: boolean) => void
  toggleSlip:   (deck: DeckId) => void
  toggleVinyl:  (deck: DeckId) => void
  nudge:        (deck: DeckId, dir: number) => void
  nudgeEnd:     (deck: DeckId) => void
  brake:        (deck: DeckId) => void
  syncDeck:     (deck: DeckId) => void
  censor:       (deck: DeckId, on: boolean) => void
  setQuantize:  (on: boolean) => void
  setFaderStart:(on: boolean) => void
  toggleCrossfaderReverse: () => void
  toggleLimiter: () => void
  toggleMono:    () => void
  moveLoop:      (deck: DeckId, dir: number) => void
  instantDouble: (deck: DeckId) => void
  setAutoMix:    (on: boolean) => void
  toggleMic:     () => void
  setTalkover:   (on: boolean) => void
  playSample:    (i: number) => void
  recordSample:  (i: number) => void
  toggleCue:     (deck: DeckId) => void
  setCueMix:     (v: number) => void
  setHeadphoneDevice: (id: string) => void
  autoBpm:       (deck: DeckId) => void
  analyzeTrack:  (deck: DeckId) => void
  exportSetlist: () => void
  setTransitionStyle: (s: TransitionStyle) => void
  transitionNow: () => void
  saveConfig:    (name: string) => void
  loadConfig:    (name: string) => void
  deleteConfig:  (name: string) => void
  toggleMidi:    () => void
  startMidiLearn:(target: string) => void
  clearMidiTarget: (target: string) => void
  panic:         () => void
  setHotCueColor:(deck: DeckId, i: number, color: string) => void
  setHotCueLabel:(deck: DeckId, i: number, label: string) => void
  toggleRecording: () => void
  pressCue:     (deck: DeckId) => void
  pressHotCue:  (deck: DeckId, i: number) => void
  deleteHotCue: (deck: DeckId, i: number) => void
  setLoopIn:    (deck: DeckId) => void
  setLoopOut:   (deck: DeckId) => void
  toggleLoop:   (deck: DeckId) => void
  halveLoop:    (deck: DeckId) => void
  doubleLoop:   (deck: DeckId) => void
  setCrossfader:  (v: number) => void
  setMasterVol:   (v: number) => void

  _persistCues: (deck: DeckId) => void
  _logHistory:  (deck: DeckId) => void
  _tick:        (deck: DeckId, pos: number) => void
  _setDuration: (deck: DeckId, dur: number) => void
  _setPlaying:  (deck: DeckId, v: boolean) => void
  _setLoading:  (deck: DeckId, v: boolean) => void
}

// ── Helper ────────────────────────────────────────────────────────────────────

type DeckKey = 'deckA' | 'deckB' | 'deckC' | 'deckD' | 'deckE' | 'deckF'

const _dkMap: Record<DeckId, DeckKey> = {
  A: 'deckA', B: 'deckB', C: 'deckC', D: 'deckD', E: 'deckE', F: 'deckF',
}
function dk(deck: DeckId): DeckKey { return _dkMap[deck] }
function engine(deck: DeckId) { return _engines[deck] }

// ── Session persistence ───────────────────────────────────────────────────────

const DJ_SESSION_KEY = 'kubuno:dj'

type DJSnapDeck = { track: PlayerTrack | null; queue: PlayerTrack[]; queueIndex: number; position: number; pitch: number; eqLow: number; eqMid: number; eqHigh: number; gain: number; volume: number; isPlaying: boolean }
type DJSnapshot = {
  deckA: DJSnapDeck
  deckB: DJSnapDeck
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

// ── User preferences (persist across full reloads, not just the session) ───────

const DJ_PREFS_KEY = 'kubuno:dj:prefs'
type DJPrefs = { waveStyle?: WaveStyle; crossfaderCurve?: CrossfaderCurve; masterVolume?: number; eqPreset?: string; deckCount?: DeckCount; zoomWave?: boolean }
function loadDJPrefs(): DJPrefs {
  try { const s = localStorage.getItem(DJ_PREFS_KEY); return s ? JSON.parse(s) as DJPrefs : {} } catch { return {} }
}
const _djPrefs = loadDJPrefs()
function saveDJPrefs(p: DJPrefs) {
  try { localStorage.setItem(DJ_PREFS_KEY, JSON.stringify({ ..._djPrefs, ...p })) } catch { /* */ }
  Object.assign(_djPrefs, p)
}

// ── Per-track cue memory (hot cues + analysis) persisted by track id ───────────

const DJ_CUES_KEY = 'kubuno:dj:cues'
interface TrackMeta { hotCues: (HotCue | null)[]; bpm: number | null; keyName: string | null; beatOffset: number }
function loadCueStore(): Record<string, TrackMeta> {
  try { return JSON.parse(localStorage.getItem(DJ_CUES_KEY) || '{}') as Record<string, TrackMeta> } catch { return {} }
}
const _cueStore = loadCueStore()
function saveTrackMeta(id: string, meta: TrackMeta) {
  _cueStore[id] = meta
  try { localStorage.setItem(DJ_CUES_KEY, JSON.stringify(_cueStore)) } catch { /* */ }
}
function trackMeta(id: string | undefined): TrackMeta | undefined { return id ? _cueStore[id] : undefined }

// ── Full console configurations (named presets) ───────────────────────────────

const DJ_CONFIG_KEY = 'kubuno:dj:configs'
interface DJConfig {
  eq: EqSettings; beatFx: BeatFxState; waveStyle: WaveStyle; crossfaderCurve: CrossfaderCurve
  masterVolume: number; quantize: boolean; faderStart: boolean; crossfaderReverse: boolean
  masterLimiter: boolean; masterMono: boolean; autoMix: boolean; transitionStyle: TransitionStyle
  decks: Record<'A' | 'B', { tempoRange: number; keylock: boolean; vinyl: boolean }>
}
function loadConfigStore(): Record<string, DJConfig> {
  try { return JSON.parse(localStorage.getItem(DJ_CONFIG_KEY) || '{}') as Record<string, DJConfig> } catch { return {} }
}
const _configStore = loadConfigStore()
function persistConfigStore() { try { localStorage.setItem(DJ_CONFIG_KEY, JSON.stringify(_configStore)) } catch { /* */ } }

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
    isPlaying:  !!snap.isPlaying,
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
  // Wire audio element events for every deck
  for (const deck of ALL_DECKS) {
    const eng = engine(deck)
    eng.audio.addEventListener('timeupdate', () => {
      get()._tick(deck, eng.audio.currentTime)
    })
    eng.audio.addEventListener('durationchange', () => {
      if (isFinite(eng.audio.duration)) get()._setDuration(deck, eng.audio.duration)
    })
    eng.audio.addEventListener('ended', () => {
      const st = get()[dk(deck)]
      if (st.repeatMode === 'one') { eng.audio.currentTime = 0; eng.audio.play().catch(() => {}); return }
      const canAdvance = st.queue.length > 0 &&
        (st.shuffle || st.queueIndex < st.queue.length - 1 || st.repeatMode === 'all')
      if (canAdvance) get().nextTrack(deck)
      else get()._setPlaying(deck, false)
    })
    eng.audio.addEventListener('canplay', () => get()._setLoading(deck, false))
    eng.audio.addEventListener('play', () => get()._logHistory(deck))
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
      isPlaying:  d.isPlaying,
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

  // After an F5: re-apply the restored mixer/deck settings to the audio graph
  // and resume playback. Browsers gate autoplay + AudioContext behind a user
  // gesture, so we try immediately and otherwise resume on the first interaction.
  if (_djSnap && (_djSnap.deckA.isPlaying || _djSnap.deckB.isPlaying)) {
    const resume = () => {
      initDJContext()
      const s = get()
      applyCrossfader(s.crossfader)
      if (_djMaster) _djMaster.gain.value = Math.max(0, Math.min(1, s.masterVolume))
      for (const d of ['A', 'B'] as const) {
        const st = s[dk(d)]
        const eng = engine(d)
        eng.setEq('low', st.eqLow); eng.setEq('mid', st.eqMid); eng.setEq('high', st.eqHigh)
        eng.setGain(st.gain)
        eng.audio.volume = st.volume
        eng.audio.playbackRate = Math.max(0.06, Math.min(4, 1 + st.pitch / 100))
        if (st.isPlaying) {
          eng.audio.play().then(() => get()._setPlaying(d, true)).catch(() => {})
        }
      }
      void _djCtx?.resume()
    }
    // Deferred so the store state exists before resume() reads it via get().
    setTimeout(resume, 0)
    // Fallback: re-attempt on the first user gesture (covers blocked autoplay).
    const onGesture = () => {
      resume()
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
    window.addEventListener('pointerdown', onGesture, { once: true })
    window.addEventListener('keydown', onGesture, { once: true })
  }

  const snapA = _djSnap?.deckA
  const snapB = _djSnap?.deckB

  // Apply the persisted crossfader curve to the audio engine.
  _cfCurve = _djPrefs.crossfaderCurve ?? 'smooth'
  // Restore the persisted deck count (2 / 4 / 6).
  _deckCount = (_djPrefs.deckCount && DECK_COUNTS.includes(_djPrefs.deckCount)) ? _djPrefs.deckCount : 2

  return {
    deckA: snapA ? restoredDeck(snapA) : { ...DEFAULT_DECK },
    deckB: snapB ? restoredDeck(snapB) : { ...DEFAULT_DECK },
    deckC: { ...DEFAULT_DECK },
    deckD: { ...DEFAULT_DECK },
    deckE: { ...DEFAULT_DECK },
    deckF: { ...DEFAULT_DECK },
    deckCount: _deckCount,
    xfAssign: { ..._xfAssign },
    zoomWave: _djPrefs.zoomWave ?? false,
    separating: null, sepProgress: 0, stemTick: 0,
    crossfader:   _djSnap?.crossfader   ?? 0,
    masterVolume: _djSnap?.masterVolume ?? _djPrefs.masterVolume ?? 0.8,
    crossfaderCurve: _djPrefs.crossfaderCurve ?? 'smooth',
    isRecording:  false,
    eq: { bands: Array(10).fill(0), preset: 'FLAT', bypass: false, gain: 0, amplifier: false, compressor: false, deepBass: 0, surround: 0, balance: 0 },
    waveStyle: _djPrefs.waveStyle ?? 'blob',
    beatFx: { on: false, type: 'echo', beat: 1, depth: 0.5, channel: 'master' },
    quantize: false, faderStart: false, crossfaderReverse: false, masterLimiter: false, masterMono: false, autoMix: false,
    micOn: false, talkover: false, cueMix: 0, headphoneId: '', bpmDetecting: null, analyzing: null, sampleRecording: -1, history: [],
    transitionStyle: 'fade', configNames: Object.keys(_configStore),
    midiEnabled: false, midiSupported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
    midiLearn: null, midiMap: _midiMap0,

    setDeckCount(n) {
      _deckCount = n
      saveDJPrefs({ deckCount: n })
      set({ deckCount: n })
    },
    setXfAssign(deck, assign) {
      _xfAssign[deck] = assign
      applyCrossfader(get().crossfader)
      set(s => ({ xfAssign: { ...s.xfAssign, [deck]: assign } }))
    },
    setStem(deck, mode) {
      initDJContext()
      const st = get()[dk(deck)]
      const id = st.track?.id
      const hq = id ? _stemCache[id] : undefined
      const eng = engine(deck)
      const orig = st.track ? (st.track.streamUrl ?? `/api/v1/media/audio/${id}/stream`) : null
      if (hq && (mode === 'acapella' || mode === 'instrumental')) {
        // HQ stems available → play the pre-separated source, keep the live processor dry.
        eng.setStem('full')
        eng.setStemSource(mode === 'acapella' ? hq.vocal : hq.instrumental, true)
      } else {
        // Restore the original source if we had swapped, then use the live separator.
        if (eng.onStem && orig) eng.setStemSource(orig, false)
        eng.setStem(mode)
      }
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], stem: mode } }))
    },
    separateStem(deck) {
      const st = get()[dk(deck)]
      if (!st.track || get().separating) return
      const track = st.track, id = track.id
      if (_stemCache[id]) {           // already separated → just (re)apply current mode
        if (st.stem !== 'full') get().setStem(deck, st.stem)
        set(s => ({ stemTick: s.stemTick + 1 }))
        return
      }
      initDJContext()
      if (!_djCtx) return
      set({ separating: deck, sepProgress: 0 })
      const url = track.streamUrl ?? `/api/v1/media/audio/${id}/stream`
      ;(async () => {
        try {
          const resp = await fetch(url)
          const arr  = await resp.arrayBuffer()
          const buf  = await _djCtx!.decodeAudioData(arr)
          const out  = await separateOffline(buf, p => set({ sepProgress: p }))
          _stemCache[id] = {
            vocal:        encodeWavUrl(out.vocal, buf.sampleRate),
            instrumental: encodeWavUrl(out.instrumental, buf.sampleRate),
          }
          set(s => ({ separating: null, sepProgress: 1, stemTick: s.stemTick + 1 }))
          // If a stem is already selected on this deck, switch it to the HQ source now.
          const cur = get()[dk(deck)]
          if (cur.track?.id === id && cur.stem !== 'full') get().setStem(deck, cur.stem)
        } catch (e) { console.warn('Offline separation failed:', e); set({ separating: null }) }
      })()
    },
    toggleZoomWave() {
      set(s => { const v = !s.zoomWave; saveDJPrefs({ zoomWave: v }); return { zoomWave: v } })
    },
    autoDjQueue(deck, tracks) {
      if (tracks.length === 0) return
      const ordered = buildAutoDjQueue(tracks)
      get().loadQueue(deck, ordered, 0)
    },

    loadTrack(deck, track) {
      initDJContext()
      const eng = engine(deck)
      eng.audio.pause()
      eng.audio.src = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
      eng.audio.load()
      eng.onStem = false; eng.setStem('full')   // new track = original source, no stem yet
      const k = dk(deck)
      const m = trackMeta(track.id)
      set(s => ({
        [k]: {
          ...s[k],
          track, isPlaying: false, isLoading: true, stem: 'full',
          position: 0, duration: track.durationSecs,
          cuePoint: 0, hotCues: m?.hotCues ?? Array(8).fill(null),
          bpm: m?.bpm ?? null, keyName: m?.keyName ?? null, beatOffset: m?.beatOffset ?? 0,
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
      eng.onStem = false; eng.setStem('full')
      const k = dk(deck)
      const m = trackMeta(track.id)
      set(s => ({
        [k]: {
          ...s[k],
          track, isPlaying: false, isLoading: true, stem: 'full',
          position: 0, duration: track.durationSecs,
          cuePoint: 0, hotCues: m?.hotCues ?? Array(8).fill(null),
          bpm: m?.bpm ?? null, keyName: m?.keyName ?? null, beatOffset: m?.beatOffset ?? 0,
          isLooping: false, loopIn: null, loopOut: null,
          queue: tracks, queueIndex: idx,
        }
      }))
    },

    importFromPlayer(deck, tracks, startIndex, position, play) {
      if (!tracks || tracks.length === 0) return
      initDJContext()
      get().loadQueue(deck, tracks, startIndex)
      // Once the swapped track is ready, restore the playhead position and resume
      // playback if it was playing in the floating player.
      const eng = engine(deck)
      const apply = () => {
        try { if (position > 0) eng.audio.currentTime = position } catch { /* not seekable yet */ }
        if (play) eng.audio.play().then(() => get()._setPlaying(deck, true)).catch(() => {})
        eng.audio.removeEventListener('canplay', apply)
      }
      eng.audio.addEventListener('canplay', apply, { once: true })
    },

    toggleShuffle(deck) { set(s => ({ [dk(deck)]: { ...s[dk(deck)], shuffle: !s[dk(deck)].shuffle } })) },
    cycleRepeat(deck) {
      const order = ['off', 'all', 'one'] as const
      set(s => { const m = s[dk(deck)].repeatMode; const next = order[(order.indexOf(m) + 1) % 3]; return { [dk(deck)]: { ...s[dk(deck)], repeatMode: next } } })
    },
    nextTrack(deck) {
      const k  = dk(deck)
      const st = get()[k]
      if (st.queue.length === 0) return
      let idx: number
      if (st.shuffle && st.queue.length > 1) {
        do { idx = Math.floor(Math.random() * st.queue.length) } while (idx === st.queueIndex)
      } else if (st.queueIndex < st.queue.length - 1) {
        idx = st.queueIndex + 1
      } else if (st.repeatMode === 'all') {
        idx = 0
      } else { return }
      const track = st.queue[idx]
      const eng   = engine(deck)
      eng.audio.pause()
      eng.audio.src = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
      eng.audio.load()
      eng.audio.play().catch(() => {})
      const m = trackMeta(track.id)
      set(s => ({
        [k]: {
          ...s[k],
          track, isPlaying: true, isLoading: true,
          position: 0, duration: track.durationSecs,
          queueIndex: idx,
          cuePoint: 0, hotCues: m?.hotCues ?? Array(8).fill(null),
          bpm: m?.bpm ?? null, keyName: m?.keyName ?? null, beatOffset: m?.beatOffset ?? 0,
          isLooping: false, loopIn: null, loopOut: null,
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
      const m = trackMeta(track.id)
      set(s => ({
        [k]: {
          ...s[k],
          track, isLoading: true,
          position: 0, duration: track.durationSecs,
          queueIndex: idx,
          cuePoint: 0, hotCues: m?.hotCues ?? Array(8).fill(null),
          bpm: m?.bpm ?? null, keyName: m?.keyName ?? null, beatOffset: m?.beatOffset ?? 0,
          isLooping: false, loopIn: null, loopOut: null,
        }
      }))
    },

    playQueueIndex(deck, idx) {
      initDJContext()
      const k  = dk(deck)
      const st = get()[k]
      if (idx < 0 || idx >= st.queue.length) return
      const track = st.queue[idx]
      const eng   = engine(deck)
      eng.audio.pause()
      eng.audio.src = track.streamUrl ?? `/api/v1/media/audio/${track.id}/stream`
      eng.audio.load()
      eng.audio.play().catch(() => {})
      const m = trackMeta(track.id)
      set(s => ({
        [k]: {
          ...s[k], track, isPlaying: true, isLoading: true,
          position: 0, duration: track.durationSecs, queueIndex: idx,
          cuePoint: 0, hotCues: m?.hotCues ?? Array(8).fill(null),
          bpm: m?.bpm ?? null, keyName: m?.keyName ?? null, beatOffset: m?.beatOffset ?? 0,
          isLooping: false, loopIn: null, loopOut: null,
        }
      }))
    },

    removeQueueItem(deck, idx) {
      const k  = dk(deck)
      set(s => {
        const st = s[k]
        if (idx < 0 || idx >= st.queue.length) return {}
        const queue = st.queue.filter((_, i) => i !== idx)
        let queueIndex = st.queueIndex
        if (idx < st.queueIndex) queueIndex--
        else if (idx === st.queueIndex) queueIndex = Math.min(queueIndex, queue.length - 1)
        return { [k]: { ...st, queue, queueIndex } }
      })
    },

    moveQueueItem(deck, from, to) {
      const k = dk(deck)
      set(s => {
        const st = s[k]
        if (from < 0 || from >= st.queue.length || to < 0 || to >= st.queue.length || from === to) return {}
        const queue = [...st.queue]
        const [it] = queue.splice(from, 1)
        queue.splice(to, 0, it)
        // Keep queueIndex pointing at the currently loaded track.
        let queueIndex = st.queueIndex
        if (from === st.queueIndex) queueIndex = to
        else {
          if (from < queueIndex) queueIndex--
          if (to <= queueIndex) queueIndex++
        }
        return { [k]: { ...st, queue, queueIndex } }
      })
    },

    moveQueueAcross(fromDeck, fromIdx, toDeck, toIdx) {
      if (fromDeck === toDeck) { get().moveQueueItem(fromDeck, fromIdx, toIdx); return }
      const fk = dk(fromDeck), tk = dk(toDeck)
      set(s => {
        const fq = [...s[fk].queue]
        if (fromIdx < 0 || fromIdx >= fq.length) return {}
        const [it] = fq.splice(fromIdx, 1)
        const tq = [...s[tk].queue]
        const ins = Math.max(0, Math.min(toIdx, tq.length))
        tq.splice(ins, 0, it)
        let fI = s[fk].queueIndex
        if (fromIdx < fI) fI--; else if (fromIdx === fI) fI = Math.min(fI, fq.length - 1)
        let tI = s[tk].queueIndex
        if (ins <= tI) tI++
        return {
          [fk]: { ...s[fk], queue: fq, queueIndex: fI },
          [tk]: { ...s[tk], queue: tq, queueIndex: tI },
        }
      })
    },
    clearQueue(deck) {
      const k = dk(deck)
      set(s => ({ [k]: { ...s[k], queue: [], queueIndex: -1 } }))
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

    setPitch(deck, pct) {
      // `pct` is a tempo percentage (XDJ-style). playbackRate = 1 + pct/100.
      engine(deck).audio.playbackRate = Math.max(0.06, Math.min(4, 1 + pct / 100))
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], pitch: pct } }))
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
      const eng = engine(deck)
      const k   = dk(deck)
      const st  = get()[k]
      eng.audio.volume = v
      // Fader start: opening the channel fader starts the deck; closing it
      // pauses and returns to the cue point (classic CDJ behaviour).
      if (get().faderStart && st.track) {
        if (v > 0.02 && !st.isPlaying) {
          eng.audio.play().catch(() => {})
          set(s => ({ [k]: { ...s[k], isPlaying: true, volume: v } }))
          return
        } else if (v <= 0.02 && st.isPlaying) {
          eng.audio.pause()
          eng.audio.currentTime = st.cuePoint
          set(s => ({ [k]: { ...s[k], isPlaying: false, position: st.cuePoint, volume: v } }))
          return
        }
      }
      set(s => ({ [k]: { ...s[k], volume: v } }))
    },

    setFilter(deck, v) {
      engine(deck).setFilter(v)
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], filter: v } }))
    },
    setEcho(deck, v) {
      engine(deck).setEcho(v)
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], echo: v } }))
    },
    setReverb(deck, v) {
      engine(deck).setReverb(v)
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], reverb: v } }))
    },
    beatJump(deck, secs) {
      const eng = engine(deck)
      const st  = get()[dk(deck)]
      const dur = st.duration || eng.audio.duration || 0
      let t = Math.max(0, Math.min(dur || eng.audio.currentTime + secs, eng.audio.currentTime + secs))
      if (get().quantize && st.bpm && st.bpm > 0) { const bs = 60 / st.bpm; t = Math.round(t / bs) * bs }
      eng.audio.currentTime = t
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], position: t } }))
    },
    quickLoop(deck, secs) {
      const k  = dk(deck)
      const st = get()[k]
      let inP = st.position
      if (get().quantize && st.bpm && st.bpm > 0) { const bs = 60 / st.bpm; inP = Math.round(inP / bs) * bs }
      if (st.slip) { const eng = engine(deck); eng.slipActive = true; eng.slipPos = st.position; eng.slipLastT = performance.now() }
      set(s => ({ [k]: { ...s[k], loopIn: inP, loopOut: inP + secs, isLooping: true } }))
    },
    scratchStart(deck) {
      const eng = engine(deck)
      const st  = get()[dk(deck)]
      if (!st.track) return
      eng.scratchBase       = st.position
      eng.scratchWasPlaying = st.isPlaying
      eng.scratchPitch      = st.pitch
      eng.scratchLastT      = performance.now()
      eng.scratchLastDelta  = 0
      // Keep the element PLAYING so seeks emit sound (the scrub). If it was cued
      // (paused), start it so the scratch is still audible, like nudging vinyl.
      eng.audio.play().catch(() => {})
      if (!st.isPlaying) set(s => ({ [dk(deck)]: { ...s[dk(deck)], isPlaying: true } }))
    },
    scratchMove(deck, deltaSecs) {
      const eng = engine(deck)
      const dur = get()[dk(deck)].duration || eng.audio.duration || 0
      const upper = dur > 0 ? dur : Number.MAX_SAFE_INTEGER
      const t = Math.max(0, Math.min(upper, eng.scratchBase + deltaSecs))
      // Playback speed follows hand speed → vinyl pitch bend (audible scratch).
      const now    = performance.now()
      const dtSec  = Math.max(0.012, (now - eng.scratchLastT) / 1000)
      const moved  = deltaSecs - eng.scratchLastDelta
      eng.scratchLastT     = now
      eng.scratchLastDelta = deltaSecs
      const rate = Math.min(4, Math.max(0.25, Math.abs(moved) / dtSec))
      try {
        eng.audio.playbackRate = rate
        eng.audio.currentTime  = t
      } catch { /* seeking not ready */ }
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], position: t } }))
    },
    scratchEnd(deck) {
      const eng = engine(deck)
      // Restore the deck's normal (tempo-fader) playback rate.
      eng.audio.playbackRate = Math.max(0.06, Math.min(4, 1 + eng.scratchPitch / 100))
      if (eng.scratchWasPlaying) {
        eng.audio.play().catch(() => {})
        set(s => ({ [dk(deck)]: { ...s[dk(deck)], isPlaying: true } }))
      } else {
        eng.audio.pause()
        set(s => ({ [dk(deck)]: { ...s[dk(deck)], isPlaying: false } }))
      }
      eng.scratchWasPlaying = false
    },

    setColor(deck, v) {
      const k = dk(deck)
      const fx = get()[k].colorFx
      engine(deck).setColor(fx, v)
      set(s => ({ [k]: { ...s[k], color: v } }))
    },
    setColorFx(deck, fx) {
      const eng = engine(deck)
      eng.setColor(fx, 0)               // reset old effect to neutral
      eng.setColor(fx, get()[dk(deck)].color)
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], colorFx: fx } }))
    },

    setPadMode(deck, mode) {
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], padMode: mode } }))
    },
    triggerPad(deck, i) {
      const st = get()[dk(deck)]
      const beat = st.bpm && st.bpm > 0 ? 60 / st.bpm : 0.5   // 1 beat in seconds
      if (st.padMode === 'hotcue') {
        get().pressHotCue(deck, i)
      } else if (st.padMode === 'beatjump') {
        // pads: -16 -8 -4 -1 / +1 +4 +8 +16 beats
        const jumps = [-16, -8, -4, -1, 1, 4, 8, 16]
        get().beatJump(deck, jumps[i] * beat)
      } else {
        // beatloop / sliploop: 1/4 1/2 1 2 / 4 8 16 32 beats
        const lens = [0.25, 0.5, 1, 2, 4, 8, 16, 32]
        get().quickLoop(deck, lens[i] * beat)
      }
    },
    releasePad(deck, i) {
      // Momentary loop release for beat/slip loop pads (hold-to-loop).
      const st = get()[dk(deck)]
      if ((st.padMode === 'beatloop' || st.padMode === 'sliploop') && st.isLooping) {
        void i
        const k = dk(deck)
        set(s => ({ [k]: { ...s[k], isLooping: false } }))
        const eng = engine(deck)
        if (eng.slipActive) { eng.audio.currentTime = eng.slipPos; eng.slipActive = false; set(s => ({ [k]: { ...s[k], position: eng.slipPos } })) }
      }
    },
    setTempoRange(deck, pct) {
      const k = dk(deck)
      const cur = get()[k].pitch
      const clamped = Math.max(-pct, Math.min(pct, cur))
      if (clamped !== cur) get().setPitch(deck, clamped)
      set(s => ({ [k]: { ...s[k], tempoRange: pct } }))
    },
    tapBpm(deck) {
      const eng = engine(deck)
      const now = performance.now()
      const taps = (eng.bpmTaps = eng.bpmTaps.filter(t => now - t < 2500))
      taps.push(now)
      if (taps.length >= 2) {
        const intervals = taps.slice(1).map((t, idx) => t - taps[idx])
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
        const bpm = Math.round((60000 / avg) * 10) / 10
        if (bpm >= 40 && bpm <= 250) set(s => ({ [dk(deck)]: { ...s[dk(deck)], bpm } }))
      }
    },
    setCrossfaderCurve(c) { _cfCurve = c; applyCrossfader(get().crossfader); saveDJPrefs({ crossfaderCurve: c }); set({ crossfaderCurve: c }) },
    updateEq(patch) {
      initDJContext()
      const eq = { ...get().eq, ...patch }
      applyEq(eq)
      set({ eq })
    },
    setEqPreset(name) {
      const preset = EQ_PRESETS.find(p => p.name === name) ?? EQ_PRESETS[0]
      initDJContext()
      const eq = { ...get().eq, bands: [...preset.gains], preset: preset.name, bypass: false }
      applyEq(eq)
      set({ eq })
    },
    resetEq() {
      initDJContext()
      const eq: EqSettings = { bands: Array(10).fill(0), preset: 'FLAT', bypass: false, gain: 0, amplifier: false, compressor: false, deepBass: 0, surround: 0, balance: 0 }
      applyEq(eq)
      set({ eq })
    },
    setWaveStyle(s) { saveDJPrefs({ waveStyle: s }); set({ waveStyle: s }) },
    setBeatFx(patch) {
      initDJContext()
      const bf = { ...get().beatFx, ...patch }
      if (_bfx) {
        if (patch.channel !== undefined) {
          const src = bf.channel === 'A' ? djEngineA.fxOut : bf.channel === 'B' ? djEngineB.fxOut : _masterOut
          _bfx.setSource(src)
        }
        if (patch.type !== undefined)  _bfx.setType(bf.type)
        if (patch.depth !== undefined) _bfx.setDepth(bf.depth)
        if (patch.on !== undefined)    _bfx.setOn(bf.on)
        const s = get()
        const bpm = bf.channel === 'A' ? s.deckA.bpm : bf.channel === 'B' ? s.deckB.bpm : (s.deckA.bpm || s.deckB.bpm)
        _bfx.setBeatSeconds(bf.beat * (bpm && bpm > 0 ? 60 / bpm : 0.5))
      }
      set({ beatFx: bf })
    },

    setKeylock(deck, on) {
      engine(deck).audio.preservesPitch = on
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], keylock: on } }))
    },
    toggleSlip(deck) { set(s => ({ [dk(deck)]: { ...s[dk(deck)], slip: !s[dk(deck)].slip } })) },
    toggleVinyl(deck) { set(s => ({ [dk(deck)]: { ...s[dk(deck)], vinyl: !s[dk(deck)].vinyl } })) },
    nudge(deck, dir) {
      const st = get()[dk(deck)]
      const base = 1 + st.pitch / 100
      engine(deck).audio.playbackRate = Math.max(0.06, Math.min(4, base * (1 + dir * 0.04)))
    },
    nudgeEnd(deck) {
      const st = get()[dk(deck)]
      engine(deck).audio.playbackRate = Math.max(0.06, Math.min(4, 1 + st.pitch / 100))
    },
    brake(deck) {
      const eng = engine(deck)
      const k = dk(deck)
      if (eng.brakeTimer) return
      const start = eng.audio.playbackRate || 1
      let r = start
      eng.brakeTimer = setInterval(() => {
        r -= start / 14
        if (r <= 0.08) {
          if (eng.brakeTimer) clearInterval(eng.brakeTimer)
          eng.brakeTimer = null
          eng.audio.pause()
          eng.audio.playbackRate = Math.max(0.06, Math.min(4, 1 + get()[k].pitch / 100))
          set(s => ({ [k]: { ...s[k], isPlaying: false } }))
        } else {
          eng.audio.playbackRate = r
        }
      }, 50)
    },
    syncDeck(deck) {
      const k = dk(deck)
      const st = get()[k]
      const oth = get()[dk(deck === 'A' ? 'B' : 'A')]
      if (!st.bpm || !oth.bpm) return
      const otherEff = oth.bpm * (1 + oth.pitch / 100)
      const pct = Math.max(-st.tempoRange, Math.min(st.tempoRange, (otherEff / st.bpm - 1) * 100))
      get().setPitch(deck, Math.round(pct * 100) / 100)
    },
    censor(deck, on) { engine(deck).audio.muted = on },
    setQuantize(on)  { set({ quantize: on }) },
    setFaderStart(on) { set({ faderStart: on }) },
    toggleCrossfaderReverse() {
      _cfReverse = !get().crossfaderReverse
      applyCrossfader(get().crossfader)
      set({ crossfaderReverse: _cfReverse })
    },
    toggleLimiter() {
      const on = !get().masterLimiter
      if (_limiter) { _limiter.threshold.value = on ? -1 : 0; _limiter.ratio.value = on ? 20 : 1 }
      set({ masterLimiter: on })
    },
    toggleMono() {
      const on = !get().masterMono
      if (_monoGain) { _monoGain.channelCount = on ? 1 : 2; _monoGain.channelCountMode = on ? 'explicit' : 'max' }
      set({ masterMono: on })
    },
    moveLoop(deck, dir) {
      const k = dk(deck)
      set(s => {
        const st = s[k]
        if (st.loopIn == null || st.loopOut == null) return {}
        const len = st.loopOut - st.loopIn
        const shift = len * dir
        const loopIn = Math.max(0, st.loopIn + shift)
        return { [k]: { ...st, loopIn, loopOut: loopIn + len } }
      })
    },
    instantDouble(deck) {
      const k = dk(deck)
      const st = get()[k]
      if (!st.track) return
      const other = deck === 'A' ? 'B' : 'A'
      const ok = dk(other)
      const eng = engine(other)
      initDJContext()
      eng.audio.src = st.track.streamUrl ?? `/api/v1/media/audio/${st.track.id}/stream`
      eng.audio.load()
      const pos = st.position
      eng.audio.addEventListener('canplay', function seek() {
        eng.audio.currentTime = pos
        eng.audio.play().catch(() => {})
        eng.audio.removeEventListener('canplay', seek)
      }, { once: true })
      set(s => ({ [ok]: {
        ...s[ok], track: st.track, isPlaying: true, isLoading: true,
        position: pos, duration: st.duration, pitch: st.pitch, bpm: st.bpm,
        queue: [], queueIndex: -1, cuePoint: 0, isLooping: false, loopIn: null, loopOut: null,
      } }))
      eng.audio.playbackRate = Math.max(0.06, Math.min(4, 1 + st.pitch / 100))
    },
    setAutoMix(on) { set({ autoMix: on }) },
    toggleMic() {
      if (get().micOn) { disableMic(); setTalkoverDuck(false); set({ micOn: false }) }
      else { enableMic().then(ok => { if (ok) { setTalkoverDuck(get().talkover); set({ micOn: true }) } }) }
    },
    setTalkover(on) { setTalkoverDuck(on && get().micOn); set({ talkover: on }) },
    playSample(i) { playSampleSound(i) },
    recordSample(i) {
      if (get().sampleRecording >= 0) return
      set({ sampleRecording: i })
      recordSampleToSlot(i, () => set({ sampleRecording: -1 }))
    },
    toggleCue(deck) {
      initDJContext()
      const k = dk(deck)
      const on = !get()[k].cue
      setCueDeck(deck, on)
      set(s => ({ [k]: { ...s[k], cue: on } }))
    },
    setCueMix(v) { setCueMixGain(v); set({ cueMix: v }) },
    setHeadphoneDevice(id) { setHeadphoneDevice(id); set({ headphoneId: id }) },
    autoBpm(deck) {
      const st = get()[dk(deck)]
      if (!st.isPlaying || get().bpmDetecting) return
      set({ bpmDetecting: deck })
      detectBpm(deck, bpm => {
        if (bpm > 0) set(s => ({ [dk(deck)]: { ...s[dk(deck)], bpm } }))
        set({ bpmDetecting: null })
      })
    },
    analyzeTrack(deck) {
      const st = get()[dk(deck)]
      if (!st.track || get().analyzing) return
      initDJContext()
      if (!_djCtx) return
      const url = st.track.streamUrl ?? `/api/v1/media/audio/${st.track.id}/stream`
      set({ analyzing: deck })
      ;(async () => {
        try {
          const resp = await fetch(url, { credentials: 'include' })
          const arr = await resp.arrayBuffer()
          const audio = await _djCtx!.decodeAudioData(arr)
          const res = analyzeBuffer(audio)
          if (st.track) _peakCache[st.track.id] = res.peaks
          set(s => ({ [dk(deck)]: { ...s[dk(deck)], bpm: res.bpm, beatOffset: res.offset, keyName: res.key } }))
          get()._persistCues(deck)
        } catch (e) { console.warn('Track analysis failed:', e) }
        set({ analyzing: null })
      })()
    },
    exportSetlist() {
      const h = get().history
      if (h.length === 0) return
      const lines = h.map((e, i) => `${i + 1}. ${e.artist ? e.artist + ' — ' : ''}${e.title}` +
        `${e.key ? `  [${e.key}]` : ''}${e.bpm ? `  ${e.bpm.toFixed(1)} BPM` : ''}  (Deck ${e.deck})`)
      const text = `Kubuno DJ — Setlist (${h.length} titres)\n\n${lines.join('\n')}\n`
      const blob = new Blob([text], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'kubuno-setlist.txt'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    },
    setTransitionStyle(s) { set({ transitionStyle: s }) },
    transitionNow() {
      const s = get()
      const playing = s.deckA.isPlaying ? 'A' : s.deckB.isPlaying ? 'B' : null
      if (!playing || _autoMixRamp) return
      const to = playing === 'A' ? 'B' : 'A'
      if (!s[dk(to)].track) return
      startAutoMix(playing, to, get, set)
    },
    saveConfig(name) {
      const s = get()
      _configStore[name] = {
        eq: s.eq, beatFx: s.beatFx, waveStyle: s.waveStyle, crossfaderCurve: s.crossfaderCurve,
        masterVolume: s.masterVolume, quantize: s.quantize, faderStart: s.faderStart, crossfaderReverse: s.crossfaderReverse,
        masterLimiter: s.masterLimiter, masterMono: s.masterMono, autoMix: s.autoMix, transitionStyle: s.transitionStyle,
        decks: {
          A: { tempoRange: s.deckA.tempoRange, keylock: s.deckA.keylock, vinyl: s.deckA.vinyl },
          B: { tempoRange: s.deckB.tempoRange, keylock: s.deckB.keylock, vinyl: s.deckB.vinyl },
        },
      }
      persistConfigStore()
      set({ configNames: Object.keys(_configStore) })
    },
    loadConfig(name) {
      const c = _configStore[name]
      if (!c) return
      initDJContext()
      applyEq(c.eq)
      if (_djMaster) _djMaster.gain.value = Math.max(0, Math.min(1, c.masterVolume))
      _cfCurve = c.crossfaderCurve
      _cfReverse = c.crossfaderReverse
      applyCrossfader(get().crossfader)
      if (_limiter) { _limiter.threshold.value = c.masterLimiter ? -1 : 0; _limiter.ratio.value = c.masterLimiter ? 20 : 1 }
      if (_monoGain) { _monoGain.channelCount = c.masterMono ? 1 : 2; _monoGain.channelCountMode = c.masterMono ? 'explicit' : 'max' }
      djEngineA.audio.preservesPitch = c.decks.A.keylock
      djEngineB.audio.preservesPitch = c.decks.B.keylock
      if (_bfx) { _bfx.setType(c.beatFx.type); _bfx.setDepth(c.beatFx.depth); _bfx.setOn(c.beatFx.on) }
      saveDJPrefs({ waveStyle: c.waveStyle, crossfaderCurve: c.crossfaderCurve, masterVolume: c.masterVolume })
      set(s => ({
        eq: c.eq, beatFx: c.beatFx, waveStyle: c.waveStyle, crossfaderCurve: c.crossfaderCurve,
        masterVolume: c.masterVolume, quantize: c.quantize, faderStart: c.faderStart, crossfaderReverse: c.crossfaderReverse,
        masterLimiter: c.masterLimiter, masterMono: c.masterMono, autoMix: c.autoMix, transitionStyle: c.transitionStyle,
        deckA: { ...s.deckA, tempoRange: c.decks.A.tempoRange, keylock: c.decks.A.keylock, vinyl: c.decks.A.vinyl },
        deckB: { ...s.deckB, tempoRange: c.decks.B.tempoRange, keylock: c.decks.B.keylock, vinyl: c.decks.B.vinyl },
      }))
    },
    deleteConfig(name) {
      delete _configStore[name]
      persistConfigStore()
      set({ configNames: Object.keys(_configStore) })
    },
    toggleMidi() {
      if (get().midiEnabled) { detachMidi(); set({ midiEnabled: false, midiLearn: null }); return }
      initMidi((key, value, isNote) => {
        const ls = get()
        if (ls.midiLearn) {
          const map = { ...ls.midiMap }
          for (const k of Object.keys(map)) if (map[k] === ls.midiLearn) delete map[k]
          map[key] = ls.midiLearn
          saveMidiMap(map)
          set({ midiMap: map, midiLearn: null })
          return
        }
        const target = ls.midiMap[key]
        if (target) applyMidiTarget(target, value, isNote, get)
      }).then(ok => set({ midiEnabled: ok, midiSupported: ok || get().midiSupported }))
    },
    startMidiLearn(target) { set({ midiLearn: get().midiLearn === target ? null : target }) },
    clearMidiTarget(target) {
      const map = { ...get().midiMap }
      for (const k of Object.keys(map)) if (map[k] === target) delete map[k]
      saveMidiMap(map)
      set({ midiMap: map })
    },
    panic() {
      // Kill switch: stop both decks, cut the master FX, mic and talkover.
      for (const d of ['A', 'B'] as const) {
        engine(d).audio.pause()
        set(s => ({ [dk(d)]: { ...s[dk(d)], isPlaying: false } }))
      }
      if (_bfx) _bfx.setOn(false)
      disableMic(); setTalkoverDuck(false)
      set({ beatFx: { ...get().beatFx, on: false }, micOn: false, talkover: false })
    },
    setHotCueColor(deck, i, color) {
      const k = dk(deck)
      set(s => { const cues = [...s[k].hotCues]; if (cues[i]) cues[i] = { ...cues[i]!, color }; return { [k]: { ...s[k], hotCues: cues } } })
      get()._persistCues(deck)
    },
    setHotCueLabel(deck, i, label) {
      const k = dk(deck)
      set(s => { const cues = [...s[k].hotCues]; if (cues[i]) cues[i] = { ...cues[i]!, label }; return { [k]: { ...s[k], hotCues: cues } } })
      get()._persistCues(deck)
    },

    toggleRecording() {
      if (get().isRecording) { stopMixRecording(); set({ isRecording: false }) }
      else { initDJContext(); const ok = startMixRecording(); set({ isRecording: ok }) }
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
        get()._persistCues(deck)
      }
    },

    deleteHotCue(deck, i) {
      const cues = [...get()[dk(deck)].hotCues]
      cues[i] = null
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], hotCues: cues } }))
      get()._persistCues(deck)
    },

    setLoopIn(deck) {
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], loopIn: s[dk(deck)].position } }))
    },

    setLoopOut(deck) {
      const st = get()[dk(deck)]
      if (st.slip) { const eng = engine(deck); eng.slipActive = true; eng.slipPos = st.position; eng.slipLastT = performance.now() }
      set(s => ({ [dk(deck)]: { ...s[dk(deck)], loopOut: s[dk(deck)].position, isLooping: true } }))
    },

    toggleLoop(deck) {
      const k = dk(deck)
      const wasLooping = get()[k].isLooping
      set(s => ({ [k]: { ...s[k], isLooping: !wasLooping } }))
      if (wasLooping) {
        const eng = engine(deck)
        if (eng.slipActive) { eng.audio.currentTime = eng.slipPos; eng.slipActive = false; set(s => ({ [k]: { ...s[k], position: eng.slipPos } })) }
      }
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
    setMasterVol(v)  { if (_djMaster) _djMaster.gain.value = Math.max(0, Math.min(1, v)); saveDJPrefs({ masterVolume: v }); set({ masterVolume: v }) },

    _persistCues(deck) {
      const st = get()[dk(deck)]
      if (st.track) saveTrackMeta(st.track.id, { hotCues: st.hotCues, bpm: st.bpm, keyName: st.keyName, beatOffset: st.beatOffset })
    },
    _logHistory(deck) {
      const st = get()[dk(deck)]
      if (!st.track) return
      const h = get().history
      const last = h[h.length - 1]
      if (last && last.title === st.track.title) return   // avoid immediate duplicates (e.g. resume)
      set({ history: [...h, { title: st.track.title, artist: st.track.artistName ?? '', deck, key: st.keyName, bpm: st.bpm }].slice(-200) })
    },
    _tick(deck, pos) {
      const k  = dk(deck)
      const st = get()[k]
      const eng = engine(deck)
      // Slip mode: keep the shadow playhead advancing in real time.
      if (eng.slipActive) {
        const now = performance.now()
        eng.slipPos += (now - eng.slipLastT) / 1000 * eng.audio.playbackRate
        eng.slipLastT = now
      }
      if (st.isLooping && st.loopIn !== null && st.loopOut !== null && pos >= st.loopOut) {
        engine(deck).audio.currentTime = st.loopIn
        return
      }
      // Auto-mix: near the end, start the other deck and ramp the crossfader over.
      if (get().autoMix && st.isPlaying && st.duration > 0 && st.duration - pos <= 6 && !_autoMixRamp) {
        const other = deck === 'A' ? 'B' : 'A'
        const oth = get()[dk(other)]
        if (oth.track && !oth.isPlaying) startAutoMix(deck, other, get, set)
      }
      set(s => ({ [k]: { ...s[k], position: pos } }))
    },

    _setDuration: (deck, dur) => set(s => ({ [dk(deck)]: { ...s[dk(deck)], duration: dur } })),
    _setPlaying:  (deck, v)   => set(s => ({ [dk(deck)]: { ...s[dk(deck)], isPlaying: v } })),
    _setLoading:  (deck, v)   => set(s => ({ [dk(deck)]: { ...s[dk(deck)], isLoading: v } })),
  }
})
