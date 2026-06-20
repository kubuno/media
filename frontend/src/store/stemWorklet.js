// Real-time vocal / instrumental separator (AudioWorklet processor).
//
// Best real-time, in-browser, no-ML approach: STFT analysis (2048-pt, 75 %
// overlap, Hann/COLA) + a per-bin soft mask combining inter-channel coherence
// and panning balance (azimuth discrimination, à la ADRess) weighted to the
// vocal band, with temporal smoothing to suppress musical noise. The centred,
// coherent, vocal-band energy is the lead-vocal estimate:
//   • acapella     (mode 1) = vocal estimate (mono → stereo)
//   • instrumental (mode 2) = original − vocal estimate (keeps the stereo image)
// mode 0 outputs silence (the host routes the dry signal around the worklet).
//
// Loaded as a same-origin asset (CSP `script-src 'self'`), not a blob.
class StemSeparator extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'mode', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' }]
  }
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    const N = o.N || 2048, H = o.H || 512
    this.N = N; this.H = H; this.sr = sampleRate
    this.win = new Float32Array(N)
    for (let n = 0; n < N; n++) this.win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N)
    let s = 0; for (let n = 0; n < N; n++) s += this.win[n] * this.win[n]
    this.norm = 1 / (s / H)                       // Hann analysis+synthesis COLA scaling
    this.inL = new Float32Array(N); this.inR = new Float32Array(N)
    this.olaL = new Float32Array(N); this.olaR = new Float32Array(N)
    this.maskPrev = new Float32Array(N)
    this.mask = new Float32Array(N); this.maskS = new Float32Array(N)
    this.stageL = new Float32Array(H); this.stageR = new Float32Array(H); this.acc = 0
    this.reL = new Float32Array(N); this.imL = new Float32Array(N)
    this.reR = new Float32Array(N); this.imR = new Float32Array(N)
    this.fifoSize = N * 4
    this.foutL = new Float32Array(this.fifoSize); this.foutR = new Float32Array(this.fifoSize)
    this.fr = 0; this.fw = N; this.favail = N    // prime one frame of latency
  }
  fft(re, im, inv) {
    const n = re.length
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inv ? 2 : -2) * Math.PI / len
      const wr = Math.cos(ang), wi = Math.sin(ang), hl = len >> 1
      for (let i = 0; i < n; i += len) {
        let cwr = 1, cwi = 0
        for (let k = 0; k < hl; k++) {
          const ar = re[i + k + hl], ai = im[i + k + hl]
          const vr = ar * cwr - ai * cwi, vi = ar * cwi + ai * cwr
          const ur = re[i + k], ui = im[i + k]
          re[i + k] = ur + vr; im[i + k] = ui + vi
          re[i + k + hl] = ur - vr; im[i + k + hl] = ui - vi
          const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
  }
  vocalWeight(f) {
    const lo = f < 90 ? 0 : f > 200 ? 1 : (f - 90) / 110
    const hi = f < 7000 ? 1 : f > 11000 ? 0 : 1 - (f - 7000) / 4000
    return lo * hi
  }
  frame(mode) {
    const N = this.N, win = this.win, half = N >> 1
    const reL = this.reL, imL = this.imL, reR = this.reR, imR = this.imR
    const mask = this.mask, maskS = this.maskS
    for (let n = 0; n < N; n++) { const w = win[n]; reL[n] = this.inL[n] * w; imL[n] = 0; reR[n] = this.inR[n] * w; imR[n] = 0 }
    this.fft(reL, imL, false); this.fft(reR, imR, false)
    const eps = 1e-9
    // Pass 1 — per-bin soft vocal mask (centred + coherent + vocal-band), temporally smoothed.
    for (let k = 0; k < N; k++) {
      const lr = reL[k], li = imL[k], rr = reR[k], ri = imR[k]
      const Lm2 = lr * lr + li * li, Rm2 = rr * rr + ri * ri
      const cr = lr * rr + li * ri, ci = li * rr - lr * ri
      let coh = 2 * Math.sqrt(cr * cr + ci * ci) / (Lm2 + Rm2 + eps)   // inter-channel coherence
      if (coh > 1) coh = 1
      const bal = 1 - Math.abs(Lm2 - Rm2) / (Lm2 + Rm2 + eps)         // panning balance (centred -> 1)
      let centre = coh * bal
      centre = centre * centre * (3 - 2 * centre)                     // smoothstep
      const kk = k <= half ? k : N - k
      let m = centre * this.vocalWeight(kk * this.sr / N)
      m = this.maskPrev[k] * 0.55 + m * 0.45                          // temporal smoothing
      this.maskPrev[k] = m
      mask[k] = m
    }
    // Pass 2 — 3-tap frequency smoothing of the mask (suppress musical noise).
    maskS[0] = mask[0]; maskS[N - 1] = mask[N - 1]
    for (let k = 1; k < N - 1; k++) maskS[k] = (mask[k - 1] + 2 * mask[k] + mask[k + 1]) * 0.25
    // Pass 3 — apply as a soft Wiener-style mask directly on L/R (preserves timbre/stereo).
    for (let k = 0; k < N; k++) {
      const lr = reL[k], li = imL[k], rr = reR[k], ri = imR[k]
      let g
      if (mode === 1) { g = maskS[k] }                               // acapella: keep vocal
      else { g = 1 - 1.1 * maskS[k]; if (g < 0.02) g = 0.02 }        // instrumental: remove vocal (slight over-subtract + floor)
      reL[k] = lr * g; imL[k] = li * g; reR[k] = rr * g; imR[k] = ri * g
    }
    this.fft(reL, imL, true); this.fft(reR, imR, true)
    const norm = this.norm, H = this.H
    for (let n = 0; n < N; n++) { const w = win[n] * norm; this.olaL[n] += reL[n] * w; this.olaR[n] += reR[n] * w }
    for (let n = 0; n < H; n++) { this.foutL[this.fw] = this.olaL[n]; this.foutR[this.fw] = this.olaR[n]; this.fw = (this.fw + 1) % this.fifoSize }
    this.favail += H
    this.olaL.copyWithin(0, H); this.olaR.copyWithin(0, H)
    this.olaL.fill(0, N - H); this.olaR.fill(0, N - H)
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0]
    const outL = output[0], outR = output[1] || output[0]
    const Q = outL.length, H = this.H, N = this.N
    const mode = Math.round(parameters.mode[0])
    if (mode === 0) { for (let i = 0; i < Q; i++) { outL[i] = 0; if (outR !== outL) outR[i] = 0 } return true }
    const inL = input && input[0] ? input[0] : null
    const inR = input && input[1] ? input[1] : inL
    for (let i = 0; i < Q; i++) { this.stageL[this.acc + i] = inL ? inL[i] : 0; this.stageR[this.acc + i] = inR ? inR[i] : 0 }
    this.acc += Q
    if (this.acc >= H) {
      this.inL.copyWithin(0, H); this.inR.copyWithin(0, H)
      this.inL.set(this.stageL, N - H); this.inR.set(this.stageR, N - H)
      this.acc = 0
      this.frame(mode)
    }
    for (let i = 0; i < Q; i++) {
      if (this.favail > 0) { outL[i] = this.foutL[this.fr]; if (outR !== outL) outR[i] = this.foutR[this.fr]; this.fr = (this.fr + 1) % this.fifoSize; this.favail-- }
      else { outL[i] = 0; if (outR !== outL) outR[i] = 0 }
    }
    return true
  }
}
registerProcessor('kubuno-stem-separator', StemSeparator)
